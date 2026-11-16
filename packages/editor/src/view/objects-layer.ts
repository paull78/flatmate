import {
  coveredWell, fitParts, footprintQuad, footprints, isRug, isSeat, isWell, kindOf, placementWellPart, placementRange, quadCentre, reachesLevel, relationAt, shownAt, sortedIds, stackOrder, stairRuleOf,
  type Arms, type Document, type Level, type ObjectOptions, type Placement, type Range, type Stacked,
} from "@fm/domain";
import type { Point } from "@fm/protocol";
import { clipOutside, isConvexRing } from "./clip";
import { COLORS } from "./colors";
import { flipPoses, type Flip } from "./flip-poses";
import { objectLook, placeSymbol, restFills } from "./furniture";
import { idsOf, memoLast } from "./memo";
import { CANVAS_STYLE, pieceFill, type PlanStyle } from "./plan-style";
import type { PlanView } from "./plan-view";
import { ringEdges } from "./rings";
import type { Primitive } from "./scene-types";
import { objectArms, shapedFill, shapedFills } from "./shapes";
import { stairGhostPlan, stairPlan } from "./stair-plan";
import { shownWarnings } from "./warnings";

const NAME_MIN_PX = 40; // a selected object's name shows once its smaller side is this wide on screen
/** What draws its hidden line when another piece wholly covers it: a seat (pieces.14) and a wheel well (trailer.10). */
const hidesUnder = (kind: string): boolean => isSeat(kind) || isWell(kind);

/**
 * A placement's plan symbol in the world, in one line colour, with the heavier front edge (the side a person uses;
 * the footprint's first edge). Nothing when its object or configuration is missing.
 */
export function placedSymbol(doc: Document, p: Placement, color: string, style: PlanStyle = CANVAS_STYLE): Primitive[] {
  const object = doc.objects[p.object];
  const w = object?.w[p.config];
  const d = object?.d[p.config];
  if (!object || w === undefined || d === undefined) return [];
  return symbolAt(object.kind, p.config, w, d, p.at, p.rotation, color, style, object.options, objectArms(object));
}

/**
 * The Object tool's ghost (ux-polish item 1): the kind's shape and symbol, see-through, or red where it would not fit.
 * Red or not it fills its shape, the one fit checks (shapefit.01). A ghost wholly above the cut (`above`: on a loft,
 * decks.11) is its shape's outline dashed, as the plan draws the piece it places (heights.15).
 */
export function ghostPrimitives(
  g: { kind: string; config: string; w: number; d: number; at: Point; rotation: number; fits: boolean; h?: number; base?: number; left?: true },
  above = false,
  style: PlanStyle = CANVAS_STYLE, // the picture's pieces: the ghost's fill follows it (seating.02)
): Primitive[] {
  const quad = footprintQuad(g.at, g.w, g.d, g.rotation);
  const line = g.fits ? COLORS.ghostEdge : COLORS.invalid;
  if (above) return dashedRing(shapedFill(g.kind, g.w, g.d, g.at, g.rotation, quad), line, style);
  const color = g.fits ? style.objectGhost : COLORS.invalidFill;
  // A stair on a caught edge: its plan, fill included, at the rise it will get (stairdraw.11), from its base up.
  if (g.h !== undefined) return stairGhostPlan(g.kind, g.w, g.d, g.h - (g.base ?? 0), g.at, g.rotation, line, color, style, g.left === true);
  return [...polygons(shapedFills(g.kind, g.w, g.d, g.at, g.rotation, quad), color), ...symbolAt(g.kind, g.config, g.w, g.d, g.at, g.rotation, line, style)];
}

/** Whether a ghost's range lies wholly above the `level`'s cut. */
export function ghostAbove(level: Level, g: { range: Range }): boolean {
  return relationAt(g.range, level) === "above";
}

/**
 * A kind's plan symbol for a w × d footprint at `at`: placements, the ghost and a refused resize. In the style's own
 * line colour its inner detail is the style's lighter detail line; any other colour (selected, ghost, refused) is one.
 * `options` and `arms` are the object's (a desk's computer, library.10; an `L`'s arms); a ghost of a new piece has none.
 */
export function symbolAt(
  kind: string, config: string, w: number, d: number, at: Point, rotation: number, color: string, style: PlanStyle = CANVAS_STYLE, options: ObjectOptions = {}, arms?: Arms,
): Primitive[] {
  const detail = color === style.objectLine ? { detail: style.objectDetail, detailPx: style.objectDetailWidth } : {};
  return placeSymbol(objectLook(kind, config, w, d, { line: color, frontPx: style.objectFront, linePx: style.objectLineWidth, ...detail }, options, arms), at, rotation);
}

/**
 * The view's layout's placements (spec: layouts): the fill of the kind's shape (an aggregate's parts) and its plan symbol
 * (outline, detail and a heavier front edge), in a plan style; a piece wholly above the view's cut is its shape's outline dashed, with no fill and no
 * symbol (heights.15); a piece the level doesn't show (the domain's `shownAt`: under the level, or on a higher level's
 * deck) is not drawn (levels.04, shown.01). Pieces draw
 * in the stacking order, lowest bottom first, so dashed ones land on top (heights.38), a seat before the table at its
 * bottom and a rug before everything (catalog.15). A piece's lines are clipped to outside every filled piece drawn after it: a chair's by the
 * table it tucks under (seating.10), a rug's by what stands on it, anything's by a piece raised over it; selected, their lines are whole and
 * come after every piece, over those fills.
 * A selected piece fills its shape too, the one fit checks (shapefit.01). Only selected placements show their names
 * (ux-polish.06), once large enough on screen. The texts (stair labels, names) come after every piece, so Canvas2D and
 * the exports draw them on top, as WebGL's text overlay does (stairwell.37). Reused while its arguments are equal.
 */
export const objectsLayer = memoLast((doc: Document, view: PlanView, style: PlanStyle, selected: string, zoom: number): readonly Primitive[] => {
  const { layout: state, level } = view;
  if (state === null) return [];
  const picked = idsOf(selected);
  const quads = footprints(doc);
  const stacked: Stacked[] = [];
  for (const id of sortedIds(doc.placements)) {
    const range = placementRange(doc, id);
    const p = doc.placements[id];
    const kind = p ? (doc.objects[p.object]?.kind ?? "") : "";
    // The level's rule (shown.02): a stair shows at the level it reaches too, whole (stairs.02); a piece under the level
    // (levels.04) or standing on a higher level (a loft's, at the floor) is hidden.
    if (range && p?.state === state && shownAt(doc, id, level)) stacked.push({ id, range, stair: stairRuleOf(kind) !== null, seat: hidesUnder(kind), rug: isRug(kind) });
  }
  const dashed = (p: Placement, range: Range): boolean => relationAt(range, level) === "above" && !reachesLevel(doc, p.object, level);
  // What lies above the cut draws last, dashed: a cupboard over a flight's low steps stays on top of the steps' fill (riser.08).
  const isDashed = ({ id, range }: Stacked): boolean => {
    const p = doc.placements[id];
    return p !== undefined && dashed(p, range);
  };
  stacked.sort((a, b) => Number(isDashed(a)) - Number(isDashed(b)) || stackOrder(a, b));
  const filled = new Set(stacked.flatMap(({ id, range }) => { const p = doc.placements[id]; return p && !dashed(p, range) ? [id] : []; }));
  const clips = laterFillClips(doc, stacked, filled, view, style);
  const out: Primitive[] = [];
  const lifted: Primitive[] = []; // a selected piece's lines where a later fill covers it, over every piece (seating.10)
  const hidden: Primitive[] = []; // a seat wholly under what it tucks under, dashed over every piece's fill (pieces.14)
  const labels: Primitive[] = []; // over every piece, as WebGL's text overlay draws them (stairwell.37)
  for (const { id, range } of stacked) {
    const p = doc.placements[id];
    const quad = quads.get(id);
    if (!p || !quad) continue;
    const isPicked = picked.has(id);
    const stair = stairRuleOf(doc.objects[p.object]?.kind ?? "") !== null;
    if (dashed(p, range)) {
      out.push(...dashedRing(placedFill(doc, p, quad), isPicked ? COLORS.wallSelected : style.objectLine, style));
    } else if (stair) {
      const plan = stairPlan(doc, p, view, range, isPicked ? COLORS.wallSelected : style.objectLine, isPicked ? COLORS.objectSelected : style.objectFill, style);
      labels.push(...plan.filter((q) => q.kind === "text"));
      const rest = plan.filter((q) => q.kind !== "text");
      const rings = clips.get(id);
      if (!rings) out.push(...rest);
      else if (isPicked) {
        out.push(...rest.filter((q) => q.kind === "polygon"));
        lifted.push(...rest.filter((q) => q.kind !== "polygon"));
      } else out.push(...clipOutside(rest, rings));
    } else {
      out.push(...polygons(placedFills(doc, p, quad, isPicked ? shapedFills : restFills), isPicked ? COLORS.objectSelected : pieceFill(style, doc.objects[p.object]?.kind ?? "")));
      const lines = placedSymbol(doc, p, isPicked ? COLORS.wallSelected : style.objectLine, style);
      const rings = clips.get(id);
      const shown = rings && !isPicked ? clipOutside(lines, rings) : lines;
      const well = placementWellPart(doc, id);
      if (well && !isPicked && coveredWell(doc, id, well)) hidden.push(...hiddenRing(placedFill(doc, p, quad), style.objectLine, style)); // covered, as the domain's rule says (trailer.10)
      else if (!rings) out.push(...lines);
      else if (isPicked) lifted.push(...lines);
      else if (shown.length === 0 && hidesUnder(doc.objects[p.object]?.kind ?? "")) hidden.push(...hiddenRing(placedFill(doc, p, quad), style.objectLine, style)); // a stool or a wheel well wholly under: its hidden line (pieces.14, trailer.10)
      else out.push(...shown);
    }
    const object = doc.objects[p.object];
    const [q0, q1, q2] = quad;
    if (isPicked && !stair && object && q0 && q1 && q2) { // a stair has its label, and a name would run across its treads
      const side = Math.min(Math.hypot(q1.x - q0.x, q1.y - q0.y), Math.hypot(q2.x - q1.x, q2.y - q1.y)) * zoom;
      const centre = quadCentre(quad); // `at` is the back edge (layout-states.49): the name goes in the middle
      if (side >= NAME_MIN_PX && centre) labels.push({ kind: "text", text: object.name, at: centre, size: style.objectName, color: style.tag.text, align: "center", rotation: 0, font: style.font });
    }
  }
  return [...out, ...hidden, ...lifted, ...labels];
});

/**
 * Each filled piece's clip: the fills drawn after it that cross it, as convex rings. Canvas2D paints a later fill over a
 * piece's lines, but the GPU renderers draw a layer's fills before its lines (clip.ts), so only cutting the lines makes
 * every renderer and paper agree, for a tucked chair, a rug, or anything under a raised piece. Most pieces cross nothing,
 * and this runs per frame during a drag, so each pair is asked by its boxes first.
 */
function laterFillClips(doc: Document, order: readonly Stacked[], filled: ReadonlySet<string>, view: PlanView, style: PlanStyle): Map<string, (readonly Point[])[]> {
  const quads = footprints(doc);
  const parts = fitParts(doc);
  const rings = (id: string): readonly (readonly Point[])[] => {
    const p = doc.placements[id];
    const quad = quads.get(id);
    if (!p || !quad) return [];
    const kind = kindOf(doc.objects[p.object]?.kind ?? "");
    if (kind?.stair) {
      const range = placementRange(doc, id);
      if (!range) return [];
      return stairPlan(doc, p, view, range, style.objectLine, style.objectFill, style).flatMap((q) => (q.kind === "polygon" && isConvexRing(q.points) ? [q.points] : []));
    }
    return kind?.outline === "ell" ? (parts.get(id) ?? []) : placedFills(doc, p, quad);
  };
  const clips = new Map<string, (readonly Point[])[]>();
  const later: { box: Box; ring: readonly Point[] }[] = [];
  for (const { id } of [...order].reverse()) {
    if (!filled.has(id)) continue;
    const box = boxOf(quads.get(id) ?? []);
    const crossing = later.filter((l) => boxesCross(box, l.box)).map((l) => l.ring);
    if (crossing.length > 0) clips.set(id, crossing);
    for (const ring of rings(id)) later.push({ box: boxOf(ring), ring });
  }
  return clips;
}

type Box = { x0: number; x1: number; y0: number; y1: number };

function boxOf(ring: readonly Point[]): Box {
  const [xs, ys] = [ring.map((p) => p.x), ring.map((p) => p.y)];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Whether two boxes share more than an edge. */
function boxesCross(a: Box, b: Box): boolean {
  const eps = 1e-9;
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

/** A ring as dashed segments, one per edge: a piece above the cut (heights.15). */
function dashedRing(ring: readonly Point[], color: string, style: PlanStyle): Primitive[] {
  return ringEdges(ring, color, style.aboveWidth, "butt", style.aboveDash);
}

/**
 * A seat's hidden line (pieces.14): dashed like a piece above the cut, but a round ring's sides are a few pixels long,
 * and a dash pattern restarting on each looks solid, so a ring of many sides draws every other side instead.
 */
function hiddenRing(ring: readonly Point[], color: string, style: PlanStyle): Primitive[] {
  if (ring.length <= 8) return dashedRing(ring, color, style);
  return ringEdges(ring, color, style.aboveWidth, "butt").filter((_, i) => i % 2 === 0);
}

/** The warned zones (`shownWarnings`), each an amber polygon with an outline: no alpha of the fill reaches 3:1 alone (clarity.02). */
export const warningsLayer = memoLast((doc: Document, view: PlanView): readonly Primitive[] => {
  const rings = shownWarnings(doc, view).map((w) => w.ring);
  // Fills first, as the GPU draws them, so Canvas2D's next fill never crosses an outline. Width in px needs no zoom.
  return [...polygons(rings, COLORS.warning), ...rings.flatMap((ring) => ringEdges(ring, COLORS.warningLine, 2, "butt"))];
});

/** Hex colour with an alpha channel (0–1): the palette is hex only. */
function withAlpha(color: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0");
  return `${color.slice(0, 7)}${a}`;
}

/** A piece's fills (its shape, or an aggregate's parts) in `color` and its symbol, faded by `alpha`: each line keeps its own colour, so the detail stays lighter. */
function drawFaded(out: Primitive[], fills: readonly (readonly Point[])[], color: string, symbol: readonly Primitive[], alpha: number): void {
  out.push(...polygons(fills, alpha >= 1 ? color : withAlpha(color, alpha)));
  out.push(...(alpha >= 1 ? symbol : symbol.map((p) => ({ ...p, color: withAlpha(p.color, alpha) }))));
}

/**
 * The objects during a flip (spec: layouts, layout-states.06, .20): `flipPoses` glides an object in both layouts, turning
 * and resizing it, and one in a single layout fades. A pose wholly above the plan view's cut is a dashed outline, as the still plan
 * draws it (heights.15), so the lift bed turns solid as it comes down; a pose under the level is not drawn, nor one
 * whose ends the level doesn't show (a loft's piece at the floor), as the still plan hides its piece (levels.19, shown.02). Centre and size move together, so an object that keeps its back
 * edge (a murphy bed folding down) keeps it the whole way (layout-states.53). It fills in the picture's style for pieces (seating.02); rugs go first, so no rug's fill lands on a piece (catalog.15).
 */
export function flipObjectsLayer(doc: Document, level: Level, flip: Flip, style: PlanStyle = CANVAS_STYLE): readonly Primitive[] {
  const out: Primitive[] = [];
  for (const pose of flipPoses(doc, flip).sort((a, b) => Number(isRug(b.kind)) - Number(isRug(a.kind)))) {
    const relation = relationAt(pose, level);
    if (relation === "under" || !pose.placementIds.some((id) => shownAt(doc, id, level))) continue;
    const alpha = pose.only === "from" ? 1 - pose.e : pose.only === "to" ? pose.e : 1;
    const quad = footprintQuad(pose.at, pose.w, pose.d, pose.rotation);
    const object = doc.objects[pose.objectId];
    const arms = objectArms(object);
    if (relation === "above") {
      out.push(...dashedRing(shapedFill(pose.kind, pose.w, pose.d, pose.at, pose.rotation, quad, arms), alpha >= 1 ? style.objectLine : withAlpha(style.objectLine, alpha), style));
      continue;
    }
    const options = object?.options;
    const symbol = symbolAt(pose.kind, pose.config, pose.w, pose.d, pose.at, pose.rotation, style.objectLine, style, options, arms);
    drawFaded(out, restFills(pose.kind, pose.w, pose.d, pose.at, pose.rotation, quad, options, arms), pieceFill(style, pose.kind), symbol, alpha);
  }
  return out;
}

/** A placement's shaped fill (an `L` with its arms), or its rectangle `quad` when its object or size is missing. */
export function placedFill(doc: Document, p: Placement, quad: readonly Point[]): readonly Point[] {
  const object = doc.objects[p.object];
  const w = object?.w[p.config];
  const d = object?.d[p.config];
  return object && w !== undefined && d !== undefined ? shapedFill(object.kind, w, d, p.at, p.rotation, quad, objectArms(object)) : quad;
}

/** A placement's fills: its shape, or an aggregate's parts (seating.15), or at rest with `fills` a plant's canopy; its rectangle `quad` when its object or size is missing. */
export function placedFills(doc: Document, p: Placement, quad: readonly Point[], fills: typeof shapedFills = shapedFills): readonly (readonly Point[])[] {
  const object = doc.objects[p.object];
  const w = object?.w[p.config];
  const d = object?.d[p.config];
  return object && w !== undefined && d !== undefined ? fills(object.kind, w, d, p.at, p.rotation, quad, object.options, objectArms(object)) : [quad];
}

/** Rings as filled polygons in one colour. */
export const polygons = (rings: readonly (readonly Point[])[], color: string): Primitive[] => rings.map((points) => ({ kind: "polygon", points, holes: [], color }));
