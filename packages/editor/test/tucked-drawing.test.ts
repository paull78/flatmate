import { describe, expect, it } from "vitest";
import { fitShapes, footprints, inConvex, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { clipOutside } from "../src/view/clip";
import { COLORS } from "../src/view/colors";
import { objectsLayer, placedFill, placedSymbol } from "../src/view/objects-layer";
import { planPicture } from "../src/view/picture";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";

// A tucked chair draws under its table (seating.10, AC-07): its lines clipped to outside the table's shape, its fill
// before the table's. roomDoc's inner faces: x 0.1–5.9, y 0.1–3.9. A desk (1.20 × 0.60) against the top wall, x 1.4–2.6,
// y 3.3–3.9; a chair (0.45 × 0.45) turned 180° faces it, x 1.775–2.225, its back on y = 2.85 + t when tucked t under.

const place = (opId: string, kind: string, x: number, y: number, rotation = 0): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y }, rotation });

/** The desk and a chair tucked `t` under it; `chairFirst` gives the chair the lower ID, so ID order alone can't decide. */
function tucked(t: number, chairFirst: boolean): { doc: Document; desk: string; chair: string } {
  const [c, d] = chairFirst ? ["a", "z"] : ["z", "a"];
  const doc = withCommands(roomDoc(), place(d, "desk", 2, 3.9), place(c, "chair", 2, 2.85 + t, 180));
  return { doc, desk: `${d}/p0`, chair: `${c}/p0` };
}

const layerOf = (doc: Document, selected = ""): readonly Primitive[] => objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, selected, 80);
const ringOf = (doc: Document, id: string): readonly Point[] => {
  const ring = fitShapes(doc).get(id);
  if (!ring) throw new Error(`no ring for ${id}`);
  return ring;
};

/** Points along a line primitive: 41 on a segment, 41 on an arc. */
function samples(p: Primitive): Point[] {
  const n = 40;
  const ts = Array.from({ length: n + 1 }, (_, i) => i / n);
  if (p.kind === "segment") return ts.map((t) => ({ x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t }));
  if (p.kind === "arc") return ts.map((t) => { const a = p.from + (p.to - p.from) * t; return { x: p.center.x + p.radius * Math.cos(a), y: p.center.y + p.radius * Math.sin(a) }; });
  return [];
}

/** The line primitives with a point at least 1 mm inside the ring. */
const linesInside = (ps: readonly Primitive[], ring: readonly Point[]): Primitive[] => ps.filter((p) => samples(p).some((q) => inConvex(q, ring, -0.001)));

const fillIndex = (doc: Document, ps: readonly Primitive[], id: string): number => {
  const p = doc.placements[id];
  const quad = footprints(doc).get(id);
  if (!p || !quad) throw new Error(`no placement ${id}`);
  const fill = placedFill(doc, p, quad);
  return ps.findIndex((q) => q.kind === "polygon" && q.points.length === fill.length && q.points.every((v, i) => v.x === fill[i]?.x && v.y === fill[i]?.y));
};

const sameEdge = (p: Primitive, a: Point, b: Point): boolean =>
  p.kind === "segment" && ((near(p.a, a) && near(p.b, b)) || (near(p.a, b) && near(p.b, a)));
const near = (p: Point, q: Point): boolean => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;

describe("tucked chairs drawn under the table (seating.10, AC-07)", () => {
  it.each([true, false])("no chair line inside the table (chair's ID first: %s)", (chairFirst) => {
    const { doc, desk, chair } = tucked(0.3, chairFirst);
    const ps = layerOf(doc);
    expect(linesInside(ps, ringOf(doc, desk))).toEqual([]);
    // The chair's lines outside the desk are still drawn: its backrest band and its seat's front.
    const outside = linesInside(ps, ringOf(doc, chair));
    expect(outside.length).toBeGreaterThan(4);
  });

  it.each([true, false])("the chair's fill comes before the desk's (chair's ID first: %s)", (chairFirst) => {
    const { doc, desk, chair } = tucked(0.3, chairFirst);
    const ps = layerOf(doc);
    const [c, d] = [fillIndex(doc, ps, chair), fillIndex(doc, ps, desk)];
    expect(c).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThan(c);
  });

  it.each([true, false])("selected chair shows whole outline, after the desk's fill (chair's ID first: %s)", (chairFirst) => {
    const { doc, desk, chair } = tucked(0.3, chairFirst);
    const ps = layerOf(doc, chair);
    const quad = footprints(doc).get(chair) ?? [];
    expect(quad).toHaveLength(4);
    const deskFill = fillIndex(doc, ps, desk);
    for (const [i, a] of quad.entries()) {
      const b = quad[(i + 1) % quad.length];
      if (!b) continue;
      const at = ps.findIndex((p, k) => k > deskFill && p.color === COLORS.wallSelected && sameEdge(p, a, b));
      expect(at, `edge ${i}`).toBeGreaterThan(deskFill);
    }
  });

  it("export pictures clip too (PNG, SVG and PDF share planPicture)", () => {
    const { doc, desk } = tucked(0.3, true);
    for (const finishes of [false, true]) {
      const ps = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 80, finishes).objects;
      expect(ps.some((p) => p.kind === "segment")).toBe(true);
      expect(linesInside(ps, ringOf(doc, desk))).toEqual([]);
    }
  });

  it("a stool wholly under a bar table draws its outline dashed over the table, not hidden (pieces.14, AC-09)", () => {
    const doc = withCommands(roomDoc(), place("t", "barTable", 2, 3.9), place("s", "stool", 2, 3.4, 180)); // the stool y 3.4–3.8, x 1.8–2.2
    const ps = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
    const inStool = (p: Primitive) => p.kind === "segment" && [p.a, p.b].every((q) => q.x >= 1.8 - 1e-6 && q.x <= 2.2 + 1e-6 && q.y >= 3.4 - 1e-6 && q.y <= 3.8 + 1e-6);
    const table = ps.findIndex((p) => p.kind === "polygon" && p.points.some((q) => Math.abs(q.y - 3.3) < 1e-6));
    const after = ps.slice(table + 1).filter(inStool);
    // A round ring's sides are a few pixels long, so a dash pattern restarting on each looks solid: every other side
    // is drawn instead, which reads as dashed at any size.
    const sides = fitShapes(doc).get("s/p0")?.length ?? 0;
    expect(sides).toBeGreaterThan(8);
    expect(after).toHaveLength(Math.ceil(sides / 2));
  });

  it("a chair beside a table is drawn whole", () => {
    const { doc, chair } = tucked(-0.1, true);
    const p = doc.placements[chair];
    if (!p) throw new Error("no chair");
    const ps = layerOf(doc);
    const whole = placedSymbol(doc, p, CANVAS_STYLE.objectLine, CANVAS_STYLE);
    expect(whole.some((q) => q.kind === "arc")).toBe(true);
    const start = ps.findIndex((q) => JSON.stringify(q) === JSON.stringify(whole[0]));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(ps.slice(start, start + whole.length)).toEqual(whole);
  });
});

describe("clipOutside", () => {
  const square: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const seg = (ax: number, ay: number, bx: number, by: number): Primitive => ({ kind: "segment", a: { x: ax, y: ay }, b: { x: bx, y: by }, width: { px: 1 }, color: "#000", cap: "butt" });

  it("splits a segment crossing a ring into the parts outside it", () => {
    const out = clipOutside([seg(-1, 0.5, 2, 0.5)], [square]);
    expect(out).toHaveLength(2);
    expect(out.map((p) => (p.kind === "segment" ? [p.a.x, p.b.x] : []))).toEqual([[-1, 0], [1, 2]]);
  });

  it("keeps a segment on the ring's edge, drops one inside, and works for either winding", () => {
    expect(clipOutside([seg(0, 0, 1, 0)], [square])).toHaveLength(1);
    expect(clipOutside([seg(0.2, 0.2, 0.8, 0.8)], [[...square].reverse()])).toEqual([]);
  });

  it("flattens an arc only where a ring cuts it; one clear of every ring stays an arc", () => {
    const arc = (cx: number): Primitive => ({ kind: "arc", center: { x: cx, y: 0.5 }, radius: 0.3, from: 0, to: Math.PI, width: { px: 1 }, color: "#000" });
    expect(clipOutside([arc(3)], [square])).toEqual([arc(3)]);
    const cut = clipOutside([arc(1)], [square]);
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.every((p) => p.kind === "segment" && samples(p).every((q) => !inConvex(q, square, -1e-6)))).toBe(true);
  });

  it("keeps whole a segment on a turned ring's edge, whatever the float noise (a chair flush at 30°)", () => {
    const turn = (x: number, y: number) => ({ x: 3 + x * Math.cos(Math.PI / 6) - y * Math.sin(Math.PI / 6), y: 3.5 + x * Math.sin(Math.PI / 6) + y * Math.cos(Math.PI / 6) });
    const ring = [turn(-0.6, -0.9), turn(0.6, -0.9), turn(0.6, -0.1), turn(-0.6, -0.1)];
    for (const x0 of [-0.5, -0.495, -0.27, 0.05, 0.13]) {
      const [a, b] = [turn(x0, -0.1), turn(x0 + 0.37, -0.1)];
      expect(clipOutside([seg(a.x, a.y, b.x, b.y)], [ring]), `${x0}`).toHaveLength(1);
    }
  });

  it("flattens a cut quarter arc into 16 chords at any start angle (one at π + 30° once gave 17)", () => {
    for (const start of [0, 0.1, Math.PI + Math.PI / 6, (5 * Math.PI) / 6]) {
      const arc: Primitive = { kind: "arc", center: { x: 0, y: 0 }, radius: 0.3, from: start, to: start + Math.PI / 2, width: { px: 1 }, color: "#000" };
      const [x, y] = [0.3 * Math.cos(start), 0.3 * Math.sin(start)];
      const nick = [{ x: x - 0.001, y: y - 0.001 }, { x: x + 0.001, y: y - 0.001 }, { x: x + 0.001, y: y + 0.001 }, { x: x - 0.001, y: y + 0.001 }]; // a 2 mm square on its start
      expect(clipOutside([arc], [nick]), `${start}`).toHaveLength(16); // the first chord shortened, none dropped
    }
  });

  it("leaves fills untouched", () => {
    const fill: Primitive = { kind: "polygon", points: square, holes: [], color: "#fff" };
    expect(clipOutside([fill], [square])).toEqual([fill]);
  });
});
