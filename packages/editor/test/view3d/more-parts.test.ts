import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute, type Document } from "@fm/domain";
import { view3dItems } from "../../src/view3d/items";
import { appearanceOf } from "../../src/view3d/parts";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Box3, Part } from "../../src/view3d/parts/types";
import { STYLE_3D } from "../../src/view3d/style";
import { roomDoc, withCommands } from "../builders";
import { PARTS_KINDS, kind, namedSizes, pieceOf } from "./parts-fixtures";

// The plant, cot, radiator and towel rail in 3D (catalog.08, .14, .23; AC-08): each draws convex parts in its box, by
// the rules every kind meets (parts-properties.test.ts, through PARTS_KINDS: inside the shape and range, filling the
// box, no overlaps, more than one part). Local frame: y from the front (−d/2) to the back (d/2), z up from the bottom.

const KINDS = ["plant", "cot", "radiator", "towelRail"] as const;
const FACE_CAP = 150;
const near = (u: number, v: number) => Math.abs(u - v) < 1e-9;
const partsOf = (id: string, w: number, d: number, h: number): readonly Part[] => appearanceOf(id)("standard", w, d, h);
const boxes = (parts: readonly Part[]): Box3[] => parts.flatMap((p) => (p.shape === "box" ? [p.at] : []));
const cylinders = (parts: readonly Part[]): Box3[] => parts.flatMap((p) => (p.shape === "cylinder" ? [p.at] : []));

describe("each new kind's parts", () => {
  it("are checked by the every-kind properties", () => {
    expect(PARTS_KINDS).toEqual(expect.arrayContaining([...KINDS]));
  });

  for (const id of KINDS) {
    it(`${id}: stays under the face cap at its default, presets and 10 m`, () => {
      const k = kind(id);
      const sizes = [...namedSizes(k), { config: "standard", w: 10, d: 10, h: 3, label: "10 m" }];
      for (const s of sizes) {
        const faces = partSolids("o", pieceOf(id, s.config, s.w, s.d, s.h), STYLE_3D).flatMap((p) => p.faces);
        expect(faces.length, s.label).toBeLessThanOrEqual(FACE_CAP);
      }
    });
  }

  it("the plant: a pot at the bottom, its foliage's widest layer the drawn ring (a 12-gon would leave it, parts.12); its layers are plant-parts.test.ts's (hangings.06)", () => {
    const parts = partsOf("plant", 0.4, 0.4, 1.2);
    const pot = cylinders(parts)[0];
    expect(pot?.z0).toBe(0);
    expect((pot?.x1 ?? 0) - (pot?.x0 ?? 0)).toBeLessThan(0.4);
    expect(parts.filter((p) => p.shape === "outline").map((p) => p.slot)).toEqual(["fabric"]);
    expect(Math.max(...parts.map((p) => (p.shape === "box" || p.shape === "cylinder" ? p.at.z1 : p.z1)))).toBe(1.2);
  });

  it("the cot: its base frame, a mattress inside the rails, solid ends and slats down each long side", () => {
    const [w, d, h] = [0.66, 1.26, 0.9];
    const parts = partsOf("cot", w, d, h);
    const linen = parts.filter((p) => p.slot === "linen");
    expect(linen).toHaveLength(1);
    const base = boxes(parts).find((b) => near(b.x0, -w / 2) && near(b.x1, w / 2) && near(b.y0, -d / 2) && near(b.y1, d / 2));
    expect(base?.z0).toBe(0);
    const [mattress] = boxes(linen);
    expect(mattress?.z0).toBeCloseTo(base?.z1 ?? 0, 9);
    expect(mattress?.x0).toBeGreaterThan(-w / 2);
    expect(mattress?.x1).toBeLessThan(w / 2);
    const slats = (x: (b: Box3) => boolean) => boxes(parts).filter((b) => x(b) && b.y1 - b.y0 < 0.1 && b.z1 < h);
    const left = slats((b) => near(b.x0, -w / 2));
    const right = slats((b) => near(b.x1, w / 2));
    expect(left.length).toBeGreaterThanOrEqual(4);
    expect(right).toHaveLength(left.length);
    expect(boxes(parts).some((b) => near(b.z1, h))).toBe(true); // the top rail
  });

  it("the radiator: all boxes, its panels from above its valves to its top (the panels and fittings are hangings-parts.test.ts's)", () => {
    const [w, d, h] = [0.8, 0.1, 0.6];
    const parts = boxes(partsOf("radiator", w, d, h));
    expect(parts.length).toBeGreaterThan(10);
    expect(Math.max(...parts.map((p) => p.z1))).toBe(h);
    expect(Math.min(...parts.map((p) => p.z0))).toBe(0);
    expect(boxes(partsOf("radiator", 0.4, d, h)).length).toBeGreaterThan(2);
  });

  it("the towel rail: all metal, two post cylinders full height, its bars and brackets boxes (the ladder is hangings-parts.test.ts's)", () => {
    const [w, d, h] = [0.5, 0.1, 1.2];
    const parts = partsOf("towelRail", w, d, h);
    expect(parts.every((p) => p.slot === "metal")).toBe(true);
    const posts = cylinders(parts);
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => (p.x1 - p.x0).toFixed(6))).toEqual(["0.040000", "0.040000"]);
    for (const p of posts) expect([p.z0, p.z1]).toEqual([0, h]);
    expect(boxes(parts).length).toBeGreaterThan(10);
  });
});

describe("a rug in 3D: one thin slab of its drawn shape (spec \"New kinds\")", () => {
  for (const [id, w, d] of [["rug", 2, 1.4], ["roundRug", 1.6, 1.6]] as const) {
    it(`${id}: one outline part, 0.01 m thick, under the face cap`, () => {
      expect(partsOf(id, w, d, 0.01)).toEqual([{ shape: "outline", z0: 0, z1: 0.01, slot: "linen" }]);
      const faces = partSolids("o", pieceOf(id, "standard", w, d, 0.01), STYLE_3D).flatMap((p) => p.faces);
      expect(faces.length).toBeGreaterThan(0);
      expect(faces.length).toBeLessThanOrEqual(FACE_CAP);
    });

    it(`${id}: lies 0.00–0.01 in the 3D view, under a sofa standing on it`, () => {
      const room = withCommands(roomDoc(),
        { type: "placeObject", deck: null, opId: "r", state: "s0", object: { kind: id }, at: { x: 3, y: 3 } },
        { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "armchair" }, at: { x: 3, y: 2.6 } });
      const pieces = view3dItems(room, "s0", null, new Set(), false).flatMap((i) => (i.item === "piece" ? [i] : []));
      const rug = pieces.find((p) => p.objectKind === id);
      expect(rug?.bottom).toBe(0);
      expect(rug?.top).toBeCloseTo(0.01, 9);
      expect(pieces.find((p) => p.objectKind === "armchair")?.bottom).toBe(0);
    });
  }

  it("a rug is one slab, so it stays out of the kinds drawn with several parts", () => {
    expect(PARTS_KINDS).not.toContain("rug");
    expect(PARTS_KINDS).not.toContain("roundRug");
  });
});

describe("the radiator and towel rail stand at their elevation in the 3D view", () => {
  const placed = (id: string): Document => unwrap(execute(roomDoc(), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: id }, at: { x: 3, y: 3.9 } })).doc;

  for (const [id, top] of [["radiator", 0.75], ["towelRail", 1.35]] as const) {
    it(`${id}: every part's faces lie in 0.15–${top}`, () => {
      const item = view3dItems(placed(id), "s0", null, new Set(), false).find((i) => i.item === "piece");
      if (item?.item !== "piece") throw new Error("no piece");
      expect(item.bottom).toBe(0.15);
      expect(item.top).toBeCloseTo(top, 9);
      const zs = partSolids("o", item, STYLE_3D).flatMap((p) => p.faces).flatMap((f) => f.points.map((q) => q.z));
      expect(Math.min(...zs)).toBeCloseTo(0.15, 9);
      expect(Math.max(...zs)).toBeCloseTo(top, 9);
    });
  }
});
