import { UNDERLAY_ID, orderedStates, underlayRect, type Box, type Document, shown } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { lookRulers } from "./look-rulers";
import { markedBounds, planPicture } from "./picture";
import { LOOK_STYLE } from "./plan-style";
import { floorView } from "./plan-view";
import type { Primitive } from "./scene-types";

export { LOOK_RULER } from "./look-rulers";

/** The look picture's long side in look pixels (AC-08, import.28). */
export const LOOK_LONG_SIDE = 1100;
/** The underlay's fade in look, as on the Scene: 0 full strength, 1 gone. */
export const LOOK_FADE = 0.5;
/**
 * A region's long side in metres, and how far its edges may lie from the origin. Outside these the ruler maths breaks
 * (a step past 2^53 multiples, more than 100 decimals, exponent notation), so look refuses instead.
 */
const MIN_SIDE = 0.05;
const MAX_SIDE = 100_000;
const MAX_EDGE = 1_000_000;
/** The margin around the default underlay region, as a share of its long side, so the ruler bands (about 2 % of the
 * long side each) never cover a tightly cropped plan's outer walls (import.37). */
const UNDERLAY_MARGIN = 0.04;

/** The underlay under look's primitives: `rect` is underlayRect's Box, in plan metres (export's Frame.backdrop). */
export type LookBackdrop = { data: string; rect: Box; fade: number; grey: boolean };
/** `min` to `max` in metres at `zoom` look pixels per metre; @fm/export's Frame, which the editor may not import. */
export type LookFrame = { min: Point; max: Point; zoom: number; background: string | null; backdrop?: LookBackdrop };
export type LookPicture = { primitives: Primitive[]; frame: LookFrame; caption: string };

/**
 * What Claude's `look` shows (import.12): the drawing's decks, one layout's pieces (`layout`, default the first; mcp.03), walls, openings, room names, dimension lines and section marks in LOOK_STYLE
 * over a light grid, with labelled metre rulers on top, framed on `region` (default: the underlay's rect with a margin, else the
 * drawing's bounds) with its long side LOOK_LONG_SIDE look pixels; the underlay is the frame's grey, faded backdrop.
 * Shells only translate it (export.17). Refused with nothing to show, or for a region (given or default) without
 * finite edges within MAX_EDGE, min below max, a long side from MIN_SIDE to MAX_SIDE, and a short side of at least one
 * look pixel.
 */
export function lookPicture(doc: Document, region: Box | null, layout?: string): LookPicture | { refused: string } {
  const row = doc.underlays[UNDERLAY_ID];
  const drawn = [doc.walls, doc.zoneLabels, doc.dimensions, doc.sections].some((t) => Object.keys(t).length > 0);
  if (!row && !drawn) return { refused: "Nothing to look at yet: import a plan picture or draw some walls" };
  const rect = underlayRect(doc);
  const bounds = markedBounds(doc, null); // its margin is already included
  const r = region ?? (rect ? withMargin(rect) : null) ?? { minX: bounds.min.x, minY: bounds.min.y, maxX: bounds.max.x, maxY: bounds.max.y };
  if (!lookable(r)) {
    if (region) {
      return {
        refused:
          `The region needs finite edges with min below max, within ${MAX_EDGE} m of the origin, a long side from ` +
          `${MIN_SIDE} m to ${MAX_SIDE} m, and a short side at least 1/${LOOK_LONG_SIDE} of its long side`,
      };
    }
    return { refused: rect ? "The underlay is too small or too large to look at: scale it again" : "The drawing is too large to look at: pass a region" };
  }
  // One SVG unit is one look pixel, so px strokes and text sizes are look pixels.
  const zoom = LOOK_LONG_SIDE / Math.max(r.maxX - r.minX, r.maxY - r.minY);
  // One layout's pieces, stairs among them (mcp.03, in place of import.07's none); decks belong to every layout (decks.07).
  const shown = layout !== undefined && Object.hasOwn(doc.states, layout) ? doc.states[layout] : orderedStates(doc)[0];
  const plan = planPicture(doc, floorView(doc, shown?.id ?? null), LOOK_STYLE, zoom, false); // LOOK_STYLE draws no floors (finishes.10)
  const { grid, rulers } = lookRulers(r, zoom);
  const frame: LookFrame = { min: { x: r.minX, y: r.minY }, max: { x: r.maxX, y: r.maxY }, zoom, background: "#ffffff" };
  if (row && rect) frame.backdrop = { data: row.data, rect, fade: LOOK_FADE, grey: true };
  return {
    primitives: [...grid, ...plan.ghosts, ...plan.decks, ...plan.objects, ...plan.overheads, ...plan.walls, ...plan.openings, ...plan.deckLabels, ...plan.tags, ...plan.dimensions, ...plan.marks, ...rulers],
    frame,
    caption: caption(r, zoom, row ? !row.scaled : false, Object.keys(doc.objects).length > 0 ? shown?.name ?? null : null),
  };
}

function withMargin(r: Box): Box {
  const m = UNDERLAY_MARGIN * Math.max(r.maxX - r.minX, r.maxY - r.minY);
  return { minX: r.minX - m, minY: r.minY - m, maxX: r.maxX + m, maxY: r.maxY + m };
}

function lookable(r: Box): boolean {
  const edges = [r.minX, r.minY, r.maxX, r.maxY];
  if (!edges.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_EDGE) || !(r.minX < r.maxX && r.minY < r.maxY)) return false;
  const long = Math.max(r.maxX - r.minX, r.maxY - r.minY);
  // A short side under one look pixel leaves the rasteriser nothing to draw.
  const short = Math.min(r.maxX - r.minX, r.maxY - r.minY);
  return long >= MIN_SIDE && long <= MAX_SIDE && short * (LOOK_LONG_SIDE / long) >= 1;
}

/**
 * `[UNSCALED · ]region x A to B m, y C to D m · M m per look pixel · y up[ · layout Name]`, the layout's name while the
 * drawing has pieces; the MCP shell copies it verbatim.
 */
function caption(r: Box, zoom: number, unscaled: boolean, layoutName: string | null): string {
  const m = (v: number): string => shown(v); // never "-0.00"
  const region = `region x ${m(r.minX)} to ${m(r.maxX)} m, y ${m(r.minY)} to ${m(r.maxY)} m`;
  return `${unscaled ? "UNSCALED · " : ""}${region} · ${(1 / zoom).toPrecision(3)} m per look pixel · y up${layoutName === null ? "" : ` · layout ${layoutName}`}`;
}
