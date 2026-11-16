import { isMotifId, type Finish } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { colorChannels } from "../colors";
import { clipFloor, clipSegment } from "./clip";
import { clipShape } from "./clip-shape";
import { MOTIF_DRAWINGS } from "./motifs";
import { tilePattern } from "./tiling";

// A room's finish as plain geometry in solid colours (finishes.05, .13): its colour polygon and its pattern clipped
// to the floor, so every renderer, the exports and 3D draw segments and polygons and nothing else.

type Ring = readonly Point[];

/**
 * A joint on the floor. `key` is the merge key: its line in the pattern (family + whole offset), equal across rooms
 * and edits; the tests use it to find a line's pieces. Renderers ignore it.
 */
export type FinishLine = { a: Point; b: Point; color: string; key: string };
/**
 * A filled shape on the floor (cement tiles' diamonds), drawn even-odd: a shape split by the floor's edge keeps its
 * pieces in one ring joined by zero-area edges (finishes.13). `holes` is empty: shapes meeting a hole are dropped.
 */
export type FinishShape = { points: Ring; holes: readonly Ring[]; color: string };

export type FinishGeometry = {
  /** The floor (the outer ring less its holes) in the base colour. */
  fill: { points: Ring; holes: readonly Ring[]; color: string };
  lines: readonly FinishLine[];
  shapes: readonly FinishShape[];
  /** Metres: the finest gap between parallel lines; the zoom and 3D thresholds test it (finishes.16). */
  spacing: number;
  /** The pattern needs more cells than the cap: colour alone, at every zoom (finishes.06). */
  tooFine: boolean;
};

/**
 * The base colour blended toward its shade (each channel times `shade`) by `strength` percent: 0 gives the base, 100
 * the shade (finishes.05). Lower-case `#rrggbb`.
 */
export function mixColour(base: string, shade: number, strength: number): string {
  const k = Math.min(100, Math.max(0, strength)) / 100;
  const hex = (channel: number): string => {
    const byte = Math.round(channel * 255);
    const mixed = Math.round(byte + (byte * shade - byte) * k);
    return Math.min(255, Math.max(0, mixed)).toString(16).padStart(2, "0");
  };
  const [r, g, b] = colorChannels(base);
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** The finish of the floor `ring` less `holes`: its fill, and its joints and shapes laid from (0,0) and clipped to the floor. */
export function finishGeometry(ring: Ring, holes: readonly Ring[], finish: Finish): FinishGeometry {
  const drawing = MOTIF_DRAWINGS[isMotifId(finish.motif) ? finish.motif : "plain"]; // I8 keeps motifs known
  const tiled = tilePattern(drawing, ring, finish.size, finish.angle);
  const colours = new Map<number, string>();
  const colourOf = (shade: number): string => {
    const known = colours.get(shade);
    if (known !== undefined) return known;
    const mixed = mixColour(finish.colour, shade, finish.strength);
    colours.set(shade, mixed);
    return mixed;
  };
  const floor = clipFloor(ring, holes);
  const lines = tiled.lines.flatMap((l) => clipSegment(l.a, l.b, floor).map((p) => ({ a: p.a, b: p.b, color: colourOf(l.shade), key: l.key })));
  const shapes = tiled.shapes.flatMap((s): FinishShape[] => {
    const points = clipShape(floor, s.points);
    return points ? [{ points, holes: [], color: colourOf(s.shade) }] : [];
  });
  return {
    fill: { points: ring, holes, color: finish.colour },
    lines,
    shapes,
    spacing: drawing.spacing * finish.size,
    tooFine: tiled.tooFine,
  };
}

/**
 * Whether a pattern draws its joints at a least spacing of `minSpacing` metres: its spacing reaches it (within 1e-9, so
 * a threshold met exactly survives float noise) and it is not over the cell cap (finishes.06, .16).
 */
export function patternShows(geometry: FinishGeometry, minSpacing: number): boolean {
  return !geometry.tooFine && geometry.spacing >= minSpacing - 1e-9;
}

/** One room to build: its clear floor, its holes' footprints and its finish. */
export type FinishRoom = { ring: Ring; holes: readonly Ring[]; finish: Finish };

/** Each room's geometry, in order; a room equal by value to one of the last build gets the same object back. */
export type FinishCache = { build(rooms: readonly FinishRoom[]): readonly FinishGeometry[] };

/** The room's value: every coordinate of its rings and every field of its finish. */
function valueKey({ ring, holes, finish }: FinishRoom): string {
  const points = (r: Ring): string => r.map((p) => `${p.x},${p.y}`).join(" ");
  return [finish.motif, finish.colour, finish.strength, finish.size, finish.angle, points(ring), ...holes.map(points)].join("|");
}

/**
 * A per-room cache keyed by value, holding only the rooms of its last build (finishes.18): `zones()` builds new rings
 * for every document, so a furniture drag or a layout flip would otherwise re-tile every room on every frame.
 */
export function createFinishCache(): FinishCache {
  let held = new Map<string, FinishGeometry>();
  return {
    build(rooms) {
      const next = new Map<string, FinishGeometry>();
      const out = rooms.map((room) => {
        const key = valueKey(room);
        const geometry = next.get(key) ?? held.get(key) ?? finishGeometry(room.ring, room.holes, room.finish);
        next.set(key, geometry);
        return geometry;
      });
      held = next;
      return out;
    },
  };
}
