import { describe, expect, it } from "vitest";
import { placementCentre, type Command, type Document } from "@fm/domain";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// `R` while dragging (AC-01): it turns what is being dragged 90° counter-clockwise, as it turns a ghost; the drop lands
// turned, in one undo. A group turns about its box's centre. The room's faces are x 0.1–5.9, y 0.1–3.9.

const box = (opId: string, x: number, y: number): Command => ({ type: "placeObject", opId, state: "s0", object: { kind: "block", size: { w: 1, d: 0.4 } }, at: { x, y }, rotation: 0, deck: null });
const shellWith = (...cmds: Command[]): FakeShell => FakeShell.withDocument(withCommands(roomDoc(), ...cmds));
const placement = (d: Document, op: string) => {
  const p = Object.values(d.placements).find((q) => q.object === `${op}/o0`);
  if (!p) throw new Error(`no ${op}`);
  return p;
};
const centre = (d: Document, op: string) => {
  const c = placementCentre(d, placement(d, op));
  if (!c) throw new Error("no centre");
  return c;
};

describe("a piece", () => {
  it("turns during the drag and lands turned where it's dropped, in one undo", () => {
    const shell = shellWith(box("a", 2, 2));
    const from = centre(shell.doc(), "a");
    const to = { x: 3.5, y: 2.5 };
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo({ x: from.x + 0.5, y: from.y + 0.2 });
    shell.key("r");
    shell.moveTo(to);
    shell.up(to);
    const d = shell.doc();
    expect(placement(d, "a").rotation).toBe(90);
    expect(Math.abs(centre(d, "a").x - to.x)).toBeLessThanOrEqual(0.2); // the drag's grid
    expect(Math.abs(centre(d, "a").y - to.y)).toBeLessThanOrEqual(0.2);
    shell.ui({ type: "undo" });
    expect(placement(shell.doc(), "a").rotation).toBe(0);
    expect(centre(shell.doc(), "a")).toEqual(from);
  });

  it("shows the turn at once, before the pointer moves again", () => {
    const shell = shellWith(box("a", 2, 2));
    const from = centre(shell.doc(), "a");
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo({ x: from.x + 0.5, y: from.y });
    shell.key("r");
    const t = shell.state.tool;
    if (t.name !== "select" || t.state.kind !== "moving") throw new Error("not moving");
    expect(placement(t.state.attempt.doc, "a").rotation).toBe(90);
    expect(placement(shell.doc(), "a").rotation).toBe(0); // nothing committed
  });

  it("goes all the way round with four presses", () => {
    const shell = shellWith(box("a", 2, 2));
    const from = centre(shell.doc(), "a");
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo({ x: from.x + 0.5, y: from.y });
    for (let i = 0; i < 4; i += 1) shell.key("r");
    shell.up({ x: from.x + 0.5, y: from.y });
    expect(placement(shell.doc(), "a").rotation).toBe(0);
  });

  it("a refused drop leaves it as it was", () => {
    const shell = shellWith(box("a", 2, 2), box("b", 4, 2));
    const before = placement(shell.doc(), "a");
    const from = centre(shell.doc(), "a");
    const at = centre(shell.doc(), "b");
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo({ x: from.x + 0.3, y: from.y });
    shell.key("r");
    shell.moveTo(at, { ctrl: true });
    shell.up(at, { ctrl: true });
    expect(placement(shell.doc(), "a")).toEqual(before);
  });

  it("Esc cancels the drag and the turn", () => {
    const shell = shellWith(box("a", 2, 2));
    const before = placement(shell.doc(), "a");
    const from = centre(shell.doc(), "a");
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo({ x: from.x + 0.5, y: from.y });
    shell.key("r");
    shell.key("Escape");
    expect(placement(shell.doc(), "a")).toEqual(before);
  });

  it("idle, R still turns the selected piece in place", () => {
    const shell = shellWith(box("a", 2, 2));
    const from = centre(shell.doc(), "a");
    shell.click(from);
    shell.key("r");
    expect(placement(shell.doc(), "a").rotation).toBe(90);
    expect(centre(shell.doc(), "a").x).toBeCloseTo(from.x, 6);
  });

  it("dragging a wall, R does nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const before = shell.doc();
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 3, y: 0.3 });
    shell.key("r");
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind === "moving").toBe(true);
    shell.key("Escape");
    expect(shell.doc()).toBe(before);
  });
});

describe("a group", () => {
  it("turns about its box's centre, keeping each piece's place in it, as idle R does", () => {
    const shell = shellWith(box("a", 2, 2), box("b", 3.5, 2));
    const [a, b] = [centre(shell.doc(), "a"), centre(shell.doc(), "b")];
    shell.click(a);
    shell.click(b, { shift: true });
    expect(shell.state.selection).toHaveLength(2);
    shell.moveTo(a);
    shell.down(a);
    shell.moveTo({ x: a.x + 0.2, y: a.y });
    shell.key("r");
    shell.up({ x: a.x + 0.2, y: a.y });
    const d = shell.doc();
    expect(placement(d, "a").rotation).toBe(90);
    expect(placement(d, "b").rotation).toBe(90);
    // They were side by side along x, 1.50 apart: now along y, still 1.50 apart.
    const [a2, b2] = [centre(d, "a"), centre(d, "b")];
    expect(Math.abs(b2.y - a2.y)).toBeCloseTo(1.5, 3);
    expect(Math.abs(b2.x - a2.x)).toBeCloseTo(0, 3);
  });

  it("undoes in one step", () => {
    const shell = shellWith(box("a", 2, 2), box("b", 3.5, 2));
    const before = shell.doc().placements;
    const [a, b] = [centre(shell.doc(), "a"), centre(shell.doc(), "b")];
    shell.click(a);
    shell.click(b, { shift: true });
    shell.moveTo(a);
    shell.down(a);
    shell.moveTo({ x: a.x + 0.2, y: a.y });
    shell.key("r");
    shell.up({ x: a.x + 0.2, y: a.y });
    shell.ui({ type: "undo" });
    expect(shell.doc().placements).toEqual(before);
  });
});
