import { reportFirstLine, sheetFacts } from "@fm/editor";
import { sheetDrawings, sheetsOf, type Document, type SheetKind, type SheetSize, type SheetSplit } from "@fm/domain";

// A sheet in get_drawing and every edit's reply (sheetset; sheetset.21): what it prints, from the editor's sheetFacts, and
// its stored fields, from the domain's sheetsOf. A report gives its length and first line, never its text: read_report does.

const FIRST_LINE = 80; // characters: a report with no line break would otherwise repeat itself in every reply

export type SheetLine = {
  id: string; kind: SheetKind; title: string; inPdf: boolean; number: number | null; pages: number; scale: number | null; ownScale: boolean; partOfPlan: boolean;
  drawings?: { layout: string; deck?: string }[];
  framing?: [number, number];
  finishes?: boolean;
  marks?: boolean;
  split?: SheetSplit; // a compare or section sheet's
  section?: string; // a section sheet's letter
  report?: { length: number; firstLine: string; size: SheetSize };
};

function firstLineOf(text: string): string {
  const line = reportFirstLine(text);
  const cut = Array.from(line).slice(0, FIRST_LINE).join(""); // whole characters, so a cut never splits one
  return cut.length < line.length ? `${cut}…` : line;
}

export function sheetLines(doc: Document): SheetLine[] {
  const facts = new Map(sheetFacts(doc).map((f) => [f.id, f]));
  return sheetsOf(doc).map((s): SheetLine => {
    const fact = facts.get(s.id);
    const printed = { id: s.id, kind: s.kind, title: s.title, inPdf: s.inPdf, number: fact?.number ?? null, pages: fact?.pages ?? 1, scale: fact?.scale ?? null, ownScale: s.scale !== null, partOfPlan: fact?.partOfPlan ?? false };
    if (s.kind === "report") return { ...printed, report: { length: s.text.length, firstLine: firstLineOf(s.text), size: s.size } };
    return {
      ...printed,
      drawings: sheetDrawings(s).map((d) => ({ layout: d.layout, ...(d.deck === null ? {} : { deck: d.deck }) })),
      framing: [Number(s.cx.toFixed(3)), Number(s.cy.toFixed(3))],
      ...(s.kind === "section" ? {} : { finishes: s.finishes, marks: s.marks }),
      ...(s.kind === "compare" || s.kind === "section" ? { split: s.split } : {}),
      ...(s.section === null ? {} : { section: s.section }),
    };
  });
}
