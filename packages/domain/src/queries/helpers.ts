import { add, distance, dot, scale, sub } from "../geometry";
import { wallEnds, wallFrame, type WallFrame } from "../graph";
import { isFloorWall, type Document, type Opening } from "../model";
import { wallOutlines } from "./outlines";
import { faceAt } from "./zones";
import { openingShown, type Level } from "./levels";
import type { Point } from "@fm/protocol";

/** Endpoints and centreline length of a wall, for its editable helper dimension (spec: tools). */
export function wallHelperDimension(doc: Document, wallId: string): { a: Point; b: Point; length: number } | null {
  const ends = wallEnds(doc, wallId);
  return ends ? { a: ends.a, b: ends.b, length: distance(ends.a, ends.b) } : null;
}

/** What bounds one side of a chain piece: one of the wall's joints, or an opening. */
export type ChainSide = { kind: "joint"; joint: "a" | "b" } | { kind: "opening"; id: string };
/** One piece of a wall's dimension chain, `start` to `end` metres from joint a along the wall, `from`/`to` on the measured face. */
export type ChainPiece = { role: "gap" | "opening"; start: number; end: number; length: number; from: Point; to: Point; left: ChainSide; right: ChainSide };
/** The face a wall's dimensions measure: its side of a → b, and where the face starts and ends, in metres from joint a. */
export type WallFace = { side: "left" | "right"; faceStart: number; faceEnd: number };
/** A wall's clear dimension chain: its face and the pieces, the first starting at faceStart, the last ending at faceEnd. */
export type WallChain = WallFace & { pieces: ChainPiece[] };

/** Pieces shorter than this (touching openings, an opening at the face's end) are left out. */
const MIN_PIECE = 1e-6;
/** How far an outline vertex may lie from the face line and still be on it. */
const ON_FACE = 1e-3;
/** How far beyond each face the room probe looks. */
const PROBE = 0.01;

/** Whether a room lies just beyond each face at the wall's middle, by a probe PROBE past the face. */
function roomSides(doc: Document, f: WallFrame): { left: boolean; right: boolean } {
  const mid = add(f.a, scale(f.dir, f.length / 2));
  const room = (s: 1 | -1): boolean => faceAt(doc, add(mid, scale(f.left, s * (f.half + PROBE)))) !== null;
  return { left: room(1), right: room(-1) };
}

/**
 * Which sides of a wall face a room, looking from joint a to b, with the left normal: a shell wall has a room on one
 * side only, a divider on both, a free wall on neither (the 3D view hides shell walls facing the camera, heights.19).
 * Null when the wall is missing.
 */
export function wallRoomSides(doc: Document, wallId: string): { left: boolean; right: boolean; normal: Point } | null {
  const f = wallFrame(doc, wallId);
  return f ? { ...roomSides(doc, f), normal: f.left } : null;
}

/** What a wall side faces: a room, by its face key; outside; or, for a wall standing on a loft, the loft (spec: levels). */
export type SideFacing = { kind: "room"; key: string } | { kind: "outside" } | { kind: "loft" };

const ON_LOFT: SideFacing = { kind: "loft" };

/**
 * What each side of a wall faces, looking from joint a to b (surfaces step 04, home.18). A floor wall is probed as
 * `wallRoomSides` probes, a little past each face at its middle: a room, else outside. A wall standing on a deck stands
 * on a loft (I21 lets no lower deck hold one), which has no room and no outside, so both its sides face the loft and
 * the floor's rooms under it are never asked. Null when the wall is missing.
 */
export function wallSideRooms(doc: Document, wallId: string): { left: SideFacing; right: SideFacing } | null {
  const f = wallFrame(doc, wallId);
  const wall = doc.walls[wallId];
  if (!f || !wall) return null;
  if (!isFloorWall(wall)) return { left: ON_LOFT, right: ON_LOFT };
  const mid = add(f.a, scale(f.dir, f.length / 2));
  const side = (s: 1 | -1): SideFacing => {
    const key = faceAt(doc, add(mid, scale(f.left, s * (f.half + PROBE))))?.key;
    return key === undefined ? { kind: "outside" } : { kind: "room", key };
  };
  return { left: side(1), right: side(-1) };
}

/**
 * Where the wall's face on `side` of a → b starts and ends, in metres from joint a. The extent is the outline's, so
 * corners, T-junctions, mixed thickness and bevels end the face as drawn (spec: walls-rooms). Null when the wall is missing
 * or no outline vertex lies on the face line.
 */
export function faceExtent(doc: Document, wallId: string, side: "left" | "right"): { start: number; end: number } | null {
  const f = wallFrame(doc, wallId);
  if (!f) return null;
  const s = side === "left" ? 1 : -1;
  const along = (wallOutlines(doc).get(wallId) ?? [])
    .filter((p) => Math.abs(dot(sub(p, f.a), f.left) - s * f.half) <= ON_FACE)
    .map((p) => dot(sub(p, f.a), f.dir));
  return along.length > 0 ? { start: Math.min(...along), end: Math.max(...along) } : null;
}

function faceOf(doc: Document, wallId: string, f: WallFrame): WallFace {
  // The side facing a room; a divider (rooms on both sides) or a free wall (none) takes the left of a → b.
  const rooms = roomSides(doc, f);
  const side = rooms.right && !rooms.left ? "right" : "left";
  const extent = faceExtent(doc, wallId, side);
  return extent ? { side, faceStart: extent.start, faceEnd: extent.end } : { side, faceStart: 0, faceEnd: f.length };
}

/** The face a wall's dimensions measure (ux-polish.35); null when the wall is missing. */
export function wallFace(doc: Document, wallId: string): WallFace | null {
  const f = wallFrame(doc, wallId);
  return f ? faceOf(doc, wallId, f) : null;
}

/**
 * The wall's clear dimension chain (ux-polish.35): its room-side face from start to end, cut at its openings' edges,
 * so the pieces are the gaps and the openings' widths, in order, adding up to the face's clear length. An opening
 * piece is always the opening's full width: one reaching past the face (into a corner, or off the wall while a refused
 * preview) sticks out of the face and the gap it covers is left out. `moving` replaces the opening with its id, or
 * joins the chain when the wall has no opening with that id (a preview). The chain is always a `level`'s (spec: levels): it
 * measures the openings drawn solid there and the dashed ones that overlap none of those along the wall (review.09), so a
 * loft window over a floor window is measured at the loft only.
 */
export function wallChain(doc: Document, wallId: string, level: Level, moving?: Opening): WallChain | null {
  const f = wallFrame(doc, wallId);
  if (!f) return null;
  const face = faceOf(doc, wallId, f);
  const line = scale(f.left, (face.side === "left" ? 1 : -1) * f.half);
  const at = (t: number): Point => add(add(f.a, scale(f.dir, t)), line);
  const own = atLevel(doc, Object.values(doc.openings).filter((o) => o.wall === wallId && o.id !== moving?.id), level);
  const openings = [...own, ...(moving && moving.wall === wallId ? [moving] : [])].sort((p, q) => p.offset - q.offset || (p.id < q.id ? -1 : 1));
  const pieces: ChainPiece[] = [];
  const push = (role: ChainPiece["role"], start: number, end: number, left: ChainSide, right: ChainSide): void => {
    if (end - start > MIN_PIECE) pieces.push({ role, start, end, length: end - start, from: at(start), to: at(end), left, right });
  };
  let cursor = face.faceStart;
  let left: ChainSide = { kind: "joint", joint: "a" };
  for (const o of openings) {
    const side: ChainSide = { kind: "opening", id: o.id };
    push("gap", cursor, o.offset, left, side);
    push("opening", o.offset, o.offset + o.width, side, side);
    cursor = o.offset + o.width;
    left = side;
  }
  push("gap", cursor, face.faceEnd, left, { kind: "joint", joint: "b" });
  return { ...face, pieces };
}

/** The openings a level's chain measures (review.09): solid ones, then dashed ones overlapping none of them. */
function atLevel(doc: Document, openings: readonly Opening[], level: Level): Opening[] {
  const solid = openings.filter((o) => openingShown(doc, o.id, level) === "cut");
  const clear = (o: Opening): boolean => solid.every((c) => o.offset + o.width <= c.offset || c.offset + c.width <= o.offset);
  return [...solid, ...openings.filter((o) => openingShown(doc, o.id, level) === "above" && clear(o))];
}
