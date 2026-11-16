import { describe, expect, it } from "vitest";
import { anchorAtMm, footprintQuad, footprints, levelOf, pointInPolygon, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "../src/snapping/contact";
import { COLORS } from "../src/view/colors";
import { ghostPrimitives, objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { clearRoomDoc, withCommands, ON_FLOOR } from "./builders";
import { FakeShell } from "./fake-shell";
import { floorView } from "../src/view/plan-view";

// Gestures by shape (shapefit.01): the Object tool, a Select drag and a duplicate accept a chair in a round table's
// empty corner, a click selects a shaped piece only inside its shape, and the selected and red fills draw the shape.
// The room's clear floor is x, y 0.1 … 3.9; the 0.90 round table is centred at (2, 2), its square x, y 1.55 … 2.45.
// A 0.45 chair at 45° on the table's top-left diagonal faces it; Ctrl keeps guides and contact out of the way.

const CHAIR = 0.45;
const place = (opId: string, kind: string, at: Point, rotation = 0, size?: { w: number; d: number }): Command => ({
  type: "placeObject", deck: null, opId, state: "s0", object: size ? { kind, size } : { kind }, at, rotation,
});

/** The centre of a chair on the table's top-left diagonal, its front edge `gap` from the table's centre. */
const leftCentre = (gap: number): Point => {
  const c = (gap + CHAIR / 2) * Math.SQRT1_2;
  return { x: 2 - c, y: 2 + c };
};
const rightCentre = (gap: number): Point => {
  const c = (gap + CHAIR / 2) * Math.SQRT1_2;
  return { x: 2 + c, y: 2 + c };
};

function tableDoc(): Document {
  return withCommands(clearRoomDoc(3.8, 3.8, "r"), place("table", "roundTable", { x: 2, y: 2.45 }));
}

/** The table and a chair at 45° whose centre is `centre`. */
function withChair(centre: Point): Document {
  return withCommands(tableDoc(), place("chairA", "chair", anchorAtMm(centre, CHAIR, 45), 45));
}

const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const fills = (ps: readonly Primitive[], color: string): number[] =>
  ps.flatMap((p) => (p.kind === "polygon" && p.color === color ? [p.points.length] : [])).sort((a, b) => a - b);
const chairsAt = (shell: FakeShell) => Object.values(shell.doc().placements).filter((p) => shell.doc().objects[p.object]?.kind === "chair");

/** The Object tool armed with Chair at a 45° start angle, or `rotation` (R turns by 90°: a fixture rotation). */
function chairTool(doc: Document, rotation = 45): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind: "chair" });
  const t = shell.state.tool;
  if (t.name !== "object") throw new Error("not the Object tool");
  shell.state = { ...shell.state, tool: { name: "object", state: { ...t.state, rotation } } };
  return shell;
}

describe("gestures fit by shape (shapefit.01, AC-03)", () => {
  it("the premise: a chair 2 cm off the circle lies inside the table's square", () => {
    const [f0, f1] = footprintQuad(anchorAtMm(leftCentre(0.47), CHAIR, 45), CHAIR, CHAIR, 45); // the front edge
    const square = footprints(tableDoc()).get("table/p0") ?? [];
    if (!f0 || !f1) throw new Error("no front edge");
    expect(pointInPolygon({ x: (f0.x + f1.x) / 2, y: (f0.y + f1.y) / 2 }, square)).toBe(true);
  });

  it("the Object tool places a chair at 45° in a round table's empty corner", () => {
    const shell = chairTool(tableDoc());
    shell.moveTo(leftCentre(0.47), { ctrl: true });
    const ghost = shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null;
    expect(ghost).toMatchObject({ kind: "chair", rotation: 45, fits: true });
    shell.click(leftCentre(0.47), { ctrl: true });
    expect(chairsAt(shell)).toEqual([expect.objectContaining({ rotation: 45 })]);
  });

  it("the Object tool's ghost on the circle is red and its click is refused", () => {
    // Backrest first (225°: the same square, its back edge toward the table), so the tuck rule doesn't let it under
    // (seating.14) and the circle alone refuses it.
    const shell = chairTool(tableDoc(), 225);
    shell.moveTo(leftCentre(0.42), { ctrl: true });
    const ghost = shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null;
    expect(ghost?.fits).toBe(false);
    shell.click(leftCentre(0.42), { ctrl: true });
    expect(chairsAt(shell)).toEqual([]);
  });

  it("a Select drag of a chair into the table's empty corner is accepted", () => {
    const shell = FakeShell.withDocument(withChair({ x: 0.7, y: 0.7 }));
    shell.drag({ x: 0.7, y: 0.7 }, rightCentre(0.47), { ctrl: true });
    const [chair] = chairsAt(shell);
    expect(chair?.rotation).toBe(45);
    const want = anchorAtMm(rightCentre(0.47), CHAIR, 45);
    expect(Math.abs((chair?.at.x ?? NaN) - want.x)).toBeLessThanOrEqual(0.0011); // the drag keeps the anchor to the mm
    expect(Math.abs((chair?.at.y ?? NaN) - want.y)).toBeLessThanOrEqual(0.0011);
  });

  it("a Select drag of a chair onto the circle is refused", () => {
    const shell = FakeShell.withDocument(withChair({ x: 0.7, y: 0.7 }));
    shell.drag({ x: 0.7, y: 0.7 }, rightCentre(0.42), { ctrl: true });
    expect(chairsAt(shell)[0]?.at).toEqual(anchorAtMm({ x: 0.7, y: 0.7 }, CHAIR, 45));
  });

  it("a duplicate ghost in the empty corner fits", () => {
    const shell = FakeShell.withDocument(withChair(leftCentre(0.47)));
    shell.click(leftCentre(0.47));
    expect(shell.state.selection).toEqual([{ table: "placements", id: "chairA/p0" }]);
    shell.key("d", { meta: true });
    const ok = () => (shell.state.tool.name === "select" && shell.state.tool.state.kind === "copying" ? shell.state.tool.state.attempt.ok : null);
    shell.moveTo(rightCentre(0.47), { ctrl: true });
    expect(ok()).toBe(true);
    shell.moveTo(rightCentre(0.42), { ctrl: true });
    expect(ok()).toBe(false);
  });

  it("touch to turn takes a round table's turn when its circle fits, though its square doesn't", () => {
    // A 0.12 block in the corner of the square the table takes flush on the bottom face (x 1.55 … 2.45, y 0.1 … 1.0),
    // 0.33 … 0.45 out on both axes from its centre (2, 0.55): outside the circle, inside the square.
    const doc = withCommands(clearRoomDoc(3.8, 3.8, "r"), place("block", "block", { x: 2.39, y: 1 }, 0, { w: 0.12, d: 0.12 }));
    const turned = contactPlace(doc, "s0", { w: 0.9, d: 0.9 }, { x: 2, y: 0.6 }, 90, { tolerance: 0.125, free: false, kind: "roundTable", riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(doc, null) });
    expect(turned).toEqual({ at: { x: 2, y: 0.1 }, rotation: 180, flushWalls: ["r-1/w0"] });
    // A wardrobe-sized rectangle at the same place doesn't fit: it keeps its angle.
    const kept = contactPlace(doc, "s0", { w: 0.9, d: 0.9 }, { x: 2, y: 0.6 }, 90, { tolerance: 0.125, free: false, kind: "block", riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(doc, null) });
    expect(kept.rotation).toBe(90);
  });
});

describe("the click and the fills follow the shape (shapefit.01, AC-07)", () => {
  it("a click in the round table's square outside the circle doesn't select it", () => {
    const shell = FakeShell.withDocument(tableDoc());
    shell.click({ x: 2.4, y: 2.4 });
    expect(shell.state.selection).toEqual([]);
    shell.click({ x: 2.2, y: 2.2 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "table/p0" }]);
  });

  it("the selected round table fills its circle; a wardrobe its rectangle", () => {
    const doc = withCommands(tableDoc(), place("wardrobe", "wardrobe", { x: 2, y: 3.9 }));
    const picked = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "table/p0\nwardrobe/p0", 80);
    expect(fills(picked, COLORS.objectSelected)).toEqual([4, 32]);
  });

  it("the red ghost fills the circle", () => {
    const red = ghostPrimitives({ kind: "roundTable", config: "standard", w: 0.9, d: 0.9, at: { x: 2, y: 2.45 }, rotation: 0, fits: false });
    expect(fills(red, COLORS.invalidFill)).toEqual([32]);
  });

  it("a refused drag fills the circle: the dragged table and a table it hits", () => {
    const moved = FakeShell.withDocument(tableDoc());
    moved.moveTo({ x: 2, y: 2 });
    moved.down({ x: 2, y: 2 });
    moved.moveTo({ x: 2, y: 1 }, { ctrl: true });
    moved.moveTo({ x: 2, y: 0.3 }, { ctrl: true }); // across the bottom wall
    expect(fills(overlays(moved), COLORS.invalidFill)).toEqual([32]);

    const hit = FakeShell.withDocument(withChair({ x: 0.7, y: 0.7 }));
    hit.moveTo({ x: 0.7, y: 0.7 });
    hit.down({ x: 0.7, y: 0.7 });
    hit.moveTo({ x: 1.2, y: 1.2 }, { ctrl: true });
    hit.moveTo(rightCentre(0.42), { ctrl: true });
    expect(fills(overlays(hit), COLORS.invalidFill)).toEqual([4, 32]);
  });
});

describe("a guide never pulls a fitting piece onto another (shapefit.08)", () => {
  it("without Ctrl, the Object tool's chair in the table's empty corner stays green and places", () => {
    const shell = chairTool(tableDoc());
    shell.moveTo(leftCentre(0.47));
    const ghost = shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null;
    expect(ghost).toMatchObject({ kind: "chair", rotation: 45, fits: true });
    shell.click(leftCentre(0.47));
    expect(chairsAt(shell)).toHaveLength(1);
  });

  it("without Ctrl, a chair dragged into the other empty corner lands there", () => {
    const shell = FakeShell.withDocument(withChair(leftCentre(0.6)));
    shell.click(leftCentre(0.6));
    shell.drag(leftCentre(0.6), rightCentre(0.47));
    const [chair] = chairsAt(shell);
    const c = chair ? footprintQuad(chair.at, CHAIR, CHAIR, chair.rotation) : [];
    const mid = c[0] && c[2] ? { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 } : null;
    expect(mid && mid.x > 2).toBe(true); // it moved to the right-hand corner, not refused back to the left
  });
});
