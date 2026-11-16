// The livability checks every sample house must pass (samples.05, AC-05 to AC-08): an entrance, a way up to every deck,
// every room reachable, no warnings, a person able to walk to every use zone (the clearance walk), and no piece over a window's glass (showcase.04). Test helpers only (samples.12): nothing outside the tests reads them. Each returns
// its problems as sentences, empty when the drawing passes.
import {
  OPENING_KINDS, SEAT_BACK, ceilingHeight, deckRange, deckRing, diningTable, faceAt, fitShapes, footprintOf, hasGlass, kindOf, missingGuards, openingRange,
  placementCentre, placementRange, pointInPolygon, rangesOverlap, roundSetTable, stairRuleOf, swingZone, useZones, wallRange, zoneBlocks, zones,
} from "@fm/domain";
import type { Deck, Document, Opening, Placement, Range } from "@fm/domain";
import type { Point } from "@fm/protocol";

/** How far past a wall's face a point is taken to lie in the room (or the outside) on that side. */
const PAST_FACE = 0.05;

/** The face keys on each side of an opening's middle: null where that side is outside every room. */
function sidesOf(doc: Document, o: Opening): [string | null, string | null] {
  const wall = doc.walls[o.wall];
  const a = wall ? doc.joints[wall.a] : undefined;
  const b = wall ? doc.joints[wall.b] : undefined;
  if (!wall || !a || !b) return [null, null];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const along = o.offset + o.width / 2;
  const mid: Point = { x: a.x + ux * along, y: a.y + uy * along };
  const reach = wall.thickness / 2 + PAST_FACE;
  const side = (s: 1 | -1): string | null => faceAt(doc, { x: mid.x - uy * reach * s, y: mid.y + ux * reach * s })?.key ?? null;
  return [side(1), side(-1)];
}

const isDoor = (o: Opening): boolean => OPENING_KINDS[o.kind].group === "doors";
const walkThrough = (o: Opening): boolean => OPENING_KINDS[o.kind].walkThrough;

/** The doors with the outside on one side and a room on the other. */
function entranceDoors(doc: Document): Opening[] {
  return Object.values(doc.openings).filter((o) => {
    if (!isDoor(o)) return false;
    const [l, r] = sidesOf(doc, o);
    return (l === null) !== (r === null);
  });
}

/** The rooms an entrance door opens into: the face keys on its inside (showcase AC-04). */
export function entranceRooms(doc: Document): string[] {
  return [...new Set(entranceDoors(doc).flatMap((o) => sidesOf(doc, o).filter((k): k is string => k !== null)))];
}

/** AC-05: at least one door, of a door kind, in a wall with the outside on one side. */
export function entrances(doc: Document): string[] {
  return entranceDoors(doc).length > 0 ? [] : ["No door in an outside wall"];
}

/** AC-06: in every layout, each deck is reached by a stair, ladder or steps linked to it. */
export function waysUp(doc: Document): string[] {
  const problems: string[] = [];
  for (const state of Object.values(doc.states)) {
    for (const deck of Object.values(doc.decks)) {
      const reached = Object.values(doc.placements).some((p) => {
        if (p.state !== state.id) return false;
        const o = doc.objects[p.object];
        return o !== undefined && stairRuleOf(o.kind) !== null && o.reaches === deck.id;
      });
      if (!reached) problems.push(`Deck ${deck.name || deck.id} has no stair, ladder or steps in layout ${state.name}`);
    }
  }
  return problems;
}

const roomName = (doc: Document, labelIds: readonly string[], key: string): string =>
  labelIds.map((id) => doc.zoneLabels[id]?.name).find((n) => n !== undefined) ?? `unnamed room ${key}`;

/** AC-07: every room connects, through doors and open passages, to a room with an entrance door. */
export function reachableRooms(doc: Document): string[] {
  const rooms = zones(doc);
  const links = new Map<string, Set<string>>(rooms.map((z) => [z.face.key, new Set<string>()]));
  for (const o of Object.values(doc.openings)) {
    if (!walkThrough(o)) continue;
    const [l, r] = sidesOf(doc, o);
    if (l === null || r === null) continue;
    links.get(l)?.add(r);
    links.get(r)?.add(l);
  }
  const reached = new Set<string>();
  const queue = entranceDoors(doc).flatMap((o) => sidesOf(doc, o).filter((k): k is string => k !== null));
  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined || reached.has(key)) continue;
    reached.add(key);
    queue.push(...(links.get(key) ?? []));
  }
  return rooms.filter((z) => !reached.has(z.face.key)).map((z) => `Room ${roomName(doc, z.labelIds, z.face.key)} can't be reached from an entrance`);
}

/** AC-08: no warnings in any layout: no blocked use zone or door swing, and no deck side missing its guard. */
export function warnings(doc: Document): string[] {
  const problems: string[] = [];
  for (const state of Object.values(doc.states)) {
    for (const block of zoneBlocks(doc, state.id)) {
      const by = block.blockers.map((b) => (b.kind === "piece" ? b.name : b.kind)).join(", ");
      problems.push(`Layout ${state.name}: ${JSON.stringify(block.zone)} is blocked by ${by}`);
    }
  }
  for (const m of missingGuards(doc)) problems.push(`No guard on ${m.name}${m.side ? `'s ${m.side} side` : ""}`);
  return problems;
}

/**
 * A person seen from above: a disk 0.60 m across on a 2.5 cm grid. A cell is free when the disk clears everything by half
 * a step less than its radius, so an aisle of exactly 0.60 m has a line of cells wherever it lies on the grid.
 */
const RADIUS = 0.3;
const STEP = 0.025;
const CLEAR = RADIUS - STEP / 2 - 1e-6;
/** What a person walks into, from just above the surface to the hips: a rug or a hung cabinet is passed. */
const BAND = { bottom: 0.05, top: 1.2 };
/** A deck is walked only where a person can stand on it. */
const STAND = 1.9;
/** How far into the room, past the wall's face, a walk through an entrance door starts. */
const STEP_IN = 0.35;
/** How far onto a deck, past a stair's top edge, its walk starts. */
const ONTO_DECK = 0.45;

type Level = { deck: Deck | null; surface: number; inside(p: Point): boolean; starts: Point[]; obstacles: (readonly Point[])[] };

const overlaps = (r: Range | null, surface: number): boolean => r !== null && r.bottom < surface + BAND.top && r.top > surface + BAND.bottom;

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** How far `p` lies from a ring: 0 inside it. */
function ringDistance(p: Point, ring: readonly Point[]): number {
  if (pointInPolygon(p, ring)) return 0;
  return Math.min(...ring.map((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length] ?? a)));
}

/** A wall at `surface`: its doorways there (the openings people walk through) and the stretches of solid wall between. */
function wallAt(doc: Document, wallId: string, surface: number): { solid: (readonly Point[])[]; doorways: (readonly Point[])[] } {
  const wall = doc.walls[wallId];
  const a = wall ? doc.joints[wall.a] : undefined;
  const b = wall ? doc.joints[wall.b] : undefined;
  if (!wall || !a || !b || !overlaps(wallRange(doc, wallId), surface)) return { solid: [], doorways: [] };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y * wall.thickness / 2, y: u.x * wall.thickness / 2 };
  const spans = Object.values(doc.openings)
    .filter((o) => o.wall === wallId && walkThrough(o) && Math.abs((openingRange(doc, o.id)?.bottom ?? Infinity) - surface) <= BAND.bottom)
    .map((o): [number, number] => [o.offset, o.offset + o.width])
    .sort((x, y) => x[0] - y[0]);
  const solid: [number, number][] = [];
  let from = 0;
  for (const [s, e] of spans) {
    if (s > from) solid.push([from, s]);
    from = Math.max(from, e);
  }
  if (from < len) solid.push([from, len]);
  const at = (t: number, side: 1 | -1): Point => ({ x: a.x + u.x * t + n.x * side, y: a.y + u.y * t + n.y * side });
  const quad = ([s, e]: [number, number]): Point[] => [at(s, -1), at(e, -1), at(e, 1), at(s, 1)];
  return { solid: solid.map(quad), doorways: spans.map(quad) };
}

/** The points just inside each entrance door, on its room side. */
function doorSteps(doc: Document): Point[] {
  return entranceDoors(doc).flatMap((o) => {
    const wall = doc.walls[o.wall];
    const a = wall ? doc.joints[wall.a] : undefined;
    const b = wall ? doc.joints[wall.b] : undefined;
    if (!wall || !a || !b) return [];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const mid = { x: a.x + u.x * (o.offset + o.width / 2), y: a.y + u.y * (o.offset + o.width / 2) };
    const reach = wall.thickness / 2 + STEP_IN;
    return ([1, -1] as const).map((s) => ({ x: mid.x - u.y * reach * s, y: mid.y + u.x * reach * s })).filter((p) => faceAt(doc, p) !== null);
  });
}

/**
 * What a piece takes of the floor for a person walking by: its fit shape, but a table set with its chairs pushed in, as
 * they usually are (the user's call): a dining set's table and its chairs' backrests, a round set's table and backrests.
 *
 *   as placed          walked past
 *   ┌─▓───▓───▓─┐
 *   │ ┌───────┐ │      ┌─▓─▓─▓─┐
 *   │ │ table │ │      │ table │
 *   │ └───────┘ │      └─▓─▓─▓─┘
 *   └─▓───▓───▓─┘
 */
function walkedShape(doc: Document, p: Placement): readonly Point[] {
  const shape = fitShapes(doc).get(p.id) ?? [];
  const o = doc.objects[p.object];
  const set = o ? kindOf(o.kind)?.aggregate : undefined;
  const w = o?.w[p.config];
  const d = o?.d[p.config];
  const c = placementCentre(doc, p);
  if (!set || set.reach <= SEAT_BACK || w === undefined || d === undefined || !c) return shape;
  const r = (p.rotation * Math.PI) / 180;
  const turn = (x: number, y: number): Point => ({ x: c.x + x * Math.cos(r) - y * Math.sin(r), y: c.y + x * Math.sin(r) + y * Math.cos(r) });
  if (set.chairs === "around") {
    const radius = roundSetTable(w, set.reach) / 2 + SEAT_BACK;
    return Array.from({ length: 32 }, (_, i) => turn(radius * Math.cos((i * Math.PI) / 16), radius * Math.sin((i * Math.PI) / 16)));
  }
  const table = diningTable(w, d, set.reach);
  const hw = (table.ends ? table.w + 2 * SEAT_BACK : table.w) / 2;
  const hd = table.d / 2 + SEAT_BACK;
  return [turn(-hw, -hd), turn(hw, -hd), turn(hw, hd), turn(-hw, hd)];
}

/** The floor, then every deck a person can stand on, as seen in one layout. */
function levelsOf(doc: Document, state: string): Level[] {
  const placed = Object.values(doc.placements).filter((p) => p.state === state);
  const obstaclesAt = (surface: number, own: Deck | null): (readonly Point[])[] => [
    ...Object.keys(doc.walls).flatMap((id) => wallAt(doc, id, surface).solid),
    ...placed.filter((p) => overlaps(placementRange(doc, p.id), surface)).map((p) => walkedShape(doc, p)),
    ...Object.values(doc.decks).filter((d) => d !== own && overlaps(deckRange(d), surface)).map((d) => deckRing(d)),
  ].filter((r) => r.length > 0);
  // Inside a doorway is inside no room: the floor is the rooms and the doorways between them.
  const doorways = Object.keys(doc.walls).flatMap((id) => wallAt(doc, id, 0).doorways);
  const onFloor = (p: Point): boolean => faceAt(doc, p) !== null || doorways.some((d) => pointInPolygon(p, d));
  const floor: Level = { deck: null, surface: 0, inside: onFloor, starts: doorSteps(doc), obstacles: obstaclesAt(0, null) };
  const decks = Object.values(doc.decks).filter((d) => ceilingHeight(doc) - d.top >= STAND).map((deck): Level => {
    const ring = deckRing(deck);
    const starts = placed.flatMap((p) => {
      const o = doc.objects[p.object];
      if (!o || stairRuleOf(o.kind) === null || o.reaches !== deck.id) return [];
      const r = (p.rotation * Math.PI) / 180;
      return [{ x: p.at.x - ONTO_DECK * Math.sin(r), y: p.at.y + ONTO_DECK * Math.cos(r) }];
    });
    const inside = (p: Point): boolean => pointInPolygon(p, ring) && ring.every((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length] ?? a) >= CLEAR);
    return { deck, surface: deck.top, inside, starts, obstacles: obstaclesAt(deck.top, deck) };
  });
  return [floor, ...decks];
}

/** The cells a person standing at a start can walk to, keyed "i,j" from the grid's origin. */
function walk(level: Level): { reached: Set<string>; at(i: number, j: number): Point; index(p: Point): [number, number] } {
  const all = level.obstacles.flat();
  const ox = Math.floor(Math.min(...all.map((p) => p.x)) / STEP) * STEP;
  const oy = Math.floor(Math.min(...all.map((p) => p.y)) / STEP) * STEP;
  const at = (i: number, j: number): Point => ({ x: ox + i * STEP, y: oy + j * STEP });
  const index = (p: Point): [number, number] => [Math.round((p.x - ox) / STEP), Math.round((p.y - oy) / STEP)];
  const boxes = level.obstacles.map((ring) => ({
    ring,
    x0: Math.min(...ring.map((p) => p.x)) - RADIUS, x1: Math.max(...ring.map((p) => p.x)) + RADIUS,
    y0: Math.min(...ring.map((p) => p.y)) - RADIUS, y1: Math.max(...ring.map((p) => p.y)) + RADIUS,
  }));
  const known = new Map<string, boolean>();
  const free = (i: number, j: number): boolean => {
    const key = `${i},${j}`;
    const seen = known.get(key);
    if (seen !== undefined) return seen;
    const p = at(i, j);
    const ok = boxes.every((b) => p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1 || ringDistance(p, b.ring) >= CLEAR) && level.inside(p);
    known.set(key, ok);
    return ok;
  };
  const reached = new Set<string>();
  const queue: [number, number][] = [];
  for (const s of level.starts) {
    const [si, sj] = index(s);
    const near = Math.ceil(RADIUS / STEP);
    let best: [number, number] | null = null;
    for (let di = -near; di <= near; di++) {
      for (let dj = -near; dj <= near; dj++) {
        if (!free(si + di, sj + dj)) continue;
        if (best === null || Math.hypot(di, dj) < Math.hypot(best[0] - si, best[1] - sj)) best = [si + di, sj + dj];
      }
    }
    if (best) queue.push(best);
  }
  while (queue.length > 0) {
    const cell = queue.pop();
    if (!cell) break;
    const key = `${cell[0]},${cell[1]}`;
    if (reached.has(key)) continue;
    reached.add(key);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = cell[0] + di;
      const nj = cell[1] + dj;
      if (!reached.has(`${ni},${nj}`) && free(ni, nj)) queue.push([ni, nj]);
    }
  }
  return { reached, at, index };
}

/** Whether a piece hangs 1.20 m or more above what it stands on: its zones are left out, as the warnings leave them (decks.18). */
function hung(doc: Document, p: Placement, surface: number): boolean {
  const r = placementRange(doc, p.id);
  return r !== null && r.bottom - surface >= BAND.top - 1e-9;
}

/**
 * In every layout, a person 0.60 m across walks from the entrance doors over the floor, and up each stair onto every deck
 * they can stand on, and stands partly in every use zone of every piece on that level but the hung ones. Walls (less
 * their doorways), pieces and decks between 0.05 and 1.20 m above the surface are in the way, a table set's chairs
 * pushed in; outside the rooms, or off a deck, is too.
 */
export function clearanceWalk(doc: Document): string[] {
  const problems: string[] = [];
  const zonesOf = useZones(doc);
  for (const state of Object.values(doc.states)) {
    for (const level of levelsOf(doc, state.id)) {
      const { reached, at, index } = walk(level);
      for (const p of Object.values(doc.placements)) {
        if (p.state !== state.id || p.deck !== (level.deck?.id ?? null) || hung(doc, p, level.surface)) continue;
        for (const zone of zonesOf.get(p.id) ?? []) {
          // The person stands in the zone when their disk overlaps it: a zone shallower than the disk counts too.
          const [i0, j0] = index({ x: Math.min(...zone.quad.map((q) => q.x)) - RADIUS, y: Math.min(...zone.quad.map((q) => q.y)) - RADIUS });
          const [i1, j1] = index({ x: Math.max(...zone.quad.map((q) => q.x)) + RADIUS, y: Math.max(...zone.quad.map((q) => q.y)) + RADIUS });
          let hit = false;
          for (let i = i0; i <= i1 && !hit; i++) for (let j = j0; j <= j1 && !hit; j++) hit = reached.has(`${i},${j}`) && ringDistance(at(i, j), zone.quad) < RADIUS - STEP;
          if (hit) continue;
          const o = doc.objects[p.object];
          const name = o?.name || (o ? kindOf(o.kind)?.label : undefined) || p.object;
          const where = level.deck ? ` on ${level.deck.name || level.deck.id}` : "";
          problems.push(`Layout ${state.name}: ${name}'s ${zone.side} zone${where} can't be reached`);
        }
      }
    }
  }
  return [...new Set(problems)];
}

/** How close to a wall's face a piece may come in front of its glass (showcase.04). */
const OFF_GLASS = 0.15;
/** A bed's headboard depth, and its mattress's top over the bed's bottom: what stands tall is only the head end. */
const HEADBOARD = 0.08;
const MATTRESS = 0.6;
const PLANTS = new Set(["plant", "palm", "fern", "rosette"]);

/**
 * The parts of a placement that could stand in front of glass, each a ring and a height range: the footprint at the
 * piece's full range, except a bed (its headboard strip at full height, the rest a mattress) and an opened Murphy bed
 * (its cabinet at the back at full height, the bed in front a mattress).
 */
function standingParts(doc: Document, p: Placement): { ring: readonly Point[]; range: Range }[] {
  const ring = footprintOf(doc, p);
  const range = placementRange(doc, p.id);
  const centre = placementCentre(doc, p);
  const object = doc.objects[p.object];
  if (!ring || !range || !centre || !object) return [];
  const depths = Object.values(object.d ?? {}).filter((v): v is number => typeof v === "number");
  const back = object.kind === "bed" ? HEADBOARD : object.kind === "murphyBed" && depths.length > 1 && object.d?.[p.config] !== Math.min(...depths) ? Math.min(...depths) : null;
  if (back === null) return [{ ring, range }];
  const half = Math.hypot(p.at.x - centre.x, p.at.y - centre.y); // the anchor is the back's middle
  const [ux, uy] = [(p.at.x - centre.x) / half, (p.at.y - centre.y) / half];
  const strip = ring.map((q) => {
    const t = (q.x - centre.x) * ux + (q.y - centre.y) * uy;
    return t < half - back ? { x: q.x + ux * (half - back - t), y: q.y + uy * (half - back - t) } : q;
  });
  return [{ ring: strip, range }, { ring, range: { bottom: range.bottom, top: Math.min(range.top, range.bottom + MATTRESS) } }];
}

/**
 * Each piece in front of an opening's glass, in any layout, as "<piece> over <opening>" (showcase.04): a part of it
 * comes within OFF_GLASS of the wall's face along the opening's span with its height range overlapping the glass. A
 * piece wholly under the sill, or touching it, passes; so does a plant at a window (where plants live), not in front
 * of a glazed door (the way through).
 */
export function piecesOverGlass(doc: Document): string[] {
  const found: string[] = [];
  for (const p of Object.values(doc.placements)) {
    const plant = PLANTS.has(doc.objects[p.object]?.kind ?? "");
    for (const { ring, range } of standingParts(doc, p)) {
      for (const o of Object.values(doc.openings)) {
        const wall = doc.walls[o.wall];
        const [a, b] = [doc.joints[wall?.a ?? ""], doc.joints[wall?.b ?? ""]];
        const glass = openingRange(doc, o.id);
        if (!wall || !a || !b || !glass || !hasGlass(o) || (plant && !isDoor(o))) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
        const along = ring.map((q) => (q.x - a.x) * ux + (q.y - a.y) * uy);
        const off = Math.min(...ring.map((q) => Math.abs((q.x - a.x) * uy - (q.y - a.y) * ux)));
        const near = off <= wall.thickness / 2 + OFF_GLASS + 1e-6;
        const spans = Math.max(...along) > o.offset + 1e-6 && Math.min(...along) < o.offset + o.width - 1e-6;
        if (near && spans && rangesOverlap(range, glass)) found.push(`${doc.objects[p.object]?.name ?? p.object} over ${OPENING_KINDS[o.kind].label}`);
      }
    }
  }
  return [...new Set(found)];
}

/** A rectangle `depth` deep on each side of an opening's span, off the wall's faces: where a window's leaf can swing. */
function leafZones(doc: Document, o: Opening, depth: number): (readonly Point[])[] {
  const wall = doc.walls[o.wall];
  const [a, b] = [doc.joints[wall?.a ?? ""], doc.joints[wall?.b ?? ""]];
  if (!wall || !a || !b) return [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
  const at = (t: number, n: number): Point => ({ x: a.x + ux * t - uy * n, y: a.y + uy * t + ux * n });
  const [t0, t1, h] = [o.offset, o.offset + o.width, wall.thickness / 2];
  return [1, -1].map((s) => [at(t0, s * h), at(t1, s * h), at(t1, s * (h + depth)), at(t0, s * (h + depth))]);
}

/** Whether two convex rings overlap by more than a centimetre (separating axes): touching is fine. */
function overlap(p: readonly Point[], q: readonly Point[]): boolean {
  for (const ring of [p, q]) {
    for (let i = 0; i < ring.length; i++) {
      const [c, d] = [ring[i], ring[(i + 1) % ring.length]];
      if (!c || !d) continue;
      const len = Math.hypot(d.x - c.x, d.y - c.y) || 1;
      const [nx, ny] = [-(d.y - c.y) / len, (d.x - c.x) / len];
      const span = (r: readonly Point[]) => r.map((v) => v.x * nx + v.y * ny);
      const [sp, sq] = [span(p), span(q)];
      if (Math.min(Math.max(...sp), Math.max(...sq)) - Math.max(Math.min(...sp), Math.min(...sq)) < 0.01) return false;
    }
  }
  return true;
}

/**
 * Each pair of openings whose leaves swing into the same floor (showcase.30): a door's clearance (`swingZone`) and a
 * casement or two-leaf window's leaf, a rectangle as deep as the leaf is wide on either side of its wall. The domain
 * warns when a piece or a wall blocks a swing, not when two swings meet. Only openings whose walls stand on the same
 * surface are compared: a door on a loft's wall swings over the loft, not into a floor door under it (spec: levels).
 */
export function swingsCross(doc: Document): string[] {
  const zonesOf = (o: Opening): (readonly Point[])[] => {
    const swing = swingZone(doc, o.id);
    if (swing) return [swing];
    return o.kind === "casement" ? leafZones(doc, o, o.width) : o.kind === "twoLeaf" ? leafZones(doc, o, o.width / 2) : [];
  };
  const all = Object.values(doc.openings).map((o) => ({ o, zones: zonesOf(o) })).filter((x) => x.zones.length > 0);
  const found: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [x, y] = [all[i], all[j]];
      if (!x || !y || doc.walls[x.o.wall]?.base !== doc.walls[y.o.wall]?.base) continue;
      if (x.zones.some((p) => y.zones.some((q) => overlap(p, q)))) found.push(`${OPENING_KINDS[x.o.kind].label} ${x.o.id} and ${OPENING_KINDS[y.o.kind].label} ${y.o.id} swing into each other`);
    }
  }
  return found;
}

/** All seven checks. */
export function livability(doc: Document): string[] {
  return [...entrances(doc), ...waysUp(doc), ...reachableRooms(doc), ...warnings(doc), ...clearanceWalk(doc), ...piecesOverGlass(doc), ...swingsCross(doc)];
}
