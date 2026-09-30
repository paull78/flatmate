import { describe, expect, it } from "vitest";
import * as editor from "../src/index";
import { FakeHost, FakeRemote, FakeShell, roomDoc, shared, wallBetween } from "./testing";

describe("harness entry and public API for other packages", () => {
  it("prefixes IDs so two editors in one test never collide", () => {
    const h = new FakeHost("alice-");
    expect([h.newId(), h.newId()]).toEqual(["alice-id1", "alice-id2"]);
    expect(new FakeHost().newId()).toBe("id1");
  });

  it("runs a command without a gesture, through the same path as a tool", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.command({ type: "setWallLength", wallId: right, length: 3.5, keep: "a" });
    expect(shell.view().canUndo).toBe(true);
    expect(shell.doc()).not.toEqual(roomDoc());
  });

  it("exports what the web adapter and the sync tests need", () => {
    for (const name of ["serverMessageEvent", "clientMessageFor", "sharedFromSnapshot", "hasPendingEdit", "sessionOf"] as const) {
      expect(typeof editor[name]).toBe("function");
    }
    expect(typeof FakeRemote.open).toBe("function");
    expect(shared().kind).toBe("shared");
  });
});
