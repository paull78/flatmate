import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, validateDocument, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Overhanging a platform in the gestures (steps.06, .11, AC-09): a drag reads the same rule as validation through
// `footprintFit` and `landing`, with no rule of its own. A piece dragged past a platform's edge stays on it while it
// fits there; once its centre leaves the platform it is refused while it still overlaps the solid platform, then lands
// on the floor.
//
// A 7 × 2.5 room (inner x 0.1–6.9, y 0.1–2.4), ceiling 3.05, a solid platform at +0.45 over x 4.5–6.9, y 0.1–1.4. The
// snap step is 0.10, so the drags below move by whole tenths.

const PLAT = "plat/k0";

function room(...more: Command[]): Document {
  return withCommands(
    emptyDocument(),
    ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 5.7, y: 0.75 }, w: 2.4, d: 1.3 },
    ...more,
  );
}

const place = (opId: string, kind: string, at: Point, deck: string | null): Command => ({ type: "placeObject", opId, state: "s0", object: { kind }, at, rotation: 0, deck });

function shellOf(doc: Document): FakeShell {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  return shell;
}

const pin = (p: Placement | undefined) => (p ? { at: { x: Math.round(p.at.x * 1000) / 1000, y: Math.round(p.at.y * 1000) / 1000 }, deck: p.deck } : null);
const moving = (shell: FakeShell): boolean | null => {
  const t = shell.state.tool;
  return t.name === "select" && t.state.kind === "moving" ? t.state.attempt.ok : null;
};

describe("dragging past a platform's edge (AC-09)", () => {
  // A chair (0.45 × 0.45) on the platform, its centre at (5.7, 0.8).
  const chair = (): FakeShell => shellOf(room(place("c", "chair", { x: 5.7, y: 1.025 }, PLAT)));

  it("› dragged 0.125 m past the left edge it stays on the platform", () => {
    // Centre to x 4.6: the chair spans x 4.375–4.825, past x 4.5 by 0.125, its centre on the slab.
    const shell = chair();
    shell.drag({ x: 5.7, y: 0.8 }, { x: 4.6, y: 0.8 });
    expect(pin(shell.doc().placements["c/p0"])).toEqual({ at: { x: 4.6, y: 1.025 }, deck: PLAT });
  });

  it("› with its centre off the platform but still over it, it is refused and returns", () => {
    // Centre to x 4.4: x 4.175–4.625, its centre off the slab, still over the solid platform for the floor.
    const shell = chair();
    shell.moveTo({ x: 5.7, y: 0.8 });
    shell.down({ x: 5.7, y: 0.8 });
    shell.moveTo({ x: 5, y: 0.8 });
    shell.moveTo({ x: 4.4, y: 0.8 });
    expect(moving(shell)).toBe(false);
    shell.up({ x: 4.4, y: 0.8 });
    expect(pin(shell.doc().placements["c/p0"])).toEqual({ at: { x: 5.7, y: 1.025 }, deck: PLAT });
  });

  it("› clear of the platform, it lands on the floor", () => {
    const shell = chair();
    shell.drag({ x: 5.7, y: 0.8 }, { x: 4.2, y: 0.8 });
    expect(pin(shell.doc().placements["c/p0"])).toEqual({ at: { x: 4.2, y: 1.025 }, deck: null });
  });

  it("› an arrow nudge past the edge keeps the surface, the same rule", () => {
    // From centre x 4.6 (0.125 past), a 0.10 nudge left reaches 0.225 past: still on the platform.
    const shell = shellOf(room(place("c", "chair", { x: 4.6, y: 1.025 }, PLAT)));
    shell.click({ x: 4.6, y: 0.8 });
    shell.key("ArrowLeft", { shift: true });
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(pin(shell.doc().placements["c/p0"])).toEqual({ at: { x: 4.5, y: 1.025 }, deck: PLAT });
  });
});
