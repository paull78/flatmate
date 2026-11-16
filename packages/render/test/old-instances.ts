// The oracle for the encoder (AC-06): a verbatim copy of `buildLayer` from packages/web/src/adapters/webgl/instances.ts
// as of commit f77d4a0, captured before step 05 deletes it. Standalone on purpose: its own strides and codes, so a
// change to the layout table or the encoder can't change the answer it is checked against. Do not edit to make a
// test pass.
import earcut from "earcut";
import { colorChannels, type Layer, type LayerName, type Primitive, type Width } from "@fm/editor";
import { assertNever } from "@fm/protocol";

type GeometryKind = "polygon" | "segment" | "arc" | "disc";
type TextPrimitive = Extract<Primitive, { kind: "text" }>;
export type Batch = { layer: LayerName; kind: GeometryKind; data: Float32Array; count: number };
export type Frame = { batches: Batch[]; texts: TextPrimitive[] };

const KIND_ORDER: readonly GeometryKind[] = ["polygon", "segment", "arc", "disc"];
const STRIDE: Record<GeometryKind, number> = { polygon: 6, segment: 13, arc: 11, disc: 8 };
const UNIT_M = 0;
const UNIT_PX = 1;
const CAP_BUTT = 0;
const CAP_ROUND = 1;

const TAU = 2 * Math.PI;
const NO_DASH = [0, 0] as const;

function width(w: Width): [number, number] {
  return "px" in w ? [w.px, UNIT_PX] : [w.m, UNIT_M];
}

function arcSpan(from: number, to: number): number {
  const sweep = to - from;
  if (sweep >= TAU) return TAU;
  return ((sweep % TAU) + TAU) % TAU;
}

const snap = (v: number): number => Math.round(v * 1e6) / 1e6;

function pushPolygon(out: number[], p: Extract<Primitive, { kind: "polygon" }>): void {
  if (p.points.length < 3) return;
  const rings = [p.points, ...p.holes.filter((h) => h.length >= 3)];
  const verts = rings.flat().map((q) => ({ x: snap(q.x), y: snap(q.y) }));
  const holeIndices: number[] = [];
  let start = p.points.length;
  for (const h of rings.slice(1)) {
    holeIndices.push(start);
    start += h.length;
  }
  const coords = verts.flatMap((q) => [q.x, q.y]);
  const color = colorChannels(p.color);
  for (const i of earcut(coords, holeIndices)) {
    const q = verts[i];
    if (q) out.push(q.x, q.y, ...color);
  }
}

function pushSegment(out: number[], p: Extract<Primitive, { kind: "segment" }>): void {
  if (p.cap === "butt" && p.a.x === p.b.x && p.a.y === p.b.y) return;
  out.push(p.a.x, p.a.y, p.b.x, p.b.y, ...width(p.width), p.cap === "round" ? CAP_ROUND : CAP_BUTT, ...(p.dash ?? NO_DASH), ...colorChannels(p.color));
}

function pushArc(out: number[], p: Extract<Primitive, { kind: "arc" }>): void {
  const span = arcSpan(p.from, p.to);
  if (span === 0) return;
  out.push(p.center.x, p.center.y, p.radius, p.from, span, ...width(p.width), ...colorChannels(p.color));
}

function pushDisc(out: number[], p: Extract<Primitive, { kind: "disc" }>): void {
  out.push(p.center.x, p.center.y, ...width(p.radius), ...colorChannels(p.color));
}

export function buildLayer(layer: Layer): Frame {
  const batches: Batch[] = [];
  const texts: TextPrimitive[] = [];
  const values: Record<GeometryKind, number[]> = { polygon: [], segment: [], arc: [], disc: [] };
  for (const p of layer.primitives) {
    switch (p.kind) {
      case "polygon":
        pushPolygon(values.polygon, p);
        break;
      case "segment":
        pushSegment(values.segment, p);
        break;
      case "arc":
        pushArc(values.arc, p);
        break;
      case "disc":
        pushDisc(values.disc, p);
        break;
      case "text":
        texts.push(p);
        break;
      default:
        assertNever(p);
    }
  }
  for (const kind of KIND_ORDER) {
    const v = values[kind];
    if (v.length > 0) batches.push({ layer: layer.name, kind, data: new Float32Array(v), count: v.length / STRIDE[kind] });
  }
  return { batches, texts };
}
