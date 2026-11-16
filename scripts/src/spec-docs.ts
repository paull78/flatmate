// The checks on docs/specs/, the spec as a folder of short documents by topic. They keep its shape: every file in the
// index, each document short, no marks of a history, and an "At levels" section in every feature's document.

export interface SpecDoc {
  name: string;
  text: string;
}

/** A document is read whole by a person or an agent, so it stays short; the folder stays readable in a sitting. */
export const MAX_DOC_BYTES = 30_000;
export const MAX_FOLDER_BYTES = 500_000;

/** Documents about no feature of a home, which have nothing to say at levels, and the levels document, which is the rule. */
export const NO_LEVELS: readonly string[] = ["levels.md", "overview.md", "domain.md", "editor.md", "typed-input.md", "rendering.md", "underlay.md", "collaboration.md", "mcp.md", "samples.md", "cards.md", "roadmap.md"];

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Files the index doesn't list, and index lines (`- [name.md](name.md) · …`) without a file. */
export function indexProblems(index: string, names: readonly string[]): string[] {
  const listed = [...index.matchAll(/^- \[([^\]]+)\]\(\1\) · \S/gm)].map((m) => m[1] ?? "");
  return [
    ...names.filter((n) => !listed.includes(n)).map((n) => `${n} is not in the index`),
    ...listed.filter((n) => !names.includes(n)).map((n) => `the index lists ${n}, which is not there`),
  ];
}

export function sizeProblems(docs: readonly SpecDoc[]): string[] {
  const out = docs.filter((d) => bytes(d.text) > MAX_DOC_BYTES).map((d) => `${d.name} is ${bytes(d.text)} bytes, over ${MAX_DOC_BYTES}`);
  const total = docs.reduce((sum, d) => sum + bytes(d.text), 0);
  if (out.length === 0 && total > MAX_FOLDER_BYTES) out.push(`the folder is ${total} bytes, over ${MAX_FOLDER_BYTES}`);
  return out;
}

/** What a document of current truth never holds: how and when a rule came to be, and whose house showed it. */
const HISTORY: readonly (readonly [string, RegExp])[] = [
  ["a cycle's name", /\(cycles? [a-z0-9-]+/g],
  ["a memory ID", /\b[a-z][a-z0-9-]{2,}\.\d{2}\b/g],
  ["an acceptance ID", /\bAC-\d+/g],
  ["a date", /\b20\d{2}-\d{2}-\d{2}\b/g],
  ["a section number", /§ ?\d+/g],
  ["the user's house", /\bmy home\b/gi],
];

export function historyProblems(doc: SpecDoc): string[] {
  return doc.text.split("\n").flatMap((line, i) => HISTORY.flatMap(([what, pattern]) => [...line.matchAll(pattern)].map((m) => `${doc.name}:${i + 1} ${what}: ${m[0]}`)));
}

/** Documents outside NO_LEVELS without a `## At levels` section holding text; a heading inside a code block is text. */
export function levelsProblems(docs: readonly SpecDoc[]): string[] {
  const out: string[] = [];
  for (const doc of docs) {
    if (NO_LEVELS.includes(doc.name)) continue;
    let fenced = false;
    let inside = false;
    let found = false;
    let filled = false;
    for (const line of doc.text.split("\n")) {
      if (line.startsWith("```")) fenced = !fenced;
      if (!fenced && line.startsWith("## ")) {
        inside = /^## At levels\s*$/.test(line);
        found ||= inside;
      } else if (inside && line.trim() !== "") filled = true;
    }
    if (!found) out.push(`${doc.name} has no At levels section`);
    else if (!filled) out.push(`${doc.name} has an empty At levels section`);
  }
  return out;
}

/** Every problem of the folder: `index` is README.md's text, `docs` every other file in it. */
export function specProblems(index: string, docs: readonly SpecDoc[]): string[] {
  return [...indexProblems(index, docs.map((d) => d.name)), ...sizeProblems(docs), ...docs.flatMap(historyProblems), ...historyProblems({ name: "README.md", text: index }), ...levelsProblems(docs)];
}
