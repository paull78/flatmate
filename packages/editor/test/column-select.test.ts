import { describe, expect, it } from "vitest";
import { columnOf, openingGeometry, type Command } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { handles } from "../src/view/handles";
import { jointAt, pointOf, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Selecting, moving and deleting a free column (spec "Moving and deleting a column", pillars.13; AC-16 no grips).
// roomDoc: a 6 × 4 room, wall faces x 0.1–5.9, y 0.1–3.9. The column: 0.30 × 0.30 at (2, 2), row c/w0, joints at
// (1.85, 2) and (2.15, 2).

const ROW = "c/w0";
const place: Command = { type: "placeColumn", opId: "c", at: { x: 2, y: 2 }, width: 0.3, depth: 0.3 };
const column = (shell: FakeShell) => columnOf(shell.doc(), ROW);

function selected(): FakeShell {
  const shell = FakeShell.withDocument(withCommands(roomDoc(), place));
  shell.ui({ type: "setSnapStep", step: 0.01 });
  shell.click({ x: 2, y: 2 });
  expect(shell.state.selection).toEqual([{ table: "walls", id: ROW }]);
  return shell;
}

/** A press at `from` dragged to `to` and released, with a move between. */
function drag(shell: FakeShell, from: Point, to: Point): void {
  shell.moveTo(from);
  shell.down(from);
  shell.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  shell.moveTo(to);
  shell.up(to);
}

describe("selecting a column", () => {
  it("a click on a column selects its row, not a joint, even right by an end", () => {
    for (const at of [{ x: 2, y: 2 }, { x: 2.14, y: 2 }, { x: 1.86, y: 2.01 }]) {
      const shell = FakeShell.withDocument(withCommands(roomDoc(), place));
      shell.click(at);
      expect(shell.state.selection, JSON.stringify(at)).toEqual([{ table: "walls", id: ROW }]);
    }
  });

  it("a selected column shows no handles or grips, and no length helper", () => {
    const shell = selected();
    expect(handles(shell.state, shell.doc())).toEqual([]);
    const helper = (shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? []).filter((p) => p.kind === "text");
    expect(helper).toEqual([]);
  });
});

describe("moving a free column", () => {
  it("dragging it runs setColumn: the centre moves by the drag, the size and angle stay; the preview equals the commit", () => {
    const shell = selected();
    shell.moveTo({ x: 2, y: 2 });
    shell.down({ x: 2, y: 2 });
    shell.moveTo({ x: 2.5, y: 2.2 });
    shell.moveTo({ x: 3, y: 2.5 });
    const tool = shell.state.tool;
    const preview = tool.name === "select" && tool.state.kind === "moving" ? tool.state.attempt.doc : null;
    expect(preview && columnOf(preview, ROW)?.centre).toEqual({ x: 3, y: 2.5 });
    shell.up({ x: 3, y: 2.5 });
    expect(column(shell)).toEqual({ id: ROW, centre: { x: 3, y: 2.5 }, width: expect.closeTo(0.3, 9), depth: 0.3, rotation: 0, line: null });
    expect(shell.doc()).toEqual(preview);
    expect(shell.state.selection).toEqual([{ table: "walls", id: ROW }]);
  });

  it("a drag into a wall is refused with the domain's toast; the column stays", () => {
    const shell = selected();
    drag(shell, { x: 2, y: 2 }, { x: 0.15, y: 2 });
    expect(column(shell)?.centre).toEqual({ x: 2, y: 2 });
    expect(shell.view().toast).toBe("This column touches a wall");
  });

  it("arrows nudge it by the nudge step as one setColumn", () => {
    const shell = selected();
    shell.key("ArrowRight");
    shell.key("ArrowRight", { shift: true });
    shell.key("ArrowUp");
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(column(shell)?.centre.x).toBeCloseTo(2.11, 9);
    expect(column(shell)?.centre.y).toBeCloseTo(2.01, 9);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a nudge into a wall stops at the last valid place", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { ...place, at: { x: 0.27, y: 2 } })); // x 0.12–0.42
    shell.click({ x: 0.27, y: 2 });
    for (let i = 0; i < 4; i++) shell.key("ArrowLeft");
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(column(shell)?.centre.x).toBeCloseTo(0.26, 9);
  });

  it("Delete removes it", () => {
    const shell = selected();
    shell.key("Delete");
    expect(shell.doc().walls[ROW]).toBeUndefined();
    expect(Object.values(shell.doc().walls).some((w) => w.column)).toBe(false);
    expect(shell.state.selection).toEqual([]);
  });
});

// A column in a wall's line (spec "Moving and deleting a column", AC-14, AC-19): 0.30 × 0.30 at (2, 0) in the south
// wall (0,0)→(6,0), row c/w0, joints (1.85, 0) and (2.15, 0); the near half keeps the wall's ID, c/w1 is the far half.
const SOUTH = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
const inLine: Command = { type: "placeColumn", opId: "c", at: { x: 2, y: 0 }, width: 0.3, depth: 0.3 };
const door: Command = { type: "addOpening", opId: "d", wall: SOUTH, kind: "swing", offset: 4.5 }; // on the far half after the split
const ends = (shell: FakeShell): Point[] => {
  const w = shell.doc().walls[ROW];
  return w ? [pointOf(shell.doc(), w.a), pointOf(shell.doc(), w.b)] : [];
};

function inLineSelected(...more: Command[]): FakeShell {
  const shell = FakeShell.withDocument(withCommands(roomDoc(), ...more, inLine));
  shell.ui({ type: "setSnapStep", step: 0.01 });
  expect(column(shell)?.line).not.toBeNull();
  shell.click({ x: 2, y: 0 });
  expect(shell.state.selection).toEqual([{ table: "walls", id: ROW }]);
  return shell;
}

/** A press at the first point, moves through the rest, and a release at the last. */
function dragThrough(shell: FakeShell, ...path: Point[]): void {
  const [from, ...rest] = path;
  const to = rest.at(-1);
  if (!from || !to) throw new Error("a drag needs two points");
  shell.moveTo(from);
  shell.down(from);
  for (const p of rest) shell.moveTo(p);
  shell.up(to);
}

describe("moving a column in a wall's line", () => {
  it("a drag past a door stops at its jamb, and the door stays (fixes AC-09)", () => {
    const shell = inLineSelected({ type: "addOpening", opId: "d", wall: SOUTH, kind: "swing", offset: 2.4 });
    const doorAt = () => openingGeometry(shell.doc(), "d/d0");
    const before = doorAt();
    dragThrough(shell, { x: 2, y: 0 }, { x: 2.25, y: 0 }, { x: 2.8, y: 0 }, { x: 3.6, y: 0 });
    expect(ends(shell).map((p) => p.x)).toEqual([expect.closeTo(2.1, 9), expect.closeTo(2.4, 9)]);
    expect(doorAt()).toEqual(before);
  });

  it("dragged 0.50 along the wall, both its joints move 0.50 along the line", () => {
    const shell = inLineSelected();
    dragThrough(shell, { x: 2, y: 0 }, { x: 2.25, y: 0 }, { x: 2.5, y: 0 });
    expect(ends(shell).map((p) => [p.x, p.y])).toEqual([[expect.closeTo(2.35, 9), 0], [expect.closeTo(2.65, 9), 0]]);
    expect(column(shell)?.line).not.toBeNull();
  });

  it("dragged across the wall, it stays on the line, moving only by the part along it", () => {
    const shell = inLineSelected();
    dragThrough(shell, { x: 2, y: 0 }, { x: 2.1, y: 0.5 }, { x: 2.3, y: 0.8 });
    expect(column(shell)?.centre.x).toBeCloseTo(2.3, 9);
    expect(column(shell)?.centre.y).toBeCloseTo(0, 9);
  });

  it("dragged toward the corner past the 1 cm limit, it stops at the last valid place, with no toast", () => {
    const shell = inLineSelected();
    dragThrough(shell, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0 }, { x: 0.1, y: 0 });
    expect(column(shell)?.centre.x).toBeCloseTo(0.5, 9);
    expect(shell.view().toast).toBeNull();
  });

  it("a first move already past the limit is drawn refused, and its release toasts and changes nothing", () => {
    const shell = inLineSelected();
    shell.moveTo({ x: 2, y: 0 });
    shell.down({ x: 2, y: 0 });
    shell.moveTo({ x: 0.1, y: 0 });
    const tool = shell.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("moving");
    expect(tool.name === "select" && tool.state.kind === "moving" && tool.state.attempt.ok).toBe(false);
    shell.up({ x: 0.1, y: 0 });
    expect(column(shell)?.centre.x).toBeCloseTo(2, 9);
    expect(shell.view().toast).toBe("A column needs at least 1 cm of wall on each side");
  });

  it("on a coarse snap step, a drag whose only valid place was the start is drawn refused and toasts (gate M2)", () => {
    // A column near the corner: half (0,0)→(0.15,0). On a 0.25 step the small moves snap to no move, and the first real
    // step (−0.25) already leaves less than 1 cm of wall.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { ...inLine, at: { x: 0.3, y: 0 } }));
    shell.ui({ type: "setSnapStep", step: 0.25 });
    shell.click({ x: 0.3, y: 0 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: ROW }]);
    shell.moveTo({ x: 0.3, y: 0 });
    shell.down({ x: 0.3, y: 0 });
    for (const x of [0.27, 0.24, 0.18, 0.12]) shell.moveTo({ x, y: 0 });
    const tool = shell.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("moving");
    expect(tool.name === "select" && tool.state.kind === "moving" && tool.state.attempt.ok).toBe(false);
    shell.up({ x: 0.12, y: 0 });
    expect(column(shell)?.centre.x).toBeCloseTo(0.3, 9);
    expect(shell.view().toast).toBe("A column needs at least 1 cm of wall on each side");
  });

  it("a door on the far half stays where it was in the world after a drag", () => {
    const shell = inLineSelected(door);
    const before = openingGeometry(shell.doc(), "d/d0");
    dragThrough(shell, { x: 2, y: 0 }, { x: 2.5, y: 0 });
    expect(column(shell)?.centre.x).toBeCloseTo(2.5, 9);
    const after = openingGeometry(shell.doc(), "d/d0");
    expect(after?.start.x).toBeCloseTo(before?.start.x ?? NaN, 9);
    expect(after?.end.x).toBeCloseTo(before?.end.x ?? NaN, 9);
  });

  it("arrows along the wall nudge it; an arrow across the wall leaves it where it is and commits nothing", () => {
    const shell = inLineSelected();
    shell.key("ArrowUp");
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(column(shell)?.centre).toEqual({ x: 2, y: 0 });
    expect(shell.state.undo.past).toHaveLength(0);
    shell.key("ArrowRight");
    shell.key("ArrowRight", { shift: true });
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(column(shell)?.centre.x).toBeCloseTo(2.11, 9);
    expect(column(shell)?.centre.y).toBeCloseTo(0, 9);
    expect(shell.state.undo.past).toHaveLength(1);
  });
});

describe("walls and joints next to a column in a wall's line (AC-19)", () => {
  it("dragging a half moves its whole line, the column carried rigidly (straight.12)", () => {
    const shell = inLineSelected();
    const before = column(shell);
    dragThrough(shell, { x: 1, y: 0 }, { x: 1, y: 0.25 }, { x: 1, y: 0.5 });
    expect(column(shell)?.centre.y).toBeCloseTo(0.5, 9);
    expect(column(shell)?.width).toBeCloseTo(before?.width ?? 0, 9);
    expect(column(shell)?.line).not.toBeNull();
    expect(shell.view().toast).toBeNull();
  });

  it("dragging a half's far joint along the line works", () => {
    const shell = inLineSelected();
    const corner = jointAt(shell.doc(), { x: 6, y: 0 });
    dragThrough(shell, { x: 6, y: 0 }, { x: 6.2, y: 0 }, { x: 6.4, y: 0 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6.4, y: 0 });
    expect(column(shell)?.centre).toEqual({ x: 2, y: 0 });
    expect(column(shell)?.line).not.toBeNull();
  });
});
