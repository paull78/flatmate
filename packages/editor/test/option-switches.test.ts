import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, type Command, type Document } from "@fm/domain";
import { objectFields } from "../src/properties/object";
import type { ViewModel } from "../src/view/view-model";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Object options in Properties (library.10, AC-05): one switch per option the kind lists, right under Name, in the
// kinds column's order, its field id the option's name; toggling sends `setOption`, one undo step. roomDoc: a 6 × 4
// room; each piece stands alone, its back edge's middle at (3, 2.5).

const fields = (vm: ViewModel) => ("fields" in vm.properties ? vm.properties.fields : []);
// The 3.07 m winder stair stands with its back at y 3.8, so it fits the room (steps.04).
const place = (kind: string): Command => ({ type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind }, at: { x: 3, y: kind === "winderStair" ? 3.8 : 2.5 } });
const alone = (kind: string): Document => withCommands(roomDoc(), place(kind));

/** The Object section's switches of x/p0: [field id, label, value]. */
function switches(doc: Document): [string, string, string][] {
  const props = objectFields(doc, "x/p0");
  if (props.kind !== "object") throw new Error("x/p0 is an object");
  return props.fields.filter((f) => f.section === "Object" && f.toggle === true).map((f) => [f.id, f.label, f.value]);
}

/** The Object section's fields of x/p0 whose id is an option, switch or segmented. */
function optionFields(doc: Document): string[] {
  const props = objectFields(doc, "x/p0");
  if (props.kind !== "object") throw new Error("x/p0 is an object");
  return props.fields.filter((f) => f.section === "Object" && (f.toggle === true || f.id === "leftEntry")).map((f) => f.id);
}

describe("a winder's entry side in Properties (steps.33)", () => {
  it("is a segmented control under Name, Enters from: Right | Left, not a switch, its values the option's", () => {
    const props = objectFields(alone("winderStair"), "x/p0");
    const ids = props.kind === "object" ? props.fields.map((f) => f.id) : [];
    expect(ids[ids.indexOf("name") + 1]).toBe("leftEntry");
    const entry = props.kind === "object" ? props.fields.find((f) => f.id === "leftEntry") : undefined;
    expect(entry?.label).toBe("Enters from");
    expect(entry?.toggle).toBeUndefined();
    expect(entry?.select).toBeUndefined();
    expect(entry?.options).toEqual([{ value: "false", label: "Right" }, { value: "true", label: "Left" }]);
    expect(entry?.value).toBe("false");
  });

  it("picking Left sends setOption leftEntry on, and the control then shows Left; a rung ladder's Hooks stays a switch", () => {
    const shell = FakeShell.withDocument(alone("winderStair"));
    shell.click({ x: 3, y: 3 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "x/p0" }]);
    shell.ui({ type: "setField", fieldId: "leftEntry", value: "true" });
    expect(shell.doc().objects["x/o0"]?.options).toEqual({ leftEntry: true });
    expect(fields(shell.view()).find((f) => f.id === "leftEntry")?.value).toBe("true");
    expect(switches(alone("rungLadder"))).toEqual([["hooks", "Hooks", "false"]]);
  });
});

describe("option switches in Properties (library.10, AC-05)", () => {
  it("Properties shows a computer switch on a desk, both switches on a desk with chair, round chairs on the table sets and a loose chair, none elsewhere", () => {
    expect(switches(alone("desk"))).toEqual([["computer", "With computer", "false"]]);
    expect(switches(alone("deskSet"))).toEqual([["computer", "With computer", "false"], ["roundChairs", "Round chairs", "false"]]);
    expect(switches(alone("seatedDining"))).toEqual([["roundChairs", "Round chairs", "false"]]);
    expect(switches(alone("seatedRound"))).toEqual([["roundChairs", "Round chairs", "false"]]);
    expect(switches(alone("chair"))).toEqual([["roundChairs", "Round chairs", "false"]]);
    expect(switches(alone("winderStair"))).toEqual([]); // a side, not an on/off: the segmented control below (steps.33)
    for (const kind of ["roundTable", "extendingTable", "sofa", "builtInDesk"]) expect(switches(alone(kind)), kind).toEqual([]);
    // Every kind offers exactly the options its column lists.
    const offered = OBJECT_KINDS.filter((k) => k.options.length > 0).map((k) => [k.id, optionFields(alone(k.id))]);
    expect(offered).toEqual(OBJECT_KINDS.filter((k) => k.options.length > 0).map((k) => [k.id, [...k.options]]));
  });

  it("the switches sit right under Name and show what is on", () => {
    const doc = withCommands(alone("deskSet"), { type: "setOption", objectId: "x/o0", option: "roundChairs", on: true });
    const props = objectFields(doc, "x/p0");
    const ids = props.kind === "object" ? props.fields.map((f) => f.id) : [];
    expect(ids.slice(ids.indexOf("name") + 1, ids.indexOf("name") + 3)).toEqual(["computer", "roundChairs"]);
    expect(switches(doc)).toEqual([["computer", "With computer", "false"], ["roundChairs", "Round chairs", "true"]]);
  });

  it("toggling round chairs sends setOption as one undo step, beside the computer, and undo restores it", () => {
    const shell = FakeShell.withDocument(alone("deskSet")); // y 1.8–2.5: the desk part at the back
    shell.click({ x: 3, y: 2.3 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "x/p0" }]);
    shell.ui({ type: "setField", fieldId: "computer", value: "true" });
    shell.ui({ type: "setField", fieldId: "roundChairs", value: "true" });
    expect(shell.doc().objects["x/o0"]?.options).toEqual({ computer: true, roundChairs: true });
    expect(shell.state.undo.past).toHaveLength(2);
    shell.ui({ type: "setField", fieldId: "roundChairs", value: "false" });
    expect(shell.doc().objects["x/o0"]?.options).toEqual({ computer: true });
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["x/o0"]?.options).toEqual({ computer: true, roundChairs: true });
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["x/o0"]?.options).toEqual({ computer: true });
    expect(fields(shell.view()).find((f) => f.id === "roundChairs")?.value).toBe("false");
  });

  it("round chairs on a table set; a value other than true or false sends nothing", () => {
    const shell = FakeShell.withDocument(alone("seatedDining")); // y 1.5–2.5
    shell.click({ x: 3, y: 2 });
    shell.ui({ type: "setField", fieldId: "roundChairs", value: "yes" });
    expect(shell.state.undo.past).toHaveLength(0);
    shell.ui({ type: "setField", fieldId: "roundChairs", value: "true" });
    expect(shell.doc().objects["x/o0"]?.options).toEqual({ roundChairs: true });
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["x/o0"]?.options).toBeUndefined();
  });
});
