import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { collisionMessage } from "../src/errors";
import { convexOverlap, signedArea } from "../src/geometry";
import { OBJECT_KINDS, SEAT_BACK, seatsUnderAt } from "../src/kinds";
import type { Document } from "../src/model";
import { placementFit, type PlacementFit } from "../src/queries/fit";
import { fitShapes } from "../src/queries/footprints";
import { seatStrip, tucks } from "../src/queries/tucks";
import { validateDocument } from "../src/validate";
import { zoneBlocks } from "../src/queries/clearance";
import { place, rectDoc, withDeck } from "./helpers";

// The tuck rule (spec "Seating: the tuck rule", AC-05; seating.08, .14, .16): against a piece you sit at, in a
// configuration you sit at, on the same surface, a seat is solid only in its back SEAT_BACK strip. Each case is asked
// of validation (I11) and of placementFit, which must agree.
//
// The room: 4 × 4 m, inner faces at 0.1 and 3.9. The desk (1.20 × 0.60) stands against the top wall: x 1.4–2.6,
// y 3.3–3.9, its front edge on y = 3.3. A chair (0.45 × 0.45) at rotation 180 faces +y; its anchor is the middle of
// its back edge, so a chair tucked t under the desk has its back on y = 2.85 + t and its strip up to 2.95 + t.

const room = (): Document => rectDoc(0, 0, 4, 4);
const withDesk = (): Document => place(room(), { object: "desk", kind: "desk", at: [2, 3.9] });
const FACING = 180;
const tucked = (t: number): [number, number] => [2, 2.85 + t];

type Pose = { at: [number, number]; rotation: number; deck?: string | null; state?: string };

/** `doc` with the chair placed at `pose`. */
const withChair = (doc: Document, pose: Pose): Document =>
  place(doc, { object: "chair", kind: "chair", at: pose.at, rotation: pose.rotation, deck: pose.deck ?? null, state: pose.state ?? "s0" });

/** Validation's texts and placementFit's answer for the chair at `pose` in `base` (which has no chair). */
function judged(base: Document, pose: Pose): { refusals: string[]; fit: PlacementFit } {
  const r = validateDocument(withChair(base, pose));
  const fit = placementFit(base, { kind: "chair", state: pose.state ?? "s0", at: { x: pose.at[0], y: pose.at[1] }, rotation: pose.rotation, config: "standard", surface: pose.deck ?? null });
  return { refusals: r.ok ? [] : r.error.map((v) => v.message), fit };
}
const accepted = { refusals: [], fit: { fits: true, reason: null } };
const CHAIR = { name: "Chair", bottom: 0, top: 0.9 };
const DESK = { name: "Desk", bottom: 0, top: 0.75 };

/** The chair's full fit shape in `doc`. */
const chairRing = (doc: Document, id = "chair/s0"): readonly Point[] => {
  const ring = fitShapes(doc).get(id);
  if (!ring) throw new Error(`no ${id}`);
  return ring;
};

/** The anchor of a chair turned `rotation` whose centre is `c` (the anchor is its back edge's middle). */
const anchorFor = (c: Point, rotation: number): [number, number] => {
  const r = (rotation * Math.PI) / 180;
  const front = { x: Math.sin(r), y: -Math.cos(r) }; // the footprint's −y, turned
  return [c.x - 0.225 * front.x, c.y - 0.225 * front.y];
};

describe("the tuck rule", () => {
  it("the fixture is valid, and the kinds' seatsUnder name configurations, set exactly for kinds you sit at", () => {
    expect(validateDocument(withDesk()).ok).toBe(true);
    expect(SEAT_BACK).toBe(0.1);
    for (const k of OBJECT_KINDS) {
      expect(k.seatsUnder.length > 0, k.id).toBe(k.sitAt);
      for (const c of k.seatsUnder) expect(k.configs.map((x) => x.id), k.id).toContain(c);
    }
    // The folding units only open: none of them takes a seat folded (seating.16).
    const folding = OBJECT_KINDS.filter((k) => k.sitAt && k.configs.length > 1 && k.seatsUnder.length < k.configs.length);
    expect(folding.map((k) => k.label).sort()).toEqual(["Built-in desk", "Built-in table", "Folding table"]);
    expect(seatsUnderAt("nosuch", "standard")).toBe(false);
  });

  // A seat's backrest is its kind's `seat` column (pieces.09): a depth, or null for a piece that isn't a seat.
  it("every seat has a backrest depth: the chair's SEAT_BACK, the stool none", () => {
    expect(OBJECT_KINDS.filter((k) => k.seat !== null).map((k) => [k.id, k.seat])).toEqual([["chair", SEAT_BACK], ["stool", 0]]);
  });

  it("the back strip is the backrest's depth; with none, the seat is solid nowhere (pieces.09)", () => {
    const pose = { at: { x: 0, y: 0 }, rotation: 0, w: 0.4, d: 0.4 };
    expect(seatStrip(pose, 0)).toEqual([]);
    const strip = seatStrip(pose, SEAT_BACK);
    expect(strip).toHaveLength(4);
    expect(Math.abs(signedArea(strip))).toBeCloseTo(0.4 * SEAT_BACK, 9);
  });

  it("a counter is a solid cabinet: neither a chair nor a stool tucks under it (pieces.14, AC-09)", () => {
    const withCounter = place(room(), { object: "counter", kind: "counter", at: [2, 3.9] });
    expect(judged(withCounter, { at: tucked(0.2), rotation: FACING }).fit.fits).toBe(false);
    expect(placementFit(withCounter, { kind: "stool", state: "s0", at: { x: 2, y: 3.4 }, rotation: FACING, config: "standard", surface: null }).fits).toBe(false);
  });

  it("a stool tucks wholly under a bar table, with no blocked zone (AC-09)", () => {
    for (const kind of ["barTable"]) {
      const base = place(room(), { object: "t", kind, at: [2, 3.9] }); // its front edge on y 3.3
      const doc = place(base, { object: "stool", kind: "stool", at: [2, 3.4], rotation: FACING }); // y 3.4–3.8, wholly under
      expect(validateDocument(doc).ok, kind).toBe(true);
      expect(placementFit(base, { kind: "stool", state: "s0", at: { x: 2, y: 3.4 }, rotation: FACING, config: "standard", surface: null }), kind).toEqual({ fits: true, reason: null });
      expect(zoneBlocks(doc, "s0"), kind).toEqual([]);
    }
  });

  it("chair tucks up to 0.35 m", () => {
    for (const t of [0, 0.2, 0.35]) {
      const pose = { at: tucked(t), rotation: FACING };
      expect(judged(withDesk(), pose), `tuck ${t}`).toEqual(accepted);
      if (t > 0) expect(convexOverlap(chairRing(withChair(withDesk(), pose)), fitShapes(withDesk()).get("desk/s0") ?? [])).toBe(true);
    }
  });

  it("0.36 m is refused with today's overlap message", () => {
    expect(judged(withDesk(), { at: tucked(0.36), rotation: FACING })).toEqual({
      refusals: [collisionMessage({ with: "piece", a: CHAIR, b: DESK, state: withDesk().states.s0?.name ?? "" })],
      fit: { fits: false, reason: "object" },
    });
  });

  it("backrest under is refused: the chair turned 180°, its back 0.05 m under the edge", () => {
    // Rotation 0 faces −y: the back edge is the top one, at the anchor.
    expect(judged(withDesk(), { at: [2, 3.35], rotation: 0 }).fit).toEqual({ fits: false, reason: "object" });
    expect(judged(withDesk(), { at: [2, 3.35], rotation: 0 }).refusals).toHaveLength(1);
  });

  it("side-on is refused: turned 90°, 0.05 m under (the strip spans the width)", () => {
    // Rotation 90 faces +x: x 1.8–2.25 with the strip on x 1.8–1.9, y 2.9–3.35.
    expect(judged(withDesk(), { at: [1.8, 3.125], rotation: 90 }).fit).toEqual({ fits: false, reason: "object" });
    expect(judged(withDesk(), { at: [1.8, 3.125], rotation: 90 }).refusals).toHaveLength(1);
    // The same chair 0.05 m clear of the edge fits.
    expect(judged(withDesk(), { at: [1.8, 3.025], rotation: 90 })).toEqual(accepted);
  });

  it("a corner at 45° is allowed while the strip stays clear", () => {
    // Facing up-left (rotation 225 faces (sin 225, −cos 225)) into the desk's front-right corner (2.6, 3.3), the
    // chair's centre 0.15 m from it, so its front edge's middle is 0.075 m past the corner.
    const rotation = 225;
    const right = { x: 2.6, y: 3.3 };
    const c = { x: right.x + 0.15 * Math.SQRT1_2, y: right.y - 0.15 * Math.SQRT1_2 };
    const pose = { at: anchorFor(c, rotation), rotation };
    expect(convexOverlap(chairRing(withChair(withDesk(), pose)), fitShapes(withDesk()).get("desk/s0") ?? [])).toBe(true);
    expect(judged(withDesk(), pose)).toEqual(accepted);
    // 0.30 m further in, the strip passes the corner.
    const deeper = { x: right.x - 0.15 * Math.SQRT1_2, y: right.y + 0.15 * Math.SQRT1_2 };
    expect(judged(withDesk(), { at: anchorFor(deeper, rotation), rotation }).fit.fits).toBe(false);
  });

  it("non-sitAt pieces still collide: a coffee table, an armchair, another chair", () => {
    // Each piece's front edge on y = 3.3, as the desk's; the chair 0.20 m under it.
    for (const kind of ["coffeeTable", "armchair", "chair"]) {
      const doc = place(room(), { object: "piece", kind, at: [2, 3.9] });
      expect(judged(doc, { at: tucked(0.2 + (0.6 - (doc.objects.piece?.d.standard ?? 0))), rotation: FACING }).fit, kind).toEqual({ fits: false, reason: "object" });
    }
  });

  describe("folded units don't take a seat (seating.16)", () => {
    // The built-in desk: folded x 1.5–2.5, y 3.55–3.9; open (down) y 2.95–3.9.
    const unit = (config: string): Document => place(room(), { object: "unit", kind: "builtInDesk", at: [2, 3.9], config });

    it("folded, it refuses a chair 0.10 m under its front; open, it takes one 0.30 m under", () => {
      expect(judged(unit("folded"), { at: [2, 3.55 + 0.1 - 0.45], rotation: FACING }).fit).toEqual({ fits: false, reason: "object" });
      expect(judged(unit("down"), { at: [2, 2.95 + 0.3 - 0.45], rotation: FACING })).toEqual(accepted);
    });

    it("folding over a tucked chair is refused only where the folded footprint meets it", () => {
      // Facing the open part's front, 0.30 m under: the folded cabinet (from y 3.55) stays clear of the chair (to 3.25).
      const front = withChair(unit("down"), { at: [2, 2.8], rotation: FACING });
      expect(execute(front, { type: "setConfiguration", placementId: "unit/s0", config: "folded" }).ok).toBe(true);
      // Side-on from the left, 0.30 m under the open part's left edge (x 1.5), near the back: x 1.35–1.80, y 3.175–3.625.
      const side = withChair(unit("down"), { at: [1.35, 3.4], rotation: 90 });
      expect(validateDocument(side).ok).toBe(true);
      const folded = execute(side, { type: "setConfiguration", placementId: "unit/s0", config: "folded" });
      expect(folded.ok).toBe(false);
      expect(folded.ok ? [] : folded.error.violations.map((v) => v.invariant)).toEqual(["I11"]);
    });
  });

  describe("same surface only", () => {
    it("a chair on a platform and a desk on the floor that overlap collide (I11 between them)", () => {
      // The platform x 1–3, y 1.5–3.5 (top 0.45); the desk on the floor over its top edge (an I10 of its own).
      const base = withDeck(withDesk(), { id: "plat", at: [2, 2.5], w: 2, d: 2 });
      const doc = withChair(base, { at: [2, 3.0], rotation: FACING, deck: "plat" }); // chair y 3.0–3.45, 0.15 under the desk
      const r = validateDocument(doc);
      const pairs = r.ok ? [] : r.error.filter((v) => v.invariant === "I11").map((v) => v.entities.map((e) => e.id));
      expect(pairs).toEqual([["chair/s0", "desk/s0"]]);
      expect(judged(base, { at: [2, 3.0], rotation: FACING, deck: "plat" }).fit).toEqual({ fits: false, reason: "object" });
    });

    it("both on one platform: allowed", () => {
      // The platform x 1–3, y 1–3.9, flush with the top wall; the desk on it against the wall.
      const base = place(withDeck(room(), { id: "plat", at: [2, 2.45], w: 2, d: 2.9 }), { object: "desk", kind: "desk", at: [2, 3.9], deck: "plat" });
      expect(judged(base, { at: tucked(0.2), rotation: FACING, deck: "plat" })).toEqual(accepted);
      expect(tucks(withChair(base, { at: tucked(0.2), rotation: FACING, deck: "plat" }))).toHaveLength(1);
    });
  });

  it("a chair under two tables (two desks corner to corner) is allowed and tucks lists two entries", () => {
    // Desk A along the top wall (x 1.4–2.6, y 3.3–3.9); desk B facing −x, x 2.6–3.2, y 2.1–3.3, meeting A at (2.6, 3.3).
    const base = place(withDesk(), { object: "deskB", kind: "desk", at: [3.2, 2.7], rotation: 270 });
    expect(validateDocument(base).ok).toBe(true);
    // The chair faces the inner corner (up-right, rotation 135), its front edge's middle 0.075 m past the corner.
    const rotation = 135;
    const c = { x: 2.6 - 0.15 * Math.SQRT1_2, y: 3.3 - 0.15 * Math.SQRT1_2 };
    const pose = { at: anchorFor(c, rotation), rotation };
    expect(judged(base, pose)).toEqual(accepted);
    const listed = tucks(withChair(base, pose));
    expect(listed.map((x) => [x.seat, x.table, x.state]).sort()).toEqual([["chair/s0", "desk/s0", "s0"], ["chair/s0", "deskB/s0", "s0"]]);
    for (const x of listed) expect(Math.abs(signedArea(x.overlap))).toBeGreaterThan(0.001);
  });

  it("tucks lists overlap rings: the area is 0.45 × the tuck for a square tuck", () => {
    for (const t of [0.1, 0.2, 0.35]) {
      const listed = tucks(withChair(withDesk(), { at: tucked(t), rotation: FACING }));
      expect(listed).toHaveLength(1);
      expect(Math.abs(signedArea(listed[0]?.overlap ?? []))).toBeCloseTo(0.45 * t, 9);
    }
    // Touching is not a tuck; nor is a chair in another state.
    expect(tucks(withChair(withDesk(), { at: tucked(0), rotation: FACING }))).toEqual([]);
    expect(tucks(withChair(withDesk(), { at: tucked(0.2), rotation: FACING, state: "s1" }))).toEqual([]);
  });
});
