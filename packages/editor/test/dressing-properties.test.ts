import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import type { ViewModel } from "../src/view/view-model";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A window's Dressing in Properties (hangings step 04, AC-05): Sheer curtain (None | Sill | Floor: its length) and a Shutter
// box switch, on a window kind only; each change is one undo step.

const fields = (vm: ViewModel) => ("fields" in vm.properties ? vm.properties.fields : []);
const windowAt = (kind: "window" | "swing"): Document => {
  const doc = roomDoc();
  return withCommands(doc, { type: "addOpening", opId: "w", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind, offset: 2.5, width: 1 });
};

describe("a window's Dressing in Properties (step 04)", () => {
  it("shows a Dressing section: the sheer a choice, the box a switch", () => {
    const shell = FakeShell.withDocument(windowAt("window"));
    shell.click({ x: 3, y: 0 });
    const dressing = fields(shell.view()).filter((f) => f.section === "Dressing");
    expect(dressing.map((f) => [f.id, f.label, f.value])).toEqual([["sheer", "Sheer curtain", "none"], ["shutterBox", "Shutter box", "false"]]);
    expect(dressing[0]?.options?.map((o) => o.label)).toEqual(["None", "Sill", "Floor"]);
    expect(dressing[1]?.toggle).toBe(true);
  });

  it("each change is one undo step", () => {
    const shell = FakeShell.withDocument(windowAt("window"));
    shell.click({ x: 3, y: 0 });
    shell.ui({ type: "setField", fieldId: "sheer", value: "floor" });
    shell.ui({ type: "setField", fieldId: "shutterBox", value: "true" });
    expect(shell.doc().openings["w/d0"]).toMatchObject({ sheer: "floor", shutterBox: true });
    shell.ui({ type: "undo" });
    expect(shell.doc().openings["w/d0"]?.shutterBox).toBeUndefined();
    expect(shell.doc().openings["w/d0"]?.sheer).toBe("floor");
    shell.ui({ type: "undo" });
    expect(shell.doc().openings["w/d0"]?.sheer).toBeUndefined();
  });

  it("a door shows no Dressing", () => {
    const shell = FakeShell.withDocument(windowAt("swing"));
    shell.click({ x: 3, y: 0 });
    expect(fields(shell.view()).filter((f) => f.section === "Dressing")).toEqual([]);
  });
});
