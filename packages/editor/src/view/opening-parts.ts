import { FOLD_DEPTH, add, cross, dot, scale, sub, type Opening, type OpeningGeometry } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "./colors";
import type { PlanStyle } from "./plan-style";
import type { Color, Dash, Primitive } from "./scene-types";

// The parts the plan's door and window symbols are made of (smalls, openkinds): the looks, frames, leaves and swings.
// The symbols themselves, one per kind, are `opening-symbols.ts`.

export const LEAF_M = 0.04; // a door leaf's thickness: a glazed leaf is its two faces
export const REBATE_M = 0.04; // a door frame's width at the opening side's face, where the closed leaf sits in its rebate; FRAME_M wide behind it, the stop
const HANDLE = { from: 0.1, stem: 0.04, lever: 0.12, thick: 0.022 } as const; // a lever handle: its stem this far from the leaf's free end and this long, the lever back towards the hinge, both this thick
export const FRAME_M = 0.06; // a frame's size, clamped to a thin wall's thickness; frames sit inside `width`, and a door hangs inside them
export const CURTAIN_OFF = 0.06; // how far a curtain hangs off its wall's face: the plan's wave's middle, and the 3D panel
export const SASH_OVERLAP = 0.05; // how far a sliding glass door's two sashes overlap in the middle, on the plan and in 3D
/** A curtain's wave about CURTAIN_OFF off the face: its amplitude and its period (openkinds.01). */
export const WAVE = { amplitude: 0.03, period: 0.1 } as const;
/** How far a curtain's wave stands off its face at `t` along its span: the plan's line, and the 3D folds' corners (openkinds.33). */
export const curtainOffset = (t: number): number => CURTAIN_OFF + WAVE.amplitude * Math.sin((2 * Math.PI * t) / WAVE.period);
/** A folding door's leaf: about an accordion slat's 13 cm (openkinds.08). */
const LEAF_WIDTH = 0.13;
/**
 * A folding door's folded stack, `length` long for a door `width` wide: its fold corners, `t` along the stack from the
 * hinge's jamb and `d` across from its side's face, FOLD_DEPTH / 2 each way (openkinds.24, .36); the plan's zigzag and
 * the 3D leaves (openkinds.37). One fold per leaf, at least two.
 */
export function foldCorners(width: number, length: number): { t: number; d: number }[] {
  const folds = Math.max(2, Math.round(width / LEAF_WIDTH));
  return Array.from({ length: folds + 1 }, (_, i) => ({ t: (length * i) / folds, d: i % 2 === 1 ? FOLD_DEPTH / 2 : -FOLD_DEPTH / 2 }));
}
// The gap reaches this far past each wall face, so the 1 px outline edges under it are covered at the usual zooms.
const FACE_OVERLAP_M = 0.01;

/**
 * floor: a door's span; span: what a window's stretch and a frame's or leaf's inside show; glass: a window's glass line;
 * line: everything else, at `weights`; dash: a parked leaf's.
 */
export type OpeningLook = { floor: Color; span: Color; glass: Color; line: Color; weights: { frame: number; line: number; hair: number }; dash: Dash };
const ONE = { frame: 1, line: 1, hair: 1 };
export const PREVIEW_LOOK: OpeningLook = { floor: COLORS.preview, span: COLORS.preview, glass: COLORS.preview, line: COLORS.preview, weights: ONE, dash: [6, 4] };
export const INVALID_LOOK: OpeningLook = { floor: COLORS.invalidFill, span: COLORS.invalidFill, glass: COLORS.invalid, line: COLORS.invalid, weights: ONE, dash: [6, 4] };

export const styleLook = (style: PlanStyle): OpeningLook => ({ floor: style.openingFloor, span: style.spanBackground, glass: style.openingGlass, line: style.openingLine, weights: style.openingWeights, dash: style.deck.dash });

/** A frame's size in this wall: FRAME_M, clamped to a thin wall's thickness. */
export const jambOf = (g: OpeningGeometry): number => Math.min(FRAME_M, g.thickness);

/** The span's two ends on the face of the opening side, in a → b order. */
export function faceEnds(g: OpeningGeometry): [Point, Point] {
  const face = scale(g.normal, g.thickness / 2);
  return [add(g.start, face), add(g.end, face)];
}

/**
 * A leaf hung inside its frame at the face point `end`, `radius` long, swinging out on the opening side's face away
 * from `other` (smalls.16): it hangs there at both levels of detail, so nothing moves when they switch. `toward` is
 * `other − end` as given, for the arc's start angle. `inset` is how far inside the span it hangs: a window's frame,
 * or a rebate (`doorInset`). A `rebated` leaf stands in the opening, off its frame, where it closes into the rebate;
 * a `door` also carries a handle.
 */
export type Swing = { hinge: Point; toFree: Point; toward: Point; along: Point; normal: Point; radius: number; rebated?: true; door?: true };

export function swingAt(end: Point, other: Point, g: OpeningGeometry, radius: number, inset = jambOf(g)): Swing {
  const toward = sub(other, end);
  const toFree = dot(toward, g.along) >= 0 ? g.along : scale(g.along, -1);
  return { hinge: add(end, scale(toFree, inset)), toFree, toward, along: g.along, normal: g.normal, radius };
}

/** How far inside the span a door's leaf hangs: its frame's rebate, clamped as the frame is. */
export const doorInset = (g: OpeningGeometry): number => Math.min(REBATE_M, jambOf(g));

/** A door's leaf: hung at its frame's rebate, where it closes (the user's reference). */
export const doorSwingAt = (end: Point, other: Point, g: OpeningGeometry, radius: number): Swing => ({ ...swingAt(end, other, g, radius, doorInset(g)), rebated: true, door: true });

/** A leaf hung the same way at its frame's rebate with no handle: a window's, and a double door's second leaf. */
export const sashSwingAt = (end: Point, other: Point, g: OpeningGeometry, radius: number): Swing => ({ ...swingAt(end, other, g, radius, doorInset(g)), rebated: true });

/** Where a swing's quarter arc starts: counter-clockwise from whichever of the wall line and the leaf comes first (world y up). */
function swingFrom(s: Swing): number {
  const start = cross(s.toward, s.normal) > 0 ? s.toward : s.normal;
  return Math.atan2(start.y, start.x);
}

/** A swing's quarter arc at the hair weight, then its leaf: in outline when `detailed`, else a line. */
export function swingPrimitives(s: Swing, look: OpeningLook, detailed: boolean, glazed: boolean): Primitive[] {
  const from = swingFrom(s);
  return [
    { kind: "arc", center: s.hinge, radius: s.radius, from, to: from + Math.PI / 2, width: { px: look.weights.hair }, color: look.line },
    ...(detailed
      ? [...outlinedLeaf(s.hinge, s.rebated ? s.toFree : scale(s.toFree, -1), s.normal, s.radius, glazed, look), ...(s.door ? leverHandles(s, look) : [])]
      : plainLeaf(s.hinge, add(s.hinge, scale(s.normal, s.radius)), s.along, glazed, look)),
  ];
}

/**
 * A door's lever handles, one on each face of its open leaf near the free end, each an L in outline: a stem off the
 * face and a lever back towards the hinge, both HANDLE.thick. Smaller on a narrow leaf.
 *
 *     free end
 *    ┌───┐
 *  ┌─┤   ├─┐   stems
 *  │┌┤   ├┐│
 *  └┘│   │└┘   levers, towards the hinge
 */
function leverHandles(s: Swing, look: OpeningLook): Primitive[] {
  const up = Math.max(s.radius - HANDLE.from, s.radius / 2);
  const lever = Math.min(HANDLE.lever, s.radius / 4);
  const [half, far] = [HANDLE.thick / 2, HANDLE.stem + HANDLE.thick];
  return [0, 1].flatMap((side): Primitive[] => {
    const out = scale(s.toFree, side === 0 ? -1 : 1);
    const face = add(s.hinge, scale(s.toFree, side * LEAF_M));
    const p = (u: number, v: number): Point => add(add(face, scale(s.normal, u)), scale(out, v));
    const ring = [p(up - half, 0), p(up + half, 0), p(up + half, far), p(up - lever, far), p(up - lever, HANDLE.stem), p(up - half, HANDLE.stem)];
    return [
      { kind: "polygon", points: ring, holes: [], color: look.span },
      ...ring.map((a, i): Primitive => ({ kind: "segment", a, b: ring[(i + 1) % ring.length] ?? a, width: { px: look.weights.line }, color: look.line, cap: "butt" })),
    ];
  });
}

/** The points that bound a swing as drawn: the hinge, both ends of the quarter arc and its one axis-most point. */
export function swingBounds(s: Swing): Point[] {
  const quarter = Math.PI / 2;
  const axis = Math.ceil(swingFrom(s) / quarter) * quarter; // a quarter arc holds one multiple of 90°, or two at its ends
  const { hinge, radius } = s;
  return [hinge, add(hinge, scale(s.toFree, radius)), add(hinge, scale(s.normal, radius)), { x: hinge.x + radius * Math.cos(axis), y: hinge.y + radius * Math.sin(axis) }];
}

/**
 * Where a sliding door parks (AC-08): a box the leaf's size, off the end its `hinge` names, on the face of its opening
 * side. Only drawn: it isn't checked against walls or furniture, and it may run past its wall's end (the stated constraint).
 */
export function parkedBox(o: Pick<Opening, "width">, g: OpeningGeometry): Point[] {
  const away = dot(sub(g.hinge, g.free), g.along) >= 0 ? g.along : scale(g.along, -1);
  const end = add(g.hinge, scale(away, o.width));
  const out = scale(g.normal, LEAF_M);
  return [g.hinge, end, add(end, out), add(g.hinge, out)];
}

/** The span through the wall's thickness, a little past each face. */
export function spanQuad(g: OpeningGeometry, color: Color): Primitive {
  const half = g.thickness / 2 + FACE_OVERLAP_M;
  return {
    kind: "polygon",
    points: [add(g.start, scale(g.normal, -half)), add(g.end, scale(g.normal, -half)), add(g.end, scale(g.normal, half)), add(g.start, scale(g.normal, half))],
    holes: [],
    color,
  };
}

/** A filled box from `at`, `length` along `along` and `depth` along `across`, outlined at the frame's weight: a window's frames and leaves. */
export function block(at: Point, along: Point, across: Point, length: number, depth: number, look: OpeningLook): Primitive[] {
  return outlined([at, add(at, scale(along, length)), add(add(at, scale(along, length)), scale(across, depth)), add(at, scale(across, depth))], look);
}

/**
 * A door's frame at a jamb, from the jamb's corner `at` on the opening side's face, `into` the span, through the whole
 * wall's thickness: rebated at that face, where the closed leaf sits, and wider behind it, where the leaf stops (the
 * user's reference; it replaces smalls.18's step, which was the other way round). Clamped to a thin wall.
 *
 *   face ──┬───┐          REBATE_M wide, LEAF_M deep: the leaf hangs at this corner
 *          │   └──┐
 *   wall   │      │       FRAME_M wide: the stop
 *   face ──┴──────┘
 */
export function doorFrame(at: Point, into: Point, g: OpeningGeometry, look: OpeningLook): Primitive[] {
  const wide = jambOf(g);
  const narrow = doorInset(g);
  const p = (along: number, depth: number): Point => add(add(at, scale(into, along)), scale(g.normal, -depth));
  return outlined([p(0, 0), p(narrow, 0), p(narrow, LEAF_M), p(wide, LEAF_M), p(wide, g.thickness), p(0, g.thickness)], look); // a wall is at least 5 cm thick
}

/**
 * An opening window's frame at a jamb (a casement, a two-leaf window): the fixed window's square on the axis, rebated
 * on the opening side where the closed leaf sits, as a door's frame is (the user's reference). `at` is the jamb's end
 * on the axis, `into` the span.
 *
 *   ┬───┐          REBATE_M wide, LEAF_M deep: the leaf hangs at this corner
 *   │   └──┐
 *   ┴──────┘       the frame's square
 */
export function sashFrame(at: Point, into: Point, g: OpeningGeometry, look: OpeningLook): Primitive[] {
  const frame = jambOf(g);
  const narrow = doorInset(g);
  const step = Math.min(LEAF_M, frame / 2);
  const p = (along: number, depth: number): Point => add(add(at, scale(into, along)), scale(g.normal, frame / 2 - depth));
  return outlined([p(0, 0), p(narrow, 0), p(narrow, step), p(frame, step), p(frame, frame), p(0, frame)], look);
}

/** How far off the wall's axis, on the opening side, an opening window's leaf hangs: its frame's face. */
export const sashFace = (g: OpeningGeometry): number => jambOf(g) / 2;

/**
 * A pocket door's frames (openkinds.38): plain jambs through the wall, with no stop, as its leaf has none to close
 * against; the hinge end's split on the wall's axis by the LEAF_M slot its leaf slides through into the pocket.
 *
 *    hinge jamb    free jamb
 *   face ┬──┐        ┌──┬ face
 *        │  │        │  │
 *        └──┘ ← slot │  │
 *        ┌──┐        │  │
 *   face ┴──┘        └──┴ face
 */
export function pocketFrames(g: OpeningGeometry, toFree: Point, look: OpeningLook): Primitive[] {
  const wide = jambOf(g);
  const into = scale(g.normal, -1);
  const part = (g.thickness - LEAF_M) / 2;
  return [
    ...block(g.hinge, toFree, into, wide, part, look),
    ...block(add(g.hinge, scale(into, part + LEAF_M)), toFree, into, wide, part, look),
    ...block(g.free, scale(toFree, -1), into, wide, g.thickness, look),
  ];
}

/** A ring filled with what shows inside an opening, outlined at the frame's weight. */
function outlined(ring: readonly Point[], look: OpeningLook): Primitive[] {
  return [
    { kind: "polygon", points: ring, holes: [], color: look.span },
    ...ring.map((a, i): Primitive => ({ kind: "segment", a, b: ring[(i + 1) % ring.length] ?? a, width: { px: look.weights.frame }, color: look.line, cap: "butt" })),
  ];
}

/** A leaf in outline: from `at`, LEAF_M thick along `thick`, `length` along `along`; a glazed one holds a glass line. */
export function outlinedLeaf(at: Point, thick: Point, along: Point, length: number, glazed: boolean, look: OpeningLook): Primitive[] {
  const axis = add(at, scale(thick, LEAF_M / 2));
  return [
    ...block(at, along, thick, length, LEAF_M, look),
    ...(glazed ? [{ kind: "segment" as const, a: axis, b: add(axis, scale(along, length)), width: { px: look.weights.hair }, color: look.glass, cap: "butt" as const }] : []),
  ];
}

/** A leaf as a line from a to b at the frame's weight, or its two faces, LEAF_M apart across `across`, when glazed. */
export function plainLeaf(a: Point, b: Point, across: Point, glazed: boolean, look: OpeningLook): Primitive[] {
  if (!glazed) return [{ kind: "segment", a, b, width: { px: look.weights.frame }, color: look.line, cap: "butt" }];
  return [-1, 1].map((s): Primitive => {
    const d = scale(across, (s * LEAF_M) / 2);
    return { kind: "segment", a: add(a, d), b: add(b, d), width: { px: look.weights.line }, color: look.line, cap: "butt" };
  });
}
