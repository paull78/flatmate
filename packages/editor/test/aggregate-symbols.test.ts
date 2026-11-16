import { describe, expect, it } from "vitest";
import { SEATED_REACH, CHAIR_SIZE, MAX_OBJECT_SIZE, MIN_OBJECT_SIZE, defaultSides, emptyDocument, footprintQuad, nullZones, outlineOf, rotateAbout, roundSetDiameter, shapeRing, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { aggregateLayout, type AggregateLayout } from "../src/view/aggregate";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import { objectsLayer } from "../src/view/objects-layer";
import { PALETTE, tileLook } from "../src/view/palette";
import { CANVAS_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { insetOf } from "../src/view/symbols/lines";
import { reach } from "./object-look-helpers";

// An aggregate draws exactly the lines of its table plus loose chairs fully tucked at the same poses (AC-04, seating.15):
// the chair's own symbol clipped by the table, as a loose tucked chair's is, from one owner of the poses.

const SETS = ["seatedDining", "seatedRound", "deskSet"] as const;
const AT: Point = { x: 3, y: 3.5 };
const TURN = 30;

function layoutOf(kind: string, w: number, d: number): AggregateLayout {
  const layout = aggregateLayout(kind, w, d);
  if (!layout) throw new Error(`${kind} is not an aggregate`);
  return layout;
}

type Piece = { kind: string; config: string; w: number; d: number; at: Point; rotation: number };

/** A document with these pieces as they are, unchecked (a round set's loose chairs may meet under the table). */
function docOf(pieces: readonly Piece[]): Document {
  const doc = emptyDocument();
  pieces.forEach((p, i) => {
    const [o, id] = [`o${i}`, `p${i}`];
    doc.objects[o] = { id: o, kind: p.kind, name: p.kind, w: { [p.config]: p.w }, d: { [p.config]: p.d }, h: { [p.config]: 0.75 }, z: { [p.config]: 0 } };
    doc.placements[id] = { id, object: o, state: "s0", at: p.at, rotation: p.rotation, config: p.config, sides: defaultSides(p.kind) ?? { front: false, back: false, left: false, right: false }, zones: nullZones(), deck: null };
  });
  return doc;
}

/** A footprint-space pose of the set at AT, turned by TURN, in the world. */
const world = (p: Point): Point => rotateAbout({ x: p.x + AT.x, y: p.y + AT.y }, AT, TURN);

/** The set's table and its chairs as loose pieces at the layout's poses. */
function loosePieces(kind: string, w: number, d: number): Piece[] {
  const l = layoutOf(kind, w, d);
  return [
    { kind: l.tableKind, config: l.tableConfig, w: l.tableSize.w, d: l.tableSize.d, at: world(l.tableAt), rotation: TURN },
    ...l.chairs.map((c) => ({ kind: "chair", config: "standard", w: CHAIR_SIZE.w, d: CHAIR_SIZE.d, at: world(c.at), rotation: TURN + c.rotation })),
  ];
}

const linesOf = (doc: Document, style: PlanStyle): Primitive[] => objectsLayer(doc, floorView(doc, "s0"), style, "", 80).filter((p) => p.kind === "segment" || p.kind === "arc");

const close = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const angle = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
/** The same line, its geometry only (a segment either way round; an arc by centre, radius and ends). */
function same(p: Primitive, q: Primitive): boolean {
  if (p.kind === "segment" && q.kind === "segment") return (close(p.a, q.a) && close(p.b, q.b)) || (close(p.a, q.b) && close(p.b, q.a));
  if (p.kind === "arc" && q.kind === "arc") return close(p.center, q.center) && Math.abs(p.radius - q.radius) < 1e-6 && Math.abs(angle(p.from) - angle(q.from)) < 1e-6 && Math.abs(angle(p.to) - angle(q.to)) < 1e-6;
  return false;
}
const tiny = (p: Primitive): boolean => p.kind === "segment" && Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) < 1e-6;
/** The lines of `a` with no line of the same geometry in `b`. */
const missingFrom = (a: readonly Primitive[], b: readonly Primitive[]): Primitive[] => a.filter((p) => !tiny(p) && !b.some((q) => same(p, q)));

/** The closed extending table's seam, which the dining set's table leaves out: across the top at its middle. */
function seamOf(l: AggregateLayout): Primitive {
  const i = insetOf(l.tableSize.w, l.tableSize.d);
  const y = l.tableAt.y - l.tableSize.d / 2;
  return { kind: "segment", a: world({ x: -l.tableSize.w / 2 + i, y }), b: world({ x: l.tableSize.w / 2 - i, y }), width: { px: 1 }, color: "#000", cap: "butt" };
}

const sizesOf = (kind: string): [number, number][] =>
  kind === "seatedRound" ? [0.9, 1.2, 1.5].map((t) => [roundSetDiameter(t, SEATED_REACH), roundSetDiameter(t, SEATED_REACH)]) : kind === "seatedDining" ? [[1.2, 2], [2.6, 2.1], [3.2, 2.1], [3.8, 2.1]] : [[1.2, 0.7]];

describe("an aggregate's plan symbol (AC-04, seating.15)", () => {
  it.each(SETS.flatMap((kind) => sizesOf(kind).flatMap(([w, d]) => [CANVAS_STYLE, PRESENTATION_STYLE].map((style) => [kind, w, d, style] as const))))(
    "%s %f × %f: the same lines as its table plus loose chairs at its poses",
    (kind, w, d, style) => {
      const set = linesOf(docOf([{ kind, config: "standard", w, d, at: AT, rotation: TURN }]), style);
      const loose = linesOf(docOf(loosePieces(kind, w, d)), style);
      expect(set.length).toBeGreaterThan(0);
      expect(missingFrom(set, loose), "drawn by the set, not by the loose pieces").toEqual([]);
      const l = layoutOf(kind, w, d);
      // The dining set's table is the closed extending table's top without its seam (a long table has none across).
      expect(missingFrom(loose, set), "drawn by the loose pieces, not by the set").toEqual(kind === "seatedDining" ? [expect.objectContaining({ kind: "segment" })] : []);
      if (kind === "seatedDining") expect(missingFrom(loose, set).every((p) => same(p, seamOf(l)))).toBe(true);
    },
  );

  it("no outer outline and no front line: the piece's own rectangle or circle is not drawn", () => {
    for (const kind of SETS) {
      for (const [w, d] of sizesOf(kind)) {
        const look = objectLook(kind, "standard", w, d, { line: "#111111", frontPx: 3, linePx: 1, detail: "#999999", detailPx: 0.5 });
        expect(look.some((p) => p.kind === "segment" && "px" in p.width && p.width.px === 3), `${kind} front line`).toBe(false);
        const edgesOf = (ring: readonly Point[]): Primitive[] => ring.map((a, i) => ({ kind: "segment", a, b: ring[(i + 1) % ring.length] ?? a, width: { px: 1 }, color: "#111111", cap: "butt" }));
        // Only the table's own edges may lie on the piece's (the desk against the back): the round set's table is smaller
        // than its circle, the dining set's the rectangle less the chairs' backrests.
        const table = edgesOf(layoutOf(kind, w, d).table);
        const outer = edgesOf(shapeRing(outlineOf(kind), w, d)).filter((e) => !table.some((t) => same(t, e)));
        expect(outer.length, kind).toBeGreaterThan(0);
        expect(outer.filter((e) => look.some((p) => same(p, e))), kind).toHaveLength(0);
      }
    }
  });

  it("fill is the parts: each chair's ring, then the table's, in the fill colour", () => {
    for (const kind of SETS) {
      for (const [w, d] of sizesOf(kind)) {
        const l = layoutOf(kind, w, d);
        const fills = objectLook(kind, "standard", w, d, { fill: "#eeeeee", line: "#111111", frontPx: 2 }).filter((p) => p.kind === "polygon");
        const rings = [...l.chairs.map((c) => footprintQuad(c.at, CHAIR_SIZE.w, CHAIR_SIZE.d, c.rotation)), l.table];
        expect(fills.map((p) => (p.kind === "polygon" ? p.points : []))).toEqual(rings);
        expect(fills.every((p) => p.color === "#eeeeee")).toBe(true);
      }
    }
  });

  it("the canvas fills, selects and refuses the parts, not the piece's rectangle", () => {
    const kind = "seatedDining";
    const doc = docOf([{ kind, config: "standard", w: 1.2, d: 2, at: AT, rotation: TURN }]);
    for (const selected of ["", "p0"]) {
      const polygons = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, selected, 80).filter((p) => p.kind === "polygon");
      expect(polygons, selected).toHaveLength(5);
    }
  });

  it("inside the footprint for the three kinds at sizes 0.10–10 m", () => {
    const sizes = [MIN_OBJECT_SIZE, 0.3, 0.45, 0.5, 0.9, 1.2, 1.77, 3, MAX_OBJECT_SIZE];
    for (const kind of SETS) {
      for (const w of sizes) {
        for (const d of sizes) {
          const symbol = furnitureSymbol(kind, "standard", w, d);
          expect(symbol.length, `${kind} ${w}×${d}`).toBeGreaterThan(0);
          for (const q of symbol.flatMap(reach)) expect(q.x >= -w / 2 - 1e-6 && q.x <= w / 2 + 1e-6 && q.y >= -d - 1e-6 && q.y <= 1e-6, `${kind} ${w}×${d} (${q.x}, ${q.y})`).toBe(true);
        }
      }
    }
  });

  it("the palette tile shows the chairs (tiles draw the same symbol)", () => {
    for (const k of PALETTE.flatMap((g) => g.cards).filter((k) => aggregateLayout(k.kind, k.w, k.d) !== null)) {
      const chairs = layoutOf(k.kind, k.w, k.d).chairs.length;
      expect(chairs, k.kind).toBeGreaterThan(0);
      const tile = tileLook(k);
      expect(tile.filter((p) => p.kind === "polygon"), k.kind).toHaveLength(chairs + 1);
      expect(tile.filter((p) => p.kind !== "polygon")).toEqual(objectLook(k.kind, k.config, k.w, k.d, { line: CANVAS_STYLE.objectLine, frontPx: 1, linePx: CANVAS_STYLE.objectLineWidth, detail: CANVAS_STYLE.objectDetail, detailPx: CANVAS_STYLE.objectDetailWidth }));
    }
  });
});
