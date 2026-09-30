import { describe, expect, it } from "vitest";
import { zones } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { dividedRoomDoc, labelledDoc, withOrphan } from "./builders";
import { FakeShell } from "./fake-shell";

function layer(shell: FakeShell, name: string): Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}
const fills = (shell: FakeShell, color: string) => layer(shell, "zoneFills").filter((p) => p.kind === "polygon" && p.color === color);
const texts = (shell: FakeShell) => layer(shell, "annotations").flatMap((p) => (p.kind === "text" ? [p.text] : []));

describe("zones in the Scene (spec §3.6, §5.6)", () => {
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
