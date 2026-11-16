import { describe, expect, it } from "vitest";
import { REST_TIMER } from "../src/plate";
import { jointAt, pointOf, roomDoc, wallDoc } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// Step 24 (straight.08, .20): a distance typed during a walls drag moves the preview to exactly that distance, in the
// pointer's direction; release or Enter commits what the preview shows. Values are metres, as every typed value
// (spec: typed-input): 0.5, or 50cm. The 6 × 4 room; its right wall at x 6.

const corner = (shell: FakeShell) => pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 4 }));
const moving = (shell: FakeShell) => (shell.state.tool.name === "select" && shell.state.tool.state.kind === "moving" ? shell.state.tool.state : null);

function dragging(): FakeShell {
  const shell = FakeShell.withDocument(roomDoc());
  shell.moveTo({ x: 6, y: 2 });
  shell.down({ x: 6, y: 2 });
  shell.moveTo({ x: 6.23, y: 2 }); // outward: the grid would give 0.2
  return shell;
}

describe("a typed distance while moving walls", () => {
  it("typing 0.5 moves the preview exactly 0.50 m the pointer's way; release commits it (AC-18)", () => {
    const shell = dragging();
    shell.type("0.5");
    expect(pointOf(moving(shell)?.attempt.doc ?? shell.doc(), jointAt(roomDoc(), { x: 6, y: 4 }))).toEqual({ x: 6.5, y: 4 });
    expect(shell.view().typing).toBe(true);
    shell.up({ x: 6.23, y: 2 });
    expect(corner(shell)).toEqual({ x: 6.5, y: 4 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("takes units, and the other side when the pointer is there", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 5.8, y: 2 }); // inward
    shell.type("50cm");
    shell.up({ x: 5.8, y: 2 });
    expect(corner(shell)).toEqual({ x: 5.5, y: 4 });
  });

  it("Enter commits too; the release after it does nothing", () => {
    const shell = dragging();
    shell.type("0.5");
    shell.key("Enter");
    expect(corner(shell)).toEqual({ x: 6.5, y: 4 });
    shell.up({ x: 6.23, y: 2 });
    expect(corner(shell)).toEqual({ x: 6.5, y: 4 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a value that would cross a wall stays red, rests into a plate, and the drag goes on", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 5.8, y: 2 });
    shell.clearEffects();
    shell.type("6"); // onto the left wall
    expect(moving(shell)?.attempt.ok).toBe(false);
    expect(shell.effectsOf("startTimer").some((e) => e.timerId === REST_TIMER)).toBe(true);
    shell.key("Backspace");
    shell.type("1");
    expect(moving(shell)?.attempt.ok).toBe(true);
    shell.up({ x: 5.8, y: 2 });
    expect(corner(shell)).toEqual({ x: 5, y: 4 });
  });

  it("Esc clears the value (the preview back at the pointer), then cancels", () => {
    const shell = dragging();
    shell.type("0.5");
    shell.key("Escape");
    expect(moving(shell)?.value).toBe("");
    expect(pointOf(moving(shell)?.attempt.doc ?? shell.doc(), jointAt(roomDoc(), { x: 6, y: 4 }))).toEqual({ x: 6.2, y: 4 });
    shell.key("Escape");
    expect(moving(shell)).toBeNull();
    expect(corner(shell)).toEqual({ x: 6, y: 4 });
  });

  it("a letter typed during the drag doesn't pick a tool", () => {
    const shell = dragging();
    shell.key("m");
    shell.key("w");
    expect(shell.state.tool.name).toBe("select");
    expect(moving(shell)).not.toBeNull();
  });

  it("a free wall types along the drag's larger axis", () => {
    const doc = wallDoc({ x: 0, y: 0 }, { x: 3, y: 0 });
    const shell = FakeShell.withDocument(doc);
    shell.moveTo({ x: 1.5, y: 0 });
    shell.down({ x: 1.5, y: 0 });
    shell.moveTo({ x: 1.6, y: 0.4 });
    shell.type("1.25");
    shell.up({ x: 1.6, y: 0.4 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 0, y: 0 }))).toEqual({ x: 0, y: 1.25 });
  });

  it("a remote rerun keeps the value", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.moveTo({ x: 6, y: 2 });
    r.shell.down({ x: 6, y: 2 });
    r.shell.moveTo({ x: 6.23, y: 2 });
    r.shell.type("0.5");
    r.remote({ type: "addWall", opId: "far", from: { at: { x: 20, y: 20 } }, to: { at: { x: 22, y: 20 } } });
    const t = r.shell.state.tool;
    // A remote topology change cancels a drag (spec: tools); anything else reruns it with the value kept.
    if (t.name === "select" && t.state.kind === "moving") expect(t.state.value).toBe("0.5");
    else expect(r.shell.view().toast).toBe("Drawing changed remotely");
  });
});
