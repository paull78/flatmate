import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { boxOf, convexOverlap, inConvex, rotateAbout } from "../src/geometry";
import { emptyDocument, EPS } from "../src/model";
import { solidsCollide, type Box3 } from "../src/queries/fit";
import { MIN_PASSAGE } from "../src/stairs";
import { fitSolids, type Underside } from "../src/queries/underside";
import { rangesOverlap, type Range } from "../src/queries/vertical";
import { place, rng } from "./helpers";

// The underside fuzz (stairs.03, .11, spec "Testing"): random open stairs and random pieces, the fit predicate against
// a sampled oracle. The stair is solid over a plan point q from the underside at q's run position up to its top, so a
// piece collides when it overlaps the stair on the plan, the two ranges overlap, and its top is above the underside
// somewhere over the overlap. The oracle samples the overlap (grid points of the piece inside the stair and of the stair
// inside the piece, edges and corners included) and skips, counting them, the cases its sampling can't decide: a top
// within one sample's step of the underside, or an overlap thinner than a sample. Mutants of the rule must disagree with
// it, so the oracle is shown to catch a wrong predicate.

declare const console: { log(message: string): void };

const N = 24; // samples per side
const CASES = 3000;
const INSIDE = 2 * EPS; // a sample counts inside both rings this far in, so the rings overlap by more than the fit's 1 mm

type Rect = { at: Point; w: number; d: number; rotation: number };
/** A w × d rectangle anchored at the middle of its back edge, as footprints are, as a ring. */
const ringOf = (r: Rect): Point[] =>
  [{ x: -r.w / 2, y: -r.d }, { x: r.w / 2, y: -r.d }, { x: r.w / 2, y: 0 }, { x: -r.w / 2, y: 0 }].map((q) => rotateAbout({ x: q.x + r.at.x, y: q.y + r.at.y }, r.at, r.rotation));
/** Grid points over a rectangle's ring, its edges and corners included. */
function samples(ring: readonly Point[]): Point[] {
  const [a, b, , d] = ring;
  if (!a || !b || !d) return [];
  const out: Point[] = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) out.push({ x: a.x + ((b.x - a.x) * i) / N + ((d.x - a.x) * j) / N, y: a.y + ((b.y - a.y) * i) / N + ((d.y - a.y) * j) / N });
  return out;
}
const runPos = (u: Underside, q: Point): number => (q.x - u.foot.x) * u.along.x + (q.y - u.foot.y) * u.along.y;

type Case = { stair: Box3 & { underside: Underside }; piece: Box3; step: number };

function randomCase(r: () => number): Case | null {
  const at = { x: 5 + r() * 2 - 1, y: 5 + r() * 2 - 1 };
  const [w, d, h] = [0.5 + r() * 0.9, 0.8 + r() * 3, 0.5 + r() * 2.7];
  const rotation = Math.floor(r() * 8) * 45 + (r() < 0.3 ? r() * 90 : 0);
  const doc = place(emptyDocument(), { object: "st", kind: "openStair", at: [at.x, at.y], rotation, size: { w: { standard: w }, d: { standard: d }, h: { standard: h } } });
  const stair = fitSolids(doc).find((s) => s.key.id === "st/s0");
  if (!stair?.underside) return null;
  // A piece somewhere around the stair's footprint, any size and turn, at any height up to past the stair's top.
  const centre = { x: at.x + (r() - 0.5) * 3, y: at.y + (r() - 0.5) * 3 };
  const rect: Rect = { at: centre, w: 0.2 + r() * 1.6, d: 0.2 + r() * 1.6, rotation: r() * 360 };
  const ring = ringOf(rect);
  const bottom = r() < 0.6 ? 0 : r() * (h + 0.3);
  const range: Range = { bottom, top: bottom + 0.05 + r() * 1.8 };
  const step = Math.max(rect.w, rect.d, w, d) / N; // the farthest an overlap's corner lies from a sample on its edges
  return { stair: { ...stair, underside: stair.underside }, piece: { ring, box: boxOf(ring), range }, step };
}

type Verdict = "collides" | "under" | "over" | "apartInHeight" | "apart" | "thin" | "close";

/** What the sampled oracle says about a case; "thin" and "close" are cases it can't decide. */
function oracle(c: Case, underside: (minA: number) => number = (a) => c.stair.underside.at(a)): Verdict {
  const u = c.stair.underside;
  const both = [...samples(c.piece.ring).filter((q) => inConvex(q, c.stair.ring, -INSIDE)), ...samples(c.stair.ring).filter((q) => inConvex(q, c.piece.ring, -INSIDE))];
  const overlaps = convexOverlap(c.piece.ring, c.stair.ring);
  if (both.length === 0) return overlaps ? "thin" : "apart";
  if (!rangesOverlap(c.piece.range, c.stair.range)) return "apartInHeight";
  const minA = Math.min(u.run, Math.max(0, Math.min(...both.map((q) => runPos(u, q)))));
  const top = c.piece.range.top;
  // With room to get past above the pitch line it clears the flight too (riser.08, .15): the line at the piece's highest point over the flight.
  const pitch = c.stair.pitch;
  if (pitch) {
    const maxA = Math.min(u.run, Math.max(0, Math.max(...both.map((q) => runPos(u, q)))));
    const bottom = c.piece.range.bottom;
    if (bottom >= pitch.at(Math.min(u.run, maxA + c.step)) + MIN_PASSAGE + EPS) return "over";
    if (bottom >= pitch.at(Math.max(0, maxA - c.step)) + MIN_PASSAGE - EPS && top > underside(minA) + EPS) return "close";
  }
  if (top > underside(minA) + EPS) return "collides";
  if (top <= underside(Math.max(0, minA - c.step))) return "under";
  return "close";
}

describe("the underside fuzz", () => {
  it("random pieces and open stairs: the predicate agrees with a sampled oracle (piece corners and points along its edges against the underside line)", () => {
    const r = rng(20261022);
    const counts: Record<Verdict | "noStair", number> = { collides: 0, under: 0, over: 0, apartInHeight: 0, apart: 0, thin: 0, close: 0, noStair: 0 };
    const disagreements: string[] = [];
    for (let i = 0; i < CASES; i++) {
      const c = randomCase(r);
      if (c === null) {
        counts.noStair++;
        continue;
      }
      const verdict = oracle(c);
      counts[verdict]++;
      if (verdict === "thin" || verdict === "close") continue;
      const predicate = solidsCollide(c.stair, c.piece) && solidsCollide(c.piece, c.stair);
      if (predicate !== (verdict === "collides")) disagreements.push(`case ${i}: oracle ${verdict}, predicate ${predicate}`);
    }
    console.log(`underside fuzz: ${JSON.stringify(counts)}`);
    expect(disagreements).toEqual([]);
    // Enough decided cases on each side, and few left out.
    expect(counts.noStair).toBe(0);
    expect(counts.collides).toBeGreaterThan(CASES / 10);
    expect(counts.under).toBeGreaterThan(CASES / 20);
    expect(counts.thin + counts.close).toBeLessThan(CASES / 10);
  });

  it("the oracle catches wrong rules: the box, a corner beside the flight counted, no side boards, the high end", () => {
    const r = rng(7);
    const mutants: Record<string, (c: Case) => boolean> = {
      box: (c) => rangesOverlap(c.piece.range, c.stair.range) && convexOverlap(c.piece.ring, c.stair.ring),
      corners: (c) => {
        const u = c.stair.underside;
        const minA = Math.min(u.run, Math.max(0, Math.min(...c.piece.ring.map((q) => runPos(u, q)))));
        return rangesOverlap(c.piece.range, c.stair.range) && convexOverlap(c.piece.ring, c.stair.ring) && c.piece.range.top > u.at(minA) + EPS;
      },
      noBoards: (c) => oracle(c, (a) => c.stair.underside.at(a) + 0.23) === "collides",
      highEnd: (c) => oracle(c, () => c.stair.underside.at(c.stair.underside.run)) === "collides",
    };
    const caught: Record<string, number> = Object.fromEntries(Object.keys(mutants).map((k) => [k, 0]));
    for (let i = 0; i < CASES; i++) {
      const c = randomCase(r);
      if (c === null) continue;
      const verdict = oracle(c);
      if (verdict === "thin" || verdict === "close") continue;
      for (const [name, mutant] of Object.entries(mutants)) if (mutant(c) !== (verdict === "collides")) caught[name] = (caught[name] ?? 0) + 1;
    }
    for (const [name, n] of Object.entries(caught)) expect(n, name).toBeGreaterThan(0);
  });
});
