import { describe, expect, it } from "vitest";
import { execute, unwrap, type Document, type EntityRef } from "@fm/domain";
import type { EditorState } from "../src/state";
import { buildViewModel, type ViewModel } from "../src/view/view-model";
import { labelledDoc, localState, narrowRoomDoc, wallBetween, withOrphan } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

const host = new FakeHost();
const zone = (id: string): EntityRef => ({ table: "zoneLabels", id });
const selecting = (doc: Document, id: string): EditorState => ({ ...localState(host, doc), selection: [zone(id)] });
const values = (vm: ViewModel): string[] => (vm.properties.kind === "none" ? [] : vm.properties.fields.map((f) => f.value));

describe("zone properties (spec §5.6)", () => {
  it("shows an editable name and a read-only clear area", () => {
    expect(buildViewModel(selecting(labelledDoc(), "L1"), host).properties).toEqual({
      kind: "zone",
      fields: [
        { id: "name", label: "Name", value: "Room 1", unit: null, readOnly: false },
        { id: "area", label: "Area", value: "10.64 m²", unit: null, readOnly: true },
      ],
    });
  });

  it("gives the domain's reason when the area is unavailable", () => {
    expect(values(buildViewModel(selecting(narrowRoomDoc(), "L1"), host))).toEqual(["Closet", "Area unavailable: unsupported geometry"]);
  });

  it("says when no walls enclose an orphan label", () => {
    expect(values(buildViewModel(selecting(withOrphan(labelledDoc()), "L9"), host))).toEqual(["Lost", "no enclosing walls"]);
  });

  it("follows the selected label through geometry changes", () => {
    const before = labelledDoc();
    const right = wallBetween(before, { x: 6, y: 0 }, { x: 6, y: 4 });
    const after = unwrap(execute(before, { type: "setWallLength", wallId: right, length: 3.5, keep: "a" })).doc;
    expect(values(buildViewModel(selecting(before, "L2"), host))[1]).toBe("10.64 m²");
    expect(values(buildViewModel(selecting(after, "L2"), host))[1]).toBe("9.94 m²");
  });
});

describe("renaming through setField (spec §5.6)", () => {
  it("renames the selected zone as one undoable edit", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    shell.ui({ type: "setField", fieldId: "name", value: "Kitchen" });
    expect(shell.doc().zoneLabels.L1?.name).toBe("Kitchen");
    expect(values(shell.view())).toEqual(["Kitchen", "10.64 m²"]);
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(shell.doc().zoneLabels.L1?.name).toBe("Room 1");
  });

  it("renames an orphan label selected through its tag", () => {
    const shell = FakeShell.withDocument(withOrphan(labelledDoc()));
    shell.click({ x: 8.5, y: 6.1 });
    shell.ui({ type: "setField", fieldId: "name", value: "Storage" });
    expect(shell.doc().zoneLabels.L9?.name).toBe("Storage");
  });

  it("ignores read-only fields and non-zone selections", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 6, y: 1 }); // the right wall
    shell.ui({ type: "setField", fieldId: "name", value: "X" });
    shell.click({ x: 1, y: 3 }); // the left zone
    shell.ui({ type: "setField", fieldId: "area", value: "99" });
    expect(shell.doc()).toEqual(labelledDoc());
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("refuses a name longer than 200 characters with a toast", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    shell.ui({ type: "setField", fieldId: "name", value: "x".repeat(201) });
    expect(shell.doc().zoneLabels.L1?.name).toBe("Room 1");
    expect(shell.view().toast).toBe("Name too long");
  });
});
