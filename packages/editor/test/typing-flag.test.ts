import { describe, expect, it } from "vitest";
import { roomDoc, wallBetween } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The view model says when a typed value field is open (tidy C6, tidy.14): the web shell mounts its focus input then.

describe("the view model's typing flag (tidy C6, AC-11)", () => {
  it("is true while the Wall tool draws, false while its segment waits for the server", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.ui({ type: "pickTool", tool: "wall" });
    expect(r.shell.view().typing).toBe(false);
    r.shell.click({ x: 1, y: 1 });
    expect(r.shell.view().typing).toBe(true);
    r.shell.click({ x: 3, y: 1 });
    const t = r.shell.state.tool;
    expect(t.name === "wall" ? t.state.kind : null).toBe("paused");
    expect(r.shell.view().typing).toBe(false);
  });

  it("is true while a wall helper is edited, false for an idle Select tool", () => {
    const shell = FakeShell.withDocument(roomDoc());
    expect(shell.view().typing).toBe(false);
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.state = { ...shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "" } } };
    expect(shell.view().typing).toBe(true);
  });

  it("is true while the Scale tool's distance is typed, false before", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.state = { ...shell.state, tool: { name: "scale", state: { kind: "idle" } } };
    expect(shell.view().typing).toBe(false);
    shell.state = { ...shell.state, tool: { name: "scale", state: { kind: "typing", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, value: "" } } };
    expect(shell.view().typing).toBe(true);
  });
});
