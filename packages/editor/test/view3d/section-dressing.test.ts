import { describe, expect, it } from "vitest";
import { pointInPolygon, type Document, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CANVAS_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { sectionPicture } from "../../src/view3d/section-picture";
import { roomDoc, wallBetween, withCommands } from "../builders";

// A window's dressing in a section beyond (hangings step 05, AC-08): the box and the sheer's strips over the window,
// seen from its room; from outside the wall hides them. The window is on the north wall (y 4) at x 2.5–3.5, sill 0.9,
// head 2.1, with a box (2.10–2.35) and a sheer to the floor (0–2.35).

type Polygon = Extract<Primitive, { kind: "polygon" }>;
const INK = CANVAS_STYLE.section;
const cutting = (a: Point, b: Point): Section => ({ id: "A", a, b, side: 1, depth: null });
const shapes = (doc: Document, s: Section): Polygon[] => sectionPicture(doc, s, "s0", CANVAS_STYLE, 70).primitives.flatMap((q) => (q.kind === "polygon" ? [q] : []));
/** The shape drawn last at (x, z), an outline's ring counting by its holes. */
const topAt = (ps: readonly Polygon[], x: number, z: number): Polygon | undefined =>
  ps.filter((q) => [q.points, ...q.holes].filter((r) => pointInPolygon({ x, y: z }, r)).length % 2 === 1).at(-1);

function dressed(dressing: boolean): Document {
  const doc = roomDoc();
  const wall = wallBetween(doc, { x: 0, y: 4 }, { x: 6, y: 4 });
  const ax = doc.joints[doc.walls[wall]?.a ?? ""]?.x ?? 0;
  return withCommands(doc, { type: "addOpening", opId: "w", wall, kind: "window", offset: ax === 0 ? 2.5 : ax - 3.5, width: 1, sill: 0.9, head: 2.1, ...(dressing ? { sheer: "floor" as const, shutterBox: true } : {}) });
}
const fromRoom = cutting({ x: 0, y: 0.5 }, { x: 6, y: 0.5 }); // looking north at the window's room side
const fromOutside = cutting({ x: 6, y: 4.5 }, { x: 0, y: 4.5 }); // looking south at its outside

describe("a window's dressing in a section (step 05, AC-08)", () => {
  it("from the room the box shows over the head and a strip over the glass, white", () => {
    const ps = shapes(dressed(true), fromRoom);
    const box = topAt(ps, 2.6, 2.3); // in a gap between strips (2.58–2.62): the sheer hangs in front of the box
    expect(box?.color).toBe(INK.beyond);
    const xs = box?.points.map((p) => p.x) ?? [];
    const zs = box?.points.map((p) => p.y) ?? [];
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map((v) => Math.round(v * 1000) / 1000)).toEqual([2.5, 3.5, 2.1, 2.35]);
    const covered = [2.6, 2.75, 2.9, 3.05, 3.2, 3.35].map((x) => topAt(ps, x, 1.5)?.color);
    expect(covered).toContain(INK.beyond); // a strip
    expect(covered).toContain(INK.glass); // and a gap, the glass behind
  });

  it("without a dressing the glass shows across the window", () => {
    const ps = shapes(dressed(false), fromRoom);
    expect([2.6, 3, 3.4].map((x) => topAt(ps, x, 1.5)?.color)).toEqual([INK.glass, INK.glass, INK.glass]);
  });

  it("from outside the wall hides them: the same picture as a plain window", () => {
    expect(shapes(dressed(true), fromOutside)).toEqual(shapes(dressed(false), fromOutside));
  });
});
