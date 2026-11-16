import { describe, expect, it } from "vitest";
import { motifDefaults, placementCentre, zones, type Document, type Finish, type MotifId } from "@fm/domain";
import { finishesLayer, visibleRooms } from "../../src/view/finishes-layer";
import { roomFinishes } from "../../src/view/finish/rooms";
import { mixColour } from "../../src/view/finish/geometry";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../../src/view/plan-style";
import type { LayerName, Primitive, Scene } from "../../src/view/scene-types";
import { labelledDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";

// The floors layer on the canvas (AC-03, AC-06 screen thresholds; finishes.03, .16, .18).

const MIN = CANVAS_STYLE.finish?.minSpacing ?? NaN;

/** labelledDoc with Room 1 (L1, clear floor x 0.1–2.9, y 0.1–3.9) finished; Room 2 (L2) stays unfinished. */
function finished(finish: Finish): Document {
  return withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish });
}
const motif = (m: MotifId, more: Partial<Finish> = {}): Finish => ({ ...motifDefaults(m), ...more });

const polygons = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p] : []));
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const at = (doc: Document, zoom: number): readonly Primitive[] => finishesLayer(roomFinishes(doc), CANVAS_STYLE, visibleRooms(doc, zoom, MIN));
const layer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];

describe("the floors layer (AC-03)", () => {
  it("a finished room draws a polygon in its base colour and its lines; an unfinished one nothing", () => {
    const finish = motif("planks");
    const doc = finished(finish);
    const room = zones(doc).find((z) => z.labelIds.includes("L1"));
    const drawn = at(doc, 130);
    const fills = polygons(drawn);
    expect(fills).toHaveLength(1); // Room 2 has no finish
    expect(fills[0]?.color).toBe(finish.colour);
    expect(fills[0]?.points).toEqual(room?.floor);
    expect(fills[0]?.holes).toEqual([]);
    const lines = segments(drawn);
    expect(lines.length).toBeGreaterThan(10);
    const shade = mixColour(finish.colour, 0.6, finish.strength);
    for (const s of lines) {
      expect(s).toMatchObject({ width: { px: CANVAS_STYLE.finish?.line }, color: shade, cap: "butt" });
      expect(s.dash).toBeUndefined();
      for (const p of [s.a, s.b]) expect(p.x >= 0.1 - 1e-9 && p.x <= 2.9 + 1e-9 && p.y >= 0.1 - 1e-9 && p.y <= 3.9 + 1e-9).toBe(true);
    }
    expect(at(labelledDoc(), 130)).toEqual([]);
  });

  it("draws every fill before any line, as the GPU renderers draw a layer's polygons before its segments", () => {
    const doc = withCommands(finished(motif("planks")), { type: "setFinish", id: "L2", finish: motif("squareTiles") });
    const kinds = at(doc, 130).map((p) => p.kind);
    expect(kinds.slice(0, 2)).toEqual(["polygon", "polygon"]);
    expect(kinds.slice(2).length).toBeGreaterThan(0);
    expect(kinds.slice(2).every((k) => k === "segment")).toBe(true);
  });

  it("planks 0.20: lines at 130 px/m, none at 15 px/m", () => {
    const doc = finished(motif("planks", { size: 0.2 }));
    expect(visibleRooms(doc, 130, MIN)).toBe("L1");
    expect(segments(at(doc, 130)).length).toBeGreaterThan(0);
    expect(visibleRooms(doc, 15, MIN)).toBe("");
    expect(at(doc, 15).map((p) => p.kind)).toEqual(["polygon"]);
  });

  it("herringbone 0.09: none at 40 px/m, lines at 50; the same at 30°", () => {
    for (const angle of [45, 30]) {
      const doc = finished(motif("herringbone", { size: 0.09, angle }));
      expect(segments(at(doc, 40)), `${angle}°`).toEqual([]);
      expect(segments(at(doc, 50)).length, `${angle}°`).toBeGreaterThan(0);
    }
  });

  it("a too-fine room draws its colour alone", () => {
    const doc = finished(motif("mosaic", { size: 0.02 })); // 2.8 × 3.8 m in 2 cm tiles: over the 20,000-cell cap
    expect(visibleRooms(doc, 10_000, MIN)).toBe("");
    expect(at(doc, 10_000).map((p) => p.kind)).toEqual(["polygon"]);
  });

  it("draws nothing in a style without finishes (look)", () => {
    const doc = finished(motif("planks"));
    expect(LOOK_STYLE.finish).toBeNull();
    expect(finishesLayer(roomFinishes(doc), LOOK_STYLE, "L1")).toEqual([]);
  });

  it("draws its lines in the style's hairline (paper: 0.1 mm)", () => {
    const doc = finished(motif("planks"));
    const lines = segments(finishesLayer(roomFinishes(doc), PRESENTATION_STYLE, visibleRooms(doc, 50, PRESENTATION_STYLE.finish?.minSpacing ?? NaN)));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((s) => "px" in s.width && s.width.px === 0.1)).toBe(true);
  });
});

describe("the floors layer's memoisation (finishes.18)", () => {
  it("the layer keeps its array across zoom frames while no room crosses its threshold", () => {
    const shell = FakeShell.withDocument(finished(motif("planks", { size: 0.2 })));
    const before = layer(shell.scene(), "finishes");
    expect(segments(before).length).toBeGreaterThan(0);
    shell.wheel(0, -40, { ctrl: true });
    expect(shell.state.camera.zoom).not.toBe(80);
    expect(layer(shell.scene(), "finishes")).toBe(before);
    for (let i = 0; i < 100 && shell.state.camera.zoom * 0.2 >= MIN; i++) shell.wheel(0, 40, { ctrl: true });
    expect(shell.state.camera.zoom * 0.2).toBeLessThan(MIN);
    const zoomedOut = layer(shell.scene(), "finishes");
    expect(zoomedOut).not.toBe(before);
    expect(zoomedOut.map((p) => p.kind)).toEqual(["polygon"]);
  });

  it("a furniture drag keeps each room's geometry", () => {
    const doc = withCommands(finished(motif("planks")), { type: "setFinish", id: "L2", finish: motif("mosaic") });
    const moved = withCommands(doc, { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3 } });
    expect(Object.keys(moved.placements)).toHaveLength(1);
    const before = roomFinishes(doc);
    const after = roomFinishes(moved);
    expect(after.map((r) => r.id).sort()).toEqual(["L1", "L2"]);
    const faceOf = (label: string): string | undefined => zones(moved).find((z) => z.labelIds.includes(label))?.face.key;
    for (const r of after) expect(r.room).toBe(faceOf(r.id)); // 3D keys floor items by face key
    after.forEach((room, i) => {
      expect(room.geometry).toBe(before[i]?.geometry);
      expect(room.geometry.lines).toBe(before[i]?.geometry.lines);
    });
    expect(after).toBe(before); // the same rooms, ids and geometries: the same array, so the layer is reused
    expect(roomFinishes(withCommands(moved, { type: "setFinish", id: "L2", finish: motif("planks") }))).not.toBe(after);
  });

  it("a piece dragged over several frames keeps the layer's array; a wall drag rebuilds it", () => {
    const doc = withCommands(finished(motif("planks")), { type: "placeObject", deck: null, opId: "chair", state: "s0", object: { kind: "armchair" }, at: { x: 1.5, y: 1 } }); // clear of L1's tag at (1.5, 2)
    const shell = FakeShell.withDocument(doc);
    const before = layer(shell.scene(), "finishes");
    expect(segments(before).length).toBeGreaterThan(0);
    const placement = shell.doc().placements["chair/p0"];
    const grab = (placement && placementCentre(shell.doc(), placement)) ?? { x: NaN, y: NaN };
    shell.moveTo(grab);
    shell.down(grab);
    const docs = new Set<unknown>();
    for (const [i, dx] of [0.1, 0.2, 0.3, 0.4].entries()) {
      shell.moveTo({ x: grab.x + dx, y: grab.y });
      const tool = shell.state.tool;
      if (tool.name === "select" && tool.state.kind === "moving" && tool.state.target.kind === "placement") docs.add(tool.state.attempt.doc);
      expect(layer(shell.scene(), "finishes"), `frame ${i}`).toBe(before);
    }
    expect(docs.size).toBe(4); // every frame drew a new document
    shell.up({ x: grab.x + 0.4, y: grab.y });
    expect(shell.doc().placements["chair/p0"]?.at.x).toBeCloseTo(1.9, 6);
    expect(layer(shell.scene(), "finishes")).toBe(before);
    shell.moveTo({ x: 3, y: 1 }); // the dividing wall, x = 3
    shell.down({ x: 3, y: 1 });
    shell.moveTo({ x: 3.2, y: 1 });
    shell.moveTo({ x: 3.4, y: 1 });
    const dragged = layer(shell.scene(), "finishes");
    expect(dragged).not.toBe(before);
    expect(polygons(dragged)[0]?.points).not.toEqual(polygons(before)[0]?.points);
  });
});
