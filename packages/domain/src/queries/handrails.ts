import type { Point } from "@fm/protocol";
import { sortedIds } from "../graph";
import { memo } from "../memo";
import { EPS, sameRails, type Document, type FlightRails, type HandrailKind } from "../model";
import { openSpans, ringSpan, type EdgeLine, type Span } from "./edge-spans";
import { wallBodies } from "./footprints";
import { pitchLineOf, type PitchLine } from "./underside";
import { ceilingOver, wallRange } from "./vertical";

// A flight's handrails (AC-11, guards.07): where they go is worked out from the geometry, and read by the plan and 3D alike.
// What they are, Railing, Glass or None, is the stair's setting per side (guards.28, edges.06), carried on every row so both views
// read the look from the same place as the line. A pitch line is what makes a stair a flight here: a rung ladder and a
// spiral have none, so they have no handrail. Handrails only draw: nothing here refuses or warns about anything.
//
//       top of the run
//     ┌─────────────┐
//     │ ┊         ┊ │   x: a rail, just inside each open long side
//     │ ┊         ┊ │   along it `a` runs from the front edge, and `top` from the pitch line up 0.90
//     │ ┊         █ │   █ a wall as tall as the rail: no rail on that stretch
//     └─────────────┘
//       foot

/** How far above its pitch line a handrail's top runs, or as much as fits under the ceiling. A default. */
export const HANDRAIL_HEIGHT = 0.9;
/** How far inside a long side a rail's centre line is: half its thickness, so it's flush with the side and stays in the stair's box. */
export const HANDRAIL_INSET = 0.02;

/**
 * A point a rail passes: `a` metres up the run from the front edge, its top `top`, and `foot`, the line it runs
 * HANDRAIL_HEIGHT above before any ceiling cuts it (a flight's pitch line, a spiral's treads'), where a Glass pane stands.
 */
export type RailKnot = { a: number; top: number; foot: number };
/**
 * One open stretch of a flight's long side: `x` the rail's line across the flight, negative on the left, `knots`, from
 * low to high, where the rail bends, the first and last the stretch's ends, and `kind`, the stair's setting.
 */
export type Handrail = { x: number; knots: readonly RailKnot[]; kind: Exclude<HandrailKind, "none"> };

/** The rail's knots from `from` to `to`: its ends, where the pitch line levels off, and where the rail meets the ceiling. */
function knotsOf(line: PitchLine, topAt: (a: number) => number, ceiling: number, [from, to]: Span): RailKnot[] {
  const [low, high] = [line.at(line.risesFrom) + HANDRAIL_HEIGHT, line.at(line.levelFrom) + HANDRAIL_HEIGHT];
  const meets = low < ceiling && ceiling < high ? [line.risesFrom + ((line.levelFrom - line.risesFrom) * (ceiling - low)) / (high - low)] : [];
  const bends = [...meets, line.risesFrom, line.levelFrom].filter((a) => a > from + EPS && a < to - EPS).sort((p, q) => p - q);
  return [from, ...bends, to].map((a) => ({ a, top: topAt(a), foot: line.at(a) }));
}

/** What of a long side walls close: each wall that reaches the rail's top over its own length, and starts no higher than the pitch line there. */
function wallSpans(doc: Document, edge: EdgeLine, line: PitchLine, topAt: (a: number) => number): Span[] {
  const out: Span[] = [];
  for (const [id, body] of wallBodies(doc)) {
    const range = wallRange(doc, id);
    const span = range ? ringSpan(edge, line.run, body) : null;
    if (range && span && range.top >= topAt(span[1]) - EPS && range.bottom <= line.at(span[0]) + EPS) out.push(span);
  }
  return out;
}

/** A flight's rails: right side, then left, each low to high; a side set to None has none (edges.06). */
function railsOf(doc: Document, line: PitchLine, rails: FlightRails): Handrail[] {
  const across: Point = { x: line.along.y, y: -line.along.x };
  return [1, -1].flatMap((side) => {
    const kind = side > 0 ? rails.right : rails.left;
    if (kind === "none") return [];
    const a = { x: line.foot.x + across.x * side * line.half, y: line.foot.y + across.y * side * line.half };
    const edge = { a, b: { x: a.x + line.along.x * line.run, y: a.y + line.along.y * line.run }, normal: across };
    const ceiling = ceilingOver(doc, [edge.a, edge.b]);
    const topAt = (at: number): number => Math.min(line.at(at) + HANDRAIL_HEIGHT, ceiling);
    // Before the line rises (a winder's front square, steps.09) no rail runs: the stretch is closed like a wall's.
    const closed: Span[] = line.risesFrom > EPS ? [[0, line.risesFrom], ...wallSpans(doc, edge, line, topAt)] : wallSpans(doc, edge, line, topAt);
    return openSpans(line.run, closed).map((span): Handrail => ({ x: side * (line.half - HANDRAIL_INSET), knots: knotsOf(line, topAt, ceiling, span), kind }));
  });
}

/** Every flight's handrails by its object. A stair has one pose in every layout (I19), so one placement says it. */
export const flightHandrails = memo((doc: Document): ReadonlyMap<string, readonly Handrail[]> => {
  const out = new Map<string, readonly Handrail[]>();
  for (const id of sortedIds(doc.placements)) {
    const object = doc.placements[id]?.object;
    const line = pitchLineOf(doc, id);
    if (object !== undefined && line !== null && !out.has(object)) out.set(object, railsOf(doc, line, doc.objects[object]?.handrails ?? sameRails("railing")));
  }
  return out;
});
