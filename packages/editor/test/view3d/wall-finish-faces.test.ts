import { describe, expect, it } from "vitest";
import { execute, motifDefaults, unwrap, type Command, type Document, type WallSide } from "@fm/domain";
import type { Face3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { newell, sideShade as sideShadeOf } from "../../src/view3d/prism";
import { STYLE_3D, finishShades } from "../../src/view3d/style";
import type { WallItem } from "../../src/view3d/types";
import { wallFaces } from "../../src/view3d/wall-faces";
import { roomDoc } from "../builders";

// A finished wall side's colour in 3D (surfaces step 03, AC-05): the face on that side takes the finish's colour under
// the one light; the other side, the reveals, the ends and the top keep the wall's grey.

const red = { ...motifDefaults("plain"), colour: "#d0302a" };
const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

function northWall(doc: Document): string {
  const id = Object.values(doc.walls).find((w) => doc.joints[w.a]?.y === 4 && doc.joints[w.b]?.y === 4)?.id;
  if (id === undefined) throw new Error("no north wall");
  return id;
}

/** The north wall's side facing the room (south, −y): left or right as seen from its joint a. */
function insideSide(doc: Document, wall: string): WallSide {
  const w = doc.walls[wall];
  const [a, b] = [doc.joints[w?.a ?? ""], doc.joints[w?.b ?? ""]];
  if (!a || !b) throw new Error("no joints");
  const left = { x: -(b.y - a.y), y: b.x - a.x }; // a→b turned a quarter left
  return left.y < 0 ? "left" : "right";
}

const item = (doc: Document, wall: string, finishes = true): WallItem => {
  const found = view3dItems(doc, "s0", null, new Set(), finishes).find((i): i is WallItem => i.item === "wall" && i.wall === wall);
  if (!found) throw new Error("no wall item");
  return found;
};

/** The faces of the wall whose horizontal normal points along `dir` (±y here), and only vertical ones. */
const facing = (faces: readonly Face3d[], dir: { x: number; y: number }): Face3d[] =>
  faces.filter((f) => {
    const n = newell(f.points);
    const len = Math.hypot(n.x, n.y, n.z);
    return len > 1e-12 && Math.abs(n.z) / len < 1e-6 && (n.x * dir.x + n.y * dir.y) / len > 0.999;
  });

describe("a finished wall side in 3D (step 03)", () => {
  const base = roomDoc();
  const wall = northWall(base);
  const side = insideSide(base, wall);

  it("colours only the face on that side; the other side keeps the grey", () => {
    const doc = ok(base, { type: "setWallFinish", wallId: wall, side, part: "finish", finish: red });
    const faces = wallFaces(`wall/${wall}`, item(doc, wall), STYLE_3D);
    const inside = facing(faces, { x: 0, y: -1 });
    const outside = facing(faces, { x: 0, y: 1 });
    expect(inside.length).toBeGreaterThan(0);
    for (const f of inside) expect(f.color).toBe(sideShadeOf({ x: 0, y: -1 }, finishShades(red.colour)));
    for (const f of outside) expect(f.color).toBe(sideShadeOf({ x: 0, y: 1 }, STYLE_3D.wall));
  });

  it("a wall with a door and a window: every cell of the finished side takes the colour, the reveals keep the grey", () => {
    const withOpenings = ok(base,
      { type: "addOpening", opId: "door", wall, kind: "swing", offset: 2, width: 0.8 },
      { type: "addOpening", opId: "win", wall, kind: "window", offset: 3.5, width: 1 },
      { type: "setWallFinish", wallId: wall, side, part: "finish", finish: red });
    const faces = wallFaces(`wall/${wall}`, item(withOpenings, wall), STYLE_3D);
    const inside = facing(faces, { x: 0, y: -1 });
    expect(inside.length).toBeGreaterThan(0);
    for (const f of inside) expect(f.color).toBe(sideShadeOf({ x: 0, y: -1 }, finishShades(red.colour)));
    const reveals = [...facing(faces, { x: 1, y: 0 }), ...facing(faces, { x: -1, y: 0 })];
    expect(reveals.length).toBeGreaterThan(0);
    for (const f of reveals) expect([STYLE_3D.wall.lit, STYLE_3D.wall.shaded]).toContain(f.color);
  });

  it("the side follows the face, not the wall's direction", () => {
    const w = base.walls[wall];
    if (!w) throw new Error("no wall");
    const reversed: Document = { ...base, walls: { ...base.walls, [wall]: { ...w, a: w.b, b: w.a } } };
    const flipped = side === "left" ? "right" : "left";
    const doc = ok(reversed, { type: "setWallFinish", wallId: wall, side: flipped, part: "finish", finish: red });
    const inside = facing(wallFaces(`wall/${wall}`, item(doc, wall), STYLE_3D), { x: 0, y: -1 });
    for (const f of inside) expect(f.color).toBe(sideShadeOf({ x: 0, y: -1 }, finishShades(red.colour)));
  });

  it("with the Finishes switch off, the wall is grey", () => {
    const doc = ok(base, { type: "setWallFinish", wallId: wall, side, part: "finish", finish: red });
    const faces = wallFaces(`wall/${wall}`, item(doc, wall, false), STYLE_3D);
    for (const f of facing(faces, { x: 0, y: -1 })) expect(f.color).toBe(sideShadeOf({ x: 0, y: -1 }, STYLE_3D.wall));
  });

  it("an unfinished wall's faces are unchanged", () => {
    const plain = wallFaces(`wall/${wall}`, item(base, wall), STYLE_3D);
    for (const f of [...facing(plain, { x: 0, y: -1 }), ...facing(plain, { x: 0, y: 1 })]) expect([STYLE_3D.wall.lit, STYLE_3D.wall.shaded]).toContain(f.color);
  });
});

describe("wall patterns and the lower band in 3D (step 07)", () => {
  const base = roomDoc();
  const wall = northWall(base);
  const side = insideSide(base, wall);
  const outside = side === "left" ? "right" : "left";
  const paint = { ...motifDefaults("plain"), colour: "#f2f0eb" };
  const banded = (doc: Document) => ok(doc,
    { type: "setWallFinish", wallId: wall, side, part: "finish", finish: paint },
    { type: "setWallFinish", wallId: wall, side, part: "lower", finish: motifDefaults("subwayTiles"), height: 1.2 });
  const linesOf = (faces: readonly Face3d[]) => faces.flatMap((f) => f.lines ?? []);
  const flat = (l: { a: { z: number }; b: { z: number } }) => Math.abs(l.a.z - l.b.z) < 1e-9;
  /** Lines on the inner face (y 3.9, lifted toward −y). */
  const innerLines = (faces: readonly Face3d[]) => linesOf(faces).filter((l) => l.a.y < 3.9 && l.a.y > 3.89);

  it("subway tiles to 1.20 with plain above: rows 0.075 apart from 0.00 below 1.20, none above, a colour per band", () => {
    const faces = wallFaces(`wall/${wall}`, item(banded(base), wall), STYLE_3D);
    const rows = [...new Set(innerLines(faces).filter(flat).map((l) => Math.round(l.a.z * 1e6) / 1e6))].sort((a, b) => a - b);
    expect(rows.length).toBeGreaterThan(10);
    for (const z of rows) {
      expect(z).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(Math.abs(z / 0.075 - Math.round(z / 0.075))).toBeLessThan(1e-6);
    }
    const inside = facing(faces, { x: 0, y: -1 }).filter((f) => f.outline !== false);
    const below = inside.filter((f) => Math.max(...f.points.map((p) => p.z)) <= 1.2 + 1e-9);
    const above = inside.filter((f) => Math.min(...f.points.map((p) => p.z)) >= 1.2 - 1e-9);
    expect(below.length).toBeGreaterThan(0);
    expect(above.length).toBeGreaterThan(0);
    for (const f of below) expect(f.color).toBe(sideShadeOf({ x: 0, y: -1 }, finishShades(motifDefaults("subwayTiles").colour)));
    for (const f of above) expect(f.color).toBe(sideShadeOf({ x: 0, y: -1 }, finishShades(paint.colour)));
  });

  it("no pattern line lies inside a window's hole", () => {
    const doc = banded(ok(base, { type: "addOpening", opId: "win", wall, kind: "window", offset: 2.5, width: 1 }));
    const it3 = item(doc, wall);
    const win = it3.openings[0];
    if (!win) throw new Error("no window");
    const [x0, x1] = [Math.min(win.start.x, win.end.x), Math.max(win.start.x, win.end.x)];
    const inHole = (p: { x: number; z: number }) => p.x > x0 + 1e-6 && p.x < x1 - 1e-6 && p.z > win.bottom + 1e-6 && p.z < win.top - 1e-6;
    const lines = innerLines(wallFaces(`wall/${wall}`, it3, STYLE_3D));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(inHole({ x: (l.a.x + l.b.x) / 2, z: (l.a.z + l.b.z) / 2 })).toBe(false);
  });

  it("the pattern starts at the side's left end as you face it, with or without openings", () => {
    // Without openings a wall is a prism; with one, a grid measured along its first opening (two code paths).
    for (const doc0 of [base, ok(base, { type: "addOpening", opId: "win", wall, kind: "window", offset: 2.5, width: 1 })]) {
      const doc = ok(doc0,
        { type: "setWallFinish", wallId: wall, side, part: "finish", finish: motifDefaults("brick") },
        { type: "setWallFinish", wallId: wall, side: outside, part: "finish", finish: motifDefaults("brick") });
      const faces = wallFaces(`wall/${wall}`, item(doc, wall), STYLE_3D);
      const joints = (inner: boolean) => linesOf(faces)
        .filter((l) => !flat(l) && (inner ? l.a.y < 3.9 : l.a.y > 4.1) && Math.max(l.a.z, l.b.z) <= 0.065 + 1e-9)
        .map((l) => Math.round(l.a.x * 1e6) / 1e6);
      // Facing the inner face (looking north) its left end is the west end, x 0.1; facing the outer face, the east end, x 6.1.
      expect(joints(true)).toContain(0.36);
      expect(joints(false)).toContain(5.84);
    }
  });

  it("a mosaic side draws its colour only; a herringbone floor at 0.09 draws its pattern in 3D", () => {
    const doc = ok(base, { type: "setWallFinish", wallId: wall, side, part: "finish", finish: motifDefaults("mosaic") });
    expect(innerLines(wallFaces(`wall/${wall}`, item(doc, wall), STYLE_3D))).toEqual([]);
    const floored = ok(base, { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Room", finish: motifDefaults("herringbone") });
    const floor = view3dItems(floored, "s0", null, new Set(), true).find((i) => i.item === "floor");
    expect(floor?.item === "floor" && floor.lines.length > 0).toBe(true);
  });

  it("under a shed the pattern stops at the sloped top", () => {
    const sloped: WallItem = { ...item(banded(base), wall), top: 3.2, planes: [{ c: 2.0, gx: 0, gy: 0.2 }] }; // 2.78 at y 3.9
    const lines = innerLines(wallFaces(`wall/${wall}`, sloped, STYLE_3D));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) for (const p of [l.a, l.b]) expect(p.z).toBeLessThanOrEqual(2.0 + 0.2 * p.y + 1e-9);
  });

  it("a wall standing on a loft lays its pattern from 0.00, not from the deck's top", () => {
    const doc = ok(base, { type: "setWallFinish", wallId: wall, side, part: "finish", finish: motifDefaults("subwayTiles") });
    const onLoft: WallItem = { ...item(doc, wall), bottom: 2.15, top: 3.4, openings: [] };
    const rows = [...new Set(innerLines(wallFaces(`wall/${wall}`, onLoft, STYLE_3D)).filter(flat).map((l) => l.a.z))];
    expect(rows.length).toBeGreaterThan(5);
    for (const z of rows) expect(Math.abs(z / 0.075 - Math.round(z / 0.075))).toBeLessThan(1e-6);
  });
});

describe("an inherited wall side in 3D (inherit step 02, AC-01)", () => {
  const base = ok(roomDoc(), { type: "labelZone", id: "R", at: { x: 3, y: 2 }, name: "Room", finish: null });
  const wall = northWall(base);
  const side = insideSide(base, wall);
  const blue = { ...motifDefaults("plain"), colour: "#2f3e57" };

  it("the room's walls default colours the inside face and the house's the outside face, with no wall edited", () => {
    const doc = ok(base,
      { type: "setRoomWallFinishes", labelId: "R", part: "finish", finish: red },
      { type: "setOutsideFinish", part: "finish", finish: blue });
    expect(doc.walls).toEqual(base.walls);
    const faces = wallFaces(`wall/${wall}`, item(doc, wall), STYLE_3D);
    const inside = facing(faces, { x: 0, y: -1 });
    const outside = facing(faces, { x: 0, y: 1 });
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    for (const f of inside) expect(f.color).toBe(sideShadeOf({ x: 0, y: -1 }, finishShades(red.colour)));
    for (const f of outside) expect(f.color).toBe(sideShadeOf({ x: 0, y: 1 }, finishShades(blue.colour)));
  });

  it("a custom side wins, and the Finishes switch off shows none", () => {
    const doc = ok(base,
      { type: "setRoomWallFinishes", labelId: "R", part: "finish", finish: red },
      { type: "setWallSide", wallId: wall, side, finish: blue, lower: null });
    expect(item(doc, wall).sides?.[side]?.finish).toEqual(blue);
    expect(item(doc, wall, false).sides).toBeNull();
  });
});
