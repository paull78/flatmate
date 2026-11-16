import { describe, expect, it } from "vitest";
import { execute, OBJECT_KINDS, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { shellBounds } from "../../src/view3d/camera3d";
import { capFaces, faces3d, itemKey } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { placer } from "../../src/view3d/local-frame";
import { openingFaces } from "../../src/view3d/opening-faces";
import { partSolids } from "../../src/view3d/parts/solids";
import { prism } from "../../src/view3d/prism";
import { slab, type Local } from "../../src/view3d/slab";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, Item3d, Point3, WallItem } from "../../src/view3d/types";
import { wallFaces } from "../../src/view3d/wall-faces";
import { roomDoc, wallBetween } from "../builders";
import { namedSizes, pieceOf } from "./parts-fixtures";
import { normal } from "./visible";

// Faces wound from outside (real3d.09, .12, AC-14): every face's points run counter-clockwise seen from outside its
// solid, so its Newell normal points out and both renderers cull back faces by winding. Checked builder by builder
// against what each knows of its solid; the MCP's raster3d test checks the whole picture (culled equals two-sided).

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const unit = (v: Point3): Point3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const centroid = (ps: readonly Point3[]): Point3 => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length });
const describeFace = (f: Face3d): string => `${f.owner} ${f.color} (${f.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(" ")})`;

/** A point on the face, just inside a convex corner of its outer ring (a holed face's centroid can fall in a hole). */
function onFace(f: Face3d): Point3 {
  const n = normal(f.points);
  const ps = f.points;
  for (let k = 0; k < ps.length; k++) {
    const [a, b, c] = [ps[(k + ps.length - 1) % ps.length], ps[k], ps[(k + 1) % ps.length]];
    if (!a || !b || !c) continue;
    const u = sub(b, a);
    const v = sub(c, b);
    const cross = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
    if (dot(cross, n) <= 1e-12) continue;
    const [ua, uc] = [unit(sub(a, b)), unit(sub(c, b))];
    return { x: b.x + 1e-3 * (ua.x + uc.x), y: b.y + 1e-3 * (ua.y + uc.y), z: b.z + 1e-3 * (ua.z + uc.z) };
  }
  return centroid(ps);
}

function inside(ring: readonly Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (a && b && (a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Wall material at `p`: inside the outline, between bottom and top, and not in an opening's gap. */
function wallAt(w: WallItem, p: Point3): boolean {
  if (!inside(w.outline, p) || p.z <= w.bottom || p.z >= w.top) return false;
  return !w.openings.some((o) => {
    const len = Math.hypot(o.end.x - o.start.x, o.end.y - o.start.y);
    const s = ((p.x - o.start.x) * (o.end.x - o.start.x) + (p.y - o.start.y) * (o.end.y - o.start.y)) / len;
    return s > 0 && s < len && p.z > o.bottom && p.z < o.top;
  });
}

/** Drawings with every wall arrangement the openings tests use, a divider with a window, decks turned, a room with a hole. */
function drawings(): [string, Document][] {
  const room = roomDoc();
  const north = wallBetween(room, { x: 0, y: 4 }, { x: 6, y: 4 });
  const south = wallBetween(room, { x: 0, y: 0 }, { x: 6, y: 0 });
  const openings = ok(room,
    { type: "addOpening", opId: "d", wall: north, kind: "swing", offset: 1 },
    { type: "addOpening", opId: "w", wall: north, kind: "window", offset: 3 },
    { type: "addOpening", opId: "w2", wall: south, kind: "window", offset: 1.2 },
    { type: "addOpening", opId: "d2", wall: south, kind: "swing", offset: 2.2 }, // touching the window: no jamb between them
    { type: "addOpening", opId: "s", wall: north, kind: "sliding", offset: 4.5, width: 0.8, side: "right" },
    { type: "addOpening", opId: "gs", wall: south, kind: "swing", offset: 3.2, width: 0.8, glazed: true },
    { type: "addOpening", opId: "gp", wall: south, kind: "sliding", offset: 4.5, width: 0.8, side: "right", glazed: true },
  );
  const half = ok(roomDoc(), { type: "addWall", opId: "pen", from: { at: { x: 2, y: 1.8 } }, to: { at: { x: 3.5, y: 1.8 } } }, { type: "setWallTop", wallId: "pen/w0", top: 1.1 });
  const free = ok(roomDoc(), { type: "addWall", opId: "f", from: { at: { x: 1, y: 1 } }, to: { at: { x: 4, y: 3 } } });
  const freeOpen = ok(free, { type: "addOpening", opId: "fd", wall: "f/w0", kind: "swing", offset: 0 }); // a door at a free end
  const divider = ok(roomDoc(), { type: "addWall", opId: "v", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } }, { type: "addOpening", opId: "vw", wall: "v/w0", kind: "window", offset: 1.5 });
  const decks = ok(roomDoc(), { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.5, y: 2 }, w: 2, d: 1.6, rotation: 30 },
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.5, y: 2 }, w: 1.6, d: 1.4, solid: true },
    { type: "addDeck", opId: "h", preset: "platform", at: { x: 4.5, y: 0.8 }, w: 1.2, d: 0.8, solid: false });
  const hole = ok(roomDoc(), ...[[2, 1.5], [3, 1.5], [3, 2.5], [2, 2.5]].map(([x, y], i, all): Command => {
    const [nx, ny] = all[(i + 1) % all.length] ?? [x, y];
    return { type: "addWall", opId: `c${i}`, from: { at: { x: x ?? 0, y: y ?? 0 } }, to: { at: { x: nx ?? 0, y: ny ?? 0 } } };
  }));
  const tall = ok(roomDoc(), { type: "setCeiling", height: 3.05 }); // a window over a door, one over a window (sills.04)
  const tallNorth = wallBetween(tall, { x: 0, y: 4 }, { x: 6, y: 4 });
  const stacked = ok(tall,
    { type: "addOpening", opId: "sd", wall: tallNorth, kind: "swing", offset: 1 },
    { type: "addOpening", opId: "sw", wall: tallNorth, kind: "window", offset: 1, width: 0.8, sill: 2.4, head: 2.9 },
    { type: "addOpening", opId: "lw", wall: tallNorth, kind: "window", offset: 3, sill: 0.9, head: 1.8 },
    { type: "addOpening", opId: "hw", wall: tallNorth, kind: "casement", offset: 3.2, width: 0.6, sill: 2.2, head: 2.9 });
  return [["openings", openings], ["stacked openings", stacked], ["half wall", half], ["free wall", free], ["free end door", freeOpen], ["divider with a window", divider], ["decks", decks], ["room with a hole", hole]];
}

function itemsOf(doc: Document): Item3d[] {
  if (!shellBounds(doc)) throw new Error("no walls");
  return [...view3dItems(doc, "s0", null, new Set(), false)];
}

describe("faces wound from outside (AC-14)", () => {
  it("a prism's sides face out along its ring's outward edge normals, convex or not, and its top faces up", () => {
    const rings: Point[][] = [
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }], // clockwise: prism makes it counter-clockwise
      [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 }], // an L
      Array.from({ length: 12 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 6), y: Math.sin((k * Math.PI) / 6) })),
      [...Array.from({ length: 5 }, (_, k) => ({ x: 2 * Math.cos(k * 0.2), y: 2 * Math.sin(k * 0.2) })), ...Array.from({ length: 5 }, (_, k) => ({ x: 0.5 * Math.cos(0.8 - k * 0.2), y: 0.5 * Math.sin(0.8 - k * 0.2) }))], // a spiral's wedge
    ];
    for (const ring of rings) {
      const faces = prism("p", ring, 0.2, 1.1, STYLE_3D.wall);
      const top = faces.at(-1);
      expect(top && normal(top.points).z).toBeGreaterThan(0);
      for (const f of faces.slice(0, -1)) {
        const [a, b] = [f.points[0], f.points[1]];
        if (!a || !b) throw new Error("a side has points");
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const n = unit(normal(f.points));
        expect(inside(ring, { x: mid.x - 1e-3 * n.x, y: mid.y - 1e-3 * n.y }), describeFace(f)).toBe(true);
        expect(inside(ring, { x: mid.x + 1e-3 * n.x, y: mid.y + 1e-3 * n.y }), describeFace(f)).toBe(false);
      }
    }
  });

  it("a slab's faces point away from its middle, at any rotation", () => {
    const profiles: Local[][] = [
      [{ a: 0, z: 0 }, { a: 1, z: 0 }, { a: 3, z: 2 }, { a: 3, z: 2.3 }, { a: 0, z: 0.3 }],
      [{ a: 0.5, z: 1 }, { a: 2.5, z: 1 }, { a: 2.5, z: 3 }, { a: 0.5, z: 3 }],
    ];
    for (const rotation of [0, 30, 135, 270]) {
      const item = pieceOf("openStair", "standard", 0.9, 3, 2.3, rotation);
      for (const profile of profiles) {
        const faces = slab("s", item, STYLE_3D.stair, placer(item), profile, -0.45, -0.41);
        const c = centroid(faces.flatMap((f) => f.points));
        for (const f of faces) expect(dot(normal(f.points), sub(centroid(f.points), c)), describeFace(f)).toBeGreaterThan(0);
      }
    }
  });

  it("what stands in an opening: joinery faces away from each block's middle; a pane is two faces back to back", () => {
    let panes = 0;
    let blocks = 0;
    for (const [label, doc] of drawings()) {
      for (const item of itemsOf(doc)) {
        if (item.item !== "wall") continue;
        const faces = openingFaces(itemKey(item), item, STYLE_3D);
        const glass = faces.filter((f) => f.color === STYLE_3D.glass);
        expect(glass.length % 2).toBe(0);
        for (let k = 0; k + 1 < glass.length; k += 2) {
          const [a, b] = [glass[k], glass[k + 1]];
          if (!a || !b) continue;
          panes++;
          expect(dot(unit(normal(a.points)), unit(normal(b.points)))).toBeCloseTo(-1, 9);
          expect(new Set(a.points.map((p) => `${p.x},${p.y},${p.z}`))).toEqual(new Set(b.points.map((p) => `${p.x},${p.y},${p.z}`)));
        }
        const joinery = faces.filter((f) => f.color !== STYLE_3D.glass);
        for (let k = 0; k < joinery.length; k += 5) {
          const block = joinery.slice(k, k + 5);
          const c = centroid(block.flatMap((f) => f.points));
          blocks++;
          for (const f of block) expect(dot(normal(f.points), sub(centroid(f.points), c)), `${label}: ${describeFace(f)}`).toBeGreaterThan(0);
        }
      }
    }
    expect(panes).toBeGreaterThanOrEqual(3);
    expect(blocks).toBeGreaterThanOrEqual(12);
  });

  it("every wall face has wall behind it and none 12 cm in front; thresholds face up", () => {
    const wrong: string[] = [];
    for (const [label, doc] of drawings()) {
      for (const item of itemsOf(doc)) {
        if (item.item !== "wall") continue;
        const faces = [...wallFaces(itemKey(item), item, STYLE_3D), ...capFaces(itemKey(item), item, STYLE_3D)];
        for (const f of faces) {
          const n = unit(normal(f.points));
          if (f.color === STYLE_3D.floor) {
            if (n.z < 0.99) wrong.push(`${label}: threshold ${describeFace(f)}`);
            continue;
          }
          const p = onFace(f);
          const behind = { x: p.x - 1e-4 * n.x, y: p.y - 1e-4 * n.y, z: p.z - 1e-4 * n.z };
          // In front: 12 cm out, past the tip a wall's outline runs to inside a joint (its clear span's end face stays inside it).
          const front = { x: p.x + 0.12 * n.x, y: p.y + 0.12 * n.y, z: p.z + 0.12 * n.z };
          if (!wallAt(item, behind) || wallAt(item, front)) wrong.push(`${label}: ${describeFace(f)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("floors face up; decks face out from their middle", () => {
    for (const [, doc] of drawings()) {
      for (const item of itemsOf(doc)) {
        if (item.item === "floor") for (const f of faces3d(item)) expect(normal(f.points).z).toBeGreaterThan(0);
        if (item.item !== "deck") continue;
        const c = { ...centroid((item.fills[0]?.ring ?? []).map((p) => ({ ...p, z: 0 }))), z: (item.bottom + item.top) / 2 };
        for (const f of faces3d(item)) expect(dot(normal(f.points), sub(centroid(f.points), c)), describeFace(f)).toBeGreaterThan(0);
      }
    }
  });

  it("every part of every kind, its panels included, faces out from the part's middle, at every named size and configuration, turned", () => {
    const wrong: string[] = [];
    for (const k of OBJECT_KINDS) {
      if (k.stair) continue;
      for (const s of namedSizes(k)) {
        for (const rotation of [0, 30, 90]) {
          const item = pieceOf(k.id, s.config, s.w, s.d, s.h, rotation, { x: 5, y: 5 }, 0.3);
          for (const part of partSolids("piece/p", item, STYLE_3D)) {
            const c = { ...centroid(part.ring.map((p) => ({ ...p, z: 0 }))), z: (part.bottom + part.top) / 2 };
            if (!inside(part.ring, c)) continue; // a shaped outline that isn't convex: the prism test covers its sides
            for (const f of part.faces) if (dot(normal(f.points), sub(centroid(f.points), c)) <= 0) wrong.push(`${s.label} at ${rotation}°: ${describeFace(f)}`);
          }
        }
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it("a storage stair's cubby doors stand on both long sides, each facing out from the stair", () => {
    for (const rotation of [0, 30, 90]) {
      const item = pieceOf("storageStair", "standard", 0.9, 2.6, 2.15, rotation);
      const across = { x: Math.cos((rotation * Math.PI) / 180), y: Math.sin((rotation * Math.PI) / 180), z: 0 };
      const offAxis = (p: Point3): number => dot(sub({ ...p, z: 0 }, { ...item.centre, z: 0 }), across);
      const doors = faces3d(item).filter((f) => f.points.every((p) => Math.abs(Math.abs(offAxis(p)) - 0.452) < 1e-6));
      expect(doors.length).toBeGreaterThan(4);
      const sides = new Set<number>();
      for (const f of doors) {
        const side = Math.sign(offAxis(centroid(f.points)));
        sides.add(side);
        expect(dot(normal(f.points), across) * side, describeFace(f)).toBeGreaterThan(0);
      }
      expect(sides).toEqual(new Set([1, -1]));
    }
  });
});
