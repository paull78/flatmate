import { describe, expect, it } from "vitest";
import { kindConfigs, levelOf, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { pieceFlushTargets } from "../src/snapping/faces";
import { alignmentGuides, guideBoxes } from "../src/snapping/guides";
import { pieceFit, type Piece } from "../src/snapping/piece";
import { COLORS } from "../src/view/colors";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { buildScene } from "../src/view/scene";
import { tagObstacles } from "../src/view/tag-spot";
import { labelledDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Placing and dragging over a rug (catalog.15, .24): the ghost, the drag and the commit agree that a piece stands on a
// rug; a rug's faces don't attract other pieces, nor do room tags keep off it. roomDoc: a 6 × 4 room, inner faces x 0.1 /
// 5.9, y 0.1 / 3.9; `at` is the middle of a piece's back edge.

const place = (opId: string, kind: string, at: Point, size?: { w: number; d: number }): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: size ? { kind, size } : { kind }, at });
/** A 2.00 × 1.40 rug or block at x 2–4, y 1.3–2.7, 0.01 m high. */
const sheetDoc = (kind: string): Document => withCommands(roomDoc(), place("r", kind, { x: 3, y: 2.7 }, { w: 2, d: 1.4 }), { type: "setObjectSize", objectId: "r/o0", w: 2, d: { standard: 1.4 }, h: { standard: 0.01 } });
const ghostOf = (shell: FakeShell) => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const overlays = (shell: FakeShell) => buildScene(shell.state).layers.find((l) => l.name === "overlays")?.primitives ?? [];
const reds = (shell: FakeShell) => overlays(shell).filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill);

describe("a piece on a rug (catalog.24)", () => {
  it("the Object tool's sofa over a rug is not red, and a click places it", () => {
    const shell = FakeShell.withDocument(sheetDoc("rug"));
    shell.ui({ type: "pickKind", kind: "sofa" });
    shell.moveTo({ x: 3, y: 2 });
    expect(ghostOf(shell)).toMatchObject({ kind: "sofa", fits: true });
    expect(reds(shell)).toEqual([]);
    shell.click({ x: 3, y: 2 });
    expect(Object.values(shell.doc().placements)).toHaveLength(2);
  });

  it("over a 0.01 m high box of the same footprint the same ghost is red", () => {
    const shell = FakeShell.withDocument(sheetDoc("block"));
    shell.ui({ type: "pickKind", kind: "sofa" });
    shell.moveTo({ x: 3, y: 2 });
    expect(ghostOf(shell)).toMatchObject({ kind: "sofa", fits: false });
    expect(reds(shell).length).toBeGreaterThan(0);
  });

  it("dragging a sofa onto a rug shows no red ghost and commits", () => {
    const doc = withCommands(sheetDoc("rug"), place("s", "sofa", { x: 3, y: 1 }));
    const shell = FakeShell.withDocument(doc);
    const [from, to] = [{ x: 3, y: 0.55 }, { x: 3, y: 2 }];
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo({ x: 3, y: 1.2 });
    shell.moveTo(to);
    expect(reds(shell)).toEqual([]);
    shell.up(to);
    expect(shell.doc().placements["s/p0"]?.at.y).toBeCloseTo(2.4, 6); // from y 1 by the 0.20 m step: its footprint y 1.5–2.4, on the rug
  });

  it("dragging a rug under a sofa commits, and the rug's ghost over a sofa is not red", () => {
    const doc = withCommands(sheetDoc("rug"), place("s", "sofa", { x: 1.2, y: 3.5 }));
    const shell = FakeShell.withDocument(doc);
    const before = shell.doc().placements["r/p0"]?.at;
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 2.5, y: 2.3 });
    shell.moveTo({ x: 2, y: 2.7 });
    expect(reds(shell)).toEqual([]);
    shell.up({ x: 2, y: 2.7 });
    expect(shell.doc().placements["r/p0"]?.at).not.toEqual(before);
  });

  it("pieceFit carries the rug flag: a rug's ghost over a sofa fits; a rug crossing a wall doesn't", () => {
    const doc = withCommands(roomDoc(), place("s", "sofa", { x: 3, y: 2.7 }));
    const level = levelOf(doc, null);
    const piece: Piece = { kind: "rug", config: "standard", riser: null, heights: { h: 0.01, z: 0 }, land: true, current: undefined, level };
    const box: Piece = { ...piece, kind: "block" };
    const size = { w: 2, d: 1.4 };
    expect(pieceFit(doc, "s0", piece, size, { x: 3, y: 2.7 }, 0).fits).toBe(true);
    expect(pieceFit(doc, "s0", box, size, { x: 3, y: 2.7 }, 0).fits).toBe(false);
    expect(pieceFit(doc, "s0", piece, size, { x: 3, y: 4 }, 0).fits).toBe(false);
  });

  it("a rug standing on a platform drags to the floor over a sofa: it lands on the floor (the flag in the landing candidate)", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "addDeck", opId: "deck", preset: "platform", at: { x: 1.6, y: 2 }, w: 3, d: 3 },
      { type: "placeObject", deck: "deck/k0", opId: "r", state: "s0", object: { kind: "rug" }, at: { x: 1.6, y: 2.7 } },
      place("s", "sofa", { x: 4.6, y: 2.7 }),
    );
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 1.6, y: 2 }, { x: 4.6, y: 2 });
    expect(shell.doc().placements["r/p0"]).toMatchObject({ deck: null });
    expect(shell.doc().placements["r/p0"]?.at.x).toBeCloseTo(4.6, 0);
  });
});

describe("a rug's faces attract nothing (the plan's call, kept by test)", () => {
  const level = (doc: Document) => levelOf(doc, null);

  it("the guide boxes leave rugs out, and a block of the same footprint in", () => {
    expect(guideBoxes(sheetDoc("rug"), "s0", new Set(), level(sheetDoc("rug")))).toEqual([]);
    expect(guideBoxes(sheetDoc("block"), "s0", new Set(), level(sheetDoc("block")))).toHaveLength(1);
  });

  it("the Object tool's sofa isn't pulled onto a rug's edge as it is onto a box's", () => {
    // The sofa's left edge lands 0.04 from the sheet's left edge x 2: well inside the 0.125 m tolerance at zoom 80.
    const ghostAt = (kind: string, cursor: Point): Point | null => {
      const shell = FakeShell.withDocument(withCommands(sheetDoc(kind)));
      shell.ui({ type: "pickKind", kind: "armchair" });
      shell.moveTo(cursor);
      return ghostOf(shell)?.at ?? null;
    };
    // Below the sheet, where the armchair fits either way: only the guide can change x. Its left edge is pulled to the box's left edge, x 2.
    const cursor = { x: 2.47, y: 0.8 };
    const width = kindConfigs("armchair")[0]?.w ?? 0;
    expect((ghostAt("block", cursor)?.x ?? 0) - width / 2).toBeCloseTo(2, 6);
    expect((ghostAt("rug", cursor)?.x ?? 0) - width / 2).not.toBeCloseTo(2, 6);
  });

  it("a side grip doesn't flush to a rug's face, and does to a box's", () => {
    const quad = [{ x: 0.5, y: 1.5 }, { x: 1.5, y: 1.5 }, { x: 1.5, y: 2.5 }, { x: 0.5, y: 2.5 }]; // moving its right side towards x 2
    expect(pieceFlushTargets(sheetDoc("rug"), quad, "right", 1.45, 0.125, "s0", new Set())).toEqual([]);
    expect(pieceFlushTargets(sheetDoc("block"), quad, "right", 1.45, 0.125, "s0", new Set()).map((t) => t.tag)).toEqual(["r/p0"]);
  });

  it("a moving rug still aligns to a piece's edges: the rug is the one aligning", () => {
    const doc = withCommands(sheetDoc("rug"), place("s", "wardrobe", { x: 2.6, y: 3.9 })); // x 2–3.2: its left edge on the rug's
    expect(alignmentGuides(doc, ["r/p0"], "s0", level(doc)).length).toBeGreaterThan(0);
    expect(alignmentGuides(doc, ["s/p0"], "s0", level(doc))).toEqual([]);
  });

  it("a room's tag keeps off a box, not off a rug (tag-spot)", () => {
    const obstacles = (kind: string) => tagObstacles(withCommands(labelledDoc(), place("r", kind, { x: 1.5, y: 2.7 }, { w: 1, d: 1 })), "s0", CANVAS_STYLE, 80).length;
    expect(obstacles("block")).toBe(obstacles("rug") + 1);
  });
});
