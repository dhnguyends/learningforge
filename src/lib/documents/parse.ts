import type { ChunkKind } from "@prisma/client";

export interface ParsedDocumentPage {
  page: number;
  text: string;
  heading?: string;
}

export interface ParsedDocument {
  pages: ParsedDocumentPage[];
  pageCount: number;
  kind: ChunkKind; // DOCUMENT | SLIDE | NOTE | OCR
  metadata: Record<string, unknown>;
}

/**
 * Server-side document text extraction.
 * - PDF: per-page text via pdfjs (keeps page-level citation anchors); pages
 *   without a text layer (scans, slides exported as images) are rendered and
 *   OCR'd instead of silently yielding nothing
 * - PPTX: slide XML text via JSZip (each slide = one page)
 * - DOCX: plain text via mammoth (single page, split later by chunker)
 * - Images: OCR via tesseract.js (lazy-loaded; optional dependency in spirit)
 */
export interface ParseOptions {
  /** Read every PDF page with OCR (scans whose text layer is poor), not only pages without text. */
  forceOcr?: boolean;
  /** Document language ("en", "fr"…): OCR uses that language's model (English + French when unknown). */
  language?: string | null;
}

/** Tesseract language models for the languages LearningForge reads. */
const OCR_LANGUAGES: Record<string, string> = { en: "eng", fr: "fra", es: "spa", de: "deu", it: "ita", pt: "por" };

export function ocrLanguageFor(language?: string | null): string {
  const base = (language ?? "").toLowerCase().split(/[-_]/)[0];
  return OCR_LANGUAGES[base] ?? "eng+fra";
}

export async function parseDocument(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  options: ParseOptions = {},
): Promise<ParsedDocument> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf" || mimeType === "application/pdf") return parsePdf(buffer, options);
  if (ext === "pptx" || mimeType.includes("presentation")) return parsePptx(buffer);
  if (ext === "docx" || mimeType.includes("wordprocessing")) return parseDocx(buffer);
  if (["png", "jpg", "jpeg", "webp"].includes(ext) || mimeType.startsWith("image/")) {
    return ocrImage(buffer, ocrLanguageFor(options.language));
  }
  if (ext === "txt" || ext === "md" || mimeType.startsWith("text/")) {
    return {
      pages: [{ page: 1, text: buffer.toString("utf8") }],
      pageCount: 1,
      kind: "NOTE",
      metadata: { format: ext },
    };
  }
  throw new Error(`Unsupported document type: ${ext || mimeType}`);
}

/**
 * Share of a text's tokens that look like real words (letters, 2+ characters,
 * at least one vowel): OCR of illustrations or mixed-up columns scores low,
 * a clean text layer scores high.
 */
export function wordQuality(text: string): number {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const good = tokens.filter((t) => {
    const w = t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    return w.length >= 2 && /^[\p{L}'’-]+$/u.test(w) && /[aeiouyàâäéèêëîïôöùûüœæáíóú]/i.test(w);
  });
  return good.length / tokens.length;
}

/**
 * Should a page's OCR text replace its text layer? Only when the OCR reads
 * like real text (Tesseract confident, mostly real words) and better than the
 * layer — so a scan never degrades a document whose text layer was fine.
 */
export function ocrIsBetter(ocrText: string, layerText: string, confidence: number): boolean {
  if (ocrText.length < MIN_PAGE_TEXT_CHARS || confidence < 50) return false;
  const ocrQ = wordQuality(ocrText);
  if (layerText.length < MIN_PAGE_TEXT_CHARS) return ocrQ >= 0.4; // no text layer: any readable OCR helps
  const layerQ = wordQuality(layerText);
  return ocrQ >= 0.7 && ocrQ > layerQ + 0.05 && ocrText.length >= layerText.length * 0.6;
}

/** A page with less text than this has no usable text layer (scan or exported slide). */
const MIN_PAGE_TEXT_CHARS = 25;
/** Render scale for OCR: ~150 dpi for a letter-size page, enough for slide text. */
const OCR_RENDER_SCALE = 2;

async function parsePdf(buffer: Buffer, options: ParseOptions = {}): Promise<ParsedDocument> {
  const ocrLanguage = ocrLanguageFor(options.language);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages: ParsedDocumentPage[] = [];
  let ocr: Awaited<ReturnType<typeof startOcr>> | null = null;
  let ocrPages = 0;
  let keptLayerPages = 0;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (options.forceOcr || text.length < MIN_PAGE_TEXT_CHARS) {
        // No text layer (or a poor one the learner asked to re-scan): render the page and read it with OCR.
        ocr ??= await startOcr(ocrLanguage);
        const image = await renderPdfPage(page, OCR_RENDER_SCALE);
        const result = (await ocr.recognize(image)).data;
        const read = result.text?.replace(/\s+/g, " ").trim() ?? "";
        if (ocrIsBetter(read, text, result.confidence ?? 0)) {
          text = read;
          ocrPages++;
        } else if (options.forceOcr) {
          keptLayerPages++;
        }
      }
      pages.push({ page: i, text, heading: firstLine(text) });
      page.cleanup();
    }
  } finally {
    await ocr?.terminate();
    await doc.destroy();
  }
  return {
    pages,
    pageCount: doc.numPages,
    kind: "DOCUMENT",
    metadata: {
      format: "pdf",
      ocrPages,
      ...(ocrPages > 0 ? { ocrLanguage } : {}),
      ...(options.forceOcr ? { ocrForced: true, ocrKeptLayerPages: keptLayerPages } : {}),
    },
  };
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>["promise"]>["getPage"]>>;

/** Render one PDF page to PNG bytes with @napi-rs/canvas (installed with pdfjs-dist). */
async function renderPdfPage(page: PdfPage, scale: number): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff"; // transparent backgrounds OCR poorly
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
  return canvas.toBuffer("image/png");
}

async function startOcr(language = "eng") {
  const { createWorker } = await import("tesseract.js");
  return createWorker(language.split("+"));
}

async function parsePptx(buffer: Buffer): Promise<ParsedDocument> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const pages: ParsedDocumentPage[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    const text = texts.join("\n").replace(/\n{2,}/g, "\n").trim();
    pages.push({ page: slideNumber(name), text, heading: texts[0]?.slice(0, 80) });
  }
  return { pages, pageCount: pages.length, kind: "SLIDE", metadata: { format: "pptx" } };
}

async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return {
    pages: [{ page: 1, text: result.value }],
    pageCount: 1,
    kind: "NOTE",
    metadata: { format: "docx" },
  };
}

async function ocrImage(buffer: Buffer, language = "eng+fra"): Promise<ParsedDocument> {
  // tesseract.js is loaded lazily: OCR is only needed for image/handwritten notes.
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(language.split("+"));
  try {
    const { data } = await worker.recognize(buffer);
    return {
      pages: [{ page: 1, text: data.text ?? "", heading: "OCR" }],
      pageCount: 1,
      kind: "OCR",
      metadata: { format: "ocr", confidence: data.confidence },
    };
  } finally {
    await worker.terminate();
  }
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml/)?.[1] ?? 0);
}

function firstLine(text: string): string | undefined {
  const line = text.split(/[.!?\n]/)[0]?.trim();
  return line && line.length > 3 && line.length < 90 ? line : undefined;
}
