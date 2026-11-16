import { deckView, sectionSheetTitle, sheetsOf, type Document, type Sheet, type SheetKind } from "@fm/domain";
import type { Command } from "@fm/domain";
import { NO_DRAWING } from "./session";
import { allCreatedIn, fail, noDeck, noLayout, type ToolKit } from "./tool-kit";
import type { DrawingTools, SheetArgs } from "./tool-types";

// The PDF's sheets (sheetset; AC-15): each tool is one domain command, so its refusal reads like any edit's. A first edit
// stores every automatic sheet under the id it has, so `auto/0` stays good after it (sheetset.02). Names come before the
// domain (layout-states.54). What a kind doesn't print is refused here, as the row would hold it and nothing would show it.

type SheetTools = Pick<DrawingTools, "addSheet" | "setSheet" | "deleteSheet" | "moveSheet" | "readReport">;

const noSheet = (id: string): string => `No sheet has the id ${id}`;
const given = (...values: readonly unknown[]): boolean => values.some((v) => v !== undefined);

function misplaced(kind: SheetKind, { text, size, split, scale, framing, finishes, marks }: SheetArgs): string | null {
  if (kind !== "report" && given(text, size)) return "Only a report has text and a body size";
  if (kind !== "compare" && kind !== "section" && given(split)) return "Only a compare or section sheet has a split";
  if (kind === "section" && given(finishes, marks)) return "A section sheet has no floor finishes or section marks";
  if (kind === "report" && given(scale, framing, finishes, marks)) return "A report has no scale, framing, floor finishes or section marks";
  return null;
}

function unknownDrawing(doc: Document, { drawings = [], section }: SheetArgs): string | null {
  if (section !== undefined && !Object.hasOwn(doc.sections, section)) return `No section has the id ${section}`;
  for (const { layout, deck } of drawings) {
    if (!Object.hasOwn(doc.states, layout)) return noLayout(layout);
    if (deck !== undefined && deckView(doc, deck) === null) return noDeck(deck);
  }
  return null;
}

/** The fields given, as the sheet commands take them: a field left out stays out (exactOptionalPropertyTypes). */
function fieldsOf({ title, inPdf, scale, split, framing, finishes, marks, text, size, section }: SheetArgs) {
  return {
    ...(title === undefined ? {} : { title }),
    ...(inPdf === undefined ? {} : { inPdf }),
    ...(scale === undefined ? {} : { scale: scale === "general" ? null : scale }),
    ...(split === undefined ? {} : { split }),
    ...(framing === undefined ? {} : { cx: framing.x, cy: framing.y }),
    ...(finishes === undefined ? {} : { finishes }),
    ...(marks === undefined ? {} : { marks }),
    ...(text === undefined ? {} : { text }),
    ...(size === undefined ? {} : { size }),
    ...(section === undefined ? {} : { section }),
  };
}

const drawingsOf = (drawings: NonNullable<SheetArgs["drawings"]>) => drawings.map((d) => ({ layout: d.layout, deck: d.deck ?? null }));

export function sheetTools({ session, edit }: ToolKit): SheetTools {
  /** The sheet named, or why not. */
  const named = (id: string): { doc: Document; sheet: Sheet } | string => {
    const doc = session.drawing();
    if (doc === null) return NO_DRAWING;
    const sheet = sheetsOf(doc).find((s) => s.id === id);
    return sheet ? { doc, sheet } : noSheet(id);
  };
  return {
    async addSheet({ kind, after, ...args }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      if (after !== undefined && !sheetsOf(doc).some((s) => s.id === after)) return fail(noSheet(after));
      const problem = misplaced(kind, args) ?? unknownDrawing(doc, args);
      if (problem !== null) return fail(problem);
      const opId = session.newId();
      const command: Command = { type: "addSheet", opId, after: after ?? null, kind, drawings: drawingsOf(args.drawings ?? []), ...fieldsOf(args) };
      // A first edit puts every row too, so the new one is told by its operation.
      return edit(command, () => null, (patch) => {
        const id = allCreatedIn(patch, "sheets").find((s) => s.startsWith(`${opId}/`));
        return id === undefined ? {} : { sheet: id };
      });
    },
    async setSheet({ sheet, ...args }) {
      const found = named(sheet);
      if (typeof found === "string") return fail(found);
      const problem = misplaced(found.sheet.kind, args) ?? unknownDrawing(found.doc, args);
      if (problem !== null) return fail(problem);
      // A title still naming the section follows it, as in the panel; a title given here wins.
      const was = found.sheet.section;
      const title = args.title === undefined && args.section !== undefined && args.section !== null && was !== null && found.sheet.title === sectionSheetTitle(was) ? { title: sectionSheetTitle(args.section) } : {};
      const command: Command = { type: "setSheet", sheetId: sheet, ...fieldsOf(args), ...title, ...(args.drawings === undefined ? {} : { drawings: drawingsOf(args.drawings) }) };
      return edit(command, () => null, () => ({ sheet }));
    },
    async deleteSheet({ sheet }) {
      const found = named(sheet);
      return typeof found === "string" ? fail(found) : edit({ type: "deleteSheet", sheetId: sheet }, () => null);
    },
    async moveSheet({ sheet, index }) {
      const found = named(sheet);
      return typeof found === "string" ? fail(found) : edit({ type: "moveSheet", sheetId: sheet, index }, () => null, () => ({ sheet }));
    },
    async readReport({ sheet }) {
      const found = named(sheet);
      if (typeof found === "string") return fail(found);
      const { title, kind, text } = found.sheet;
      if (kind !== "report") return fail(`${title} (${sheet}) is a ${kind} sheet, not a report`);
      return { text: JSON.stringify({ sheet, title, length: text.length, text }), isError: false };
    },
  };
}
