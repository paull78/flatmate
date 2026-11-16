import { describe, expect, it } from "vitest";
import { levelOf, wallOutlines, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CANVAS_STYLE, planPicture, PRESENTATION_STYLE, type PlanStyle } from "../src/view/picture";
import { viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { LOFT_ROOM_LOFT, loftRoomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Walls and columns on the plan by their range against the viewed level's cut (spec "On the plan", spec: levels, pillars.10;
// AC-12). loftRoomDoc: ceiling 3.05, floor cut 1.20, the Loft at 2.15 (underside 2.03; its cut 2.60). A post under the
// loft (0.00–2.03), a post on it (2.15–3.05), a knee wall on it (2.15–3.05, top 0.90 from its base) and a free 1.00 m
// partition on the floor (0.00–1.00).

const UNDER = "u/w0";
const ON = "o/w0";
const KNEE = "K";
const LOW = "low/w0";

function postsDoc(): Document {
  const doc = withCommands(loftRoomDoc(),
    { type: "placeColumn", opId: "u", at: { x: 2.4, y: 1.6 }, width: 0.2, depth: 0.2, top: LOFT_ROOM_LOFT },
    { type: "placeColumn", opId: "o", at: { x: 3.5, y: 3 }, width: 0.2, depth: 0.2, base: LOFT_ROOM_LOFT },
    { type: "addWall", opId: "low", from: { at: { x: 4.5, y: 0.8 } }, to: { at: { x: 5.5, y: 0.8 } } },
    { type: "setWallTop", wallId: LOW, top: 1 });
  // The Wall tool draws on a deck in a later step: the knee wall is written as a row, along the loft's open edge.
  return {
    ...doc,
    joints: { ...doc.joints, Ka: { id: "Ka", x: 1.6, y: 2 }, Kb: { id: "Kb", x: 1.6, y: 3.5 } },
    walls: { ...doc.walls, [KNEE]: { id: KNEE, a: "Ka", b: "Kb", thickness: 0.1, top: 0.9, base: LOFT_ROOM_LOFT, column: false } },
  };
}

type Segment = Extract<Primitive, { kind: "segment" }>;
const segments = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const same = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
const outline = (doc: Document, id: string): readonly Point[] => wallOutlines(doc).get(id) ?? [];
/** Whether the walls draw `id` filled: a polygon on its outline. */
const filled = (ps: readonly Primitive[], ring: readonly Point[]): boolean =>
  ps.some((p) => p.kind === "polygon" && p.points.length === ring.length && p.points.every((q, i) => same(q, ring[i] ?? q)));
/** The segments drawn along the ring's edges, from each corner to the next. */
const along = (ps: readonly Primitive[], ring: readonly Point[]): Segment[] =>
  ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return segments(ps).filter((s) => same(s.a, a) && same(s.b, b));
  });
const px = (s: Segment): number => ("px" in s.width ? s.width.px : Number.NaN);

/** The dashed outline of a thing wholly above the cut (heights.15): every edge, the style's dash and width, no fill. */
function expectDashed(ps: readonly Primitive[], ring: readonly Point[], style: PlanStyle): void {
  expect(filled(ps, ring)).toBe(false);
  const edges = along(ps, ring);
  expect(edges).toHaveLength(ring.length);
  for (const s of edges) expect([s.dash, px(s)]).toEqual([style.aboveDash, style.aboveWidth]);
}

const floorPicture = (doc: Document, style: PlanStyle) => planPicture(doc, viewAt("s0", levelOf(doc, null)), style, 80, true);
const loftPicture = (doc: Document) => planPicture(doc, viewAt("s0", levelOf(doc, LOFT_ROOM_LOFT)), CANVAS_STYLE, 80, true);

describe("walls and columns against the viewed level's cut (AC-12)", () => {
  it("at the floor, a post on the loft and a knee wall on it draw as dashed outlines with no fill", () => {
    const doc = postsDoc();
    const { walls } = floorPicture(doc, CANVAS_STYLE);
    expectDashed(walls, outline(doc, ON), CANVAS_STYLE);
    expectDashed(walls, outline(doc, KNEE), CANVAS_STYLE);
  });

  it("at the floor, a post under the loft draws filled, and a 1.00 partition keeps its thin outline", () => {
    const doc = postsDoc();
    const { walls } = floorPicture(doc, CANVAS_STYLE);
    expect(filled(walls, outline(doc, UNDER))).toBe(true);
    expect(filled(walls, outline(doc, LOW))).toBe(false);
    const low = along(walls, outline(doc, LOW));
    expect(low).toHaveLength(4);
    for (const s of low) expect([s.dash, px(s)]).toEqual([undefined, CANVAS_STYLE.projectionWidth]);
  });

  it("the paper picture (PDF, SVG, PNG) dashes them in its own style", () => {
    const doc = postsDoc();
    const { walls } = floorPicture(doc, PRESENTATION_STYLE);
    expectDashed(walls, outline(doc, ON), PRESENTATION_STYLE);
    expect(filled(walls, outline(doc, UNDER))).toBe(true);
  });

  it("at the loft's level the post on it draws filled and the post under it as a ghost", () => {
    const doc = postsDoc();
    const { walls, ghosts } = loftPicture(doc);
    expect(filled(walls, outline(doc, ON))).toBe(true);
    expect(filled(walls, outline(doc, UNDER))).toBe(false);
    expect(along(walls, outline(doc, UNDER))).toEqual([]);
    const ghost = along(ghosts, outline(doc, UNDER));
    expect(ghost).toHaveLength(4);
    for (const s of ghost) expect([s.color, px(s), s.dash]).toEqual([CANVAS_STYLE.ghost.line, CANVAS_STYLE.ghost.width, undefined]);
  });

  it("at the loft's level the knee wall crosses its cut and draws filled", () => {
    const doc = postsDoc();
    expect(filled(loftPicture(doc).walls, outline(doc, KNEE))).toBe(true);
  });

  it("at the loft's level a 0.40 knee wall, below its cut (2.15–2.55 under 2.60), draws a thin outline; dashed at the floor", () => {
    const doc = withCommands(postsDoc(), { type: "setWallTop", wallId: KNEE, top: 0.4 });
    const ring = outline(doc, KNEE);
    const { walls } = loftPicture(doc);
    expect(filled(walls, ring)).toBe(false);
    const edges = along(walls, ring);
    expect(edges).toHaveLength(4);
    for (const s of edges) expect([s.dash, px(s)]).toEqual([undefined, CANVAS_STYLE.projectionWidth]);
    expectDashed(floorPicture(doc, CANVAS_STYLE).walls, ring, CANVAS_STYLE);
  });
});

describe("a knee wall drawn with the Wall tool at the loft's level (Try it step 5, AC-12)", () => {
  /** Draws a wall along the loft's open south edge (y 1.4) at the loft's level, then selects it there. */
  function drawnKnee(): { shell: FakeShell; id: string } {
    const shell = FakeShell.withDocument(loftRoomDoc());
    shell.ui({ type: "setSnapStep", step: 0.01 });
    shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    const before = shell.doc();
    shell.key("w");
    shell.click({ x: 1.4, y: 1.5 });
    shell.click({ x: 3.6, y: 1.5 });
    shell.key("Escape");
    shell.key("Escape");
    const id = Object.keys(shell.doc().walls).find((w) => !before.walls[w]) ?? "";
    shell.click({ x: 2.5, y: 1.5 });
    expect(shell.state.selection).toEqual([{ table: "walls", id }]);
    return { shell, id };
  }
  const field = (shell: FakeShell, id: string) => {
    const props = shell.view().properties;
    return props.kind === "wall" ? props.fields.find((f) => f.id === id) : undefined;
  };

  it("reads Base Loft and Top 0.90 above it; To ceiling off keeps 0.90; Top 0.40 makes it a knee wall below the loft's cut", () => {
    const { shell, id } = drawnKnee();
    expect(shell.doc().walls[id]).toEqual(expect.objectContaining({ base: LOFT_ROOM_LOFT, top: "ceiling" }));
    expect(field(shell, "base")?.value).toBe("Loft");
    expect(field(shell, "top")?.value).toBe("0.90");
    shell.ui({ type: "setField", fieldId: "toCeiling", value: "false" });
    expect(shell.doc().walls[id]?.top).toBe(0.9);
    expect(field(shell, "top")).toEqual(expect.objectContaining({ value: "0.90", readOnly: false }));
    shell.ui({ type: "setField", fieldId: "top", value: "0.40" });
    const doc = shell.doc();
    expect(doc.walls[id]?.top).toBe(0.4);
    const ring = outline(doc, id);
    expectDashed(floorPicture(doc, CANVAS_STYLE).walls, ring, CANVAS_STYLE);
    expect(filled(loftPicture(doc).walls, ring)).toBe(false);
    expect(along(loftPicture(doc).walls, ring)).toHaveLength(4);
  });
});
