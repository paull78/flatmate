import type { Point } from "@fm/protocol";
import { convexIntersection, convexOverlap } from "../geometry";
import { kindOf, seatsUnderAt } from "../kinds";
import { memo } from "../memo";
import type { Document } from "../model";
import { footprintQuad, sizeOf } from "./footprints";
import { solids } from "./vertical";

// The tuck rule (spec "Seating: the tuck rule"; seating.14, .16): against a piece you sit at, in a configuration you
// sit at (`seatsUnder`), standing on the same surface, a seat is solid only in its backrest's strip (its kind's `seat` depth, pieces.09), so its seat
// part may go under. Fit (solidsCollide) only picks the rings to test here; ranges still decide as for any pair.

/**
 * How a piece takes part in the tuck rule: a seat, with its back strip in world space; a piece a seat may tuck under
 * in the configuration it shows ("under"); or neither (null).
 */
export type TuckRole = { seat: readonly Point[] } | "under" | null;

/** A piece's kind, configuration and footprint pose: its back edge's middle `at`, rotation and size. */
export type TuckPose = { kind: string; config: string; at: Point; rotation: number; w: number; d: number };

/**
 * A seat's back strip: its footprint's back `back` metres, its backrest (the whole footprint if shallower), turned and
 * placed; no strip for a seat with no backrest, which is then solid nowhere against a piece you sit at (pieces.09).
 */
export function seatStrip(pose: Omit<TuckPose, "kind" | "config">, back: number): Point[] {
  return back > 0 ? footprintQuad(pose.at, pose.w, Math.min(pose.d, back), pose.rotation) : [];
}

/** The role of a piece of `pose.kind` in `pose.config`: a seat by its kind, "under" by the kind's `seatsUnder`. */
export function tuckRole(pose: TuckPose): TuckRole {
  const back = kindOf(pose.kind)?.seat ?? null;
  if (back !== null) return { seat: seatStrip(pose, back) };
  return seatsUnderAt(pose.kind, pose.config) ? "under" : null;
}

/** A placement's role, from its object's kind and size and the configuration it shows; null for a broken one. */
export function placementTuck(doc: Document, placementId: string): TuckRole {
  const p = Object.hasOwn(doc.placements, placementId) ? doc.placements[placementId] : undefined;
  const object = p && doc.objects[p.object];
  const size = p ? sizeOf(doc, p) : null;
  return p && object && size ? tuckRole({ kind: object.kind, config: p.config, at: p.at, rotation: p.rotation, w: size.w, d: size.d }) : null;
}

/** Something tested for a collision: its ring, its role, and what it stands on (undefined for walls and decks). */
export type TuckSolid = { ring: readonly Point[]; tuck?: TuckRole; surface?: string | null };

const seatRing = (s: TuckSolid): readonly Point[] => (typeof s.tuck === "object" && s.tuck !== null ? s.tuck.seat : s.ring);

/** The rings a pair collides by: a seat's strip against an "under" piece on the same surface (either order), else their own. */
export function collisionRings(a: TuckSolid, b: TuckSolid): [readonly Point[], readonly Point[]] {
  if (a.surface === undefined || a.surface !== b.surface) return [a.ring, b.ring];
  return [b.tuck === "under" ? seatRing(a) : a.ring, a.tuck === "under" ? seatRing(b) : b.ring];
}

/** A seat partly under a piece it may tuck under: their placements, the state, and where their full shapes overlap. */
export type Tuck = { seat: string; table: string; state: string; overlap: readonly Point[] };

/**
 * Every seat and "under" piece in one state, on one surface, whose full fit shapes overlap beyond touching, with the
 * overlap ring; by seat, then table, in placement order. Heights are not compared. Shapes are read by their convex
 * parts (catalog.16): one Tuck per pair of parts that overlap, so a seat under both arms of an `L` desk gives two,
 * whose overlaps never overlap (the parts are disjoint).
 */
export const tucks = memo((doc: Document): readonly Tuck[] => {
  const pieces = solids(doc).flatMap((s) =>
    s.key.table === "placements" && s.state !== null ? [{ id: s.key.id, ring: s.ring, state: s.state, surface: doc.placements[s.key.id]?.deck ?? null, tuck: placementTuck(doc, s.key.id) }] : [],
  );
  const tables = pieces.filter((t) => t.tuck === "under");
  const out: Tuck[] = [];
  for (const seat of pieces) {
    if (typeof seat.tuck !== "object" || seat.tuck === null) continue;
    for (const table of tables) {
      if (seat.state !== table.state || seat.surface !== table.surface || !convexOverlap(seat.ring, table.ring)) continue;
      out.push({ seat: seat.id, table: table.id, state: seat.state, overlap: convexIntersection(seat.ring, table.ring) });
    }
  }
  return out;
});
