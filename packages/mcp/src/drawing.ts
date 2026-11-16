import { areaM2, areaRoom, armsOf, assertNever, hasOption, inEveryLayout, OBJECT_OPTIONS, ceilingHeight, highSide, roofOf, roofCovering, outsideOf, roomWallsOf, sidesOf, columnOf, deckRefs, wallBodies, wallRange, orderedStates, shown, configsOf, cutHeight, deckViews, levels, slabArea, DEFAULT_WALL_THICKNESS, halfWallTop, heightsOf, dimensionLength, dimensionPoints, OPENING_KINDS, PROJECT_FIELDS, SET_FIELDS, SIDE_IDS, sheetListIsAutomatic, footprints, freeFloor, furnishedRooms, orphanLabelIds, quadCentre, sortedIds, UNDERLAY_ID, underlayRect, zoneBlocks, zoneExtent, zones, sideAt, sideField, type Deck, type GuardValue, type PlanSide, type Blocker, type Document, type Finish, type SideFinish, type Wall, type OpeningKind, type Side, type ZoneRef, type ObjectOption, offAxisAngle } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { sectionLines, type SectionLine } from "./section-lines";
import { sheetLines, type SheetLine } from "./sheet-lines";
import { stairLine, type StairLine } from "./stair-lines";

// What get_drawing and every successful edit return (spec: mcp): a compact JSON summary in metres (areas in m²),
// listed in full up to MAX_LISTED_WALLS walls, otherwise an overview with counts and bounds. A wall lists its
// thickness only when it is not the default 0.20 m, so a drawing of default walls reads as before.
// Layout states (spec: layouts): the states by ID in order; each object with its sizes and its place in every state
// (the footprint's centre, or null where it is absent); the free floor per state of rooms furnished in some state.
// Openings (spec: openings): under their wall in offset order, only on walls that have some; a window leaves out the
// side, hinge and glazing it ignores. The overview counts them.
// Dimensions (dims): each with its ends worked out from the walls now, left out when there are none; rooms list their
// clear floor outline so Claude can hand a corner back to add_dimension (millimetre rounding stays inside the 1 mm
// anchor tolerance). The overview counts dimensions.
// Holes (holes.08): a room around a closed group of walls lists each hole's outline (centreline ring) and floor (its
// footprint, given when the room's area is available); rooms without holes leave the field out, and areas are net.
// Clearance (smart.13, .20): each placement lists its use-zone sides and, for each side that is on, its zone's depth and
// insets as zoneExtent resolves them (furnish.20), and each listed state every blocked use zone and door swing with
// what blocks it, ids beside names, as warnings; the overview leaves them out.
// Classes (furnish.19): a legend of each listed object's kind to its semantic class, once per kind in kinds-table
// order, left out when no object is listed and in the overview.
// Decks (decks.08, .16): each deck as deckViews sees it, its centre, size, rotation, corners (its ring), top, solid flag
// and range in height; with a region, those whose corners touch it. Each placement says what it stands on (`on`:
// "floor" or the deck's ID). The overview counts decks.
// Levels (levels.14, .17): every level as the domain's levels() finds it, the floor first: its height, name, deck IDs
// and cut, in the listing and the overview alike, whatever the region (Claude's edits land at the floor; `on` reaches
// a level's deck).
// The underlay (import.08, .11): its rectangle from underlayRect, its scale as stored and whether it was scaled, in
// the listing and the overview alike, null without one; never its picture data (AC-10). The overview's bounds stay
// the joints'.
// Stairs (stairs.20): each stair object adds its line (stair-lines.ts); furniture leaves the field out.
// Columns (pillars.15, .34): each column as columnOf sees it, its centre, size, rotation, range (wallRange) and the
// walls whose line it sits in (null when free), the deck it stands on (`on`) and the deck it reaches up to (`top`), each
// left out when there is none (pillars.48); with a region, those whose body touches it; left out when there are
// none. Their wall rows, their joints and a free column's hole stay out of walls, joints and the rooms' holes (and
// their counts), so the wall tools never reach them from here. A blocked zone names a column that blocks it.
// Sheets (sheetset): the list as printed (sheet-lines.ts), whatever the region, in the listing and the overview alike;
// never a report's text, as this is every edit's reply (sheetset.21). `fields` holds the set's settings too, north among them.
// Sections (AC-11): their lines (section-lines.ts), whatever the region, in the listing and the overview alike; left out when none.

export type XY = [number, number];
type ProjectSummary = { id: string; name: string; status: string };
export type Region = { min: Point; max: Point };
type DrawingCounts = {
  walls: number; joints: number; rooms: number; labels: number; unplacedLabels: number; objects: number; openings: number; dimensions: number; decks: number;
  columns: number;
};
/** A column: its centre, width along its rotation, depth, rotation in degrees, range in metres and its line's walls. */
type ColumnSummary = {
  id: string; centre: XY; width: number; depth: number; rotation: number; range: { bottom: number; top: number }; inLineOf: string[] | null;
  /** The deck it stands on; left out on the floor. */
  on?: string;
  /** The deck it reaches up to; left out for the ceiling or a height. */
  top?: string;
};
export type StateSummary = { id: string; name: string };
/** A blocked clearance: "Wardrobe (o2) front zone" or "Door d0 swing", by "Bed (o3)" or "wall". */
export type Blocked = { zone: string; by: string };
type LayoutSummary = StateSummary & { blocked: Blocked[] };
/** A side's use zone: its depth and its insets from the side's corners, in metres. */
type ZoneSummary = { depth: number; start: number; end: number };
/**
 * `sides` are the sides with a use zone, in the order front, back, left, right; listed in any configuration. `zones`
 * has one key per side in `sides`: its zone (stored or the kind's default, clamped to the side), or null where the
 * configuration has no zone.
 */
type PlacementSummary = { centre: XY; rotation: number; config: string; on: string; sides: Side[]; zones: Partial<Record<Side, ZoneSummary | null>> };
/**
 * A deck: its centre, size before rotation, the four corners, its top, solid flag and range in metres above the floor;
 * its holes (stairwell.10), each with its centre, size along the deck's axes and corners; the slab's area (the deck's
 * less its holes', the domain's).
 */
type DeckSummary = {
  id: string; name: string; centre: XY; width: number; depth: number; rotation: number; corners: XY[]; top: number; solid: boolean; guards: Record<PlanSide, GuardValue>;
  range: { bottom: number; top: number }; holes: HoleSummary[]; slabArea: number; finish: Finish | null;
};
type HoleSummary = { id: string; centre: XY; width: number; depth: number; corners: XY[]; guard: GuardValue };
type ObjectSummary = {
  id: string;
  kind: string;
  name: string;
  sizes: Record<string, { width: number; depth: number; height: number; elevation: number | "ceiling" }>;
  /** Its place when it is the same in every layout; else `placements`, per layout, null where it is absent. */
  placement?: PlacementSummary;
  placements?: Record<string, PlacementSummary | null>;
  stair?: StairLine; // stairs only: what it reaches, its risers, going and run, and its warnings
  options?: ObjectOption[]; // the options that are on, in OBJECT_OPTIONS order (library.10); absent when none
  arms?: { back: number; left: number }; // an `L` piece's arm depths (catalog.17), shared by every layout; absent for other kinds
  linked?: false; // an exception, placed per layout, with two or more layouts (review.07); absent when the same in every layout
};
/** A door lists its leaf (side, hinge, glazing); a window only where it is (the kind's `door` row, domain kinds.ts). */
/**
 * An opening: its kind and the kind's name, and only the side, hinge and glazing its kind uses (openkinds.12); a
 * window's sill and every opening's own height above it, a door's from its wall's bottom (sills.08).
 */
type OpeningSummary = { id: string; kind: OpeningKind; name: string; offset: number; width: number; side?: "left" | "right"; hinge?: "a" | "b"; glazed?: boolean; sill?: number; height: number; sheer?: "glass" | "floor"; shutterBox?: true };
/** A level: the floor (height 0, no decks) or a deck top at or above the floor's cut, with its decks and its cut. */
type LevelSummary = { height: number; name: string; decks: string[]; cut: number };
type UnderlaySummary = { bounds: { min: XY; max: XY }; metresPerPixel: number; scaled: boolean };
type DimensionSummary = { id: string; from: XY; to: XY; offset: number; length: number };
// A wall's top is a height above what it stands on, as set_wall_top takes it (pillars.50 c); `on` is its deck, left
// out for the floor, so floor walls read as before.
/** A custom wall side's finish and band as listed, only the custom sides (surfaces step 14, inherit.01). */
type SidesSummary = Partial<Record<"left" | "right", SideFinish>>;
// `angle`: degrees off the nearest axis, only for a wall up to a degree off (straight.11): an invisible slant, listed.
type WallSummary = { id: string; a: string; b: string; from: XY; to: XY; length: number; thickness?: number; on?: string; top?: number; angle?: number; openings?: OpeningSummary[]; sides?: SidesSummary };
/** A room label, its floor finish (null without one, finishes.14) and its walls default when it has one (inherit.01). */
type LabelSummary = { id: string; name: string; finish: Finish | null; walls?: SideFinish };
/** A named area (areas.13): its rectangle, and its area, the rectangle cut to its room's clear floor (null when unknown). */
export type AreaSummary = { id: string; name: string; centre: XY; width: number; depth: number; area: number | null };
export type RoomSummary = {
  labels: LabelSummary[];
  areas?: AreaSummary[];
  area: number | null;
  note?: string;
  outline: XY[];
  floor?: XY[];
  holes?: { outline: XY[]; floor?: XY[] }[];
  freeFloor?: Record<string, number | null>;
};
export type RoofSummary = { shape: "shed" | "gable"; falls: "lower" | "upper" | "left" | "right"; lowSide: number; pitch: number; highSide: number; overhang: number; covering?: Finish };

const WORD_OF_FALLS = { "-y": "lower", "+y": "upper", "-x": "left", "+x": "right" } as const;

/** A wall's custom sides as Claude reads them, left out with none (surfaces step 14, inherit.01). */
function sidesSummary(w: Wall): { sides?: SidesSummary } {
  const s = sidesOf(w);
  if (!s) return {};
  return { sides: { ...(s.left ? { left: s.left } : {}), ...(s.right ? { right: s.right } : {}) } };
}

/** The roof as Claude reads it, or null for a flat ceiling. */
function roofSummary(doc: Document): RoofSummary | null {
  const r = roofOf(doc);
  if (r.shape === "flat") return null;
  const covering = roofCovering(doc); // the roof's covering, when it has one (surfaces step 14)
  return { shape: r.shape, falls: WORD_OF_FALLS[r.falls], lowSide: round(r.height, 3), pitch: round(r.pitch, 1), highSide: round(highSide(doc), 3), overhang: round(r.overhang, 3), ...(covering ? { covering } : {}) };
}

export type DrawingSummary = {
  project: ProjectSummary;
  units: "m";
  counts: DrawingCounts;
  layouts: LayoutSummary[];
  walls: WallSummary[];
  joints: { id: string; at: XY }[];
  rooms: RoomSummary[];
  unplacedLabels: (LabelSummary & { at: XY })[];
  unplacedAreas?: AreaSummary[]; // named areas whose centre a wall move left outside every room (areas.04)
  objects: ObjectSummary[];
  decks: DeckSummary[];
  columns?: ColumnSummary[];
  dimensions?: DimensionSummary[];
  fields: Record<string, string>; // the title block's set fields by key (sheet.06)
  underlay: UnderlaySummary | null;
  ceiling: number; // metres (heights.11): the flat ceiling, or a roof's low side
  roof?: RoofSummary; // a shed or gable (roofs.14); none when flat
  outside?: SideFinish; // the house's outside walls default (inherit.07); none when unset
  cut: number; // the plan's cut height in metres (heights.15)
  levels: LevelSummary[];
  sheets: SheetLine[];
  sheetsAutomatic?: true; // no first edit yet: the ids go by place
  sections?: SectionLine[];
};
export type DrawingOverview = {
  project: ProjectSummary;
  units: "m";
  counts: DrawingCounts;
  layouts: StateSummary[];
  bounds: { min: XY; max: XY } | null;
  fields: Record<string, string>;
  underlay: UnderlaySummary | null;
  ceiling: number;
  cut: number;
  levels: LevelSummary[];
  sheets: SheetLine[];
  sheetsAutomatic?: true;
  sections?: SectionLine[];
  hint: string;
};

/** Above this many walls (in the drawing, or in the region asked for) a reply is an overview, not a listing. */
export const MAX_LISTED_WALLS = 300;

/** Coordinates and lengths, rounded exactly: Claude computes with them. */
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
/** An area as its tag shows it (format.ts's one rule): 3.045 m² reads 3.05 here too (cleanup.39). */
const area = (v: number): number => Number(shown(v, 2));
export const xy = (p: Readonly<Point>): XY => [round(p.x, 3), round(p.y, 3)];

/** Every named area in ID order, keyed by the face of its room, or null for one outside every room. */
function areasByRoom(doc: Document): Map<string | null, AreaSummary[]> {
  const out = new Map<string | null, AreaSummary[]>();
  for (const id of sortedIds(doc.areas)) {
    const a = doc.areas[id];
    if (!a) continue;
    const m2 = areaM2(doc, id);
    const roomKey = areaRoom(doc, id)?.face.key ?? null;
    out.set(roomKey, [...(out.get(roomKey) ?? []), { id, name: a.name, centre: xy(a.at), width: a.w, depth: a.d, area: m2 === null ? null : area(m2) }]);
  }
  return out;
}

const inside = (p: Readonly<Point>, r: Region): boolean => p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;

/** Whether the extent (bounding box) of these points touches the region. */
function touches(points: readonly Readonly<Point>[], r: Region): boolean {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.min(...xs) <= r.max.x && Math.max(...xs) >= r.min.x && Math.min(...ys) <= r.max.y && Math.max(...ys) >= r.min.y;
}

function boundsOf(doc: Document): DrawingOverview["bounds"] {
  let box: { min: Point; max: Point } | null = null;
  for (const j of Object.values(doc.joints)) {
    box = box
      ? { min: { x: Math.min(box.min.x, j.x), y: Math.min(box.min.y, j.y) }, max: { x: Math.max(box.max.x, j.x), y: Math.max(box.max.y, j.y) } }
      : { min: j, max: j };
  }
  return box && { min: xy(box.min), max: xy(box.max) };
}

function statesOf(doc: Document): StateSummary[] {
  return orderedStates(doc).map((s) => ({ id: s.id, name: s.name }));
}

/** Each object with its sizes and its place per state; with a region, only objects with a footprint touching it. */
function objectsOf(doc: Document, states: StateSummary[], region: Region | undefined): ObjectSummary[] {
  const quads = footprints(doc);
  const places = new Map<string, Map<string, PlacementSummary>>(); // object → state → place
  const listed = new Set<string>();
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    const quad = quads.get(id);
    const centre = quad ? quadCentre(quad) : null;
    if (!p || !quad || !centre) continue; // a valid document has none
    if (!region || touches(quad, region)) listed.add(p.object);
    const byState = places.get(p.object) ?? new Map<string, PlacementSummary>();
    const sides = SIDE_IDS.filter((side) => p.sides[side]);
    const zoneList: PlacementSummary["zones"] = {};
    for (const side of sides) {
      const e = zoneExtent(doc, p, side);
      zoneList[side] = e && { depth: round(e.depth, 3), start: round(e.start, 3), end: round(e.end, 3) };
    }
    byState.set(p.state, { centre: xy(centre), rotation: p.rotation, config: p.config, on: p.deck ?? "floor", sides, zones: zoneList });
    places.set(p.object, byState);
  }
  return sortedIds(doc.objects).flatMap((id) => {
    const o = doc.objects[id];
    if (!o || !listed.has(id)) return [];
    const sizes: ObjectSummary["sizes"] = {};
    for (const c of configsOf(o)) {
      const w = o.w[c.id];
      const d = o.d[c.id];
      const hz = heightsOf(o, c.id);
      if (w !== undefined && d !== undefined && hz) {
        sizes[c.id] = { width: round(w, 3), depth: round(d, 3), height: round(hz.h, 3), elevation: hz.z === "ceiling" ? hz.z : round(hz.z, 3) };
      }
    }
    const placements: Record<string, PlacementSummary | null> = {};
    for (const s of states) placements[s.id] = places.get(id)?.get(s.id) ?? null;
    const placed = Object.values(placements);
    const first = placed[0];
    // The same place in every layout lists once (mcp.12): a linked piece mostly, whose configuration and zones may still differ.
    const once = first !== null && first !== undefined && placed.every((p) => JSON.stringify(p) === JSON.stringify(first));
    const stair = stairLine(doc, id);
    const options = OBJECT_OPTIONS.filter((x) => hasOption(o, x));
    const arms = armsOf(o);
    return [{
      id, kind: o.kind, name: o.name, sizes, ...(once ? { placement: first } : { placements }), ...(stair === null ? {} : { stair }), ...(options.length === 0 ? {} : { options }),
      ...(arms === null ? {} : { arms: { back: round(arms.back, 3), left: round(arms.left, 3) } }),
      ...(states.length > 1 && o.linked !== true && !inEveryLayout(o.kind) ? { linked: false as const } : {}),
    }];
  });
}

/** Free floor per state for each room furnished in some state (as the web's room tags, spec: layouts), keyed by room. */
function freeFloorByRoom(doc: Document, states: StateSummary[]): Map<string, Record<string, number | null>> {
  const out = new Map<string, Record<string, number | null>>();
  const furnished = furnishedRooms(doc);
  if (furnished.size === 0) return out;
  for (const s of states) {
    for (const [room, free] of freeFloor(doc, s.id)) {
      if (!furnished.has(room)) continue;
      const perState = out.get(room) ?? {};
      perState[s.id] = free === null ? null : area(free);
      out.set(room, perState);
    }
  }
  return out;
}

/** The openings per wall, each wall's in offset order. */
function openingsByWall(doc: Document): Map<string, OpeningSummary[]> {
  const out = new Map<string, OpeningSummary[]>();
  const byOffset = Object.values(doc.openings).sort((p, q) => p.offset - q.offset || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  for (const o of byOffset) {
    const offset = round(o.offset, 3);
    const width = round(o.width, 3);
    const row = OPENING_KINDS[o.kind];
    const line: OpeningSummary = {
      id: o.id, kind: o.kind, name: row.label, offset, width,
      ...(row.sideLabel === null ? {} : { side: o.side }),
      ...(row.hingeLabel === null ? {} : { hinge: o.hinge }),
      ...(row.glass === "glazed" ? { glazed: o.glazed } : {}),
      ...(row.fromFloor ? {} : { sill: round(o.sill, 3) }),
      height: round(o.head - o.sill, 3),
      ...(o.sheer === undefined ? {} : { sheer: o.sheer }), // a window's dressing, only when set (hangings.04)
      ...(o.shutterBox === undefined ? {} : { shutterBox: o.shutterBox }),
    };
    out.set(o.wall, [...(out.get(o.wall) ?? []), line]);
  }
  return out;
}

export function summarize(project: ProjectSummary, doc: Document, region?: Region): DrawingSummary | DrawingOverview {
  const rooms = zones(doc);
  const orphans = orphanLabelIds(doc);
  const columnIds = sortedIds(doc.walls).filter((id) => doc.walls[id]?.column === true);
  const columnJoints = new Set(columnIds.flatMap((id) => [doc.walls[id]?.a, doc.walls[id]?.b]));
  const wallIds = sortedIds(doc.walls).filter((id) => doc.walls[id]?.column === false);
  const jointIds = sortedIds(doc.joints).filter((id) => !columnJoints.has(id));
  const counts: DrawingCounts = {
    walls: wallIds.length,
    joints: jointIds.length,
    rooms: rooms.length,
    labels: Object.keys(doc.zoneLabels).length,
    unplacedLabels: orphans.length,
    objects: Object.keys(doc.objects).length,
    openings: Object.keys(doc.openings).length,
    dimensions: Object.keys(doc.dimensions).length,
    decks: deckViews(doc).length,
    columns: columnIds.length,
  };
  const states = statesOf(doc);
  const fields = fieldsOf(doc);
  const underlay = underlayOf(doc);
  const ceiling = round(ceilingHeight(doc), 3);
  const roof = roofSummary(doc);
  const outsideDefault = outsideOf(doc);
  const cut = round(cutHeight(doc), 3);
  const levelList = levels(doc).map((l): LevelSummary => ({ height: round(l.height, 3), name: l.name, decks: [...l.deckIds], cut: round(l.cut, 3) }));
  const sheets = { sheets: sheetLines(doc), ...(sheetListIsAutomatic(doc) ? { sheetsAutomatic: true as const } : {}) };
  const sectionRows = sectionLines(doc);
  const sections = sectionRows.length === 0 ? {} : { sections: sectionRows };
  const overview = (hint: string): DrawingOverview => ({
    project, units: "m", counts, layouts: states, bounds: boundsOf(doc), fields, underlay, ceiling, cut, levels: levelList, ...sheets, ...sections, hint,
  });
  if (region === undefined && counts.walls > MAX_LISTED_WALLS) {
    return overview(
      `Too large to list: ${counts.walls} walls (the limit is ${MAX_LISTED_WALLS}). Pass a region { min, max } to get_drawing to list part of it.`,
    );
  }

  const openings = openingsByWall(doc);
  const walls: WallSummary[] = [];
  for (const id of wallIds) {
    const w = doc.walls[id];
    const a = w ? doc.joints[w.a] : undefined;
    const b = w ? doc.joints[w.b] : undefined;
    if (!w || !a || !b) continue; // a valid document has none
    if (region && !touches([a, b], region)) continue;
    const thickness = round(w.thickness, 3);
    const top = halfWallTop(doc, id);
    const bottom = wallRange(doc, id)?.bottom ?? 0;
    const base = deckRefs(w).base;
    const held = openings.get(id);
    const off = offAxisAngle(doc, id);
    const slant = off > 0 && off <= 1 ? round(off, 2) : null;
    walls.push({
      id, a: w.a, b: w.b, from: xy(a), to: xy(b), length: round(Math.hypot(b.x - a.x, b.y - a.y), 3),
      ...(thickness === DEFAULT_WALL_THICKNESS ? {} : { thickness }),
      ...(base === null ? {} : { on: base }),
      ...(top === null ? {} : { top: round(top - bottom, 3) }),
      ...(slant === null ? {} : { angle: slant }),
      ...(held === undefined ? {} : { openings: held }),
      ...sidesSummary(w),
    });
  }
  if (region && walls.length > MAX_LISTED_WALLS) {
    return overview(`The region holds ${walls.length} walls (the limit is ${MAX_LISTED_WALLS}): narrow it.`);
  }
  const joints = jointIds.flatMap((id) => {
    const j = doc.joints[id];
    return j && (!region || inside(j, region)) ? [{ id, at: xy(j) }] : [];
  });
  const labelOf = (id: string): LabelSummary => {
    const l = doc.zoneLabels[id];
    const walls = l ? roomWallsOf(l) : null;
    return { id, name: l?.name ?? "", finish: l?.finish ?? null, ...(walls ? { walls } : {}) };
  };
  const free = freeFloorByRoom(doc, states);
  const areasIn = areasByRoom(doc);
  const listedRooms = rooms
    .filter((z) => !region || touches(z.face.ring, region))
    .map((z): RoomSummary => {
      const freeFloor = free.get(z.face.key);
      // A free column's hole is listed under columns (pillars.34); zone holes follow the face's order.
      const holes = z.holes.filter((_, i) => z.face.holes[i]?.column !== true);
      const named = areasIn.get(z.face.key) ?? [];
      return {
        labels: z.labelIds.map(labelOf),
        ...(named.length === 0 ? {} : { areas: named }),
        area: z.area === null ? null : area(z.area),
        ...(z.unavailable === null ? {} : { note: z.unavailable }),
        outline: z.face.ring.map(xy),
        ...(z.floor === null ? {} : { floor: z.floor.map(xy) }),
        ...(holes.length === 0 ? {} : {
          holes: holes.map((h) => ({ outline: h.outline.map(xy), ...(h.footprint === null ? {} : { floor: h.footprint.map(xy) }) })),
        }),
        ...(freeFloor === undefined ? {} : { freeFloor }),
      };
    });
  const unplacedLabels = orphans.flatMap((id) => {
    const l = doc.zoneLabels[id];
    return l && (!region || inside(l.at, region)) ? [{ id, name: l.name, at: xy(l.at), finish: l.finish }] : [];
  });
  const unplacedAreas = (areasIn.get(null) ?? []).filter((a) => !region || inside({ x: a.centre[0], y: a.centre[1] }, region));
  const dimensions = dimensionsOf(doc, region);
  const columns = columnsOf(doc, columnIds, region);
  const objects = objectsOf(doc, states, region);
  const listedObjects = new Set(objects.map((o) => o.id));
  const listedWalls = new Set(walls.map((w) => w.id));
  const listed = (ref: ZoneRef): boolean => {
    switch (ref.table) {
      case "placements": return listedObjects.has(doc.placements[ref.id]?.object ?? "");
      case "openings": return listedWalls.has(doc.openings[ref.id]?.wall ?? "");
      default: return assertNever(ref);
    }
  };
  const layouts = states.map((s): LayoutSummary => ({ ...s, blocked: blockedIn(doc, s.id, listed) }));
  return {
    project, units: "m", counts, layouts, walls, joints, rooms: listedRooms, unplacedLabels, ...(unplacedAreas.length === 0 ? {} : { unplacedAreas }), objects, decks: decksOf(doc, region),
    ...(columns.length === 0 ? {} : { columns }),
    ...(dimensions.length === 0 ? {} : { dimensions }),
    fields,
    underlay,
    ceiling,
    ...(roof ? { roof } : {}),
    ...(outsideDefault ? { outside: outsideDefault } : {}),
    cut,
    levels: levelList,
    ...sheets,
    ...sections,
  };
}

/** The underlay's place and scale; reads two scalars of the row and never its data. */
function underlayOf(doc: Document): UnderlaySummary | null {
  const row = Object.hasOwn(doc.underlays, UNDERLAY_ID) ? doc.underlays[UNDERLAY_ID] : undefined;
  const rect = underlayRect(doc);
  if (!row || !rect) return null;
  return { bounds: { min: xy({ x: rect.minX, y: rect.minY }), max: xy({ x: rect.maxX, y: rect.maxY }) }, metresPerPixel: row.metresPerPixel, scaled: row.scaled };
}

/** Every layout's blocked clearances, as get_drawing lists them under each layout, with the layout's id: an edit's warnings. */
export function warningsOf(doc: Document): ({ layout: string } & Blocked)[] {
  return orderedStates(doc).flatMap((s) => blockedIn(doc, s.id, () => true).map((b) => ({ layout: s.id, ...b })));
}

/**
 * A state's blocked use zones and door swings, in zoneBlocks' order, read with names and ids; a zone over two walls
 * reads "wall" once. Only zones `listed` keeps: with a region, those of listed pieces and walls.
 */
function blockedIn(doc: Document, stateId: string, listed: (ref: ZoneRef) => boolean): Blocked[] {
  return zoneBlocks(doc, stateId).flatMap(({ zone, blockers }) => {
    const name = listed(zone) ? zoneName(doc, zone) : null;
    return name === null ? [] : blockers.map((b) => ({ zone: name, by: blockerName(b) }));
  });
}

function zoneName(doc: Document, ref: ZoneRef): string | null {
  switch (ref.table) {
    case "placements": {
      const o = doc.objects[doc.placements[ref.id]?.object ?? ""];
      return o ? `${o.name} (${o.id}) ${ref.side} zone` : null;
    }
    case "openings": {
      const o = doc.openings[ref.id];
      return o ? `${OPENING_KINDS[o.kind].noun} ${o.id} swing` : null;
    }
    default: return assertNever(ref);
  }
}

/** What overlaps a zone: a piece, by name and id, a column by id, or a wall. */
function blockerName(b: Blocker): string {
  switch (b.kind) {
    case "piece": return `${b.name} (${b.object})`;
    case "wall": return "wall";
    case "column": return `column ${b.id}`;
    default: return assertNever(b);
  }
}

/** The guard of the side that faces `name` on the plan now. */
function sideGuard(deck: Deck, name: PlanSide): GuardValue {
  const g = deck[sideField(sideAt(deck, name))];
  return { kind: g.kind, height: round(g.height, 3) };
}

/** Each deck, by ID; with a region, only those touching it. */
function decksOf(doc: Document, region: Region | undefined): DeckSummary[] {
  return deckViews(doc).flatMap((v) => {
    if (region && !touches(v.ring, region)) return [];
    return [{
      id: v.id, name: v.name, centre: xy(v.at), width: round(v.w, 3), depth: round(v.d, 3), rotation: v.rotation, corners: v.ring.map(xy),
      top: round(v.top, 3), solid: v.solid, range: { bottom: round(v.range.bottom, 3), top: round(v.range.top, 3) },
      holes: v.holes.map((h) => ({ id: h.id, centre: xy(h.at), width: round(h.w, 3), depth: round(h.d, 3), corners: h.ring.map(xy), guard: { kind: h.guard.kind, height: round(h.guard.height, 3) } })),
      slabArea: round(slabArea(v), 3),
      finish: v.finish, // as a room label lists its own (deck-floors.03)
      guards: { upper: sideGuard(v, "upper"), right: sideGuard(v, "right"), lower: sideGuard(v, "lower"), left: sideGuard(v, "left") }, // by plan name (edges.05)
    }];
  });
}

/** Each column among `ids`, as columnOf sees it; with a region, only those whose body touches it. */
function columnsOf(doc: Document, ids: readonly string[], region: Region | undefined): ColumnSummary[] {
  const bodies = wallBodies(doc); // every row, a column on a deck included: a region test, not a floor room's (pillars.53)
  return ids.flatMap((id) => {
    const c = columnOf(doc, id);
    const range = wallRange(doc, id);
    const row = doc.walls[id];
    if (!c || !range || !row) return []; // a valid document has none
    if (region && !touches(bodies.get(id) ?? [c.centre], region)) return [];
    const refs = deckRefs(row);
    return [{
      id, centre: xy(c.centre), width: round(c.width, 3), depth: round(c.depth, 3), rotation: round(c.rotation, 3) % 360,
      range: { bottom: round(range.bottom, 3), top: round(range.top, 3) }, inLineOf: c.line && [...c.line],
      ...(refs.base === null ? {} : { on: refs.base }),
      ...(refs.top === null ? {} : { top: refs.top }),
    }];
  });
}

/** Each dimension with its ends where the walls put them now; with a region, only those touching it. */
function dimensionsOf(doc: Document, region: Region | undefined): DimensionSummary[] {
  return sortedIds(doc.dimensions).flatMap((id) => {
    const d = doc.dimensions[id];
    const ends = d ? dimensionPoints(doc, d) : null;
    const length = d ? dimensionLength(doc, d) : null;
    if (!d || !ends || length === null) return []; // a valid document has none
    if (region && !touches([ends.a, ends.b], region)) return [];
    return [{ id, from: xy(ends.a), to: xy(ends.b), offset: round(d.offset, 3), length: round(length, 3) }];
  });
}

/** The set project fields and the set's settings by key, in the domain's order (sheet.06). */
function fieldsOf(doc: Document): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...PROJECT_FIELDS, ...SET_FIELDS]) {
    const value = doc.projectFields[f.key]?.value;
    if (value !== undefined) out[f.key] = value;
  }
  return out;
}
