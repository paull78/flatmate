import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import type { Face3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { STYLE_3D } from "../../src/view3d/style";
import type { Point3, WallItem } from "../../src/view3d/types";
import { wallFaces } from "../../src/view3d/wall-faces";
import { roomDoc } from "../builders";
import { turnAngles, visible } from "./visible";

/** `doc` with every opening's head at `head`: a head no longer follows a lowered wall, it's stored (sills.01, .02). */
const withHeads = (doc: Document, head: number): Document => ({ ...doc, openings: Object.fromEntries(Object.entries(doc.openings).map(([id, o]) => [id, { ...o, head }])) });

// Doors and windows in the 3D view (heights.69, AC-21): fixed view-only heights; the wall stays one solid whose long
// faces get a notch per door and a hole per window, with the jambs, the sill and the threshold inside. What stands in
// the openings is `opening-faces.test.ts`.

const faces3d = (item: WallItem): Face3d[] => wallFaces(`wall/${item.wall}`, item, STYLE_3D);

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const has = (ring: readonly Point3[], p: Point3) => ring.some((q) => near(q.x, p.x) && near(q.y, p.y) && near(q.z, p.z));

function northWall(doc: Document): string {
  const id = Object.values(doc.walls).find((w) => doc.joints[w.a]?.y === 4 && doc.joints[w.b]?.y === 4)?.id;
  if (id === undefined) throw new Error("no north wall");
  return id;
}

/** The 6 × 4 room with a door at x 2.0–2.8 and a window at x 3.5–4.5 on its north wall (y = 4, faces at 3.9 and 4.1). */
function studio(): Document {
  const doc = roomDoc();
  const wall = doc.walls[northWall(doc)];
  const ax = wall ? (doc.joints[wall.a]?.x ?? 0) : 0;
  const offset = (x0: number, x1: number) => (ax === 0 ? x0 : ax - x1);
  return ok(doc, { type: "addOpening", opId: "door", wall: northWall(doc), kind: "swing", offset: offset(2, 2.8), width: 0.8 },
    { type: "addOpening", opId: "win", wall: northWall(doc), kind: "window", offset: offset(3.5, 4.5), width: 1 });
}

function northItem(doc: Document): WallItem {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is WallItem => i.item === "wall" && i.wall === northWall(doc));
  if (!item) throw new Error("no north wall item");
  return item;
}

const facesAt = (turn: number, doc = studio()): Face3d[] => visible(faces3d(northItem(doc)), turnAngles(turn));
const flatAt = (f: Face3d, axis: "x" | "y" | "z", v: number) => f.points.every((p) => near(p[axis], v));

describe("openings in the 3D view", () => {
  it("a door makes a notch in the room-side face from the floor to its head, and a floor-coloured threshold across the wall", () => {
    const inner = facesAt(0).find((f) => flatAt(f, "y", 3.9));
    expect(inner).toBeDefined();
    for (const p of [{ x: 2, y: 3.9, z: 0 }, { x: 2, y: 3.9, z: 2.1 }, { x: 2.8, y: 3.9, z: 2.1 }, { x: 2.8, y: 3.9, z: 0 }]) expect(has(inner?.points ?? [], p)).toBe(true);
    const threshold = facesAt(0).filter((f) => flatAt(f, "z", 0) && f.color === STYLE_3D.floor);
    expect(threshold).toHaveLength(1);
    for (const p of [{ x: 2, y: 3.9, z: 0 }, { x: 2.8, y: 3.9, z: 0 }, { x: 2.8, y: 4.1, z: 0 }, { x: 2, y: 4.1, z: 0 }]) expect(has(threshold[0]?.points ?? [], p)).toBe(true);
  });

  it("a window makes a hole from sill to head in the room-side face and a sill at 0.90", () => {
    const inner = facesAt(0).find((f) => flatAt(f, "y", 3.9));
    expect(inner?.holes).toHaveLength(1);
    for (const p of [{ x: 3.5, y: 3.9, z: 0.9 }, { x: 4.5, y: 3.9, z: 0.9 }, { x: 4.5, y: 3.9, z: 2.1 }, { x: 3.5, y: 3.9, z: 2.1 }]) expect(has(inner?.holes[0] ?? [], p)).toBe(true);
    expect(facesAt(0).filter((f) => flatAt(f, "z", 0.9) && f.points.every((p) => p.x >= 3.5 - 1e-9 && p.x <= 4.5 + 1e-9))).toHaveLength(1);
  });

  it("a door in a 2.03 m half wall has its head at 1.93, 0.10 under the top, and so has the window (decks.17)", () => {
    const low = ok(withHeads(studio(), 1.93), { type: "setWallTop", wallId: northWall(studio()), top: 2.03 });
    const item = northItem(low);
    expect([item.top, item.full, item.openings.map((o) => [o.bottom, o.top]).sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0))]).toEqual([2.03, false, [[0, 1.93], [0.9, 1.93]]]);
    const inner = facesAt(0, low).find((f) => flatAt(f, "y", 3.9));
    for (const p of [{ x: 2, y: 3.9, z: 1.93 }, { x: 2.8, y: 3.9, z: 1.93 }, { x: 2.8, y: 3.9, z: 0 }]) expect(has(inner?.points ?? [], p)).toBe(true);
    expect(facesAt(0, low).some((f) => f.points.some((p) => p.z > 2.03 + 1e-9))).toBe(false);
  });

  it("an opening's jamb is drawn only when it faces the camera: from the south-west the far jamb (x 2.8), from the north-east the near one (x 2.0)", () => {
    const jambs = (turn: number, x: number) => facesAt(turn).filter((f) => flatAt(f, "x", x) && has(f.points, { x, y: 3.9, z: 0 }) && has(f.points, { x, y: 4.1, z: 2.1 }));
    expect([jambs(0, 2).length, jambs(0, 2.8).length]).toEqual([0, 1]);
    expect([jambs(2, 2).length, jambs(2, 2.8).length]).toEqual([1, 0]);
  });

  it("everything inside the wall (thresholds, sills, jambs, panes) comes before the long faces and the top, at every turn", () => {
    for (const turn of [0, 1, 2, 3] as const) {
      const fs = facesAt(turn);
      const long = (f: Face3d) => flatAt(f, "y", 3.9) || flatAt(f, "y", 4.1);
      const insideWall = (f: Face3d) => !long(f) && f.points.every((p) => p.x > 2 - 1e-9 && p.x < 4.5 + 1e-9 && p.z < 2.5 - 1e-9);
      const firstLong = fs.findIndex(long);
      const lastInside = Math.max(...fs.map((f, i) => (insideWall(f) ? i : -1)));
      expect(lastInside).toBeGreaterThan(-1);
      expect(lastInside).toBeLessThan(firstLong);
      expect(fs.at(-1)?.color).toBe(STYLE_3D.wall.top);
    }
  });

  it("a wall without openings gives the faces it gave before: four-point sides with no holes, then the top", () => {
    const plain = { ...northItem(studio()), openings: [] };
    for (const turn of [0, 1, 2, 3] as const) {
      const fs = visible(faces3d(plain), turnAngles(turn));
      expect(fs.slice(0, -1).every((f) => f.points.length === 4 && f.holes.length === 0)).toBe(true);
      expect(fs.at(-1)?.color).toBe(STYLE_3D.wall.top);
    }
  });

  it("all faces of a wall share its owner, so the painter keeps it one solid", () => {
    expect(new Set(facesAt(1).map((f) => f.owner))).toEqual(new Set([`wall/${northWall(studio())}`]));
  });
});

// The review's cases (heights.71): openings at a free end, touching openings, at a corner, on a diagonal wall, in any
// order, in a thicker wall; and the area every long face must keep.

/** A free-standing wall inside the room, from `a` to `b`, with the given openings (offsets from `a`). */
function freeWall(a: { x: number; y: number }, b: { x: number; y: number }, ...openings: [string, number, number][]): Document {
  let doc = ok(roomDoc(), { type: "addWall", opId: "free", from: { at: a }, to: { at: b } });
  openings.forEach(([kind, offset, width], n) => {
    doc = ok(doc, { type: "addOpening", opId: `f${n}`, wall: "free/w0", kind: kind === "window" ? "window" : "swing", offset, width });
  });
  return doc;
}
const wallItem = (doc: Document, wall: string): WallItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is WallItem => i.item === "wall" && i.wall === wall);
  if (!item) throw new Error(`no wall ${wall}`);
  return item;
};
const TURNS = [0, 1, 2, 3] as const;

/** A flat face's area in its own plane (Newell), its holes taken out. */
function faceArea(f: Face3d): number {
  const ringArea = (r: readonly Point3[]) => {
    let [x, y, z] = [0, 0, 0];
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length] ?? p;
      x += (p.y - q.y) * (p.z + q.z);
      y += (p.z - q.z) * (p.x + q.x);
      z += (p.x - q.x) * (p.y + q.y);
    });
    return Math.hypot(x, y, z) / 2;
  };
  return ringArea(f.points) - f.holes.reduce((sum, h) => sum + ringArea(h), 0);
}

describe("openings in the 3D view: the hard cases", () => {
  it("a door at a free wall end leaves the doorway open: nothing at the end below the head, at any turn", () => {
    const doc = freeWall({ x: 1, y: 1.5 }, { x: 4, y: 1.5 }, ["door", 0, 0.9]);
    let seen = 0;
    for (const turn of TURNS) {
      const atEnd = visible(faces3d(wallItem(doc, "free/w0")), turnAngles(turn)).filter((f) => flatAt(f, "x", 1));
      seen += atEnd.length;
      expect(atEnd.every((f) => f.points.every((p) => p.z > 2.1 - 1e-9))).toBe(true);
    }
    expect(seen).toBeGreaterThan(0); // the lintel's end shows at the turns that face it
    // A 0.9 m wall that is all door: only the lintel's ends remain.
    const short = freeWall({ x: 1, y: 1.5 }, { x: 1.9, y: 1.5 }, ["door", 0, 0.9]);
    for (const turn of TURNS) {
      const ends = visible(faces3d(wallItem(short, "free/w0")), turnAngles(turn)).filter((f) => flatAt(f, "x", 1) || flatAt(f, "x", 1.9));
      expect(ends.every((f) => f.points.every((p) => p.z > 2.1 - 1e-9))).toBe(true);
    }
  });

  it("touching openings share no jamb: between a door and a window only the wall under the sill shows", () => {
    // Door x 2.0–2.8 and window x 2.8–3.8 on the north wall.
    const doc = roomDoc();
    const wall = doc.walls[northWall(doc)];
    const ax = wall ? (doc.joints[wall.a]?.x ?? 0) : 0;
    const offset = (x0: number, x1: number) => (ax === 0 ? x0 : ax - x1);
    const both = ok(doc, { type: "addOpening", opId: "door", wall: northWall(doc), kind: "swing", offset: offset(2, 2.8), width: 0.8 },
      { type: "addOpening", opId: "win", wall: northWall(doc), kind: "window", offset: offset(2.8, 3.8), width: 1 });
    let seenBetween = 0;
    for (const turn of TURNS) {
      const fs = visible(faces3d(northItem(both)), turnAngles(turn));
      seenBetween += fs.filter((f) => flatAt(f, "x", 2.8)).length;
      expect(fs.filter((f) => flatAt(f, "x", 2.8)).every((f) => f.points.every((p) => p.z < 0.9 + 1e-9))).toBe(true);
      for (const f of fs) f.points.forEach((p, i) => {
        const q = f.points[(i + 1) % f.points.length] ?? p;
        expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeGreaterThan(1e-9); // no repeated corner, no spike
      });
    }
    expect(seenBetween).toBeGreaterThan(0);
    const room = facesAt(0, both).filter((f) => flatAt(f, "y", 3.9));
    expect(room.reduce((sum, f) => sum + faceArea(f), 0)).toBeCloseTo(5.8 * 2.5 - 0.8 * 2.1 - 1 * 1.2, 9);
  });

  it("an opening at a corner joint stays in the wall's clear span: no threshold or gap inside the corner", () => {
    const doc = roomDoc();
    const east = Object.values(doc.walls).find((w) => doc.joints[w.a]?.x === 6 && doc.joints[w.b]?.x === 6);
    if (!east) throw new Error("no east wall");
    const offset = doc.joints[east.a]?.y === 0 ? 0 : 4 - 0.8;
    const withDoor = ok(doc, { type: "addOpening", opId: "d", wall: east.id, kind: "swing", offset, width: 0.8 });
    let turnsShowingRoom = 0;
    for (const turn of TURNS) {
      const fs = visible(faces3d(wallItem(withDoor, east.id)), turnAngles(turn));
      const threshold = fs.filter((f) => f.color === STYLE_3D.floor);
      expect(threshold).toHaveLength(1);
      expect(threshold[0]?.points.every((p) => p.y > 0.1 - 1e-9 && p.y < 0.8 + 1e-9)).toBe(true);
      const room = fs.filter((f) => flatAt(f, "x", 5.9));
      if (room.length > 0) {
        turnsShowingRoom += 1;
        expect(room.reduce((sum, f) => sum + faceArea(f), 0)).toBeCloseTo(3.8 * 2.5 - 0.7 * 2.1, 9);
      }
    }
    expect(turnsShowingRoom).toBeGreaterThan(0);
  });

  it("on a diagonal wall the faces stay on the wall: every point within the thickness, the window's hole at its offsets", () => {
    const doc = freeWall({ x: 1, y: 1 }, { x: 4, y: 3 }, ["window", 1, 1]);
    const len = Math.hypot(3, 2);
    const u = { x: 3 / len, y: 2 / len };
    const s = (p: Point3) => (p.x - 1) * u.x + (p.y - 1) * u.y;
    const d = (p: Point3) => -(p.x - 1) * u.y + (p.y - 1) * u.x;
    for (const turn of TURNS) {
      const fs = visible(faces3d(wallItem(doc, "free/w0")), turnAngles(turn));
      expect(fs.length).toBeGreaterThan(0);
      expect(fs.every((f) => [f.points, ...f.holes].flat().every((p) => Math.abs(d(p)) < 0.1 + 1e-9 && s(p) > -1e-9 && s(p) < len + 1e-9))).toBe(true);
      const holes = fs.flatMap((f) => f.holes);
      expect(holes).toHaveLength(1);
      expect(holes[0]?.map((p) => [Math.round(s(p) * 1e6) / 1e6, Math.round(Math.abs(d(p)) * 1e6) / 1e6, p.z]).sort()).toEqual([[1, 0.1, 0.9], [1, 0.1, 2.1], [2, 0.1, 0.9], [2, 0.1, 2.1]]);
    }
  });

  it("the openings' order in the item doesn't matter", () => {
    const item = northItem(studio());
    const reversed: WallItem = { ...item, openings: [...item.openings].reverse() };
    for (const turn of TURNS) {
      const area = (w: WallItem) => visible(faces3d(w), turnAngles(turn)).filter((f) => flatAt(f, "y", 3.9) || flatAt(f, "y", 4.1)).reduce((sum, f) => sum + faceArea(f), 0);
      expect(area(reversed)).toBeCloseTo(area(item), 9);
    }
  });

  it("a thicker wall: its openings take the wall's thickness", () => {
    const doc = ok(studio(), { type: "setWallThickness", wallId: northWall(studio()), thickness: 0.3 });
    expect(northItem(doc).openings.length).toBeGreaterThan(0);
    expect(northItem(doc).openings.every((o) => o.thickness === 0.3)).toBe(true);
    const threshold = facesAt(0, doc).filter((f) => f.color === STYLE_3D.floor);
    expect(threshold[0]?.points.map((p) => Math.round(p.y * 1000) / 1000).sort()).toEqual([3.85, 3.85, 4.15, 4.15]);
  });

  it("property: every long face keeps its rectangle minus the openings inside the clear span, over random doors and windows, touching ones included", () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 60; run++) {
      const base = roomDoc();
      const wall = base.walls[northWall(base)];
      const ax = wall ? (base.joints[wall.a]?.x ?? 0) : 0;
      let doc = base;
      let x = random() * 0.6; // west to east along the centre line, from x = 0
      const placed: { x0: number; x1: number; door: boolean }[] = [];
      for (let n = 0; n < 4 && x < 5.4; n++) {
        const door = random() < 0.5;
        const width = 0.5 + Math.round(random() * 8) / 10;
        if (x + width > 6) break;
        const offset = ax === 0 ? x : ax - (x + width);
        const r = execute(doc, { type: "addOpening", opId: `p${n}`, wall: northWall(base), kind: door ? "swing" : "window", offset, width });
        if (r.ok) {
          doc = r.value.doc;
          placed.push({ x0: x, x1: x + width, door });
        }
        x += width + (random() < 0.4 ? 0 : Math.round(random() * 6) / 10);
      }
      // The room face runs x 0.1–5.9, the outer face −0.1–6.1; the clear span is 0.1–5.9.
      const cut = (lo: number, hi: number) => placed.reduce((sum, o) => sum + Math.max(0, Math.min(hi, o.x1, 5.9) - Math.max(lo, o.x0, 0.1)) * (o.door ? 2.1 : 1.2), 0);
      let turnsShowingRoom = 0;
      let turnsShowingOuter = 0;
      for (const turn of TURNS) {
        const fs = visible(faces3d(northItem(doc)), turnAngles(turn));
        const room = fs.filter((f) => flatAt(f, "y", 3.9));
        const outer = fs.filter((f) => flatAt(f, "y", 4.1));
        if (room.length > 0) {
          turnsShowingRoom += 1;
          expect(room.reduce((sum, f) => sum + faceArea(f), 0)).toBeCloseTo(5.8 * 2.5 - cut(0.1, 5.9), 9);
        }
        if (outer.length > 0) {
          turnsShowingOuter += 1;
          expect(outer.reduce((sum, f) => sum + faceArea(f), 0)).toBeCloseTo(6.2 * 2.5 - cut(-0.1, 6.1), 9);
        }
      }
      expect(turnsShowingRoom).toBeGreaterThan(0);
      expect(turnsShowingOuter).toBeGreaterThan(0);
    }
  });
});

describe("a door's threshold in 3D takes its span's floor (thresholds.01, AC-06)", () => {
  // The studio's room labelled in planks: the north door is an entrance, so its span shows the room's planks.
  const planks = (): Document => ok(studio(), { type: "labelZone", id: "R", at: { x: 1, y: 1 }, name: "Room", finish: { motif: "planks", colour: "#c8a27a", strength: 45, size: 0.2, angle: 90 } });
  const itemWith = (doc: Document, finishes: boolean): WallItem => {
    const item = view3dItems(doc, "s0", null, new Set(), finishes).find((i): i is WallItem => i.item === "wall" && i.wall === northWall(doc));
    if (!item) throw new Error("no north wall item");
    return item;
  };
  const thresholds = (faces: readonly Face3d[]): Face3d[] => faces.filter((f) => flatAt(f, "z", 0) && f.points.every((p) => p.y >= 3.9 - 1e-9 && p.y <= 4.1 + 1e-9));

  it("items: the door carries the span's floor with the room's colour and lines; finishes off, or unfinished, none", () => {
    const door = itemWith(planks(), true).openings.find((o) => !o.glass);
    expect(door?.floor?.color).toBe("#c8a27a");
    expect(door?.floor?.lines.length).toBeGreaterThan(0);
    expect(itemWith(planks(), false).openings.find((o) => !o.glass)?.floor).toBeNull();
    expect(itemWith(studio(), true).openings.find((o) => !o.glass)?.floor).toBeNull();
  });

  it("faces: the threshold under the door is in the room's colour, its lines 1 mm up; unfinished, the plain floor", () => {
    const faces = faces3d(itemWith(planks(), true));
    const under = thresholds(faces);
    expect(under.length).toBeGreaterThan(0);
    expect(under.every((f) => f.color === "#c8a27a")).toBe(true);
    const lines = faces.flatMap((f) => f.lines ?? []);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => near(l.a.z, STYLE_3D.patternLift) && near(l.b.z, STYLE_3D.patternLift))).toBe(true);
    expect(thresholds(faces3d(itemWith(studio(), true))).length).toBeGreaterThan(0);
    expect(thresholds(faces3d(itemWith(studio(), true))).every((f) => f.color === STYLE_3D.floor)).toBe(true);
  });
});
