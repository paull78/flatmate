import { cisternDepth, hasCistern, towelRailPost, vanityLayout } from "../piece-counts";
import type { Primitive } from "../scene-types";
import { arc, ellipse, inner, insetOf, rect, roundRect, seg, TAU, upTo, type Parts, type SymbolOf, type SymbolTable } from "./lines";

// Bathroom.

/** The retired bathroom block: a toilet and a shower tray. */
function bathroom(w: number, d: number): Primitive[] {
  const i = insetOf(w, d);
  const tw = Math.min(w * 0.25, d * 0.4); // toilet width
  const cx = -w / 2 + i + tw / 2;
  const cd = Math.min(d * 0.15, tw * 0.4); // cistern depth
  const bh = Math.min(d * 0.35, tw * 1.2); // bowl length
  const ss = Math.min(d - 2 * i, w * 0.45); // shower tray side
  const x0 = w / 2 - i - ss;
  const x1 = w / 2 - i;
  return [
    ...rect(cx - tw / 2, -i - cd, cx + tw / 2, -i),
    ...ellipse(cx, -i - cd - bh / 2, tw * 0.4, bh / 2),
    ...rect(x0, -i - ss, x1, -i),
    seg(x0, -i - ss, x1, -i),
    seg(x0, -i, x1, -i - ss),
  ];
}

// The bathroom pieces (furnish.13). Every length scales with w, d or m = min(w, d), so a resized piece keeps its details
// inside; the corner pieces keep theirs inside their shape too (the domain's shapes.ts).

/** Lines to the oval in a WC or a bidet: its facets showed at 1:50 on paper with 16. */
const PAN_OVAL_LINES = 32;

/** An oval seat in the pan and, from 0.60 m deep, a cistern band across the back; 0.48 w stays inside the pan's sides. */
function toilet(w: number, d: number): Primitive[] {
  if (!hasCistern(d)) return ellipse(0, -0.54 * d, 0.34 * w, 0.34 * d, PAN_OVAL_LINES);
  const c = cisternDepth(d);
  return [seg(-0.48 * w, -c, 0.48 * w, -c), ...ellipse(0, -c - 0.47 * (d - c), 0.32 * w, 0.36 * (d - c), PAN_OVAL_LINES)];
}

/** A tap's radius: a small circle at the back. */
const tapOf = (w: number, d: number) => 0.05 * Math.min(w, d);

/** A tap at (x, y) in the outline's line, its spout running forward to `to`, so it reads over the lighter detail. */
const tapAndSpout = (x: number, y: number, r: number, to: number): Primitive[] => [arc(x, y, r, 0, TAU), seg(x, y - r, x, to)];

/** An oval bowl with a drain, and a tap with a spout reaching over the bowl's back edge. */
function bidet(w: number, d: number): Parts {
  const [cy, ry] = [-0.56 * d, 0.31 * d];
  return {
    line: tapAndSpout(0, -0.1 * d, tapOf(w, d), cy + ry - 0.03 * d),
    detail: [...ellipse(0, cy, 0.34 * w, ry, PAN_OVAL_LINES), arc(0, -0.6 * d, 0.03 * Math.min(w, d), 0, TAU)],
  };
}

/** A basin centred on x, from `front` to `back`, `width` wide: a double rim and a drain at its middle. */
function basin(x: number, front: number, back: number, width: number): Primitive[] {
  const m = Math.min(width, back - front);
  const [r, rim] = [0.42 * m, 0.1 * m];
  const [x0, x1] = [x - width / 2, x + width / 2];
  return [...roundRect(x0, front, x1, back, r), ...roundRect(x0 + rim, front + rim, x1 - rim, back - rim, r - rim), arc(x, (front + back) / 2, 0.08 * m, 0, TAU)];
}

/** A basin with a margin round it and a wider ledge at the back, where the tap stands with its spout reaching over the bowl. */
function washbasin(w: number, d: number): Parts {
  const m = upTo(0.05, w, d, 0.12);
  const ledge = upTo(0.1, w, d, 0.22);
  return { line: tapAndSpout(0, -ledge / 2, tapOf(w, d), -ledge - 0.25 * ledge), detail: basin(0, -d + m, -ledge, w - 2 * m) };
}

/** A vanity unit: a cabinet with its basins drawn on it (`vanityLayout`), a tap behind each, on a ledge at the back. */
function vanityUnit(w: number, d: number): Parts {
  const { xs, width, margin, ledge } = vanityLayout(w, d);
  return {
    line: xs.flatMap((x) => tapAndSpout(x, -ledge / 2, tapOf(w, d), -ledge - 0.25 * ledge)),
    detail: xs.flatMap((x) => basin(x, -d + margin, -ledge, width)),
  };
}

/** A round bowl in the triangle's incircle: the right angle is the back-left corner, r = (w + d − hypot(w, d)) / 2. */
function cornerBasin(w: number, d: number): Primitive[] {
  const r = (w + d - Math.hypot(w, d)) / 2;
  return [arc(-w / 2 + r, -r, 0.7 * r, 0, TAU)];
}

/** A 0.04 m rim, four slope lines from the rim's corners to a drain ring of r 0.05 at the centre, and an inner ring. */
function showerTray(w: number, d: number): Primitive[] {
  const i = upTo(0.04, w, d, 0.1);
  const r = upTo(0.05, w, d, 0.1);
  const [x0, y0, x1, y1] = [-w / 2 + i, -d + i, w / 2 - i, -i];
  const cy = -d / 2;
  const slope = (x: number, y: number) => {
    const l = Math.hypot(x, y - cy);
    return seg(x, y, (x / l) * r, cy + ((y - cy) / l) * r);
  };
  return [...rect(x0, y0, x1, y1), slope(x0, y0), slope(x1, y0), slope(x1, y1), slope(x0, y1), arc(0, cy, r, 0, TAU), arc(0, cy, r / 2, 0, TAU)];
}

const RIM_SEGMENTS = 8;
/** An inset rim, the quarter ellipse at 0.85 of the shape's radii (chords of a convex curve stay inside it), and a drain. */
function cornerShower(w: number, d: number): Primitive[] {
  const at = (k: number) => {
    const t = (k / RIM_SEGMENTS) * (Math.PI / 2);
    return { x: -w / 2 + 0.85 * w * Math.cos(t), y: 0 - 0.85 * d * Math.sin(t) }; // 0 − keeps the back end +0, not −0
  };
  const rim = Array.from({ length: RIM_SEGMENTS }, (_, k) => {
    const a = at(k);
    const b = at(k + 1);
    return seg(a.x, a.y, b.x, b.y);
  });
  return [...rim, arc(-w / 2 + 0.3 * w, -0.3 * d, 0.04 * Math.min(w, d), 0, TAU)];
}

/**
 * A bathtub: a 0.07 m rim around the basin, whose head end (+x) is round (radius 0.48 × the basin's depth) and whose
 * foot end (−x) has tight 0.06 m corners; the drain 0.12 m from the foot, and a small tap on the foot rim.
 */
function bathtub(w: number, d: number): Primitive[] {
  const t = upTo(0.07, w, d, 0.1);
  const [x0, y0, x1, y1] = [-w / 2 + t, -d + t, w / 2 - t, -t];
  const [bw, bd] = [x1 - x0, y1 - y0]; // the basin
  const head = Math.min(0.48 * bd, 0.5 * bw);
  const foot = Math.min(0.06, 0.2 * Math.min(bw, bd));
  const cy = (y0 + y1) / 2;
  const tap = t / 0.07; // the tap scales with the rim
  return [
    seg(x0 + foot, y1, x1 - head, y1), seg(x0 + foot, y0, x1 - head, y0), seg(x0, y0 + foot, x0, y1 - foot), seg(x1, y0 + head, x1, y1 - head),
    arc(x0 + foot, y1 - foot, foot, Math.PI / 2, Math.PI), arc(x0 + foot, y0 + foot, foot, Math.PI, Math.PI * 1.5),
    arc(x1 - head, y1 - head, head, 0, Math.PI / 2), arc(x1 - head, y0 + head, head, Math.PI * 1.5, TAU),
    arc(x0 + Math.min(0.12, 0.25 * bw), cy, Math.min(0.025, 0.1 * Math.min(bw, bd)), 0, TAU),
    ...rect(-w / 2 + 0.015 * tap, cy - 0.03 * tap, -w / 2 + 0.05 * tap, cy + 0.03 * tap),
  ];
}

/** A control strip across the back and a round door. */
function washingMachine(w: number, d: number): Primitive[] {
  return [seg(-w / 2, -0.15 * d, w / 2, -0.15 * d), arc(0, -0.55 * d, 0.3 * Math.min(w, d), 0, TAU)];
}

/** A towel rail (catalog.23): two posts and a double bar between them, on its depth's middle line. */
function towelRail(w: number, d: number): Primitive[] {
  const r = towelRailPost(w, d);
  const [x, y, bar] = [w / 2 - 3 * r, -d / 2, 0.6 * r];
  return [arc(-w / 2 + 2 * r, y, r, 0, TAU), arc(w / 2 - 2 * r, y, r, 0, TAU), seg(-x, y - bar, x, y - bar), seg(-x, y + bar, x, y + bar)];
}

export const BATHROOM: SymbolTable = new Map<string, SymbolOf>([
  ["bathroomBlock.standard", (w, d) => inner(bathroom(w, d))],
  ["toilet.standard", (w, d) => inner(toilet(w, d))],
  ["bidet.standard", (w, d) => bidet(w, d)],
  ["washbasin.standard", (w, d) => washbasin(w, d)],
  ["vanityUnit.standard", (w, d) => vanityUnit(w, d)],
  ["cornerBasin.standard", (w, d) => inner(cornerBasin(w, d))],
  ["showerTray.standard", (w, d) => inner(showerTray(w, d))],
  ["cornerShower.standard", (w, d) => inner(cornerShower(w, d))],
  ["bathtub.standard", (w, d) => inner(bathtub(w, d))],
  ["washingMachine.standard", (w, d) => inner(washingMachine(w, d))],
  ["towelRail.standard", (w, d) => inner(towelRail(w, d))],
]);
