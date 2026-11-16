import { describe, expect, it } from "vitest";
import { anchorAtMm, dot, emptyDocument, execute, footprintFit, footprintQuad, levelOf, normalize, perpLeft, quadCentre, rectangleRoom, sub, unwrap, wallBodies, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "../src/snapping/contact";
import { bed160x200, clearRoomDoc, roomDoc, wallDoc, withCommands, ON_FLOOR } from "./builders";

// Contact plus fit (furnish.16): the back within the tolerance straightens and flushes; another side within it turns
// the piece only if the turned, flushed piece fits; a left or right side within it of a second face snaps into the
// corner. roomDoc's inner faces are x 0.1 / 5.9, y 0.1 / 3.9; T = 0.125 (10 px at zoom 80).

const T = 0.125;
const NARROW = clearRoomDoc(1.2, 2.6, "nb"); // faces x 0.1 / 1.3, y 0.1 / 2.7
const ROOM = roomDoc();

function cp(doc: Document, w: number, d: number, x: number, y: number, r: number, ignore: readonly string[] = [], tol = T) {
  return contactPlace(doc, "s0", { w, d }, { x, y }, r, { tolerance: tol, free: false, ignore, riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(doc, null) });
}

/** The signed distance of `quad`'s nearest corner to each long face of `wallId`'s body, positive away from the body. */
function faceGaps(doc: Document, wallId: string, quad: readonly Point[]): { gap: number; centreSide: boolean }[] {
  const [b0, b1, b2, b3] = wallBodies(doc).get(wallId) ?? [];
  if (!b0 || !b1 || !b2 || !b3) throw new Error(`No body for ${wallId}`);
  const centre = quadCentre(quad);
  if (!centre) throw new Error("Degenerate quad");
  return ([[b0, b1, b3], [b2, b3, b1]] as const).map(([p, q, other]) => {
    const dir = normalize(sub(q, p));
    if (!dir) throw new Error("Degenerate face");
    const left = perpLeft(dir);
    const n = dot(sub(other, p), left) < 0 ? left : { x: -left.x, y: -left.y };
    return { gap: Math.min(...quad.map((c) => dot(sub(c, p), n))), centreSide: dot(sub(centre, p), n) > 0 };
  });
}

describe("contactPlace", () => {
  it("AC-01: a 1.00 × 2.10 bed in a 1.20 m room keeps rotation 0 across the room, side gaps included", () => {
    for (let i = 0; i <= 20; i++) {
      const x = Math.round((0.6 + i * 0.01) * 100) / 100;
      expect(cp(NARROW, 1, 2.1, x, 1.4, 0)).toEqual({ at: { x, y: 2.45 }, rotation: 0, flushWalls: [] });
    }
  });

  it("AC-01: the back reaching the head wall lands flush, and the nearer side within 10 px snaps into the corner", () => {
    for (const y of [1.53, 1.58]) {
      expect(cp(NARROW, 1, 2.1, 0.68, y, 0)).toEqual({ at: { x: 0.6, y: 2.7 }, rotation: 0, flushWalls: ["nb-3/w0", "nb-4/w0"] });
    }
    // Equal side gaps: the first face in wall-ID order (nb-2 before nb-4).
    expect(cp(NARROW, 1, 2.1, 0.7, 1.6, 0).at).toEqual({ x: 0.8, y: 2.7 });
  });

  it("the reach is the tolerance given", () => {
    expect(cp(ROOM, 1.7, 2.1, 3, 1.27, 0)).toEqual({ at: { x: 3, y: 0.1 }, rotation: 180, flushWalls: ["room-1/w0"] }); // front gap 0.12
    expect(cp(ROOM, 1.7, 2.1, 3, 1.28, 0)).toEqual({ at: { x: 3, y: 2.33 }, rotation: 0, flushWalls: [] }); // 0.13
    expect(cp(ROOM, 1.7, 2.1, 3, 1.3, 0, [], 0.25)).toMatchObject({ at: { x: 3, y: 0.1 }, rotation: 180 });
    expect(cp(ROOM, 1.7, 2.1, 3, 1.3, 0)).toMatchObject({ at: { x: 3, y: 2.35 }, rotation: 0 });
    // A gap of exactly the tolerance counts (a 1e-9 margin over the sin/cos noise): turned to 270 the piece crosses
    // the top face by 0.25, so the corner takes it and the turn fits.
    let tight = emptyDocument();
    for (const cmd of rectangleRoom({ x: -0.598, y: -1.725 }, 1.39, 3.98, "t", 0.2)) tight = unwrap(execute(tight, cmd)).doc;
    expect(cp(tight, 1.65, 0.46, -0.21, 1.58, 180, [], 0.25)).toMatchObject({ at: { x: 0.692, y: 1.33 }, rotation: 270 });
  });

  it("AC-02: a wardrobe moved along the top wall into the corner keeps rotation 0, back and side flush", () => {
    for (const x of [2, 1.2, 0.84, 0.83]) {
      expect(cp(ROOM, 1.2, 0.6, x, 3.55, 0)).toEqual({ at: { x, y: 3.9 }, rotation: 0, flushWalls: ["room-3/w0"] });
    }
    // Into the corner, even with the box across the left face by up to 0.12.
    for (const x of [0.82, 0.8, 0.7, 0.6, 0.58]) {
      expect(cp(ROOM, 1.2, 0.6, x, 3.55, 0)).toEqual({ at: { x: 0.7, y: 3.9 }, rotation: 0, flushWalls: ["room-3/w0", "room-4/w0"] });
    }
    // 0.13 across the left face: beyond the tolerance.
    expect(cp(ROOM, 1.2, 0.6, 0.57, 3.55, 0)).toEqual({ at: { x: 0.57, y: 3.9 }, rotation: 0, flushWalls: ["room-3/w0"] });
  });

  it("in a corner the face behind the back wins over a nearer side", () => {
    // Back gap 0.10, left gap 0.02.
    expect(cp(ROOM, 1.2, 0.6, 0.72, 3.5, 0)).toMatchObject({ at: { x: 0.7, y: 3.9 }, rotation: 0 });
    // Turned 90 the wardrobe above would cross the top wall, so fit alone refuses the side; a square block turned
    // 90 would fit, so only the order keeps it at 0 (a "nearer face first" build gives 90 at (0.1, 3.6)).
    expect(cp(ROOM, 0.6, 0.6, 0.42, 3.5, 0)).toEqual({ at: { x: 0.4, y: 3.9 }, rotation: 0, flushWalls: ["room-3/w0", "room-4/w0"] });
  });

  it("without a back contact the nearer face wins; on equal gaps the smaller turn", () => {
    const corner = ["room-1/w0", "room-4/w0"];
    const flush = (r: { flushWalls: readonly string[] }) => [...r.flushWalls].sort();
    const a = cp(ROOM, 0.6, 0.6, 0.43, 0.48, 0); // left 0.03, front 0.08
    expect(a).toMatchObject({ at: { x: 0.1, y: 0.4 }, rotation: 90 });
    const b = cp(ROOM, 0.6, 0.6, 0.48, 0.43, 0); // left 0.08, front 0.03
    expect(b).toMatchObject({ at: { x: 0.4, y: 0.1 }, rotation: 180 });
    const c = cp(ROOM, 0.6, 0.6, 0.45, 0.45, 0); // both 0.05: 90° is a smaller turn than 180°
    expect(c).toMatchObject({ at: { x: 0.1, y: 0.4 }, rotation: 90 });
    const e = cp(ROOM, 0.6, 0.6, 0.45, 0.45, 180); // the back already faces the bottom
    expect(e).toMatchObject({ at: { x: 0.4, y: 0.1 }, rotation: 180 });
    // Both faces crossed (left by 0.02, front by 0.10): both count as 0, so the smaller turn wins.
    const f = cp(ROOM, 0.6, 0.6, 0.38, 0.3, 0);
    expect(f).toMatchObject({ at: { x: 0.1, y: 0.4 }, rotation: 90 });
    for (const r of [a, b, c, e, f]) expect(flush(r)).toEqual(corner);
    // The mirror corner, both 0.05: 270 (a −90° turn) is smaller than 180.
    const g = cp(ROOM, 0.6, 0.6, 5.55, 0.45, 0);
    expect(g).toMatchObject({ at: { x: 5.9, y: 0.4 }, rotation: 270 });
  });

  it("AC-03: a side touching a wall in open floor turns the back onto it when it fits; at 90° it stays 90° in open floor", () => {
    for (const x of [0.75, 0.82]) {
      expect(cp(ROOM, 1.2, 0.6, x, 2, 0)).toEqual({ at: { x: 0.1, y: 2 }, rotation: 90, flushWalls: ["room-4/w0"] });
    }
    expect(cp(ROOM, 1.2, 0.6, 0.84, 2, 0)).toEqual({ at: { x: 0.84, y: 2.3 }, rotation: 0, flushWalls: [] }); // gap 0.14
    for (const x of [1, 2, 3, 4, 5, 5.4]) {
      expect(cp(ROOM, 1.2, 0.6, x, 2, 90)).toEqual({ at: { x: Math.round((x - 0.3) * 1000) / 1000, y: 2 }, rotation: 90, flushWalls: [] });
    }
    expect(cp(ROOM, 1.2, 0.6, 0.45, 2, 90)).toMatchObject({ at: { x: 0.1, y: 2 }, rotation: 90 });
  });

  it("a face counts only with the centre on its room side and the piece over its span", () => {
    // The centre across the left face (x 0.05 < 0.1): no contact, the start angle.
    expect(cp(ROOM, 0.3, 0.3, 0.05, 2, 0, [], 0.5)).toEqual({ at: { x: 0.05, y: 2.15 }, rotation: 0, flushWalls: [] });
    // A lone wall along y = 0 from x 0 to 4: past its end no contact, over it flush.
    const wall = wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 });
    expect(cp(wall, 0.6, 0.6, 5, 0.45, 180)).toEqual({ at: { x: 5, y: 0.15 }, rotation: 180, flushWalls: [] });
    expect(cp(wall, 0.6, 0.6, 2, 0.45, 180)).toEqual({ at: { x: 2, y: 0.1 }, rotation: 180, flushWalls: ["w/w0"] });
  });

  it("the back within tolerance straightens a tilted piece", () => {
    for (const y of [3.55, 3.45]) expect(cp(ROOM, 1.2, 0.6, 3, y, 10)).toMatchObject({ at: { x: 3, y: 3.9 }, rotation: 0 });
  });

  it("a face crossed by more than the tolerance does not count", () => {
    expect(cp(ROOM, 1.7, 2.1, 5.6, 2, 0)).toEqual({ at: { x: 5.6, y: 3.05 }, rotation: 0, flushWalls: [] }); // 0.55 across
    for (const x of [5.1, 4.95]) {
      expect(cp(ROOM, 1.7, 2.1, x, 2, 0)).toEqual({ at: { x: 5.9, y: 2 }, rotation: 270, flushWalls: ["room-2/w0"] });
    }
  });

  it("the fit of a turn ignores the pieces in ignore", () => {
    // A 1.60 × 2.00 bed, x 2.2–3.8, y 1–3.
    const doc = withCommands(ROOM, { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3 } }, bed160x200("bed/o0"));
    expect(cp(doc, 1.6, 2, 3, 1.2, 10, ["bed/p0"])).toMatchObject({ at: { x: 3, y: 0.1 }, rotation: 180 });
    // Not ignored, the turned bed overlaps the bed itself: it keeps 10°.
    expect(cp(doc, 1.6, 2, 3, 1.2, 10)).toEqual({ at: anchorAtMm({ x: 3, y: 1.2 }, 2, 10), rotation: 10, flushWalls: [] });
  });

  it("free: the start angle and the anchor to the millimetre, nothing else", () => {
    expect(contactPlace(ROOM, "s0", { w: 1.7, d: 2.1 }, { x: 3, y: 1.25 }, 0, { tolerance: T, free: true, riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(ROOM, null) })).toEqual({ at: { x: 3, y: 2.3 }, rotation: 0, flushWalls: [] });
    const centre = { x: 1.2345, y: 2.3456 };
    expect(contactPlace(ROOM, "s0", { w: 1.2, d: 0.6 }, centre, 30, { tolerance: T, free: true, riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(ROOM, null) })).toEqual({ at: anchorAtMm(centre, 0.6, 30), rotation: 30, flushWalls: [] });
  });

  it("a slanted face: whole degrees, the nearer back corner about 1 mm off it, never inside", () => {
    const doc = wallDoc({ x: 0, y: 0 }, { x: 4, y: 3 }); // 36.87°
    const r = cp(doc, 1.2, 0.6, 2, 1, 37);
    expect(r).toMatchObject({ rotation: 37, flushWalls: ["w/w0"] });
    const face = faceGaps(doc, "w/w0", footprintQuad(r.at, 1.2, 0.6, r.rotation)).find((f) => f.centreSide);
    expect(face?.gap).toBeGreaterThanOrEqual(0);
    // The target is 1 mm; rounding the anchor to the millimetre moves it up to 0.71 mm along the normal.
    expect(face?.gap).toBeLessThan(0.002);
  });

  it("fuzz (seeded): stateless, turns only with a flush and a fit, flush gaps under 1 mm, bounded moves", () => {
    const rand = rng(7);
    const pick = (xs: readonly number[]): number => xs[Math.floor(rand() * xs.length)] ?? 0;
    // Uniform in [lo, hi], to 1 / `per` (100: the centimetre, 1000: the millimetre).
    const between = (lo: number, hi: number, per: number) => Math.round((lo + rand() * (hi - lo)) * per) / per;
    const failures: string[] = [];
    for (let i = 0; i < 500; i++) {
      const W = between(1, 4, 100);
      const H = between(1, 4, 100);
      const origin = { x: between(-2, 2, 1000), y: between(-2, 2, 1000) };
      const thickness = pick([0.1, 0.15, 0.2, 0.3]);
      let doc = emptyDocument();
      for (const cmd of rectangleRoom(origin, W, H, "f", thickness)) doc = unwrap(execute(doc, cmd)).doc;
      const w = between(0.3, 2.1, 100);
      const d = between(0.3, 2.1, 100);
      const tol = 10 / pick([20, 40, 80, 160, 320]);
      const centre = { x: origin.x + between(0, W, 100), y: origin.y + between(0, H, 100) };
      const start = pick([0, 90, 180, 270]);
      const opts = { tolerance: tol, free: false, riser: null, heights: ON_FLOOR, surface: null, land: false as const, level: levelOf(doc, null) };
      const r = contactPlace(doc, "s0", { w, d }, centre, start, opts);
      const tag = `#${i} room ${W}×${H} at (${origin.x}, ${origin.y}) t ${thickness}, piece ${w}×${d} at (${centre.x}, ${centre.y}) from ${start}°, tol ${tol}`;
      // (a) stateless
      const again = contactPlace(doc, "s0", { w, d }, centre, start, opts);
      if (JSON.stringify(again) !== JSON.stringify(r)) failures.push(`${tag}: two calls differ`);
      const quad = footprintQuad(r.at, w, d, r.rotation);
      // (b) every flush wall is under 1 mm away
      for (const id of r.flushWalls) {
        if (!faceGaps(doc, id, quad).some((f) => Math.abs(f.gap) < 0.001)) failures.push(`${tag}: ${id} not flush`);
      }
      // (c) a turn comes with a flush and a fit
      if (r.rotation !== start && (r.flushWalls.length === 0 || !footprintFit(doc, quad, "s0", ON_FLOOR, null).fits)) failures.push(`${tag}: turned to ${r.rotation} without flush and fit`);
      // (d) bounded moves
      const c = quadCentre(quad);
      const bound = 2 * tol + Math.abs(w - d) / 2 + 1e-9;
      if (!c || Math.abs(c.x - centre.x) > bound || Math.abs(c.y - centre.y) > bound) failures.push(`${tag}: moved to (${c?.x}, ${c?.y})`);
    }
    expect(failures).toEqual([]);
  });
});

/** mulberry32, as packages/domain/test/helpers.ts `rng`: a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
