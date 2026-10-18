import { formatTimestamp } from "@/lib/utils";
import { serverAnswerTimes } from "@/lib/tutor-timing";

/**
 * A tutor conversation as a Markdown document, for the learner to keep:
 * each question and answer in order, with the model, the time to answer,
 * the provenance label and the cited passages (source, page or timestamp).
 * Answers are Markdown already (LaTeX included) and are kept as they are.
 * Pure.
 */
export interface ExportMessage {
  id: string;
  role: string;
  content: string;
  mode: string | null;
  claimType: string | null;
  createdAt: Date | string;
  metadata: unknown;
  anchors: { startMs: number | null; endMs: number | null; page: number | null; excerpt: string; source: { title: string } | null }[];
}

const MODE_LABEL: Record<string, string> = {
  hint: "Hint",
  explain_differently: "Explain differently",
  show_source: "Show source",
  challenge: "Challenge me",
  reveal_solution: "Reveal solution",
};

const CLAIM_LABEL: Record<string, string> = {
  SOURCE_GROUNDED: "Supported by your sources",
  INFERENCE: "Inference / synthesis",
  EXTERNAL: "General knowledge",
};

/** "2026-10-18 04:12" (UTC, so the file reads the same everywhere). */
const stamp = (d: Date | string) => new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function where(a: ExportMessage["anchors"][number]): string {
  if (a.startMs != null) return a.endMs != null ? `${formatTimestamp(a.startMs)}–${formatTimestamp(a.endMs)}` : formatTimestamp(a.startMs);
  if (a.page != null) return `p. ${a.page}`;
  return "";
}

export function conversationToMarkdown(opts: { title: string; studySetTitle: string; exportedAt?: Date; messages: ExportMessage[] }): string {
  const times = serverAnswerTimes(opts.messages.map((m) => ({ id: m.id, role: m.role, createdAt: new Date(m.createdAt).toISOString() })));
  const lines: string[] = [
    `# ${opts.title}`,
    "",
    `Tutor conversation · study set **${opts.studySetTitle}** · exported ${stamp(opts.exportedAt ?? new Date())} from LearningForge`,
    "",
  ];

  for (const m of opts.messages) {
    if (m.role !== "USER" && m.role !== "ASSISTANT") continue;
    const meta = (m.metadata ?? {}) as { sourceSearch?: boolean; model?: string; modelLabel?: string; displayedMs?: number };
    const searchOff = meta.sourceSearch === false;
    lines.push("---", "");

    if (m.role === "USER") {
      const extras = [stamp(m.createdAt), m.mode && m.mode !== "answer" ? MODE_LABEL[m.mode] ?? m.mode : null, searchOff ? "sources not searched" : null];
      lines.push(`### You · ${extras.filter(Boolean).join(" · ")}`, "", m.content.trim(), "");
      continue;
    }

    const ms = typeof meta.displayedMs === "number" ? meta.displayedMs : times[m.id];
    const label = searchOff ? "General knowledge · sources not searched" : m.claimType ? CLAIM_LABEL[m.claimType] ?? m.claimType : null;
    const extras = [
      meta.modelLabel ?? meta.model ?? null,
      ms != null ? `answered in ${formatTimestamp(ms, true)}` : null,
      label,
    ];
    lines.push(`### Tutor · ${extras.filter(Boolean).join(" · ")}`, "", m.content.trim(), "");

    if (m.anchors.length) {
      lines.push("**Sources cited**", "");
      for (const a of m.anchors) {
        const loc = where(a);
        const excerpt = a.excerpt.replace(/\s+/g, " ").trim().slice(0, 200);
        lines.push(`- ${a.source?.title ?? "Source"}${loc ? ` (${loc})` : ""}${excerpt ? `: “${excerpt}”` : ""}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/** "tutor-why-is-backprop-cheap-2026-10-18.md" */
export function exportFileName(title: string, at: Date = new Date()): string {
  const slug =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "conversation";
  return `tutor-${slug}-${at.toISOString().slice(0, 10)}.md`;
}
