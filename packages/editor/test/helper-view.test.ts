import { describe, expect, it } from "vitest";
import type { Camera } from "../src/camera";
import { COLORS } from "../src/view/colors";
import { chainBoxes, helperBox, helperLabelAt, outsideBox } from "../src/view/helper";
import type { Primitive } from "../src/view/scene-types";
import { emptyDocument, rectangleRoom, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { dividedRoomDoc, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

const camera = (zoom: number): Camera => ({ center: { x: 3, y: 2 }, zoom, viewport: { width: 1200, height: 800 }, dpr: 1 });

function layer(shell: FakeShell, name: string): readonly Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}
const helperSegments = (shell: FakeShell) =>
  layer(shell, "annotations").flatMap((p) => (p.kind === "segment" && p.color === COLORS.helper ? [p] : []));
/** The helper plate of the selected wall (the box drawn behind the number). */
function plate(shell: FakeShell): { min: Point; max: Point } {
  const ref = shell.state.selection[0];
  const box = ref ? helperBox(shell.state, shell.doc(), ref.id) : null;
  if (!box) throw new Error("no helper");
  return box;
}
/** Whether a segment passes through the open interior of the box (sampled; 1e-9 m tolerance at the edges). */
function crossesInterior(a: Point, b: Point, box: { min: Point; max: Point }): boolean {
  const e = 1e-9;
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > box.min.x + e && x < box.max.x - e && y > box.min.y + e && y < box.max.y - e) return true;
  }
  return false;
}
const helperTexts = (shell: FakeShell) =>
  layer(shell, "annotations").flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p.text] : []));

describe("helper placement (spec: tools)", () => {
  it("centres the text 18 px beyond the wall's room-side face, at the face's middle", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 }); // a = (6, 0): the left of a → b is −x
    const at80 = helperLabelAt(doc, right, camera(80));
    expect(at80?.x).toBeCloseTo(6 - 0.1 - 18 / 80, 9); // 5.675
    expect(at80?.y).toBeCloseTo(2, 9);
    expect(helperLabelAt(doc, right, camera(160))?.x).toBeCloseTo(6 - 0.1 - 18 / 160, 9); // 5.7875
    const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(helperLabelAt(doc, bottom, camera(80))?.y).toBeCloseTo(0.1 + 18 / 80, 9); // 0.325
    expect(helperLabelAt(doc, "missing", camera(80))).toBeNull();
  });
});

describe("helper dimension in the Scene", () => {
  it("shows the selected wall's clear length on a dimension line with end ticks", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    expect(helperTexts(shell)).toEqual(["3.80"]); // a wall without openings: the clear length too (ux-polish.35)
    expect(helperSegments(shell)).toHaveLength(4); // the line in two pieces around the plate, and two ticks
  });

  it("marks the fixed endpoint a with a filled handle", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    const inner = layer(shell, "overlays").flatMap((p) =>
      p.kind === "disc" && "px" in p.radius && p.radius.px === 3.5 ? [[p.center, p.color]] : [],
    );
    expect(inner).toEqual([
      [{ x: 6, y: 0 }, COLORS.handleFixed],
      [{ x: 6, y: 4 }, COLORS.handle],
    ]);
  });

  it("hides the helper outside the Select tool and during a drag", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    shell.key("w"); // the selection stays, the helper does not
    expect(helperTexts(shell)).toEqual([]);

    const dragging = FakeShell.withDocument(roomDoc());
    dragging.click({ x: 6, y: 1 });
    dragging.moveTo({ x: 6, y: 4 });
    dragging.down({ x: 6, y: 4 });
    dragging.moveTo({ x: 6, y: 4.6 }); // a grid point (0.2 m steps at 80 px/m), so the snapped result is exact
    expect(helperTexts(dragging)).toEqual([]);
    dragging.up({ x: 6, y: 4.6 });
    expect(helperTexts(dragging)).toEqual(["4.39"]); // 4.60 on the centre line; the top wall now slopes, so its face meets this one a little lower
  });

  it("stops the dimension line at the label plate, so it does not run through the number (vertical wall)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 }); // the line is 8 px out, the plate spans about 3–33 px out: they overlap
    const box = plate(shell);
    const segments = helperSegments(shell);
    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) expect(crossesInterior(s.a, s.b, box)).toBe(false);
    // The line still covers the face's length outside the plate: two pieces from y = 0.1 to the plate and on to y = 3.9.
    const along = segments.filter((s) => Math.abs(s.a.x - s.b.x) < 1e-9).map((s) => [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)]);
    expect(along).toHaveLength(2);
    expect(along.map(([lo]) => lo).sort()[0]).toBeCloseTo(0.1, 9);
    expect(Math.max(...along.map(([, hi]) => hi ?? 0))).toBeCloseTo(3.9, 9);
  });

  it("draws the dimension line whole when the plate clears it (horizontal wall)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 3, y: 0 });
    expect(helperTexts(shell)).toEqual(["5.80"]);
    const segments = helperSegments(shell);
    expect(segments).toHaveLength(3);
    const line = segments.find((s) => Math.abs(s.a.y - s.b.y) < 1e-9);
    expect(line && Math.abs(line.b.x - line.a.x)).toBeCloseTo(5.8, 9);
  });
});

describe("helper editing looks like a text field (spec: tools, U2)", () => {
  /** The plate polygon's fill and the blue outline segments around it. */
  function field(shell: FakeShell) {
    const box = plate(shell);
    const annotations = layer(shell, "annotations");
    const fills = annotations.flatMap((p) =>
      p.kind === "polygon" && p.points.length === 4 && p.points[0]?.x === box.min.x && p.points[0]?.y === box.min.y ? [p.color] : [],
    );
    const outline = annotations.flatMap((p) => (p.kind === "segment" && p.color === COLORS.wallSelected ? [p] : []));
    return { fills, outline };
  }
  function editRight(): FakeShell {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.click({ x: 6, y: 1 });
    const at = helperLabelAt(shell.doc(), right, shell.state.camera);
    if (!at) throw new Error("no helper");
    shell.click(at);
    return shell;
  }

  it("a selected wall's helper is a plain plate with no outline", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    expect(field(shell)).toEqual({ fills: [COLORS.background], outline: [] });
  });

  it("before the first key: blue outline, selection fill, the current length", () => {
    const shell = editRight();
    const { fills, outline } = field(shell);
    expect(fills).toEqual([COLORS.fieldSelection]);
    expect(outline).toHaveLength(4);
    expect(helperTexts(shell)).toEqual(["3.80"]);
  });

  it("after a key: blue outline, white fill, the typed value; Esc restores the plain plate", () => {
    const shell = editRight();
    shell.key("3");
    const { fills, outline } = field(shell);
    expect(fills).toEqual([COLORS.field]);
    expect(outline).toHaveLength(4);
    expect(helperTexts(shell)).toEqual(["3"]);
    shell.key("Escape");
    expect(field(shell)).toEqual({ fills: [COLORS.background], outline: [] });
  });

  it("the outline is the plate's four sides", () => {
    const shell = editRight();
    const box = plate(shell);
    const corners = field(shell).outline.map((s) => [s.a, s.b]);
    const c = { bl: box.min, br: { x: box.max.x, y: box.min.y }, tr: box.max, tl: { x: box.min.x, y: box.max.y } };
    expect(corners).toEqual([[c.bl, c.br], [c.br, c.tr], [c.tr, c.tl], [c.tl, c.bl]]);
  });
});

// roomDoc's right wall runs from a = (6, 0) to b = (6, 4): 4.00 m, its helper rows on the −x side.
const right = (doc: Document): string => wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
/** The right wall with openings x/d0, y/d0, … at the given offsets (default widths: door 0.80, window 1.00). */
function rightWithOpenings(...openings: { kind: "swing" | "window"; offset: number }[]): Document {
  const doc = roomDoc();
  return withCommands(doc, ...openings.map((o, i) => ({ type: "addOpening" as const, opId: "xyz"[i] ?? "w", wall: right(doc), ...o })));
}
/** The helper texts in rows, nearest the right wall first, each row a → b (bottom to top). */
function rows(shell: FakeShell): string[][] {
  const texts = layer(shell, "annotations").flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p] : []));
  const xs = [...new Set(texts.map((t) => Math.round(t.at.x * 1e6) / 1e6))].sort((p, q) => q - p);
  return xs.map((x) => texts.filter((t) => Math.abs(t.at.x - x) < 1e-6).sort((p, q) => p.at.y - q.at.y).map((t) => t.text));
}

describe("split dimensions on a wall with openings (ux-polish item 2)", () => {
  it("the AC-16 wall shows 3.80 as the total and 1.00, 0.80, 2.00 in the chain, on its room side (AC-16)", () => {
    const shell = FakeShell.withDocument(rightWithOpenings({ kind: "swing", offset: 1.1 }));
    shell.click({ x: 6, y: 0.5 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right(shell.doc()) }]);
    expect(rows(shell)).toEqual([["1.00", "0.80", "2.00"], ["3.80"]]);
    // The chain row's text sits 18 px beyond the room-side face (x = 5.9); the total further out, at the face's middle.
    const texts = layer(shell, "annotations").flatMap((p) => (p.kind === "text" ? [p] : []));
    expect(texts.find((t) => t.text === "1.00")?.at).toEqual({ x: expect.closeTo(6 - 0.1 - 18 / 80, 9), y: expect.closeTo(0.6, 9) });
    const total = texts.find((t) => t.text === "3.80")?.at;
    expect(total?.x).toBeLessThan(6 - 0.1 - 18 / 80);
    expect(total?.y).toBeCloseTo(2, 9);
    expect(helperLabelAt(shell.doc(), right(shell.doc()), shell.state.camera)).toEqual(total);
    // The total's ticks stand at the face's ends, 0.10 in from each joint.
    const totalTicks = helperSegments(shell).filter((s) => Math.abs(s.a.y - s.b.y) < 1e-9 && (s.a.x + s.b.x) / 2 < 6 - 0.1 - 8 / 80 - 1e-6);
    expect(totalTicks.map((s) => Math.round(s.a.y * 1000) / 1000).sort((p, q) => p - q)).toEqual([0.1, 3.9]);
  });

  it("selecting the door draws the same two rows; a wall without openings draws only its clear 3.80 (AC-16)", () => {
    const shell = FakeShell.withDocument(rightWithOpenings({ kind: "swing", offset: 1.1 }));
    shell.click({ x: 6, y: 1.5 });
    expect(shell.state.selection).toEqual([{ table: "openings", id: "x/d0" }]);
    expect(rows(shell)).toEqual([["1.00", "0.80", "2.00"], ["3.80"]]);
    const plain = FakeShell.withDocument(roomDoc());
    plain.click({ x: 6, y: 1.5 });
    expect(rows(plain)).toEqual([["3.80"]]);
  });

  it("an outer wall whose left side faces outside draws its rows on its right; a divider draws them on its left (AC-17)", () => {
    // Clockwise: the right wall runs a = (6, 4) → b = (6, 0), so its left of a → b (+x) is outside and the room is on its right.
    const cw = withCommands(emptyDocument(), ...rectangleRoom({ x: 6, y: 0 }, -6, 4));
    const wall = wallBetween(cw, { x: 6, y: 4 }, { x: 6, y: 0 });
    expect(cw.joints[cw.walls[wall]?.a ?? ""]).toMatchObject({ x: 6, y: 4 });
    const shell = FakeShell.withDocument(withCommands(cw, { type: "addOpening", opId: "x", wall, kind: "swing", offset: 1.1 }));
    shell.click({ x: 6, y: 3.7 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: wall }]);
    const texts = layer(shell, "annotations").flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p] : []));
    const chain = texts.filter((t) => t.text !== "3.80");
    expect(chain.map((t) => t.text)).toEqual(["1.00", "0.80", "2.00"]); // from a, at the top
    for (const t of chain) expect(t.at.x).toBeCloseTo(6 - 0.1 - 18 / 80, 9);
    const total = helperLabelAt(shell.doc(), wall, shell.state.camera);
    expect(texts.find((t) => t.text === "3.80")?.at).toEqual(total);
    expect(total?.x).toBeLessThan(6 - 0.1 - 18 / 80);
    // Clicks land on what is drawn: the total and a piece, on the room side.
    const piece = chainBoxes(shell.state, shell.doc(), wall)[0];
    if (!total || !piece) throw new Error("no helper");
    shell.click(piece.at);
    const t = shell.state.tool;
    expect(t.name === "select" ? t.state : null).toEqual({ kind: "editingHelper", wallId: wall, piece: 0, value: "" });
    shell.key("Escape");
    shell.click(total);
    const u = shell.state.tool;
    expect(u.name === "select" ? u.state : null).toEqual({ kind: "editingHelper", wallId: wall, value: "" });

    // A divider between two rooms: the left of a → b (−x for (3, 0) → (3, 4)).
    const divided = FakeShell.withDocument(dividedRoomDoc());
    const divider = wallBetween(divided.doc(), { x: 3, y: 0 }, { x: 3, y: 4 });
    divided.click({ x: 3, y: 1 });
    expect(divided.state.selection).toEqual([{ table: "walls", id: divider }]);
    expect(helperTexts(divided)).toEqual(["3.80"]);
    const at = helperLabelAt(divided.doc(), divider, divided.state.camera);
    expect(at?.x).toBeCloseTo(3 - 0.1 - 18 / 80, 9);
  });

  it("a 0.05 m piece (a door 0.05 m from the face) at the default zoom keeps its ticks and draws no text", () => {
    const shell = FakeShell.withDocument(rightWithOpenings({ kind: "swing", offset: 0.15 }));
    shell.click({ x: 6, y: 2.5 });
    expect(shell.state.camera.zoom).toBe(80);
    expect(rows(shell)).toEqual([["0.80", "2.95"], ["3.80"]]);
    // The chain row's ticks: across the line 8 px beyond the face, at every piece boundary.
    const lineX = 6 - 0.1 - 8 / 80;
    const ticks = helperSegments(shell).filter((s) => Math.abs(s.a.y - s.b.y) < 1e-9 && Math.abs((s.a.x + s.b.x) / 2 - lineX) < 1e-9);
    expect(ticks.map((s) => Math.round(s.a.y * 1000) / 1000).sort((p, q) => p - q)).toEqual([0.1, 0.15, 0.95, 3.9]);
  });
});

describe("outsideBox", () => {
  const min = { x: 0, y: 0 };
  const max = { x: 2, y: 2 };
  it("returns the pieces of a segment outside an axis-aligned box", () => {
    expect(outsideBox({ x: -1, y: 1 }, { x: 3, y: 1 }, min, max)).toEqual([
      [{ x: -1, y: 1 }, { x: 0, y: 1 }],
      [{ x: 2, y: 1 }, { x: 3, y: 1 }],
    ]); // through: two pieces
    expect(outsideBox({ x: 1, y: 1 }, { x: 3, y: 1 }, min, max)).toEqual([[{ x: 2, y: 1 }, { x: 3, y: 1 }]]); // from inside: one
    expect(outsideBox({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 }, min, max)).toEqual([]); // inside: none
    expect(outsideBox({ x: -1, y: 3 }, { x: 3, y: 3 }, min, max)).toEqual([[{ x: -1, y: 3 }, { x: 3, y: 3 }]]); // clear: whole
    expect(outsideBox({ x: -1, y: 2 }, { x: 3, y: 2 }, min, max)).toEqual([[{ x: -1, y: 2 }, { x: 3, y: 2 }]]); // on an edge: whole
  });
});

describe("the chain at the viewed level (review.09)", () => {
  // The 6 × 4 room under a 3.00 m ceiling, a loft at 2.15 over its west end, and on the east wall a floor window
  // (0.90–2.00, 1.00 wide at offset 1) under a loft-level window (2.30–2.75, 1.20 wide at offset 0.9).
  it("selecting the wall at the floor measures the floor window only, at the loft the loft window only", () => {
    let doc = withCommands(roomDoc(), { type: "setCeiling", height: 3 });
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    doc = withCommands(
      doc,
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4.9, y: 2 }, w: 2, d: 3.8 },
      { type: "addOpening", opId: "low", wall: right, kind: "window", offset: 1, width: 1, sill: 0.9, head: 2 },
      { type: "addOpening", opId: "high", wall: right, kind: "window", offset: 0.9, width: 1.2, sill: 2.3, head: 2.75 },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 6, y: 0.5 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    const widths = () => chainBoxes(shell.state, shell.doc(), right).filter((b) => b.piece.role === "opening").map((b) => b.text);
    expect(widths()).toEqual(["1.00"]);
    shell.ui({ type: "setViewedLevel", deck: "loft/k0" });
    expect(widths()).toEqual(["1.20"]);
  });
});
