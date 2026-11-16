// Primitives → Float32 records, one growing array per kind, in the layout table's order of fields (render.14).
// What the WebGL instance builder skipped before this package existed, its 1 µm snap and its arc span are unchanged
// (test/old-instances.ts keeps that builder as the oracle).
import earcut from "earcut";
import type { Primitive, Width } from "@fm/editor";
import { CAP_BUTT, CAP_ROUND, LAYOUT, UNIT_M, UNIT_PX, type GeometryKind } from "./layout";

/** Four floats in 0–1 for a colour string; the encoder passes a cached `colorChannels`. */
export type ColorFn = (color: string) => readonly number[];

/** A kind's records so far: `floats[0, length)` is filled; the array doubles when full. */
export type Records = { kind: GeometryKind; floats: Float32Array; length: number };

export function newRecords(kind: GeometryKind): Records {
  return { kind, floats: new Float32Array(LAYOUT[kind].strideFloats * 16), length: 0 };
}

/** Appends one record; its field count must be the table's stride. */
function write(out: Records, values: readonly number[]): void {
  const stride = LAYOUT[out.kind].strideFloats;
  if (values.length !== stride) throw new Error(`${out.kind} record of ${values.length} floats, stride ${stride}`);
  if (out.length + stride > out.floats.length) {
    const grown = new Float32Array(out.floats.length * 2);
    grown.set(out.floats);
    out.floats = grown;
  }
  out.floats.set(values, out.length);
  out.length += stride;
}

const TAU = 2 * Math.PI;
/** A solid line: the shader draws a dash only when both values are positive. */
const NO_DASH = [0, 0] as const;

function width(w: Width): [number, number] {
  return "px" in w ? [w.px, UNIT_PX] : [w.m, UNIT_M];
}

/** Counter-clockwise sweep from `from` to `to` in [0, 2π], as Canvas2D draws `arc(-from, -to, anticlockwise)`. */
export function arcSpan(from: number, to: number): number {
  const sweep = to - from;
  if (sweep >= TAU) return TAU;
  return ((sweep % TAU) + TAU) % TAU;
}

const snap = (v: number): number => Math.round(v * 1e6) / 1e6;

export function pushPolygon(out: Records, p: Extract<Primitive, { kind: "polygon" }>, color: ColorFn): void {
  if (p.points.length < 3) return; // Canvas2D skips these too
  // earcut takes the outer ring then the holes as one vertex list, with each hole's first vertex index.
  // Vertices snap to a 1 µm grid (below float32 precision at plan scale): earcut needs a hole edge that touches
  // the outer ring to match it exactly, and ulp noise from the domain offset (7.800000000000001 vs 7.8) breaks it.
  const rings = [p.points, ...p.holes.filter((h) => h.length >= 3)];
  const verts = rings.flat().map((q) => ({ x: snap(q.x), y: snap(q.y) }));
  const holeIndices: number[] = [];
  let start = p.points.length;
  for (const h of rings.slice(1)) {
    holeIndices.push(start);
    start += h.length;
  }
  const coords = verts.flatMap((q) => [q.x, q.y]);
  const rgba = color(p.color);
  for (const i of earcut(coords, holeIndices)) {
    const q = verts[i];
    if (q) write(out, [q.x, q.y, ...rgba]);
  }
}

export function pushSegment(out: Records, p: Extract<Primitive, { kind: "segment" }>, color: ColorFn): void {
  // A zero-length butt segment covers nothing in Canvas2D; a round one is a dot, so it stays.
  if (p.cap === "butt" && p.a.x === p.b.x && p.a.y === p.b.y) return;
  write(out, [p.a.x, p.a.y, p.b.x, p.b.y, ...width(p.width), p.cap === "round" ? CAP_ROUND : CAP_BUTT, ...(p.dash ?? NO_DASH), ...color(p.color)]);
}

export function pushArc(out: Records, p: Extract<Primitive, { kind: "arc" }>, color: ColorFn): void {
  const span = arcSpan(p.from, p.to);
  if (span === 0) return;
  write(out, [p.center.x, p.center.y, p.radius, p.from, span, ...width(p.width), ...color(p.color)]);
}

export function pushDisc(out: Records, p: Extract<Primitive, { kind: "disc" }>, color: ColorFn): void {
  write(out, [p.center.x, p.center.y, ...width(p.radius), ...color(p.color)]);
}
