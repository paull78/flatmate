import { describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import { FakeRemote } from "./fake-remote";

// I15 (dims.21): a dimension anchored to a joint keeps that joint from going away under it.

describe("anchored dimensions and undo", () => {
  it("undoing a wall whose joint now anchors someone else's dimension is refused (AC-13, toast)", () => {
    const r = FakeRemote.open();
    r.shell.command({ type: "addWall", opId: "w", from: { at: { x: 0, y: 0 } }, to: { at: { x: 3, y: 0 } } });
    r.accept();
    r.remote({ type: "addDimension", opId: "bob-m", a: { x: 3, y: 0 }, b: { x: 1, y: 1 }, offset: 0 });
    expect(r.shell.doc().dimensions["bob-m/m0"]?.a).toEqual(expect.objectContaining({ tx: 0, ty: 0 })); // the joint centre
    r.shell.key("z", { meta: true });
    expect(r.shell.view().toast).toBe(MESSAGES.dimensionAnchor);
    expect(r.shell.view().toast).toBe("A dimension needs this corner");
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(1);
    expect(r.submits()).toHaveLength(1);
  });
});
