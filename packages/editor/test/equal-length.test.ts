import { describe, expect, it } from "vitest";
import { distance, emptyDocument, execute, unwrap, type Command, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { jointAt, pointOf } from "./builders";
import { FakeShell } from "./fake-shell";

// Step 25 (spec M4 "Equal length"): the end of a wall being drawn or changed snaps to the length of another parallel,
// offset wall on screen, within 10 px (0.125 m at 80 px/m); "=" on both and the word Equal; below aligned, above grid.
// The reference wall is 2.43 m long, off the 0.2 m grid, so the grid alone never lands on it.

const wall = (opId: string, from: [number, number], to: [number, number]): Command => ({ type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } } });
const docOf = (...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument());
const reference = wall("ref", [0, 3], [2.43, 3]);
const texts = (shell: FakeShell): string[] =>
  (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "text" && p.color === COLORS.snap ? [p.text] : []));

describe("equal length", () => {
  it("drawing a wall parallel to and offset from a 2.43 m wall snaps to 2.43, with = on both and the word Equal (AC-19)", () => {
    const shell = FakeShell.withDocument(docOf(reference));
    shell.key("w");
    shell.click({ x: 1, y: 1 });
    shell.moveTo({ x: 3.38, y: 1.01 }); // the grid gives (3.4, 1): 2.4 long, 3 cm from 2.43
    expect(shell.state.snap).toMatchObject({ kind: "equal", point: { x: 3.43, y: 1 } });
    expect(texts(shell).sort()).toEqual(["=", "=", "Equal"]);
    shell.click({ x: 3.38, y: 1.01 });
    const lengths = Object.values(shell.doc().walls).map((w) => Math.round(distance(pointOf(shell.doc(), w.a), pointOf(shell.doc(), w.b)) * 1000) / 1000);
    expect(lengths).toEqual([2.43, 2.43]);
  });

  it("a wall in line with the moving one, or off screen, is no candidate", () => {
    const inLine = FakeShell.withDocument(docOf(wall("ref", [-4, 1], [-1.57, 1])));
    inLine.key("w");
    inLine.click({ x: 1, y: 1 });
    inLine.moveTo({ x: 3.38, y: 1.01 });
    expect(inLine.state.snap?.kind).not.toBe("equal");
    const far = FakeShell.withDocument(docOf(wall("ref", [40, 30], [42.43, 30])));
    far.key("w");
    far.click({ x: 1, y: 1 });
    far.moveTo({ x: 3.38, y: 1.01 });
    expect(far.state.snap?.kind).not.toBe("equal");
  });

  it("an aligned snap wins over equal", () => {
    // A joint at x 3.5 lines the end up (aligned) though 2.43 is in range too.
    const shell = FakeShell.withDocument(docOf(reference, wall("post", [3.5, -2], [3.5, -1])));
    shell.key("w");
    shell.click({ x: 1, y: 1 });
    shell.moveTo({ x: 3.46, y: 1.01 });
    expect(shell.state.snap?.kind).toBe("angle"); // the ray tied to the joint's line (two guides): exact, kept
    expect(shell.state.snap?.point).toEqual({ x: 3.5, y: 1 });
  });

  it("a joint drag matches the dragged wall's length to a parallel wall", () => {
    const doc = docOf(reference, wall("mine", [0, 0], [2, 0]));
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 2, y: 0 }, { x: 2.41, y: 0 }); // the grid gives 2.4; equal gives 2.43
    expect(pointOf(shell.doc(), jointAt(doc, { x: 2, y: 0 })).x).toBeCloseTo(2.43, 9);
  });

  it("the Dimension tool has no equal snap", () => {
    const shell = FakeShell.withDocument(docOf(reference));
    shell.key("m");
    shell.click({ x: 1, y: 1 });
    shell.moveTo({ x: 3.38, y: 1.01 });
    expect(shell.state.snap?.kind).not.toBe("equal");
  });
});
