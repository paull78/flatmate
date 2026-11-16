import { armsFor, kindOf, outlineOf, rotateAbout, type Arms, type ObjectOptions } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { isAggregate } from "./aggregate";
import type { Primitive } from "./scene-types";
import { fillRings, pieceRing, shapedFills, shapeFront } from "./shapes";
import { BASIC } from "./symbols/basic";
import { HUNG } from "./symbols/hung";
import { BATHROOM } from "./symbols/bathroom";
import { CORNERS } from "./symbols/corners";
import { KITCHEN } from "./symbols/kitchen";
import { CANOPIES, PLANTS } from "./symbols/plants";
import { inner, ringSegments, type Parts, type SymbolTable } from "./symbols/lines";
import { SETS } from "./symbols/sets";
import { SIT_AND_EAT } from "./symbols/sit-and-eat";
import { SLEEP } from "./symbols/sleep";
import { STAIRS } from "./symbols/stairs";
import { STORAGE } from "./symbols/storage";

export { placeSymbol } from "./symbols/lines";
export { sofaSeats } from "./piece-counts";
export { bedPillows } from "./piece-counts";

// Plan symbols for furniture (ux-polish, AC-07). A symbol is drawn in footprint space: x from −w/2 to w/2, y from
// −d to 0, the back edge at y = 0 and the front edge at y = −d, as a placement before rotation (see `footprints`).
// The outline is the kind's shape (shapes.ts), the rectangle for most kinds; an aggregate's is its parts' (symbols/sets.ts).
// Every point stays inside that rectangle: arcs keep centre ± radius inside, and details scale with w and d.
// Lines are 1 px in the object edge colour; callers recolour and resize them (`objectLook`).

// Each palette group's symbols live in `symbols/<group>.ts`, merged here in palette-group order.
const SYMBOLS: SymbolTable = new Map([...SLEEP, ...SIT_AND_EAT, ...SETS, ...CORNERS, ...KITCHEN, ...BATHROOM, ...STORAGE, ...BASIC, ...HUNG, ...PLANTS, ...STAIRS]);

/**
 * The plan symbol of a kind in a configuration at size w × d, in footprint space (see above): the outline and the
 * kind's inner detail, with what the object's `options` add (a desk's computer, library.10), an `L` with its `arms`
 * (catalog.17; the kind's default without). The canvas and the palette draw through `objectLook` and `tileLook`; the
 * symbol tests compare kinds with this. An unknown kind is an outline.
 */
export function furnitureSymbol(kind: string, config: string, w: number, d: number, options: ObjectOptions = {}, arms?: Arms): Primitive[] {
  const { outline, inner } = symbolParts(kind, config, w, d, options, arms);
  return [...outline, ...inner];
}

/** The symbol split by line style: the outline (the object line) and the inner detail (lighter); an aggregate's outline is its parts'. */
function symbolParts(kind: string, config: string, w: number, d: number, options: ObjectOptions, arms?: Arms): { outline: Primitive[]; inner: Primitive[] } {
  const parts = detail(kind, config, w, d, options, arms);
  const ring = isAggregate(kind) || CANOPIES.has(kind) ? [] : ringSegments(pieceRing(kind, w, d, options, arms));
  return { outline: [...ring, ...parts.line], inner: parts.detail };
}

/** A kind's own lines in a configuration; none for the folded table (a shelf against the wall) or a kind without a symbol. */
function detail(kind: string, config: string, w: number, d: number, options: ObjectOptions, arms?: Arms): Parts {
  return SYMBOLS.get(`${kind}.${config}`)?.(w, d, kind, options, arms) ?? inner([]);
}

/**
 * An object's look in footprint space (x from −w/2 to w/2, y from −d to 0, as `furnitureSymbol`): its fill (the kind's
 * shape, or an aggregate's parts) when given, the outline in the line colour and width, the inner detail in the detail
 * colour and width (the line's when not given), and the heavier front edge along the shape's front (the side a person
 * uses) in the line colour, last; an aggregate has none (seating.15), nor a kind whose `front` column says so (catalog.54). `options` and `arms` are the object's (a desk's
 * computer, an `L`'s arms); a palette tile and a ghost pass none. The canvas places it; the palette tile draws it as is
 * (arch-review R-03, ux-polish.05).
 */
export function objectLook(
  kind: string,
  config: string,
  w: number,
  d: number,
  look: { fill?: string; line: string; frontPx: number; linePx?: number; detail?: string; detailPx?: number },
  options: ObjectOptions = {},
  arms?: Arms,
): Primitive[] {
  const edge = isAggregate(kind) || kindOf(kind)?.front === false || options.roundChairs === true ? [] : shapeFront(outlineOf(kind), w, d, armsFor(kind, w, d, arms));
  const front = edge.slice(1).flatMap((b, i): Primitive[] => {
    const a = edge[i];
    return a ? [{ kind: "segment", a, b, width: { px: look.frontPx }, color: look.line, cap: "butt" }] : [];
  });
  const { outline, inner } = symbolParts(kind, config, w, d, options, arms);
  const detailPx = look.detailPx ?? look.linePx;
  const lines = [
    ...recolor(look.linePx === undefined ? outline : rewidth(outline, look.linePx), look.line),
    ...recolor(detailPx === undefined ? inner : rewidth(inner, detailPx), look.detail ?? look.line),
    ...front,
  ];
  const { fill } = look;
  return fill === undefined ? lines : [...restRings(kind, w, d, options, arms).map((points): Primitive => ({ kind: "polygon", points, holes: [], color: fill })), ...lines];
}

/** What a piece fills at rest, in footprint space: a plant's canopy (symbols.19), any other kind's shape. */
export function restRings(kind: string, w: number, d: number, options: ObjectOptions = {}, arms?: Arms): Point[][] {
  const canopy = CANOPIES.get(kind);
  return canopy ? [canopy(w, d)] : fillRings(kind, w, d, options, arms);
}

/** What a piece fills at rest, in the world: `shapedFills`, but a plant's canopy. Selected, ghosted or refused, a piece fills `shapedFills`. */
export function restFills(kind: string, w: number, d: number, at: Point, rotation: number, rectangle: readonly Point[], options: ObjectOptions = {}, arms?: Arms): readonly (readonly Point[])[] {
  const canopy = CANOPIES.get(kind);
  return canopy ? [canopy(w, d).map((p) => rotateAbout({ x: p.x + at.x, y: p.y + at.y }, at, rotation))] : shapedFills(kind, w, d, at, rotation, rectangle, options, arms);
}

/** The symbol's hairlines at another width (a plan style's, export.11); world-scaled widths stay. */
function rewidth(primitives: readonly Primitive[], px: number): Primitive[] {
  return primitives.map((p) => ((p.kind === "segment" || p.kind === "arc") && "px" in p.width ? { ...p, width: { px } } : p));
}

/** The same primitives in another colour. */
function recolor(primitives: readonly Primitive[], color: string): Primitive[] {
  return primitives.map((p) => ({ ...p, color }));
}
