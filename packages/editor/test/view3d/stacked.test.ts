import { describe, expect, it } from "vitest";
import { execute, pointInPolygon, unwrap, type Command, type Document, type Section } from "@fm/domain";
import type { Face3d } from "../../src/view3d/faces";
import { CANVAS_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { view3dItems } from "../../src/view3d/items";
import { sectionPicture, type SectionPicture } from "../../src/view3d/section-picture";
import { STYLE_3D } from "../../src/view3d/style";
import type { Point3, WallItem } from "../../src/view3d/types";
import { wallFaces } from "../../src/view3d/wall-faces";
import { roomDoc, wallBetween } from "../builders";

// A window stacked over a door in 3D and in a section (sills step 05, AC-10; sills.04, .09): two holes with wall between
// them (2.10–2.40) and above (2.90–3.05), and the door's threshold whichever opening the wall lists first. The 6 × 4
// room under a 3.05 ceiling; the door at x 2.0–2.8 on its north wall (y = 4, faces at 3.9 and 4.1), the window above it.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const has = (ring: readonly Point3[], p: Point3) => ring.some((q) => near(q.x, p.x) && near(q.y, p.y) && near(q.z, p.z));
const flatAt = (f: Face3d, axis: "x" | "y" | "z", v: number) => f.points.every((p) => near(p[axis], v));
const northWall = (doc: Document): string => wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });

function stacked(): Document {
  const doc = ok(roomDoc(), { type: "setCeiling", height: 3.05 });
  const wall = northWall(doc);
  const joint = doc.joints[doc.walls[wall]?.a ?? ""];
  const offset = joint?.x === 0 ? 2 : (joint?.x ?? 0) - 2.8;
  return ok(doc,
    { type: "addOpening", opId: "door", wall, kind: "swing", offset, width: 0.8 },
    { type: "addOpening", opId: "hi", wall, kind: "window", offset, width: 0.8, sill: 2.4, head: 2.9 });
}
function northItem(doc: Document): WallItem {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is WallItem => i.item === "wall" && i.wall === northWall(doc));
  if (!item) throw new Error("no north wall item");
  return item;
}
const facesOf = (item: WallItem): Face3d[] => wallFaces(`wall/${item.wall}`, item, STYLE_3D);

describe("a window stacked over a door in 3D (sills step 05)", () => {
  it("the wall lists both, the door 0–2.10 and the window 2.40–2.90", () => {
    expect(northItem(stacked()).openings.map((o) => [o.bottom, o.top, o.glass]).sort()).toEqual([[0, 2.1, false], [2.4, 2.9, true]]);
  });

  it("the room-side face runs round the door's notch to 2.10 and holds the window's hole from 2.40 to 2.90", () => {
    const inner = facesOf(northItem(stacked())).filter((f) => flatAt(f, "y", 3.9));
    const rings = inner.flatMap((f) => [f.points, ...f.holes]);
    for (const p of [{ x: 2, y: 3.9, z: 2.1 }, { x: 2.8, y: 3.9, z: 2.1 }]) expect(rings.some((r) => has(r, p))).toBe(true);
    for (const p of [{ x: 2, y: 3.9, z: 2.4 }, { x: 2.8, y: 3.9, z: 2.9 }]) expect(rings.some((r) => has(r, p))).toBe(true);
    // Inside the wall, the faces looking up: the threshold at 0 and the window's sill at 2.40, on the strip of wall
    // between them; the heads look down, and the camera never does (faces.ts).
    const flats = facesOf(northItem(stacked())).filter((f) => f.points.every((p) => p.x >= 2 - 1e-9 && p.x <= 2.8 + 1e-9 && p.y > 3.9 - 1e-9 && p.y < 4.1 + 1e-9));
    const zs = [...new Set(flats.filter((f) => f.points.every((p) => near(p.z, f.points[0]?.z ?? -1))).map((f) => f.points[0]?.z))].sort();
    expect(zs).toEqual([0, 2.4]);
  });

  it("the door's threshold keeps its floor when the window above is listed first", () => {
    const item = northItem(stacked());
    const door = item.openings.find((o) => o.bottom === 0);
    const win = item.openings.find((o) => o.bottom > 0);
    if (!door || !win) throw new Error("missing opening");
    const floor = { color: "#123456", lines: [], shapes: [] };
    const faces = facesOf({ ...item, openings: [win, { ...door, floor }] });
    expect(faces.filter((f) => flatAt(f, "z", 0) && f.color === "#123456")).toHaveLength(1);
  });
});

describe("a window stacked over a door in a section (sills step 05)", () => {
  type Polygon = Extract<Primitive, { kind: "polygon" }>;
  const INK = CANVAS_STYLE.section;
  const across: Section = { id: "A", a: { x: 2.4, y: 3 }, b: { x: 2.4, y: 5 }, side: 1, depth: null }; // the wall at x 0.9–1.1
  const filled = (p: SectionPicture, color: string, x: number, z: number): boolean =>
    p.primitives.some((q) => q.kind === "polygon" && q.color === color && [(q as Polygon).points, ...(q as Polygon).holes].filter((r) => pointInPolygon({ x, y: z }, r)).length % 2 === 1);

  it("shows the doorway to 2.10, wall to 2.40, the pane to 2.90 and wall above", () => {
    const p = sectionPicture(stacked(), across, "s0", CANVAS_STYLE, 70);
    expect(filled(p, INK.cut, 1, 1)).toBe(false);
    expect(filled(p, INK.cut, 1, 2.25)).toBe(true);
    expect(filled(p, INK.cut, 1, 2.65)).toBe(false);
    expect(filled(p, INK.pane, 1, 2.65)).toBe(true);
    expect(filled(p, INK.cut, 1, 2.97)).toBe(true);
  });
});
