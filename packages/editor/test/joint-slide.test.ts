import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap, type Command, type Document } from "@fm/domain";
import { jointAt, pointOf } from "./builders";
import { FakeShell } from "./fake-shell";

// Step 08 (straight.21): a straight joint slides along its line, by the 0.2 m grid at 80 px/m here; Ctrl frees it.

/** Two walls in line, a → s → b, drawn one after the other so s is a straight joint. */
function line(a: [number, number], s: [number, number], b: [number, number]): Document {
  const wall = (opId: string, from: [number, number], to: [number, number]): Command => ({ type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } } });
  return [wall("w1", a, s), wall("w2", s, b)].reduce((doc, cmd) => unwrap(execute(doc, cmd)).doc, emptyDocument());
}

describe("a straight joint slides along its line", () => {
  it("drags 40 cm along and 15 cm across: the joint moves 40 cm along only (AC-08; 15 cm, as 5 rounds to 0 on this grid)", () => {
    const doc = line([0, 0], [3, 0], [6, 0]);
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 3, y: 0 }, { x: 3.4, y: 0.15 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 3, y: 0 }))).toEqual({ x: 3.4, y: 0 });
  });

  it("stays on a slanted line", () => {
    const doc = line([0, 0], [3, 1], [6, 2]);
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 3, y: 1 }, { x: 4, y: 1.1 });
    const p = pointOf(shell.doc(), jointAt(doc, { x: 3, y: 1 }));
    expect(Math.abs(p.y - p.x / 3)).toBeLessThanOrEqual(1e-3); // on y = x / 3, to the millimetre
    expect(p.x).toBeGreaterThan(3.5);
  });

  it("with Ctrl goes to the pointer, to the millimetre", () => {
    const doc = line([0, 0], [3, 0], [6, 0]);
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 3, y: 0 }, { x: 3.4337, y: 0.3 }, { ctrl: true });
    const p = pointOf(shell.doc(), jointAt(doc, { x: 3, y: 0 }));
    expect(Math.abs(p.x - 3.434)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(p.y - 0.3)).toBeLessThanOrEqual(1e-9);
  });

  it("a corner joint drag is unchanged", () => {
    const doc = line([0, 0], [3, 0], [3, 3]);
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 3, y: 0 }, { x: 3.4, y: 0.4 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 3, y: 0 }))).toEqual({ x: 3.4, y: 0.4 });
  });
});
