import { OPENING_KINDS, foldedLength } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { CURTAIN_OFF, FRAME_M, LEAF_M, REBATE_M, SASH_OVERLAP, WAVE, curtainOffset, foldCorners } from "../view/opening-parts";
import { dressingFaces } from "./dressing-faces";
import { orient, prism } from "./prism";
import type { Style3d } from "./style";
import type { Face3d, Opening3d, WallItem } from "./types";
import { keptSpan, wallAxes, type WallAxes } from "./wall-spans";

// What stands in a wall's openings in the 3D view (openings3d): a block frame inside the opening's span and range, as
// deep as the wall, a window's pane, and a door's leaf in its one pose. The wall's own holed solid is `wall-faces.ts`.
//
//     door              window
//    ┌┬──────┬┐        ┌┬──────┬┐
//    ├┴──────┴┤  head  ├┼──────┼┤  head
//    ││      ││        ││ pane ││
//    ││      ││        ├┼──────┼┤  rail
//    ││      ││        └┴──────┴┘
//    ││      ││
//    jamb   jamb

/** Under this much span or height an opening draws no frame: nothing sensible is left inside one. */
const MIN_FRAMED = 0.2;
/** A curtain rod's square section, how far it reaches past each end (openkinds.34), and the gap under a curtain's hem (openkinds.33). */
const ROD_M = 0.04;
const ROD_PAST = 0.1;
const HEM_GAP = 0.02;

/** A point on the plan, along the wall and across it. */
type Along = [s: number, d: number];
/** The faces of a stretch of a leaf, from `u0` to `u1` along its length and from `z0` to `z1` up. */
type Stretch = (u0: number, u1: number, z0: number, z1: number) => Face3d[];

/** The faces in every opening of `item`, each listed as a whole solid: the depth buffer hides what the wall covers. */
export function openingFaces(owner: string, item: WallItem, style: Style3d): Face3d[] {
  const axes = wallAxes(item);
  return axes === null ? [] : item.openings.flatMap((o) => [...facesOf(owner, axes, o, style), ...(o.dressing ? dressingFaces(owner, o.dressing, style) : [])]);
}

function facesOf(owner: string, axes: WallAxes, o: Opening3d, style: Style3d): Face3d[] {
  const { lo, hi } = keptSpan(axes, o);
  if (hi <= lo) return [];
  const framed = hi - lo >= MIN_FRAMED - 1e-9 && o.top - o.bottom >= MIN_FRAMED - 1e-9;
  /** A sheet between two (s, d) points on the plan in `color`: two faces back to back, seen from either side. */
  const sheet = (color: string) => (a: Along, b: Along, z0: number, z1: number): Face3d[] => {
    const [p, q] = [axes.at(a[0], a[1], z0), axes.at(b[0], b[1], z0)];
    const ring = [p, q, { ...q, z: z1 }, { ...p, z: z1 }];
    return [1, -1].map((sign) => ({ points: orient(ring, { x: (q.y - p.y) * sign, y: (p.x - q.x) * sign, z: 0 }), holes: [], color, owner }));
  };
  const pane = sheet(style.glass);
  if (!framed) return o.glass ? pane([lo, 0], [hi, 0], o.bottom, o.top) : [];

  const frame = Math.min(FRAME_M, o.thickness);
  const box = (s0: number, s1: number, d0: number, d1: number, z0: number, z1: number): Face3d[] =>
    prism(owner, [axes.at(s0, d0, 0), axes.at(s1, d0, 0), axes.at(s1, d1, 0), axes.at(s0, d1, 0)], z0, z1, style.joinery);
  const block = (s0: number, s1: number, z0: number, z1: number): Face3d[] => box(s0, s1, -axes.half, axes.half, z0, z1);
  /** Which way the opening side lies across the wall: the hinge stands on that face. */
  const out = axes.dOf(o.hinge) > 0 ? 1 : -1;
  const surround = !OPENING_KINDS[o.kind].framed ? [] : [ // the table's `framed`: a passage and a curtain have none
    ...block(lo, lo + frame, o.bottom, o.top),
    ...block(hi - frame, hi, o.bottom, o.top),
    ...block(lo + frame, hi - frame, o.top - frame, o.top),
  ];
  /** A door's leaf, `length` long: solid, or glazed with stiles and rails around a pane when there's room for one. */
  const leaf = (length: number, z0: number, z1: number, part: Stretch, glass: Stretch): Face3d[] => {
    if (!o.glazed || length <= 2 * frame + 1e-9) return part(0, length, z0, z1);
    return [
      ...part(0, frame, z0, z1),
      ...part(length - frame, length, z0, z1),
      ...part(frame, length - frame, z1 - frame, z1),
      ...part(frame, length - frame, z0, z0 + frame),
      ...glass(frame, length - frame, z0 + frame, z1 - frame),
    ];
  };
  /** How far inside the span a door's leaf hangs: its frame's rebate, as on the plan (`doorInset`). */
  const rebate = Math.min(REBATE_M, frame);
  /**
   * A leaf open at 90° (openings3d.03) from the frame's rebate at the low end (`atLo`) or the high one, its thickness
   * into the opening as on the plan (openings3d.27, the user's reference), `length` out from the opening side's face.
   */
  const openLeaf = (atLo: boolean, length: number): Face3d[] => {
    const s0 = atLo ? lo + rebate : hi - rebate - LEAF_M;
    const across = (u: number): number => out * (axes.half + u);
    return leaf(length, o.bottom, o.top - frame,
      (u0, u1, z0, z1) => box(s0, s0 + LEAF_M, across(u0), across(u1), z0, z1),
      (u0, u1, z0, z1) => pane([s0 + LEAF_M / 2, across(u0)], [s0 + LEAF_M / 2, across(u1)], z0, z1));
  };
  switch (o.kind) {
    case "swing": // its length the clear opening between the rebates, from its hinge's jamb
      return [...surround, ...openLeaf(axes.sOf(o.hinge) - lo < hi - axes.sOf(o.hinge), hi - lo - 2 * rebate)];
    case "double": { // two leaves, half the clear opening each, from both jambs
      const half = (hi - lo - 2 * rebate) / 2;
      return [...surround, ...openLeaf(true, half), ...openLeaf(false, half)];
    }
    case "sliding": {
      // Parked in the plan's dashed box (openings3d.15, `parkedBox`), its first two corners along the wall's face. Only
      // drawn: it isn't checked against walls, pieces or other openings.
      const hinge = axes.sOf(o.parked[0] ?? o.hinge);
      const end = axes.sOf(o.parked[1] ?? o.hinge);
      const away = (u: number): number => hinge + Math.sign(end - hinge) * u;
      return [...surround, ...leaf(Math.abs(end - hinge), o.bottom, o.top,
        (u0, u1, z0, z1) => box(away(u0), away(u1), out * axes.half, out * (axes.half + LEAF_M), z0, z1),
        (u0, u1, z0, z1) => pane([away(u0), out * (axes.half + LEAF_M / 2)], [away(u1), out * (axes.half + LEAF_M / 2)], z0, z1))];
    }
    case "passage": // the hole only (openkinds.04)
      return [];
    case "curtain": { // closed pleats through the plan's wave, off the face it hangs on, under a rod (openkinds.33, .34, .35)
      const along = (t: number): Along => [lo + t, out * (axes.half + curtainOffset(t))];
      const folds = curtainFolds(hi - lo).map(along);
      const rod = out * (axes.half + CURTAIN_OFF);
      const [r0, r1] = [Math.max(axes.c0, lo - ROD_PAST), Math.min(axes.c1, hi + ROD_PAST)]; // past the jambs, on its wall
      return [
        ...folds.slice(1).flatMap((b, i) => sheet(i % 2 === 0 ? style.fabric.lit : style.fabric.shaded)(folds[i] ?? b, b, o.bottom + HEM_GAP, o.top - ROD_M)),
        ...prism(owner, [axes.at(r0, rod - ROD_M / 2, 0), axes.at(r1, rod - ROD_M / 2, 0), axes.at(r1, rod + ROD_M / 2, 0), axes.at(r0, rod + ROD_M / 2, 0)], o.top - ROD_M, o.top, style.rod),
      ];
    }
    case "pocket": // its leaf hidden in the wall (openkinds.04)
      return surround;
    case "folding": { // its folded leaves at the hinge end, centred on its side face, as the plan's zigzag (openkinds.04, .36, .37)
      const length = Math.min(foldedLength(hi - lo), hi - lo - 2 * frame);
      const atLo = axes.sOf(o.hinge) - lo < hi - axes.sOf(o.hinge);
      const corners = foldCorners(hi - lo, length).map(({ t, d }): Along => [atLo ? lo + frame + t : hi - frame - t, out * (axes.half + d)]);
      const tones = [style.joinery.lit, style.joinery.shaded];
      return [...surround, ...corners.slice(1).flatMap((b, i) => sheet(tones[i % 2] ?? style.joinery.lit)(corners[i] ?? b, b, o.bottom, o.top - frame))];
    }
    case "slidingGlass": { // closed (openkinds.04): two glass panels on tracks either side of the axis, overlapping in the middle
      const mid = (lo + hi) / 2;
      const [d, z1] = [LEAF_M / 2, o.top - frame];
      return [...surround, ...pane([lo + frame, -d], [mid + SASH_OVERLAP / 2, -d], o.bottom, z1), ...pane([mid - SASH_OVERLAP / 2, d], [hi - frame, d], o.bottom, z1)];
    }
    case "window":
    case "casement": // closed, as every window is (openkinds.04)
      return [...surround, ...block(lo + frame, hi - frame, o.bottom, o.bottom + frame), ...pane([lo + frame, 0], [hi - frame, 0], o.bottom + frame, o.top - frame)];
    case "twoLeaf": {
      // Closed: a middle post between two panes.
      const mid = (lo + hi) / 2;
      const [z0, z1] = [o.bottom + frame, o.top - frame];
      return [
        ...surround,
        ...block(lo + frame, hi - frame, o.bottom, z0),
        ...block(mid - frame / 2, mid + frame / 2, z0, z1),
        ...pane([lo + frame, 0], [mid - frame / 2, 0], z0, z1),
        ...pane([mid + frame / 2, 0], [hi - frame, 0], z0, z1),
      ];
    }
    default:
      return assertNever(o.kind);
  }
}

/** Where a curtain's flat folds meet, `length` along its span: its two ends and every crest of the plan's wave between. */
function curtainFolds(length: number): number[] {
  const crests = Array.from({ length: Math.max(0, Math.ceil((length - WAVE.period / 4) / (WAVE.period / 2))) }, (_, k) => WAVE.period / 4 + (k * WAVE.period) / 2);
  return [0, ...crests.filter((t) => t < length - 1e-9), length];
}
