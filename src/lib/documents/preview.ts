import sanitizeHtml from "sanitize-html";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Word (.docx) → HTML for the source page: headings, paragraphs, lists,
 * tables, links and embedded pictures, via mammoth. Browsers cannot show
 * Word files themselves. The output is sanitized with a strict allow-list
 * (no scripts, styles, event handlers or javascript: links; pictures only as
 * inline data images) because it is rendered inside the app.
 */
export async function docxToSafeHtml(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer });
  return sanitizeDocumentHtml(value);
}

export function sanitizeDocumentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "strong", "b", "em", "i", "u", "s", "sup", "sub",
      "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "a", "img",
    ],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["data"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    // Pictures embedded in the document only, never remote ones (tracking).
    // Word bookmarks become empty anchors: drop them.
    exclusiveFilter: (frame) =>
      (frame.tag === "img" && !/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(frame.attribs.src ?? "")) ||
      (frame.tag === "a" && !frame.attribs.href && !frame.text.trim()),
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
    },
  });
}
