import { areaAt, selectAreaHit } from "./area-hit";
import { areaTagAt } from "../view/area-tags";
import {
  deckUnder, deckViews, holeView, dimensionPoints, distance, distanceToSegment, dot, faceAt, firstLabelId, inConvex, fitShapes, hitCandidates, isFloor, levelDeckAt, openingGeometry, placementRange, pointInPolygon, sortedIds,
  isRug, isSeat, isWell, pickOrder, sectionsOf, stairRuleOf, sub, zones, type Stacked,
  type Document, type EntityRef, type Level, type Side,
} from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import { activeStateId, viewedLevelOn, type EditorState } from "../state";
import { dimensionLayout } from "../view/dimension-layout";
import { CANVAS_STYLE } from "../view/plan-style";
import { distanceToMark } from "../view/section-marks-layer";
import { tagAt } from "../view/tags";
import { HANDLE_HIT_PX, handles, type Handle } from "../view/handles";
import { zoneChips } from "../view/zone-chips";
import { selectableAt } from "./selectable";
import type { Strip } from "../snapping/zone-drag";
import type { DragTarget } from "./types";

export const DRAG_THRESHOLD_PX = 4; // spec: tools
export const HIT_TOLERANCE_PX = 6;

/**
 * handle: the drag a handle under the pointer starts, null for a hit on the thing itself. chip: a zone chip under the
 * pointer, whose click toggles that side (smart.24); it never drags. drawn: the handle as the scene draws it, for the
 * cursor (furnish.10); chips stay out of Handle (smart.34). stack: on a piece, every piece of the layout under the
 * pointer in the stacking order (heights.38); `ref` is the selected one among them, else the first. hole: the hole under them, next in the click cycle (riser.20).
 */
/** `openings`: every opening at the point the level can select, lowest first, when there are two or more: a click cycles them (sills.26). */
/** `under`: for the selected area's body, what a click goes on to there (areas.38); a press keeps the area, so a drag moves it. */
export type Hit = { ref: EntityRef; handle: DragTarget | null; chip?: { placementId: string; side: Side }; drawn?: Handle; hole?: string; stack?: readonly string[]; openings?: readonly string[]; under?: EntityRef };

/**
 * Handles of the selection win (a wall's joints, a piece's side and rotation grips, then its zone handles), then a
 * selected piece's zone chips, joints, placed dimensions (dims.17), openings, walls (a piece holding the point wins in
 * a wall's tolerance band, off its body), section marks, objects of the active layout,
 * zone tags, decks (decks.19) and labelled floors (spec: tools, layouts). The Select tool checks the helper dimension before calling this (Task 5.7).
 * Each family offers only what the viewed level can select (levels.06), before the order picks: at the loft a click on
 * the partition under it reaches the loft.
 */
export function hitTest(state: EditorState, world: Point): Hit | null {
  if (!state.document) return null;
  const doc = visibleDoc(state.document);
  const layout = activeStateId(state);
  const level = viewedLevelOn(state, doc);
  const can = selectableHere(state, doc);
  const handle = handleHit(state, doc, world, can) ?? chipHit(state, doc, world, can);
  if (handle) return handle;
  const first = hitCandidates(doc, world, HIT_TOLERANCE_PX / state.camera.zoom).filter(can)[0];
  if (first?.table === "joints") return { ref: first, handle: null };
  const dimension = dimensionAt(doc, world, state.camera.zoom);
  if (dimension && can({ table: "dimensions", id: dimension })) return { ref: { table: "dimensions", id: dimension }, handle: null };
  // An opening lies in its wall's body: it wins over the wall (the joint returned above). Openings stacked on a stretch
  // of wall share the point: the selected one stays the hit (so a press can drag it), else the lowest (sills.26).
  const stacked = openingsAt(doc, world, HIT_TOLERANCE_PX / state.camera.zoom).filter((id) => can({ table: "openings", id }));
  const opening = stacked.find((id) => state.selection.some((r) => r.table === "openings" && r.id === id)) ?? stacked[0];
  if (opening !== undefined) return { ref: { table: "openings", id: opening }, handle: null, ...(stacked.length > 1 ? { openings: stacked } : {}) };
  // A wall keeps every click on its body; in the band around it a piece whose footprint holds the point wins, so a
  // mirror or a radiator hung against it can be clicked at any zoom (hangings, found in the browser).
  const inBand = first?.table === "walls" && !hitCandidates(doc, world, 0).some((r) => r.table === "walls" && r.id === first.id);
  const pieceInBand = inBand && layout !== null && placementsAt(doc, world, layout).some((id) => can({ table: "placements", id }));
  if (first && !pieceInBand) return { ref: first, handle: null };
  // A mark crosses walls and rooms as a thin line: under the walls, so they stay clickable; over the rest, as it's drawn.
  const mark = sectionAt(doc, world, state.camera.zoom, state.sectionMarksOn ? null : state.selection);
  if (mark && can({ table: "sections", id: mark })) return { ref: { table: "sections", id: mark }, handle: null };
  // A named area's tag, drawn over the pieces, before them: it may sit on furniture where its area has no free spot
  // (areas.36, .39). Room tags move off furniture, so they stay after the pieces (shown.02).
  const areaTag = areaTagAt(doc, world, state.camera, layout);
  if (areaTag && can({ table: "areas", id: areaTag })) return { ref: { table: "areas", id: areaTag }, handle: null };
  const stack = layout === null ? [] : placementsAt(doc, world, layout).filter((id) => can({ table: "placements", id }));
  const selected = stack.find((id) => state.selection.some((r) => r.table === "placements" && r.id === id));
  const object = selected ?? stack[0];
  // The hole under the pieces comes last in the click cycle, and holds a press while selected, so it can be dragged (riser.20).
  const holeUnder = holeHere(doc, world, level);
  const under = holeUnder !== null && can({ table: "deckHoles", id: holeUnder }) ? holeUnder : null;
  if (object !== undefined && under !== null && state.selection.some((r) => r.table === "deckHoles" && r.id === under)) return { ref: { table: "deckHoles", id: under }, handle: null, stack };
  if (object !== undefined) return { ref: { table: "placements", id: object }, handle: null, stack, ...(under === null ? {} : { hole: under }) };
  // Room tags, then the selected area's body, holding a press over what's under it (areas.38); then decks (decks.19: a
  // tag under a loft stays clickable), then labelled floors.
  const tag = tagAt(doc, world, state.camera, layout);
  if (tag && can({ table: "zoneLabels", id: tag })) return { ref: { table: "zoneLabels", id: tag }, handle: null };
  const below = belowTags(doc, world, level, can);
  const body = selectAreaHit(doc, world, state.camera, layout, state.selection);
  if (body && can(body)) return { ref: body, handle: null, ...(below ? { under: below.ref } : {}) };
  return below;
}

/** What lies under the tags at the point: a hole (before its deck), the deck, then a labelled floor. */
function belowTags(doc: Document, world: Point, level: Level, can: (ref: EntityRef) => boolean): Hit | null {
  // A hole (stairwell.16, smalls.12), before its deck.
  // A deck standing in it comes first (stairwell.17): a platform, or an L's landing, has no other click path.
  const hole = holeHere(doc, world, level);
  if (hole && can({ table: "deckHoles", id: hole })) return { ref: { table: "deckHoles", id: hole }, handle: null };
  const deck = deckAt(doc, world, level);
  if (deck) return { ref: { table: "decks", id: deck }, handle: null };
  const floor = labelAtFloor(doc, world);
  return floor && can({ table: "zoneLabels", id: floor }) ? { ref: { table: "zoneLabels", id: floor }, handle: null } : null;
}

/**
 * Everything at the point the viewed level can select, top first, as a click cycle reaches them (AC-06): a section's mark, a dimension, an
 * opening, walls, then the layout's pieces, a room's tag, the hole and its deck or the deck there, and a labelled floor.
 * Joints stay out: a wall's row says the same to a person.
 */
export function everythingAt(state: EditorState, world: Point): EntityRef[] {
  if (!state.document) return [];
  const doc = visibleDoc(state.document);
  const layout = activeStateId(state);
  const level = viewedLevelOn(state, doc);
  const tolerance = HIT_TOLERANCE_PX / state.camera.zoom;
  const one = (table: EntityRef["table"], id: string | null | undefined): EntityRef[] => (id ? [{ table, id }] : []);
  const hole = holeHere(doc, world, level);
  const refs: EntityRef[] = [
    ...one("sections", sectionAt(doc, world, state.camera.zoom, state.sectionMarksOn ? null : state.selection)),
    ...one("dimensions", dimensionAt(doc, world, state.camera.zoom)),
    ...openingsAt(doc, world, tolerance).map((id): EntityRef => ({ table: "openings", id })),
    ...hitCandidates(doc, world, tolerance).filter((r) => r.table !== "joints"),
    ...(layout === null ? [] : placementsAt(doc, world, layout)).flatMap((id) => one("placements", id)),
    ...one("areas", areaTagAt(doc, world, state.camera, layout) ?? areaAt(doc, world)),
    ...one("zoneLabels", tagAt(doc, world, state.camera, layout)),
    ...one("deckHoles", hole),
    ...one("decks", hole ? holeView(doc, hole)?.deck.id : deckAt(doc, world, level)),
    ...one("zoneLabels", labelAtFloor(doc, world)),
  ];
  const can = selectableHere(state, doc);
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.table}|${r.id}`;
    if (seen.has(key) || !can(r)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The hole a click at the point could mean, with no deck standing in it (stairwell.17): at the floor any deck's, at an
 * upper level only that level's decks' (smalls.12).
 */
function holeHere(doc: Document, world: Point, level: Level): string | null {
  if ((isFloor(level) ? deckUnder(doc, world) : levelDeckAt(doc, level, world)) !== null) return null;
  for (const deck of deckViews(doc)) {
    if (!isFloor(level) && !level.deckIds.includes(deck.id)) continue;
    for (const h of deck.holes) if (inConvex(world, h.ring, 0)) return h.id;
  }
  return null;
}

/**
 * The deck a click at the point reaches: at the floor level the highest deck under it, any deck (deckUnder); at an
 * upper level the level's own deck under it (levelDeckAt), so a higher deck touching it on a shared edge doesn't take
 * the click.
 */
function deckAt(doc: Document, world: Point, level: Level): string | null {
  return (isFloor(level) ? deckUnder(doc, world) : levelDeckAt(doc, level, world))?.id ?? null;
}

/**
 * The zone chip a press at the pointer would toggle (handles win, as in hitTest), for its hover look (furnish.09).
 * Outside the Select tool zoneChips is empty, so this is null.
 */
export function chipUnderPointer(state: EditorState, doc: Document): { placementId: string; side: Side } | null {
  if (!state.pointer) return null;
  const world = state.pointer.world;
  const can = selectableHere(state, doc);
  return handleHit(state, doc, world, can) ? null : chipHit(state, doc, world, can)?.chip ?? null;
}

/** What the viewed level can select in the active layout (selectableAt), as a test on one ref. */
function selectableHere(state: EditorState, doc: Document): (ref: EntityRef) => boolean {
  const layout = activeStateId(state);
  const level = viewedLevelOn(state, doc);
  return (ref) => selectableAt(doc, layout, ref, level);
}

/**
 * The placed dimension whose line or text is nearest the point within the hit tolerance, as the dimensions layer
 * draws it (dims.19); a tie goes to the lower ID. Extension lines do not hit.
 */
export function dimensionAt(doc: Document, world: Point, zoom: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const id of sortedIds(doc.dimensions)) {
    const row = doc.dimensions[id];
    const pts = row ? dimensionPoints(doc, row) : null;
    const layout = row && pts ? dimensionLayout(pts.a, pts.b, row.offset, CANVAS_STYLE, zoom) : null;
    if (!layout) continue;
    const d = pointInPolygon(world, layout.text.box) ? 0 : distanceToSegment(world, ...layout.line);
    if (d <= HIT_TOLERANCE_PX / zoom && (!best || d < best.d)) best = { id, d };
  }
  return best?.id ?? null;
}

/** The section whose mark is nearest the point within the hit tolerance; a tie goes to the earlier letter. `only`, with the marks switched off, is what still draws. */
function sectionAt(doc: Document, world: Point, zoom: number, only: readonly EntityRef[] | null): string | null {
  let best: { id: string; d: number } | null = null;
  for (const row of sectionsOf(doc)) {
    if (only !== null && !only.some((r) => r.table === "sections" && r.id === row.id)) continue;
    const d = distanceToMark(row, CANVAS_STYLE.mark, zoom, world);
    if (d <= HIT_TOLERANCE_PX / zoom && (!best || d < best.d)) best = { id: row.id, d };
  }
  return best?.id ?? null;
}

/**
 * The placements of the layout whose shape holds the point (their fit shapes, shapefit.01: a round table's square
 * outside its circle doesn't hit), in the click cycle's order: by bottom, lowest first, then by ID (heights.38); a seat
 * after the others at its bottom, so the table over a tucked chair comes first (seating.10); a rug after every piece
 * (catalog.15).
 */
function placementsAt(doc: Document, world: Point, layout: string): string[] {
  const out: Stacked[] = [];
  for (const [id, ring] of fitShapes(doc)) {
    const range = placementRange(doc, id);
    const p = doc.placements[id];
    const kind = p ? (doc.objects[p.object]?.kind ?? "") : "";
    if (range && p?.state === layout && pointInPolygon(world, ring)) out.push({ id, range, stair: stairRuleOf(kind) !== null, seat: isSeat(kind) || isWell(kind), rug: isRug(kind) }); // a well, as a seat, picks after what covers it (trailer.10)
  }
  return out.sort(pickOrder).map((x) => x.id);
}

/**
 * The opening whose span holds the point along its wall and whose wall body (± `tolerance`) holds it across; the
 * first in ID order wins (openings on one wall do not overlap).
 */
/** Every opening whose span lies under the point, lowest first (by sill, then ID): stacked ones share it (sills.26). */
function openingsAt(doc: Document, world: Point, tolerance: number): string[] {
  return sortedIds(doc.openings).filter((id) => {
    const g = openingGeometry(doc, id);
    const o = doc.openings[id];
    if (!g || !o) return false;
    const along = dot(sub(world, g.start), g.along);
    const across = Math.abs(dot(sub(world, g.start), g.normal));
    return along >= 0 && along <= o.width && across <= g.thickness / 2 + tolerance;
  }).sort((p, q) => (doc.openings[p]?.sill ?? 0) - (doc.openings[q]?.sill ?? 0));
}

/** The label of the labelled room under the point; null on a boundary, outside, or in an unlabelled room. */
export function labelAtFloor(doc: Document, world: Point): string | null {
  const face = faceAt(doc, world);
  if (!face) return null;
  const zone = zones(doc).find((z) => z.face.key === face.key);
  return zone ? firstLabelId(zone) : null;
}

/**
 * The hittable handle in range of the lowest rank (joints and grips, then zone handles), the nearest within it;
 * endpoint `a` wins an exact tie, as does the first grip.
 */
function handleHit(state: EditorState, doc: Document, world: Point, can: (ref: EntityRef) => boolean): Hit | null {
  let best: { hit: Hit; d: number; rank: number } | null = null;
  for (const h of handles(state, doc)) {
    const d = distance(h.at, world);
    const rank = handleRank(h);
    const hit = handleTarget(h);
    if (!h.hittable || d > HANDLE_HIT_PX / state.camera.zoom || !can(hit.ref)) continue;
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { hit, d, rank };
  }
  return best?.hit ?? null;
}

/** The hit order among handles (spec: layouts): joints and grips first, then zone handles. */
function handleRank(h: Handle): number {
  switch (h.kind) {
    case "joint":
    case "side":
    case "rotate":
    case "armGrip":
    case "deckSide":
    case "holeSide":
    case "areaSide":
    case "sectionEnd":
    case "sectionFar":
      return 0;
    case "zoneDepth":
    case "zoneEnd":
      return 1;
    default:
      return assertNever(h);
  }
}

/** The nearest zone chip in range; the first in SIDE_IDS order wins an exact tie. */
function chipHit(state: EditorState, doc: Document, world: Point, can: (ref: EntityRef) => boolean): Hit | null {
  let best: { hit: Hit; d: number } | null = null;
  for (const c of zoneChips(state, doc)) {
    const d = distance(c.at, world);
    if (d > HANDLE_HIT_PX / state.camera.zoom || (best && d >= best.d) || !can({ table: "placements", id: c.placementId })) continue;
    best = { hit: { ref: { table: "placements", id: c.placementId }, handle: null, chip: { placementId: c.placementId, side: c.side } }, d };
  }
  return best?.hit ?? null;
}

/** A zone handle's strip of an `L` front (catalog.13), only when it has one. */
const strip = (h: { strip?: Strip }): { strip?: Strip } => (h.strip === undefined ? {} : { strip: h.strip });

function handleTarget(h: Handle): Hit {
  switch (h.kind) {
    case "joint":
      return { ref: { table: "joints", id: h.joint }, handle: { kind: "joint", jointId: h.joint }, drawn: h };
    case "side":
      return { ref: { table: "placements", id: h.placementId }, handle: { kind: "resize", placementId: h.placementId, side: h.side }, drawn: h };
    case "rotate":
      return { ref: { table: "placements", id: h.placementId }, handle: { kind: "rotate", placementId: h.placementId }, drawn: h };
    case "armGrip":
      return { ref: { table: "placements", id: h.placementId }, handle: { kind: "armGrip", placementId: h.placementId, arm: h.arm }, drawn: h };
    case "zoneDepth":
      return { ref: { table: "placements", id: h.placementId }, handle: { kind: "zoneDepth", placementId: h.placementId, side: h.side, ...strip(h) }, drawn: h };
    case "zoneEnd":
      return { ref: { table: "placements", id: h.placementId }, handle: { kind: "zoneEnd", placementId: h.placementId, side: h.side, end: h.end, ...strip(h) }, drawn: h };
    case "deckSide":
      return { ref: { table: "decks", id: h.deckId }, handle: { kind: "deckSide", deckId: h.deckId, side: h.side }, drawn: h };
    case "holeSide":
      return { ref: { table: "deckHoles", id: h.holeId }, handle: { kind: "holeSide", holeId: h.holeId, side: h.side }, drawn: h };
    case "areaSide":
      return { ref: { table: "areas", id: h.areaId }, handle: { kind: "areaSide", areaId: h.areaId, side: h.side }, drawn: h };
    case "sectionEnd":
      return { ref: { table: "sections", id: h.sectionId }, handle: { kind: "sectionEnd", sectionId: h.sectionId, end: h.end }, drawn: h };
    case "sectionFar":
      return { ref: { table: "sections", id: h.sectionId }, handle: { kind: "sectionFar", sectionId: h.sectionId }, drawn: h };
    default:
      return assertNever(h);
  }
}
