import { SPIRAL_COLUMN_RADIUS, relationAt, spiralLanding, spiralTreads, stairTurn, type HandrailKind, type Level, type SpiralRails, type SpiralTread, type StairGeometry, type StairRule } from "@fm/domain";
import type { PlanStyle } from "./plan-style";
import type { Primitive } from "./scene-types";

// A spiral on the plan (stairs.02, .21): the circle, a radial line at each tread's front and at the last tread's end,
// each tread's outer arc, the column, an arc walking line from a dot on the first tread to an arrow at the back edge,
// pointing the way it rises (clockwise), and the top landing's square, the arrow's tip on its side (edge-catch.06, .18). Below the view's cut solid and filled; from the first tread above it a
// radial break line, and every tread past it dashed. Footprint space: x −w/2..w/2, y −d (front) to 0 (back), the centre
// at (0, −d/2); angles counter-clockwise from +x, 90° toward the back edge (domain `spiralTreads`).

const DEG = Math.PI / 180;
const FILL_STEP = 5; // degrees between the fill's points along the circle
const DASH_ON = 0.06; // m along an arc: arcs have no dash pattern, so a dashed arc is drawn as pieces
const DASH_OFF = 0.04;
const ARROW = 0.13; // m: the arrowhead's length along the walking line
const ARROW_HALF = 0.42; // its half width, as a share of its length
const BREAK_OVER = 0.08; // m: the break line reaches this far past the circle
const BREAK_ZIG = 0.07; // m: the zigzag in its middle

type P = { x: number; y: number };

/**
 * A spiral's parts in footprint space; `kc` is its first tread whose top is above the cut, past the last when it is
 * whole (at the level it reaches, or wholly below the cut).
 */
export function spiralParts(rule: StairRule, w: number, d: number, g: StairGeometry, kc: number, color: string, fill: string, style: PlanStyle): Primitive[] {
  const c = { x: 0, y: -d / 2 };
  const r = Math.min(w, d) / 2; // the box is square (stairs.21); a stored one off square keeps the circle inside
  const rc = Math.min(SPIRAL_COLUMN_RADIUS, r / 2);
  const rm = (r + rc) / 2; // the walking line, halfway out
  const at = (radius: number, deg: number): P => ({ x: c.x + radius * Math.cos(deg * DEG), y: c.y + radius * Math.sin(deg * DEG) });
  const treads = spiralTreads(rule, g.treads);
  const full = kc > treads.length;
  const solidFrom = breakAngle(treads, kc);
  const line = { px: style.objectLineWidth };
  const detail = color === style.objectLine ? { color: style.objectDetail, width: { px: style.objectDetailWidth } } : { color, width: line };
  const seg = (a: P, b: P, width = line, col = color): Primitive => ({ kind: "segment", a, b, width, color: col, cap: "butt" });
  const dashed = (a: P, b: P): Primitive => ({ kind: "segment", a, b, width: { px: style.aboveWidth }, color, cap: "butt", dash: style.aboveDash });
  const arc = (radius: number, from: number, to: number, width = line, col = color): Primitive[] =>
    to - from > 1e-9 ? [{ kind: "arc", center: c, radius, from: from * DEG, to: to * DEG, width, color: col }] : [];
  const dashedArc = (radius: number, from: number, to: number): Primitive[] => {
    const out: Primitive[] = [];
    const length = radius * (to - from) * DEG;
    for (let s = 0; s < length - 1e-9; s += DASH_ON + DASH_OFF) out.push(...arc(radius, from + s / radius / DEG, from + Math.min(length, s + DASH_ON) / radius / DEG, { px: style.aboveWidth }));
    return out;
  };
  const out: Primitive[] = [];
  // The fill under the treads below the cut; the thin circle round them and round the floor no tread covers.
  const end = 90 + stairTurn(rule, treads.length); // the first tread's front
  if (end - solidFrom >= 360 - 1e-9) out.push({ kind: "polygon", points: Array.from({ length: 360 / FILL_STEP }, (_, i) => at(r, i * FILL_STEP)), holes: [], color: fill });
  else if (end - solidFrom > 1e-9) {
    const n = Math.ceil((end - solidFrom) / FILL_STEP);
    out.push({ kind: "polygon", points: [c, ...Array.from({ length: n + 1 }, (_, i) => at(r, solidFrom + ((end - solidFrom) * i) / n))], holes: [], color: fill });
  }
  // The landing, at the stair's top, filled like the treads where the symbol is whole (edge-catch.24).
  const landing = spiralLanding(w, d).map((q) => ({ x: c.x + q.x, y: c.y + q.y }));
  if (full) out.push({ kind: "polygon", points: landing, holes: [], color: fill });
  out.push(...(full ? arc(r, 0, 360, detail.width, detail.color) : arc(r, solidFrom, 450, detail.width, detail.color)));
  treads.forEach((t, i) => {
    const k = i + 1;
    out.push(...(k < kc ? arc(r, t.from, t.to) : dashedArc(r, t.from, t.to)));
    const [a, b] = [at(rc, t.to), at(r, t.to)];
    out.push(k > kc ? dashed(a, b) : k === 1 ? seg(a, b, { px: style.objectFront }) : seg(a, b, detail.width, detail.color));
  });
  out.push(full ? seg(at(rc, 90), at(r, 90), detail.width, detail.color) : dashed(at(rc, 90), at(r, 90))); // the last tread's end
  // Its outline: dashed like the treads above the cut unless the symbol is whole.
  landing.forEach((a, i) => {
    const b = landing[(i + 1) % landing.length] ?? a;
    out.push(full ? seg(a, b, detail.width, detail.color) : dashed(a, b));
  });
  if (!full) out.push(...breakLine(solidFrom, rc, r + BREAK_OVER, at, seg));
  out.push({ kind: "disc", center: c, radius: { m: rc }, color });
  out.push(...walkingLine(treads[0] ? (treads[0].from + treads[0].to) / 2 : 90, full ? 90 : solidFrom, rm, at, arc, dashedArc, color, style.stairDot));
  return out;
}

/** Where the symbol's solid part ends: the front of the first tread above the cut, or the last tread's end when it's whole. */
function breakAngle(treads: readonly SpiralTread[], kc: number): number {
  return kc > treads.length ? 90 : (treads[kc - 1]?.to ?? 90);
}

/**
 * A stair's rail on the plan, a thin line in the guards' width: a Railing in their ink, a Glass one in a deck's Glass ink
 * (guards.28), or the stair's own colour when it's selected.
 */
export function railStroke(color: string, style: PlanStyle, kind: HandrailKind): { width: { px: number }; color: string } {
  const ink = kind === "glass" ? style.openingGlass : style.guard.ink;
  return { width: { px: style.guard.line }, color: color === style.objectLine ? ink : color };
}

/**
 * A spiral's rails (AC-12) in footprint space: the balustrade as far as the treads are solid, and the landing's rail where
 * `level`'s cut has it below or crossing, the same test as a deck's guard: the landing is a riser above the last tread, so a
 * whole symbol doesn't say it's below the cut.
 */
export function spiralRailLines(rule: StairRule, rails: SpiralRails, level: Level, d: number, g: StairGeometry, kc: number, color: string, style: PlanStyle): Primitive[] {
  const c = { x: 0, y: -d / 2 };
  const treads = spiralTreads(rule, g.treads);
  const stroke = railStroke(color, style, rails.kind);
  const from = Math.max(breakAngle(treads, kc), rails.start - (rails.knots.at(-1)?.a ?? 0));
  const arc: Primitive[] = rails.start - from > 1e-9 ? [{ kind: "arc", center: c, radius: rails.radius, from: from * DEG, to: rails.start * DEG, ...stroke }] : [];
  const landing = rails.landing.filter((r) => relationAt(r, level) !== "above").map((r): Primitive => ({ kind: "segment", a: { x: c.x + r.a.x, y: c.y + r.a.y }, b: { x: c.x + r.b.x, y: c.y + r.b.y }, ...stroke, cap: "butt" }));
  return [...arc, ...landing];
}

/** The radial break line at `deg`, from `r0` to `r1` out, with a zigzag across it in the middle. */
function breakLine(deg: number, r0: number, r1: number, at: (radius: number, deg: number) => P, seg: (a: P, b: P) => Primitive): Primitive[] {
  const normal = { x: -Math.sin(deg * DEG), y: Math.cos(deg * DEG) };
  const point = (t: number, zig = 0): P => {
    const p = at(r0 + t * (r1 - r0), deg);
    return { x: p.x + normal.x * zig, y: p.y + normal.y * zig };
  };
  const points = [point(0), point(0.42), point(0.47, BREAK_ZIG), point(0.53, -BREAK_ZIG), point(0.58), point(1)];
  return points.slice(1).map((b, i) => seg(points[i] ?? b, b));
}

/**
 * The walking line at radius `rm`: from the dot at `dotDeg` clockwise to the arrow's tip at 90°, solid down to `solidFrom`
 * and dashed past it; the arrowhead points along the clockwise tangent; `dot` the dot's radius in the style's unit.
 */
function walkingLine(
  dotDeg: number, solidFrom: number, rm: number, at: (radius: number, deg: number) => P,
  arc: (radius: number, from: number, to: number) => Primitive[], dashedArc: (radius: number, from: number, to: number) => Primitive[], color: string, dot: number,
): Primitive[] {
  const arrowDeg = 90 + ARROW / rm / DEG; // where the arrowhead's base sits
  const out: Primitive[] = [...arc(rm, Math.max(arrowDeg, solidFrom), dotDeg), ...dashedArc(rm, arrowDeg, Math.min(solidFrom, dotDeg))];
  const half = ARROW * ARROW_HALF;
  out.push({ kind: "polygon", points: [at(rm, 90), at(rm + half, arrowDeg), at(rm - half, arrowDeg)], holes: [], color });
  out.push({ kind: "disc", center: at(rm, dotDeg), radius: { px: dot }, color });
  return out;
}
