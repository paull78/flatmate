import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The count blinks when the viewer's own committed edit raises it, and at no other time (clarity.02). Each test reads the
// count too, so a "no tick" can't pass because nothing happened.

const place = (opId: string, kind: string, at: Point, state = "s0"): Command => ({ type: "placeObject", linked: false, deck: null, opId, state, object: { kind }, at, rotation: 0 });

const IN_ZONE: Point = { x: 3, y: 3.2 }; // the desk's front zone is x 2.65–3.35, y 2.5–3.3
const IN_LEFT_ZONE: Point = { x: 1, y: 3.2 }; // the left desk's is x 0.65–1.35, y 2.5–3.3
const CLEAR: Point = { x: 5, y: 1 };
/** A block's middle, to press and to drop: its `at` is the middle of its back edge, and it's 0.6 deep. */
const on = (at: Point): Point => ({ x: at.x, y: at.y - 0.3 });

const desk = (): Document => withCommands(roomDoc(), place("desk", "desk", { x: 3, y: 3.9 }));
const twoDesks = (): Document => withCommands(desk(), place("left", "desk", { x: 1, y: 3.9 }));
const blocked = (): Document => withCommands(desk(), place("b", "block", IN_ZONE));
const LOFT = "loft/k0";
/** A loft on the left, and the blocked desk on the right: one warning at the floor, none at the loft. */
const lofted = (): Document => withCommands(blocked(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 0.9, y: 2 }, w: 1.6, d: 1 });
/** Layouts s0, with an unblocked desk, and a copy of it with the desk blocked: 0 and 1 warnings. */
function twoLayouts(): { doc: Document; other: string } {
  const copied = withCommands(desk(), { type: "copyState", opId: "n", from: "s0", name: "Night" });
  const other = Object.keys(copied.states).find((id) => id !== "s0") ?? "";
  return { doc: withCommands(copied, place("b", "block", IN_ZONE, other)), other };
}

const count = (shell: FakeShell): number => shell.view().warnings.rows.length;
const blink = (shell: FakeShell): number => shell.view().warnings.blink;

describe("the blink", () => {
  it("a placed piece blocking a zone ticks once", () => {
    const shell = FakeShell.withDocument(desk());
    expect([count(shell), blink(shell)]).toEqual([0, 0]);
    shell.ui({ type: "pickKind", kind: "block" });
    shell.click(on(IN_ZONE));
    expect([count(shell), blink(shell)]).toEqual([1, 1]);
  });

  it("a piece moved into a zone ticks once on release", () => {
    const shell = FakeShell.withDocument(withCommands(desk(), place("b", "block", CLEAR)));
    shell.drag(on(CLEAR), on(IN_ZONE));
    expect([count(shell), blink(shell)]).toEqual([1, 1]);
  });

  it("each raising edit ticks again", () => {
    const shell = FakeShell.withDocument(twoDesks());
    shell.command(place("a", "block", IN_ZONE));
    shell.command(place("c", "block", IN_LEFT_ZONE));
    expect([count(shell), blink(shell)]).toEqual([2, 2]);
  });

  it("an edit that doesn't raise the count doesn't tick: lowering it", () => {
    const shell = FakeShell.withDocument(blocked());
    shell.drag(on(IN_ZONE), on(CLEAR));
    expect([count(shell), blink(shell)]).toEqual([0, 0]);
  });

  it("an edit that doesn't raise the count doesn't tick: swapping one warning for another", () => {
    const shell = FakeShell.withDocument(withCommands(twoDesks(), place("b", "block", IN_ZONE)));
    const before = shell.view().warnings.rows.map((r) => r.key);
    shell.drag(on(IN_ZONE), on(IN_LEFT_ZONE));
    expect(count(shell)).toBe(1);
    expect(shell.view().warnings.rows.map((r) => r.key)).not.toEqual(before);
    expect(blink(shell)).toBe(0);
  });

  it("an edit that doesn't raise the count doesn't tick: one with no warnings at all", () => {
    const shell = FakeShell.withDocument(desk());
    shell.command(place("b", "block", CLEAR));
    expect([count(shell), blink(shell)]).toEqual([0, 0]);
  });

  it("undo and redo don't tick, though redo raises the count", () => {
    const shell = FakeShell.withDocument(desk());
    shell.command(place("b", "block", IN_ZONE));
    expect([count(shell), blink(shell)]).toEqual([1, 1]);
    shell.ui({ type: "undo" });
    expect([count(shell), blink(shell)]).toEqual([0, 1]);
    shell.ui({ type: "redo" });
    expect([count(shell), blink(shell)]).toEqual([1, 1]);
  });

  it("undoing a move that lowered the count doesn't tick", () => {
    const shell = FakeShell.withDocument(blocked());
    shell.drag(on(IN_ZONE), on(CLEAR));
    expect(count(shell)).toBe(0);
    shell.key("z", { meta: true });
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
  });

  it("a collaborator's edit doesn't tick", () => {
    const r = FakeRemote.open(desk());
    r.remote(place("b", "block", IN_ZONE));
    expect([count(r.shell), blink(r.shell)]).toEqual([1, 0]);
  });

  it("an own edit on a shared drawing ticks once: its echo and acknowledgement add nothing", () => {
    const r = FakeRemote.open(desk());
    r.shell.command(place("b", "block", IN_ZONE));
    expect([count(r.shell), blink(r.shell)]).toEqual([1, 1]); // in flight already: the count includes the edit
    r.accept();
    expect([count(r.shell), blink(r.shell)]).toEqual([1, 1]);
  });

  it("changing layout doesn't tick, even to one with more warnings", () => {
    const { doc, other } = twoLayouts();
    const shell = FakeShell.withDocument(doc);
    expect(count(shell)).toBe(0);
    shell.ui({ type: "setActiveState", id: other });
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
  });

  it("changing level doesn't tick, even to one with more warnings", () => {
    const shell = FakeShell.withDocument(lofted());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(count(shell)).toBe(0);
    shell.ui({ type: "setViewedLevel", deck: null });
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
  });

  it("deleting the loft in view doesn't tick: the view falls to the floor, which has more warnings", () => {
    const shell = FakeShell.withDocument(lofted());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(count(shell)).toBe(0);
    shell.command({ type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
  });

  it("an edit in a layout not in view doesn't tick", () => {
    const { doc, other } = twoLayouts();
    const shell = FakeShell.withDocument(doc);
    shell.command(place("more", "block", IN_LEFT_ZONE, other));
    shell.command(place("left", "desk", { x: 1, y: 3.9 }, other));
    expect([count(shell), blink(shell)]).toEqual([0, 0]);
  });

  it("adding a layout doesn't tick", () => {
    const shell = FakeShell.withDocument(blocked());
    shell.ui({ type: "addState" });
    expect(shell.view().states).toHaveLength(2);
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
  });

  it("deleting a layout doesn't tick, even when the view falls to one with more warnings", () => {
    const { doc, other } = twoLayouts();
    const shell = FakeShell.withDocument(doc);
    expect(count(shell)).toBe(0);
    shell.ui({ type: "deleteState", id: "s0" });
    expect(shell.view().states.map((s) => s.id)).toEqual([other]);
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
  });

  it("a drag in progress doesn't tick, though the count already shows the zone blocked", () => {
    const shell = FakeShell.withDocument(withCommands(desk(), place("b", "block", CLEAR)));
    shell.moveTo(on(CLEAR));
    shell.down(on(CLEAR));
    shell.moveTo({ x: 4, y: 2 });
    shell.moveTo(on(IN_ZONE));
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
    shell.moveTo({ x: 3.05, y: 2.95 });
    expect([count(shell), blink(shell)]).toEqual([1, 0]);
    shell.up({ x: 3.05, y: 2.95 });
    expect([count(shell), blink(shell)]).toEqual([1, 1]);
  });

  it("a drag that goes through a zone and comes back doesn't tick", () => {
    const shell = FakeShell.withDocument(withCommands(desk(), place("b", "block", CLEAR)));
    shell.moveTo(on(CLEAR));
    shell.down(on(CLEAR));
    shell.moveTo(on(IN_ZONE));
    expect(count(shell)).toBe(1);
    shell.moveTo({ x: 5, y: 1.2 });
    shell.up({ x: 5, y: 1.2 });
    expect([count(shell), blink(shell)]).toEqual([0, 0]);
  });

  it("a refused edit doesn't tick", () => {
    const shell = FakeShell.withDocument(desk());
    const before = shell.doc();
    shell.command(place("b", "block", { x: 3, y: 3.9 })); // on the desk
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).not.toBeNull();
    expect([count(shell), blink(shell)]).toEqual([0, 0]);
  });
});
