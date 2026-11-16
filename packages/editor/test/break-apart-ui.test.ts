import { describe, expect, it } from "vitest";
import { type Command, type Document } from "@fm/domain";
import { FakeShell } from "./fake-shell";
import { roomDoc, withCommands } from "./builders";

// Properties' Break apart (AC-07, AC-10): shown for a set only, one undo step, the new pieces selected.

const place = (kind: string, at = { x: 3, y: 2.5 }): Command => ({ type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind }, at });
const set = (): Document => withCommands(roomDoc(), place("seatedRound", { x: 3, y: 3.2 }));
const selected = (doc: Document, click: { x: number; y: number }): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.click(click);
  return shell;
};

describe("Break apart in Properties", () => {
  it("is offered for a set", () => {
    expect(selected(set(), { x: 3, y: 2 }).view().properties).toMatchObject({ kind: "object", breakApart: true });
  });

  it("is offered for nothing else", () => {
    for (const kind of ["sofa", "chair", "desk", "extendingTable"]) {
      const shell = selected(withCommands(roomDoc(), place(kind)), { x: 3, y: 2.3 });
      const props = shell.view().properties;
      expect(props.kind, kind).toBe("object");
      expect(props.kind === "object" ? props.breakApart : "no", kind).toBeUndefined();
    }
  });

  it("a click leaves the pieces selected, in this layout, and one undo entry restores the set", () => {
    const doc = set();
    const shell = selected(doc, { x: 3, y: 2 });
    shell.ui({ type: "breakApart" });
    const after = shell.doc();
    expect(after.objects["x/o0"]).toBeUndefined();
    expect(Object.values(after.objects).map((o) => o.kind).sort()).toEqual(["chair", "chair", "chair", "chair", "roundTable"]);
    expect(shell.view().properties).toMatchObject({ kind: "group", count: 5 });
    expect(shell.state.selection.map((r) => r.table)).toEqual(Array.from({ length: 5 }, () => "placements"));
    expect(shell.state.selection.every((r) => r.id.includes("/p"))).toBe(true);
    shell.key("z", { ctrl: true });
    expect(shell.doc()).toEqual(doc);
    expect(Object.keys(shell.doc().objects)).toContain("x/o0");
  });

  it("a refused break shows the reason, and nothing changes", () => {
    const doc = withCommands(roomDoc(), place("sofa"));
    const shell = selected(doc, { x: 3, y: 2.3 });
    shell.ui({ type: "breakApart" });
    expect(shell.doc()).toEqual(doc);
    expect(shell.view().toast).toBe("Only a table or desk with chairs breaks apart");
  });

  it("a click with no set selected does nothing", () => {
    const doc = set();
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "breakApart" });
    expect(shell.doc()).toEqual(doc);
  });
});
