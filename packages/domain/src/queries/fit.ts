import type { Point } from "@fm/protocol";
import { MESSAGES, collisionMessage, type NamedRange, type Violation } from "../errors";
import { boxOf, convexOverlap, overlappingPairs, type Box } from "../geometry";
import { configOf, configsOf, defaultSize, isBeam, isRug, isWell, stairRuleOf, type OrCeiling } from "../kinds";
import { EPS, type Document } from "../model";
import { armsPlaceable, type Arms } from "../arms";
import { MIN_WINDER_EXTRA } from "../stairs";
import { placedPiece } from "../shapes";
import { deckLabel, deckView } from "./decks";
import { fitParts, fitShapes, footprintQuad, footprints, placementKey, placementRoom, quadCentre, roomOf, wellRoom } from "./footprints";
import { deckStanding, type DeckStanding } from "./stands-on";
import { covers, wellPart } from "./wells";
import { collisionRings, tuckRole, type TuckRole } from "./tucks";
import { clearsPitchLine, clearsUnderside, fitSolids, pitchLineAt, undersideAt, undersideOver, type PitchLine, type StairPose, type Underside } from "./underside";
import { ceilingOver, halfWallTop, heightsOf, placementRange, rangeOf, rangesOverlap, type Heights, type Range, type Solid } from "./vertical";

// The fit invariants I10 and I11 (spec: layouts) for a whole document, and the same test for one new placement
// (`placementFit`): they live side by side because they must agree (ux-polish.12), sharing one predicate in height
// (heights.12, .27), one against decks (decks.11) and one ceiling test.

/**
 * `underside` is an open flight's (queries/underside.ts): a piece wholly under it clears it; `pitch` a flight kind's: anything wholly above it clears it (riser.08). `tuck` is a placement's
 * role in the tuck rule, `surface` what it stands on (a deck's ID or null; undefined for walls and decks) and `rug`
 * whether it is a rug (catalog.24). `well` is a wheel well's part outside the walls, which a taller piece may cover (trailer.09).
 */
export type Box3 = { ring: readonly Point[]; box: Box; range: Range; underside?: Underside | null; pitch?: PitchLine | null; tuck?: TuckRole; surface?: string | null; rug?: boolean; well?: readonly Point[] | null };

/**
 * The collision rule in height: boxes near, ranges overlapping (touching is not), neither wholly under the other's
 * underside (an open flight's, stairs.03), shapes overlapping: a seat's by its back strip against a piece it may tuck
 * under on the same surface (queries/tucks.ts, seating.14). Two placements never collide when either is a rug
 * (catalog.15, .24): walls and decks, whose `surface` is undefined, still do. Decks use it too.
 */
export function solidsCollide(a: Box3, b: Box3): boolean {
  if ((a.rug === true || b.rug === true) && a.surface !== undefined && b.surface !== undefined) return false;
  // A wheel well runs under walls (trailer.07): it meets no wall, and a taller piece enclosing its part outside them covers it (trailer.09).
  if ((a.well || b.well) && (a.surface === undefined || b.surface === undefined)) return false;
  if (!boxesNear(a.box, b.box, EPS) || !rangesOverlap(a.range, b.range) || clearsUnderside(a, b) || clearsUnderside(b, a) || clearsPitchLine(a, b) || clearsPitchLine(b, a)) return false;
  if (a.well && covers(b.ring, a.well, b.range.top, a.range.top)) return false;
  if (b.well && covers(a.ring, b.well, a.range.top, b.range.top)) return false;
  const [ra, rb] = collisionRings(a, b);
  return convexOverlap(ra, rb);
}

/** The refusal for two placements that collide: under an open flight, the piece and the underside at its low end (stairs.11). */
function pieceMessage<T extends Box3>(p: T, q: T, named: (x: T) => NamedRange, state: string): string {
  const [flight, piece] = p.underside ? [p.underside, q] : q.underside ? [q.underside, p] : [null, q];
  // Reaching down past its pitch line from above, a piece hits the steps, not the underside (riser.08).
  if (flight === null || piece.range.bottom >= undersideOver(flight, piece.ring)) {
    // By name, not by ID, so a stair's hint and its toast, under different opIds, read the same (stairdraw.23).
    const [a, b] = named(p).name <= named(q).name ? [named(p), named(q)] : [named(q), named(p)];
    return collisionMessage({ with: "piece", a, b, state });
  }
  return collisionMessage({ with: "underside", piece: named(piece), stair: flight.label, underside: undersideOver(flight, piece.ring), state });
}

/**
 * How a piece meets a deck when they overlap on plan. On the deck it stands on (`own`), the deck is solid up to its
 * top: a piece whose bottom is below the top, as a "ceiling" elevation can put it, "collides"; one on the top touches.
 * On any other deck: their ranges overlap ("collides", the rule in height), or the piece is above the deck's underside
 * ("above": it must lie wholly below it, decks.11), except a `beam`, which meets a deck by range alone and passes over a
 * platform (beams.21). Else null.
 */
function deckClash(piece: Box3, deck: Box3, own: boolean, beam = false): "collides" | "above" | null {
  if (!boxesNear(piece.box, deck.box, EPS) || !convexOverlap(piece.ring, deck.ring)) return null;
  if (own) return piece.range.bottom < deck.range.top - EPS ? "collides" : null;
  if (clearsPitchLine(piece, deck)) return null;
  if (rangesOverlap(piece.range, deck.range)) return "collides";
  if (beam) return null;
  return piece.range.top > deck.range.bottom + EPS ? "above" : null;
}

/** Whether a shape's top is above the lowest ceiling over it, beyond the tolerance. */
function aboveCeiling(doc: Document, s: Pick<Box3, "ring" | "range">): boolean {
  return s.range.top > ceilingOver(doc, s.ring) + EPS;
}

/** The label of a placement's configuration, for kinds with more than one (heights.14); else null. */
function configLabel(doc: Document, placementId: string): string | null {
  const p = doc.placements[placementId];
  const object = p && doc.objects[p.object];
  return object && p && configsOf(object).length > 1 ? (configOf(object, p.config)?.label ?? null) : null;
}

/**
 * I10 (inside one room, or inside the deck it stands on; off every wall body and deck it meets in height; wholly below
 * every deck it overlaps but doesn't stand on), I11 (no overlap in plan and height with another placement in the same
 * state) and I17 for pieces (no top above the ceiling), each placement by its fit shape (shapefit.01), as violations
 * naming the placements, walls and decks involved. Collisions test a piece's convex parts (catalog.16): the parts of
 * one piece are never paired, and each piece and wall, deck or other piece gives one violation however many parts
 * meet. Nothing to do, and no rooms computed, without placements.
 */
export function fitViolations(doc: Document): Violation[] {
  const quads = fitShapes(doc);
  if (quads.size === 0) return [];
  // Messages name the object and the state, so a refused edit can show them as they are (layout-states.18), with
  // their ranges (heights.14, .32).
  const objectName = (id: string): string => {
    const p = doc.placements[id];
    return (p && doc.objects[p.object]?.name) || "Object";
  };
  const stateName = (id: string): string => {
    const p = doc.placements[id];
    return (p && doc.states[p.state]?.name) || "a layout";
  };
  const deckName = (id: string): string => {
    const deck = deckView(doc, id);
    return deck ? deckLabel(deck) : "Deck";
  };
  const named = (x: Solid): NamedRange => ({ name: objectName(x.key.id), ...x.range });
  const out: Violation[] = [];
  const all = fitSolids(doc);
  // A deck is a box per slab cell and a piece one per part: one violation per piece and wall, deck or piece.
  const met = new Set<string>();
  const once = (...keys: string[]): boolean => {
    const k = keys.join(" ");
    if (met.has(k)) return false;
    met.add(k);
    return true;
  };

  for (const [i, j] of overlappingPairs(all.map((x) => x.box), EPS)) {
    const a = all[i];
    const b = all[j];
    if (!a || !b || (a.key.table === b.key.table && a.key.id === b.key.id)) continue; // two parts of one piece
    // Solids list walls, then decks, then placements: a placement paired with a wall or a deck comes second.
    const [first, second] = b.key.table === "placements" && a.key.table !== "placements" ? [b, a] : [a, b];
    // Walls and decks among themselves are I4–I7's and I18's (decks.ts).
    if (first.key.table !== "placements") continue;
    const state = stateName(first.key.id);
    if (second.key.table === "walls") {
      // A beam's ends rest in walls (beams.05): it meets no wall or column, only pieces and decks.
      if (first.beam === true || !solidsCollide(first, second) || !once("walls", first.key.id, second.key.id)) continue;
      const message = doc.walls[second.key.id]?.column
        ? collisionMessage({ with: "column", piece: named(first), column: { name: "Column", ...second.range }, state })
        : collisionMessage({ with: "wall", piece: named(first), halfWall: halfWallTop(doc, second.key.id), state });
      out.push({ invariant: "I10", message, entities: [first.key, second.key] });
    } else if (second.key.table === "decks") {
      const clash = deckClash(first, second, doc.placements[first.key.id]?.deck === second.key.id, first.beam === true);
      if (clash === null || !once("decks", first.key.id, second.key.id)) continue;
      const deck = deckName(second.key.id);
      const piece = named(first);
      const message = clash === "collides" ? collisionMessage({ with: "deck", piece, deck: { name: deck, ...second.range }, state }) : collisionMessage({ with: "aboveDeck", piece, deck, state });
      out.push({ invariant: "I10", message, entities: [first.key, second.key] });
    } else if (second.key.table === "placements" && first.state === second.state && solidsCollide(first, second)) {
      const [p, q] = first.key.id < second.key.id ? [first, second] : [second, first];
      if (once("placements", p.key.id, q.key.id)) out.push({ invariant: "I11", message: pieceMessage(p, q, named, state), entities: [p.key, q.key] });
    }
  }
  for (const [id, ring] of quads) {
    const range = placementRange(doc, id);
    if (range === null || !aboveCeiling(doc, { ring, range })) continue;
    const message = collisionMessage({ with: "ceiling", name: objectName(id), config: configLabel(doc, id), top: range.top, ceiling: ceilingOver(doc, ring), state: stateName(id) });
    out.push({ invariant: "I17", message, entities: [placementKey(id)] });
  }
  // A footprint across a wall also leaves the room's ring (or its deck); the overlap is the reason to report
  // (layout-states.43). A piece on a deck lies inside the deck instead of one room (decks.04).
  const onWall = new Set(out.filter((v) => v.entities[1]?.table === "walls").map((v) => v.entities[0]?.id));
  const outside: Violation[] = [];
  const partsOf = fitParts(doc);
  for (const [id, ring] of quads) {
    if (onWall.has(id)) continue;
    const surface = doc.placements[id]?.deck ?? null;
    if (surface === null) {
      if (placementRoom(doc, id) === null) outside.push({ invariant: "I10", message: `${objectName(id)} in ${stateName(id)} is not inside a room`, entities: [placementKey(id)] });
      continue;
    }
    const deck = deckView(doc, surface);
    const why = deck ? deckStanding(doc, deck, partsOf.get(id) ?? [ring], quadCentre(footprints(doc).get(id) ?? ring)) : "outsideDeck";
    if (why !== null) outside.push({ invariant: "I10", message: MESSAGES[why](objectName(id), deckName(surface), stateName(id)), entities: [placementKey(id), { table: "decks", id: surface }] });
  }
  return [...out, ...outside];
}

export type PlacementCandidate = {
  kind?: string;
  object?: string;
  state: string;
  at: Point;
  rotation: number;
  config: string;
  w?: number;
  d?: number;
  h?: number;
  z?: OrCeiling;
  /** An `L` piece's arms (catalog.17); else the object's, else the kind's default. */
  arms?: Arms;
  /** What it stands on: a deck's ID, or null for the floor (decks.16). */
  surface: string | null;
};
/**
 * Why a piece doesn't fit, by the first rule it breaks: a wall body, a deck (in height, or above one it doesn't stand
 * on), another placement in the state, the ceiling, no single room (on the floor), or outside its deck; null when it fits.
 */
export type PlacementFit = { fits: boolean; reason: "wall" | "deck" | "object" | "ceiling" | "room" | Exclude<DeckStanding, null> | null };

/** Whether two boxes come within 2 × margin of each other: the test `overlappingPairs` makes before an exact one. */
function boxesNear(a: Box, b: Box, margin: number): boolean {
  const gap = 2 * margin;
  return !(b.minX > a.maxX + gap || a.minX > b.maxX + gap || b.minY > a.maxY + gap || a.minY > b.maxY + gap);
}

/**
 * Whether a new placement would pass I10, I11 and I17, testing only its own footprint (ux-polish.12): a new object of
 * `kind` or an existing `object` added to `state` on `surface`, sized by `w` and `d` and raised by `h` and `z` when
 * given, else by the object's or the kind's. The reason names the first rule it breaks (`PlacementFit`); an unknown
 * kind, object or configuration never fits, with no reason. Assumes the rest of the document is valid, as
 * `placeObject` needs it to be.
 */
export function placementFit(doc: Document, c: PlacementCandidate): PlacementFit {
  const existing = c.object !== undefined ? doc.objects[c.object] : undefined;
  const kind = c.object !== undefined ? existing?.kind : c.kind;
  const size = existing ?? (kind !== undefined ? defaultSize(kind) : null);
  const w = c.w ?? size?.w[c.config];
  const d = c.d ?? size?.d[c.config];
  const stored = size ? heightsOf(size, c.config) : null;
  if (kind === undefined || !configOf({ kind }, c.config) || w === undefined || d === undefined || !stored) {
    return { fits: false, reason: null };
  }
  const arms = c.arms ?? existing?.arms;
  if (!sizePlaceable(kind, w, d, arms)) return { fits: false, reason: null }; // a size its kind's shape rules refuse (sizing.04, .32)
  const { ring, parts, centre, rug, well, beam } = candidateShape(kind, c.at, w, d, c.rotation, arms);
  const pose = { kind, at: c.at, rotation: c.rotation, w, d, riser: existing?.riser ?? null };
  return footprintFit(doc, ring, c.state, { h: c.h ?? stored.h, z: c.z ?? stored.z }, c.surface, [], centre, pose, tuckRole({ ...pose, config: c.config }), parts, rug, well, beam);
}

/**
 * Whether a new piece of `kind` at w × d keeps the size rules of its kind's shape, the ones validation checks but no
 * collision does (sizing.04, .32): an `L` box holds its arms, and a winder is deeper than wide by `MIN_WINDER_EXTRA`
 * (I19, steps.09). The one test the ghost's fit and the place command's share, so a green ghost is placed.
 */
export function sizePlaceable(kind: string, w: number, d: number, arms?: Arms): boolean {
  return armsPlaceable(kind, w, d, arms) && (stairRuleOf(kind)?.shape !== "winder" || d >= w + MIN_WINDER_EXTRA - 0.0005);
}

/** A candidate piece's shape: its outline `ring`, its convex `parts` (catalog.16), its footprint's `centre`, and whether it is a rug (catalog.24), a well or a beam. */
export type CandidateShape = { ring: readonly Point[]; parts: readonly (readonly Point[])[]; centre: Point | null; rug: boolean; well: boolean; beam: boolean };

/**
 * A candidate piece as fit and landing test it: the fit shape of `kind` (its footprint quad without a kind), w × d
 * anchored at `at` at `rotation`, with `arms` for an `L` kind (else its default), and its footprint's centre (decks.11).
 */
export function candidateShape(kind: string | undefined, at: Point, w: number, d: number, rotation: number, arms?: Arms): CandidateShape {
  const quad = footprintQuad(at, w, d, rotation);
  const shape = kind === undefined ? { outline: quad, parts: [quad] } : placedPiece(kind, at, w, d, rotation, arms);
  return { ring: shape.outline, parts: shape.parts, centre: quadCentre(quad), rug: kind !== undefined && isRug(kind), well: kind !== undefined && isWell(kind), beam: kind !== undefined && isBeam(kind) };
}

/**
 * Whether a fit shape `ring` with `heights` in `state`, standing on `surface` (a deck's ID or null for the floor), would
 * pass I10, I11 and I17: `placementFit`'s test on a shape already built, skipping the placements in `ignore` (a piece
 * being moved or turned need not clear itself). Same reasons, in the same order: wall, deck, object, ceiling, then room
 * on the floor or outsideDeck on a deck. `ring` is the outline: a footprint quad, or a shaped kind's, with its
 * footprint's `centre` (see `roomOf`); `parts` its convex parts, which the collisions test (catalog.16; the ring
 * itself, the default, when it is convex). `heights` are the moving piece's own, for the configuration it shows;
 * `tuck` its role in the tuck rule (`tuckRole`; null, the default, tests its whole shape); `rug` whether it is a rug;
 * `well` whether it is a wheel well (trailer.07), which may run under walls with its centre in a room; `beam` whether it
 * is a beam (beams.05), which meets no wall, its centre in a room, but meets decks.
 */
export function footprintFit(doc: Document, ring: readonly Point[], state: string, heights: Heights, surface: string | null, ignore: readonly string[] = [], centre: Point | null = quadCentre(ring), stair?: StairPose, tuck: TuckRole = null, parts: readonly (readonly Point[])[] = [ring], rug = false, well = false, beam = false): PlacementFit {
  const range = rangeOf(doc, heights, ring, surface);
  // A moving open flight brings its underside, so the preview says what validation will (stairs.56); its steps begin at its surface here.
  const underside = stair ? undersideAt(stair, range.bottom, range.top) : null;
  const pitch = stair ? pitchLineAt(stair, range.bottom, range.top) : null;
  const part = well && centre ? wellPart(doc, ring, centre) : null;
  const moving = parts.map((p): Box3 => ({ ring: p, box: boxOf(p), range, underside, pitch, tuck, surface, rug, well: part }));
  const meets = (s: Box3): boolean => moving.some((m) => solidsCollide(m, s));
  const all = fitSolids(doc);
  if (!beam && all.some((s) => s.key.table === "walls" && meets(s))) return { fits: false, reason: "wall" };
  if (all.some((s) => s.key.table === "decks" && moving.some((m) => deckClash(m, s, s.key.id === surface, beam) !== null))) return { fits: false, reason: "deck" };
  const blocks = (s: (typeof all)[number]): boolean => s.key.table === "placements" && s.state === state && !ignore.includes(s.key.id);
  if (all.some((s) => blocks(s) && meets(s))) return { fits: false, reason: "object" };
  if (aboveCeiling(doc, { ring, range })) return { fits: false, reason: "ceiling" };
  if (surface === null) return (well || beam ? wellRoom(doc, centre) : roomOf(doc, ring, centre)) === null ? { fits: false, reason: "room" } : { fits: true, reason: null };
  const deck = deckView(doc, surface);
  const why = deck ? deckStanding(doc, deck, parts, centre) : "outsideDeck";
  return why === null ? { fits: true, reason: null } : { fits: false, reason: why };
}
