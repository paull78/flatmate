import { OPENING_KINDS, add, dot, foldedLength, scale, sub, type Opening, type OpeningGeometry } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { LEAF_M, SASH_OVERLAP, WAVE, block, curtainOffset, foldCorners, pocketFrames, doorFrame, doorInset, doorSwingAt, faceEnds, jambOf, outlinedLeaf, sashFace, sashFrame, sashSwingAt, parkedBox, plainLeaf, spanQuad, swingBounds, swingPrimitives, type OpeningLook, type Swing } from "./opening-parts";
import type { Color, Primitive } from "./scene-types";

// Each opening kind's plan symbol (spec: openings, smalls, openkinds; reports/Drawing doors and windows.md): the one switch
// on the kind for the plan's geometry (openkinds.15). The parts are `opening-parts.ts`.

/**
 * One opening, simple or `detailed` (with frames and outlined leaves). A door: the floor colour over its span (unless
 * `withSpan` is false: the layer draws the span itself), then a swing door's leaf from the hinge, perpendicular to the
 * wall, and the quarter arc from the leaf to the wall line, or a sliding door's leaf along the face on its opening side
 * and the dashed box it parks in.
 * A window: its stretch cleared, two low-wall lines on the faces and a glass line on the axis; a casement adds its
 * leaf and thin arc on the opening side, a two-leaf window two of half the width.
 */
export function openingPrimitives(o: Opening, g: OpeningGeometry, look: OpeningLook, withSpan = true, detailed = false): Primitive[] {
  const span = withSpan ? [spanQuad(g, look.floor)] : [];
  const framed = detailed && OPENING_KINDS[o.kind].framed; // frames show at the detailed level, for a kind that has them
  switch (o.kind) {
    case "swing": {
      const s = doorSwing(o, g);
      return [
        ...span,
        ...(framed ? [...doorFrame(g.hinge, s.toFree, g, look), ...doorFrame(g.free, scale(s.toFree, -1), g, look)] : []),
        ...swingPrimitives(s, look, detailed, o.glazed),
      ];
    }
    case "double": {
      const [a, b] = faceEnds(g);
      const [s, t] = doubleSwings(o, g);
      return [
        ...span,
        ...(framed ? [...doorFrame(a, s.toFree, g, look), ...doorFrame(b, t.toFree, g, look)] : []),
        ...swingPrimitives(s, look, detailed, o.glazed),
        ...swingPrimitives(t, look, detailed, o.glazed),
      ];
    }
    case "sliding": {
      const half = g.thickness / 2;
      const leafStart = add(g.start, scale(g.normal, half));
      const off = scale(g.normal, half + LEAF_M / 2);
      const box = parkedBox(o, g);
      return [
        ...span,
        ...(detailed
          ? outlinedLeaf(leafStart, g.normal, g.along, o.width, o.glazed, look)
          : plainLeaf(add(g.start, off), add(g.end, off), g.normal, o.glazed, look)),
        ...box.map((a, i): Primitive => ({ kind: "segment", a, b: box[(i + 1) % box.length] ?? a, width: { px: look.weights.line }, color: look.line, cap: "butt", dash: look.dash })),
      ];
    }
    case "pocket": {
      // Open: its leaf parked in the wall on the axis, past its hinge end, dashed (openkinds.09); plain jambs (openkinds.38).
      const toFree = dot(sub(g.free, g.hinge), g.along) >= 0 ? g.along : scale(g.along, -1);
      const box = pocketBox(o, g);
      return [
        ...span,
        ...(framed ? pocketFrames(g, toFree, look) : []),
        { kind: "polygon", points: box, holes: [], color: look.span }, // a light slot, seen in a black or grey wall (openkinds.40)
        ...box.map((a, i): Primitive => ({ kind: "segment", a, b: box[(i + 1) % box.length] ?? a, width: { px: look.weights.line }, color: look.line, cap: "butt", dash: look.dash })),
      ];
    }
    case "folding": {
      // Drawn open (openkinds.02, .08): its leaves folded into a zigzag at the hinge end, one fold per leaf of about
      // 13 cm, FOLD_DEPTH deep centred on its side face (`foldCorners`), and a dashed line across the rest of the span
      // where it closes.
      const toFree = dot(sub(g.free, g.hinge), g.along) >= 0 ? g.along : scale(g.along, -1);
      const { zigzag, closes } = foldedStack(o, g);
      return [
        ...span,
        ...(framed ? [...doorFrame(g.hinge, toFree, g, look), ...doorFrame(g.free, scale(toFree, -1), g, look)] : []),
        ...zigzag.slice(1).map((b, i): Primitive => ({ kind: "segment", a: zigzag[i] ?? b, b, width: { px: look.weights.line }, color: look.line, cap: "butt" })),
        { kind: "segment", a: closes[0], b: closes[1], width: { px: look.weights.hair }, color: look.line, cap: "butt", dash: look.dash },
      ];
    }
    case "slidingGlass": {
      // Drawn closed (openkinds.04): two glazed sashes of about half its width on tracks either side of the axis,
      // overlapping in the middle, the same whichever side; window frames at the detailed level.
      const frame = jambOf(g);
      const frames = [
        ...block(sub(g.start, scale(g.normal, frame / 2)), g.along, g.normal, frame, frame, look),
        ...block(sub(g.end, scale(g.normal, frame / 2)), scale(g.along, -1), g.normal, frame, frame, look),
      ];
      return [
        ...span,
        ...(framed ? frames : []),
        ...glassSashes(o, g).flatMap(({ from, length, track }) => {
          const across = acrossOf(g);
          if (detailed) return outlinedLeaf(add(from, scale(across, track > 0 ? 0 : -LEAF_M)), across, g.along, length, true, look);
          const on = scale(across, (track * LEAF_M) / 2);
          return plainLeaf(add(from, on), add(add(from, scale(g.along, length)), on), g.normal, false, look);
        }),
      ];
    }
    case "window":
      return windowLines(g, look, framed);
    case "passage": // no leaf and no frame: its jambs, and the lintel above the cut as dashed lines on both faces
      return [...span, ...jambLines(g, look), ...faceLines(g).map(([a, b]): Primitive => ({ kind: "segment", a, b, width: { px: look.weights.hair }, color: look.line, cap: "butt", dash: look.dash }))];
    case "curtain": { // a wavy line across the span, just off the face it hangs on (openkinds.01)
      const w = curtainWave(g);
      return [...span, ...jambLines(g, look), ...w.slice(1).map((b, i): Primitive => ({ kind: "segment", a: w[i] ?? b, b, width: { px: look.weights.line }, color: look.line, cap: "round" }))];
    }
    case "casement":
      return [...windowLines(g, look, framed, true), ...swingPrimitives(casementSwing(o, g), look, detailed, false)];
    case "twoLeaf":
      return [...windowLines(g, look, framed, true), ...twoLeafSwings(o, g).flatMap((s) => swingPrimitives(s, look, detailed, false))];
    default:
      return assertNever(o.kind);
  }
}

/** What an opening draws past its wall's body, for a picture's bounds: its swings' arcs, a sliding door's parked leaf, or nothing. */
export function openingReach(o: Opening, g: OpeningGeometry): Point[] {
  switch (o.kind) {
    case "swing": return swingBounds(doorSwing(o, g));
    case "double": return doubleSwings(o, g).flatMap(swingBounds);
    case "sliding": return parkedBox(o, g);
    case "pocket": return []; // its leaf stays inside the wall
    case "folding": return foldedStack(o, g).zigzag;
    case "slidingGlass": return []; // closed, in the wall's thickness
    case "window": return [];
    case "passage": return [];
    case "curtain": return curtainWave(g);
    case "casement": return swingBounds(casementSwing(o, g));
    case "twoLeaf": return twoLeafSwings(o, g).flatMap(swingBounds);
    default: return assertNever(o.kind);
  }
}

/**
 * Where a pocket door's leaf parks (openkinds.09): a box LEAF_M thick on the wall's axis, one width long past the
 * hinge end, the same whichever side the door is on.
 */
function pocketBox(o: Pick<Opening, "width" | "hinge">, g: OpeningGeometry): Point[] {
  const [end, away] = o.hinge === "a" ? [g.start, scale(g.along, -1)] : [g.end, g.along];
  const across = scale({ x: -g.along.y, y: g.along.x }, LEAF_M / 2);
  const far = add(end, scale(away, o.width));
  return [sub(end, across), sub(far, across), add(far, across), add(end, across)];
}


/** The wall's left of a → b, unit: a direction across the wall that doesn't depend on the opening's side. */
const acrossOf = (g: OpeningGeometry): Point => ({ x: -g.along.y, y: g.along.x });

/**
 * A sliding glass door's two sashes, a → b: from inside each frame to SASH_OVERLAP / 2 past the middle, the first on
 * the track at −LEAF_M / 2 across the wall (`acrossOf`), the second at +LEAF_M / 2.
 */
function glassSashes(o: Opening, g: OpeningGeometry): { from: Point; length: number; track: number }[] {
  const jamb = jambOf(g);
  const half = o.width / 2 - jamb + SASH_OVERLAP / 2;
  return [
    { from: add(g.start, scale(g.along, jamb)), length: half, track: -1 },
    { from: add(g.start, scale(g.along, o.width / 2 - SASH_OVERLAP / 2)), length: half, track: 1 },
  ];
}

/** A curtain's wave across the whole span, just off the face of its side, sampled at eighths of a period. */
function curtainWave(g: OpeningGeometry): Point[] {
  const [a] = faceEnds(g);
  const length = distanceAlong(g);
  const steps = Math.max(8, Math.round((8 * length) / WAVE.period));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (length * i) / steps;
    return add(add(a, scale(g.along, t)), scale(g.normal, curtainOffset(t)));
  });
}

const distanceAlong = (g: OpeningGeometry): number => dot(sub(g.end, g.start), g.along);

/** The span's ends across the wall, from face to face: a doorway's jambs. */
function jambLines(g: OpeningGeometry, look: OpeningLook): Primitive[] {
  const half = scale(g.normal, g.thickness / 2);
  return [g.start, g.end].map((p): Primitive => ({ kind: "segment", a: sub(p, half), b: add(p, half), width: { px: look.weights.line }, color: look.line, cap: "butt" }));
}

/**
 * An opening wholly above the level's cut (sills.05): its span's outline across the wall, dashed, as a piece above the
 * cut draws dashed; no leaf, swing or glass, and the wall stays solid under it.
 */
export function openingAbove(g: OpeningGeometry, look: OpeningLook): Primitive[] {
  const dashed = ([a, b]: [Point, Point]): Primitive => ({ kind: "segment", a, b, width: { px: look.weights.hair }, color: look.line, cap: "butt", dash: look.dash });
  const half = scale(g.normal, g.thickness / 2);
  return [...faceLines(g), ...[g.start, g.end].map((p): [Point, Point] => [sub(p, half), add(p, half)])].map(dashed);
}

/** The span along each of the wall's two faces. */
function faceLines(g: OpeningGeometry): [Point, Point][] {
  const half = scale(g.normal, g.thickness / 2);
  return [[add(g.start, half), add(g.end, half)], [sub(g.start, half), sub(g.end, half)]];
}


/**
 * A folding door's folded stack (openkinds.08): a zigzag from inside its frame at the hinge end, `foldedLength` long
 * (the clear width at most) and FOLD_DEPTH deep, centred on its side face like the closing line (openkinds.36), and that
 * line across the rest of the span.
 */
function foldedStack(o: Opening, g: OpeningGeometry): { zigzag: Point[]; closes: [Point, Point] } {
  const jamb = jambOf(g);
  const toFree = dot(sub(g.free, g.hinge), g.along) >= 0 ? g.along : scale(g.along, -1);
  const start = add(g.hinge, scale(toFree, jamb));
  const length = Math.min(foldedLength(o.width), o.width - 2 * jamb);
  const zigzag = foldCorners(o.width, length).map(({ t, d }) => add(add(start, scale(toFree, t)), scale(g.normal, d)));
  return { zigzag, closes: [add(start, scale(toFree, length)), add(g.free, scale(toFree, -jamb))] };
}

/** A swing door's leaf, hung in its frames' rebates from its hinge end: the clear width between the two rebates. */
function doorSwing(o: Opening, g: OpeningGeometry): Swing {
  return doorSwingAt(g.hinge, g.free, g, o.width - 2 * doorInset(g));
}

/**
 * A double door's two leaves, each half the clear width, hung in the frames' rebates at both ends, a → b. The first is
 * the one in use and has the handle; the second is hung the same way with none (the user's review).
 */
function doubleSwings(o: Opening, g: OpeningGeometry): [Swing, Swing] {
  const half = (o.width - 2 * doorInset(g)) / 2;
  const [a, b] = faceEnds(g);
  return [doorSwingAt(a, b, g, half), sashSwingAt(b, a, g, half)];
}

/**
 * A window's leaves hang at its frame's face on the side it opens to, by the glass, not on the wall's face as a
 * door's (openkinds.39), at the frame's rebate as a door's do (the user's reference): `g.hinge` and the face ends lie
 * on the wall's face, so the point comes back to the frame's.
 */
const onSash = (p: Point, g: OpeningGeometry): Point => add(p, scale(g.normal, sashFace(g) - g.thickness / 2));

/** A casement's leaf, hung at its frame's rebate at its hinge end: the clear width between the rebates. */
const casementSwing = (o: Opening, g: OpeningGeometry): Swing => sashSwingAt(onSash(g.hinge, g), onSash(g.free, g), g, o.width - 2 * doorInset(g));

/** A two-leaf window's two half leaves, hung at both ends: the hinge plays no part. */
function twoLeafSwings(o: Opening, g: OpeningGeometry): [Swing, Swing] {
  const half = (o.width - 2 * doorInset(g)) / 2;
  const [a, b] = faceEnds(g);
  return [sashSwingAt(onSash(a, g), onSash(b, g), g, half), sashSwingAt(onSash(b, g), onSash(a, g), g, half)];
}

/**
 * The three-line window: its stretch cleared, a low-wall line on each face, a glass line on the axis; frames and sash
 * lines when `framed`, the frames rebated on the opening side when it `opens` (a casement, a two-leaf window).
 */
function windowLines(g: OpeningGeometry, look: OpeningLook, framed: boolean, opens = false): Primitive[] {
  const frame = framed ? jambOf(g) : 0;
  const half = scale(g.normal, g.thickness / 2);
  const line = (a: Point, b: Point, width: number, color: Color): Primitive => ({ kind: "segment", a, b, width: { px: width }, color, cap: "butt" });
  const from = add(g.start, scale(g.along, frame));
  const to = add(g.end, scale(g.along, -frame));
  const sash = scale(g.normal, LEAF_M / 2);
  return [
    spanQuad(g, look.span),
    line(add(g.start, half), add(g.end, half), look.weights.line, look.line),
    line(sub(g.start, half), sub(g.end, half), look.weights.line, look.line),
    ...(framed
      ? [
          ...(opens
            ? [...sashFrame(g.start, g.along, g, look), ...sashFrame(g.end, scale(g.along, -1), g, look)]
            : [...block(sub(g.start, scale(g.normal, frame / 2)), g.along, g.normal, frame, frame, look), ...block(sub(g.end, scale(g.normal, frame / 2)), scale(g.along, -1), g.normal, frame, frame, look)]),
          line(add(from, sash), add(to, sash), look.weights.hair, look.line),
          line(sub(from, sash), sub(to, sash), look.weights.hair, look.line),
        ]
      : []),
    line(from, to, look.weights.line, look.glass),
  ];
}
