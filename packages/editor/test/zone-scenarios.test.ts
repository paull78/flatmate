import { describe, expect, it } from "vitest";
import { execute, unwrap, type Document } from "@fm/domain";
import { dividedRoomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

function kitchenAndDining(): Document {
  let doc = dividedRoomDoc();
  doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" })).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Dining" })).doc;
}

describe("merging labelled rooms (spec §3.6, §9 acceptance)", () => {
  it("deleting the divider keeps one label with both names in label-ID order", () => {
    const shell = FakeShell.withDocument(kitchenAndDining());
    shell.click({ x: 3, y: 2 }); // the divider
    shell.key("Delete");
    expect(shell.doc().zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining" } });
    expect(Object.keys(shell.doc().walls)).toHaveLength(6);
    expect(shell.state.selection).toEqual([]);
    shell.click({ x: 1, y: 3 });
    const props = shell.view().properties;
    expect(props.kind === "zone" && props.fields.map((f) => f.value)).toEqual(["Kitchen / Dining", "22.04 m²"]);
  });

  it("one undo restores the divider and both labels", () => {
    const shell = FakeShell.withDocument(kitchenAndDining());
    shell.click({ x: 3, y: 2 });
    shell.key("Delete");
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(kitchenAndDining());
  });
});
