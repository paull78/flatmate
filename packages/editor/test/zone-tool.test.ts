import { describe, expect, it } from "vitest";
import { faceAt, motifDefaults, zoneOfLabel, zones, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { dividedRoomDoc, donutDoc, labelledDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

const zone = (id: string): EntityRef => ({ table: "zoneLabels", id });
const labels = (shell: FakeShell) => Object.values(shell.doc().zoneLabels);

function zoneTool(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "zone") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

describe("zone tool (spec: walls-rooms, tools)", () => {
  it("labels an unlabelled room where it was clicked and selects the zone", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    const [label] = labels(shell);
    expect(labels(shell)).toHaveLength(1);
    expect(label?.name).toBe("Room 1");
    expect(label?.at).toEqual({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([zone(label?.id ?? "")]);
    const props = shell.view().properties;
    expect(props.kind === "zone" && props.fields.filter((f) => !f.id.startsWith("walls") && !f.finish).map((f) => f.value)).toEqual(["Room 1", "10.64 m²", "none"]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("numbers new zones", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    shell.click({ x: 4.5, y: 2 });
    expect(labels(shell).map((l) => l.name).sort()).toEqual(["Room 1", "Room 2"]);
  });

  it("selects a labelled room by its floor or tag without creating another label", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.key("z");
    shell.click({ x: 1, y: 3.5 }); // floor
    expect(shell.state.selection).toEqual([zone("L1")]);
    shell.click({ x: 4.5, y: 2 }); // tag
    expect(shell.state.selection).toEqual([zone("L2")]);
    expect(labels(shell)).toHaveLength(2);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("does nothing on a boundary or outside every room", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.click({ x: 3, y: 2 }); // on the divider's centreline
    shell.click({ x: 8, y: 1 }); // outside
    expect(labels(shell)).toHaveLength(0);
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().toast).toBeNull();
  });

  it("tracks the room under the cursor", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.key("z");
    shell.moveTo({ x: 4.5, y: 2 });
    expect(zoneTool(shell).hoverFaceKey).toBe(faceAt(shell.doc(), { x: 4.5, y: 2 })?.key);
    shell.moveTo({ x: 8, y: 1 });
    expect(zoneTool(shell).hoverFaceKey).toBeNull();
  });

  it("Delete removes the selected zone's label only", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const walls = shell.doc().walls;
    shell.key("z");
    shell.click({ x: 1, y: 3.5 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().zoneLabels)).toEqual(["L2"]);
    expect(shell.doc().walls).toEqual(walls);
    expect(shell.state.selection).toEqual([]);
  });

  it("a click inside the core reaches the core's room; a click on the core's wall body reaches the ring", () => {
    const shell = FakeShell.withDocument(withCommands(donutDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Living", finish: null }));
    const core = zones(shell.doc()).find((z) => z.holes.length === 0);
    if (!core) throw new Error("no core room");
    shell.click({ x: 5, y: 4 }); // Select tool: the core's room is unlabelled
    expect(shell.state.selection).toEqual([]);
    shell.key("z");
    shell.click({ x: 3.45, y: 4 }); // on the core's left wall body, outside its outline: the ring
    expect(shell.state.selection).toEqual([zone("L1")]);
    expect(labels(shell)).toHaveLength(1);
    shell.click({ x: 5, y: 4 });
    const added = labels(shell).find((l) => l.id !== "L1");
    if (!added) throw new Error("no new label");
    const room = zoneOfLabel(shell.doc(), added.id);
    expect(room?.face.key).toBe(core.face.key);
    expect(room?.area).toBeCloseTo(7.84, 9);
  });
});

/** One room with two labels, as a merge leaves them (labelZone refuses a second): l10 comes first in string order. */
function twoLabelRoom(): Document {
  const doc = roomDoc();
  const label = (id: string, at: Point, name: string) => ({ id, at, name, finish: null });
  return { ...doc, zoneLabels: { l9: label("l9", { x: 1, y: 1 }, "Nine"), l10: label("l10", { x: 5, y: 1 }, "Ten") } };
}

describe("Floor mode of the Zone tool (finishes.19, AC-07, AC-01)", () => {
  it("a click in a labelled room sets its first label's finish to the motif's defaults", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.ui({ type: "pickMotif", motif: "planks" });
    shell.click({ x: 1, y: 3.5 }); // L1's floor, off its tag
    expect(shell.doc().zoneLabels["L1"]?.finish).toEqual(motifDefaults("planks"));
    expect(shell.doc().zoneLabels["L2"]?.finish).toBeNull();
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection).toEqual([zone("L1")]); // as a Zone tool click selects the room
    expect(zoneTool(shell).motif).toBe("planks"); // still armed for the next room
  });

  it("a click on the room's tag does the same (not a selection)", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.ui({ type: "pickMotif", motif: "herringbone" });
    shell.click({ x: 4.5, y: 2 }); // L2's tag
    expect(shell.doc().zoneLabels["L2"]?.finish).toEqual(motifDefaults("herringbone"));
    expect(shell.doc().zoneLabels["L1"]?.finish).toBeNull();
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a click in an unlabelled room makes one labelZone with the finish, named by nextRoomName; one undo removes the label", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.ui({ type: "pickMotif", motif: "squareTiles" });
    shell.click({ x: 1.5, y: 2 });
    const [label] = labels(shell);
    expect(labels(shell)).toHaveLength(1);
    expect(label).toMatchObject({ name: "Room 1", at: { x: 1.5, y: 2 }, finish: motifDefaults("squareTiles") });
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection).toEqual([zone(label?.id ?? "")]);
    shell.ui({ type: "undo" });
    expect(labels(shell)).toHaveLength(0);
  });

  it("a click outside every room, or on a boundary, changes nothing", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const before = shell.doc();
    shell.ui({ type: "pickMotif", motif: "planks" });
    shell.click({ x: 8, y: 1 }); // outside
    shell.click({ x: 3, y: 3.5 }); // on the divider's centreline
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().toast).toBeNull();
  });

  it("a room with two labels l10 and l9: the click sets l10's finish", () => {
    const shell = FakeShell.withDocument(twoLabelRoom());
    shell.ui({ type: "pickMotif", motif: "mosaic" });
    shell.click({ x: 3, y: 3 });
    expect(shell.doc().zoneLabels["l10"]?.finish).toEqual(motifDefaults("mosaic"));
    expect(shell.doc().zoneLabels["l9"]?.finish).toBeNull();
  });

  it("the tag of a room's second label gives the finish to its first label", () => {
    const shell = FakeShell.withDocument(twoLabelRoom());
    shell.ui({ type: "pickMotif", motif: "plain" });
    shell.click({ x: 1, y: 1 }); // l9's tag
    expect(shell.doc().zoneLabels["l10"]?.finish).toEqual(motifDefaults("plain"));
    expect(shell.doc().zoneLabels["l9"]?.finish).toBeNull();
  });
});
