import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { areaTagLayout } from "../src/view/area-tags";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// An area's Properties (areas.07): name, width and depth editable, its m² read only and the tag's own.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const KITCHEN: Command = { type: "addArea", opId: "k", at: { x: 2, y: 2 }, w: 3, d: 2.4, name: "Kitchen" };

function selected(doc: Document = run(roomDoc(), KITCHEN)): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, selection: [{ table: "areas", id: "k/a0" }] };
  return shell;
}
const fields = (shell: FakeShell) => {
  const p = shell.view().properties;
  return p.kind === "area" ? Object.fromEntries(p.fields.map((f) => [f.id, f.value])) : {};
};

describe("an area's Properties", () => {
  it("shows its name, width, depth and the m² its tag shows", () => {
    const shell = selected();
    expect(fields(shell)).toEqual({ name: "Kitchen", width: "3.00", depth: "2.40", area: "7.20 m²" });
    expect(areaTagLayout(shell.doc(), "k/a0", shell.state.camera, "s0")?.lines[1]?.text).toBe("7.20 m²");
  });

  it("renaming and resizing send setArea; a width under 0.30 m is refused", () => {
    const shell = selected();
    shell.ui({ type: "setField", fieldId: "name", value: "Dining" });
    shell.ui({ type: "setField", fieldId: "width", value: "2.5" });
    expect(shell.doc().areas["k/a0"]).toMatchObject({ name: "Dining", w: 2.5 });
    shell.ui({ type: "setField", fieldId: "width", value: "0.2" });
    expect(shell.doc().areas["k/a0"]?.w).toBe(2.5);
  });

  it("a blank name shows as Area", () => {
    const shell = selected(run(roomDoc(), KITCHEN, { type: "setArea", areaId: "k/a0", name: "" }));
    expect(fields(shell).name).toBe("");
    expect(areaTagLayout(shell.doc(), "k/a0", shell.state.camera, "s0")?.lines[0]?.text).toBe("Area");
  });
});
