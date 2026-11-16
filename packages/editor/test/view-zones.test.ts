import { describe, expect, it } from "vitest";
import { boxOf, emptyDocument, rectangleRoom, signedArea, zones, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { dividedRoomDoc, donutDoc, labelledDoc, withCommands, withOrphan } from "./builders";
import { FakeShell } from "./fake-shell";

function layer(shell: FakeShell, name: string): readonly Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}
const fills = (shell: FakeShell, color: string) => layer(shell, "zoneFills").filter((p) => p.kind === "polygon" && p.color === color);
const polygons = (shell: FakeShell, color: string) => layer(shell, "zoneFills").flatMap((p) => (p.kind === "polygon" && p.color === color ? [p] : []));
const texts = (shell: FakeShell) => layer(shell, "tags").flatMap((p) => (p.kind === "text" ? [p.text] : []));

describe("zones in the Scene (spec: walls-rooms, tools)", () => {
  it("fills labelled rooms and draws their tags", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    expect(fills(shell, COLORS.zoneFill)).toHaveLength(2);
    expect(texts(shell)).toEqual(expect.arrayContaining(["Room 1", "10.64 m²", "Room 2"]));
  });

  it("highlights the selected zone's floor", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    const selected = fills(shell, COLORS.zoneFillSelected);
    const floor = zones(shell.doc()).find((z) => z.labelIds.includes("L1"))?.floor;
    expect(selected).toHaveLength(1);
    expect(selected[0]?.kind === "polygon" && selected[0].points).toEqual(floor);
    expect(fills(shell, COLORS.zoneFill)).toHaveLength(1);
  });

  it("shows unlabelled rooms as faint hints only while Z is active", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    expect(layer(shell, "zoneFills")).toEqual([]);
    shell.key("z");
    expect(fills(shell, COLORS.zoneHint)).toHaveLength(2);
  });

  it("highlights the room under the cursor in the Zone tool", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.moveTo({ x: 4.5, y: 2 });
    expect(fills(shell, COLORS.zoneFillSelected)).toHaveLength(1);
    expect(fills(shell, COLORS.zoneHint)).toHaveLength(1);
  });

  it("draws an orphan's tag with its note", () => {
    const shell = FakeShell.withDocument(withOrphan(labelledDoc()));
    expect(texts(shell)).toEqual(expect.arrayContaining(["Lost", "no enclosing walls"]));
  });

  it("keeps each room's label and fill while a divider is dragged past a label, and after release", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const labelsPerRoom = () => zones(shell.doc()).map((z) => z.labelIds.length);
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 }); // the divider
    shell.moveTo({ x: 4, y: 2 });
    shell.moveTo({ x: 5, y: 2 }); // past "Room 2" at (4.5, 2)
    const t = shell.state.tool;
    const preview = t.name === "select" && t.state.kind === "moving" && t.state.attempt.ok ? t.state.attempt.doc : null;
    expect(preview && zones(preview).map((z) => z.labelIds.length)).toEqual([1, 1]);
    expect(fills(shell, COLORS.zoneFill)).toHaveLength(2);
    expect(texts(shell)).toEqual(expect.arrayContaining(["Room 1", "Room 2"]));
    shell.up({ x: 5, y: 2 });
    expect(Object.values(shell.doc().joints).filter((j) => j.x === 5)).toHaveLength(2); // the divider moved
    expect(labelsPerRoom()).toEqual([1, 1]);
    expect(fills(shell, COLORS.zoneFill)).toHaveLength(2);
    expect(texts(shell)).toEqual(expect.arrayContaining(["Room 1", "Room 2"]));
  });
});

describe("rooms with holes in the Scene (AC-07)", () => {
  const labelledDonut = (): Document => withCommands(donutDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Living", finish: null });
  const apartment = (doc: Document) => {
    const z = zones(doc).find((r) => r.holes.length === 1);
    if (!z) throw new Error("no room with a hole");
    return z;
  };

  it("fills a room with a core as its floor with the core's footprint cut out (AC-07)", () => {
    const shell = FakeShell.withDocument(labelledDonut());
    shell.moveTo({ x: -2, y: -2 });
    const zone = apartment(shell.doc());
    const filled = polygons(shell, COLORS.zoneFill);
    expect(filled).toHaveLength(1); // the core's interior is unlabelled
    const [fill] = filled;
    if (!fill) throw new Error("no fill");
    expect(fill.points).toEqual(zone.floor);
    const box = boxOf(fill.points);
    expect([box.minX, box.minY, box.maxX, box.maxY].map((v) => v.toFixed(9))).toEqual(["0.100000000", "0.100000000", "9.900000000", "7.900000000"]);
    expect(fill.holes).toEqual([zone.holes[0]?.footprint]);
    const hole = boxOf(fill.holes[0] ?? []);
    expect([hole.minX, hole.minY, hole.maxX, hole.maxY].map((v) => v.toFixed(9))).toEqual(["3.400000000", "2.400000000", "6.600000000", "5.600000000"]);
    const net = Math.abs(signedArea(fill.points)) - fill.holes.reduce((a, h) => a + Math.abs(signedArea(h)), 0);
    expect(net).toBeCloseTo(66.2, 9); // 76.44 − 10.24
  });

  it("the Zone tool's hover and hint carry holes (AC-07)", () => {
    const shell = FakeShell.withDocument(donutDoc());
    shell.key("z");
    shell.moveTo({ x: 1, y: 1 });
    let hovered = polygons(shell, COLORS.zoneFillSelected);
    let hints = polygons(shell, COLORS.zoneHint);
    expect(hovered).toHaveLength(1);
    expect(hovered[0]?.holes).toHaveLength(1);
    expect(hints).toHaveLength(1);
    expect(Math.abs(signedArea(hints[0]?.points ?? []))).toBeCloseTo(7.84, 9);
    expect(hints[0]?.holes).toEqual([]);
    shell.moveTo({ x: 5, y: 4 });
    hovered = polygons(shell, COLORS.zoneFillSelected);
    hints = polygons(shell, COLORS.zoneHint);
    expect(hovered).toHaveLength(1);
    expect(Math.abs(signedArea(hovered[0]?.points ?? []))).toBeCloseTo(7.84, 9);
    expect(hovered[0]?.holes).toEqual([]);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.holes).toHaveLength(1);
  });

  it("the selected zone's highlight carries holes (AC-07)", () => {
    const shell = FakeShell.withDocument(labelledDonut());
    shell.click({ x: 1, y: 1 });
    const selected = polygons(shell, COLORS.zoneFillSelected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.holes).toEqual([apartment(shell.doc()).holes[0]?.footprint]);
  });

  it("an unavailable room is filled along its centreline ring minus each hole's outline", () => {
    const doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"), ...rectangleRoom({ x: 0.3, y: 1 }, 1, 1, "g", 0.5));
    const shell = FakeShell.withDocument(doc);
    shell.key("z");
    const zone = apartment(doc);
    expect(zone.area).toBeNull();
    const hint = polygons(shell, COLORS.zoneHint).find((p) => p.holes.length > 0);
    if (!hint) throw new Error("no hint with a hole");
    expect(hint.points).toEqual(zone.face.ring);
    expect(hint.holes).toEqual([zone.holes[0]?.outline]);
    const box = boxOf(hint.holes[0] ?? []);
    expect([box.minX, box.minY, box.maxX, box.maxY].map((v) => v.toFixed(9))).toEqual(["0.300000000", "1.000000000", "1.300000000", "2.000000000"]);
  });
});
