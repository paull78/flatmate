import { OPENING_KINDS, dressingOf, roofOf, roofPlanes, sideFinishes, ceilingOver, deckViews, flightHandrails, kindOf, onSlab, floorRings, guardRuns, footprintQuad, geometryOf, halfWallTop, hasGlass, openingRange, spiralRails, stairBase, wallOutlines, wallRange, zones, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { patternShows } from "../view/finish/geometry";
import { deckFinishes, roomFinishes, spanFinishes } from "../view/finish/rooms";
import type { FinishGeometry } from "../view/finish/geometry";
import { flipPoses, type Flip } from "../view/flip-poses";
import { parkedBox } from "../view/opening-parts";
import { objectArms, shapedFill } from "../view/shapes";
import { jointCaps } from "./joint-caps";
import { MIN_SPACING_3D } from "./pattern-faces";
import type { Dressing3d, FloorItem, Item3d, Opening3d } from "./types";

/** The least gap drawn. */
const MIN_GAP = 0.1;

/** A floor's pattern in 3D: its lines and shapes when the spacing is at least MIN_SPACING_3D, else none (finishes.12). */
function patternOf(g: FinishGeometry | null): Pick<FloorItem, "lines" | "shapes"> {
  if (!g || !patternShows(g, MIN_SPACING_3D)) return { lines: [], shapes: [] };
  return { lines: g.lines, shapes: g.shapes.map((s) => ({ ring: s.points, holes: s.holes, color: s.color })) };
}

/**
 * The wall's doors and windows along it, with the domain's opening heights (levels.05); `spans`, each door's span floor;
 * `deckTop`, the finish of the deck the wall stands on, which a door there shows (sills.03: a loft has no rooms).
 */
function openings3d(doc: Document, wall: string, spans: ReadonlyMap<string, FinishGeometry>, deckTop: FinishGeometry | null): Opening3d[] {
  const out: Opening3d[] = [];
  for (const o of Object.values(doc.openings).filter((x) => x.wall === wall).sort((a, b) => a.offset - b.offset || a.sill - b.sill)) { // stacked ones bottom up
    const g = geometryOf(doc, o);
    const range = openingRange(doc, o.id);
    if (g === null || range === null) continue;
    if (range.top - range.bottom < MIN_GAP - 1e-9) continue;
    const span = spans.get(o.id) ?? (OPENING_KINDS[o.kind].fromFloor ? deckTop ?? undefined : undefined);
    const floor = span ? { color: span.fill.color, ...patternOf(span) } : null; // the room's floor through the doorway (thresholds.01)
    const dressing = dressing3d(doc, o.id, range.bottom - o.sill);
    out.push({ start: g.start, end: g.end, thickness: g.thickness, bottom: range.bottom, top: range.top, glass: hasGlass(o), floor, kind: o.kind, glazed: o.glazed, hinge: g.hinge, parked: parkedBox(o, g), ...(dressing ? { dressing } : {}) });
  }
  return out;
}

/** A window's dressing with its heights over its wall's bottom `base` (hangings.04), or null when it has none. */
function dressing3d(doc: Document, openingId: string, base: number): Dressing3d | null {
  const d = dressingOf(doc, openingId);
  if (!d) return null;
  const { box, curtain } = d;
  return {
    ...(box ? { box: { quad: box.quad, bottom: base + box.bottom, top: base + box.top } } : {}),
    ...(curtain ? { curtain: { a: curtain.line[0], b: curtain.line[1], out: d.out, bottom: base + curtain.bottom, top: base + curtain.top } } : {}),
  };
}

/**
 * The 3D view's items for the viewed `state`: floors, walls, decks (shared by every layout), then the state's pieces.
 * During a `flip` the pieces take the plan's poses (heights.29); a piece in one layout only shows until the middle of
 * the flip, or from it. `selection` holds the selected placement and deck ids. With `finishes` (the viewer's switch),
 * a finished floor or deck top takes its colour and, from a spacing of 0.10 m, its pattern's lines and filled shapes
 * (shown.04, deck-floors.02).
 */
export function view3dItems(doc: Document, state: string, flip: Flip | null, selection: ReadonlySet<string>, finishes: boolean): Item3d[] {
  const out: Item3d[] = [];
  const finished = new Map(finishes ? roomFinishes(doc).map((r) => [r.room, r.geometry]) : []);
  const decked = new Map(finishes ? deckFinishes(doc).map((d) => [d.id, d.geometry]) : []);
  const spanned = new Map(finishes ? spanFinishes(doc).map((s) => [s.id, s.geometry]) : []);
  for (const z of zones(doc)) {
    const { outer, holes } = floorRings(z);
    const g = finished.get(z.face.key);
    out.push({ item: "floor", room: z.face.key, ring: outer, holes, color: g?.fill.color ?? null, ...patternOf(g ?? null) });
  }
  const caps = jointCaps(doc);
  for (const [wall, outline] of wallOutlines(doc)) {
    const range = wallRange(doc, wall);
    const planes = doc.walls[wall]?.top === "ceiling" && roofOf(doc).shape !== "flat" ? roofPlanes(doc) : null; // roofs.16
    const row = doc.walls[wall];
    const [a, b] = [doc.joints[row?.a ?? ""], doc.joints[row?.b ?? ""]];
    const len = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    const left = a && b && len > 0 ? { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } : { x: 0, y: 0 }; // a→b turned a quarter left
    const sides = finishes ? sideFinishes(doc, wall) : null; // what each side shows (inherit.01), behind the Finishes switch as floors are (surfaces step 03)
    if (range) out.push({ item: "wall", wall, outline, bottom: range.bottom, top: range.top, full: halfWallTop(doc, wall) === null, openings: openings3d(doc, wall, spanned, decked.get(row?.base ?? "") ?? null), caps: caps.get(wall) ?? [], planes, left, sides });
  }
  for (const d of deckViews(doc)) {
    const g = decked.get(d.id) ?? null;
    const finish = g ? { color: g.fill.color, ...patternOf(g) } : null; // its top in its finish (deck-floors.02)
    out.push({ item: "deck", deck: d.id, fills: d.fills, edges: d.edges, bottom: d.range.bottom, top: d.range.top, selected: selection.has(d.id), finish });
  }
  guardRuns(doc).forEach((run, i) => out.push({ item: "guard", key: `${run.deck}/${i}`, kind: run.kind, a: run.a, b: run.b, bottom: run.bottom, top: run.top }));
  const placementIn = (objectId: string, stateId: string): string | undefined =>
    Object.values(doc.placements).find((p) => p.object === objectId && p.state === stateId)?.id;
  for (const pose of flipPoses(doc, flip ?? { from: state, to: state, t: 0 })) {
    if (flip && ((pose.only === "from" && pose.e >= 0.5) || (pose.only === "to" && pose.e < 0.5))) continue;
    const placement = placementIn(pose.objectId, pose.only === "from" || flip === null ? (flip?.from ?? state) : flip.to);
    if (placement === undefined) continue;
    const object = doc.objects[pose.objectId];
    const arms = objectArms(object); // an `L`'s, which its ring and parts take (catalog.17)
    const ring = shapedFill(pose.kind, pose.w, pose.d, pose.at, pose.rotation, footprintQuad(pose.at, pose.w, pose.d, pose.rotation), arms);
    const base = stairBase(doc, placement); // above the bottom only for a stair starting at a deck's edge (stairs.49)
    const options = object?.options; // what the parts add (library.10)
    const handrails = flightHandrails(doc).get(pose.objectId) ?? [];
    const rails = spiralRails(doc).get(pose.objectId);
    const flueTop = kindOf(pose.kind)?.flue === true ? flueTopOver(doc, ring, pose.centre, pose.top) : undefined;
    out.push({
      item: "piece", placement, object: pose.objectId, objectKind: pose.kind, config: pose.config, ring, centre: pose.centre, rotation: pose.rotation,
      w: pose.w, d: pose.d, bottom: pose.bottom, top: pose.top, ...(base !== null && base > pose.bottom + 1e-9 ? { base } : {}),
      ...(object?.riser === undefined ? {} : { riser: object.riser }), ...(options === undefined ? {} : { options }), ...(arms === undefined ? {} : { arms }), ...(handrails.length === 0 ? {} : { handrails }), ...(rails === undefined ? {} : { spiralRails: rails }), ...(flueTop === undefined ? {} : { flueTop }), selected: selection.has(placement),
    });
  }
  return out;
}

/**
 * Where a stove's flue ends (pieces.04, .08): the underside of the lowest deck over its centre that lies above its top,
 * else the ceiling over it. Read from the domain's vertical facts (heights.27); the flue is drawn, never a solid.
 */
function flueTopOver(doc: Document, ring: readonly Point[], centre: Point, top: number): number {
  const undersides = deckViews(doc).filter((d) => d.range.bottom >= top - 1e-9 && onSlab(d, centre)).map((d) => d.range.bottom);
  return Math.min(ceilingOver(doc, ring), ...undersides);
}

