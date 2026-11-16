import { deckViews, flightHandrails, hasOption, reachesLevel, spiralRails, stairBase, stairGeometry, stairRuleOf, type Document, type Handrail, type Placement, type Range, type StairGeometry, type StairRule } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { clipAllOutside } from "./clip";
import { placeSymbol } from "./furniture";
import { railStroke, spiralParts, spiralRailLines } from "./spiral-plan";
import type { PlanStyle } from "./plan-style";
import type { PlanView } from "./plan-view";
import type { Primitive } from "./scene-types";
import { stairLines, type StairLines } from "./stair-lines";

// A stair on the plan (stairs.02): treads, a walking line from a dot on the first step to an arrow on the last (always
// uphill), a break line where the view's cut crosses the flight with everything past it dashed and "UP" with the riser
// label; at the level it reaches, the whole flight, solid, "DN". A ladder the same, its rungs in place of treads (step
// 12); a spiral its radial treads (spiral-plan.ts, step 14). A flight's handrails and a spiral's rails are thin lines. Drawn in footprint space (x −w/2..w/2, y from −d, the front edge and bottom step, to 0, the back edge and top)
// and placed like a furniture symbol.

const DOT_INSET = 0.09; // m: the dot on the first tread's nosing, just inside the front edge
const ARROW = 0.13; // m: the arrowhead's length along the run
const ARROW_HALF = 0.42; // its half width, as a share of its length
const BREAK_SLANT = 0.07; // m: the break line leans this much either way along the run
const BREAK_OVER = 0.08; // m: and reaches this far past the sides
const BREAK_ZIG = 0.07; // m: the zigzag in its middle
const LABEL_GAP = 0.18; // m: the label's centre beside the flight, off its long side

type P = { x: number; y: number };

/**
 * A stair placement's plan, fill included, in the world: `color` its lines (the style's object line, or the selection
 * colour), `fill` its fill below the cut. Empty for anything that isn't a stair with sizes.
 */
export function stairPlan(doc: Document, p: Placement, view: PlanView, range: Range, color: string, fill: string, style: PlanStyle): Primitive[] {
  const object = doc.objects[p.object];
  const rule = object ? stairRuleOf(object.kind) : null;
  const [w, d] = [object?.w[p.config], object?.d[p.config]];
  if (!object || !rule || w === undefined || d === undefined) return [];
  const base = stairBase(doc, p.id) ?? range.bottom; // where its steps begin: a start deck's top (stairs.49)
  const g = stairGeometry(rule, w, d, range.top - base, object.riser ?? null); // the rise, read through the range (heights.27)
  const fromTop = reachesLevel(doc, object.id, view.level);
  // The first tread or rung whose top is above the cut; past the last when the stair is whole.
  const kc = fromTop ? Infinity : Math.max(1, Math.floor((view.cut - base) / g.riser + 1e-9) + 1);
  const label = `${fromTop ? "DN" : "UP"} · ${numbers(rule, g)}`;
  const text: Primitive = { kind: "text", text: label, ...labelPlace(w, d, p.rotation), size: style.stairLabel, color: style.tag.text, align: "center", font: style.font };
  const spiral = spiralRails(doc).get(object.id);
  const rails = spiral ? spiralRailLines(rule, spiral, view.level, d, g, kc, color, style) : [];
  const left = hasOption(object, "leftEntry"); // a winder entered from the left (steps.04)
  const hooks = hasOption(object, "hooks"); // a rung ladder hooked over its edge (steps.05)
  const placed = placeSymbol([...parts(rule, w, d, g, kc, view.cut - base, color, fill, style, flightHandrails(doc).get(object.id) ?? [], left, hooks), ...rails, text], p.at, p.rotation);
  // From above, what runs on under the level's slab doesn't show (riser.05); from below, the break line says it all.
  return fromTop ? clipAllOutside(placed, deckViews(doc).filter((deck) => view.level.deckIds.includes(deck.id)).flatMap((deck) => deck.cells)) : placed;
}

/**
 * The ghost of a stair on a caught edge (stairdraw.11): its whole flight at the rise `h` it will get, filled with
 * `fill`, and "UP · 12 R"; a winder entered from the `left` mirrored (steps.39). Empty for a kind that isn't a stair.
 */
export function stairGhostPlan(kind: string, w: number, d: number, h: number, at: P, rotation: number, color: string, fill: string, style: PlanStyle, left = false): Primitive[] {
  const rule = stairRuleOf(kind);
  if (!rule) return [];
  const g = stairGeometry(rule, w, d, h, null); // a stair yet to be placed has no target
  const text: Primitive = { kind: "text", text: `UP · ${numbers(rule, g)}`, ...labelPlace(w, d, rotation), size: style.stairLabel, color: style.tag.text, align: "center", font: style.font };
  return placeSymbol([...parts(rule, w, d, g, Infinity, h, color, fill, style, [], left), text], at, rotation);
}

/**
 * The label's count, short so it fits beside a short flight (stairs.62): "12 R" (risers) for a flight or a spiral, "7 rungs"
 * for a ladder. The riser, going and turn are in Properties and get_drawing.
 */
function numbers(rule: StairRule, g: StairGeometry): string {
  switch (rule.shape) {
    case "flight":
    case "winder":
    case "spiral":
      return `${g.risers} R`;
    case "ladder":
      return `${g.treads} rungs`;
    default:
      return assertNever(rule.shape);
  }
}

/** The stair's parts in footprint space by its shape, broken at tread `kc`, the cut `cut` metres above its base. */
function parts(rule: StairRule, w: number, d: number, g: StairGeometry, kc: number, cut: number, color: string, fill: string, style: PlanStyle, rails: readonly Handrail[], left = false, hooks = false): Primitive[] {
  switch (rule.shape) {
    case "flight":
    case "winder":
    case "ladder": {
      const solidTo = Math.min(d, solidLength(rule, g, kc, cut));
      return [...flightParts(w, d, stairLines(rule, w, g, left, hooks), solidTo, color, fill, style), ...railLines(rails, d, solidTo, color, style)];
    }
    case "spiral":
      return spiralParts(rule, w, d, g, kc, color, fill, style);
    default:
      return assertNever(rule.shape);
  }
}

/**
 * How far along the run, from the front edge, a flight or a ladder is drawn solid below a cut `cut` metres above its
 * base: a flight to `kc`, the first tread whose top is above the cut, a ladder to where its pitch line crosses it;
 * whole when every tread or rung is below the cut.
 */
function solidLength(rule: StairRule, g: StairGeometry, kc: number, cut: number): number {
  if (kc > g.treads) return Infinity;
  switch (rule.shape) {
    case "flight":
    case "spiral":
      return Math.max(0, g.nosingAt(kc)); // the geometry says where the tread's nosing lies (steps.09)
    case "winder": // never inside its front square: the break moves to the first straight tread (steps.09)
      return Math.max(g.knots[0]?.a ?? 0, g.nosingAt(kc)); // the first knot is tread 4's nosing, at the square's back
    case "ladder":
      return Math.max(0, (cut / g.riser) * g.going);
    default:
      return assertNever(rule.shape);
  }
}

/**
 * Where the label goes, in footprint space, and its world angle: along the run, readable (within ±90°), centred on the
 * flight's length beside the long side that is lower in the world (the right one when level), as plans write "UP".
 */
function labelPlace(w: number, d: number, rotation: number): { at: P; rotation: number } {
  const r = (rotation * Math.PI) / 180;
  const run = Math.atan2(Math.cos(r), -Math.sin(r)); // the footprint's +y (front to back) in the world
  const readable = run > Math.PI / 2 + 1e-9 ? run - Math.PI : run <= -Math.PI / 2 + 1e-9 ? run + Math.PI : run;
  const rightY = Math.sin(r); // the world y of the right side's outward normal (cos r, sin r); the left's is −sin r
  const side = rightY < -rightY - 1e-9 || Math.abs(rightY) <= 1e-9 ? 1 : -1;
  return { at: { x: side * (w / 2 + LABEL_GAP), y: -d / 2 }, rotation: readable };
}

/** A straight flight's or a ladder's parts in footprint space, solid up to `solidTo` metres along the run and dashed past it. */
function flightParts(w: number, d: number, lines: StairLines, solidTo: number, color: string, fill: string, style: PlanStyle): Primitive[] {
  const line = { px: style.objectLineWidth };
  const detail = color === style.objectLine ? { color: style.objectDetail, width: { px: style.objectDetailWidth } } : { color, width: line };
  const seg = (a: P, b: P, width = line, c = color): Primitive => ({ kind: "segment", a, b, width, color: c, cap: "butt" });
  const dashed = (a: P, b: P): Primitive => ({ kind: "segment", a, b, width: { px: style.aboveWidth }, color, cap: "butt", dash: style.aboveDash });
  const full = solidTo >= d - 1e-9;
  const yb = -d + solidTo;
  const out: Primitive[] = [];
  if (solidTo > 0) out.push({ kind: "polygon", points: [{ x: -w / 2, y: -d }, { x: w / 2, y: -d }, { x: w / 2, y: yb }, { x: -w / 2, y: yb }], holes: [], color: fill });
  out.push(seg({ x: -w / 2, y: -d }, { x: w / 2, y: -d }, { px: style.objectFront }));
  for (const x of lines.along) {
    if (solidTo > 0) out.push(seg({ x, y: -d }, { x, y: yb }));
    if (!full) out.push(dashed({ x, y: yb }, { x, y: 0 }));
  }
  out.push(full ? seg({ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }) : dashed({ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }));
  for (const { a, x0, x1 } of lines.across) {
    const y = -d + a;
    out.push(a > solidTo + 1e-9 ? dashed({ x: x0, y }, { x: x1, y }) : seg({ x: x0, y }, { x: x1, y }, detail.width, detail.color));
  }
  for (const [a, b] of lines.slants) out.push(seg({ x: a.x, y: -d + a.y }, { x: b.x, y: -d + b.y }, detail.width, detail.color)); // a winder's rays, always below the break
  if (!full) out.push(...breakLine(w, Math.max(yb, -d + BREAK_SLANT), seg)); // kept inside a flight that breaks at its front edge
  const y1 = -ARROW;
  // The walking line: a winder's own path (steps.04), else the centre line from a dot just in from the front edge.
  const walk = lines.walk ?? [{ x: 0, y: DOT_INSET }, { x: 0, y: d }];
  const pts = walk.map((q, i): P => ({ x: q.x, y: i === walk.length - 1 ? y1 : -d + q.y }));
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    if (!a || !b) continue;
    if (b.y <= yb + 1e-9 || full) out.push(seg(a, b));
    else if (a.y >= yb - 1e-9) out.push(dashed(a, b));
    else {
      const t = (yb - a.y) / (b.y - a.y);
      const m = { x: a.x + t * (b.x - a.x), y: yb };
      out.push(seg(a, m), dashed(m, b));
    }
  }
  out.push({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: -ARROW * ARROW_HALF, y: y1 }, { x: ARROW * ARROW_HALF, y: y1 }], holes: [], color });
  out.push({ kind: "disc", center: pts[0] ?? { x: 0, y: -d + DOT_INSET }, radius: { px: style.stairDot }, color });
  return out;
}

/** A flight's handrails in footprint space: each a thin line on its stretch, stopping where the flight's solid lines do. */
function railLines(rails: readonly Handrail[], d: number, solidTo: number, color: string, style: PlanStyle): Primitive[] {
  return rails.flatMap(({ x, knots, kind }): Primitive[] => {
    const [from, to] = [knots[0]?.a ?? 0, Math.min(solidTo, knots.at(-1)?.a ?? 0)];
    if (to <= from) return [];
    return [{ kind: "segment", a: { x, y: -d + from }, b: { x, y: -d + to }, ...railStroke(color, style, kind), cap: "butt" }];
  });
}

/** The break line across the flight at `yb`: leaning along the run, past both sides, with a zigzag in the middle. */
function breakLine(w: number, yb: number, seg: (a: P, b: P) => Primitive): Primitive[] {
  const at = (t: number, zig = 0): P => ({ x: -w / 2 - BREAK_OVER + t * (w + 2 * BREAK_OVER), y: yb - BREAK_SLANT + t * 2 * BREAK_SLANT + zig });
  const points = [at(0), at(0.42), at(0.47, BREAK_ZIG), at(0.53, -BREAK_ZIG), at(0.58), at(1)];
  return points.slice(1).map((b, i) => seg(points[i] ?? b, b));
}
