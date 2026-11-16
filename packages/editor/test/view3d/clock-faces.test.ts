import { describe, expect, it } from "vitest";
import { clockFaces } from "../../src/view3d/clock-faces";
import { newell } from "../../src/view3d/prism";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, PieceItem } from "../../src/view3d/types";

// A round wall clock in 3D (hangings, the user's review): a dark rim, a white dial set back in it, twelve hour marks,
// hands at ten past ten and an orange second hand, all facing the room (−y at rotation 0), inside its box.

function clock(w = 0.3, d = 0.05, h = 0.3, rotation = 0, bottom = 1.8, selected = false): PieceItem {
  const ring = [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }];
  return { item: "piece", placement: "p", object: "o", objectKind: "clock", config: "standard", ring, centre: { x: 0, y: 0 }, rotation, w, d, bottom, top: bottom + h, selected };
}
const facesOf = (item = clock()): Face3d[] => clockFaces("piece/p", item, STYLE_3D) ?? [];
const inSlot = (f: Face3d, slot: keyof typeof STYLE_3D.slots) => Object.values(STYLE_3D.slots[slot]).includes(f.color);

describe("a round wall clock (the user's review)", () => {
  it("lies inside its box, every face owned by the piece, under 200 faces", () => {
    const fs = facesOf();
    expect(fs.length).toBeGreaterThan(30);
    expect(fs.length).toBeLessThan(200);
    for (const p of fs.flatMap((f) => f.points)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.15 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.025 + 1e-9);
      expect(p.z).toBeGreaterThanOrEqual(1.8 - 1e-9);
      expect(p.z).toBeLessThanOrEqual(2.1 + 1e-9);
    }
    expect(new Set(fs.map((f) => f.owner))).toEqual(new Set(["piece/p"]));
  });

  it("is round: its rim's points all lie at the half width from the centre, in the wall's plane", () => {
    const rim = facesOf().filter((f) => inSlot(f, "dark")).flatMap((f) => f.points);
    const r = rim.map((p) => Math.hypot(p.x, p.z - 1.95));
    expect(Math.max(...r)).toBeCloseTo(0.15, 9);
    expect(rim.filter((p) => Math.abs(Math.hypot(p.x, p.z - 1.95) - 0.15) < 1e-9).length).toBeGreaterThanOrEqual(32);
  });

  it("has a white dial facing the room, set back from the rim's front", () => {
    const dial = facesOf().filter((f) => inSlot(f, "ceramic") && f.points.length >= 24);
    expect(dial).toHaveLength(1);
    const d = dial[0];
    expect(d && newell(d.points).y).toBeLessThan(0); // faces −y, the room
    expect(d?.points[0]?.y ?? -1).toBeGreaterThan(-0.025);
  });

  it("has twelve hour marks and three hands: the minute hand longer than the hour hand, the second hand orange", () => {
    const fs = facesOf();
    const dark = fs.filter((f) => inSlot(f, "dark") && f.points.length === 4 && Math.abs(newell(f.points).y) > 1e-12 && f.points.every((p) => p.y > -0.025 + 1e-6));
    const reach = (f: Face3d) => Math.max(...f.points.map((p) => Math.hypot(p.x, p.z - 1.95)));
    const near = (f: Face3d) => Math.min(...f.points.map((p) => Math.hypot(p.x, p.z - 1.95)));
    const marks = dark.filter((f) => near(f) > 0.08);
    const hands = dark.filter((f) => near(f) < 0.03);
    expect(marks).toHaveLength(12);
    expect(hands).toHaveLength(2);
    const [a, b] = hands.map(reach).sort((x, y) => x - y);
    expect(b ?? 0).toBeGreaterThan((a ?? 0) + 0.02);
    expect(fs.some((f) => inSlot(f, "flame") && reach(f) > 0.1)).toBe(true);
  });

  it("turns with the piece, is all blue when selected, and is null for another kind", () => {
    const turned = facesOf(clock(0.3, 0.05, 0.3, 90));
    expect(Math.max(...turned.flatMap((f) => f.points.map((p) => Math.abs(p.y))))).toBeCloseTo(0.15, 9);
    expect(facesOf(clock(0.3, 0.05, 0.3, 0, 1.8, true)).every((f) => Object.values(STYLE_3D.selected).includes(f.color))).toBe(true);
    expect(clockFaces("piece/p", { ...clock(), objectKind: "mirror" }, STYLE_3D)).toBeNull();
  });
});
