import { guardBoxes } from "./guard-faces";
import { signedArea } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import type { PlanStyle } from "../view/plan-style";
import type { Primitive } from "../view/scene-types";
import { itemKey } from "./faces";
import { partSolids } from "./parts/solids";
import { newell } from "./prism";
import { acrossOf, alongOf, clipBy, clipRing, outlinedShape, runs, stripSides, type SectionFrame } from "./section-cut";
import { farToNear, raySpans, type Solid, type Span } from "./section-order";
import { sheerStrips } from "./dressing-faces";
import { ownFaces } from "./own-faces";
import { stairFaces } from "./stair-faces";
import { STYLE_3D } from "./style";
import type { DeckItem, Face3d, GuardItem, Item3d, Opening3d, PieceItem, Point3, Ring, WallItem } from "./types";
import { uniqueSorted } from "./wall-faces";
import { slopedWall, type SectionPlane } from "./section-roof";
import { wallPaint } from "./section-finish";
import { MIN_SPACING_3D } from "./pattern-faces";

// What lies past a section's plane (AC-05, AC-07): white shapes with outlines, far to near, within the depth.
//
//     plan                                picture
//     ┌──────── far line ───────┐        ┌────────────┐  a wall: its clipped ring's stretch × its range
//     │   ▒▒▒     ┌────────┐    │        │ ┌─┐   ┌──┐ │  a door: a rectangle on the wall, no seeing through
//     │           └────────┘    │        │ │ │   │  │ │  a piece: each part the same, with the panels facing us
//     ●━━━━━━━━━━ line ━━━━━━━━━●        └─┴─┴───┴──┴─┘  a stair: its faces, clipped and flattened, far first
//
// SVG has no clip, so everything is clipped here, at the plane, the far line and the line's ends. A stair is one unit in
// the order, sorted inside itself by each face's mean depth, which is enough for faces this regular (section.07).

const EPS = 1e-9;

/** The section's strip and the picture's inks. */
type View = { frame: SectionFrame; sides: readonly ((p: Point) => number)[]; ink: PlanStyle["section"]; roof: readonly SectionPlane[] | null; minSpacing: number };
/** A solid past the plane, ready to order and draw. */
export type BeyondSolid = Solid & { drawn: readonly Primitive[] };
/** A face flat in the picture, and how deep it is on average. */
type Flat = { points: readonly Point[]; depth: number };

const between = (p: Point3, q: Point3, t: number): Point3 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });

/** Rings clipped to the strip, in the frame the order works in: x along the line, y the depth. */
function inStrip(view: View, rings: readonly Ring[]): Ring[] {
  return rings.map((ring) => view.sides.reduce<Ring>((r, keep) => clipRing(r, keep), ring).map((p) => ({ x: alongOf(view.frame, p), y: acrossOf(view.frame, p) })));
}

/** Where along the line clipped rings have any material: a band that lies within a slab's hole has none across the hole. */
const spansOf = (rings: readonly Ring[]): Span[] => runs(uniqueSorted(rings.flat().map((p) => p.x)), (x) => raySpans(rings, x).length > 0);

/** A flat face clipped to the strip and laid in the picture, or nothing where it's edge on or outside it. Its holes aren't used: stairs' faces and panels have none. */
function flatten(view: View, face: readonly Point3[]): Flat[] {
  const clipped = view.sides.reduce<readonly Point3[]>((f, keep) => clipBy(f, keep, between), face);
  const points = clipped.map((p) => ({ x: alongOf(view.frame, p), y: p.z }));
  if (Math.abs(signedArea(points)) <= EPS) return [];
  return [{ points, depth: clipped.reduce((sum, p) => sum + acrossOf(view.frame, p), 0) / clipped.length }];
}

/**
 * A prism past the plane: a rectangle for each stretch of it, with what's drawn on it after them. `paint`, when given,
 * fills a stretch's outline in place of the plain white (a wall's finishes, surfaces step 13); the outline is drawn over it.
 */
function prismSolid(view: View, key: string, ringsOnPlan: readonly Ring[], bottom: number, top: number, line: string, width: number, details: () => Primitive[], sloped = false, paint?: (outline: readonly Point[]) => Primitive[]): BeyondSolid[] {
  const rings = inStrip(view, ringsOnPlan);
  const spans = spansOf(rings);
  if (spans.length === 0) return [];
  // A full wall under a slope: its top follows the ceiling over its depth (roofs.14), else a rectangle.
  const depths = rings.flat().map((p) => p.y);
  const outlineOf = ([lo, hi]: Span): Point[] => (sloped && view.roof
    ? slopedWall(view.roof, lo, hi, bottom, Math.min(...depths), Math.max(...depths))
    : [{ x: lo, y: bottom }, { x: hi, y: bottom }, { x: hi, y: top }, { x: lo, y: top }]);
  const shape = (span: Span): Primitive[] => {
    const points = outlineOf(span);
    const [plain, ...edges] = outlinedShape(points, view.ink.beyond, line, width);
    return paint ? [...paint(points), ...edges] : [...(plain ? [plain] : []), ...edges];
  };
  const drawn = [...spans.flatMap(shape), ...details()];
  return [{ key, rings, spans, bottom, top, drawn }];
}

/** A door or window as the rectangle on its wall's centre line. */
function openingShape(view: View, o: Opening3d): Primitive[] {
  const { beyondPartWidth, beyondWall, door, glass } = view.ink;
  const quad: Point3[] = [{ ...o.start, z: o.bottom }, { ...o.end, z: o.bottom }, { ...o.end, z: o.top }, { ...o.start, z: o.top }];
  return [...flatten(view, quad).flatMap((f) => outlinedShape(f.points, o.glass ? glass : door, beyondWall, beyondPartWidth)), ...dressingShapes(view, o)];
}

/**
 * A window's dressing over it (hangings.04, AC-08), when its room side faces us: the shutter box's front, then the
 * sheer's strips in front of it, white with part outlines as a piece's parts. From outside the wall hides them.
 */
function dressingShapes(view: View, o: Opening3d): Primitive[] {
  const d = o.dressing;
  const out = d?.curtain?.out ?? (d?.box ? boxOut(d.box.quad) : undefined);
  if (!d || !out || out.x * view.frame.seen.x + out.y * view.frame.seen.y >= -EPS) return [];
  const { beyond, beyondPart, beyondPartWidth } = view.ink;
  const rect = (a: Point, b: Point, z0: number, z1: number): Primitive[] =>
    flatten(view, [{ ...a, z: z0 }, { ...b, z: z0 }, { ...b, z: z1 }, { ...a, z: z1 }]).flatMap((f) => outlinedShape(f.points, beyond, beyondPart, beyondPartWidth));
  const [, , front1, front0] = d.box?.quad ?? [];
  const box = d.box && front0 && front1 ? rect(front0, front1, d.box.bottom, d.box.top) : [];
  const c = d.curtain;
  const strips = c ? sheerStrips(c.a, c.b).flatMap(([p, q]) => rect(p, q, c.bottom, c.top)) : [];
  return [...box, ...strips];
}

/** A box quad's way out of the wall: from its face edge to its front edge. */
const boxOut = (quad: Ring): Point | undefined => {
  const [a, , , d] = quad;
  return a && d ? { x: d.x - a.x, y: d.y - a.y } : undefined;
};

function wallSolids(view: View, item: WallItem): BeyondSolid[] {
  const { beyondWall, beyondWallWidth } = view.ink;
  const key = itemKey(item);
  return [
    ...prismSolid(view, key, [item.outline], item.bottom, item.top, beyondWall, beyondWallWidth, () => item.openings.flatMap((o) => openingShape(view, o)), item.planes !== null, wallPaint(view.frame, view.ink, item, view.minSpacing)),
    ...item.caps.flatMap((cap, i) => prismSolid(view, `${key}/cap${i}`, [cap.ring], cap.bottom, item.top, beyondWall, beyondWallWidth, () => [], item.planes !== null)),
  ];
}

const deckSolids = (view: View, item: DeckItem): BeyondSolid[] =>
  item.fills.flatMap((f, i) => prismSolid(view, `${itemKey(item)}/${i}`, [f.ring, ...f.holes], item.bottom, item.top, view.ink.beyondPart, view.ink.beyondPartWidth, () => []));

/** A guard past the plane, its boxes thin outlines, as a piece's parts are (guards.09). */
const guardSolids = (view: View, item: GuardItem): BeyondSolid[] =>
  guardBoxes(item).flatMap((b, i) => prismSolid(view, `${itemKey(item)}/${i}`, [b.ring], b.bottom, b.top, view.ink.beyondPart, view.ink.beyondPartWidth, () => []));

/** Whether a face looks back at the viewer: a panel on the far side of its part is hidden by it. */
function facesViewer(view: View, face: Face3d): boolean {
  const n = newell(face.points);
  return n.x * view.frame.seen.x + n.y * view.frame.seen.y < -EPS;
}

/** A stair or a plant as one unit: its faces, clipped, flat and far first. */
function stairSolid(view: View, item: PieceItem, faces: readonly Face3d[]): BeyondSolid[] {
  const rings = inStrip(view, [item.ring]);
  const spans = spansOf(rings);
  if (spans.length === 0) return [];
  const flats = faces.flatMap((f) => flatten(view, f.points)).sort((a, b) => b.depth - a.depth);
  const zs = flats.flatMap((f) => f.points.map((p) => p.y));
  const { beyond, beyondPart, beyondPartWidth } = view.ink;
  return [{ key: itemKey(item), rings, spans, bottom: Math.min(...zs), top: Math.max(...zs), drawn: flats.flatMap((f) => outlinedShape(f.points, beyond, beyondPart, beyondPartWidth)) }];
}

function pieceSolids(view: View, item: PieceItem): BeyondSolid[] {
  const owner = itemKey(item);
  const own = stairFaces(owner, item, STYLE_3D.stair, STYLE_3D.glass) ?? ownFaces(owner, item, STYLE_3D); // a stair's, a plant's or a clock's own faces
  if (own !== null) return stairSolid(view, item, own);
  const { beyond, beyondPanel, beyondPanelWidth, beyondPart, beyondPartWidth } = view.ink;
  return partSolids(owner, item, STYLE_3D).flatMap((part) => prismSolid(view, part.key, [part.ring], part.bottom, part.top, beyondPart, beyondPartWidth, () =>
    part.panels.filter((f) => facesViewer(view, f)).flatMap((f) => flatten(view, f.points)).flatMap((f) => outlinedShape(f.points, beyond, beyondPanel, beyondPanelWidth))));
}

/** Everything past the plane within the depth, in no order. */
export function beyondSolids(frame: SectionFrame, depth: number | null, items: readonly Item3d[], style: PlanStyle, roof: readonly SectionPlane[] | null = null, zoom?: number): BeyondSolid[] {
  // A wall's pattern shows where it isn't too fine at the drawing's scale, as on the plan (finishes.16, surfaces step 13).
  // A style without floor finishes (look's, finishes.10) still paints walls, its patterns to 4 drawing units, the screen's.
  const minSpacing = zoom === undefined ? MIN_SPACING_3D : (style.finish?.minSpacing ?? 4) / zoom;
  const view: View = { frame, sides: stripSides(frame, depth), ink: style.section, roof, minSpacing };
  return items.flatMap((item): BeyondSolid[] => {
    switch (item.item) {
      case "wall": return wallSolids(view, item);
      case "deck": return deckSolids(view, item);
      case "piece": return pieceSolids(view, item);
      case "floor": return []; // no thickness: the floor's band is graphics
      case "guard": return guardSolids(view, item);
      default: return assertNever(item);
    }
  });
}

/** What lies past the cut as a picture in metres: x along the line, y up, far to near. */
export const sectionBeyond = (frame: SectionFrame, depth: number | null, items: readonly Item3d[], style: PlanStyle, roof: readonly SectionPlane[] | null = null, zoom?: number): Primitive[] =>
  farToNear(beyondSolids(frame, depth, items, style, roof, zoom)).order.flatMap((s) => s.drawn);
