import { describe, expect, it } from "vitest";
import { motifDefaults, withMotif, type Document, type EntityRef, type Finish } from "@fm/domain";
import type { EditorState } from "../src/state";
import { buildViewModel } from "../src/view/view-model";
import type { Field } from "../src/view/view-model-types";
import { labelledDoc, localState, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// The Room section's finish fields (AC-08, AC-06's note): Floor, then with a finish Colour, Hex, Strength, Size and
// Angle; a second label in a room shows where the floor is set; refusals come from the domain with the range.

const host = new FakeHost();
const selecting = (doc: Document, id: string): EditorState => ({ ...localState(host, doc), selection: [{ table: "zoneLabels", id } satisfies EntityRef] });
const fieldsOf = (doc: Document, id = "L1"): Field[] => {
  const p = buildViewModel(selecting(doc, id), host).properties;
  return "fields" in p ? p.fields.filter((f) => !f.id.startsWith("walls") && !f.finish) : []; // the Room section's fields, the summary row aside (inherit step 04)
};
const fieldOf = (doc: Document, fieldId: string, id = "L1"): Field | undefined => fieldsOf(doc, id).find((f) => f.id === fieldId);
const finished = (finish: Finish | null, doc = labelledDoc()): Document => withCommands(doc, { type: "setFinish", id: "L1", finish });
const optionLabel = (f: Field | undefined): string | undefined => f?.options?.find((o) => o.value === f.value)?.label;

/** The left room (L1) selected, its finish `finish`. */
function selected(finish: Finish | null): FakeShell {
  const shell = FakeShell.withDocument(finished(finish));
  shell.click({ x: 1, y: 3 });
  expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  return shell;
}
const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });
const finishOf = (shell: FakeShell): Finish | null | undefined => shell.doc().zoneLabels.L1?.finish;

describe("the Room section's finish fields (AC-08)", () => {
  it("a label without finish shows Floor None and no other finish field", () => {
    const fields = fieldsOf(labelledDoc());
    expect(fields.map((f) => f.id)).toEqual(["name", "area", "floor"]);
    const floor = fieldOf(labelledDoc(), "floor");
    expect([floor?.label, floor?.value, floor?.readOnly, floor?.select, optionLabel(floor)]).toEqual(["Pattern", "none", false, true, "None"]);
    expect(floor?.options?.map((o) => o.label)).toEqual(["None", "Planks", "Wide planks", "Herringbone", "Square tiles", "Large tiles", "Mosaic", "Cement tiles", "Plain"]);
  });

  it('with planks shows Colour "Oak", Custom "#c8a27a" (a colour field: a picker by the hex), Strength 45, Size "0.200", Angle 0', () => {
    const doc = finished(motifDefaults("planks"));
    const shown = fieldsOf(doc).filter((f) => f.section === "Room").slice(2).map((f) => [f.id, f.label, f.value, f.unit, f.readOnly, f.step]);
    expect(shown).toEqual([
      ["floor", "Pattern", "planks", null, false, undefined],
      ["colour", "Colour", "#c8a27a", null, false, undefined],
      ["hex", "Custom", "#c8a27a", null, false, undefined],
      ["strength", "Strength", "45", "%", false, 1],
      ["size", "Size", "0.200", "m", false, 0.005],
      ["angle", "Angle", "0", "°", false, 1],
    ]);
    expect(fieldOf(doc, "hex")?.colour).toBe(true);
    expect(fieldOf(doc, "colour")?.colour).toBeUndefined(); // the named swatches stay a choice
    expect(optionLabel(fieldOf(doc, "floor"))).toBe("Planks");
    expect(optionLabel(fieldOf(doc, "colour"))).toBe("Oak");
    expect(fieldOf(doc, "colour")?.options?.map((o) => o.label)).toEqual([
      "Oak", "Light oak", "Walnut", "Grey oak", "Warm white", "Stone grey", "Concrete", "Anthracite", "Terracotta", "Sage", "Pale blue", "Sand",
    ]);
  });

  it('a custom colour shows "Custom #123456"', () => {
    const colour = fieldOf(finished({ ...motifDefaults("planks"), colour: "#123456" }), "colour");
    expect(optionLabel(colour)).toBe("Custom #123456");
    expect(colour?.options).toHaveLength(13);
  });

  it("plain shows Colour and Hex only: it has no lines, so strength, size and angle mean nothing", () => {
    expect(fieldsOf(finished(motifDefaults("plain"))).map((f) => f.id)).toEqual(["name", "area", "floor", "colour", "hex"]);
  });

  it("Floor → herringbone from planks at 0 keeps the colour, gives angle 45 and herringbone's size and strength (finishes.37)", () => {
    const shell = selected({ ...motifDefaults("planks"), colour: "#7a5236" });
    set(shell, "floor", "herringbone");
    expect(finishOf(shell)).toEqual({ motif: "herringbone", colour: "#7a5236", strength: 50, size: 0.09, angle: 45 });
  });

  it("Floor → planks from none gives the motif's defaults", () => {
    const shell = selected(null);
    set(shell, "floor", "planks");
    expect(finishOf(shell)).toEqual(motifDefaults("planks"));
  });

  it("Floor → the same motif changes nothing: no reset of size and strength, nothing to undo", () => {
    const shell = selected({ ...motifDefaults("planks"), size: 0.25, strength: 80 });
    set(shell, "floor", "planks");
    expect(finishOf(shell)).toEqual({ ...motifDefaults("planks"), size: 0.25, strength: 80 });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("Floor → None sends setFinish null", () => {
    const shell = selected(motifDefaults("planks"));
    set(shell, "floor", "none");
    expect(finishOf(shell)).toBeNull();
  });

  it('Colour "Walnut" sends #7a5236', () => {
    const shell = selected(motifDefaults("planks"));
    const walnut = fieldOf(shell.doc(), "colour")?.options?.find((o) => o.label === "Walnut");
    expect(walnut?.value).toBe("#7a5236");
    set(shell, "colour", walnut?.value ?? "");
    expect(finishOf(shell)).toEqual({ ...motifDefaults("planks"), colour: "#7a5236" });
  });

  it('Hex "#C8A27A" is stored as "#c8a27a" and reads back so', () => {
    const shell = selected({ ...motifDefaults("planks"), colour: "#123456" });
    set(shell, "hex", "#C8A27A");
    expect(finishOf(shell)?.colour).toBe("#c8a27a");
    expect(fieldOf(shell.doc(), "hex")?.value).toBe("#c8a27a");
  });

  it('Hex "c8a27a" without "#" is stored as "#c8a27a" (finishes.48)', () => {
    const shell = selected({ ...motifDefaults("planks"), colour: "#123456" });
    set(shell, "hex", "c8a27a");
    expect(finishOf(shell)?.colour).toBe("#c8a27a");
    expect(fieldOf(shell.doc(), "hex")?.value).toBe("#c8a27a");
  });

  it("Strength, Size and Angle send their numbers", () => {
    const shell = selected(motifDefaults("planks"));
    set(shell, "strength", "60");
    set(shell, "size", "0.25");
    set(shell, "angle", "90");
    expect(finishOf(shell)).toEqual({ ...motifDefaults("planks"), strength: 60, size: 0.25, angle: 90 });
  });

  it.each([
    ["size", "0.9", "Size must be 0.10–0.40"], // plain words: the field's name, not the domain's path (finishes.48)
    ["hex", "oak", "Colour must be #rrggbb"],
    ["hex", "c8a27", "Colour must be #rrggbb"],
    ["strength", "101", "Strength must be a whole percent 0–100"],
    ["angle", "180", "Angle must be whole degrees 0–179"],
    ["size", "0.2005", "Size must be whole millimetres"],
    ["size", "abc", "Can't read abc"],
    ["strength", "", "Enter a number"],
  ])("%s %j is refused with a toast %j and the finish is unchanged", (fieldId, value, toast) => {
    const shell = selected(motifDefaults("planks"));
    set(shell, fieldId, value);
    expect(shell.view().toast).toBe(toast);
    expect(finishOf(shell)).toEqual(motifDefaults("planks"));
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it('a mosaic\'s size reads back "0.025", and a typed 0.205 on planks reads back "0.205"', () => {
    expect(fieldOf(finished(motifDefaults("mosaic")), "size")?.value).toBe("0.025");
    const shell = selected(motifDefaults("planks"));
    set(shell, "size", "0.205");
    expect(finishOf(shell)?.size).toBe(0.205);
    expect(fieldOf(shell.doc(), "size")?.value).toBe("0.205");
  });

  it('a mosaic refuses a size out of range with three decimals: "Size must be 0.020–0.050"', () => {
    const shell = selected(motifDefaults("mosaic"));
    set(shell, "size", "0.06");
    expect(shell.view().toast).toBe("Size must be 0.020–0.050");
  });

  it('a second label in the room shows Floor "Set on Kitchen", read-only, and no other finish field', () => {
    const base = withCommands(finished(motifDefaults("planks")), { type: "renameZone", id: "L1", name: "Kitchen" });
    const doc: Document = { ...base, zoneLabels: { ...base.zoneLabels, L3: { id: "L3", at: { x: 1, y: 1 }, name: "Pantry", finish: null } } };
    const fields = fieldsOf(doc, "L3");
    expect(fields.map((f) => f.id)).toEqual(["name", "area", "floor"]);
    const floor = fieldOf(doc, "floor", "L3");
    expect([floor?.value, floor?.readOnly]).toEqual(["Set on Kitchen", true]);
  });

  it("a too-fine room shows the note; a coarse one doesn't (AC-06)", () => {
    const fine = finished({ ...motifDefaults("mosaic"), size: 0.02 }); // 2.8 × 3.8 m at 0.02: over 20,000 cells
    const note = fieldOf(fine, "finishNote");
    expect([note?.value, note?.check, note?.readOnly]).toEqual(["Pattern too fine for this room", "warning", true]);
    expect(fieldOf(finished(motifDefaults("planks")), "finishNote")).toBeUndefined();
  });

  it("withMotif is what Floor sends, for every motif from planks at 90", () => {
    for (const motif of ["widePlanks", "herringbone", "squareTiles", "largeTiles", "mosaic", "cementTiles", "plain"] as const) {
      const shell = selected({ ...motifDefaults("planks"), angle: 90 });
      set(shell, "floor", motif);
      expect(finishOf(shell), motif).toEqual(withMotif({ ...motifDefaults("planks"), angle: 90 }, motif));
    }
  });
});

describe("Properties scenario: tune a finished room's size (AC-08)", () => {
  it("select a finished room, change Size, undo restores it", () => {
    const shell = selected(motifDefaults("planks"));
    expect(fieldOf(shell.doc(), "size")?.value).toBe("0.200");
    set(shell, "size", "0.3");
    expect(finishOf(shell)?.size).toBe(0.3);
    const vm = shell.view();
    expect("fields" in vm.properties ? vm.properties.fields.find((f) => f.id === "size")?.value : null).toBe("0.300");
    shell.key("z", { meta: true });
    expect(finishOf(shell)).toEqual(motifDefaults("planks"));
    shell.key("z", { meta: true, shift: true });
    expect(finishOf(shell)?.size).toBe(0.3);
  });
});
