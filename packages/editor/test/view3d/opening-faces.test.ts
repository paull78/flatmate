import { describe, expect, it } from "vitest";
import { emptyDocument, execute, geometryOf, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import { FRAME_M, openingPrimitives, openingReach, parkedBox, PREVIEW_LOOK } from "../../src/view/openings-layer";
import { shellBounds } from "../../src/view3d/camera3d";
import { view3dItems } from "../../src/view3d/items";
import { openingFaces } from "../../src/view3d/opening-faces";
import { newell } from "../../src/view3d/prism";
import { sceneFaces } from "../../src/view3d/scene-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, WallItem } from "../../src/view3d/types";
import { wallFaces } from "../../src/view3d/wall-faces";
import { roomDoc, wallBetween } from "../builders";

/** `doc` with every opening's head at `head`: a head no longer follows a lowered wall, it's stored (sills.01, .02). */
const withHeads = (doc: Document, head: number): Document => ({ ...doc, openings: Object.fromEntries(Object.entries(doc.openings).map(([id, o]) => [id, { ...o, head }])) });

// Doors and windows in 3D (openings3d): a block frame inside each opening's span and range, and a window's pane.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const NORTH = { a: { x: 0, y: 4 }, b: { x: 6, y: 4 } };
const north = (doc: Document): string => wallBetween(doc, NORTH.a, NORTH.b);

/** `kind` at x0–x1 on the north wall of the 6 × 4 room (y = 4, faces 3.9 and 4.1), whichever way the wall runs. */
function addNorth(doc: Document, opId: string, kind: "swing" | "sliding" | "window", x0: number, x1: number): Document {
  const wall = north(doc);
  const ax = doc.joints[doc.walls[wall]?.a ?? ""]?.x ?? 0;
  return ok(doc, { type: "addOpening", opId, wall, kind, offset: ax === 0 ? x0 : ax - x1, width: x1 - x0 });
}

function itemOf(doc: Document, wall: string): WallItem {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is WallItem => i.item === "wall" && i.wall === wall);
  if (!item) throw new Error(`no wall ${wall}`);
  return item;
}

const r = (v: number) => Math.round(v * 1e6) / 1e6;
type Box = [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];

function boxOf(faces: readonly Face3d[]): Box {
  const pts = faces.flatMap((f) => f.points);
  const range = (vs: number[]): [number, number] => [r(Math.min(...vs)), r(Math.max(...vs))];
  return [...range(pts.map((p) => p.x)), ...range(pts.map((p) => p.y)), ...range(pts.map((p) => p.z))];
}

const isJoinery = (f: Face3d) => Object.values(STYLE_3D.joinery).includes(f.color);
const isGlass = (f: Face3d) => f.color === STYLE_3D.glass;
const byPosition = (a: Box, b: Box) => a.reduce((d, v, i) => d || v - (b[i] ?? 0), 0);

/** The joinery as boxes: `prism` lists a four-sided solid as four sides and a top. */
function boxes(faces: readonly Face3d[]): Box[] {
  const all = faces.filter(isJoinery);
  expect(all.length % 5).toBe(0);
  return Array.from({ length: all.length / 5 }, (_, k) => boxOf(all.slice(5 * k, 5 * k + 5))).sort(byPosition);
}

const facesOf = (doc: Document, wall: string) => {
  const item = itemOf(doc, wall);
  return openingFaces(`wall/${wall}`, item, STYLE_3D);
};

/** Whether a box stands in the north wall's 3.9–4.1 thickness: a frame's, not a leaf's. */
const inNorthWall = (b: Box) => b[2] >= 3.9 - 1e-6 && b[3] <= 4.1 + 1e-6;

describe("a swing door's leaf in 3D (AC-01)", () => {
  /** A door at x 2.0–2.8 on the north wall, which runs from x 6 to x 0, so hinge `a` is at x 2.8 and its left is south. */
  const door = (side: "left" | "right", hinge: "a" | "b"): Document => {
    const room = roomDoc();
    return ok(room, { type: "addOpening", opId: "d", wall: north(room), kind: "swing", offset: 3.2, width: 0.8, side, hinge });
  };
  const leafOf = (doc: Document): Box | undefined => boxes(facesOf(doc, north(doc))).find((b) => !inNorthWall(b));

  it("the wall runs as the fixtures below assume", () => {
    const room = roomDoc();
    expect(room.joints[room.walls[north(room)]?.a ?? ""]?.x).toBe(6);
  });

  it("stands open from the frame's rebate on its hinge side, on its own side, for every side and hinge", () => {
    expect(leafOf(door("left", "a"))).toEqual([2.72, 2.76, 3.18, 3.9, 0, 2.04]);
    expect(leafOf(door("right", "a"))).toEqual([2.72, 2.76, 4.1, 4.82, 0, 2.04]);
    expect(leafOf(door("left", "b"))).toEqual([2.04, 2.08, 3.18, 3.9, 0, 2.04]);
    expect(leafOf(door("right", "b"))).toEqual([2.04, 2.08, 4.1, 4.82, 0, 2.04]);
  });

  it("lies inside the door's swing square", () => {
    for (const side of ["left", "right"] as const) {
      for (const hinge of ["a", "b"] as const) {
        const [x0, x1, y0, y1] = leafOf(door(side, hinge)) ?? [0, 0, 0, 0];
        expect(x0).toBeGreaterThanOrEqual(2);
        expect(x1).toBeLessThanOrEqual(2.8);
        expect(side === "left" ? y0 >= 3.9 - 0.8 : y1 <= 4.1 + 0.8).toBe(true);
      }
    }
  });

  it("at a corner is measured from the clear span, so it stands clear of the corner's wall", () => {
    const room = roomDoc();
    const east = wallBetween(room, { x: 6, y: 0 }, { x: 6, y: 4 });
    expect(room.joints[room.walls[east]?.a ?? ""]?.y).toBe(0);
    const doc = ok(room, { type: "addOpening", opId: "d", wall: east, kind: "swing", offset: 0, width: 0.8, side: "left", hinge: "a" });
    expect(boxes(facesOf(doc, east)).filter((b) => b[1] <= 5.9)).toEqual([[5.28, 5.9, 0.14, 0.18, 0, 2.04]]);
  });

  it("on a turned wall stands square to it", () => {
    const doc = ok(roomDoc(), { type: "addWall", opId: "f", from: { at: { x: 1, y: 1 } }, to: { at: { x: 4, y: 3 } } }, { type: "addOpening", opId: "fd", wall: "f/w0", kind: "swing", offset: 1, width: 0.8 });
    const len = Math.hypot(3, 2);
    const across = (p: { x: number; y: number }) => (-(p.x - 1) * 2 + (p.y - 1) * 3) / len;
    const along = (p: { x: number; y: number }) => ((p.x - 1) * 3 + (p.y - 1) * 2) / len;
    const leaf = facesOf(doc, "f/w0").filter((f) => f.points.some((p) => Math.abs(across(p)) > 0.1 + 1e-9));
    expect(leaf.length).toBe(4); // its back side lies on the wall's face
    const reach = leaf.flatMap((f) => f.points.map(across));
    expect(Math.max(...reach.map(Math.abs))).toBeCloseTo(0.1 + 0.72, 9);
    const span = leaf.flatMap((f) => f.points.map(along));
    expect(Math.max(...span) - Math.min(...span)).toBeCloseTo(0.04, 9);
  });

  it("follows a low wall's lowered head", () => {
    const base = withHeads(door("left", "a"), 1.93);
    const doc = ok(base, { type: "setWallTop", wallId: north(base), top: 2.03 });
    expect(leafOf(doc)?.[5]).toBeCloseTo(1.87, 9);
  });

  it("is in joinery's shades, and a hidden wall draws none (AC-02)", () => {
    const doc = door("left", "a");
    const leaf = facesOf(doc, north(doc)).filter((f) => f.points.some((p) => p.y < 3.9 - 1e-9));
    expect(leaf.length).toBe(4); // its back side lies on the wall's face
    for (const f of leaf) expect(Object.values(STYLE_3D.joinery)).toContain(f.color);
    const items = view3dItems(doc, "s0", null, new Set(), false);
    expect(sceneFaces({ items, hidden: new Set([north(doc)]) }).filter((f) => isJoinery(f))).toEqual([]);
  });
});

describe("a sliding door's parked leaf in 3D (AC-03)", () => {
  /** A door at x 2–3 on the north wall, which runs from x 6 to x 0, so hinge `a` is at x 3 and its left is south. */
  const door = (side: "left" | "right", hinge: "a" | "b", offset = 3): Document => {
    const room = roomDoc();
    return ok(room, { type: "addOpening", opId: "d", wall: north(room), kind: "sliding", offset, width: 1, side, hinge });
  };
  const leafOf = (doc: Document): Box[] => boxes(facesOf(doc, north(doc))).filter((b) => !inNorthWall(b));

  it("lies beyond the hinge end, off the wall's face on its own side, the opening's width and height, for every side and hinge", () => {
    expect(leafOf(door("left", "a"))).toEqual([[3, 4, 3.86, 3.9, 0, 2.1]]);
    expect(leafOf(door("right", "a"))).toEqual([[3, 4, 4.1, 4.14, 0, 2.1]]);
    expect(leafOf(door("left", "b"))).toEqual([[1, 2, 3.86, 3.9, 0, 2.1]]);
    expect(leafOf(door("right", "b"))).toEqual([[1, 2, 4.1, 4.14, 0, 2.1]]);
  });

  it("leaves the doorway clear: nothing crosses the span, and the frame stays", () => {
    for (const hinge of ["a", "b"] as const) {
      for (const [x0, x1] of leafOf(door("left", hinge)).map((b) => [b[0], b[1]])) expect((x1 ?? 0) <= 2 || (x0 ?? 0) >= 3).toBe(true);
    }
    const doc = door("left", "a");
    expect(boxes(facesOf(doc, north(doc))).filter(inNorthWall)).toHaveLength(3);
  });

  it("isn't checked: it still draws past its wall's end, and over a neighbouring window (openings3d.15)", () => {
    const pastEnd = door("left", "a", 0); // hinge at x 6, the wall's end: the leaf runs to x 7
    expect(leafOf(pastEnd)).toEqual([[6, 7, 3.86, 3.9, 0, 2.1]]);
    const room = door("left", "a");
    const withWindow = ok(room, { type: "addOpening", opId: "w", wall: north(room), kind: "window", offset: 1.5, width: 1 }); // x 3.5–4.5, under the leaf
    expect(leafOf(withWindow)).toEqual([[3, 4, 3.86, 3.9, 0, 2.1]]);
  });

  it("at a corner keeps the plan's place: measured from the stored hinge, not the clear span", () => {
    const room = roomDoc();
    const east = wallBetween(room, { x: 6, y: 0 }, { x: 6, y: 4 });
    const doc = ok(room, { type: "addOpening", opId: "d", wall: east, kind: "sliding", offset: 0, width: 1, side: "left", hinge: "a" });
    expect(boxes(facesOf(doc, east)).filter((b) => b[1] <= 5.9)).toEqual([[5.86, 5.9, -1, 0, 0, 2.1]]);
  });

  it("follows a low wall's lowered head, and a hidden wall draws none (AC-02)", () => {
    const base = door("left", "a");
    const low = ok(withHeads(base, 1.93), { type: "setWallTop", wallId: north(base), top: 2.03 });
    expect(leafOf(low)[0]?.[5]).toBeCloseTo(1.93, 9);
    const items = view3dItems(base, "s0", null, new Set(), false);
    expect(sceneFaces({ items, hidden: new Set([north(base)]) }).filter((f) => isJoinery(f))).toEqual([]);
  });
});

describe("3D against the plan's own rules (openings3d.27)", () => {
  const SIDES = ["left", "right"] as const;
  const HINGES = ["a", "b"] as const;
  /** A door on the north wall, away from its corners, for one side and hinge, with the opening and geometry the plan draws from. */
  function case3d(kind: "swing" | "sliding", side: "left" | "right", hinge: "a" | "b", thickness = 0.2) {
    const room = roomDoc();
    const wall = north(room);
    const doc = ok(room, { type: "setWallThickness", wallId: wall, thickness }, { type: "addOpening", opId: "d", wall, kind, offset: 3, width: 0.8, side, hinge });
    const opening = doc.openings["d/d0"];
    const geometry = opening && geometryOf(doc, opening);
    if (!opening || !geometry) throw new Error("no opening");
    return { doc, wall, opening, geometry };
  }
  const round = (p: { x: number; y: number }) => [r(p.x), r(p.y)];
  const outside = (box: Box, half: number) => box[2] < 4 - half - 1e-6 || box[3] > 4 + half + 1e-6;

  it("a swing leaf is the plan's detailed leaf: the same box on the plan, for every side and hinge", () => {
    for (const side of SIDES) {
      for (const hinge of HINGES) {
        const { doc, wall, opening, geometry } = case3d("swing", side, hinge);
        const plan = openingPrimitives(opening, geometry, PREVIEW_LOOK, false, true).flatMap((p) => (p.kind === "polygon" ? [p.points] : []));
        const size = (points: readonly { x: number; y: number }[]) => {
          const [xs, ys] = [points.map((p) => p.x), points.map((p) => p.y)];
          return [r(Math.min(...xs)), r(Math.max(...xs)), r(Math.min(...ys)), r(Math.max(...ys))];
        };
        const leafInPlan = plan.map(size).filter(([x0, x1, y0, y1]) => (y1 ?? 0) - (y0 ?? 0) > 0.5 && (x1 ?? 0) - (x0 ?? 0) < 0.05);
        expect(leafInPlan, `${side} ${hinge}`).toHaveLength(1);
        const leaf = boxes(facesOf(doc, wall)).filter((b) => outside(b, 0.1));
        expect(leaf.map((b) => b.slice(0, 4)), `${side} ${hinge}`).toEqual(leafInPlan);
      }
    }
  });

  it("a parked leaf lies on the plan's parkedBox, for every side and hinge (AC-03)", () => {
    for (const side of SIDES) {
      for (const hinge of HINGES) {
        const { doc, wall, opening, geometry } = case3d("sliding", side, hinge);
        const parked = parkedBox(opening, geometry).map(round);
        const leaf = boxes(facesOf(doc, wall)).filter((b) => outside(b, 0.1));
        expect(leaf, `${side} ${hinge}`).toHaveLength(1);
        const [x0, x1, y0, y1] = leaf[0] ?? [0, 0, 0, 0];
        const xs = parked.map((p) => p[0] ?? 0);
        const ys = parked.map((p) => p[1] ?? 0);
        expect([x0, x1, y0, y1], `${side} ${hinge}`).toEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]);
      }
    }
  });

  it("a frame's width is the plan's constant, clamped to a thin wall as the plan's is (AC-04)", () => {
    for (const thickness of [0.2, 0.05]) {
      const { doc, wall } = case3d("swing", "left", "a", thickness);
      const jamb = boxes(facesOf(doc, wall))[0];
      expect(r((jamb?.[1] ?? 0) - (jamb?.[0] ?? 0))).toBe(r(Math.min(FRAME_M, thickness)));
    }
  });

  it("a thin wall's leaf, measured from its thinner frame, matches the plan's reach", () => {
    const { doc, wall, opening, geometry } = case3d("swing", "left", "a", 0.05);
    const reach = openingReach(opening, geometry).map(round);
    const leaf = boxes(facesOf(doc, wall)).filter((b) => outside(b, 0.025));
    expect(leaf).toHaveLength(1);
    // Hinge `a` is at x 3 on this wall, running west: the leaf stands in the opening, so the plan's hinge is the leaf's
    // high-x edge, and its reach its low-y end.
    expect(reach.map((p) => p[0])).toContain(leaf[0]?.[1]);
    expect(reach.map((p) => p[1])).toContain(leaf[0]?.[2]);
  });
});

describe("a glazed door's leaf in 3D (AC-05)", () => {
  /** A glazed door on the north wall (from x 6 to x 0), its left south, hinge `a` at its higher x. */
  const glazed = (kind: "swing" | "sliding", width: number): Document => {
    const room = roomDoc();
    return ok(room, { type: "addOpening", opId: "d", wall: north(room), kind, offset: 3, width, side: "left", hinge: "a", glazed: true });
  };
  const outOfWall = (doc: Document) => boxes(facesOf(doc, north(doc))).filter((b) => !inNorthWall(b));
  const panesOf = (doc: Document) => facesOf(doc, north(doc)).filter(isGlass);

  it("a swing leaf is the same box as a solid one: two stiles and two rails around a pane at its middle", () => {
    const doc = glazed("swing", 0.8); // x 2.2–3.0: the leaf at x 2.92–2.96, 0.72 long from the wall's face at y 3.9
    expect(outOfWall(doc)).toEqual([
      [2.92, 2.96, 3.18, 3.24, 0, 2.04],
      [2.92, 2.96, 3.24, 3.84, 0, 0.06],
      [2.92, 2.96, 3.24, 3.84, 1.98, 2.04],
      [2.92, 2.96, 3.84, 3.9, 0, 2.04],
    ]);
    const panes = panesOf(doc);
    expect(panes).toHaveLength(2);
    for (const pane of panes) expect(boxOf([pane])).toEqual([2.94, 2.94, 3.24, 3.84, 0.06, 1.98]);
  });

  it("a parked leaf is the same box as a solid one, with its pane at its middle", () => {
    const doc = glazed("sliding", 1); // x 2–3: parked at x 3–4, y 3.86–3.9
    expect(outOfWall(doc)).toEqual([
      [3, 3.06, 3.86, 3.9, 0, 2.1],
      [3.06, 3.94, 3.86, 3.9, 0, 0.06],
      [3.06, 3.94, 3.86, 3.9, 2.04, 2.1],
      [3.94, 4, 3.86, 3.9, 0, 2.1],
    ]);
    const panes = panesOf(doc);
    expect(panes).toHaveLength(2);
    for (const pane of panes) expect(boxOf([pane])).toEqual([3.06, 3.94, 3.88, 3.88, 0.06, 2.04]);
  });

  it("a pane is seen from both sides: two faces back to back, in the glass colour", () => {
    for (const doc of [glazed("swing", 0.8), glazed("sliding", 1)]) {
      const [a, b] = panesOf(doc);
      if (!a || !b) throw new Error("no pane");
      const normal = (f: Face3d) => newell(f.points);
      const [na, nb] = [normal(a), normal(b)];
      expect(na.x * nb.x + na.y * nb.y + na.z * nb.z).toBeLessThan(0);
      expect(Math.abs(na.z)).toBeLessThan(1e-9);
    }
  });

  it("a solid door of either kind draws no glass", () => {
    for (const kind of ["swing", "sliding"] as const) {
      const doc = addNorth(roomDoc(), "d", kind, 2, 2.8);
      expect(panesOf(doc)).toEqual([]);
    }
  });

  it("the narrowest door keeps a pane", () => {
    const panes = panesOf(glazed("swing", 0.5)); // a 0.42 m leaf
    expect(panes).toHaveLength(2);
    expect(boxOf(panes)[3] - boxOf(panes)[2]).toBeCloseTo(0.3, 9);
  });

  it("a leaf with no room for stiles draws solid, not an inside-out pane", () => {
    const room = ok(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 6, 4, "thick", 0.5));
    const wall = wallBetween(room, NORTH.a, NORTH.b);
    const offset = room.joints[room.walls[wall]?.a ?? ""]?.x === 0 ? 0 : 5.55;
    const doc = ok(room, { type: "addOpening", opId: "w", wall, kind: "window", offset, width: 0.45 }); // 0.20 m of it in the clear span
    const item = itemOf(doc, wall);
    const door: WallItem = { ...item, openings: item.openings.map((o) => ({ ...o, kind: "swing", glass: false, glazed: true, bottom: 0 })) };
    const faces = openingFaces(`wall/${wall}`, door, STYLE_3D);
    expect(faces.filter(isGlass)).toEqual([]);
    expect(boxes(faces)).toHaveLength(4); // the frame's three parts and one solid leaf 0.08 m long
  });
});

describe("an opening's frame in 3D (AC-04)", () => {
  it("a door's frame: both jambs and the head, nothing across the threshold", () => {
    const doc = addNorth(roomDoc(), "d", "swing", 2, 2.8);
    expect(boxes(facesOf(doc, north(doc))).filter(inNorthWall)).toEqual([
      [2, 2.06, 3.9, 4.1, 0, 2.1],
      [2.06, 2.74, 3.9, 4.1, 2.04, 2.1],
      [2.74, 2.8, 3.9, 4.1, 0, 2.1],
    ]);
  });

  it("a sliding door has the same frame", () => {
    const doc = addNorth(roomDoc(), "d", "sliding", 2, 2.8);
    expect(boxes(facesOf(doc, north(doc))).filter(inNorthWall)).toEqual([
      [2, 2.06, 3.9, 4.1, 0, 2.1],
      [2.06, 2.74, 3.9, 4.1, 2.04, 2.1],
      [2.74, 2.8, 3.9, 4.1, 0, 2.1],
    ]);
  });

  it("a window's frame: all four sides", () => {
    const doc = addNorth(roomDoc(), "w", "window", 3.5, 4.5);
    expect(boxes(facesOf(doc, north(doc)))).toEqual([
      [3.5, 3.56, 3.9, 4.1, 0.9, 2.1],
      [3.56, 4.44, 3.9, 4.1, 0.9, 0.96],
      [3.56, 4.44, 3.9, 4.1, 2.04, 2.1],
      [4.44, 4.5, 3.9, 4.1, 0.9, 2.1],
    ]);
  });

  it("a thin wall's frame is as wide as the wall is thick, and as deep (openings3d.16)", () => {
    const base = addNorth(roomDoc(), "d", "swing", 2, 2.8);
    const doc = ok(base, { type: "setWallThickness", wallId: north(base), thickness: 0.05 });
    expect(boxes(facesOf(doc, north(doc)))[0]).toEqual([2, 2.05, 3.975, 4.025, 0, 2.1]);
  });

  it("a low wall's head follows the door's lowered range", () => {
    const base = withHeads(addNorth(roomDoc(), "d", "swing", 2, 2.8), 1.93);
    const doc = ok(base, { type: "setWallTop", wallId: north(base), top: 2.03 });
    expect(boxes(facesOf(doc, north(doc)))[1]).toEqual([2.06, 2.74, 3.9, 4.1, 1.87, 1.93]);
  });

  it("a door reaching a corner is framed from the clear span, not inside the corner's wall (openings3d.10)", () => {
    const doc = roomDoc();
    const east = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const offset = doc.joints[doc.walls[east]?.a ?? ""]?.y === 0 ? 0 : 3.2;
    const withDoor = ok(doc, { type: "addOpening", opId: "d", wall: east, kind: "swing", offset, width: 0.8 });
    expect(boxes(facesOf(withDoor, east)).filter((b) => b[0] >= 5.9)).toEqual([
      [5.9, 6.1, 0.1, 0.16, 0, 2.1],
      [5.9, 6.1, 0.16, 0.74, 2.04, 2.1],
      [5.9, 6.1, 0.74, 0.8, 0, 2.1],
    ]);
  });

  it("touching openings keep a frame each, back to back", () => {
    const doc = addNorth(addNorth(roomDoc(), "d", "swing", 2, 2.8), "w", "window", 2.8, 3.8);
    const all = boxes(facesOf(doc, north(doc)));
    expect(all).toContainEqual([2.74, 2.8, 3.9, 4.1, 0, 2.1]);
    expect(all).toContainEqual([2.8, 2.86, 3.9, 4.1, 0.9, 2.1]);
  });

  it("a turned wall's frame stays in the wall: every point within its thickness", () => {
    const doc = ok(roomDoc(), { type: "addWall", opId: "f", from: { at: { x: 1, y: 1 } }, to: { at: { x: 4, y: 3 } } }, { type: "addOpening", opId: "fw", wall: "f/w0", kind: "window", offset: 1, width: 1 });
    const len = Math.hypot(3, 2);
    const across = (x: number, y: number) => (-(x - 1) * 2 + (y - 1) * 3) / len;
    const faces = facesOf(doc, "f/w0");
    expect(faces.length).toBeGreaterThan(0);
    for (const f of faces) for (const p of f.points) expect(Math.abs(across(p.x, p.y))).toBeLessThan(0.1 + 1e-9);
  });

  it("every face belongs to its wall", () => {
    const doc = addNorth(addNorth(roomDoc(), "d", "swing", 2, 2.8), "w", "window", 3.5, 4.5);
    expect(new Set(facesOf(doc, north(doc)).map((f) => f.owner))).toEqual(new Set([`wall/${north(doc)}`]));
  });
});

describe("a window's pane in 3D (AC-05)", () => {
  it("fills the frame's clear opening at the wall's centre, as two faces back to back", () => {
    const doc = addNorth(roomDoc(), "w", "window", 3.5, 4.5);
    const panes = facesOf(doc, north(doc)).filter(isGlass);
    expect(panes).toHaveLength(2);
    for (const pane of panes) expect(boxOf([pane])).toEqual([3.56, 4.44, 4, 4, 0.96, 2.04]);
  });

  it("a door has no pane", () => {
    const doc = addNorth(roomDoc(), "d", "swing", 2, 2.8);
    expect(facesOf(doc, north(doc)).filter(isGlass)).toEqual([]);
  });

  it("a wall's own faces hold no joinery and no glass: they are the holed solid", () => {
    const doc = addNorth(addNorth(roomDoc(), "d", "swing", 2, 2.8), "w", "window", 3.5, 4.5);
    const own = wallFaces(`wall/${north(doc)}`, itemOf(doc, north(doc)), STYLE_3D);
    expect(own.filter((f) => isJoinery(f) || isGlass(f))).toEqual([]);
  });
});

describe("a span too narrow for a frame (AC-11)", () => {
  /** A window at the corner of 0.50 m walls: all but 0.25 m of its width is left in the clear span. */
  function cornerWindow(width = 0.3): { doc: Document; wall: string } {
    const room = ok(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 6, 4, "thick", 0.5));
    const wall = wallBetween(room, NORTH.a, NORTH.b);
    const ax = room.joints[room.walls[wall]?.a ?? ""]?.x ?? 0;
    return { doc: ok(room, { type: "addOpening", opId: "w", wall, kind: "window", offset: ax === 0 ? 0 : 6 - width, width }), wall };
  }

  it("a window draws no frame and keeps its pane across the span", () => {
    const { doc, wall } = cornerWindow();
    const faces = facesOf(doc, wall);
    expect(faces.filter(isJoinery)).toEqual([]);
    const panes = faces.filter(isGlass);
    expect(panes).toHaveLength(2);
    expect(boxOf(panes)).toEqual([0.25, 0.3, 4, 4, 0.9, 2.1]);
  });

  it("a door draws no frame", () => {
    const { doc, wall } = cornerWindow();
    const item = itemOf(doc, wall);
    const door: WallItem = { ...item, openings: item.openings.map((o) => ({ ...o, kind: "swing", glass: false, bottom: 0 })) };
    expect(openingFaces(`wall/${wall}`, door, STYLE_3D)).toEqual([]);
  });

  it("0.20 m of span has a frame, and just under it none", () => {
    const at = cornerWindow(0.45);
    expect(boxes(facesOf(at.doc, at.wall))).toHaveLength(4);
    const under = cornerWindow(0.44);
    expect(boxes(facesOf(under.doc, under.wall))).toEqual([]);
  });
});

describe("frames in the scene", () => {
  it("a hidden wall draws no frame or pane (AC-02)", () => {
    const doc = addNorth(addNorth(roomDoc(), "d", "swing", 2, 2.8), "w", "window", 3.5, 4.5);
    const items = view3dItems(doc, "s0", null, new Set(), false);
    const shown = sceneFaces({ items, hidden: new Set() });
    expect(shown.filter(isGlass).length).toBeGreaterThan(0);
    expect(shown.filter(isJoinery).length).toBeGreaterThan(0);
    const hidden = sceneFaces({ items, hidden: new Set([north(doc)]) });
    expect(hidden.filter(isGlass)).toEqual([]);
    expect(hidden.filter(isJoinery)).toEqual([]);
  });

  it("openings leave the framing alone (AC-12)", () => {
    const plain = roomDoc();
    expect(shellBounds(addNorth(plain, "d", "swing", 2, 2.8))).toEqual(shellBounds(plain));
  });

  it("an item says what it needs of its opening, and a section still reads a window as glass", () => {
    const doc = addNorth(addNorth(roomDoc(), "d", "swing", 2, 2.8), "w", "window", 3.5, 4.5);
    const seen = itemOf(doc, north(doc)).openings.map((o) => [o.kind, o.glass, o.glazed]);
    expect(seen).toContainEqual(["swing", false, false]);
    expect(seen).toContainEqual(["window", true, false]);
  });
});
