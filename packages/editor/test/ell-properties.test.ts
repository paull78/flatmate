import { describe, expect, it } from "vitest";
import { MESSAGES, type Command, type Document } from "@fm/domain";
import { objectFieldCommand } from "../src/properties/object";
import type { Field, ViewModel } from "../src/view/view-model-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// An `L` piece's arms in Properties (catalog.09, .18): Back arm and Left arm after Depth, each sending one size command
// with the current width and depths; a refused value toasts the arm rule.

const fields = (vm: ViewModel): Field[] => ("fields" in vm.properties ? vm.properties.fields : []);
const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } });
/** The 6 × 4 room with a 1.60 × 1.20 corner desk, arms 0.60, against the top wall: x 2.2–3.8, y 2.7–3.9. */
const deskDoc = (): Document => withCommands(roomDoc(), place("k", "cornerDesk", 3, 3.9));

/** `doc` with the piece at `at` selected. */
function selected(doc: Document, at: { x: number; y: number }): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(at);
  return shell;
}

describe("an L piece's arms in Properties", () => {
  it("lists Back arm and Left arm after Depth, in metres with a 0.01 step", () => {
    const shell = selected(deskDoc(), { x: 3, y: 3.7 });
    const size = fields(shell.view()).filter((f) => f.section === "Size" && f.id !== "preset").map((f) => [f.id, f.label, f.value, f.unit, f.step]);
    expect(size).toEqual([
      ["width", "Width", "1.60", "m", 0.01],
      ["depth", "Depth", "1.20", "m", 0.01],
      ["backArm", "Back arm", "0.60", "m", 0.01],
      ["leftArm", "Left arm", "0.60", "m", 0.01],
    ]);
  });

  it("typing 0.5 sends one setObjectSize with the new arm and the current sizes; abc is not a number", () => {
    const doc = deskDoc();
    expect(objectFieldCommand(doc, "k/p0", "backArm", "0.5")).toEqual({ type: "setObjectSize", objectId: "k/o0", w: 1.6, d: {}, arms: { back: 0.5, left: 0.6 } });
    expect(objectFieldCommand(doc, "k/p0", "leftArm", "0.45")).toEqual({ type: "setObjectSize", objectId: "k/o0", w: 1.6, d: {}, arms: { back: 0.6, left: 0.45 } });
    expect(objectFieldCommand(doc, "k/p0", "backArm", "abc")).toBe("notANumber");
  });

  it("a typed arm changes the piece in one undo step", () => {
    const shell = selected(deskDoc(), { x: 3, y: 3.7 });
    shell.ui({ type: "setField", fieldId: "backArm", value: "0.5" });
    expect(shell.doc().objects["k/o0"]?.arms).toEqual({ back: 0.5, left: 0.6 });
    expect(fields(shell.view()).find((f) => f.id === "backArm")?.value).toBe("0.50");
    shell.key("z", { meta: true });
    expect(shell.doc().objects["k/o0"]?.arms).toEqual({ back: 0.6, left: 0.6 });
  });

  it("a refused arm toasts the arm rule and changes nothing", () => {
    const shell = selected(deskDoc(), { x: 3, y: 3.7 });
    shell.ui({ type: "setField", fieldId: "backArm", value: "1.15" });
    expect(shell.view().toast).toBe(MESSAGES.arms);
    expect(shell.doc().objects["k/o0"]?.arms).toEqual({ back: 0.6, left: 0.6 });
  });

  it("a plain desk has no arm fields, and an arm field sends nothing for it", () => {
    const doc = withCommands(roomDoc(), place("d", "desk", 3, 3.9));
    const shell = selected(doc, { x: 3, y: 3.7 });
    expect(fields(shell.view()).map((f) => f.id)).not.toContain("backArm");
    expect(fields(shell.view()).map((f) => f.id)).not.toContain("leftArm");
    expect(objectFieldCommand(doc, "d/p0", "backArm", "0.3")).toBeNull();
  });
});
