import { describe, expect, it } from "vitest";
import { OPENING_GROUP_LABELS, OPENING_KINDS, OPENING_KIND_IDS, type Document } from "@fm/domain";
import type { ViewModel } from "../src/view/view-model";
import { bed160x200, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

const fields = (vm: ViewModel) => ("fields" in vm.properties ? vm.properties.fields : []);
const warnings = (shell: FakeShell) => (shell.scene().layers.find((l) => l.name === "warnings")?.primitives ?? []).filter((p) => p.kind === "polygon");

// A swing door d/d0 on the bottom wall: span x 2.6–3.4, its swing square x 2.6–3.4, y 0.1–0.9. A bed turned 180°
// about (3, 0.7): x 2.2–3.8, y 0.7–2.7, its use zone above it and clear; its foot is in the swing.
const doorAndBed = (): Document => {
  const doc = roomDoc();
  return withCommands(
    doc,
    { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2.6, side: "left" },
    { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 0.7 }, rotation: 180 },
    bed160x200("bed/o0"),
  );
};

describe("opening properties (spec: openings)", () => {
  it("shows a swing door's kind, width, height, side, hinge and glazed; a sliding door calls the hinge where it parks; a window shows kind, width, sill, height and its dressing", () => {
    const shell = FakeShell.withDocument(doorAndBed());
    shell.click({ x: 3, y: 0 });
    expect(shell.view().properties.kind).toBe("opening");
    expect(fields(shell.view()).map((f) => [f.id, f.value, f.readOnly])).toEqual([
      ["kind", "swing", false],
      ["width", "0.80", false],
      ["height", "2.10", false],
      ["side", "left", false],
      ["hinge", "a", false],
      ["glazed", "false", false],
    ]);
    expect(fields(shell.view()).find((f) => f.id === "kind")?.options).toEqual(OPENING_KIND_IDS.map((k) => ({ value: k, label: OPENING_KINDS[k].label, group: OPENING_GROUP_LABELS[OPENING_KINDS[k].group] }))); // the table, held to the spec in the domain's opening-kinds.test.ts
    expect(fields(shell.view()).find((f) => f.id === "glazed")?.toggle).toBe(true);
    shell.ui({ type: "setField", fieldId: "kind", value: "sliding" });
    expect(fields(shell.view()).map((f) => f.id)).toEqual(["kind", "width", "height", "side", "hinge", "glazed"]);
    shell.ui({ type: "setField", fieldId: "kind", value: "window" });
    expect(fields(shell.view()).map((f) => f.id)).toEqual(["kind", "width", "sill", "height", "sheer", "shutterBox"]);
  });

  it("a swing door lists sections Opening, Size, Swing; Kind, Side and Hinge are choices; Glazed is a toggle", () => {
    const shell = FakeShell.withDocument(doorAndBed());
    shell.click({ x: 3, y: 0 });
    const fs = fields(shell.view());
    expect(fs.map((f) => [f.section, f.id])).toEqual([
      ["Opening", "kind"],
      ["Size", "width"],
      ["Size", "height"],
      ["Swing", "side"],
      ["Swing", "hinge"],
      ["Swing", "glazed"],
    ]);
    for (const id of ["kind", "side", "hinge"]) expect(fs.find((f) => f.id === id)?.options?.length, id).toBeGreaterThan(1);
    expect(fs.find((f) => f.id === "glazed")?.toggle).toBe(true);
    expect(fs.find((f) => f.id === "width")).toMatchObject({ step: 0.01, unit: "m" });
  });

  it("switching a swing door with a bed in its swing to sliding empties the warnings layer; switching back restores the warning with the same hinge (AC-22)", () => {
    const shell = FakeShell.withDocument(doorAndBed());
    shell.click({ x: 3, y: 0 });
    shell.ui({ type: "setField", fieldId: "hinge", value: "b" });
    expect(shell.doc().openings["d/d0"]?.hinge).toBe("b");
    expect(warnings(shell)).toHaveLength(1);
    shell.ui({ type: "setField", fieldId: "kind", value: "sliding" });
    expect(shell.doc().openings["d/d0"]?.kind).toBe("sliding");
    expect(warnings(shell)).toEqual([]);
    shell.ui({ type: "setField", fieldId: "kind", value: "swing" });
    expect(shell.doc().openings["d/d0"]).toMatchObject({ kind: "swing", hinge: "b" });
    expect(warnings(shell)).toHaveLength(1);
  });

  it("edits width, side and glazed; a width out of range or not a number toasts and changes nothing", () => {
    const shell = FakeShell.withDocument(doorAndBed());
    shell.click({ x: 3, y: 0 });
    shell.ui({ type: "setField", fieldId: "width", value: "0.9" });
    shell.ui({ type: "setField", fieldId: "side", value: "right" });
    shell.ui({ type: "setField", fieldId: "glazed", value: "true" });
    expect(shell.doc().openings["d/d0"]).toMatchObject({ width: 0.9, side: "right", glazed: true });
    shell.ui({ type: "setField", fieldId: "width", value: "2.5" });
    expect(shell.view().toast).toBe("Swing door width must be between 0.50 and 2.00 m");
    shell.ui({ type: "setField", fieldId: "width", value: "wide" });
    expect(shell.view().toast).toBe("Can't read wide");
    expect(shell.doc().openings["d/d0"]?.width).toBe(0.9);
  });
});
