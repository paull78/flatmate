import { describe, expect, it } from "vitest";
import type { LayerName, Primitive, Scene } from "@fm/editor";
import { createEncoder } from "@fm/render";
import { createLayerCache, syncLayers, type CachedLayer } from "../src/adapters/gpu-layers";
import { sceneFixture } from "./fixtures";

// The one layer cache over the render format (render.13, .14, .25; webgpu.11), renderer-neutral: a fake upload and
// free record what the cache asks a renderer to do.

type Fake = { id: number; bytes: number };

function fakeGpu() {
  const uploads: Fake[] = [];
  const freed: Fake[] = [];
  const ops = {
    upload: (data: ArrayBuffer): Fake => {
      const made = { id: uploads.length, bytes: data.byteLength };
      uploads.push(made);
      return made;
    },
    free: (gpu: Fake): void => {
      freed.push(gpu);
    },
  };
  return { ops, uploads, freed };
}

const seg = (x: number): Primitive => ({ kind: "segment", a: { x, y: 0 }, b: { x: x + 1, y: 0 }, width: { px: 1 }, color: "#111111", cap: "butt" });
const label: Primitive = { kind: "text", text: "Living", at: { x: 0, y: 0 }, size: 12, color: "#1d1d1f", align: "center", rotation: 0, font: "inter" };

function sceneWith(byLayer: Partial<Record<LayerName, readonly Primitive[]>>, base: Scene = sceneFixture()): Scene {
  return { layers: base.layers.map((l) => ({ ...l, primitives: byLayer[l.name] ?? l.primitives })), underlay: null };
}

describe("syncLayers (AC-01, AC-07)", () => {
  it("uploads only changed layers", () => {
    const { ops, uploads } = fakeGpu();
    const encoder = createEncoder();
    const cache = new Map<LayerName, CachedLayer<Fake>>();
    const first = sceneWith({ walls: [seg(0), seg(2)], grid: [seg(5)] });
    const before = syncLayers(cache, encoder.encode(first).layers, first, ops);
    expect(uploads).toHaveLength(first.layers.length); // one upload per layer, empty ones included
    expect(before.layers).toEqual(uploads); // in layer order
    uploads.length = 0;
    const second = sceneWith({ grid: [seg(6)] }, first); // every other array the same, a new grid
    const after = syncLayers(cache, encoder.encode(second).layers, second, ops);
    expect(uploads).toHaveLength(1);
    const grid = first.layers.findIndex((l) => l.name === "grid");
    expect(after.layers[grid]).toBe(uploads[0]);
    expect(after.layers.filter((l, i) => i !== grid)).toEqual(before.layers.filter((l, i) => i !== grid));
  });

  it("a new encoder uploads everything and frees what it replaces", () => {
    const { ops, uploads, freed } = fakeGpu();
    const cache = new Map<LayerName, CachedLayer<Fake>>();
    const scene = sceneWith({ walls: [seg(0)] });
    const first = syncLayers(cache, createEncoder().encode(scene).layers, scene, ops);
    expect(freed).toHaveLength(0);
    uploads.length = 0;
    syncLayers(cache, createEncoder().encode(scene).layers, scene, ops);
    expect(uploads).toHaveLength(scene.layers.length);
    expect(freed).toEqual(first.layers);
  });

  it("refuses an unchanged layer whose upload has another rev", () => {
    const { ops } = fakeGpu();
    const scene = sceneWith({ walls: [seg(0)] });
    const cache = new Map<LayerName, CachedLayer<Fake>>();
    const encoded = createEncoder().encode(scene).layers;
    syncLayers(cache, encoded, scene, ops);
    const stale = encoded.map((l) => ({ ...l, rev: l.rev + 100, buffer: null }));
    expect(() => syncLayers(cache, stale, scene, ops)).toThrow(/unchanged/);
  });

  it("refuses an unchanged layer that was never uploaded", () => {
    const { ops } = fakeGpu();
    const scene = sceneWith({});
    const never = createEncoder().encode(scene).layers.map((l) => ({ ...l, buffer: null }));
    expect(() => syncLayers(new Map(), never, scene, ops)).toThrow(/unchanged/);
  });

  it("texts in scene order", () => {
    const { ops } = fakeGpu();
    const encoder = createEncoder();
    const cache = new Map<LayerName, CachedLayer<Fake>>();
    const dim: Primitive = { ...label, text: "3.40" };
    const first = sceneWith({ tags: [label], dimensions: [dim] });
    syncLayers(cache, encoder.encode(first).layers, first, ops);
    const second = sceneWith({ dimensions: [dim] }, first); // dimensions is a new array, tags the same
    expect(syncLayers(cache, encoder.encode(second).layers, second, ops).texts.map((t) => t.text)).toEqual(["Living", "3.40"]);
  });
});

describe("createLayerCache (webgpu gate M1)", () => {
  it("an upload that throws frees every upload and starts over: the next frame uploads everything", () => {
    const { ops, uploads, freed } = fakeGpu();
    let fail = false;
    const cache = createLayerCache<Fake>({ upload: (data) => {
      if (fail) throw new Error("out of memory");
      return ops.upload(data);
    }, free: ops.free });
    const first = sceneWith({ walls: [seg(0)] });
    cache.sync(first);
    const uploaded = uploads.length;
    fail = true;
    expect(() => cache.sync(sceneWith({ grid: [seg(5)] }, first))).toThrow(/out of memory/);
    expect(freed).toHaveLength(uploaded); // nothing freed twice, nothing kept half-freed
    fail = false;
    cache.sync(sceneWith({ grid: [seg(5)] }, first));
    expect(uploads.length).toBe(2 * uploaded); // a new encoder: every layer again, no "unchanged" refusal
  });

  it("dispose frees every upload once", () => {
    const { ops, uploads, freed } = fakeGpu();
    const cache = createLayerCache(ops);
    cache.sync(sceneWith({ walls: [seg(0)] }));
    cache.dispose();
    expect(freed.map((f) => f.id).sort()).toEqual(uploads.map((u) => u.id).sort());
  });
});
