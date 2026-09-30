import { describe, expect, it } from "vitest";
import { COLORS, type LayerName, type Primitive, type Scene } from "@fm/editor";
import { FakeShell, dividedRoomDoc } from "@fm/editor/testing";
import type { Point } from "@fm/protocol";
import {
  ARC_FLOATS,
  CAP_BUTT,
  CAP_ROUND,
  DISC_FLOATS,
  POLYGON_VERTEX_FLOATS,
  SEGMENT_FLOATS,
  UNIT_M,
  UNIT_PX,
  arcSpan,
  buildFrame,
  buildLayer,
  dashPair,
  parseColor,
  type Batch,
} from "../../src/adapters/webgl/instances";
import { sceneFixture } from "../fixtures";

const f32 = (values: number[]): number[] => Array.from(new Float32Array(values));
const c = (hex: number): number => hex / 255;

function sceneWith(byLayer: Partial<Record<LayerName, Primitive[]>>): Scene {
  return { layers: sceneFixture().layers.map((l) => ({ ...l, primitives: byLayer[l.name] ?? [] })) };
}

const names = (batches: Batch[]): string[] => batches.map((b) => `${b.layer}/${b.kind}`);

/** Sum of the triangle areas of a polygon batch (x, y are the first two floats of each vertex). */
function triangleArea(batch: Batch): number {
  let sum = 0;
  for (let t = 0; t < batch.count; t += 3) {
    const v = (i: number): Point => ({ x: batch.data[(t + i) * POLYGON_VERTEX_FLOATS] ?? NaN, y: batch.data[(t + i) * POLYGON_VERTEX_FLOATS + 1] ?? NaN });
    const [a, b, d] = [v(0), v(1), v(2)];
    sum += Math.abs((b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y)) / 2;
  }
  return sum;
}

function ringArea(points: readonly Point[]): number {
  let twice = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    twice += p.x * q.y - q.x * p.y;
  });
  return Math.abs(twice) / 2;
}

describe("parseColor", () => {
  it("parses #rrggbb and #rrggbbaa as straight RGBA", () => {
    expect(parseColor("#1d1d1f")).toEqual([c(0x1d), c(0x1d), c(0x1f), 1]);
    expect(parseColor("#2563eb99")).toEqual([c(0x25), c(0x63), c(0xeb), c(0x99)]);
  });

  it("parses the short forms", () => {
    expect(parseColor("#e67")).toEqual([c(0xee), c(0x66), c(0x77), 1]);
    expect(parseColor("#e678")).toEqual([c(0xee), c(0x66), c(0x77), c(0x88)]);
  });

  it("draws anything else magenta instead of throwing mid-frame", () => {
    expect(parseColor("red")).toEqual([1, 0, 1, 1]);
    expect(parseColor("#12345")).toEqual([1, 0, 1, 1]);
  });

  it("parses every palette colour", () => {
    for (const value of Object.values(COLORS)) expect(parseColor(value)).not.toEqual([1, 0, 1, 1]);
  });
});

describe("dashPair", () => {
  it("follows Canvas2D setLineDash for the first on/off pair", () => {
    expect(dashPair(undefined)).toEqual([0, 0]);
    expect(dashPair([])).toEqual([0, 0]);
    expect(dashPair([4, 2])).toEqual([4, 2]);
    expect(dashPair([3])).toEqual([3, 3]); // an odd list repeats
    expect(dashPair([4, 2, 1, 1])).toEqual([4, 2]); // longer patterns keep their first pair
  });

  it("treats invalid or empty patterns as solid", () => {
    expect(dashPair([4, -1])).toEqual([0, 0]);
    expect(dashPair([4, Number.NaN])).toEqual([0, 0]);
    expect(dashPair([0, 0])).toEqual([0, 0]);
    expect(dashPair([4, 0])).toEqual([0, 0]);
  });
});

describe("arcSpan", () => {
  it("sweeps counter-clockwise from `from` to `to`", () => {
    expect(arcSpan(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcSpan(Math.PI / 2, 0)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(arcSpan(1, 1)).toBe(0);
  });

  it("is a full circle for a sweep of 2π or more", () => {
    expect(arcSpan(0, 2 * Math.PI)).toBe(2 * Math.PI);
    expect(arcSpan(0, 5 * Math.PI)).toBe(2 * Math.PI);
  });
});

describe("buildFrame", () => {
  it("has no batches and no text for an empty scene", () => {
    expect(buildFrame(sceneFixture())).toEqual({ batches: [], texts: [] });
  });

  it("encodes a segment: ends in metres, width and unit, cap, dash, colour", () => {
    const frame = buildFrame(
      sceneWith({
        walls: [
          { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0.5 }, width: { m: 0.2 }, color: "#111111", cap: "butt" },
          { kind: "segment", a: { x: 2, y: 0 }, b: { x: 2, y: 1 }, width: { px: 1.5 }, color: "#2563eb99", cap: "round", dash: [4, 2] },
        ],
      }),
    );
    expect(frame.batches).toHaveLength(1);
    const batch = frame.batches[0];
    expect(batch?.count).toBe(2);
    expect(Array.from(batch?.data ?? [])).toEqual(
      f32([
        0, 0, 1, 0.5, 0.2, UNIT_M, CAP_BUTT, 0, 0, c(0x11), c(0x11), c(0x11), 1,
        2, 0, 2, 1, 1.5, UNIT_PX, CAP_ROUND, 4, 2, c(0x25), c(0x63), c(0xeb), c(0x99),
      ]),
    );
    expect(batch?.data.length).toBe(2 * SEGMENT_FLOATS);
  });

  it("skips a zero-length butt segment but keeps a zero-length round one (a dot, as in Canvas2D)", () => {
    const p = { x: 1, y: 1 };
    const frame = buildFrame(
      sceneWith({
        overlays: [
          { kind: "segment", a: p, b: p, width: { px: 2 }, color: "#000000", cap: "butt" },
          { kind: "segment", a: p, b: p, width: { px: 2 }, color: "#000000", cap: "round" },
        ],
      }),
    );
    expect(frame.batches.map((b) => b.count)).toEqual([1]);
  });

  it("encodes a disc and an arc", () => {
    const frame = buildFrame(
      sceneWith({
        overlays: [
          { kind: "disc", center: { x: 1, y: 2 }, radius: { px: 5 }, color: "#ffffff" },
          { kind: "arc", center: { x: 0, y: 0 }, radius: 0.5, from: Math.PI / 2, to: 0, width: { px: 1 }, color: "#444444" },
        ],
      }),
    );
    expect(names(frame.batches)).toEqual(["overlays/arc", "overlays/disc"]);
    expect(Array.from(frame.batches[0]?.data ?? [])).toEqual(
      f32([0, 0, 0.5, Math.PI / 2, (3 * Math.PI) / 2, 1, UNIT_PX, c(0x44), c(0x44), c(0x44), 1]),
    );
    expect(frame.batches[0]?.data.length).toBe(ARC_FLOATS);
    expect(Array.from(frame.batches[1]?.data ?? [])).toEqual(f32([1, 2, 5, UNIT_PX, 1, 1, 1, 1]));
    expect(frame.batches[1]?.data.length).toBe(DISC_FLOATS);
  });

  it("skips an empty arc", () => {
    const arc: Primitive = { kind: "arc", center: { x: 0, y: 0 }, radius: 1, from: 1, to: 1, width: { px: 1 }, color: "#000000" };
    expect(buildFrame(sceneWith({ overlays: [arc] })).batches).toEqual([]);
  });

  it("triangulates a polygon into coloured vertices covering its area, and skips degenerate ones", () => {
    const square: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], color: "#dce8f7aa" };
    const line: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: "#000000" };
    const frame = buildFrame(sceneWith({ zoneFills: [square, line] }));
    const batch = frame.batches[0];
    if (!batch) throw new Error("no batch");
    expect(batch.count).toBe(6); // two triangles
    expect(batch.data.length).toBe(6 * POLYGON_VERTEX_FLOATS);
    expect(triangleArea(batch)).toBeCloseTo(4, 9);
    expect(Array.from(batch.data.slice(2, 6))).toEqual(f32([c(0xdc), c(0xe8), c(0xf7), c(0xaa)]));
  });

  it("makes one batch per non-empty (layer × kind): layers in scene order, kinds polygon, segment, arc, disc", () => {
    const seg: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt" };
    const poly: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], color: "#000000" };
    const disc: Primitive = { kind: "disc", center: { x: 0, y: 0 }, radius: { px: 3 }, color: "#000000" };
    const frame = buildFrame(sceneWith({ presence: [disc], walls: [disc, seg, poly, seg], grid: [seg] }));
    expect(names(frame.batches)).toEqual(["grid/segment", "walls/polygon", "walls/segment", "walls/disc", "presence/disc"]);
    expect(frame.batches.map((b) => b.count)).toEqual([1, 3, 2, 1, 1]);
  });

  it("passes text through for the overlay, in scene order, and makes no batch for it", () => {
    const tag: Primitive = { kind: "text", text: "Kitchen", at: { x: 1, y: 1 }, size: 12, color: "#1d1d1f", align: "center", rotation: 0 };
    const name: Primitive = { kind: "text", text: "Bob", at: { x: 2, y: 2 }, size: 11, color: "#0090ff", align: "left", rotation: 0 };
    const frame = buildFrame(sceneWith({ presence: [name], annotations: [tag] }));
    expect(frame.batches).toEqual([]);
    expect(frame.texts).toEqual([tag, name]);
  });
});

describe("buildFrame on the demo drawing", () => {
  /** Demo step 4: the divided room with a zone in each half; the pointer rests away from the drawing. */
  function step4(): FakeShell {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    shell.click({ x: 4.5, y: 2 });
    shell.key("v");
    shell.moveTo({ x: 3, y: -2 });
    return shell;
  }

  it("draws step 4 in 5 draw calls, and the edge segments are the walls' outline edges", () => {
    const scene = step4().scene();
    const frame = buildFrame(scene);
    expect(names(frame.batches)).toEqual(["grid/segment", "zoneFills/polygon", "walls/polygon", "walls/segment", "tags/polygon"]);
    const walls = scene.layers.find((l) => l.name === "walls")?.primitives ?? [];
    const outlines = walls.flatMap((p) => (p.kind === "polygon" ? [p] : []));
    expect(frame.batches[3]?.count).toBe(outlines.reduce((n, p) => n + p.points.length, 0));
    expect(frame.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["10.64 m²"]));
  });

  it("triangulates every wall outline of the demo drawing, T-junctions included, without losing area", () => {
    const scene = step4().scene();
    const walls = scene.layers.find((l) => l.name === "walls")?.primitives ?? [];
    const outlines = walls.flatMap((p) => (p.kind === "polygon" ? [p] : []));
    const batch = buildFrame(scene).batches.find((b) => b.layer === "walls" && b.kind === "polygon");
    if (!batch) throw new Error("no wall batch");
    expect(outlines).toHaveLength(7);
    expect(triangleArea(batch)).toBeCloseTo(outlines.reduce((a, p) => a + ringArea(p.points), 0), 4); // float32 vertices
  });

  it("draws step 5 (a selected wall with its helper) in 8 draw calls: tag plates and the helper plate are separate layers", () => {
    const shell = step4();
    shell.click({ x: 6, y: 1 });
    expect(names(buildFrame(shell.scene()).batches)).toEqual([
      "grid/segment",
      "zoneFills/polygon",
      "walls/polygon",
      "walls/segment",
      "tags/polygon",
      "annotations/polygon",
      "annotations/segment",
      "overlays/disc",
    ]);
  });
});

describe("buildLayer (spec §6.2, P3)", () => {
  it("builds one layer's batches and texts; buildFrame is the layers' results in order", () => {
    const seg = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt" } as const;
    const disc = { kind: "disc", center: { x: 1, y: 2 }, radius: { px: 5 }, color: "#ffffff" } as const;
    const text = { kind: "text", text: "Kitchen", at: { x: 0, y: 0 }, size: 12, color: "#000000", align: "center", rotation: 0 } as const;
    const scene = sceneWith({ walls: [seg, disc], tags: [text, seg], presence: [disc] });
    const perLayer = scene.layers.map((l) => buildLayer(l));
    expect(names(perLayer.flatMap((f) => f.batches))).toEqual(["walls/segment", "walls/disc", "tags/segment", "presence/disc"]);
    expect(buildFrame(scene)).toEqual({ batches: perLayer.flatMap((f) => f.batches), texts: perLayer.flatMap((f) => f.texts) });
    expect(buildLayer({ name: "grid", primitives: [] })).toEqual({ batches: [], texts: [] });
  });
});
