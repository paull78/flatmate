import { describe, expect, it } from "vitest";
import { inConvex, kindOf, shapeRing, useZones } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import { objectsLayer } from "../src/view/objects-layer";
import { PALETTE_KINDS } from "../src/view/palette";
import { pictureLayers, planPicture } from "../src/view/picture";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";
import { place } from "./object-look-helpers";
import { floorView } from "../src/view/plan-view";

// The bathroom pieces' symbols (furnish.13, .22, AC-13): each its own detail set, inside its footprint and its shape.

type Segment = Extract<Primitive, { kind: "segment" }>;
type Arc = Extract<Primitive, { kind: "arc" }>;

/** The detail lines: the outline and the front take the line colour "L", so only the symbol's inner parts are "D". */
const D = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 1, detail: "D" }).filter((p) => p.color === "D");
const segs = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const arcs = (ps: readonly Primitive[]): Arc[] => ps.flatMap((p) => (p.kind === "arc" ? [p] : []));
const full = (a: Arc) => Math.abs(a.to - a.from - 2 * Math.PI) < 1e-12;
const quarter = (a: Arc) => Math.abs(a.to - a.from - Math.PI / 2) < 1e-12;

function expectPoint(p: { x: number; y: number } | undefined, x: number, y: number, label?: string) {
  expect(p?.x, label).toBeCloseTo(x, 6);
  expect(p?.y, label).toBeCloseTo(y, 6);
}
function expectFullArc(ps: readonly Primitive[], cx: number, cy: number, r: number) {
  const round = arcs(ps).filter(full);
  expect(round).toHaveLength(1);
  expectPoint(round[0]?.center, cx, cy);
  expect(round[0]?.radius).toBeCloseTo(r, 6);
}
/** Whether a segment joins these two points, in either direction (1e-6). */
const joins = (s: Segment, ax: number, ay: number, bx: number, by: number) => {
  const at = (p: { x: number; y: number }, x: number, y: number) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6;
  return (at(s.a, ax, ay) && at(s.b, bx, by)) || (at(s.a, bx, by) && at(s.b, ax, ay));
};

const BATH: [id: string, w: number, d: number, zone: number, counts: [segments: number, arcs: number]][] = [
  ["toilet", 0.36, 0.54, 0.6, [32, 0]],
  ["bidet", 0.36, 0.54, 0.6, [32, 1]],
  ["washbasin", 0.6, 0.45, 0.7, [8, 9]],
  ["vanityUnit", 1, 0.5, 0.7, [8, 9]],
  ["cornerBasin", 0.45, 0.45, 0.6, [0, 1]],
  ["showerTray", 0.8, 0.8, 0.7, [8, 2]],
  ["cornerShower", 0.8, 0.8, 0.7, [8, 1]],
  ["bathtub", 1.7, 0.7, 0.7, [8, 5]],
  ["washingMachine", 0.6, 0.6, 0.7, [1, 1]],
];

describe("bathroom symbols (AC-13)", () => {
  it("each bathroom kind draws its own detail set (AC-13)", () => {
    for (const [id, w, d, , [s, a]] of BATH) {
      const detail = D(id, w, d);
      expect([segs(detail).length, arcs(detail).length], id).toEqual([s, a]);
      expect(detail.length, id).toBe(s + a);
    }
  });

  it("toilet: from 0.60 m deep, a cistern band at the back and an oval bowl in front of it (symbols AC-02)", () => {
    const detail = segs(D("toilet", 0.4, 0.65));
    expect(detail[0]?.a).toEqual({ x: expect.closeTo(-0.192, 6), y: expect.closeTo(-0.17, 6) });
    expect(detail[0]?.b).toEqual({ x: expect.closeTo(0.192, 6), y: expect.closeTo(-0.17, 6) });
    expect(detail).toHaveLength(33);
    const bowl = detail.slice(1).flatMap((s) => [s.a, s.b]);
    expect(Math.max(...bowl.map((p) => p.y))).toBeLessThan(-0.17);
    expect(Math.min(...bowl.map((p) => p.y))).toBeGreaterThan(-0.65);
  });

  it("bidet: a pan, an inner oval, a tap with a spout and a drain, inside its ring (symbols AC-04)", () => {
    const [w, d] = [0.36, 0.54];
    expect(kindOf("bidet")).toMatchObject({ outline: "pan", front: false });
    expect(kindOf("bidet")?.configs[0]).toMatchObject({ w, d, h: 0.42 });
    const detail = D("bidet", w, d);
    expect(segs(detail)).toHaveLength(32); // the oval
    expectFullArc(detail, 0, -0.6 * d, 0.03 * w); // the drain, in the oval
    const look = objectLook("bidet", "standard", w, d, { line: "L", frontPx: 9, detail: "D" });
    const lines = look.filter((p) => p.color === "L");
    const tap = arcs(lines);
    expect(tap).toHaveLength(1); // the tap's ring, in the outline's stronger line
    const spout = segs(lines).filter((s) => Math.abs(s.a.x) < 1e-9 && Math.abs(s.b.x) < 1e-9);
    expect(spout).toHaveLength(1);
    expect(look.some((p) => p.kind === "segment" && "px" in p.width && p.width.px === 9)).toBe(false);
    for (const [ww, dd] of [[w, d], [0.4, 0.55], [0.1, 0.1], [3, 3]] as const) {
      const ring = shapeRing("pan", ww, dd);
      const points = furnitureSymbol("bidet", "standard", ww, dd).flatMap((p) => (p.kind === "segment" ? [p.a, p.b] : p.kind === "arc" ? [p.center] : []));
      for (const p of points) expect(inConvex(p, ring, 1e-9), `${ww} × ${dd}: ${p.x}, ${p.y}`).toBe(true);
    }
    expect(furnitureSymbol("toilet", "standard", w, d)).not.toEqual(furnitureSymbol("bidet", "standard", w, d));
  });

  it("washbasin: a soft outline, a double-rim basin, a drain, and a tap with a spout, with no heavier front (symbols AC-05)", () => {
    const [w, d] = [0.6, 0.45];
    expect(kindOf("washbasin")).toMatchObject({ outline: "soft", front: false });
    const detail = D("washbasin", w, d);
    expect(arcs(detail).filter(quarter)).toHaveLength(8); // two rims of four corners
    expect(arcs(detail).filter(full)).toHaveLength(1); // the drain
    expect(segs(detail)).toHaveLength(8);
    const look = objectLook("washbasin", "standard", w, d, { line: "L", frontPx: 9, detail: "D" });
    expect(arcs(look.filter((p) => p.color === "L"))).toHaveLength(1); // the tap
    expect(look.some((p) => p.kind === "segment" && "px" in p.width && p.width.px === 9)).toBe(false);
    for (const [ww, dd] of [[0.5, 0.4], [0.6, 0.45], [0.8, 0.5], [0.1, 0.1], [10, 0.1], [3, 3]] as const) {
      const ring = shapeRing("soft", ww, dd);
      const points = furnitureSymbol("washbasin", "standard", ww, dd).flatMap((p) => (p.kind === "segment" ? [p.a, p.b] : p.kind === "arc" ? [p.center] : []));
      for (const p of points) expect(inConvex(p, ring, 1e-9), `${ww} × ${dd}: ${p.x}, ${p.y}`).toBe(true);
    }
  });

  // The shower tray and the bathtub were redrawn in the seating cycle: storage-bathroom-symbols.test.ts (seating.04).

  it("washing machine: a control strip and a round door", () => {
    const detail = D("washingMachine", 0.6, 0.6);
    expectFullArc(detail, 0, -0.33, 0.18);
    const strip = segs(detail);
    expect(strip).toHaveLength(1);
    expect(strip.some((s) => joins(s, -0.3, -0.09, 0.3, -0.09))).toBe(true);
  });

  it("corner basin: the bowl sits in the triangle's incircle", () => {
    expectFullArc(D("cornerBasin", 0.45, 0.45), -0.093198, -0.131802, 0.092261);
    expectFullArc(D("cornerBasin", 0.6, 0.45), -0.15, -0.15, 0.105);
  });

  it("corner shower: the rim curve and the drain", () => {
    const detail = D("cornerShower", 0.8, 0.8);
    const rim = segs(detail);
    expect(rim).toHaveLength(8);
    expectPoint(rim[0]?.a, 0.28, 0);
    expectPoint(rim.at(-1)?.b, -0.4, -0.68);
    for (const s of rim) for (const p of [s.a, s.b]) expect(Math.abs(((p.x + 0.4) / 0.8) ** 2 + (p.y / 0.8) ** 2 - 0.7225)).toBeLessThan(1e-9);
    rim.slice(1).forEach((s, i) => expectPoint(s.a, rim[i]?.b.x ?? NaN, rim[i]?.b.y ?? NaN, `rim joint ${i}`));
    expectFullArc(detail, -0.16, -0.24, 0.032);
  });

  it("corner pieces fill their shape, selected or not (AC-13, shapefit.01)", () => {
    for (const [kind, w, d, n] of [["cornerBasin", 0.45, 0.45, 3], ["cornerShower", 0.8, 0.8, 10], ["showerTray", 0.8, 0.8, 4]] as const) {
      const doc = place(kind, "standard", w, d);
      const [fill] = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
      expect(fill, kind).toMatchObject({ kind: "polygon", color: CANVAS_STYLE.objectFill });
      expect(fill?.kind === "polygon" ? fill.points : [], kind).toHaveLength(n);
      const [selected] = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "p", 80);
      expect(selected, kind).toMatchObject({ kind: "polygon", color: COLORS.objectSelected });
      expect(selected?.kind === "polygon" ? selected.points : [], kind).toHaveLength(n);
    }
  });

  it("the export picture draws the corner basin's triangle and its bowl", () => {
    const drawn = pictureLayers(planPicture(place("cornerBasin", "standard", 0.45, 0.45), floorView(place("cornerBasin", "standard", 0.45, 0.45), "s0"), PRESENTATION_STYLE, 20, true));
    const fills = drawn.flatMap((p) => (p.kind === "polygon" && p.color === PRESENTATION_STYLE.objectFill ? [p] : []));
    expect(fills).toHaveLength(1);
    expect(fills[0]?.points).toHaveLength(3);
    expect(arcs(drawn).some((a) => Math.abs(a.radius - 0.092261) < 1e-6)).toBe(true);
  });

  it("each bathroom tile is in the Bathroom group and a click places it at its default size with one front zone (AC-13)", () => {
    expect(PALETTE_KINDS.find((g) => g.group === "Bathroom")?.cards.map((k) => k.kind)).toEqual([...BATH.map(([id]) => id), "towelRail"]); // the towel rail has no zone: more-symbols.test.ts
    for (const [kind, w, d, zone] of BATH) {
      const shell = FakeShell.withDocument(roomDoc());
      shell.ui({ type: "pickKind", kind });
      shell.click({ x: 3, y: 2 });
      const objects = Object.values(shell.doc().objects);
      expect(objects.map((o) => [o.kind, o.w.standard, o.d.standard]), kind).toEqual([[kind, w, d]]);
      const placements = Object.values(shell.doc().placements);
      expect(placements, kind).toHaveLength(1);
      const p = placements[0];
      if (!p) throw new Error(`no placement for ${kind}`);
      expect(p.rotation, kind).toBe(0);
      expect(Math.abs(p.at.x - 3), kind).toBeLessThan(1e-9);
      expect(Math.abs(p.at.y - (2 + d / 2)), kind).toBeLessThan(1e-9);
      const bands = useZones(shell.doc()).get(p.id) ?? [];
      expect(bands.map((b) => b.side), kind).toEqual(["front"]);
      const xs = (bands[0]?.quad ?? []).map((q) => q.x);
      const ys = (bands[0]?.quad ?? []).map((q) => q.y);
      expect(Math.min(...xs), kind).toBeCloseTo(3 - w / 2, 9);
      expect(Math.max(...xs), kind).toBeCloseTo(3 + w / 2, 9);
      expect(Math.min(...ys), kind).toBeCloseTo(2 - d / 2 - zone, 9);
      expect(Math.max(...ys), kind).toBeCloseTo(2 - d / 2, 9);
      if (kind === "toilet") expect([Math.min(...ys), Math.max(...ys)]).toEqual([expect.closeTo(1.13, 9), expect.closeTo(1.73, 9)]);
      if (kind === "bathtub") expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([2.15, 3.85, 0.95, 1.65].map((v) => expect.closeTo(v, 9)));
    }
  });
});
