import { describe, expect, it } from "vitest";
import { faceAt, type EntityRef } from "@fm/domain";
import { dividedRoomDoc, labelledDoc } from "./builders";
import { FakeShell } from "./fake-shell";

const zone = (id: string): EntityRef => ({ table: "zoneLabels", id });
const labels = (shell: FakeShell) => Object.values(shell.doc().zoneLabels);

function zoneTool(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "zone") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

describe("zone tool (spec §3.6, §5.6)", () => {
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
    expect(props.kind === "zone" && props.fields.map((f) => f.value)).toEqual(["Room 1", "10.64 m²"]);
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
});
