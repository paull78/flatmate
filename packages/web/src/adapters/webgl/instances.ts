import earcut from "earcut";
import type { LayerName, Primitive, Scene, Width } from "@fm/editor";
import { assertNever } from "@fm/protocol";

// Scene → GPU-ready typed arrays, one batch per non-empty (layer × kind), in draw order. Pure: no GL, no camera.
// Positions stay in world metres and widths keep their unit, so pan and zoom are shader uniforms (spec §6.2).

/** Straight (not premultiplied) RGBA, 0..1. */
export type Rgba = [number, number, number, number];
export type GeometryKind = "polygon" | "segment" | "arc" | "disc";
export type TextPrimitive = Extract<Primitive, { kind: "text" }>;
/** `count` is the number of instances, or of vertices for polygons (drawn as plain triangles). */
export type Batch = { layer: LayerName; kind: GeometryKind; data: Float32Array; count: number };
/** `batches` in draw order (one draw call each); `texts` for the Canvas2D overlay, in scene order. */
export type Frame = { batches: Batch[]; texts: TextPrimitive[] };

/** Within one layer the WebGL renderer draws kinds in this order; Canvas2D draws in scene order. */
export const KIND_ORDER: readonly GeometryKind[] = ["polygon", "segment", "arc", "disc"];

// Floats per instance (per vertex for polygons). The shaders read them in this order.
export const POLYGON_VERTEX_FLOATS = 6; // x y | r g b a
export const SEGMENT_FLOATS = 13; // ax ay bx by | width unit cap | dashOn dashOff | r g b a
export const ARC_FLOATS = 11; // cx cy | radius start span | width unit | r g b a
export const DISC_FLOATS = 8; // cx cy | radius unit | r g b a
const STRIDE: Record<GeometryKind, number> = {
  polygon: POLYGON_VERTEX_FLOATS,
  segment: SEGMENT_FLOATS,
  arc: ARC_FLOATS,
  disc: DISC_FLOATS,
};

export const UNIT_M = 0; // world metres, scaled by zoom
export const UNIT_PX = 1; // CSS pixels, screen-constant
export const CAP_BUTT = 0;
export const CAP_ROUND = 1;

const TAU = 2 * Math.PI;
/** A colour the palette should never produce: drawn loudly instead of throwing inside a frame. */
const BAD_COLOR: Rgba = [1, 0, 1, 1];

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the palette is hex-only, rendering.md); anything else is magenta. */
export function parseColor(color: string): Rgba {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (hex === undefined) return BAD_COLOR;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const channel = (i: number): number => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return [channel(0), channel(1), channel(2), full.length === 8 ? channel(3) : 1];
}

function width(w: Width): [number, number] {
  return "px" in w ? [w.px, UNIT_PX] : [w.m, UNIT_M];
}

/**
 * Canvas2D `setLineDash` semantics for the first on/off pair: an odd list repeats, a list with a negative or
 * non-finite entry is ignored (solid), and [0, 0] means solid. Longer patterns keep only their first pair
 * (the editor emits no dashes today).
 */
export function dashPair(dash: readonly number[] | undefined): [number, number] {
  if (dash === undefined || dash.length === 0) return [0, 0];
  if (dash.some((d) => !Number.isFinite(d) || d < 0)) return [0, 0];
  const list = dash.length % 2 === 1 ? [...dash, ...dash] : dash;
  const on = list[0] ?? 0;
  const off = list[1] ?? 0;
  return on > 0 && off > 0 ? [on, off] : [0, 0];
}

/** Counter-clockwise sweep from `from` to `to` in [0, 2π], as Canvas2D draws `arc(-from, -to, anticlockwise)`. */
export function arcSpan(from: number, to: number): number {
  const sweep = to - from;
  if (sweep >= TAU) return TAU;
  return ((sweep % TAU) + TAU) % TAU;
}

function pushPolygon(out: number[], p: Extract<Primitive, { kind: "polygon" }>): void {
  if (p.points.length < 3) return; // Canvas2D skips these too
  const coords = p.points.flatMap((q) => [q.x, q.y]);
  const color = parseColor(p.color);
  for (const i of earcut(coords)) {
    const q = p.points[i];
    if (q) out.push(q.x, q.y, ...color);
  }
}

function pushSegment(out: number[], p: Extract<Primitive, { kind: "segment" }>): void {
  // A zero-length butt segment covers nothing in Canvas2D; a round one is a dot, so it stays.
  if (p.cap === "butt" && p.a.x === p.b.x && p.a.y === p.b.y) return;
  out.push(p.a.x, p.a.y, p.b.x, p.b.y, ...width(p.width), p.cap === "round" ? CAP_ROUND : CAP_BUTT, ...dashPair(p.dash), ...parseColor(p.color));
}

function pushArc(out: number[], p: Extract<Primitive, { kind: "arc" }>): void {
  const span = arcSpan(p.from, p.to);
  if (span === 0) return;
  out.push(p.center.x, p.center.y, p.radius, p.from, span, ...width(p.width), ...parseColor(p.color));
}

function pushDisc(out: number[], p: Extract<Primitive, { kind: "disc" }>): void {
  out.push(p.center.x, p.center.y, ...width(p.radius), ...parseColor(p.color));
}

export function buildFrame(scene: Scene): Frame {
  const batches: Batch[] = [];
  const texts: TextPrimitive[] = [];
  for (const layer of scene.layers) {
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
  }
  return { batches, texts };
}
