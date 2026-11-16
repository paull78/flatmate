import type { FontStyle } from "../view/scene-types";

// A report's light marks (sheetset.05, AC-09), as plain text on its sheet: `# title`, `## heading`, paragraphs split by a
// blank line, `**bold**` and `*italic*`. Pure. Anything else prints as typed, so nothing a person types can be refused or
// lost: a `*` only marks when it touches the words it wraps, and marks don't nest.

export type Run = { text: string; style?: FontStyle };
export type ReportBlock = { kind: "title" | "heading"; text: string } | { kind: "paragraph"; runs: readonly Run[] };

const TITLE = /^# (.+)$/;
const HEADING = /^## (.+)$/;
export const REPORT_MARK = /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*|\*([^\s*](?:[^*]*[^\s*])?)\*/g;

function runsOf(text: string): Run[] {
  const runs: Run[] = [];
  let from = 0;
  for (const m of text.matchAll(REPORT_MARK)) {
    if (m.index > from) runs.push({ text: text.slice(from, m.index) });
    const [, bold, oblique] = m;
    runs.push(bold !== undefined ? { text: bold, style: "bold" } : { text: oblique ?? "", style: "oblique" });
    from = m.index + m[0].length;
  }
  if (from < text.length) runs.push({ text: text.slice(from) });
  return runs;
}

/** The text's blocks. Only a `#` before anything else is the title; a later one is a heading, as a page has one title. */
export function parseReport(text: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  let paragraph: string[] = [];
  const endParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", runs: runsOf(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/[ \t]+/g, " ").trim(); // a tab would print as "?"
    const title = TITLE.exec(line)?.[1];
    const heading = HEADING.exec(line)?.[1] ?? (blocks.length + paragraph.length > 0 ? title : undefined);
    if (line === "" || heading !== undefined || title !== undefined) endParagraph();
    if (heading !== undefined) blocks.push({ kind: "heading", text: heading });
    else if (title !== undefined) blocks.push({ kind: "title", text: title });
    else if (line !== "") paragraph.push(line);
  }
  endParagraph();
  return blocks;
}

/** What a report prints, for the characters warning: its line breaks and marks never reach the PDF. */
export function reportStrings(text: string): string[] {
  return parseReport(text).flatMap((b) => (b.kind === "paragraph" ? b.runs.map((r) => r.text) : [b.text]));
}

/** The first line with anything on it, as it prints: what Properties shows of a report (AC-14). */
export function reportFirstLine(text: string): string {
  const line = text.split(/\r\n|\r|\n/).find((l) => l.trim() !== "");
  return line === undefined ? "" : reportStrings(line).join("");
}
