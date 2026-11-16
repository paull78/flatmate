import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document, type OpeningKind } from "@fm/domain";
import { REBATE_M, CURTAIN_OFF } from "../../src/view/opening-parts";
import { FRAME_M } from "../../src/view/openings-layer";
import { view3dItems } from "../../src/view3d/items";
import { openingFaces } from "../../src/view3d/opening-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, WallItem } from "../../src/view3d/types";
import { roomDoc, wallBetween } from "../builders";

// The new kinds in 3D (openkinds.04, AC-04): doors open, windows closed, each kind's parts. The fixtures sit on the
// 6 × 4 room's north wall (y = 4, faces 3.9 and 4.1).

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

/** `kind` at x0–x1 on the north wall, opening to `side` (left is the room's side when the wall runs west), whichever way the wall runs. */
export function northOpening(kind: OpeningKind, x0: number, x1: number, fields: Partial<Pick<Extract<Command, { type: "addOpening" }>, "side" | "hinge" | "glazed">> = {}): { doc: Document; faces: Face3d[] } {
  const base = roomDoc();
  const wall = wallBetween(base, { x: 0, y: 4 }, { x: 6, y: 4 });
  const ax = base.joints[base.walls[wall]?.a ?? ""]?.x ?? 0;
  const doc = ok(base, { type: "addOpening", opId: "o", wall, kind, offset: ax === 0 ? x0 : ax - x1, width: x1 - x0, ...fields });
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is WallItem => i.item === "wall" && i.wall === wall);
  if (!item) throw new Error("no north wall");
  return { doc, faces: openingFaces(`wall/${wall}`, item, STYLE_3D) };
}

const r = (v: number) => Math.round(v * 1e6) / 1e6;
export type Box = [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];
function boxOf(faces: readonly Face3d[]): Box {
  const pts = faces.flatMap((f) => f.points);
  const range = (vs: number[]): [number, number] => [r(Math.min(...vs)), r(Math.max(...vs))];
  return [...range(pts.map((p) => p.x)), ...range(pts.map((p) => p.y)), ...range(pts.map((p) => p.z))];
}
const isJoinery = (f: Face3d) => Object.values(STYLE_3D.joinery).includes(f.color);
export const isGlass = (f: Face3d) => f.color === STYLE_3D.glass;

/** The joinery as boxes, sorted by position: `prism` lists a four-sided solid as four sides and a top. */
export function boxes(faces: readonly Face3d[]): Box[] {
  const all = faces.filter(isJoinery);
  expect(all.length % 5).toBe(0);
  return Array.from({ length: all.length / 5 }, (_, k) => boxOf(all.slice(5 * k, 5 * k + 5))).sort((a, b) => a.reduce((d, v, i) => d || v - (b[i] ?? 0), 0));
}
/** The panes as boxes: each is two faces back to back. */
export function panes(faces: readonly Face3d[]): Box[] {
  const all = faces.filter(isGlass);
  expect(all.length % 2).toBe(0);
  return Array.from({ length: all.length / 2 }, (_, k) => boxOf(all.slice(2 * k, 2 * k + 2))).sort((a, b) => a[0] - b[0]);
}

describe("a casement window in 3D", () => {
  it("is a window: four frame sides and one closed pane at the wall's centre", () => {
    const { faces } = northOpening("casement", 2, 2.6);
    expect(boxes(faces)).toHaveLength(4);
    const ps = panes(faces);
    expect(ps).toHaveLength(1);
    expect(ps[0]?.[2]).toBeCloseTo(4, 6);
    expect(ps[0]?.[0]).toBeCloseTo(2 + FRAME_M, 6);
    expect(ps[0]?.[1]).toBeCloseTo(2.6 - FRAME_M, 6);
  });
});

describe("a two-leaf window in 3D", () => {
  it("adds a middle post at the centre and two closed panes, one each side of it", () => {
    const { faces } = northOpening("twoLeaf", 2, 3.2);
    const bs = boxes(faces);
    expect(bs).toHaveLength(5);
    const post = bs.find((b) => b[0] > 2 + FRAME_M && b[1] < 3.2 - FRAME_M);
    expect(post && r((post[0] + post[1]) / 2)).toBeCloseTo(2.6, 6);
    const ps = panes(faces);
    expect(ps).toHaveLength(2);
    expect(ps[0]?.[1]).toBeLessThanOrEqual((post?.[0] ?? 0) + 1e-6);
    expect(ps[1]?.[0]).toBeGreaterThanOrEqual((post?.[1] ?? 0) - 1e-6);
  });
});

describe("a double door in 3D", () => {
  it("stands its two leaves open at 90° from both jambs, on its side, each half the clear span long", () => {
    const { faces } = northOpening("double", 2, 3.2);
    const leaves = boxes(faces).filter((b) => b[2] < 3.9 - 1e-6 || b[3] > 4.1 + 1e-6); // the boxes out of the wall's thickness
    expect(leaves).toHaveLength(2);
    const half = (1.2 - 2 * REBATE_M) / 2; // between the frames' rebates, as on the plan
    for (const b of leaves) expect(r(b[3] - b[2])).toBeCloseTo(half, 6);
    expect(leaves.map((b) => r((b[0] + b[1]) / 2) < 2.6)).toEqual([true, false]); // one at each jamb
    expect(panes(faces)).toEqual([]);
  });
});

describe("a pocket door in 3D", () => {
  it("draws its frame only: the leaf is hidden in the wall", () => {
    const { faces } = northOpening("pocket", 2, 2.8, { hinge: "b" });
    const bs = boxes(faces);
    expect(bs).toHaveLength(3); // two jambs and the head
    expect(bs.every((b) => b[2] >= 3.9 - 1e-6 && b[3] <= 4.1 + 1e-6)).toBe(true);
    expect(panes(faces)).toEqual([]);
  });
});

describe("a folding door in 3D", () => {
  // Hinged at b, opening right: its stack stands at a jamb, centred on a face (openkinds.36, .37).
  const { faces } = northOpening("folding", 2, 2.9, { hinge: "b", side: "right" });
  const frames = faces.slice(0, 15); // the surround first: two jambs and a head, five faces each
  const leaves = faces.slice(15);

  it("draws its frames, and no glass", () => {
    expect(boxes(frames)).toHaveLength(3);
    expect(panes(faces)).toEqual([]);
  });

  it("draws its folded leaves as a zigzag at the hinge end, as the plan does, 0.15 m deep centred on a face", () => {
    const folds = Math.max(2, Math.round(0.9 / 0.13));
    expect(leaves).toHaveLength(2 * folds); // each leaf a sheet, two faces back to back
    const b = boxOfFaces(leaves);
    expect(Math.abs(b[0] - (2 + FRAME_M)) < 1e-6 || Math.abs(b[1] - (2.9 - FRAME_M)) < 1e-6).toBe(true); // from a jamb
    expect(r(b[1] - b[0])).toBeCloseTo(0.1 + 0.11 * 0.9, 6); // foldedLength
    expect(r(b[3] - b[2])).toBeCloseTo(0.15, 6);
    expect([3.9, 4.1].some((face) => Math.abs((b[2] + b[3]) / 2 - face) < 1e-6)).toBe(true);
    expect([b[4], b[5]]).toEqual([0, r(2.1 - FRAME_M)]); // floor to under the head
  });

  it("its leaves take the joinery's lit and shaded tones in turn", () => {
    const one = leaves.filter((_, i) => i % 2 === 0);
    leaves.forEach((f, i) => expect(f.color, `face ${i}`).toBe(leaves[i - (i % 2)]?.color));
    one.forEach((f) => expect([STYLE_3D.joinery.lit, STYLE_3D.joinery.shaded]).toContain(f.color));
    one.slice(1).forEach((f, i) => expect(f.color, `leaf ${i + 1}`).not.toBe(one[i]?.color));
  });
});

describe("a sliding glass door in 3D", () => {
  it("is drawn closed: a frame and two glass panels on offset tracks from the floor, about half the span each", () => {
    const { faces } = northOpening("slidingGlass", 1, 3.4);
    expect(boxes(faces)).toHaveLength(3); // two jambs and the head
    const ps = panes(faces);
    expect(ps).toHaveLength(2);
    expect(ps[0]?.[2]).not.toBeCloseTo(ps[1]?.[2] ?? 0, 6); // two tracks
    for (const p of ps) expect(r((p[1] - p[0]) / (2.4 - 2 * FRAME_M))).toBeGreaterThan(0.45);
    expect(ps.every((p) => p[4] === 0)).toBe(true);
  });
});

describe("the doorways in 3D", () => {
  it("an open passage is the hole only: no frame, leaf or pane", () => {
    expect(northOpening("passage", 2, 2.9).faces).toEqual([]);
  });

  // The curtain (openkinds.33): closed pleats through the plan's wave, CURTAIN_OFF ± 0.03 off its side's face, under a rod.
  const fabricShades: readonly string[] = [STYLE_3D.fabric.lit, STYLE_3D.fabric.shaded];
  const isFabric = (f: Face3d) => fabricShades.includes(f.color);
  const isRod = (f: Face3d) => Object.values(STYLE_3D.rod).includes(f.color);

  it("a curtain is closed pleats through the plan's wave across the span, on its side's face, and no frame", () => {
    const left = northOpening("curtain", 2, 2.8, { side: "left" }).faces;
    const right = northOpening("curtain", 2, 2.8, { side: "right" }).faces;
    for (const faces of [left, right]) {
      expect(faces.filter(isJoinery)).toEqual([]);
      expect(faces.every((f) => isFabric(f) || isRod(f))).toBe(true);
      const b = boxOfFaces(faces.filter(isFabric));
      expect([b[0], b[1]]).toEqual([2, 2.8]);
      const off = b[2] > 4 ? [r(b[2] - 4.1), r(b[3] - 4.1)] : [r(3.9 - b[3]), r(3.9 - b[2])]; // nearest and furthest off the face
      expect(off).toEqual([r(CURTAIN_OFF - 0.03), r(CURTAIN_OFF + 0.03)]);
    }
    expect(boxOfFaces(left)[2] > 4).not.toBe(boxOfFaces(right)[2] > 4); // each on its own side
  });

  it("a curtain's folds take the fabric's lit and shaded tones in turn, one fold per 5 cm", () => {
    const fabric = northOpening("curtain", 2, 2.8).faces.filter(isFabric);
    const folds = fabric.filter((_, i) => i % 2 === 0); // two faces back to back each
    fabric.forEach((f, i) => expect(f.color, `face ${i}`).toBe(fabric[i - (i % 2)]?.color));
    expect(folds.length).toBeGreaterThanOrEqual(16);
    folds.slice(1).forEach((f, i) => expect(f.color, `fold ${i + 1}`).not.toBe(folds[i]?.color));
  });

  it("a curtain hangs 2 cm clear of its bottom, from a 4 cm rod at its head reaching 10 cm past each end (openkinds.34)", () => {
    const faces = northOpening("curtain", 2, 2.8).faces;
    const cloth = boxOfFaces(faces.filter(isFabric));
    const rod = boxOfFaces(faces.filter(isRod));
    expect(cloth[4]).toBe(0.02);
    expect([rod[0], rod[1]]).toEqual([1.9, 2.9]);
    expect([rod[4], rod[5]]).toEqual([2.06, 2.1]);
    expect(r(rod[3] - rod[2])).toBe(0.04);
    expect(rod[4]).toBeGreaterThanOrEqual(cloth[5]);
  });

  it("a curtain's rod stops at its wall's end", () => {
    // The north wall's kept stretch starts at the west wall's inner face, x 0.1: 10 cm past x 0.15 would poke into it.
    const rod = boxOfFaces(northOpening("curtain", 0.15, 0.95).faces.filter(isRod));
    expect([rod[0], rod[1]]).toEqual([0.1, 1.05]);
  });
});

function boxOfFaces(faces: readonly Face3d[]): Box {
  const pts = faces.flatMap((f) => f.points);
  const range = (vs: number[]): [number, number] => [r(Math.min(...vs)), r(Math.max(...vs))];
  return [...range(pts.map((p) => p.x)), ...range(pts.map((p) => p.y)), ...range(pts.map((p) => p.z))];
}
