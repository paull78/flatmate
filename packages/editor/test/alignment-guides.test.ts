import { describe, expect, it } from "vitest";
import { anchorAtMm, placementCentre, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { NUDGE_TIMER } from "../src/tools/nudge";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Alignment guides on furniture drags (direct.13, direct.17; AC-13). The room's inner faces are at x 0.1 / 5.9 and
// y 0.1 / 3.9; zoom 80, so the tolerance is 10 px = 0.125 m and the grid step 0.2 m. A is a wardrobe, 1.2 × 0.6
// anchored at (1.53, 3): x 0.93–2.13, y 2.4–3.0, centre (1.53, 2.7). B is a chair, 0.45 × 0.45 anchored at
// (2.925, 1.5): x 2.7–3.15, y 1.05–1.5, centre (2.925, 1.275).
const A: Command = { type: "placeObject", deck: null, opId: "wr", state: "s0", object: { kind: "wardrobe" }, at: { x: 1.53, y: 3 } };
const chairAt = (at: Point, rotation = 0, opId = "ch"): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind: "chair" }, at, rotation });
const B = chairAt({ x: 2.925, y: 1.5 });
const B_CENTRE = { x: 2.925, y: 1.275 };

function guides(shell: FakeShell): Extract<Primitive, { kind: "segment" }>[] {
  const overlays = shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
  return overlays.flatMap((p) => (p.kind === "segment" && p.color === COLORS.snapGuide ? [p] : []));
}

/** The one guide's x and its y span, ends sorted; null unless there is exactly one vertical guide. */
function vertical(shell: FakeShell): { x: number; y0: number; y1: number } | null {
  const [g, ...rest] = guides(shell);
  if (!g || rest.length > 0 || Math.abs(g.a.x - g.b.x) > 1e-9) return null;
  return { x: g.a.x, y0: Math.min(g.a.y, g.b.y), y1: Math.max(g.a.y, g.b.y) };
}

function centre(shell: FakeShell, id: string): Point | null {
  const p = shell.doc().placements[id];
  return p ? placementCentre(shell.doc(), p) : null;
}

/** Presses at `from` and moves there in two steps, as a hand would; the release is left to the test. */
function dragTo(shell: FakeShell, from: Point, to: Point, mods = {}): void {
  shell.moveTo(from, mods);
  shell.down(from, mods);
  shell.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, mods);
  shell.moveTo(to, mods);
}

const shellOn = (doc: Document) => FakeShell.withDocument(doc);

describe("alignment guides (AC-13)", () => {
  it("dragging a chair so its left edge comes within tolerance of a wardrobe's left edge snaps to the same x and draws a guide", () => {
    const shell = shellOn(withCommands(roomDoc(), A, B));
    dragTo(shell, B_CENTRE, { x: 1.205, y: 1.275 }); // raw −1.72: the left edge at 0.98, 0.05 from 0.93
    const g = vertical(shell);
    expect(g?.x).toBeCloseTo(0.93, 6);
    expect(g?.y0).toBeCloseTo(1.05, 6);
    expect(g?.y1).toBeCloseTo(3, 6);
    shell.up({ x: 1.205, y: 1.275 });
    expect(shell.doc().placements["ch/p0"]?.at).toEqual({ x: 1.155, y: 1.5 }); // not the grid's 1.125 (left edge 0.90)
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("with Ctrl there is no snap and no guide", () => {
    const shell = shellOn(withCommands(roomDoc(), A, B));
    dragTo(shell, B_CENTRE, { x: 1.205, y: 1.275 }, { ctrl: true });
    expect(guides(shell)).toHaveLength(0);
    shell.up({ x: 1.205, y: 1.275 }, { ctrl: true });
    expect(shell.doc().placements["ch/p0"]?.at).toEqual({ x: 1.205, y: 1.5 });

    const exact = shellOn(withCommands(roomDoc(), A, B));
    dragTo(exact, B_CENTRE, { x: 1.155, y: 1.275 }, { ctrl: true }); // the left edge on 0.93 by hand
    expect(guides(exact)).toHaveLength(0);
  });

  it("a refused move shows red and no guides", () => {
    const shell = shellOn(withCommands(roomDoc(), A, B));
    dragTo(shell, B_CENTRE, { x: 1.205, y: 2.6 }); // both axes line up (x 0.93, y 2.4), onto the wardrobe
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind).toBe("moving");
    expect(t.name === "select" && t.state.kind === "moving" && t.state.attempt.ok).toBe(false);
    expect(guides(shell)).toHaveLength(0);
  });

  describe("an odd-angle piece aligns by its centre only", () => {
    const ODD = { x: 2.95, y: 1.275 };
    const oddDoc = () => withCommands(roomDoc(), A, chairAt(anchorAtMm(ODD, 0.45, 30), 30));

    it("its box's edge near a line does not snap", () => {
      const shell = shellOn(oddDoc());
      dragTo(shell, ODD, { x: ODD.x - 1.65, y: ODD.y }); // box left 0.993 near 0.93; centre 1.30 near nothing
      expect(guides(shell)).toHaveLength(0);
      shell.up({ x: ODD.x - 1.65, y: ODD.y });
      expect(centre(shell, "ch/p0")?.x).toBeCloseTo(1.35, 2); // the grid
      expect(shell.doc().placements["ch/p0"]?.rotation).toBe(30);
    });

    it("its centre near a line snaps", () => {
      const shell = shellOn(oddDoc());
      dragTo(shell, ODD, { x: ODD.x - 1.47, y: ODD.y }); // centre 1.48, 0.05 from A's centre line
      const g = vertical(shell);
      expect(Math.abs((g?.x ?? 0) - 1.53)).toBeLessThan(0.002);
      expect(g?.y1).toBeCloseTo(3, 6);
      shell.up({ x: ODD.x - 1.47, y: ODD.y });
      expect(centre(shell, "ch/p0")?.x).toBeCloseTo(1.53, 2); // the grid would give 1.55
    });
  });

  it("a group aligns by its bounding box", () => {
    const shell = shellOn(withCommands(roomDoc(), A, B, chairAt({ x: 4.075, y: 1.5 }, 0, "c2"))); // the box spans x 2.7–4.3
    shell.click(B_CENTRE);
    shell.click({ x: 4.075, y: 1.275 }, { shift: true });
    dragTo(shell, B_CENTRE, { x: 1.205, y: 1.275 });
    expect(vertical(shell)?.x).toBeCloseTo(0.93, 6);
    shell.up({ x: 1.205, y: 1.275 });
    expect(shell.doc().placements["ch/p0"]?.at.x).toBe(1.155);
    expect(shell.doc().placements["c2/p0"]?.at.x).toBe(2.305);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a group never aligns to its own members", () => {
    // c2's right edge and y lines are the group box's own: a short drag still moves by the grid step.
    const shell = shellOn(withCommands(roomDoc(), A, B, chairAt({ x: 4.075, y: 1.5 }, 0, "c2")));
    shell.click(B_CENTRE);
    shell.click({ x: 4.075, y: 1.275 }, { shift: true });
    dragTo(shell, B_CENTRE, { x: 3.035, y: 1.275 }); // raw +0.11
    shell.up({ x: 3.035, y: 1.275 });
    expect(shell.doc().placements["ch/p0"]?.at.x).toBe(3.125);
    expect(shell.doc().placements["c2/p0"]?.at.x).toBe(4.275);
  });

  it("after a contact turn the wall wins across it and a guide still aligns along it (furnish.16)", () => {
    // W, 1.2 × 0.6 centred on (3, 2), dragged by (−2.19, 0.87): the stepped centre (0.8, 2.8) puts its left side 0.10 m
    // from the face, so it turns to 90 and lands flush, x 0.1–0.7, and the left wall holds x. On y the free turned box
    // (centre (0.81, 2.87), y 2.27–3.47) is 0.03 from T's 2.9 and 3.5, so the centre goes to 2.9; the step gives 2.8.
    const W: Command = { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 3, y: 2.3 } };
    const T: Command = { type: "placeObject", deck: null, opId: "t", state: "s0", object: { kind: "wardrobe" }, at: { x: 1.78, y: 3.5 } }; // x 1.18–2.38, y 2.9–3.5
    const shell = shellOn(withCommands(roomDoc(), W, T));
    dragTo(shell, { x: 3, y: 2 }, { x: 0.81, y: 2.87 });
    const gs = guides(shell);
    expect(gs).toHaveLength(2);
    expect(gs.every((g) => g.a.y === g.b.y)).toBe(true);
    const ys = gs.map((g) => g.a.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(2.9, 6);
    expect(ys[1]).toBeCloseTo(3.5, 6);
    for (const g of gs) {
      expect(Math.min(g.a.x, g.b.x)).toBeCloseTo(0.1, 6);
      expect(Math.max(g.a.x, g.b.x)).toBeCloseTo(2.38, 6);
    }
    shell.up({ x: 0.81, y: 2.87 });
    expect(shell.doc().placements["w/p0"]?.rotation).toBe(90);
    expect(shell.doc().placements["w/p0"]?.at).toEqual({ x: 0.1, y: 2.9 });
    expect(centre(shell, "w/p0")?.x).toBeCloseTo(0.4, 6);
    expect(centre(shell, "w/p0")?.y).toBeCloseTo(2.9, 6);
  });

  it("Shift keeps a guide off the axis it locks out", () => {
    // A2, a block at y 2.25–2.85; K, a block at y 2.2–2.8, its lines 0.05 off A2's. A Shift drag along x with a small
    // wobble on y stays on y 2.8 and draws no horizontal guide.
    const A2: Command = { type: "placeObject", deck: null, opId: "a2", state: "s0", object: { kind: "block" }, at: { x: 2.8, y: 2.85 } };
    const K: Command = { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "block" }, at: { x: 4.5, y: 2.8 } };
    const shell = shellOn(withCommands(roomDoc(), A2, K));
    dragTo(shell, { x: 4.5, y: 2.5 }, { x: 4, y: 2.52 }, { shift: true });
    expect(guides(shell).filter((g) => g.a.y === g.b.y)).toEqual([]);
    shell.up({ x: 4, y: 2.52 }, { shift: true });
    expect(shell.doc().placements["k/p0"]?.at).toEqual({ x: 4.1, y: 2.8 });
  });

  it("nudging shows the guides it lands on without snapping", () => {
    const shell = shellOn(withCommands(roomDoc(), A, chairAt({ x: 1.175, y: 1.5 }))); // left edge 0.95
    shell.click({ x: 1.175, y: 1.275 });
    shell.key("ArrowLeft"); // 0.94
    expect(guides(shell)).toHaveLength(0);
    shell.key("ArrowLeft"); // 0.93
    const g = vertical(shell);
    expect(g?.x).toBeCloseTo(0.93, 6);
    expect(g?.y0).toBeCloseTo(1.05, 6);
    expect(g?.y1).toBeCloseTo(3, 6);
    shell.key("ArrowLeft"); // 0.92
    expect(guides(shell)).toHaveLength(0);
    shell.host.advance(400);
    shell.fireTimer(NUDGE_TIMER);
    expect(shell.doc().placements["ch/p0"]?.at.x).toBe(1.145);
  });

  it("a refused nudge shows red and no guides", () => {
    const shell = shellOn(withCommands(roomDoc(), A, chairAt({ x: 1.155, y: 2.38 }))); // x 0.93–1.38, top 2.38
    shell.click({ x: 1.155, y: 2.155 });
    shell.key("ArrowUp");
    shell.key("ArrowUp"); // the top on A's bottom (2.4): two guides
    expect(guides(shell)).toHaveLength(2);
    shell.key("ArrowUp"); // into A: refused, the preview stays at 2.4
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind).toBe("nudging");
    expect(t.name === "select" && t.state.kind === "nudging" && t.state.attempt.ok).toBe(false);
    expect(guides(shell)).toHaveLength(0);
  });

  it("a resize drag shows no guides", () => {
    // A third chair's left edge lines up with A's (0.93), which a resize of A's right side keeps.
    const shell = shellOn(withCommands(roomDoc(), A, B, chairAt({ x: 1.155, y: 0.8 }, 0, "c3")));
    shell.click({ x: 1.53, y: 2.7 });
    const grip = handles(shell.state, shell.doc()).find((h) => h.kind === "side" && h.side === "right");
    if (!grip) throw new Error("no right grip");
    dragTo(shell, grip.at, { x: grip.at.x + 0.35, y: grip.at.y }); // the right edge to 2.53, short of B (2.7)
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind === "moving" && t.state.attempt.ok).toBe(true);
    expect(guides(shell)).toHaveLength(0);
  });
});
