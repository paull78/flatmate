import { describe, expect, it } from "vitest";
import { validateDocument, type Command, type Document, type Placement } from "@fm/domain";
import type { ObjectGhost } from "../src/tools/types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A moving open stair previews with its underside (stairs.56, step 17): over a desk under its high end the Object tool's
// ghost, caught by the loft's edge (stairdraw.11), is blue and two clicks place it; dragging a placed open stair there
// previews as fitting and commits.
// roomDoc's inner faces are x 0.1–5.9, y 0.1–3.9; a loft over x 0.1–1.9 at +2.15 under 3.20; a desk turned 90° under
// where the stair's high end lands (x 2.6–3.2, y 1.4–2.6).

const setup: Command[] = [
  { type: "setCeiling", height: 3.2 },
  { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 },
  { type: "placeObject", opId: "dk", state: "s0", object: { kind: "desk" }, at: { x: 2.6, y: 2 }, rotation: 90, deck: null },
];
function shellOf(doc: Document): FakeShell {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  return shell;
}
const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const stairOf = (shell: FakeShell): Placement | undefined => Object.values(shell.doc().placements).find((p) => shell.doc().objects[p.object]?.kind === "openStair");

describe("an open stair's preview over a desk (stairs.56)", () => {
  it("the ghost turns its back to the loft's edge over the desk, blue, and two clicks place it", () => {
    const shell = shellOf(withCommands(roomDoc(), ...setup));
    shell.ui({ type: "pickKind", kind: "openStair" });
    shell.moveTo({ x: 2.4, y: 2 }); // in the loft's edge's band
    expect(ghost(shell)).toMatchObject({ fits: true, rotation: 90 });
    shell.click({ x: 2.4, y: 2 });
    shell.click({ x: 2.4, y: 2 });
    const p = stairOf(shell);
    expect(p && { at: p.at, rotation: p.rotation }).toEqual({ at: { x: 1.9, y: 2 }, rotation: 90 });
  });

  it("a placed open stair dragged over the desk lands there", () => {
    // Placed lower in the room first (y 2.95–3.85 against the loft's edge), then dragged down 0.95 over the desk.
    const shell = shellOf(withCommands(roomDoc(), ...setup, { type: "placeObject", opId: "st", state: "s0", object: { kind: "openStair" }, at: { x: 1.9, y: 3.4 }, rotation: 90, deck: null }));
    shell.drag({ x: 3.4, y: 3.4 }, { x: 3.4, y: 2.45 });
    expect(stairOf(shell)?.at).toEqual({ x: 1.9, y: expect.closeTo(2.45, 6) });
  });
});
