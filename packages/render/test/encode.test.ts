import { describe, expect, it } from "vitest";
import { type Layer, type Primitive } from "@fm/editor";
import { FakeShell, dividedRoomDoc, donutDoc, roomDoc, sofaBed200, wallBetween, withCommands } from "@fm/editor/testing";
import { FORMAT_MAGIC, FORMAT_VERSION, KIND_ORDER, LAYOUT, encodeLayer, readHeader, type GeometryKind } from "../src/index";
import { buildLayer } from "./old-instances";

const f32 = (values: number[]): number[] => Array.from(new Float32Array(values));

/** A section's floats, read through the header. */
function section(buffer: ArrayBuffer, kind: GeometryKind): number[] {
  const s = readHeader(buffer).sections[kind];
  return Array.from(new Float32Array(buffer, s.byteOffset, s.count * LAYOUT[kind].strideFloats));
}

describe("encodeLayer (AC-06)", () => {
  it("header and offsets of a hand-built layer", () => {
    const buffer = encodeLayer([
      { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], holes: [], color: "#ff8000" },
      { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0.5 }, width: { m: 0.2 }, color: "#111111", cap: "butt" },
      { kind: "segment", a: { x: 2, y: 0 }, b: { x: 2, y: 1 }, width: { px: 1.5 }, color: "#2563eb99", cap: "round", dash: [6, 4] },
      { kind: "arc", center: { x: 1, y: 2 }, radius: 0.8, from: 0, to: Math.PI / 2, width: { px: 1 }, color: "#000000" },
      { kind: "disc", center: { x: 3, y: 4 }, radius: { px: 5 }, color: "#ffffff80" },
    ]);
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(0x31524d46);
    expect(FORMAT_MAGIC).toBe(0x31524d46);
    expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe("FMR1");
    expect(view.getUint32(4, true)).toBe(1);
    expect(FORMAT_VERSION).toBe(1);
    const words = Array.from({ length: 12 }, (_, i) => view.getUint32(8 + 4 * i, true));
    expect(words).toEqual([3, 56, 24, 2, 128, 52, 1, 232, 44, 1, 276, 32]);
    expect(buffer.byteLength).toBe(308);
    const header = readHeader(buffer);
    expect(header.version).toBe(1);
    expect(header.sections.segment).toEqual({ count: 2, byteOffset: 128, strideBytes: 52 });

    const orange = [1, 0x80 / 255, 0, 1];
    expect(new Float32Array(buffer, 56, 6)[3]).toBeCloseTo(0.50196, 5);
    expect(section(buffer, "polygon")).toHaveLength(18);
    expect(new Set(chunks(section(buffer, "polygon"), 6).map((v) => `${v[0]},${v[1]}`))).toEqual(new Set(["0,0", "1,0", "0,1"]));
    for (const v of chunks(section(buffer, "polygon"), 6)) expect(v.slice(2)).toEqual(f32(orange));
    expect(section(buffer, "segment")).toEqual(
      f32([
        ...[0, 0, 1, 0.5, 0.2, 0, 0, 0, 0, 0x11 / 255, 0x11 / 255, 0x11 / 255, 1],
        ...[2, 0, 2, 1, 1.5, 1, 1, 6, 4, 0x25 / 255, 0x63 / 255, 0xeb / 255, 0x99 / 255],
      ]),
    );
    expect(section(buffer, "arc")).toEqual(f32([1, 2, 0.8, 0, Math.PI / 2, 1, 1, 0, 0, 0, 1]));
    expect(section(buffer, "disc")).toEqual(f32([3, 4, 5, 1, 1, 1, 1, 0x80 / 255]));
  });

  it("skips what Canvas2D skips", () => {
    const buffer = encodeLayer([
      { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], holes: [], color: "#000000" },
      { kind: "segment", a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, width: { px: 2 }, color: "#000000", cap: "butt" },
      { kind: "arc", center: { x: 0, y: 0 }, radius: 1, from: 1, to: 1, width: { px: 1 }, color: "#000000" },
      { kind: "segment", a: { x: 2, y: 2 }, b: { x: 2, y: 2 }, width: { px: 2 }, color: "#000000", cap: "round" },
      { kind: "text", text: "Room", at: { x: 0, y: 0 }, size: 12, color: "#000000", align: "center", rotation: 0, font: "inter" },
    ]);
    const { sections } = readHeader(buffer);
    expect(KIND_ORDER.map((k) => sections[k].count)).toEqual([0, 1, 0, 0]);
    expect(section(buffer, "segment").slice(0, 4)).toEqual([2, 2, 2, 2]);
  });

  it("fills a concave ring, an L's six corners, without covering its empty quarter (catalog.16)", () => {
    // The corner desk's outline at 1.6 × 1.2 with arms 0.6: the empty quarter is x −0.2–0.8, y −1.2–−0.6.
    const ring = [{ x: -0.8, y: -1.2 }, { x: -0.2, y: -1.2 }, { x: -0.2, y: -0.6 }, { x: 0.8, y: -0.6 }, { x: 0.8, y: 0 }, { x: -0.8, y: 0 }];
    const corners = chunks(section(encodeLayer([{ kind: "polygon", points: ring, holes: [], color: "#000000" }]), "polygon"), 6).map(([x = 0, y = 0]) => ({ x, y }));
    const triangles = Array.from({ length: corners.length / 3 }, (_, i) => corners.slice(3 * i, 3 * i + 3));
    expect(triangles).toHaveLength(4);
    const area = ([a = { x: 0, y: 0 }, b = a, c = a]: { x: number; y: number }[]) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    expect(triangles.reduce((s, t) => s + area(t), 0)).toBeCloseTo(1.6 * 0.6 + 0.6 * 0.6, 5);
    for (const t of triangles) {
      const cx = t.reduce((s, q) => s + q.x, 0) / 3;
      const cy = t.reduce((s, q) => s + q.y, 0) / 3;
      expect(cx > -0.2 && cy < -0.6, `centroid (${cx}, ${cy})`).toBe(false);
    }
  });
});

function chunks(values: number[], n: number): number[][] {
  return Array.from({ length: values.length / n }, (_, i) => values.slice(i * n, i * n + n));
}

/** Every kind, with the cases that change the answer: a hole touching the outer ring off by an ulp, negative arcs. */
function handLayer(): Layer {
  const ulp = 0.1 + 0.2 - 0.3; // 5.55e-17: the 1 µm snap makes it 0, so the hole meets the outer ring exactly
  const primitives: Primitive[] = [
    { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 7.800000000000001, y: 0 }, { x: 7.8, y: 4 }, { x: 0, y: 4 }], holes: [[{ x: ulp, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 3 }, { x: ulp, y: 3 }], [{ x: 5, y: 5 }]], color: "#336699cc" },
    { kind: "polygon", points: [{ x: 10, y: 0 }, { x: 12, y: 0 }, { x: 11, y: 2 }], holes: [], color: "#00ff00" },
    { kind: "segment", a: { x: -1.25, y: 3.5 }, b: { x: 4.75, y: -2 }, width: { m: 0.05 }, color: "#abcdef", cap: "butt", dash: [1.2, 0.8] },
    { kind: "segment", a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, width: { px: 3 }, color: "#123456", cap: "round" },
    { kind: "arc", center: { x: 1, y: 1 }, radius: 0.9, from: -Math.PI / 3, to: Math.PI / 4, width: { m: 0.02 }, color: "#ff000080" },
    { kind: "arc", center: { x: 2, y: 1 }, radius: 0.5, from: 2, to: -1, width: { px: 1 }, color: "#000000" },
    { kind: "arc", center: { x: 3, y: 1 }, radius: 0.5, from: -7, to: 0, width: { px: 1 }, color: "#000000" },
    { kind: "arc", center: { x: 4, y: 1 }, radius: 0.5, from: 7, to: 0, width: { px: 1 }, color: "#000000" }, // a sweep below −2π
    { kind: "disc", center: { x: 0.333, y: -0.25 }, radius: { m: 0.12 }, color: "#fedcba" },
    { kind: "text", text: "ignored", at: { x: 0, y: 0 }, size: 12, color: "#000000", align: "left", rotation: 0, font: "inter" },
  ];
  return { name: "presence", primitives };
}

/** Scenes from the editor's own fixtures: walls, zones and tags, a hole, openings, furniture, a deck, a dimension, a selection. */
function scenes(): { name: string; shell: FakeShell }[] {
  const sampleScene = FakeShell.withDocument(withCommands(dividedRoomDoc(), { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1", finish: null }, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Room 2", finish: null }));
  sampleScene.click({ x: 6, y: 1 }); // a selected wall with its helper
  const donut = FakeShell.withDocument(withCommands(donutDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Living", finish: null }));
  const room = roomDoc();
  const furnished = withCommands(
    room,
    { type: "addOpening", opId: "d", wall: wallBetween(room, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 4.5 },
    { type: "addOpening", opId: "win", wall: wallBetween(room, { x: 6, y: 0 }, { x: 6, y: 4 }), kind: "window", offset: 1.2, width: 1 },
    { type: "placeObject", deck: null, opId: "sofa", state: "s0", object: { kind: "sofaBed" }, at: { x: 3, y: 2.45 } },
    sofaBed200("sofa/o0"),
    { type: "placeObject", deck: null, opId: "tbl", state: "s0", object: { kind: "roundTable" }, at: { x: 4.8, y: 3 } },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.3, y: 2.6 }, w: 2.2, d: 2.2 },
    { type: "addDimension", opId: "dim", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.6 },
    { type: "labelZone", id: "L1", at: { x: 4, y: 1 }, name: "Living", finish: null },
  );
  const sofa = FakeShell.withDocument(furnished);
  sofa.click({ x: 3, y: 2 }); // the sofa bed, selected: grips in the overlays
  return [
    { name: "sample", shell: sampleScene },
    { name: "donut", shell: donut },
    { name: "furnished", shell: sofa },
  ];
}

describe("the encoder against the old buildLayer (AC-06)", () => {
  it.each([30, 60, 140])("matches the old buildLayer on the sample at %i px/m", (zoom) => {
    const seen = new Set<GeometryKind>();
    const hand = handLayer();
    for (const { name, shell } of scenes()) {
      shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
      for (const layer of [...shell.scene().layers, hand]) {
        const buffer = encodeLayer(layer.primitives);
        const old = buildLayer(layer).batches;
        for (const kind of KIND_ORDER) {
          const expected = old.find((b) => b.kind === kind);
          if (expected && layer.primitives !== hand.primitives) seen.add(kind);
          expect(section(buffer, kind), `${name}/${layer.name}/${kind}`).toEqual(Array.from(expected?.data ?? []));
          expect(readHeader(buffer).sections[kind].count).toBe(expected?.count ?? 0);
        }
      }
    }
    expect([...seen].sort()).toEqual([...KIND_ORDER].sort());
  });
});
