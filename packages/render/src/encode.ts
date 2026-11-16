// The encoder (render.13, .14): a Scene's layers as buffers in the render format, and per encoder the revisions that
// say which layers changed since its last call.
//
//   buffer (little-endian, version 1)
//   ┌──────────────── header: 2 + 3 per kind u32 words (56 bytes for four kinds) ────────────────┐
//   │ magic "FMR1" │ version │ polygon: count byteOffset strideBytes │ segment … │ arc … │ disc … │
//   └─────────────────────────────────────────────────────────────────────────────────────┘
//   then each kind's Float32 records in KIND_ORDER, back to back (every offset a multiple of 4)
import { colorChannels, type LayerName, type Primitive, type Scene } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import { KIND_ORDER, LAYOUT, type GeometryKind } from "./layout";
import { newRecords, pushArc, pushDisc, pushPolygon, pushSegment, type ColorFn, type Records } from "./records";

export const FORMAT_MAGIC = 0x31524d46; // "FMR1" as little-endian bytes
export const FORMAT_VERSION = 1;
const HEADER_WORDS = 2 + 3 * KIND_ORDER.length;
const HEADER_BYTES = 4 * HEADER_WORDS;
/** Where a kind's three header words (count, byteOffset, strideBytes) start, in bytes. */
const sectionWord = (kind: GeometryKind): number => 4 * (2 + 3 * KIND_ORDER.indexOf(kind));

/** `count` is instances, or vertices for polygons; `byteOffset` from the buffer's start. */
export type Section = { count: number; byteOffset: number; strideBytes: number };
export type Header = { version: number; sections: Record<GeometryKind, Section> };
/** `buffer` is null when the layer's primitives array is the one this encoder saw for it last time. */
export type EncodedLayer = { name: LayerName; rev: number; buffer: ArrayBuffer | null };
export type Encoder = { encode(scene: Scene): { layers: EncodedLayer[] } };

// Float32 sections are copied through Float32Array views, which use the platform's byte order. Every engine the
// app runs on is little-endian; on another one the encoder refuses rather than write a wrong buffer.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function byKind<T>(f: (kind: GeometryKind) => T): Record<GeometryKind, T> {
  return { polygon: f("polygon"), segment: f("segment"), arc: f("arc"), disc: f("disc") };
}

function encodeWith(primitives: readonly Primitive[], color: ColorFn): ArrayBuffer {
  if (!LITTLE_ENDIAN) throw new Error("the render format needs a little-endian platform");
  const records = byKind(newRecords);
  for (const p of primitives) {
    switch (p.kind) {
      case "polygon":
        pushPolygon(records.polygon, p, color);
        break;
      case "segment":
        pushSegment(records.segment, p, color);
        break;
      case "arc":
        pushArc(records.arc, p, color);
        break;
      case "disc":
        pushDisc(records.disc, p, color);
        break;
      case "text":
        break; // version 1 has no text section: renderers draw text from the Scene (render.14)
      default:
        assertNever(p);
    }
  }
  return pack(KIND_ORDER.map((kind) => records[kind]));
}

/** Header, then each kind's floats; the buffer is exactly as long as its contents. */
function pack(sections: readonly Records[]): ArrayBuffer {
  const bytes = sections.reduce((n, s) => n + 4 * s.length, HEADER_BYTES);
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  view.setUint32(0, FORMAT_MAGIC, true);
  view.setUint32(4, FORMAT_VERSION, true);
  let offset = HEADER_BYTES;
  for (const s of sections) {
    const stride = LAYOUT[s.kind].strideFloats;
    const at = sectionWord(s.kind);
    view.setUint32(at, s.length / stride, true);
    view.setUint32(at + 4, offset, true);
    view.setUint32(at + 8, 4 * stride, true);
    new Float32Array(buffer, offset, s.length).set(s.floats.subarray(0, s.length));
    offset += 4 * s.length;
  }
  return buffer;
}

/** One layer's primitives in the render format (no revision, no cache). */
export function encodeLayer(primitives: readonly Primitive[]): ArrayBuffer {
  return encodeWith(primitives, colorChannels);
}

/**
 * A buffer's header. Throws unless it is this version of the render format: the magic, the version, each section's
 * stride against the layout table, and every section inside the buffer, so a reader never draws a layout it misreads.
 */
export function readHeader(buffer: ArrayBuffer): Header {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("not a render buffer: too short");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== FORMAT_MAGIC) throw new Error("not a render buffer: bad magic");
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) throw new Error(`render buffer version ${version}, this reader reads ${FORMAT_VERSION}`);
  const sections = byKind((kind) => {
    const at = sectionWord(kind);
    const section = { count: view.getUint32(at, true), byteOffset: view.getUint32(at + 4, true), strideBytes: view.getUint32(at + 8, true) };
    if (section.strideBytes !== 4 * LAYOUT[kind].strideFloats) throw new Error(`render buffer ${kind} stride ${section.strideBytes}, the layout's is ${4 * LAYOUT[kind].strideFloats}`);
    if (section.byteOffset % 4 !== 0 || section.byteOffset + section.count * section.strideBytes > buffer.byteLength) throw new Error(`render buffer ${kind} section outside the buffer`);
    return section;
  });
  return { version, sections };
}

/**
 * An encoding session. It remembers, per layer name, the primitives array it last encoded and that array's rev; a
 * layer gets a new rev and a buffer exactly when its array is a different object. The first call sends every layer,
 * so a new encoder is an explicit reset. Colours are parsed once per string. `layers` keeps the scene's order and
 * length, one entry per scene layer.
 */
export function createEncoder(): Encoder {
  const seen = new Map<LayerName, { primitives: readonly Primitive[]; rev: number }>();
  const colors = new Map<string, readonly number[]>();
  let lastRev = 0;
  const color: ColorFn = (c) => {
    const hit = colors.get(c);
    if (hit) return hit;
    const rgba = colorChannels(c);
    colors.set(c, rgba);
    return rgba;
  };
  return {
    encode(scene) {
      // Remembered only once the whole call succeeds: if one layer throws, no layer of this call counts as sent.
      const sent: [LayerName, { primitives: readonly Primitive[]; rev: number }][] = [];
      let rev = lastRev;
      const layers = scene.layers.map(({ name, primitives }): EncodedLayer => {
        const last = seen.get(name);
        if (last?.primitives === primitives) return { name, rev: last.rev, buffer: null };
        const buffer = encodeWith(primitives, color);
        sent.push([name, { primitives, rev: ++rev }]);
        return { name, rev, buffer };
      });
      for (const [name, entry] of sent) seen.set(name, entry);
      lastRev = rev;
      return { layers };
    },
  };
}
