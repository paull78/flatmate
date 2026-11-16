import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { ViewModel } from "../src/view/view-model";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// "With computer" in Properties (AC-09, seating.12): a switch in the Object section for the desk and the desk with
// chair only, one undo step through `setOption`, shared with the other client. roomDoc: a 6 × 4 room.
//
//   3.9 ┌──[desk]──[built-in desk]────┐
//       │                    ▣ chair   │
//   1.2 │ [desk with chair]            │
//   0.1 └──────────────────────────────┘

const fields = (vm: ViewModel) => ("fields" in vm.properties ? vm.properties.fields : []);
const computerField = (shell: FakeShell) => fields(shell.view()).find((f) => f.id === "computer");
const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } });

/** desk/o0 at x 1.4–2.6, y 3.3–3.9; unit/o0 (folded) at x 3.3–5.7 against the top wall; chair/o0 at x 4.775–5.225, y 1.55–2; set/o0 at x 1.4–2.6, y 0.5–1.2. */
const furnished = (): Document =>
  withCommands(roomDoc(), place("desk", "desk", 2, 3.9), place("unit", "builtInDesk", 4.5, 3.9), place("chair", "chair", 5, 2), place("set", "deskSet", 2, 1.2));

describe("the computer switch in Properties (AC-09, seating.12)", () => {
  it("Properties shows the switch for desk and desk set only", () => {
    const shell = FakeShell.withDocument(furnished());
    shell.click({ x: 2, y: 3.6 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "desk/p0" }]);
    expect(computerField(shell)).toMatchObject({ section: "Object", label: "With computer", value: "false", toggle: true, readOnly: false });
    const ids = fields(shell.view()).map((f) => f.id);
    expect(ids.indexOf("computer")).toBe(ids.indexOf("name") + 1); // right under the name
    shell.click({ x: 2, y: 1.05 }); // the set's desk part
    expect(shell.state.selection).toEqual([{ table: "placements", id: "set/p0" }]);
    expect(computerField(shell)?.toggle).toBe(true);
    for (const at of [{ x: 4.5, y: 3.8 }, { x: 5, y: 1.7 }]) {
      shell.click(at);
      expect(shell.state.selection).toHaveLength(1);
      expect(computerField(shell), JSON.stringify(at)).toBeUndefined(); // the built-in desk and the chair
    }
  });

  it("toggling issues setOption as one undo step, and undo restores it", () => {
    const shell = FakeShell.withDocument(furnished());
    shell.click({ x: 2, y: 3.6 });
    shell.ui({ type: "setField", fieldId: "computer", value: "true" });
    expect(shell.doc().objects["desk/o0"]?.options).toEqual({ computer: true });
    expect(computerField(shell)?.value).toBe("true");
    expect(shell.state.undo.past).toHaveLength(1);
    shell.ui({ type: "setField", fieldId: "computer", value: "false" });
    expect(Object.hasOwn(shell.doc().objects["desk/o0"] ?? {}, "options")).toBe(false); // off is no key (seating.39, library.10)
    expect(shell.state.undo.past).toHaveLength(2);
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["desk/o0"]?.options).toEqual({ computer: true });
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["desk/o0"]?.options).toBeUndefined();
    expect(computerField(shell)?.value).toBe("false");
  });

  it("a value other than true or false sends nothing", () => {
    const shell = FakeShell.withDocument(furnished());
    shell.click({ x: 2, y: 3.6 });
    shell.ui({ type: "setField", fieldId: "computer", value: "yes" });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("shared: the switch submits one patch, and the other client's switch shows here", () => {
    const r = FakeRemote.open(furnished());
    r.shell.click({ x: 2, y: 3.6 });
    r.shell.ui({ type: "setField", fieldId: "computer", value: "true" });
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.doc.objects["desk/o0"]?.options).toEqual({ computer: true }); // the server's copy, which the other client loads
    r.remote({ type: "setOption", objectId: "desk/o0", option: "computer", on: false }); // Bob turns it off
    expect(r.shell.doc().objects["desk/o0"]?.options).toBeUndefined();
    expect(computerField(r.shell)?.value).toBe("false");
    r.remote({ type: "setOption", objectId: "set/o0", option: "computer", on: true });
    expect(r.shell.doc().objects["set/o0"]?.options).toEqual({ computer: true });
  });
});
