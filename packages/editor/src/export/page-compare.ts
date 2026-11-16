import type { Document, Level, SheetSplit } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ExportPage } from "../ports/effects";
import { presentationStyle } from "../view/picture";
import type { Primitive } from "../view/scene-types";
import { text } from "./column";
import { INK, edge, frame, planInBox, titleTag, type PageParts } from "./page-plan";
import { FRAME_INSET_MM, type Rect, type Size } from "./paper";
import { wrapText } from "./wrap";

// A compare sheet's page (sheetset.11, .12): equal panes filling the drawing area, sharing their edges, one scale and one
// framing for all, so they stay comparable. Each pane has its name in a band at its top; its plan is centred in, and
// clipped to, what's under the band. In paper millimetres, y up.
//
//   side by side           stacked
//   +-------+-------+      +---------------+
//   |  DAY  | NIGHT |      |      DAY      |  <- band
//   |  plan |  plan |      |      plan     |
//   |       |       |      +---------------+
//   |       |       |      |     NIGHT     |
//   | TITLE |       |      | TITLE  plan   |
//   +-------+-------+      +---------------+

export type PaneSplit = Exclude<SheetSplit, "auto">;
export type CompareOnPage = { panes: readonly { layout: string; level: Level; name: string }[]; split: PaneSplit; title: string; scale: number; framing: Point; finishes: boolean; marks: boolean };

const NAME_SIZE = 5;
const BAND_MM = 9;
const NAME_PAD = 2; // a name's clearance from its pane's sides

const paneSize = (area: Size, count: number, split: PaneSplit): Size => (split === "stacked" ? { w: area.w, h: area.h / count } : { w: area.w / count, h: area.h });

/** What a pane's plan is centred in: the pane under its name. The fit test's frame. */
export function paneFrame(area: Size, count: number, split: PaneSplit): Size {
  const { w, h } = paneSize(area, count, split);
  return { w, h: h - BAND_MM };
}

/** Which split the sheet asks for; Automatic is whichever draws `drawn` largest, stacked on a tie, as a long plan is the common case. */
export function chooseSplit(asked: SheetSplit, drawn: Size, area: Size, count: number): PaneSplit {
  if (asked !== "auto") return asked;
  const room = (split: PaneSplit): number => {
    const { w, h } = paneFrame(area, count, split);
    return Math.min((w - 2 * FRAME_INSET_MM) / drawn.w, (h - 2 * FRAME_INSET_MM) / drawn.h);
  };
  return room("stacked") >= room("sideBySide") ? "stacked" : "sideBySide";
}

/** The pane at this place, the first on top or on the left. */
function paneRect(area: Rect, count: number, split: PaneSplit, i: number): Rect {
  const { w, h } = paneSize(area, count, split);
  return split === "stacked" ? { x: area.x, y: area.y + area.h - (i + 1) * h, w, h } : { x: area.x + i * w, y: area.y, w, h };
}

/** One segment at each edge two panes share. */
function seams(area: Rect, panes: readonly Rect[], split: PaneSplit): Primitive[] {
  return panes.slice(1).map((p) => (split === "stacked" ? edge({ x: area.x, y: p.y + p.h }, { x: area.x + area.w, y: p.y + p.h }) : edge({ x: p.x, y: area.y }, { x: p.x, y: area.y + area.h })));
}

function paneName(name: string, pane: Rect): Primitive[] {
  const [line] = wrapText(name.toUpperCase(), NAME_SIZE, pane.w - 2 * NAME_PAD, 1, "bold");
  return line ? [text(line, pane.x + pane.w / 2, pane.y + pane.h - BAND_MM / 2, NAME_SIZE, INK, "center", "bold")] : [];
}

/**
 * A framed page of panes, each drawn by `draw` in the box under its band (a plan here, a section on its own page). The
 * title and scale print once, at the area's bottom left, over any seam they reach.
 */
export function panesPage<P extends { name: string }>(
  doc: Document,
  parts: PageParts,
  c: { panes: readonly P[]; split: PaneSplit; title: string; scale: number },
  titleBlock: readonly Primitive[],
  draw: (pane: P, box: Rect) => readonly Primitive[],
): ExportPage {
  const { area } = parts;
  const panes = c.panes.map((pane, i) => {
    const rect = paneRect(area, c.panes.length, c.split, i);
    const box = { ...rect, h: rect.h - BAND_MM };
    return { rect, box, name: paneName(pane.name, rect), picture: draw(pane, box) };
  });
  let at = 0;
  const clips = panes.map(({ box, picture }) => {
    const from = at;
    at += picture.length;
    return { rect: box, from, to: at };
  });
  return {
    widthMm: parts.page.w,
    heightMm: parts.page.h,
    primitives: [...panes.flatMap((p) => p.picture), ...panes.flatMap((p) => p.name), ...seams(area, panes.map((p) => p.rect), c.split), ...titleTag(c.title, c.scale, area, presentationStyle(doc).accent), ...frame(parts), ...titleBlock],
    clips,
  };
}

/** A compare sheet's page: its panes are plans at one scale and one framing. */
export function comparePage(doc: Document, parts: PageParts, c: CompareOnPage, titleBlock: readonly Primitive[]): ExportPage {
  return panesPage(doc, parts, c, titleBlock, (pane, box) => planInBox(doc, { ...pane, scale: c.scale, framing: c.framing, finishes: c.finishes, marks: c.marks }, box));
}
