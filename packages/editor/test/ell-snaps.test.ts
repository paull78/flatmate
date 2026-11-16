import { describe, expect, it } from "vitest";
import type { Command, Document, Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The corner desk in the editor's snaps (catalog.16, .20; AC-03): the corner snap turns its right angle onto a room
// corner, a chair tucks under either arm's inner edge, the click hit test reads its two arms, and a chair in the empty
// quarter flushes and aligns to the inner edges, never to the footprint's invisible sides. roomDoc: 6 × 4 m, inner faces
// x 0.1 / 5.9, y 0.1 / 3.9; zoom 80, so the tolerance is 0.125 m and the step 0.2 m. The desk (1.60 × 1.20, arms 0.60)
// in the top-left corner is anchored at (0.9, 3.9): the back arm x 0.1–1.7, y 3.3–3.9; the left arm x 0.1–0.7,
// y 2.7–3.3; the empty quarter x 0.7–1.7, y 2.7–3.3. Its footprint's centre lines are x 0.9 and y 3.3.

const place = (opId: string, kind: string, at: Point, rotation = 0): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at, rotation });
const DESK = place("desk", "cornerDesk", { x: 0.9, y: 3.9 });
const deskDoc = (...more: Command[]): Document => withCommands(roomDoc(), DESK, ...more);

/** The Object tool on `doc` with `kind` picked at `rotation`. */
function objectTool(doc: Document, kind: string, rotation: number): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind });
  const t = shell.state.tool;
  if (t.name !== "object") throw new Error("not the Object tool");
  shell.state = { ...shell.state, tool: { name: "object", state: { ...t.state, rotation } } };
  return shell;
}
const ghostOf = (shell: FakeShell) => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);

describe("the corner desk's corner snap", () => {
  it("the ghost near the top-left corner turns its right angle onto the corner, both arms flush", () => {
    const shell = objectTool(roomDoc(), "cornerDesk", 90); // its back on the left wall: touch to turn alone keeps 90°
    shell.moveTo({ x: 0.73, y: 3.07 });
    expect(ghostOf(shell)).toMatchObject({ kind: "cornerDesk", at: { x: 0.9, y: 3.9 }, rotation: 0, fits: true });
  });

  it("near the bottom-right corner it turns to 180°, its back-left corner on the room's", () => {
    const shell = objectTool(roomDoc(), "cornerDesk", 270); // its back on the right wall: touch to turn alone keeps 270°
    shell.moveTo({ x: 5.27, y: 0.93 });
    expect(ghostOf(shell)).toMatchObject({ at: { x: 5.1, y: 0.1 }, rotation: 180, fits: true });
  });
});

describe("a chair tucks under either arm of the corner desk", () => {
  it("toward the back arm's inner edge: square to it, its backrest strip flush (back edge on y 3.2)", () => {
    const shell = objectTool(deskDoc(), "chair", 210);
    shell.moveTo({ x: 1.3, y: 2.9 });
    expect(ghostOf(shell)).toMatchObject({ kind: "chair", at: { x: 1.3, y: 3.2 }, rotation: 180, fits: true });
  });

  it("toward the left arm's inner edge: square to it, its back edge on x 0.8", () => {
    const shell = objectTool(deskDoc(), "chair", 300);
    shell.moveTo({ x: 1.1, y: 3 });
    expect(ghostOf(shell)).toMatchObject({ kind: "chair", at: { x: 0.8, y: 3 }, rotation: 270, fits: true });
  });

  it("at the inner corner it tucks to one of the two real edges, never to the seam between the arms", () => {
    const shell = objectTool(deskDoc(), "chair", 225);
    shell.moveTo({ x: 0.95, y: 3.05 });
    const g = ghostOf(shell);
    const onBack = g?.rotation === 180 && g.at.y === 3.2;
    const onLeft = g?.rotation === 270 && g.at.x === 0.8;
    expect({ fits: g?.fits, onBack, onLeft }, JSON.stringify(g)).toMatchObject({ fits: true });
    expect(onBack || onLeft, JSON.stringify(g)).toBe(true);
  });

  it("the click places it tucked", () => {
    const shell = objectTool(deskDoc(), "chair", 210);
    shell.click({ x: 1.3, y: 2.9 });
    const chair = Object.values(shell.doc().placements).find((p) => shell.doc().objects[p.object]?.kind === "chair");
    expect(chair).toMatchObject({ at: { x: 1.3, y: 3.2 }, rotation: 180 });
  });
});

describe("the corner desk's click hit test reads its arms", () => {
  it("a click in the empty quarter selects nothing; a click on either arm selects the desk", () => {
    const shell = FakeShell.withDocument(deskDoc());
    shell.click({ x: 1.2, y: 3 });
    expect(shell.state.selection).toEqual([]);
    shell.click({ x: 0.4, y: 3 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "desk/p0" }]);
    shell.click({ x: 1.2, y: 3 });
    expect(shell.state.selection).toEqual([]);
    shell.click({ x: 1.2, y: 3.6 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "desk/p0" }]);
  });
});

// A chair, 0.45 × 0.45 at 0°, in the empty quarter: anchored at (1.2, 3.2) it spans x 0.975–1.425, y 2.75–3.2,
// centre (1.2, 2.975). Its grips: back (1.2, 3.2), front (1.2, 2.75), left (0.975, 2.975), right (1.425, 2.975).
const CHAIR = place("ch", "chair", { x: 1.2, y: 3.2 });
const CHAIR_CENTRE = { x: 1.2, y: 2.975 };

function resized(from: Point, to: Point): { w: number | undefined; d: number | undefined } {
  const shell = FakeShell.withDocument(deskDoc(CHAIR));
  shell.click(CHAIR_CENTRE);
  expect(shell.state.selection).toEqual([{ table: "placements", id: "ch/p0" }]);
  shell.drag(from, to, {});
  const chair = shell.doc().objects["ch/o0"];
  return { w: chair?.w.standard, d: chair?.d.standard };
}

describe("a chair in the empty quarter flushes to the inner edges (catalog.20)", () => {
  it("its back side flushes to the back arm's inner edge (y 3.3), its left side to the left arm's (x 0.7)", () => {
    expect(resized({ x: 1.2, y: 3.2 }, { x: 1.2, y: 3.27 }).d).toBeCloseTo(0.55, 9);
    expect(resized({ x: 0.975, y: 2.975 }, { x: 0.75, y: 2.975 }).w).toBeCloseTo(0.725, 9);
  });

  it("never to the footprint's right side (x 1.7) or front side (y 2.7)", () => {
    expect(resized({ x: 1.425, y: 2.975 }, { x: 1.65, y: 2.975 }).w).not.toBeCloseTo(0.725, 3);
    expect(resized({ x: 1.2, y: 2.75 }, { x: 1.2, y: 2.68 }).d).not.toBeCloseTo(0.5, 3);
  });
});

describe("a chair moved in the empty quarter aligns to the inner edges (catalog.20)", () => {
  const verticals = (shell: FakeShell): number[] =>
    (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "segment" && p.color === COLORS.snapGuide && Math.abs(p.a.x - p.b.x) < 1e-9 ? [p.a.x] : []));
  function moved(to: Point): { shell: FakeShell; chair: Placement | undefined } {
    const shell = FakeShell.withDocument(deskDoc(CHAIR));
    shell.moveTo(CHAIR_CENTRE);
    shell.down(CHAIR_CENTRE);
    shell.moveTo({ x: CHAIR_CENTRE.x - 0.3, y: CHAIR_CENTRE.y }); // past the drag threshold
    shell.moveTo(to);
    const t = shell.state.tool;
    const chair = t.name === "select" && t.state.kind === "moving" && t.state.attempt.ok ? t.state.attempt.doc.placements["ch/p0"] : undefined;
    return { shell, chair };
  }

  it("its left edge near the left arm's inner edge snaps onto it (x 0.7) with a guide", () => {
    const { shell, chair } = moved({ x: 0.95, y: CHAIR_CENTRE.y }); // left edge 0.725
    expect(chair?.at.x).toBeCloseTo(0.925, 9);
    expect(verticals(shell)).toContainEqual(expect.closeTo(0.7, 9));
  });

  it("no guide along the footprint's centre line x 0.9", () => {
    const { shell, chair } = moved({ x: 1.155, y: CHAIR_CENTRE.y }); // left edge 0.93
    expect(chair?.at.x).not.toBeCloseTo(1.125, 9);
    expect(verticals(shell).filter((x) => Math.abs(x - 0.9) < 0.01)).toEqual([]);
  });
});

// The desk itself dragged: it aligns by its outline's lines too. Anchored at (3, 2) it spans x 2.2–3.8, its left arm's
// inner edge on x 2.8 and its footprint's centre on 3.0. A box anchored at (4.8, 3.6): x 4.5–5.1, centre 4.8.
describe("a dragged corner desk aligns by its outline's lines (catalog.20)", () => {
  function draggedBy(dx: number): number | undefined {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("desk", "cornerDesk", { x: 3, y: 2 }), place("box", "block", { x: 4.8, y: 3.6 })));
    const from = { x: 3.4, y: 1.7 }; // on the back arm
    shell.drag(from, { x: from.x + dx, y: from.y });
    return shell.doc().placements["desk/p0"]?.at.x;
  }

  it("its inner edge near the box's left side snaps onto it", () => {
    expect(draggedBy(1.68)).toBeCloseTo(4.7, 9); // the inner edge 4.48 onto 4.5; the footprint's centre 4.68 is not a line
  });

  it("its footprint's centre is not a line: near the box's left side it takes the step", () => {
    expect(draggedBy(1.47)).toBeCloseTo(4.4, 9); // the centre 4.47 would snap onto 4.5
  });
});
