import { describe, expect, it } from "vitest";
import { placementRange, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// A radiator or towel rail goes back to a wall by touch to turn (catalog.08, .23): nothing new, the gesture every kind
// has; it holds at a 0.10 m depth and at the row's 0.15 m elevation. roomDoc: 6 × 4 m, inner faces x 0.1 / 5.9,
// y 0.1 / 3.9; a placement's `at` is the middle of its back edge.

/** The Object tool on a room with `kind` picked. */
function objectTool(doc: Document, kind: string): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind });
  return shell;
}
const ghostOf = (shell: FakeShell) => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);

/** Where the ghost, at its first rotation 0, comes within touch of each wall: an end first on the left and right. */
const walls = (w: number): { wall: string; cursor: Point; at: Point; rotation: number }[] => [
  { wall: "top", cursor: { x: 3, y: 3.8 }, at: { x: 3, y: 3.9 }, rotation: 0 },
  { wall: "left", cursor: { x: 0.1 + w / 2 + 0.05, y: 2 }, at: { x: 0.1, y: 2 }, rotation: 90 },
  { wall: "bottom", cursor: { x: 3, y: 0.2 }, at: { x: 3, y: 0.1 }, rotation: 180 },
  { wall: "right", cursor: { x: 5.9 - w / 2 - 0.05, y: 2 }, at: { x: 5.9, y: 2 }, rotation: 270 },
];

describe("a radiator and a towel rail against a wall (catalog.08, .23)", () => {
  for (const [kind, w, top] of [["radiator", 0.8, 0.75], ["towelRail", 0.5, 1.35]] as const) {
    for (const { wall, cursor, at, rotation } of walls(w)) {
      it(`${kind}: near the ${wall} wall the ghost turns its back onto it, and a click places it at 0.15–${top}`, () => {
        const shell = objectTool(roomDoc(), kind);
        shell.moveTo(cursor);
        expect(ghostOf(shell)).toMatchObject({ kind, at, rotation, fits: true });
        shell.click(cursor);
        const placement = Object.values(shell.doc().placements)[0];
        expect(placement).toMatchObject({ at, rotation });
        const range = placement ? placementRange(shell.doc(), placement.id) : null;
        expect(range?.bottom).toBe(0.15);
        expect(range?.top).toBeCloseTo(top, 9);
      });
    }
  }
});
