import { describe, expect, it } from "vitest";
import { motifDefaults, type Document, type Section, type WallSide } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { sectionPicture } from "../../src/view3d/section-picture";
import { mixColour } from "../../src/view/finish/geometry";
import { roomDoc, wallBetween, withCommands } from "../builders";

// Finishes on a section's walls beyond (surfaces step 13, AC-07): the side facing the viewer in its bands' colours, the
// pattern where it isn't too fine at the drawing's scale, a line at the band's top; cut walls as before.

type Polygon = Extract<Primitive, { kind: "polygon" }>;
const SAGE = "#a8b59a";
const tiles = motifDefaults("squareTiles");

/** roomDoc (6 × 4) with the north wall's room side Sage above Square tiles to 1.20. */
function banded(): { doc: Document; north: string } {
  const doc0 = roomDoc();
  const north = wallBetween(doc0, { x: 0, y: 4 }, { x: 6, y: 4 });
  const w = doc0.walls[north];
  const [a, b] = [doc0.joints[w?.a ?? ""], doc0.joints[w?.b ?? ""]];
  if (!a || !b) throw new Error("no joints");
  const side: WallSide = b.x - a.x < 0 ? "left" : "right"; // the room side faces −y: left of a→b when it runs −x
  const doc = withCommands(doc0,
    { type: "setWallFinish", wallId: north, side, part: "finish", finish: { ...motifDefaults("plain"), colour: SAGE } },
    { type: "setWallFinish", wallId: north, side, part: "lower", finish: tiles, height: 1.2 });
  return { doc, north };
}

/** A section across the room at y 1, looking north (toward +y). */
const looking: Section = { id: "A", a: { x: -1, y: 1 }, b: { x: 7, y: 1 }, side: 1, depth: null };
const polygons = (ps: readonly Primitive[]) => ps.flatMap((p): Polygon[] => (p.kind === "polygon" ? [p] : []));
const zsOf = (p: Polygon): number[] => p.points.map((q: Point) => q.y);

describe("finishes in sections (step 13, AC-07)", () => {
  it("the wall beyond shows its tiles below 1.20, a line at 1.20 and its paint above", () => {
    const { doc } = banded();
    const pic = sectionPicture(doc, looking, "s0", CANVAS_STYLE, 70).primitives;
    const lower = polygons(pic).filter((p) => p.color === tiles.colour);
    const upper = polygons(pic).filter((p) => p.color === SAGE);
    expect(lower.length).toBeGreaterThan(0);
    expect(upper.length).toBeGreaterThan(0);
    for (const p of lower) expect(Math.max(...zsOf(p))).toBeCloseTo(1.2, 9);
    for (const p of upper) expect(Math.min(...zsOf(p))).toBeCloseTo(1.2, 9);
    const bandLine = pic.filter((p) => p.kind === "segment" && p.color === CANVAS_STYLE.section.beyondWall && p.a.y === 1.2 && p.b.y === 1.2);
    expect(bandLine.length).toBeGreaterThan(0);
  });

  it("look's style, which draws no floor finishes, still paints the walls beyond (M3 hands-on)", () => {
    const { doc } = banded();
    const pic = sectionPicture(doc, looking, "s0", LOOK_STYLE, 70).primitives;
    expect(polygons(pic).some((p) => p.color === SAGE)).toBe(true);
    expect(polygons(pic).some((p) => p.color === tiles.colour)).toBe(true);
  });

  it("a room's walls default paints the wall beyond with no wall edited (inherit step 02)", () => {
    const doc = withCommands(roomDoc(),
      { type: "labelZone", id: "R", at: { x: 3, y: 2 }, name: "Room", finish: null },
      { type: "setRoomWallFinishes", labelId: "R", part: "finish", finish: { ...motifDefaults("plain"), colour: SAGE } });
    const pic = sectionPicture(doc, looking, "s0", CANVAS_STYLE, 70).primitives;
    expect(polygons(pic).some((p) => p.color === SAGE)).toBe(true);
  });

  it("an unfinished room's section is unchanged", () => {
    const before = sectionPicture(roomDoc(), looking, "s0", CANVAS_STYLE, 70).primitives;
    expect(polygons(before).some((p) => p.color === SAGE || p.color === tiles.colour)).toBe(false);
    expect(polygons(before).some((p) => p.color === CANVAS_STYLE.section.beyond)).toBe(true);
  });

  it("the pattern shows where it isn't too fine at the drawing's scale", () => {
    const { doc } = banded();
    const joints = (zoom: number) => sectionPicture(doc, looking, "s0", PRESENTATION_STYLE, zoom).primitives
      .filter((p) => p.kind === "segment" && p.color === mixColour(tiles.colour, 0.6, tiles.strength)).length; // the tiles' joints
    expect(joints(20)).toBeGreaterThan(0); // 1:50 on paper: 0.30 m tiles are 6 mm apart
    expect(joints(0.5)).toBe(0); // far out: 0.15 mm apart, under 0.8 mm
  });
});
