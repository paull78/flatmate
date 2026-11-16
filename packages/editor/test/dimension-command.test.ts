import { describe, expect, it } from "vitest";
import type { Command, EntityRef } from "@fm/domain";
import { entityExists } from "../src/state";
import { roomDoc, serverState } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { shared } from "./shared-builders";

// Placed dimensions through the command event: the generic commit, history and delete paths carry the new table.

const add = (a = { x: 0, y: 0 }, b = { x: 3, y: 0 }): Command => ({ type: "addDimension", opId: "m1", a, b, offset: -0.5 });
const ref: EntityRef = { table: "dimensions", id: "m1/m0" };

function sharedShell(): FakeShell {
  const host = new FakeHost();
  return new FakeShell({ ...serverState(host), document: shared() }, host);
}

describe("dimensions through the command event", () => {
  it("a command event adds a dimension; undo removes it, redo restores it (AC-02)", () => {
    const s = FakeShell.withDocument(roomDoc());
    s.send({ type: "command", command: add() });
    const row = s.doc().dimensions["m1/m0"];
    expect(row?.offset).toBe(-0.5);
    s.ui({ type: "undo" });
    expect(s.doc().dimensions).toEqual({});
    s.ui({ type: "redo" });
    expect(s.doc().dimensions["m1/m0"]).toEqual(row);
  });

  it("a shared add expects only its own row", () => {
    const s = sharedShell();
    s.send({ type: "command", command: add() });
    const submits = s.effectsOf("submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]?.changeset.expect).toEqual([{ table: "dimensions", id: "m1/m0", lastCs: null }]);
  });

  it("a too-short add toasts \"Dimension too short\" and records nothing", () => {
    const s = FakeShell.withDocument(roomDoc());
    const before = s.doc();
    s.send({ type: "command", command: add({ x: 1, y: 1 }, { x: 1.005, y: 1 }) });
    expect(s.view().toast).toBe("Dimension too short");
    expect(s.doc()).toBe(before);
    expect(s.state.undo.past).toEqual([]);
  });

  it("deleteEntities removes a dimension; entityExists follows", () => {
    const s = FakeShell.withDocument(roomDoc());
    s.send({ type: "command", command: add() });
    expect(entityExists(s.doc(), ref)).toBe(true);
    s.send({ type: "command", command: { type: "deleteEntities", ids: [ref] } });
    expect(s.doc().dimensions).toEqual({});
    expect(entityExists(s.doc(), ref)).toBe(false);
  });
});
