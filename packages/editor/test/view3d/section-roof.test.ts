import { describe, expect, it } from "vitest";
import { CEILING_ID, pointInPolygon, type Ceiling, type Document, type Section } from "@fm/domain";

import { CANVAS_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { SECTION_BAND } from "../../src/view3d/section-cut";
import { sectionBounds, sectionPicture, type SectionPicture } from "../../src/view3d/section-picture";
import { roomDoc } from "../builders";

// A section under a slope (roofs.14; AC-10): the cut follows the sloped ceiling and draws the roof's band with its
// overhang; the walls past the cut take their sloped tops; the frame holds everything. roomDoc's outer box is
// −0.1…6.1 × −0.1…4.1; a cut across it at x 3, from y −1 to 5, runs along the slope of a shed falling −y.

const roofed = (c: Omit<Ceiling, "id">): Document => ({ ...roomDoc(), ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const across: Section = { id: "A", a: { x: 3, y: -1 }, b: { x: 3, y: 5 }, side: 1, depth: null };
const INK = CANVAS_STYLE.section;
type Polygon = Extract<Primitive, { kind: "polygon" }>;
const polygons = (p: SectionPicture, color: string): Polygon[] => p.primitives.flatMap((q) => (q.kind === "polygon" && q.color === color ? [q] : []));
const filled = (p: SectionPicture, color: string, x: number, z: number): boolean =>
  polygons(p, color).some((q) => [q.points, ...q.holes].filter((r) => pointInPolygon({ x, y: z }, r)).length % 2 === 1);
const dark = (p: SectionPicture, x: number, z: number): boolean => filled(p, INK.cut, x, z);
const T = Math.tan((10 * Math.PI) / 180);
/** The ceiling of the shed falling −y over the line: x is the distance from y −1, so y = x − 1 and the low face is at x 0.9. */
const shedAt = (x: number): number => 2.5 + T * (x - 0.9);

describe("a section across a shed", () => {
  const doc = roofed({ height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 });
  const p = sectionPicture(doc, across, "s0", CANVAS_STYLE, 70);

  it("cuts the walls up to the slope: dark just under the ceiling at each wall, light just over it", () => {
    for (const x of [0.95, 5.05]) { // in the low wall (y −0.1…0.1) and the high wall (y 3.9…4.1)
      expect(dark(p, x, shedAt(x) - 0.01)).toBe(true);
      expect(dark(p, x, shedAt(x) + SECTION_BAND + 0.02)).toBe(false);
    }
  });

  it("draws the roof's band over the room, following the slope, with the overhang past each wall", () => {
    for (const x of [2, 3.5]) {
      expect(dark(p, x, shedAt(x) + SECTION_BAND / 2)).toBe(true);
      expect(dark(p, x, shedAt(x) - 0.05)).toBe(false); // the room under it
    }
    expect(dark(p, 0.7, shedAt(0.7) + SECTION_BAND / 2)).toBe(true); // 0.2 m past the low wall's outer face: the overhang
    expect(dark(p, 0.4, shedAt(0.4) + SECTION_BAND / 2)).toBe(false); // past the overhang's 0.30
  });

  it("frames the highest ceiling and its band", () => {
    expect(sectionBounds(doc, across).max.y).toBeGreaterThanOrEqual(2.5 + T * 4.2 + SECTION_BAND);
  });
});

describe("a section across a gable", () => {
  const doc = roofed({ height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3 });
  const p = sectionPicture(doc, across, "s0", CANVAS_STYLE, 70);
  const ridge = 2.3 + Math.tan((35 * Math.PI) / 180) * 2.1;

  it("marks the eaves and the ridge where the line crosses the house, not past it", () => {
    const marks = p.primitives.flatMap((q) => (q.kind === "text" ? [q.text] : []));
    expect(marks).toEqual(expect.arrayContaining(["+2.30", "+3.77"]));
    expect(marks.some((t) => t.startsWith("+1."))).toBe(false);
  });

  it("has its band's apex on the ridge, over the room's middle", () => {
    expect(dark(p, 3, ridge + SECTION_BAND / 2)).toBe(true);
    expect(dark(p, 3, ridge - 0.05)).toBe(false);
  });

  it("the end wall beyond the cut shows its gable: filled under the ridge, empty over the eaves", () => {
    const beyond = polygons(p, INK.beyond).flatMap((q) => q.points);
    for (const pt of beyond) expect(pt.y).toBeLessThanOrEqual(ridge + 1e-6);
    expect(filled(p, INK.beyond, 3, 2.9)).toBe(true); // under the ridge (y 2)
    expect(filled(p, INK.beyond, 1.2, 2.9)).toBe(false); // y 0.2: the slope there is at 2.51
  });
});

describe("a flat drawing's section", () => {
  it("is unchanged by a stored flat shape", () => {
    const plain = sectionPicture(roomDoc(), across, "s0", CANVAS_STYLE, 70);
    const flat = sectionPicture(roofed({ height: 2.5, shape: "flat" }), across, "s0", CANVAS_STYLE, 70);
    expect(flat).toEqual(plain);
  });
});

