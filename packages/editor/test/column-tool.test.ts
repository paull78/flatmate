import { describe, expect, it } from "vitest";
import { columnOf, wallBodies } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { view3dItems } from "../src/view3d/items";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The Column tool, free (spec "The Column tool", pillars.12, .19; AC-13 free). roomDoc: a 6 × 4 room of 0.20 m walls
// on centrelines, wall faces x 0.1–5.9, y 0.1–3.9.

type Polygon = Extract<Primitive, { kind: "polygon" }>;
const ghosts = (shell: FakeShell): Polygon[] =>
  (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "polygon" ? [p] : []));
const columns = (shell: FakeShell) => Object.values(shell.doc().walls).filter((w) => w.column).map((w) => columnOf(shell.doc(), w.id));

function columnTool(): FakeShell {
  const shell = FakeShell.withDocument(roomDoc());
  shell.ui({ type: "setSnapStep", step: 0.01 });
  shell.key("c");
  return shell;
}

describe("the Column tool", () => {
  it("C picks it; it is floor only, beside Deck in the bar, with a prompt and the size setting 0.30 × 0.30", () => {
    const shell = columnTool();
    const view = shell.view();
    expect(view.activeTool).toBe("column");
    expect(view.tools.map((t) => t.tool).slice(-3, -1)).toEqual(["column", "deck"]);
    expect(view.tools.find((t) => t.tool === "column")).toEqual({ tool: "column", label: "Column", key: "C" });
    expect(view.commandBar.prompt).toBe("Click to place a column");
    expect(view.columnSize).toEqual({ width: "0.30", depth: "0.30" });
    expect(view.columnSizes.map((s) => [s.width, s.depth])).toEqual([["0.20", "0.20"], ["0.30", "0.30"], ["0.40", "0.40"]]);
    expect(view.cursor).toBe("crosshair");
  });

  it("a release with no press before it in the tool places nothing (a stray pointer-up)", () => {
    const shell = columnTool();
    shell.moveTo({ x: 2, y: 2 });
    shell.up({ x: 2, y: 2 });
    expect(columns(shell)).toEqual([]);
    expect(ghosts(shell)).toHaveLength(1);
  });

  it("a click in open floor places a free column at rotation 0, size from the setting", () => {
    const shell = columnTool();
    shell.click({ x: 2, y: 2 });
    expect(columns(shell)).toEqual([{ id: "id1/w0", centre: { x: 2, y: 2 }, width: expect.closeTo(0.3, 9), depth: 0.3, rotation: 0, line: null }]);
    expect(shell.view().activeTool).toBe("column"); // the tool stays
  });

  it("the ghost before the click shows the same rectangle as the committed column's body", () => {
    const shell = columnTool();
    const at: Point = { x: 2.43, y: 1.27 };
    shell.moveTo(at);
    const [ghost, ...more] = ghosts(shell);
    expect(more).toEqual([]);
    expect(ghost?.color).toBe(COLORS.preview);
    shell.click(at);
    const body = wallBodies(shell.doc()).get("id1/w0");
    expect(body).toBeDefined();
    expect(ghost?.points).toEqual(body);
  });

  it("the ghost is red over a wall body (free contact refused), and a click there toasts and places nothing", () => {
    const shell = columnTool();
    shell.moveTo({ x: 0.2, y: 2 }); // x 0.05–0.35: into the west wall's face at 0.1
    const [ghost] = ghosts(shell);
    expect(ghost?.color).toBe(COLORS.invalidFill);
    expect(ghost?.points.map((p) => p.x).sort()).toEqual([0.05, 0.05, 0.35, 0.35].map((x) => expect.closeTo(x, 9)));
    shell.click({ x: 0.2, y: 2 });
    expect(columns(shell)).toEqual([]);
    expect(shell.view().toast).toBe("This column touches a wall");
  });

  it("the ghost snaps to the snap step", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "setSnapStep", step: 0.1 });
    shell.key("c");
    shell.click({ x: 2.04, y: 1.97 });
    expect(columns(shell)[0]?.centre).toEqual({ x: 2, y: 2 });
  });

  it("a preset changes the next column's size; the last size stays after switching tools", () => {
    const shell = columnTool();
    shell.ui({ type: "setColumnSize", width: "0.40", depth: "0.40" });
    shell.key("v");
    shell.key("c");
    expect(shell.view().columnSize).toEqual({ width: "0.40", depth: "0.40" });
    shell.click({ x: 2, y: 2 });
    expect(columns(shell)[0]).toEqual(expect.objectContaining({ width: expect.closeTo(0.4, 9), depth: 0.4 }));
  });

  it("a typed width or depth sets that side alone; out of range or not a number toasts and keeps the size", () => {
    const shell = columnTool();
    shell.ui({ type: "setColumnSize", depth: "0.4" });
    expect(shell.view().columnSize).toEqual({ width: "0.30", depth: "0.40" });
    shell.ui({ type: "setColumnSize", width: "2.5" });
    expect(shell.view().toast).toContain("0.10–2.00");
    shell.ui({ type: "setColumnSize", width: "abc" });
    expect(shell.view().columnSize).toEqual({ width: "0.30", depth: "0.40" });
    shell.click({ x: 2, y: 2 });
    expect(columns(shell)[0]).toEqual(expect.objectContaining({ width: expect.closeTo(0.3, 9), depth: 0.4, rotation: 0 }));
  });

  it("Esc returns to Select; leaving the canvas drops the ghost", () => {
    const shell = columnTool();
    shell.moveTo({ x: 2, y: 2 });
    shell.send({ type: "pointerLeave" });
    expect(ghosts(shell)).toEqual([]);
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });
});

describe("the Column tool over a wall (AC-13 in line, pillars.42)", () => {
  it("a click over the middle of a 0.20 wall places a column in its line: the wall split in two, the column turned to it", () => {
    const shell = columnTool();
    shell.ui({ type: "setColumnSize", width: "0.30", depth: "0.40" });
    const walls = Object.keys(shell.doc().walls).length;
    shell.click({ x: 6.05, y: 2 }); // over the east wall (x 5.9–6.1), off its centreline
    const [column] = columns(shell);
    expect(column).toEqual({ id: "id1/w0", centre: { x: 6, y: expect.closeTo(2, 9) }, width: expect.closeTo(0.3, 9), depth: 0.4, rotation: 90, line: expect.anything() });
    expect(column?.line).not.toBeNull();
    expect(Object.keys(shell.doc().walls)).toHaveLength(walls + 2); // the column and the second half
  });

  it("the ghost before the click shows the same ring as the committed body, turned to the wall", () => {
    const shell = columnTool();
    shell.ui({ type: "setColumnSize", width: "0.30", depth: "0.40" });
    shell.moveTo({ x: 6.05, y: 2 });
    const [ghost, ...more] = ghosts(shell);
    expect(more).toEqual([]);
    expect(ghost?.color).toBe(COLORS.preview);
    // centred on the centreline x 6, 0.40 across it and 0.30 along it
    expect(ghost?.points.map((p) => p.x).sort()).toEqual([5.8, 5.8, 6.2, 6.2].map((x) => expect.closeTo(x, 9)));
    expect(ghost?.points.map((p) => p.y).sort()).toEqual([1.85, 1.85, 2.15, 2.15].map((y) => expect.closeTo(y, 9)));
    shell.click({ x: 6.05, y: 2 });
    expect(ghost?.points).toEqual(wallBodies(shell.doc()).get("id1/w0"));
  });
});

describe("a column on the plan and in 3D (spec \"Elsewhere\")", () => {
  it("draws in the walls layer as a wall's poché, and is a box from the floor to the ceiling in the 3D items", () => {
    const shell = columnTool();
    const before = shell.scene().layers.find((l) => l.name === "walls")?.primitives.length ?? 0;
    shell.click({ x: 2, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: "id1/w0" }]); // the new column is selected
    shell.key("Escape");
    shell.key("Escape"); // Select, then nothing selected: the column in the plain wall colour
    const walls = shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
    expect(walls.length).toBeGreaterThan(before);
    const body = wallBodies(shell.doc()).get("id1/w0") ?? [];
    const inside = (p: Point): boolean => body.length === 4 && p.x >= 1.85 - 1e-9 && p.x <= 2.15 + 1e-9 && p.y >= 1.85 - 1e-9 && p.y <= 2.15 + 1e-9;
    expect(walls.some((p) => p.kind === "polygon" && p.color === COLORS.wall && p.points.length > 0 && p.points.every(inside))).toBe(true);
    const item = view3dItems(shell.doc(), "s0", null, new Set(), false).find((i) => i.item === "wall" && i.wall === "id1/w0");
    expect(item).toEqual(expect.objectContaining({ item: "wall", bottom: 0, top: 2.5, full: true }));
  });
});
