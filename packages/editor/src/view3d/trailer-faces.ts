import type { Trailer } from "@fm/domain";
import { frameSphere } from "./camera3d";
import { orient, prism, sideShade } from "./prism";
import { STYLE_3D, type Shades, type Style3d } from "./style";
import { tongueBoxFaces } from "./tongue-box";
import type { Bounds3, Face3d, Point3 } from "./types";

// The trailer under a house on wheels (surroundings.08, .12, .16), from the approved mock-up: a steel deck under the
// walls' box, two or three axles near the middle of its longer side and a wheel at each end of each, the drawbar on the
// chosen short end, maybe a tongue box (trailer.02, .04, .05). Only drawn, checked against nothing. Read along the box's
// long axis u (x on a tie) and across it v, u pointing toward the hitch: on the low end the frame is mirrored, u = −x
// (or −y), so the axles sit a little toward the hitch, as the mock-up's, at either end.

const DECK_GAP = 0.002; // the deck's top under the floor, so it never ties a floor at 0
const DECK = 0.25; // thick, as the mock-up
const RADIUS = 0.33; // a wheel's
const WIDTH = 0.22; // a wheel's
const INSET = 0.03; // a wheel's outer side in from the deck's side and end, so the two never tie
const HUB = 0.55; // of the radius
const HUB_OUT = 0.01; // the hub's disc out from the wheel's side
const APART = 0.42; // each axle from the pair's middle
const AHEAD = 0.3; // the pair's middle from the long side's, toward its higher end
const AXLE = 0.06; // an axle's square section
const SIDES = 16; // a wheel's polygon, a vertex at its very bottom
/** The deck's length the gear needs at full size (2.16 m with two axles, 3.00 m with three): the wheels inset. */
const longNeed = (axles: number): number => 2 * (AHEAD + (axles - 1) * APART + RADIUS + INSET);
/** The deck's width the gear needs at full size (0.56 m): the wheels inset, the axle seen between them. */
const ACROSS_NEED = 2 * (INSET + WIDTH) + AXLE;
const TUCK = 0.4; // of the radius: how far a wheel's top reaches into the deck at least (a full-size wheel's, 0.49)
const BAR = 1.3; // the drawbar's length past the deck's end, where the frame allows
const BAR_TALL = 0.08; // up from the deck's underside, as the mock-up's
const BAR_IN = 0.5; // the bar's base in from the deck's sides, as the mock-up's
const TIP = 0.04; // half the tip's width
const JACK = 0.1; // the jack's square section
const JACK_IN = 0.25; // its centre in from the tip
const BAR_MIN = 0.35; // shorter than this, no drawbar: the jack, 0.3 m back from the tip, would stand under the deck
const BOX_BAR = 0.9; // a drawbar at least this long carries the tongue box: its 0.60 m and the jack both fit (trailer.05)
const FIT = 0.995; // of the frame's radius, as the plate's

/**
 * What every wheel shares: the trailer's frame, (u, v, z) with u along the box's long axis and v across it, as a world
 * point or direction; the ground's depth; the gear's scale; the steel's shades and the hubs' colour.
 */
type Gear = { at: (u: number, v: number, z: number) => Point3; below: number; k: number; steel: Shades; hub: string };

/**
 * The trailer under `framed`, the box the camera frames on wheels (the walls' box from its `bottom`, the ground, pulled
 * back), its wheels on the ground (their lowest points at exactly the bottom): the deck covering the walls' box, its top
 * just under the floor; two axles across the long side; four wheels; the drawbar and its jack on the long side's higher
 * end; in `style`'s dark and metal slots. On a deck shorter or narrower than the gear needs, the gear shrinks by one
 * factor, so its wheels stay inside and apart, and the deck then reaches down to their tops, so they never hang under it.
 */
export function trailerFaces(framed: Bounds3, style: Style3d = STYLE_3D, trailer: Trailer = { hitch: "high", axles: 2, tongueBox: false }): Face3d[] {
  const shell = framed;
  const below = -(framed.bottom ?? 0);
  const alongX = shell.max.x - shell.min.x >= shell.max.y - shell.min.y; // x on a tie
  const s = trailer.hitch === "high" ? 1 : -1; // u along the long axis toward the hitch: −x (or −y) on the low end
  const [lo, hi, v0, v1] = alongX ? [shell.min.x, shell.max.x, shell.min.y, shell.max.y] : [shell.min.y, shell.max.y, shell.min.x, shell.max.x];
  const [u0, u1] = s === 1 ? [lo, hi] : [-hi, -lo];
  const k = Math.min(1, (u1 - u0) / longNeed(trailer.axles), (v1 - v0) / ACROSS_NEED); // the gear's scale
  const steel = style.slots.dark;
  // A point or a direction in the mirrored frame: linear, so directions (normals) mirror with the points.
  const gear: Gear = { at: (u, v, z) => (alongX ? { x: s * u, y: v, z } : { x: v, y: s * u, z }), below, k, steel, hub: style.slots.metal.top };
  const ring = [{ x: shell.min.x, y: shell.min.y }, { x: shell.max.x, y: shell.min.y }, { x: shell.max.x, y: shell.max.y }, { x: shell.min.x, y: shell.max.y }];
  const hubZ = -below + k * RADIUS;
  const underside = Math.min(-DECK_GAP - DECK, hubZ + (1 - TUCK) * k * RADIUS); // 0.25 m thick at full size, above the hubs
  const deck = prism("trailer/deck", ring, underside, -DECK_GAP, steel); // no bottom: the camera always looks down
  const centre = (u0 + u1) / 2 + k * AHEAD;
  const axles = Array.from({ length: trailer.axles }, (_, i) => centre + k * APART * (2 * i - (trailer.axles - 1)));
  const [left, right] = [v0 + k * INSET, v1 - k * INSET]; // the wheels' outer sides
  // Only the deck is outlined: the axles run into the wheels and a wheel's top into the deck, and lines get no polygon
  // offset, so a part's outline inside another would show through it (an axle's end lies 1 cm behind its hub).
  const axleFaces = axles.flatMap((u, i) => {
    const half = (k * AXLE) / 2;
    const box = [gear.at(u - half, left, 0), gear.at(u + half, left, 0), gear.at(u + half, right, 0), gear.at(u - half, right, 0)];
    return prism(`trailer/axle-${i + 1}`, box, hubZ - half, hubZ + half, steel).map((f): Face3d => ({ ...f, outline: false }));
  });
  const wheels = axles.flatMap((u, i) => [
    wheel(`trailer/wheel-${2 * i + 1}`, gear, u, left, -1),
    wheel(`trailer/wheel-${2 * i + 2}`, gear, u, right, 1),
  ]);
  const towing = drawbar(gear, framed, { u1, halfLong: (u1 - u0) / 2, v: (v0 + v1) / 2, half: (v1 - v0) / 2 }, underside);
  const box = trailer.tongueBox && towing.length >= BOX_BAR ? tongueBoxFaces(gear.at, { u1, v0, v1, bottom: underside + BAR_TALL }, steel) : [];
  return [...deck, ...axleFaces, ...wheels.flat(), ...towing.faces, ...box];
}

/**
 * The drawbar out from the deck's end at `u1`, centred on `v`, and its jack, with no outlines (each touches the deck or
 * the other, and lines get no polygon offset): a steel wedge from the deck's width less BAR_IN a side to a 0.08 m tip,
 * BAR_TALL up from the deck's `underside`, and a column from the ground up to it. BAR long, or shorter so its tip and the
 * jack's foot stay within the frame's sphere (surroundings.13): a point d from the sphere's centre in plan and dz below
 * it is in the frame while d² + dz² ≤ R². None when that leaves under BAR_MIN.
 */
function drawbar(gear: Gear, framed: Bounds3, end: { u1: number; halfLong: number; v: number; half: number }, underside: number): { faces: Face3d[]; length: number } {
  const { centre, radius } = frameSphere(framed); // centred on the walls' box: the deck's end is halfLong from it along u
  const r2 = (FIT * radius) ** 2;
  // Each far point as (back from the tip, across from the middle, height): the tip's corners and the jack's foot.
  const far = [[0, TIP, underside], [0, TIP, underside + BAR_TALL], [JACK_IN - JACK / 2, JACK / 2, -gear.below]] as const;
  const room = (back: number, across: number, z: number): number => back - end.halfLong + Math.sqrt(Math.max(0, r2 - across ** 2 - (z - centre.z) ** 2));
  const length = Math.min(BAR, ...far.map(([back, across, z]) => room(back, across, z)));
  if (!(length >= BAR_MIN)) return { faces: [], length: 0 };
  const tip = end.u1 + length;
  const base = Math.max(TIP, end.half - BAR_IN);
  const unlined = (faces: Face3d[]): Face3d[] => faces.map((f) => ({ ...f, outline: false }));
  const bar = [gear.at(end.u1, end.v - base, 0), gear.at(tip, end.v - TIP, 0), gear.at(tip, end.v + TIP, 0), gear.at(end.u1, end.v + base, 0)];
  const j = tip - JACK_IN;
  const jack = [gear.at(j - JACK / 2, end.v - JACK / 2, 0), gear.at(j + JACK / 2, end.v - JACK / 2, 0), gear.at(j + JACK / 2, end.v + JACK / 2, 0), gear.at(j - JACK / 2, end.v + JACK / 2, 0)];
  return { faces: [...unlined(prism("trailer/drawbar", bar, underside, underside + BAR_TALL, gear.steel)), ...unlined(prism("trailer/jack", jack, -gear.below, underside, gear.steel))], length };
}

/**
 * A wheel at the gear's scale on the axle at `u`, its outer side at `outer` facing `side` (−1 or 1 along v), standing on
 * the gear's ground: two sides, the tread and the hub on the outer side. No outlines: a wheel's top lies inside the deck,
 * as the mock-up's; the tyre reads round by its shades.
 */
function wheel(owner: string, gear: Gear, u: number, outer: number, side: -1 | 1): Face3d[] {
  const { below, k, steel } = gear;
  const radius = k * RADIUS;
  const inner = outer - side * k * WIDTH;
  // From the bottom, in (u, z) about the wheel's centre `radius` up: a tyre's bottom vertex is exactly −below, its
  // 1 + sin a being 0 there.
  const angles = Array.from({ length: SIDES }, (_, i) => -Math.PI / 2 + (2 * Math.PI * i) / SIDES);
  const circle = (v: number, r: number): Point3[] => angles.map((a) => gear.at(u + r * Math.cos(a), v, -below + (radius - r) + r * (1 + Math.sin(a))));
  const [out, into] = [gear.at(0, side, 0), gear.at(0, -side, 0)]; // the outer and inner sides' normals
  const face = (points: Point3[], n: Point3, color: string): Face3d => ({ points: orient(points, n), holes: [], color, owner, outline: false });
  const [outerRim, innerRim] = [circle(outer, radius), circle(inner, radius)];
  const tread = angles.map((a, i): Face3d => {
    const j = (i + 1) % SIDES;
    const m = a + Math.PI / SIDES;
    const normal = gear.at(Math.cos(m), 0, Math.sin(m));
    const quad = [outerRim[i], outerRim[j], innerRim[j], innerRim[i]].flatMap((p) => (p ? [p] : []));
    return face(quad, normal, normal.z > Math.SQRT1_2 ? steel.top : sideShade(normal, steel));
  });
  const hub = face(circle(outer + side * k * HUB_OUT, radius * HUB), out, gear.hub);
  return [face(outerRim, out, sideShade(out, steel)), face(innerRim, into, sideShade(into, steel)), ...tread, hub];
}
