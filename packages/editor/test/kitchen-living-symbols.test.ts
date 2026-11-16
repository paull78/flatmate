import { describe, expect, it } from "vitest";
import { useZones } from "@fm/domain";
import type { Point } from "@fm/protocol";
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

// The kitchen modules, the living pieces, the TV unit and the nightstand (furnish.11, .13, .22, AC-13): each its own
// detail set, inside its footprint. Footprint space: x from −w/2 to w/2, y from −d to 0, the back at y = 0.

type Segment = Extract<Primitive, { kind: "segment" }>;
type Arc = Extract<Primitive, { kind: "arc" }>;

/** The detail lines: the outline and the front take the line colour "L", so only the symbol's inner parts are "D". */
const D = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 1, detail: "D" }).filter((p) => p.color === "D");
const segs = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const arcs = (ps: readonly Primitive[]): Arc[] => ps.flatMap((p) => (p.kind === "arc" ? [p] : []));
const full = (a: Arc) => Math.abs(a.to - a.from - 2 * Math.PI) < 1e-12;
const quarter = (a: Arc) => Math.abs(a.to - a.from - Math.PI / 2) < 1e-12;
const ends = (ps: readonly Primitive[]): Point[] => segs(ps).flatMap((s) => [s.a, s.b]);

/** Whether a segment joins these two points, in either direction (1e-6). */
const joins = (s: Segment, ax: number, ay: number, bx: number, by: number) => {
  const at = (p: Point, x: number, y: number) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6;
  return (at(s.a, ax, ay) && at(s.b, bx, by)) || (at(s.a, bx, by) && at(s.b, ax, ay));
};
/** The segments are exactly these, in any order and direction. */
function expectSegments(actual: readonly Segment[], expected: readonly (readonly [number, number, number, number])[], label: string) {
  expect(actual, label).toHaveLength(expected.length);
  for (const [ax, ay, bx, by] of expected) expect(actual.some((s) => joins(s, ax, ay, bx, by)), `${label} ${ax},${ay}–${bx},${by}`).toBe(true);
}
/** The rectangle [x0, x1] × [y0, y1] as four segments. */
const box = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]] as const;
/** The full arcs are exactly these [cx, cy, r], in any order. */
function expectFullArcs(actual: readonly Arc[], expected: readonly (readonly [number, number, number])[], label: string) {
  const round = actual.filter(full);
  expect(round, label).toHaveLength(expected.length);
  for (const [cx, cy, r] of expected) {
    const found = round.some((a) => Math.abs(a.center.x - cx) < 1e-6 && Math.abs(a.center.y - cy) < 1e-6 && Math.abs(a.radius - r) < 1e-6);
    expect(found, `${label} arc ${cx},${cy} r ${r}`).toBe(true);
  }
}

const KINDS: [id: string, w: number, d: number, zone: number | null, sides: { front: boolean; back: boolean; left: boolean; right: boolean }][] = [
  ["hobUnit", 0.6, 0.6, 1, { front: true, back: false, left: false, right: false }],
  ["sinkUnit", 0.8, 0.6, 1, { front: true, back: false, left: false, right: false }],
  ["counter", 0.6, 0.6, 1, { front: true, back: false, left: false, right: false }],
  ["fridge", 0.6, 0.65, 1, { front: true, back: false, left: false, right: false }],
  ["dishwasher", 0.6, 0.6, 1, { front: true, back: false, left: false, right: false }],
  ["ovenColumn", 0.6, 0.6, 1, { front: true, back: false, left: false, right: false }],
  ["roundTable", 0.9, 0.9, 0.6, { front: true, back: true, left: true, right: true }],
  ["armchair", 0.8, 0.8, 0.5, { front: true, back: false, left: false, right: false }],
  ["coffeeTable", 1, 0.5, null, { front: false, back: false, left: false, right: false }],
  ["tvUnit", 1.2, 0.4, null, { front: false, back: false, left: false, right: false }],
  ["nightstand", 0.45, 0.4, null, { front: false, back: false, left: false, right: false }],
];

describe("kitchen and living symbols (AC-13)", () => {
  it("the hob unit draws its glass plate and four rings, two large on one diagonal", () => {
    const detail = D("hobUnit", 0.6, 0.6);
    expectSegments(segs(detail), box(-0.264, -0.564, 0.264, -0.036), "hob plate");
    expect(arcs(detail)).toHaveLength(4);
    expectFullArcs(arcs(detail), [[-0.15, -0.15, 0.096], [0.15, -0.15, 0.066], [-0.15, -0.45, 0.066], [0.15, -0.45, 0.096]], "hob");
    expect(detail).toHaveLength(8);
  });

  it("the sink unit draws a bowl with a drain on its left half and four drainer ribs on its right half", () => {
    const detail = D("sinkUnit", 0.8, 0.6);
    expect([segs(detail).length, arcs(detail).length]).toEqual([8, 5]);
    const corners = arcs(detail).filter(quarter);
    expect(corners).toHaveLength(4);
    for (const c of corners) expect(c.radius).toBeCloseTo(0.09, 6);
    expectFullArcs(arcs(detail), [[-0.182, -0.3, 0.03]], "drain");
    const bowl = [...segs(detail).filter((s) => s.a.x < 0), ...corners];
    const bowlReach = [...ends(bowl), ...corners.flatMap((c) => [{ x: c.center.x - c.radius, y: c.center.y - c.radius }, { x: c.center.x + c.radius, y: c.center.y + c.radius }])];
    expect(Math.min(...bowlReach.map((p) => p.x))).toBeCloseTo(-0.328, 6);
    expect(Math.max(...bowlReach.map((p) => p.x))).toBeCloseTo(-0.036, 6);
    expect(Math.min(...bowlReach.map((p) => p.y))).toBeCloseTo(-0.528, 6);
    expect(Math.max(...bowlReach.map((p) => p.y))).toBeCloseTo(-0.072, 6);
    const ribs = segs(detail).filter((s) => Math.abs(s.a.y - s.b.y) < 1e-12 && s.a.x > 0);
    expectSegments(ribs, [-0.1632, -0.2544, -0.3456, -0.4368].map((y) => [0.036, y, 0.328, y] as const), "ribs");
    // The bowl and drain on the left half, the ribs on the right: a mirrored sink fails.
    for (const a of arcs(detail)) expect(a.center.x + a.radius).toBeLessThanOrEqual(-0.036 + 1e-9);
    for (const p of ends(segs(detail).filter((s) => !ribs.includes(s)))) expect(p.x).toBeLessThanOrEqual(-0.036 + 1e-9);
    for (const p of ends(ribs)) expect(p.x).toBeGreaterThanOrEqual(0.036 - 1e-9);

    const wide = D("sinkUnit", 1.2, 0.6);
    expectFullArcs(arcs(wide), [[-0.282, -0.3, 0.03]], "wide drain");
    expect(Math.max(...ends(wide).map((p) => p.x))).toBeCloseTo(0.528, 6);
  });

  it("the counter draws its worktop edge", () => {
    const detail = D("counter", 0.6, 0.6);
    expect(detail).toHaveLength(1);
    expectSegments(segs(detail), [[-0.3, -0.564, 0.3, -0.564]], "counter");
  });

  it("fridge, dishwasher and oven column share a door line and differ behind it", () => {
    const fridge = D("fridge", 0.6, 0.65);
    expect(arcs(fridge)).toEqual([]);
    expectSegments(segs(fridge), [[-0.3, -0.572, 0.3, -0.572], [-0.3, 0, 0.3, -0.572], [0.3, 0, -0.3, -0.572]], "fridge");

    const dishwasher = D("dishwasher", 0.6, 0.6);
    expectSegments(segs(dishwasher), [[-0.3, -0.528, 0.3, -0.528], [-0.228, -0.264, 0.228, -0.264]], "dishwasher");
    expect(arcs(dishwasher)).toHaveLength(1);
    expectFullArcs(arcs(dishwasher), [[0, -0.264, 0.03]], "dishwasher hub");

    const oven = D("ovenColumn", 0.6, 0.6);
    expectSegments(segs(oven), [[-0.3, -0.528, 0.3, -0.528], ...box(-0.228, -0.456, 0.228, -0.072)], "oven");
    expect(arcs(oven)).toHaveLength(1);
    expectFullArcs(arcs(oven), [[0, -0.264, 0.072]], "oven fan");

    const [f, w, o] = ["fridge", "dishwasher", "ovenColumn"].map((k) => furnitureSymbol(k, "standard", 0.6, 0.6));
    expect(f).not.toEqual(w);
    expect(w).not.toEqual(o);
    expect(f).not.toEqual(o);
  });

  it("the round table draws a circle with an inner ring, filled and highlighted as a circle (AC-13, shapefit.01)", () => {
    const ring = D("roundTable", 0.9, 0.9);
    expect([segs(ring).length, ring.length]).toEqual([16, 16]);
    for (const p of ends(ring)) expect(Math.abs(Math.hypot(p.x, p.y + 0.45) - 0.36)).toBeLessThan(1e-9);
    expect(Math.max(...ends(ring).map((p) => p.x))).toBeCloseTo(0.36, 9);
    for (const p of ends(D("roundTable", 1.2, 0.6))) expect(Math.abs((p.x / 0.48) ** 2 + ((p.y + 0.3) / 0.24) ** 2 - 1)).toBeLessThan(1e-9);

    const doc = place("roundTable", "standard", 0.9, 0.9);
    const [fill] = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    expect(fill).toMatchObject({ kind: "polygon", color: CANVAS_STYLE.objectFill });
    expect(fill?.kind === "polygon" ? fill.points : []).toHaveLength(32);
    const [selected] = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "p", 80);
    expect(selected).toMatchObject({ kind: "polygon", color: COLORS.objectSelected });
    expect(selected?.kind === "polygon" ? selected.points : []).toHaveLength(32);
    const drawn = pictureLayers(planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true));
    const fills = drawn.flatMap((p) => (p.kind === "polygon" && p.color === PRESENTATION_STYLE.objectFill ? [p] : []));
    expect(fills).toHaveLength(1);
    expect(fills[0]?.points).toHaveLength(32);
  });

  it("the armchair draws arms, back and a seat cushion, always one seat", () => {
    const detail = D("armchair", 0.8, 0.8);
    expect([segs(detail).length, arcs(detail).length]).toEqual([7, 4]);
    for (const a of arcs(detail)) {
      expect(quarter(a)).toBe(true);
      expect(a.radius).toBeCloseTo(0.08, 6);
    }
    for (const [ax, ay, bx, by] of [[-0.25, 0, -0.25, -0.8], [0.25, 0, 0.25, -0.8], [-0.25, -0.224, 0.25, -0.224], [-0.122, -0.752, 0.122, -0.752]] as const) {
      expect(segs(detail).some((s) => joins(s, ax, ay, bx, by)), `armchair ${ax},${ay}`).toBe(true);
    }
    expect(D("armchair", 2.1, 0.9)).toHaveLength(11);
    expect(D("sofa", 2.1, 0.9)).toHaveLength(3 + 3 * 8); // arms, back and three rounded cushions at this width (seating.03)
    expect(furnitureSymbol("armchair", "standard", 0.8, 0.8)).not.toEqual(furnitureSymbol("sofa", "standard", 0.8, 0.8));
  });

  it("the coffee table draws an inset top with round corners", () => {
    const detail = D("coffeeTable", 1, 0.5);
    expectSegments(segs(detail), [[-0.37, -0.47, 0.37, -0.47], [0.47, -0.37, 0.47, -0.13], [0.37, -0.03, -0.37, -0.03], [-0.47, -0.13, -0.47, -0.37]], "coffee table");
    expect(arcs(detail)).toHaveLength(4);
    for (const a of arcs(detail)) {
      expect(quarter(a)).toBe(true);
      expect(a.radius).toBeCloseTo(0.1, 6);
    }
    expect(furnitureSymbol("coffeeTable", "standard", 1, 0.5)).not.toEqual(furnitureSymbol("extendingTable", "closed", 1, 0.5));
  });

  it("the TV unit draws a thin screen and its stand near the back", () => {
    // The screen against the back and a rounded stand plate in front of it (seating.04).
    const detail = D("tvUnit", 1.2, 0.4);
    expect(detail).toHaveLength(12);
    const plate = [[-0.1585, -0.3, 0.1585, -0.3], [0.1785, -0.28, 0.1785, -0.13], [0.1585, -0.11, -0.1585, -0.11], [-0.1785, -0.13, -0.1785, -0.28]] as const;
    expectSegments(segs(detail), [...box(-0.51, -0.11, 0.51, -0.06), ...plate], "tv unit");
    expect(arcs(detail).filter(quarter).map((a) => a.radius)).toEqual(Array.from({ length: 4 }, () => expect.closeTo(0.02, 9)));
    for (const p of ends(detail)) expect(p.y).toBeGreaterThanOrEqual(-0.3 - 1e-9);
  });

  it("the nightstand draws a lamp ring and a centre dot, with no drawer line or pull (symbols AC-06)", () => {
    const detail = D("nightstand", 0.45, 0.4);
    expect(segs(detail)).toEqual([]);
    expectFullArcs(arcs(detail), [[0, -0.2, 0.08], [0, -0.2, 0.016]], "lamp");
  });

  it("the nightstand's outline is the soft ring, with no heavier front line (symbols AC-06)", () => {
    const lines = objectLook("nightstand", "standard", 0.45, 0.4, { line: "L", frontPx: 9 });
    expect(lines.some((p) => p.kind === "segment" && "px" in p.width && p.width.px === 9)).toBe(false);
    const ends = segs(lines).flatMap((s) => [s.a, s.b]);
    expect(ends.some((p) => Math.abs(p.x + 0.225) < 1e-9 && Math.abs(p.y + 0.4) < 1e-9)).toBe(false); // the corner is cut
    expect(ends.some((p) => Math.abs(p.x + 0.165) < 1e-9 && Math.abs(p.y + 0.4) < 1e-9)).toBe(true);
  });

  it("each new tile is in its group and places at its default size with its default zone (AC-13)", () => {
    const group = (name: string) => PALETTE_KINDS.find((g) => g.group === name)?.cards.map((k) => k.kind);
    expect(group("Sleep")).toEqual(["bed", "mattress", "liftBed", "loftBed", "murphyBed", "builtInTable", "sofaBed", "nightstand", "cot"]);
    expect(group("Sit and eat")).toEqual(["foldingTable", "extendingTable", "roundTable", "seatedDining", "seatedRound", "sofa", "armchair", "chair", "stool", "barTable", "bench", "coffeeTable", "cornerSofa"]);
    expect(group("Kitchen")).toEqual(["hobUnit", "range", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "tallPantry", "wallCabinet", "cookerHood", "cornerCounter"]);
    expect(group("Storage")).toEqual(["wardrobe", "drawers", "storageChest", "shelf", "glassCabinet", "halfGlassCabinet", "tvUnit", "cornerWardrobe", "wallTv", "pegboard", "coatHooks", "coatStand"]);

    for (const [kind, w, d, zone, sides] of KINDS) {
      const shell = FakeShell.withDocument(roomDoc());
      shell.ui({ type: "pickKind", kind });
      shell.click({ x: 3, y: 2 });
      const objects = Object.values(shell.doc().objects);
      expect(objects.map((o) => [o.kind, o.w.standard, o.d.standard]), kind).toEqual([[kind, w, d]]);
      const [p, ...more] = Object.values(shell.doc().placements);
      expect(more, kind).toEqual([]);
      if (!p) throw new Error(`no placement for ${kind}`);
      expect(p.rotation, kind).toBe(0);
      expect(p.sides, kind).toEqual(sides);
      const bands = useZones(shell.doc()).get(p.id) ?? [];
      const on = (["front", "back", "left", "right"] as const).filter((s) => sides[s]);
      expect(bands.map((b) => b.side), kind).toEqual(on);
      // The footprint's edge midpoints: front at y − d/2 from the centre, back + d/2, left − w/2, right + w/2.
      const c = { x: p.at.x, y: p.at.y - d / 2 };
      const edge = { front: { x: c.x, y: c.y - d / 2 }, back: { x: c.x, y: c.y + d / 2 }, left: { x: c.x - w / 2, y: c.y }, right: { x: c.x + w / 2, y: c.y } };
      for (const b of bands) {
        // The band's outer edge: its two corners farthest from the footprint's edge midpoint.
        const far = [...b.quad].sort((u, v) => Math.hypot(v.x - edge[b.side].x, v.y - edge[b.side].y) - Math.hypot(u.x - edge[b.side].x, u.y - edge[b.side].y)).slice(0, 2);
        const mid = { x: ((far[0]?.x ?? NaN) + (far[1]?.x ?? NaN)) / 2, y: ((far[0]?.y ?? NaN) + (far[1]?.y ?? NaN)) / 2 };
        expect(Math.hypot(mid.x - edge[b.side].x, mid.y - edge[b.side].y), `${kind} ${b.side}`).toBeCloseTo(zone ?? NaN, 9);
      }
      if (zone === null) expect(bands, kind).toEqual([]);
    }
  });
});
