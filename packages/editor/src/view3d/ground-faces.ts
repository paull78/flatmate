import type { OutsideDoor, Trailer } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { colorChannels } from "../view/colors";
import { memoLast } from "../view/memo";
import { frameSphere } from "./camera3d";
import { STYLE_3D, type Style3d } from "./style";
import { framedBounds, type SurroundingsRow } from "./surroundings";
import { doorSteps } from "./door-steps";
import { trailerFaces } from "./trailer-faces";
import type { Bounds3, Face3d, Line3d, Point3 } from "./types";

// The ground round the house (surroundings.03, .13): a solid plate, then opaque rings blending from the ground's colour
// into the background, with no outlines, so the plate has no hard edge without any transparency. Each band is cut into
// quads: a whole disc or ring would be triangulated into long slivers, whose bounding boxes cost raster3d about 30
// times their area.

const RINGS = 32;
const SIDES = 128; // a circle's polygon: its chords lie inside the circle, so the vertices are its farthest points
const PLATE_BANDS = 8; // the round plate's solid part: a small disc and bands of quads round it
const FADE_FROM = 0.72; // of the round plate's radius, where the fade starts (the approved mock-up)
const BOX_FADE_FROM = 0.35; // of the box plate's reach past the walls, where its fade starts (the approved mock-up)
const BOX_BANDS = 4; // the box plate's solid bands round the walls' box
const ARC = 16; // a box plate's corner: a quarter circle in this many chords, its vertices on the arc
const STEPS = 32; // a box plate's sides in about this many pieces along the plan's diagonal, so no quad is a long sliver
const FIT = 0.995; // of the radius that just touches the frame
const DROP = 0.005; // the plate's 5 mm under the floor or the ground, so a floor at 0 never ties it (surroundings.14)
const OWNER = "ground/plate";

/** `a` to `b` by `t` from 0 to 1, as lowercase `#rrggbb` (COLOR_PATTERN): exactly `a` at 0 and `b` at 1. */
export function mixColor(a: string, b: string, t: number): string {
  const [ca, cb] = [colorChannels(a), colorChannels(b)];
  const byte = (k: number): string => Math.round(((ca[k] ?? 0) * (1 - t) + (cb[k] ?? 0) * t) * 255).toString(16).padStart(2, "0");
  return `#${byte(0)}${byte(1)}${byte(2)}`;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * What a surroundings adds to a 3D scene round `shell` (the walls' bounds): the pulled-back box, the ground, the
 * background, and on wheels the trailer, in `style`'s slots. The one owner for the panel's scene and `look`, so the two
 * can't draw different pictures (AC-10).
 */
export function aroundShell(row: SurroundingsRow, shell: Bounds3, wheels: Wheels, style: Style3d = STYLE_3D): { bounds: Bounds3; ground: readonly Face3d[]; background: string; trailer?: readonly Face3d[] } {
  const ground = groundKept(row, shell.min.x, shell.min.y, shell.max.x, shell.max.y, shell.top);
  return { bounds: framedBounds(row, shell), ground, background: row.background, ...onWheels(row, shell, wheels, style) };
}

/** What the trailer is drawn from: the project's settings (trailerOf) and its outside doors (outsideDoors), as values. */
export type Wheels = { trailer: Trailer; doors: readonly OutsideDoor[] };

/**
 * What a house on wheels stands on, with the ground below the floor: the box framed from the ground up and the trailer
 * (about 100 faces, built per scene) as the project sets it up (trailerOf), and steps at its outside doors; nothing otherwise. A card draws this alone, without the ground (surroundings.07).
 */
export function onWheels(row: SurroundingsRow, shell: Bounds3, wheels: Wheels, style: Style3d = STYLE_3D): { bounds: Bounds3; trailer: readonly Face3d[] } | null {
  if (!(row.below > 0)) return null;
  const bounds = framedBounds(row, shell);
  return { bounds, trailer: [...trailerFaces(bounds, style, wheels.trailer), ...doorSteps(wheels.doors, row.below, style.slots.wood)] };
}

/**
 * The ground kept while the row and the walls' box stay the same, so a flip's frames, a selection or an edit that moves
 * no wall reuse it, and the renderer its triangles (about 5000 faces, surroundings.21). Keyed by the box's numbers, as
 * `shellBounds` gives a new object per call; the walls' box has no bottom, a style's depth being its row's `below`.
 */
const groundKept = memoLast(
  (row: SurroundingsRow, x0: number, y0: number, x1: number, y1: number, top: number): readonly Face3d[] =>
    groundFaces(row, { min: { x: x0, y: y0 }, max: { x: x1, y: y1 }, top }),
);

/** The ground's faces round `shell` (the walls' bounds) for `row`, in its plate's shape. */
export function groundFaces(row: SurroundingsRow, shell: Bounds3): Face3d[] {
  switch (row.plate) {
    case "round": return roundPlate(row, shell);
    case "box": return boxPlate(row, shell);
    default: return assertNever(row);
  }
}

/** A plate's rim at offset `d` out from its middle: the same count of points at every `d`, counter-clockwise from above. */
type Outline = (d: number) => Point3[];

/**
 * Where a plate lies and how far its rim may reach: a rim point at plan distance r from the frame's centre lies
 * hypot(r, h) from it in 3D, h being the plate's depth below the centre, so r ≤ sqrt(Rf² − h²) keeps it inside the
 * frame's radius Rf at every angle (surroundings.13). Taken by FIT, a little under.
 */
function plateFit(row: SurroundingsRow, shell: Bounds3): { centre: Point3; z: number; rim: number } {
  const { centre, radius: rf } = frameSphere(framedBounds(row, shell));
  const z = -row.below - DROP;
  const h = centre.z - z;
  return { centre, z, rim: Math.sqrt(Math.max(0, rf * rf - h * h)) * FIT };
}

const face = (points: Point3[], color: string): Face3d => ({ points, holes: [], color, owner: OWNER, outline: false });

/** The bands between the outline at each of `offsets` and the next, as quads; a corner collapsed to a point leaves a triangle. */
function bands(outline: Outline, offsets: readonly number[], color: (band: number) => string): Face3d[] {
  return offsets.slice(1).flatMap((d1, b) => {
    const [inner, outer] = [outline(offsets[b] ?? 0), outline(d1)];
    return inner.map((p, i) => {
      const j = (i + 1) % inner.length;
      const quad = [p, outer[i] ?? p, outer[j] ?? p, inner[j] ?? p];
      return face(quad.filter((q, k) => !same(q, quad[(k + 1) % quad.length] ?? q)), color(b));
    });
  });
}

const same = (a: Point3, b: Point3): boolean => a.x === b.x && a.y === b.y;
/** `n + 1` offsets from `a` to `b`, exactly `a` and `b` at the ends. */
const steps = (a: number, b: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => (i === n ? b : a + ((b - a) * i) / n));

/** How far ring `i` of the fade has gone from its first colour to the background: exactly all the way at the last. */
const fadeShare = (i: number): number => smoothstep((i + 1) / RINGS);

/** The plate's solid bands at `solid`, then RINGS rings between the RINGS + 1 offsets `fade`, the last exactly the background. */
function plate(row: SurroundingsRow, outline: Outline, solid: readonly number[], fade: readonly number[]): Face3d[] {
  return [...bands(outline, solid, () => row.ground), ...bands(outline, fade, (i) => mixColor(row.ground, row.background, fadeShare(i)))];
}

/**
 * A round plate about the shell's plan centre, as wide as the frame allows (R = the plate's fit). The fade runs from
 * FADE_FROM of R to R; Grid's lines go on its disc. No plate when the frame leaves no room for one.
 */
function roundPlate(row: Extract<SurroundingsRow, { plate: "round" }>, shell: Bounds3): Face3d[] {
  const { centre, z, rim: radius } = plateFit(row, shell);
  if (radius <= 0) return [];
  const circle: Outline = (r) => Array.from({ length: SIDES }, (_, i) => {
    const a = (2 * Math.PI * i) / SIDES;
    return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a), z };
  });
  const inner = radius * FADE_FROM;
  const fade = steps(inner, radius, RINGS); // where each fade ring starts, then the rim: the rings' and the lines' one source
  const disc = face(circle(inner / PLATE_BANDS), row.ground);
  const lines = row.lines === undefined ? [] : gridLines(row.lines, row.background, { ...centre, z }, fade, shell);
  return [lines.length > 0 ? { ...disc, lines } : disc, ...plate(row, circle, steps(inner / PLATE_BANDS, inner, PLATE_BANDS - 1), fade)];
}

/**
 * Grid's lines (surroundings.16) on a round plate about `centre` with the fade offsets `fade` (the plate's own: where
 * each ring starts, then the rim): one at every whole metre along x and y, cut where it crosses a ring, so each piece
 * fades as its ring does from `ink` to `background`. None in the walls' box: lines get no polygon offset, so one under
 * a floor shows through it.
 */
function gridLines(ink: string, background: string, centre: Point3, fade: readonly number[], shell: Bounds3): Line3d[] {
  const [rings, rim] = [fade.slice(0, -1), fade.at(-1) ?? 0];
  const colourAt = (r: number): string => {
    const ring = rings.filter((from) => from <= r).length - 1; // the rings start in order, out from the solid part
    return ring < 0 ? ink : mixColor(ink, background, fadeShare(ring));
  };
  /** The pieces of a line lying `d` off the centre, along u about `c`, left out between `box` (null: it misses the box). */
  const line = (d: number, c: number, box: readonly [number, number] | null, at: (u: number) => Point3): Line3d[] => {
    const half = Math.sqrt(Math.max(0, rim * rim - d * d));
    const crossings = rings.filter((r) => r > Math.abs(d)).flatMap((r) => [c - Math.sqrt(r * r - d * d), c + Math.sqrt(r * r - d * d)]);
    const cuts = [c - half, c + half, ...crossings, ...(box ?? [])].filter((u) => u >= c - half && u <= c + half).sort((a, b) => a - b);
    return cuts.slice(1).flatMap((u1, i): Line3d[] => {
      const u0 = cuts[i] ?? u1;
      const mid = (u0 + u1) / 2;
      if (u1 - u0 < 1e-9 || (box !== null && mid > box[0] && mid < box[1])) return [];
      return [{ a: at(u0), b: at(u1), color: colourAt(Math.hypot(d, mid - c)) }];
    });
  };
  const wholes = (c: number): number[] => Array.from({ length: Math.max(0, Math.floor(c + rim) - Math.ceil(c - rim) + 1) }, (_, i) => Math.ceil(c - rim) + i);
  const { min, max } = shell;
  const z = centre.z;
  return [
    ...wholes(centre.x).flatMap((x) => line(x - centre.x, centre.y, x >= min.x && x <= max.x ? [min.y, max.y] : null, (y) => ({ x, y, z }))),
    ...wholes(centre.y).flatMap((y) => line(y - centre.y, centre.x, y >= min.y && y <= max.y ? [min.x, max.x] : null, (x) => ({ x, y, z }))),
  ];
}

/**
 * Interior's plate: the walls' box grown by its reach m with round corners, so it follows a long house. A corner's arc
 * reaches p + m from the centre, p being the plan's half diagonal, so m is the plate's fit less p; the fade runs from
 * BOX_FADE_FROM of m to m. Under the box, tiles on the bands' own side points. No plate when the frame leaves no reach.
 */
function boxPlate(row: SurroundingsRow, shell: Bounds3): Face3d[] {
  const { z, rim } = plateFit(row, shell);
  const [w, d] = [shell.max.x - shell.min.x, shell.max.y - shell.min.y];
  const reach = rim - Math.hypot(w, d) / 2;
  if (reach <= 0) return [];
  const xs = steps(shell.min.x, shell.max.x, Math.max(1, Math.ceil((STEPS * w) / Math.hypot(w, d))));
  const ys = steps(shell.min.y, shell.max.y, Math.max(1, Math.ceil((STEPS * d) / Math.hypot(w, d))));
  const { min, max } = shell;
  const outline: Outline = (m) => {
    const arc = (cx: number, cy: number, start: number): Point3[] => Array.from({ length: ARC + 1 }, (_, k) => {
      const a = ((start + (90 * k) / ARC) * Math.PI) / 180;
      return { x: cx + m * Math.cos(a), y: cy + m * Math.sin(a), z };
    });
    const inside = (v: readonly number[]): number[] => v.slice(1, -1);
    return [
      ...arc(max.x, max.y, 0), ...inside(xs).reverse().map((x) => ({ x, y: max.y + m, z })),
      ...arc(min.x, max.y, 90), ...inside(ys).reverse().map((y) => ({ x: min.x - m, y, z })),
      ...arc(min.x, min.y, 180), ...inside(xs).map((x) => ({ x, y: min.y - m, z })),
      ...arc(max.x, min.y, 270), ...inside(ys).map((y) => ({ x: max.x + m, y, z })),
    ];
  };
  const tiles = xs.slice(1).flatMap((x1, i) => ys.slice(1).map((y1, j) => {
    const [x0, y0] = [xs[i] ?? x1, ys[j] ?? y1];
    return face([{ x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z }], row.ground);
  }));
  const solid = reach * BOX_FADE_FROM;
  return [...tiles, ...plate(row, outline, steps(0, solid, BOX_BANDS), steps(solid, reach, RINGS))];
}
