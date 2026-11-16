import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { faces3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import type { Face3d, PieceItem } from "../../src/view3d/types";
import { roomDoc } from "../builders";
import { visibleFrom } from "./visible";

// The steep stairs in the 3D view (stairs step 12): the ship's ladder is an open flight on side boards; the alternating
// tread adds a centre stringer and puts half treads on alternate sides of it; the rung ladder is two rails and rungs,
// its rails rising 0.9 above the deck it reaches as a handhold, in 3D only (stairs.14): the fit keeps its box.
//
// A 6 × 4 room under a 3.20 ceiling, the loft (top 2.15) over x 0.1–1.9; each stair's back edge on the loft's right
// edge at (1.9, 2), rising toward −x.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const loft: Command = { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 };
const studio = (kind: string): Document =>
  ok(roomDoc(), { type: "setCeiling", height: 3.2 }, loft, { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind }, at: { x: 1.9, y: 2 }, rotation: 90 });
const pieceOf = (doc: Document): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  return item;
};
const flat = (f: Face3d): boolean => f.points.every((p) => Math.abs(p.z - (f.points[0]?.z ?? 0)) < 1e-9);
const round = (v: number): number => Math.round(v * 1000) / 1000;
const zs = (faces: readonly Face3d[]): number[] => faces.flatMap((f) => f.points.map((p) => p.z));
const TO_CAMERA = { x: 0.6, y: -0.8 };

describe("a rung ladder's faces", () => {
  const faces = visibleFrom(faces3d(pieceOf(studio("rungLadder"))), TO_CAMERA);

  it("rise from the floor to 0.9 above the loft it reaches (its rails' handhold)", () => {
    expect(Math.min(...zs(faces))).toBeCloseTo(0, 9);
    expect(Math.max(...zs(faces))).toBeCloseTo(2.15 + 0.9, 9);
  });

  it("draw 7 rungs, their tops at k × 0.269", () => {
    const tops = Array.from({ length: 7 }, (_, i) => round(((i + 1) * 2.15) / 8));
    const flatTops = new Set(faces.filter(flat).map((f) => round(f.points[0]?.z ?? 0)));
    for (const z of tops) expect(flatTops.has(z), `rung at ${z}`).toBe(true);
  });

  it("keep the ladder's box for the fit: a mattress on the loft right behind its top fits (AC-10, stairs.14)", () => {
    // The mattress, 1.6 wide, x 0.3–1.9 and y 1.8–3.8 on the loft: its edge on the ladder's back edge, under the rails.
    const r = execute(studio("rungLadder"), { type: "placeObject", deck: "k/k0", opId: "m", state: "s0", object: { kind: "mattress" }, at: { x: 1.1, y: 3.8 }, rotation: 0 });
    expect(r.ok).toBe(true);
  });
});

describe("the ship's ladder's and the alternating tread's faces", () => {
  it.each([
    ["shipsLadder", 9],
    ["alternatingTread", 10],
  ] as const)("%s: thin treads at k × riser and nothing reaching the floor under its high end", (kind, risers) => {
    const faces = visibleFrom(faces3d(pieceOf(studio(kind))), TO_CAMERA);
    const riser = 2.15 / risers;
    const tops = new Set(faces.filter(flat).map((f) => round(f.points[0]?.z ?? 0)));
    for (let k = 1; k < risers; k++) expect(tops.has(round(k * riser)), `tread ${k}`).toBe(true);
    const high = faces.filter((f) => f.points.every((p) => p.x < 1.9 + 0.3 + 1e-9));
    expect(high.length).toBeGreaterThan(0);
    expect(Math.min(...zs(high))).toBeGreaterThan(1.2);
  });

  it("the alternating tread's half treads alternate sides of its centre line, each on one half", () => {
    const faces = visibleFrom(faces3d(pieceOf(studio("alternatingTread"))), TO_CAMERA);
    const sides: number[] = [];
    for (let k = 1; k <= 9; k++) {
      const top = faces.find((f) => flat(f) && Math.abs((f.points[0]?.z ?? 0) - k * 0.215) < 1e-9);
      const ys = top?.points.map((p) => p.y) ?? [];
      const side = ys.every((y) => y >= 2 - 1e-9) ? 1 : ys.every((y) => y <= 2 + 1e-9) ? -1 : 0;
      sides.push(side);
    }
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.every((s, i) => s !== 0 && (i === 0 || s === -(sides[i - 1] ?? 0)))).toBe(true);
  });
});
