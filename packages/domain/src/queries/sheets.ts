import { memo } from "../memo";
import { flatDrawings, type Document, type Sheet, type SheetDrawing } from "../model";
import { cutName } from "../shape";
import { isFloor, levelOf, levels, shownAt, type Level } from "./levels";
import { orderedStates } from "./states";

// The one owner of the sheet list (sheetset.02): nothing else reads the sheets table to list it, a lint rule outside the
// domain. No rows means the automatic list, worked out and never stored until the first edit to it.

/** A drawing's name: its layout's, plus its level's at a loft. Cut to fit a title, so a first edit never refuses a long name. */
export function drawingTitle(doc: Document, drawing: SheetDrawing): string {
  const layout = doc.states[drawing.layout]?.name ?? "";
  const level = levelOf(doc, drawing.deck);
  return cutName(isFloor(level) ? layout : [layout, level.name].filter((n) => n !== "").join(" · "));
}

/**
 * Whether the level shows, in this layout, pieces standing on it. `shownAt` alone would also count a tall piece from the
 * floor and a stair reaching the level, which is in every layout, so a loft furnished in one layout would print in all.
 */
function hasOwnPieces(doc: Document, layout: string, level: Level): boolean {
  return Object.values(doc.placements).some((p) => p.state === layout && p.deck !== null && level.deckIds.includes(p.deck) && shownAt(doc, p.id, level));
}

/** One plan per layout at the floor, then per loft showing pieces of its own. IDs by place, as layout and deck IDs together can pass the ID limit. */
export function automaticSheets(doc: Document): Sheet[] {
  const drawings = orderedStates(doc).flatMap((state): SheetDrawing[] => [
    { layout: state.id, deck: null },
    ...levels(doc)
      .filter((level) => !isFloor(level) && hasOwnPieces(doc, state.id, level))
      .map((level) => ({ layout: state.id, deck: level.deckIds[0] ?? null })),
  ]);
  return drawings.map((drawing, i): Sheet => ({
    id: `auto/${i}`, kind: "plan", order: i, inPdf: true, title: drawingTitle(doc, drawing), scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings([drawing]), text: "", size: "normal", section: null,
  }));
}

/** Whether the list is still worked out, with nothing stored: its IDs go by place until the first edit stores them. */
export function sheetListIsAutomatic(doc: Document): boolean {
  return Object.keys(doc.sheets).length === 0;
}

const listed = memo((doc: Document): readonly Sheet[] => {
  const rows = Object.values(doc.sheets).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows.length > 0 ? rows : automaticSheets(doc);
});

/** The list: stored rows by order then ID, else the automatic list. Shared by every caller, so read-only. */
export function sheetsOf(doc: Document): readonly Sheet[] {
  return listed(doc);
}
