import { REPORT_MARK } from "@fm/editor";

// The style bar's text edits (sheetset.07, .50), pure. What they write must print as meant: marks touch their words and
// don't nest, a blank line ends a paragraph, and marks inside `#` and `##` print as typed.

/** Replace `from`..`to` with `insert`; then select `start`..`end`, in the new text. */
export type BoxEdit = { from: number; to: number; insert: string; start: number; end: number };

type Mark = "**" | "*";
type Line = { from: number; to: number; text: string };

const HEADING_LINE = /^\s*#{1,2}\s+\S/;
const PREFIX = /^\s*(#{1,2}) (.*)$/;

/** A text box reports every line break as \n, so anything else would differ on each render and React would reset the caret. */
export const boxText = (text: string): string => text.replace(/\r\n?/g, "\n");

function linesIn(value: string, start: number, end: number): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const text of value.split("\n")) {
    const to = from + text.length;
    if (to >= start && from <= end) lines.push({ from, to, text });
    from = to + 1;
  }
  return lines;
}

/** Where a place in `text` lands once `change` has rewritten it, found by carrying a character nobody types through it. */
const CARET = "\uE000";
function landing(text: string, at: number, change: (text: string) => string): number {
  return change(`${text.slice(0, at)}${CARET}${text.slice(at)}`).indexOf(CARET);
}

const unmarked = (text: string): string => text.replace(REPORT_MARK, (_all, bold: string | undefined, oblique: string | undefined) => bold ?? oblique ?? "");

/** What of a line a mark applies to, in the line's own offsets: the selection's words, or the word at a caret, taking in any marked run it reaches into. */
function targetIn(line: Line, start: number, end: number): { a: number; b: number } {
  let a = Math.max(start, line.from) - line.from;
  let b = Math.min(end, line.to) - line.from;
  const selected = line.text.slice(a, b);
  if (selected.trim() === "") {
    b = a; // a selection of only spaces is a caret at its start
    while (a > 0 && !/\s/.test(line.text.charAt(a - 1))) a -= 1;
    while (b < line.text.length && !/\s/.test(line.text.charAt(b))) b += 1;
  } else {
    a += selected.length - selected.trimStart().length;
    b -= selected.length - selected.trimEnd().length;
  }
  for (const m of line.text.matchAll(REPORT_MARK)) {
    const runEnd = m.index + m[0].length;
    if (m.index <= b && runEnd >= a && !(b === m.index || a === runEnd)) {
      a = Math.min(a, m.index);
      b = Math.max(b, runEnd);
    }
  }
  return { a, b };
}

type Part = { from: number; to: number; inner: string; marked: boolean };

/** The parts of the selected lines that can take a mark. A heading prints marks as typed, and a star left in the words would break them. */
function partsOf(lines: readonly Line[], start: number, end: number, mark: Mark): Part[] {
  return lines.flatMap((line): Part[] => {
    if (HEADING_LINE.test(line.text) || (line.text.trim() === "" && lines.length > 1)) return [];
    const { a, b } = targetIn(line, start, end);
    const target = line.text.slice(a, b);
    const inner = unmarked(target);
    return inner.includes("*") ? [] : [{ from: line.from + a, to: line.from + b, inner, marked: target === `${mark}${inner}${mark}` && inner !== "" }];
  });
}

/** Bold or italic on the selection, or off when it's all that already. Null when nothing here can take a mark. */
export function markEdit(value: string, start: number, end: number, mark: Mark): BoxEdit | null {
  const lines = linesIn(value, start, end);
  const parts = partsOf(lines, start, end, mark);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return null;
  const off = parts.every((p) => p.marked);
  const written = (p: Part): string => (off ? p.inner : `${mark}${p.inner}${mark}`);
  let insert = "";
  let at = first.from;
  for (const p of parts) {
    insert += value.slice(at, p.from) + written(p);
    at = p.to;
  }
  const lead = off ? 0 : mark.length;
  if (lines.length === 1) {
    const inner = first.from + lead;
    if (start !== end && value.slice(start, end).trim() !== "") return { from: first.from, to: last.to, insert, start: inner, end: inner + first.inner.length };
    const caret = Math.max(Math.min(start, first.to), first.from) - first.from; // a caret stays one, so the next key adds to the word instead of replacing it
    const at = inner + landing(value.slice(first.from, first.to), caret, unmarked);
    return { from: first.from, to: last.to, insert, start: at, end: at };
  }
  const grown = insert.length - (last.to - first.from);
  return { from: first.from, to: last.to, insert, start: Math.min(start, first.from), end: Math.max(end + grown, first.from + insert.length) };
}

/** `# ` or `## ` on each selected line, off when they all have it. Marks go, as they'd print as typed in a heading. */
export function lineStyleEdit(value: string, start: number, end: number, prefix: "# " | "## "): BoxEdit {
  const lines = linesIn(value, start, end);
  const single = lines.length === 1;
  const styled = lines.filter((l) => single || l.text.trim() !== "");
  const mine = prefix.trimEnd();
  const off = styled.every((l) => PREFIX.exec(l.text)?.[1] === mine);
  const written = lines.map((l) => {
    if (!single && l.text.trim() === "") return l.text;
    const content = unmarked(PREFIX.exec(l.text)?.[2] ?? l.text).trim();
    return off ? content : `${prefix}${content}`;
  });
  const from = lines[0]?.from ?? 0;
  const to = lines[lines.length - 1]?.to ?? 0;
  const insert = written.join("\n");
  const line = lines[0];
  if (!single || !line) return { from, to, insert, start: from, end: from + insert.length };
  // On one line a caret or selection stays where it was among the words, so typing goes on after pressing Heading.
  const words = PREFIX.exec(line.text)?.[2] ?? line.text;
  const skipped = line.text.length - words.length;
  const place = (at: number): number => from + (off ? 0 : prefix.length) + Math.min(Math.max(landing(words, Math.max(at - from - skipped, 0), (t) => unmarked(t).trim()), 0), insert.length);
  return { from, to, insert, start: place(start), end: place(end) };
}
