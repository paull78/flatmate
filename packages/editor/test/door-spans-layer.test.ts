import { describe, expect, it } from "vitest";
import { motifDefaults, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { roomFinishes, spanFinishes } from "../src/view/finish/rooms";
import { CANVAS_STYLE, PRESENTATION_STYLE, planPicture } from "../src/view/picture";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A door's span on the plan (thresholds.01, .04-.06; AC-01 to AC-05): the floor of the room the door swings away from,
// as that room's floor looks in the picture, then a threshold line along the door line.
//
// The 5.8 × 3.8 shell (roomDoc) split at x = 3 by a partition (faces 2.9 and 3.1) with a 0.8 m door at y 1.0–1.8:
// room A on the left labelled "A", room B on the right labelled "B". Swinging "right" it opens into B, so its span
// shows A's floor, x 2.89–3.1, the door line at x 3.1; swinging "left", B's floor, x 2.9–3.11, the line at 2.9.

const PLANKS = motifDefaults("planks");
const TILES = { ...motifDefaults("squareTiles"), colour: "#cfcbc4" };

function rooms(side: "left" | "right", finishes: { a?: object | null; b?: object | null } = { a: PLANKS, b: TILES }, labelled = true): Document {
  const doc = withCommands(roomDoc(), { type: "addWall", opId: "part", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } });
  const wall = wallBetween(doc, { x: 3, y: 0 }, { x: 3, y: 4 });
  const labels: Command[] = labelled
    ? [
        { type: "labelZone", id: "A", at: { x: 1.5, y: 2.5 }, name: "A", finish: (finishes.a ?? null) as never },
        { type: "labelZone", id: "B", at: { x: 4.5, y: 2.5 }, name: "B", finish: (finishes.b ?? null) as never },
      ]
    : [];
  return withCommands(doc, { type: "addOpening", opId: "d", wall, kind: "swing", offset: 1, width: 0.8, side }, ...labels);
}

const openings = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "openings")?.primitives ?? [];
const pointsOf = (p: Primitive): readonly Point[] => (p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "arc" ? [p.center] : p.kind === "text" ? [p.at] : [p.center]);
const inX = (p: Primitive, x0: number, x1: number): boolean => pointsOf(p).every((q) => q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && q.y >= 1 - 1e-6 && q.y <= 1.8 + 1e-6);
const spanPolys = (ps: readonly Primitive[], color: string, x0: number, x1: number) => ps.filter((p) => p.kind === "polygon" && p.color === color && inX(p, x0, x1));
const collinear = (l: Extract<Primitive, { kind: "segment" }>, m: { a: Point; b: Point }): boolean => {
  const c = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  return Math.abs(c(m.a, m.b, l.a)) < 1e-6 && Math.abs(c(m.a, m.b, l.b)) < 1e-6;
};

describe("a door's span on the canvas (AC-01, AC-02)", () => {
  it("swinging into B, the span shows A's planks, its joints running on from A's, nothing past the door line, the threshold on B's face", () => {
    const doc = rooms("right");
    const ps = openings(FakeShell.withDocument(doc));
    expect(spanPolys(ps, PLANKS.colour, 2.89, 3.1)).toHaveLength(1);
    const aLines = roomFinishes(doc).find((r) => r.id === "A")?.geometry.lines ?? [];
    const spanLines = ps.filter((p): p is Extract<Primitive, { kind: "segment" }> => p.kind === "segment" && p.color !== CANVAS_STYLE.openingLine && inX(p, 2.89, 3.1));
    expect(spanLines.length).toBeGreaterThan(0);
    for (const l of spanLines) expect(aLines.some((m) => collinear(l, m))).toBe(true);
    expect(ps.some((p) => p.kind !== "arc" && p.kind !== "segment" && pointsOf(p).some((q) => q.x > 3.1 + 1e-6 && q.y > 1 && q.y < 1.8) && p.kind === "polygon" && p.color === PLANKS.colour)).toBe(false);
    const threshold = ps.find((p) => p.kind === "segment" && p.color === CANVAS_STYLE.openingLine && Math.abs(p.a.x - 3.1) < 1e-9 && Math.abs(p.b.x - 3.1) < 1e-9);
    expect(threshold).toBeDefined();
  });

  it("swinging into A, the span shows B's tiles", () => {
    const ps = openings(FakeShell.withDocument(rooms("left")));
    expect(spanPolys(ps, TILES.colour, 2.9, 3.11)).toHaveLength(1);
    expect(spanPolys(ps, PLANKS.colour, 2.89, 3.11)).toEqual([]);
  });
});

describe("unfinished and unlabelled rooms, the switch and paper (AC-03, AC-04)", () => {
  it("an unfinished labelled room: the room's blue on the canvas; on paper white", () => {
    const doc = rooms("right", { a: null, b: null });
    expect(spanPolys(openings(FakeShell.withDocument(doc)), CANVAS_STYLE.openingFloor, 2.89, 3.1)).toHaveLength(1);
    const paper = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 10, true).openings; // 1:100: no frames
    expect(spanPolys(paper, PRESENTATION_STYLE.openingFloor, 2.89, 3.1)).toHaveLength(1);
  });

  it("an unlabelled room: the canvas background", () => {
    const ps = FakeShell.withDocument(rooms("right", {}, false)).simpleScene().layers.find((l) => l.name === "openings")?.primitives ?? [];
    expect(spanPolys(ps, COLORS.background, 2.89, 3.1)).toHaveLength(1);
    expect(spanPolys(ps, CANVAS_STYLE.openingFloor, 2.89, 3.11)).toEqual([]);
  });

  it("the Finishes switch off shows the room's blue; an export Without, white", () => {
    const doc = rooms("right");
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setFinishesOn", on: false });
    expect(spanPolys(openings(shell), CANVAS_STYLE.openingFloor, 2.89, 3.1)).toHaveLength(1);
    const without = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 10, false).openings; // 1:100: no frames
    expect(spanPolys(without, PRESENTATION_STYLE.openingFloor, 2.89, 3.1)).toHaveLength(1);
  });

  it("a room too large for its pattern shows its colour alone in the span", () => {
    const fine = { ...motifDefaults("mosaic"), size: 0.02 }; // room A, 2.8 × 3.8 m: about 26,600 cells, over the cap
    const doc = rooms("right", { a: fine, b: TILES });
    expect(roomFinishes(doc).find((r) => r.id === "A")?.geometry.tooFine).toBe(true);
    const ps = openings(FakeShell.withDocument(doc));
    expect(spanPolys(ps, fine.colour, 2.89, 3.1)).toHaveLength(1);
    expect(ps.filter((p) => p.kind === "segment" && p.color !== CANVAS_STYLE.openingLine && inX(p, 2.89, 3.1))).toEqual([]);
  });
});

describe("selection, hover and drags", () => {
  it("hovering or selecting room A with the Zone tool leaves the openings layer the same", () => {
    const shell = FakeShell.withDocument(rooms("right"));
    const before = openings(shell);
    shell.key("z");
    shell.moveTo({ x: 1.5, y: 2 });
    shell.click({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "A" }]);
    expect(openings(shell)).toBe(before);
  });

  it("a selected door's threshold line is the selection blue", () => {
    const shell = FakeShell.withDocument(rooms("right"));
    shell.click({ x: 3, y: 1.4 });
    expect(shell.state.selection).toEqual([{ table: "openings", id: "d/d0" }]);
    expect(openings(shell).some((p) => p.kind === "segment" && p.color === COLORS.wallSelected && Math.abs(p.a.x - 3.1) < 1e-9 && Math.abs(p.b.x - 3.1) < 1e-9)).toBe(true);
  });

  it("a furniture drag re-tiles no span: the span geometry is the same object between frames", () => {
    const shell = FakeShell.withDocument(withCommands(rooms("right"), { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 4.5, y: 3.2 } }));
    const before = spanFinishes(shell.doc())[0]?.geometry;
    expect(before).toBeDefined();
    shell.moveTo({ x: 4.5, y: 3 });
    shell.down({ x: 4.5, y: 3 });
    shell.moveTo({ x: 4.7, y: 2.9 });
    shell.scene();
    const doc = shell.state.tool.name === "select" && shell.state.tool.state.kind === "moving" ? shell.state.tool.state.attempt.doc : null;
    expect(doc).not.toBeNull();
    if (doc) expect(spanFinishes(doc)[0]?.geometry).toBe(before);
  });
});
