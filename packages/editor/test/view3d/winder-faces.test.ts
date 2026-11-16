import { describe, expect, it } from "vitest";
import { STAIR_RULES, execute, stairGeometry, unwrap, winderTreads, type Command, type Document } from "@fm/domain";
import { faces3d } from "../../src/view3d/faces";
import { handrailFaces } from "../../src/view3d/handrail-faces";
import { placer } from "../../src/view3d/local-frame";
import { STYLE_3D } from "../../src/view3d/style";
import { view3dItems } from "../../src/view3d/items";
import type { Face3d, PieceItem } from "../../src/view3d/types";
import { roomDoc } from "../builders";

// A Winder stair in 3D (steps.04, AC-04, AC-06): three winder blocks topped by the treads' outlines at 1, 2 and 3
// risers, then the straight blocks; "Enters from the left" mirrors them; its handrails start where the straight part
// does. Its back edge's middle at (3, 3.8), front toward −y: 0.90 wide (x 2.55–3.45), 3.07 deep (y 0.73–3.80), 12 risers.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const winder: Command = { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "winderStair" }, at: { x: 3, y: 3.8 }, rotation: 0 };
const itemOf = (doc: Document): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  return item;
};
const body = (item: PieceItem): PieceItem => {
  const b = { ...item };
  delete b.handrails;
  return b;
};
const D = 3.07;
const R = 2.15 / 12;
const topAt = (faces: readonly Face3d[], z: number): Face3d[] => faces.filter((f) => f.points.every((p) => Math.abs(p.z - z) < 1e-9));
const key = (ps: readonly { x: number; y: number }[]): string[] => ps.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort();

describe("a winder's faces (AC-06)", () => {
  it("three winder blocks whose tops are the treads' outlines at 1, 2 and 3 risers, then 8 straight blocks", () => {
    const faces = faces3d(body(itemOf(ok(roomDoc(), winder))));
    const world = winderTreads(0.9, false).map((ring) => ring.map((p) => ({ x: 3 + p.x, y: 3.8 - D + p.y })));
    world.forEach((ring, i) => {
      const tops = topAt(faces, (i + 1) * R);
      expect(tops.map((t) => key(t.points)), `tread ${i + 1}`).toContainEqual(key(ring));
    });
    const straight = [4, 5, 6, 7, 8, 9, 10, 11].map((k) => topAt(faces, k * R).filter((f) => f.points.length === 4));
    for (const tops of straight) expect(tops.length).toBeGreaterThanOrEqual(1);
    // The first straight block starts at the square's back (y 3.8 − 3.07 + 0.90).
    const first = straight[0]?.[0];
    expect(Math.min(...(first?.points.map((p) => p.y) ?? [0]))).toBeCloseTo(3.8 - D + 0.9, 6);
  });

  it("Enters from the left mirrors the winder blocks across the stair", () => {
    const left = ok(roomDoc(), winder, { type: "setOption", objectId: "w/o0", option: "leftEntry", on: true });
    const faces = faces3d(body(itemOf(left)));
    const mirrored = winderTreads(0.9, true).map((ring) => ring.map((p) => ({ x: 3 + p.x, y: 3.8 - D + p.y })));
    expect(topAt(faces, R).map((t) => key(t.points))).toContainEqual(key(mirrored[0] ?? []));
  });

  it("its handrails start where the straight part starts", () => {
    const item = itemOf(ok(roomDoc(), winder));
    const g = stairGeometry(STAIR_RULES.winder, item.w, item.d, item.top - item.bottom, null);
    const rails = handrailFaces("piece/w/p0", item, STYLE_3D.stair, g, placer(item), STYLE_3D.glass);
    expect(rails.length).toBeGreaterThan(0);
    const ys = rails.flatMap((f) => f.points.map((p) => p.y));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(3.8 - D + 0.9 - 0.03);
  });
});
