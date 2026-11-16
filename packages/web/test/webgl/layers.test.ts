import { describe, expect, it } from "vitest";
import type { Primitive, Scene } from "@fm/editor";
import { LAYOUT, createEncoder, readHeader } from "@fm/render";
import { freeLayer, uploadLayer, type LayerGl } from "../../src/adapters/webgl/layers";
import { sceneFixture } from "../fixtures";

// WebGL's upload and free for the layer cache (render.13, .14; AC-07, AC-08). The cache itself (the rev contract,
// the texts) is renderer-neutral and tested in gpu-layers.test.ts.

/** A fake context that records the calls an upload and a free make. */
function fakeGl() {
  const uploads: number[] = []; // byteLength of each bufferData
  const pointers: { location: number; stride: number; offset: number }[] = [];
  let createdArrays = 0;
  let deleted = 0;
  let deletedArrays = 0;
  const gl: LayerGl = {
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    createBuffer: () => ({}),
    createVertexArray: () => {
      createdArrays++;
      return {};
    },
    bindVertexArray: () => undefined,
    bindBuffer: () => undefined,
    bufferData: (_target: number, data: AllowSharedBufferSource | number | null) => {
      uploads.push(typeof data === "number" || data === null ? 0 : data.byteLength);
    },
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: (location: number, _size: number, _type: number, _normalized: boolean, stride: number, offset: number) => {
      pointers.push({ location, stride, offset });
    },
    vertexAttribDivisor: () => undefined,
    deleteBuffer: () => {
      deleted++;
    },
    deleteVertexArray: () => {
      deletedArrays++;
    },
  };
  return { gl, uploads, pointers, createdArrays: () => createdArrays, deleted: () => deleted, deletedArrays: () => deletedArrays };
}

const seg = (x: number): Primitive => ({ kind: "segment", a: { x, y: 0 }, b: { x: x + 1, y: 0 }, width: { px: 1 }, color: "#111111", cap: "butt" });

function wallsBuffer(walls: readonly Primitive[]): ArrayBuffer {
  const base = sceneFixture();
  const scene: Scene = { layers: base.layers.map((l) => ({ ...l, primitives: l.name === "walls" ? walls : l.primitives })), underlay: null };
  const buffer = createEncoder().encode(scene).layers.find((l) => l.name === "walls")?.buffer;
  if (!buffer) throw new Error("no walls buffer");
  return buffer;
}

describe("WebGL uploadLayer and freeLayer (AC-07)", () => {
  it("uploads the whole buffer once, with one vertex array per non-empty kind", () => {
    const { gl, uploads, createdArrays } = fakeGl();
    const data = wallsBuffer([seg(0), seg(2)]);
    const layer = uploadLayer(gl, {}, data);
    expect(uploads).toEqual([data.byteLength]);
    expect(createdArrays()).toBe(1);
    expect(layer.draws.map((d) => ({ kind: d.kind, count: d.count }))).toEqual([{ kind: "segment", count: 2 }]);
  });

  it("points each attribute at its section by the header and the layout table", () => {
    const { gl, pointers } = fakeGl();
    const data = wallsBuffer([seg(0)]);
    uploadLayer(gl, {}, data);
    const { byteOffset, strideBytes } = readHeader(data).sections.segment;
    const expected = LAYOUT.segment.attributes.map((a) => ({ location: a.location, stride: strideBytes, offset: byteOffset + 4 * a.offset }));
    expect(pointers).toEqual(expect.arrayContaining(expected));
  });

  it("frees the buffer and every vertex array", () => {
    const { gl, deleted, deletedArrays } = fakeGl();
    freeLayer(gl, uploadLayer(gl, {}, wallsBuffer([seg(0)])));
    expect(deleted()).toBe(1);
    expect(deletedArrays()).toBe(1); // the walls' one segment draw
  });
});
