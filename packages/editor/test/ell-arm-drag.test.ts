import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { tryCommand } from "../src/tools/drag-commit";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Dragging an arm grip of a corner desk (catalog.09, .12, .18; AC-02): the arm's depth follows the drag across the
// arm, in the snap step, flush to another piece's face, to the cm with Ctrl, clamped to 0.10 m short of its side; a
// refused arm is red and commits nothing. The desk (1.60 × 1.20, arms 0.60) is anchored at (3, 3.9) against the top
// wall: the back arm x 2.2–3.8, y 3.3–3.9, the left arm x 2.2–2.8, y 2.7–3.3, the empty quarter x 2.8–3.8, y 2.7–3.3.
// The back arm grip is at (3.3, 3.3), the left arm grip at (2.8, 3). At zoom 400 the Auto step is 0.05 m and the snap
// tolerance 0.025 m.

const ZOOM = 400;
const place = (opId: string, kind: string, at: Point): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at });
const deskDoc = (...more: Command[]): Document => withCommands(roomDoc(), place("k", "cornerDesk", { x: 3, y: 3.9 }), ...more);
/** A chair in the quarter, its backrest toward the back arm: x 3.075–3.525, y 2.72–3.17. */
const CHAIR = place("c", "chair", { x: 3.3, y: 3.17 });
const BACK_GRIP = { x: 3.3, y: 3.3 };
const LEFT_GRIP = { x: 2.8, y: 3 };

function selected(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom: ZOOM, center: { x: 3, y: 3.3 } } };
  shell.click({ x: 3, y: 3.6 }); // the back arm
  return shell;
}

const arms = (shell: FakeShell) => shell.doc().objects["k/o0"]?.arms;
const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
function moving(shell: FakeShell) {
  const t = shell.state.tool;
  return t.name === "select" && t.state.kind === "moving" ? t.state : null;
}

describe("dragging an arm grip", () => {
  it("0.13 m into the quarter: the back arm takes the step (0.75), with Ctrl the cm (0.73); the left arm likewise", () => {
    const stepped = selected(deskDoc());
    stepped.drag(BACK_GRIP, { x: 3.3, y: 3.17 });
    expect(arms(stepped)).toEqual({ back: 0.75, left: 0.6 });
    const free = selected(deskDoc());
    free.drag(BACK_GRIP, { x: 3.3, y: 3.17 }, { ctrl: true });
    expect(arms(free)).toEqual({ back: 0.73, left: 0.6 });
    const left = selected(deskDoc());
    left.drag(LEFT_GRIP, { x: 2.93, y: 3 });
    expect(arms(left)).toEqual({ back: 0.6, left: 0.75 });
  });

  it("commits one setObjectSize with the current width and the new arms (catalog.18)", () => {
    const shell = selected(deskDoc());
    shell.moveTo(BACK_GRIP);
    shell.down(BACK_GRIP);
    shell.moveTo({ x: 3.3, y: 3.2 }, { ctrl: true });
    const m = moving(shell);
    expect(m?.target).toEqual({ kind: "armGrip", placementId: "k/p0", arm: "back" });
    expect(m && tryCommand(m.target, m.attempt.tried)).toEqual({ type: "setObjectSize", objectId: "k/o0", w: 1.6, d: {}, arms: { back: 0.7, left: 0.6 } });
    shell.up({ x: 3.3, y: 3.2 }, { ctrl: true });
  });

  it("near a chair in the quarter the arm flushes on the chair's back face (0.73, not the step's 0.70)", () => {
    const shell = selected(deskDoc(CHAIR));
    shell.drag(BACK_GRIP, { x: 3.3, y: 3.19 });
    expect(arms(shell)).toEqual({ back: 0.73, left: 0.6 });
  });

  it("past d − 0.10 the arm stops at 1.10", () => {
    const shell = selected(deskDoc());
    shell.drag(BACK_GRIP, { x: 3.3, y: 2 }, { ctrl: true });
    expect(arms(shell)).toEqual({ back: 1.1, left: 0.6 });
  });

  it("an arm into the chair is refused red and commits nothing; Esc restores", () => {
    const shell = selected(deskDoc(CHAIR));
    const before = shell.doc();
    shell.moveTo(BACK_GRIP);
    shell.down(BACK_GRIP);
    shell.moveTo({ x: 3.3, y: 3.0 }, { ctrl: true });
    expect(moving(shell)?.target.kind).toBe("armGrip");
    expect(moving(shell)?.attempt.ok).toBe(false);
    expect(overlays(shell).filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill).length).toBeGreaterThanOrEqual(2); // the L ghost and the chair
    shell.up({ x: 3.3, y: 3.0 }, { ctrl: true });
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    shell.moveTo(BACK_GRIP);
    shell.down(BACK_GRIP);
    shell.moveTo({ x: 3.3, y: 3.0 }, { ctrl: true });
    shell.key("Escape");
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    expect(overlays(shell).filter((p) => p.color === COLORS.invalidFill)).toEqual([]);
    shell.up({ x: 3.3, y: 3.0 });
    expect(shell.doc()).toBe(before);
  });

  it("shows a resize cursor across the arm, and the arm's depth by the grip while dragging", () => {
    const shell = selected(deskDoc());
    shell.moveTo(LEFT_GRIP);
    expect(shell.view().cursor).toBe("ew-resize");
    shell.moveTo(BACK_GRIP);
    expect(shell.view().cursor).toBe("ns-resize");
    shell.down(BACK_GRIP);
    shell.moveTo({ x: 3.3, y: 3.25 }, { ctrl: true });
    expect(shell.view().cursor).toBe("ns-resize");
    shell.moveTo({ x: 3.3, y: 3.2 }, { ctrl: true });
    const annotations = shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? [];
    expect(annotations).toContainEqual(expect.objectContaining({ kind: "text", text: "0.70 m" }));
  });

  it("one drag is one undo step", () => {
    const shell = selected(deskDoc());
    shell.drag(BACK_GRIP, { x: 3.3, y: 3.1 }, { ctrl: true });
    expect(arms(shell)).toEqual({ back: 0.8, left: 0.6 });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(arms(shell)).toEqual({ back: 0.6, left: 0.6 });
  });
});
