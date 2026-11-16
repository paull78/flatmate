import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { liveDistances } from "../src/view/distances";
import { jointAt, pointOf, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Step 07 (spec M1 "Snapping across", "Live distances"): a moving run lines up with exactly parallel walls on screen,
// face to face or centre to centre, within 10 px (0.125 m at 80 px/m), winning over the grid; and shows the clear
// distance to the nearest parallel face on each side, none while refused. The snap step is 1 cm here, so the grid
// never lands on the lined-up place by itself.

const free = (from: [number, number], to: [number, number]): Command => ({ type: "addWall", opId: "f", from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } } });

function shellWith(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.01 });
  return shell;
}

const bottomLeft = (doc: Document) => jointAt(doc, { x: 0, y: 0 });

describe("a run lines up with parallel walls", () => {
  // A free wall outside the room, on screen: its faces at y 0.9 and 1.1, its centre at y 1.
  const doc = withCommands(roomDoc(), free([-3, 1], [-1, 1]));

  it("lines its top face up with the free wall's bottom face, and marks it (AC-05)", () => {
    const shell = shellWith(doc);
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 3, y: 0.83 }); // 0.83 across: the top face at 0.93, 3 cm from 0.9
    expect(shell.state.snap).toMatchObject({ kind: "aligned", guides: [{ x: -2, y: 1 }] });
    shell.up({ x: 3, y: 0.83 });
    expect(pointOf(shell.doc(), bottomLeft(doc)).y).toBeCloseTo(0.8, 9);
  });

  it("with Ctrl doesn't line up, and moves to the millimetre", () => {
    const shell = shellWith(doc);
    shell.drag({ x: 3, y: 0 }, { x: 3, y: 0.8337 }, { ctrl: true });
    expect(Math.abs(pointOf(shell.doc(), bottomLeft(doc)).y - 0.834)).toBeLessThanOrEqual(1e-9);
  });

  it("ignores a wall 0.35° off parallel, and one off screen", () => {
    for (const other of [free([-3, 1], [-1, 1.0122]), free([20, 1], [22, 1])]) {
      const shell = shellWith(withCommands(roomDoc(), other));
      shell.drag({ x: 3, y: 0 }, { x: 3, y: 0.83 });
      expect(pointOf(shell.doc(), bottomLeft(roomDoc())).y).toBeCloseTo(0.83, 9);
    }
  });
});

describe("a run's live distances (AC-06)", () => {
  it("measures the clear distance to the nearest parallel face on each side, in whole cm", () => {
    const shell = shellWith(roomDoc());
    shell.moveTo({ x: 3, y: 0 });
    shell.down({ x: 3, y: 0 });
    shell.moveTo({ x: 3, y: 0.4 });
    // The bottom wall moved 0.40 up: its top face at 0.5, the top wall's inner face at 3.9; nothing parallel below.
    const lines = liveDistances(shell.state, sceneDoc(shell));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.gap).toBeCloseTo(3.4, 9);
  });

  it("measures both sides when both have a face", () => {
    const shell = shellWith(withCommands(roomDoc(), { type: "addWall", opId: "d", from: { at: { x: 0, y: 2 } }, to: { at: { x: 6, y: 2 } } }));
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3, y: 2.5 });
    const gaps = liveDistances(shell.state, sceneDoc(shell)).map((l) => Math.round(l.gap * 100) / 100).sort();
    expect(gaps).toEqual([1.3, 2.3]); // up to the top wall's 3.9, down to the bottom wall's 0.1, from faces at 2.6 and 2.4
  });

  it("shows none while the move is refused", () => {
    const shell = shellWith(withCommands(roomDoc(), { type: "addWall", opId: "d", from: { at: { x: 0, y: 2 } }, to: { at: { x: 6, y: 2 } } }));
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3, y: 5 }); // past the top wall: refused
    const t = shell.state.tool.name === "select" ? shell.state.tool.state : null;
    expect(t?.kind === "moving" && t.attempt.ok).toBe(false);
    expect(liveDistances(shell.state, sceneDoc(shell))).toEqual([]);
  });
});

/** The scene's document: the move's preview (the last valid one while refused). */
function sceneDoc(shell: FakeShell): Document | null {
  const t = shell.state.tool.name === "select" ? shell.state.tool.state : null;
  return t?.kind === "moving" ? t.attempt.doc : shell.doc();
}
