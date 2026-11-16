import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Document } from "@fm/domain";
import { dividedRoomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

function kitchenAndDining(): Document {
  let doc = dividedRoomDoc();
  doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen", finish: null })).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Dining", finish: null })).doc;
}

describe("merging labelled rooms (spec: walls-rooms; docs/architecture.md acceptance)", () => {
  it("deleting the divider keeps one label with both names in label-ID order", () => {
    const shell = FakeShell.withDocument(kitchenAndDining());
    shell.click({ x: 3, y: 2 }); // the divider
    shell.key("Delete");
    expect(shell.doc().zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining", finish: null } });
    expect(Object.keys(shell.doc().walls)).toHaveLength(4); // the divider's T joints stitch the bottom and top sides (straight.05)
    expect(shell.state.selection).toEqual([]);
    shell.click({ x: 1, y: 3 });
    const props = shell.view().properties;
    expect(props.kind === "zone" && props.fields.filter((f) => !f.id.startsWith("walls") && !f.finish).map((f) => f.value)).toEqual(["Kitchen / Dining", "22.04 m²", "none"]);
  });

  it("one undo restores the divider and both labels", () => {
    const shell = FakeShell.withDocument(kitchenAndDining());
    shell.click({ x: 3, y: 2 });
    shell.key("Delete");
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(kitchenAndDining());
  });
});

describe("closing a loop around a label (holes.03)", () => {
  it("one undo removes the closing wall and puts the label back (AC-13)", () => {
    const start = withCommands(
      emptyDocument(),
      ...rectangleRoom({ x: 0, y: 0 }, 10, 8, "apt"),
      { type: "labelZone", id: "L1", at: { x: 5, y: 4 }, name: "Living", finish: null },
    );
    const shell = FakeShell.withDocument(start);
    const core = [{ x: 3.5, y: 2.5 }, { x: 6.5, y: 2.5 }, { x: 6.5, y: 5.5 }, { x: 3.5, y: 5.5 }];
    const wall = (i: number) => {
      const from = core[i % 4];
      const to = core[(i + 1) % 4];
      if (!from || !to) throw new Error("corner");
      shell.command({ type: "addWall", opId: `c${i}`, from: { at: from }, to: { at: to } });
    };
    for (let i = 0; i < 3; i++) wall(i);
    const three = shell.doc();
    wall(3);
    const at = () => shell.doc().zoneLabels.L1?.at;
    expect(at()?.x).toBeCloseTo(1.75, 6);
    expect(at()?.y).toBeCloseTo(4, 6);

    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(three);
    expect(at()).toEqual({ x: 5, y: 4 });

    shell.key("z", { meta: true, shift: true });
    expect(at()?.x).toBeCloseTo(1.75, 6);
    expect(at()?.y).toBeCloseTo(4, 6);
  });
});
