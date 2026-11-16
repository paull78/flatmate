import { describe, expect, it } from "vitest";
import { type Layer, type Primitive, type Scene } from "@fm/editor";
import { FakeShell, dividedRoomDoc } from "@fm/editor/testing";
import { createEncoder, encodeLayer, readHeader } from "../src/index";

// Revisions live in the encoder (render.13, AC-07): a layer gets a new rev and a buffer exactly when its primitives
// array is not the one this encoder saw for it last time; the first call sends everything.

const dot = (x: number): Primitive => ({ kind: "disc", center: { x, y: 0 }, radius: { px: 3 }, color: "#000000" });
const scene = (...layers: Layer[]): Scene => ({ layers, underlay: null });

describe("createEncoder (AC-07)", () => {
  it("first encode sends every layer", () => {
    const s = FakeShell.withDocument(dividedRoomDoc()).scene();
    const { layers } = createEncoder().encode(s);
    expect(layers.map((l) => l.name)).toEqual(s.layers.map((l) => l.name));
    for (const l of layers) expect(l.buffer).toBeInstanceOf(ArrayBuffer);
    expect(new Set(layers.map((l) => l.rev)).size).toBe(layers.length);
  });

  it("an unchanged array gives null and the same rev", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    const encoder = createEncoder();
    const first = encoder.encode(shell.scene()).layers;
    const walls = shell.scene().layers.find((l) => l.name === "walls");
    const again = encoder.encode(shell.scene()).layers; // a new Scene; the document layers keep their arrays
    const wallsAgain = again.find((l) => l.name === "walls");
    expect(walls && walls.primitives.length > 0).toBe(true);
    expect(wallsAgain?.buffer).toBeNull();
    expect(wallsAgain?.rev).toBe(first.find((l) => l.name === "walls")?.rev);
  });

  it("a new array gives a new rev and buffer", () => {
    const encoder = createEncoder();
    const a = { name: "overlays", primitives: [dot(1)] } satisfies Layer;
    const b = { name: "presence", primitives: [dot(2)] } satisfies Layer;
    const [a1, b1] = encoder.encode(scene(a, b)).layers;
    const [a2, b2] = encoder.encode(scene({ ...a, primitives: [dot(1)] }, b)).layers; // equal content, new array
    expect(a2?.buffer).toBeInstanceOf(ArrayBuffer);
    expect(a2?.rev).not.toBe(a1?.rev);
    expect(b2).toEqual({ name: "presence", rev: b1?.rev, buffer: null });
    const [a3] = encoder.encode(scene({ ...a, primitives: [dot(1), dot(5)] }, b)).layers;
    expect(a3?.rev).not.toBe(a2?.rev);
    expect(readHeader(a3?.buffer ?? new ArrayBuffer(0)).sections.disc.count).toBe(2);
  });

  it("a new encoder starts over", () => {
    const s = FakeShell.withDocument(dividedRoomDoc()).scene();
    const first = createEncoder();
    first.encode(s);
    expect(first.encode(s).layers.every((l) => l.buffer === null)).toBe(true);
    const second = createEncoder().encode(s).layers;
    expect(second.every((l) => l.buffer instanceof ArrayBuffer)).toBe(true);
    expect(new Set(second.map((l) => l.rev)).size).toBe(second.length);
  });

  it("the shared empty array", () => {
    const none: readonly Primitive[] = [];
    const encoder = createEncoder();
    const [g1, o1] = encoder.encode(scene({ name: "ghosts", primitives: none }, { name: "openings", primitives: none })).layers;
    for (const l of [g1, o1]) {
      const sections = readHeader(l?.buffer ?? new ArrayBuffer(0)).sections;
      expect([sections.polygon.count, sections.segment.count, sections.arc.count, sections.disc.count]).toEqual([0, 0, 0, 0]);
    }
    expect(g1?.rev).not.toBe(o1?.rev);
    // openings gets content while ghosts keeps the shared array: only openings changes
    const [g2, o2] = encoder.encode(scene({ name: "ghosts", primitives: none }, { name: "openings", primitives: [dot(1)] })).layers;
    expect(g2).toEqual({ name: "ghosts", rev: g1?.rev, buffer: null });
    expect(o2?.buffer).toBeInstanceOf(ArrayBuffer);
    // and back to the shared array: a change for openings, still none for ghosts
    const [g3, o3] = encoder.encode(scene({ name: "ghosts", primitives: none }, { name: "openings", primitives: none })).layers;
    expect(g3?.buffer).toBeNull();
    expect(o3?.buffer).toBeInstanceOf(ArrayBuffer);
    expect(o3?.rev).not.toBe(o2?.rev);
  });

  it("an encoder's buffers equal encodeLayer's, repeated colours through its cache included", () => {
    const s = FakeShell.withDocument(dividedRoomDoc()).scene();
    const encoder = createEncoder();
    for (let round = 0; round < 2; round++) {
      // the second round is a fresh scene of new arrays, so every colour comes from the cache
      const fresh = scene(...s.layers.map((l) => ({ ...l, primitives: [...l.primitives] })));
      for (const [i, l] of encoder.encode(fresh).layers.entries()) {
        const expected = encodeLayer(fresh.layers[i]?.primitives ?? []);
        expect(new Uint8Array(l.buffer ?? new ArrayBuffer(0)), l.name).toEqual(new Uint8Array(expected));
      }
    }
  });

  it("a layer whose encoding throws is sent again on the next call", () => {
    const encoder = createEncoder();
    const walls = { name: "walls", primitives: [dot(1)] } satisfies Layer;
    encoder.encode(scene(walls, { name: "overlays", primitives: [] }));
    const moved = { name: "walls", primitives: [dot(1), dot(2)] } satisfies Layer;
    // A dash of three numbers can't be typed; from untyped input it makes the segment record the wrong length.
    const broken: Primitive = JSON.parse('{"kind":"segment","a":{"x":0,"y":0},"b":{"x":1,"y":0},"width":{"px":1},"color":"#000000","cap":"butt","dash":[1,2,3]}');
    expect(() => encoder.encode(scene(moved, { name: "overlays", primitives: [broken] }))).toThrow();
    const [w] = encoder.encode(scene(moved, { name: "overlays", primitives: [] })).layers;
    expect(w?.buffer).toBeInstanceOf(ArrayBuffer); // not marked as sent by the call that threw
    expect(readHeader(w?.buffer ?? new ArrayBuffer(0)).sections.disc.count).toBe(2);
  });
});
