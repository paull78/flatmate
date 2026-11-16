import { add, scale, sub, type Dressing } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { WAVE, type OpeningLook } from "./opening-parts";
import type { Primitive } from "./scene-types";

// A window's dressing on the plan (hangings.04, AC-08): the shutter box above the cut as a dashed outline, the sheer
// curtain as a wavy line on the room side, as a curtain doorway's (openkinds.01); dashed too when its window is above the cut.

/** The box's dashed outline and the curtain's wave, on the dressing's side. */
export function dressingPrimitives(d: Dressing, look: OpeningLook, above: boolean): Primitive[] {
  const dash = { dash: look.dash };
  const box: Primitive[] = d.box
    ? d.box.quad.map((a, i, q): Primitive => ({ kind: "segment", a, b: q[(i + 1) % q.length] ?? a, width: { px: look.weights.hair }, color: look.line, cap: "butt", ...dash }))
    : [];
  const wave = d.curtain ? waveAlong(d.curtain.line[0], d.curtain.line[1], d.out) : [];
  const curtain = wave.slice(1).map((b, i): Primitive => ({ kind: "segment", a: wave[i] ?? b, b, width: { px: look.weights.line }, color: look.line, cap: "round", ...(above ? dash : {}) }));
  return [...box, ...curtain];
}

/** A wave from `a` to `b` about the line, `out` its side, sampled at eighths of a period. */
function waveAlong(a: Point, b: Point, out: Point): Point[] {
  const d = sub(b, a);
  const length = Math.hypot(d.x, d.y);
  const steps = Math.max(8, Math.round((8 * length) / WAVE.period));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (length * i) / steps;
    return add(add(a, scale(d, i / steps)), scale(out, WAVE.amplitude * Math.sin((2 * Math.PI * t) / WAVE.period)));
  });
}
