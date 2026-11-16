import { describe, expect, it } from "vitest";
import { motifDefaults, type Document, type EntityRef, type Finish } from "@fm/domain";
import type { EditorState } from "../../src/state";
import { buildViewModel } from "../../src/view/view-model";
import type { Field } from "../../src/view/view-model-types";
import { labelledDoc, localState, withCommands } from "../builders";
import { FakeHost, FakeShell } from "../fake-shell";

// Compact finish rows (inherit step 04, AC-07): every finish is one summary row, a swatch and "<pattern> · <colour>"; its
// fields sit under it, tagged with its id, shown only while it is open; one open at a time; Esc closes it first.

const host = new FakeHost();
const oak = { ...motifDefaults("widePlanks"), colour: "#c8a27a" };
const fieldsOf = (state: EditorState): Field[] => {
  const p = buildViewModel(state, host).properties;
  return "fields" in p ? p.fields : [];
};
const selecting = (doc: Document, ref: EntityRef): EditorState => ({ ...localState(host, doc), selection: [ref] });
const floored = (finish: Finish | null): Document => withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish });

/** L1 selected in a fake shell with its floor finished. */
function shellWith(finish: Finish | null): FakeShell {
  const shell = FakeShell.withDocument(floored(finish));
  shell.click({ x: 1, y: 3 });
  expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  return shell;
}
const summary = (fields: readonly Field[], id: string): Field | undefined => fields.find((f) => f.id === id && f.finish !== undefined);

describe("compact finish rows (step 04, AC-07)", () => {
  it("a floor finish is one summary row, its fields tagged under it and closed", () => {
    const fields = fieldsOf(selecting(floored(oak), { table: "zoneLabels", id: "L1" }));
    const row = summary(fields, "row:floor");
    expect([row?.label, row?.value, row?.finish]).toEqual(["Floor", "Wide planks · Oak", { colour: "#c8a27a", motif: "widePlanks", open: false }]);
    const tagged = fields.filter((f) => f.inFinish === "row:floor").map((f) => f.id);
    expect(tagged).toEqual(["floor", "colour", "hex", "strength", "size", "angle"]);
    expect(fields.find((f) => f.id === "floor")?.label).toBe("Pattern");
  });

  it("None reads None, a custom colour its hex, and the summary comes first", () => {
    const none = fieldsOf(selecting(floored(null), { table: "zoneLabels", id: "L1" }));
    expect(summary(none, "row:floor")?.value).toBe("None");
    expect(none.findIndex((f) => f.id === "row:floor")).toBeLessThan(none.findIndex((f) => f.id === "floor"));
    const custom = fieldsOf(selecting(floored({ ...oak, colour: "#123456" }), { table: "zoneLabels", id: "L1" }));
    expect(summary(custom, "row:floor")?.value).toBe("Wide planks · #123456");
  });

  it("toggleFinish opens a row; another toggle opens that one instead; the same toggle closes it", () => {
    const shell = shellWith(oak);
    shell.ui({ type: "toggleFinish", id: "row:floor" });
    expect(summary(fieldsOf(shell.state), "row:floor")?.finish?.open).toBe(true);
    shell.ui({ type: "toggleFinish", id: "row:other" });
    expect(summary(fieldsOf(shell.state), "row:floor")?.finish?.open).toBe(false);
    shell.ui({ type: "toggleFinish", id: "row:floor" });
    shell.ui({ type: "toggleFinish", id: "row:floor" });
    expect(summary(fieldsOf(shell.state), "row:floor")?.finish?.open).toBe(false);
  });

  it("Esc closes an open finish before it clears the selection", () => {
    const shell = shellWith(oak);
    shell.ui({ type: "toggleFinish", id: "row:floor" });
    shell.key("Escape");
    expect(summary(fieldsOf(shell.state), "row:floor")?.finish?.open).toBe(false);
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
  });

  it("selecting something else closes the open row", () => {
    const shell = shellWith(oak);
    shell.ui({ type: "toggleFinish", id: "row:floor" });
    shell.click({ x: 4.5, y: 2 }); // L2
    shell.click({ x: 1, y: 3 }); // back to L1
    expect(summary(fieldsOf(shell.state), "row:floor")?.finish?.open).toBe(false);
  });

  it("a band's summary says how high it goes, and its Height sits under it", () => {
    const wall = Object.keys(labelledDoc().walls)[0] ?? "";
    const banded = withCommands(labelledDoc(),
      { type: "setWallSide", wallId: wall, side: "left", finish: { ...motifDefaults("plain"), colour: "#f2f0eb" }, lower: motifDefaults("subwayTiles"), height: 1.2 });
    const fields = fieldsOf(selecting(banded, { table: "walls", id: wall }));
    const band = summary(fields, "row:left.lower.motif");
    expect(band?.value).toMatch(/^Subway tiles · .+ to 1\.20 m$/);
    expect(fields.filter((f) => f.inFinish === "row:left.lower.motif").map((f) => f.id)).toContain("left.lower.height");
  });
});
