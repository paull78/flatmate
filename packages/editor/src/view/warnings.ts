import { centroid, distance, isFloor, missingGuards, shownAt, swingZone, zoneBlocks, zoneRings, type Blocker, type Document, type Level, type MissingGuard, type ZoneRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { COLORS } from "./colors";
import { CHROME_FONT } from "./fonts";
import { memoLast } from "./memo";
import { openingCut } from "./openings-layer";
import type { PlanView } from "./plan-view";
import type { Primitive } from "./scene-types";
import type { WarningRow } from "./view-model-types";

/** A warning a viewer sees: its zone, the ring the plan draws, and what blocks it, the level's rule applied. */
export type ShownWarning = { zone: ZoneRef; ring: readonly Point[]; blockers: readonly Blocker[] };

/**
 * The warned use zones and door swings of the view's layout at its level, one per zone (clarity.04): the one owner the
 * amber layer reads, and with `shownGuards` the list, the marks and the count, so they can't disagree. Memoised on one slot, so a second reader must pass the same document
 * the scene draws, or the two would rebuild in turn during a drag (clarity.12). A function of the document alone.
 */
export const shownWarnings = memoLast((doc: Document, view: PlanView): readonly ShownWarning[] => {
  const { layout, level } = view;
  if (layout === null) return [];
  return zoneBlocks(doc, layout).flatMap(({ zone, blockers }) => {
    const shown = shownBlockers(doc, zone, blockers, level);
    const ring = shown.length > 0 ? zoneRing(doc, zone) : null;
    return ring ? [{ zone, ring, blockers: shown }] : [];
  });
});

/**
 * The high decks with no guard the view shows (guards.16): at the floor, where a deck's guard is usually changed, and at
 * its own level; not at another loft's. A deck is shared, so every layout has them. They have no zone, so no amber ring.
 */
function shownGuards(doc: Document, view: PlanView): readonly MissingGuard[] {
  const { level } = view;
  return missingGuards(doc).filter((m) => isFloor(level) || level.deckIds.includes(m.deck));
}

/** How many warnings the view shows: what the count says, and what an edit raising it blinks (clarity.02). */
export function warningCount(doc: Document, view: PlanView): number {
  return shownWarnings(doc, view).length + shownGuards(doc, view).length;
}

/**
 * The list's rows, one per shown warning, so the count is the number of marks (clarity.04). A row's ref is the zone's
 * piece or door, never a blocker, which may be hidden (clarity.23), or the deck with no guard. Pass the document the scene draws, as above.
 */
export const warningRows = memoLast((doc: Document, view: PlanView): readonly WarningRow[] => [
  ...shownWarnings(doc, view).map(({ zone, blockers }): WarningRow => ({
    key: rowKey(zone),
    text: `${zoneWords(doc, zone)} is blocked by ${blockerWords(blockers)}`,
    ref: { table: zone.table, id: zone.id },
  })),
  ...shownGuards(doc, view).map(guardRow),
]);

/**
 * A side or hole with no guard (edges.04): the side named by where it faces now, a hole by its deck; a row selects the
 * deck, or the hole, where the guard is set.
 */
function guardRow(m: MissingGuard): WarningRow {
  if (m.plan !== null) return { key: `guard|${m.deck}|${m.side ?? ""}`, text: `No guard on ${m.name}'s ${m.plan} side`, ref: { table: "decks", id: m.deck } };
  return { key: `guard|${m.deck}|${m.hole ?? ""}`, text: `No guard round a hole in ${m.name}`, ref: { table: "deckHoles", id: m.hole ?? "" } };
}

function rowKey(zone: ZoneRef): string {
  switch (zone.table) {
    case "placements": return `${zone.id}|${zone.side}`;
    case "openings": return zone.id;
    default: return assertNever(zone);
  }
}

function zoneWords(doc: Document, zone: ZoneRef): string {
  switch (zone.table) {
    case "placements": return `${doc.objects[doc.placements[zone.id]?.object ?? ""]?.name || "Object"}'s ${zone.side}`;
    case "openings": return "Door's swing"; // doors have no names (clarity.12)
    default: return assertNever(zone);
  }
}

function blockerWords(blockers: readonly Blocker[]): string {
  const names = blockers.map(blockerName);
  const [first = "", second = ""] = names;
  if (names.length < 2) return first;
  return names.length === 2 ? `${first} and ${second}` : `${first}, ${second} and ${names.length - 2} more`;
}

function blockerName(blocker: Blocker): string {
  switch (blocker.kind) {
    case "piece": return blocker.name || "Object";
    case "wall": return "a wall";
    case "column": return "a column";
    default: return assertNever(blocker);
  }
}

const MARK_RADIUS_PX = 11;
const MARK_INNER_PX = 9.5;
const MARK_GLYPH_PX = 13; // fonts have no weight, so a bigger "!" stands in for a bold one (clarity.12)
const MARK_INSET_PX = 14;

/**
 * A "!" for each shown warning (clarity.02): a fixed size in pixels, so it needs the zoom and lives in `overlays` rather
 * than the warnings layer (clarity.12). Discs, then glyphs: the GPU's order, for Canvas2D too.
 */
export function warningMarks(doc: Document, view: PlanView, zoom: number): Primitive[] {
  const spots = [...shownWarnings(doc, view).map((w) => markSpot(w.ring, zoom)), ...shownGuards(doc, view).map((m) => m.at)];
  return [
    ...spots.flatMap((center): Primitive[] => [
      { kind: "disc", center, radius: { px: MARK_RADIUS_PX }, color: COLORS.warningLine },
      { kind: "disc", center, radius: { px: MARK_INNER_PX }, color: COLORS.warningMark },
    ]),
    ...spots.map((at): Primitive => ({ kind: "text", text: "!", at, size: MARK_GLYPH_PX, color: COLORS.warningGlyph, align: "center", rotation: 0, font: CHROME_FONT })),
  ];
}

/** The ring's corner with the largest x + y, moved toward its centroid by the inset, never past it. */
function markSpot(ring: readonly Point[], zoom: number): Point {
  const corner = ring.reduce((best, p) => (p.x + p.y > best.x + best.y ? p : best), ring[0] ?? { x: 0, y: 0 });
  const middle = centroid(ring) ?? corner;
  const length = distance(corner, middle);
  const inset = MARK_INSET_PX / zoom;
  if (length <= inset) return middle;
  const t = inset / length;
  return { x: corner.x + (middle.x - corner.x) * t, y: corner.y + (middle.y - corner.y) * t };
}

/**
 * The level's rule (levels.19, shown.02). A use zone goes with its own piece, so a piece under the level that blocks a
 * shown piece's zone still counts and is still named. A swing goes with its door (levels.05) and with what blocks it.
 */
function shownBlockers(doc: Document, zone: ZoneRef, blockers: readonly Blocker[], level: Level): readonly Blocker[] {
  switch (zone.table) {
    case "placements": return shownAt(doc, zone.id, level) ? blockers : [];
    case "openings": return openingCut(doc, zone.id, level) ? blockers.filter((b) => b.kind !== "piece" || shownAt(doc, b.placement, level)) : [];
    default: return assertNever(zone);
  }
}

/** The ring of a warned zone: one side's use zone as drawn (an `L` front's union once), or a door's swing. */
function zoneRing(doc: Document, zone: ZoneRef): readonly Point[] | null {
  switch (zone.table) {
    case "placements": return zoneRings(doc).get(zone.id)?.find((z) => z.side === zone.side)?.ring ?? null;
    case "openings": return swingZone(doc, zone.id);
    default: return assertNever(zone);
  }
}
