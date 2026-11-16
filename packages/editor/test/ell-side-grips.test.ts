import { describe, expect, it } from "vitest";
import { MESSAGES, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// An `L` piece's side grips at the arm ends (catalog.12): the front grip on the middle of the left arm's front end
// resizes the depth as today's front grip, the back side kept; a depth that breaks the back arm's rule
// (t1 ≤ d − 0.10) is refused red with the arm message (catalog.35). The desk (1.60 × 1.20, arms 0.60) anchored at
// (3, 3.9): x 2.2–3.8, y 2.7–3.9; its front grip at (2.5, 2.7).

const deskDoc = (): Document => withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "cornerDesk" }, at: { x: 3, y: 3.9 } });
const FRONT_GRIP = { x: 2.5, y: 2.7 };

function selected(): FakeShell {
  const shell = FakeShell.withDocument(deskDoc());
  shell.click({ x: 3, y: 3.6 });
  return shell;
}

describe("an L piece's front grip", () => {
  it("dragging it 0.30 m back makes the desk 0.90 deep, its back kept", () => {
    const shell = selected();
    shell.drag(FRONT_GRIP, { x: 2.5, y: 3 }, { ctrl: true });
    expect(shell.doc().objects["k/o0"]).toMatchObject({ w: { standard: 1.6 }, d: { standard: 0.9 }, arms: { back: 0.6, left: 0.6 } });
    expect(shell.doc().placements["k/p0"]?.at).toEqual({ x: 3, y: 3.9 });
  });

  it("past t1 + 0.10 it is refused red with the arm message", () => {
    const shell = selected();
    const before = shell.doc();
    shell.moveTo(FRONT_GRIP);
    shell.down(FRONT_GRIP);
    shell.moveTo({ x: 2.5, y: 3.35 }, { ctrl: true }); // 0.55 deep, under the back arm's 0.60 + 0.10
    const overlays = shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    expect(overlays.some((p) => p.kind === "polygon" && p.color === COLORS.invalidFill)).toBe(true);
    shell.up({ x: 2.5, y: 3.35 }, { ctrl: true });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe(MESSAGES.arms);
  });
});
