import type { Box } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Primitive } from "./scene-types";
import { CHROME_FONT, textWidth } from "./fonts";

/**
 * Look's metre rulers (import.12, AC-08, AC-14): a light grid, and labelled bands at the bottom (x) and left (y), in a
 * blue of their own on a near-white band, so the labels read over any backdrop. Sizes in look pixels: `pad` around a
 * label, `tick` long, at least `labelGap` between x labels and `minStepPx` between grid lines.
 */
export const LOOK_RULER = {
  ink: "#0b44d6",
  band: "#ffffffe6",
  grid: "#0b44d633",
  size: 13, // look pixels, in CHROME_FONT
  pad: 4,
  tick: 6,
  labelGap: 12,
  minStepPx: 48,
} as const;

type Label = { value: number; text: string };

/**
 * The grid, then the bands, ticks and labels, for `region` at `zoom` look pixels per metre. One 1-2-5 step serves both
 * axes, so the grid is square: the smallest whose spacing fits `minStepPx` and the widest label plus `labelGap`.
 */
export function lookRulers(region: Box, zoom: number): { grid: Primitive[]; rulers: Primitive[] } {
  const r = LOOK_RULER;
  const width = (text: string): number => textWidth(CHROME_FONT, text, r.size);
  const step = rulerStep(region, zoom, width);
  const xs = labelsAlong(region.minX, region.maxX, step);
  const ys = labelsAlong(region.minY, region.maxY, step);
  const m = (px: number): number => px / zoom;
  const { minX, minY, maxX, maxY } = region;

  const frameW = (maxX - minX) * zoom;
  const frameH = (maxY - minY) * zoom;

  // The bottom band holds one line of labels; y labels stay above it and inside the frame.
  const bottom = r.size + 2 * r.pad;
  const yFit = ys.filter((l) => (l.value - minY) * zoom - r.size / 2 >= bottom && (maxY - l.value) * zoom >= r.size / 2);
  const yWide = Math.max(0, ...yFit.map((l) => width(l.text))) + 2 * r.pad;
  // A frame narrower than its y labels gets none, and one shorter than the bottom band no x labels.
  const yKept = yWide <= frameW ? yFit : [];
  const left = Math.max(0, ...yKept.map((l) => width(l.text))) + 2 * r.pad;
  // x labels stay right of the left band (the corner) and inside the frame.
  const xFit = (l: Label): boolean => (l.value - minX) * zoom - width(l.text) / 2 >= left && (maxX - l.value) * zoom >= width(l.text) / 2;
  const xKept = frameH >= bottom ? xs.filter(xFit) : [];

  const line = (a: Point, b: Point, color: string): Primitive => ({ kind: "segment", a, b, width: { px: 1 }, color, cap: "butt" });
  const rect = (x0: number, y0: number, x1: number, y1: number): Primitive => ({
    kind: "polygon",
    points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    holes: [],
    color: r.band,
  });
  const text = (l: Label, at: Point, align: "center" | "right"): Primitive => ({ kind: "text", text: l.text, at, size: r.size, color: r.ink, align, rotation: 0, font: CHROME_FONT });
  const bandTop = minY + m(Math.min(bottom, frameH));
  const bandRight = minX + m(Math.min(left, frameW));
  return {
    grid: [
      ...xs.map((l) => line({ x: l.value, y: minY }, { x: l.value, y: maxY }, r.grid)),
      ...ys.map((l) => line({ x: minX, y: l.value }, { x: maxX, y: l.value }, r.grid)),
    ],
    rulers: [
      rect(minX, minY, maxX, bandTop),
      rect(minX, bandTop, bandRight, maxY),
      ...xKept.map((l) => line({ x: l.value, y: bandTop }, { x: l.value, y: bandTop + m(r.tick) }, r.ink)),
      ...yKept.map((l) => line({ x: bandRight, y: l.value }, { x: bandRight + m(r.tick), y: l.value }, r.ink)),
      ...xKept.map((l) => text(l, { x: l.value, y: minY + m(bottom / 2) }, "center")),
      ...yKept.map((l) => text(l, { x: bandRight - m(r.pad), y: l.value }, "right")),
    ],
  };
}

/** From the smallest 1-2-5 value at least `minStepPx` apart, up until the widest label at that step fits. */
function rulerStep(region: Box, zoom: number, width: (text: string) => number): number {
  for (let e = Math.floor(Math.log10(LOOK_RULER.minStepPx / zoom)); ; e++) {
    for (const mantissa of [1, 2, 5]) {
      // Dividing by an exact power of ten gives the nearest double to 0.05, where 5 · 10^-2 can miss it.
      const step = e < 0 ? mantissa / 10 ** -e : mantissa * 10 ** e;
      const px = step * zoom;
      if (px < LOOK_RULER.minStepPx) continue;
      const labels = [...labelsAlong(region.minX, region.maxX, step), ...labelsAlong(region.minY, region.maxY, step)];
      if (px >= Math.max(0, ...labels.map((l) => width(l.text))) + LOOK_RULER.labelGap) return step;
    }
  }
}

/** More labels than any step lookPicture accepts gives; a guard, so a bad region can't loop forever. */
const MAX_LABELS = 1000;

/**
 * The multiples of `step` from `from` to `to`, written with the step's decimals. A value is the number its text reads,
 * so a label sits exactly at the metre it names (0.6000000000000001 would not).
 */
function labelsAlong(from: number, to: number, step: number): Label[] {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const out: Label[] = [];
  for (let k = Math.ceil(from / step); k * step <= to && out.length < MAX_LABELS; k++) {
    const raw = (k * step).toFixed(decimals);
    const value = Number(raw);
    out.push({ value: value === 0 ? 0 : value, text: value === 0 ? (0).toFixed(decimals) : raw });
  }
  return out;
}
