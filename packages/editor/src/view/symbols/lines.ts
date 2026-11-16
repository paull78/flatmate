import { rotateAbout, type Arms, type ObjectOptions } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { COLORS } from "../colors";
import type { Primitive } from "../scene-types";

// Drawing helpers for the plan symbols (see `furniture.ts`): footprint space, x from −w/2 to w/2, y from −d to 0.
// Lines are 1 px in the object edge colour; callers recolour and resize them (`objectLook`).

const LINE = { px: 1 };
export const TAU = Math.PI * 2;

/** A symbol's lines by style: `line` drawn like the outline (a cabinet front), `detail` lighter. */
export type Parts = { line: Primitive[]; detail: Primitive[] };
export const inner = (detail: Primitive[]): Parts => ({ line: [], detail });

/**
 * A symbol's lines at w × d; `kind` is the kind drawn (an open unit reads its closed depth); `options`, the object's
 * options (library.10): a desk's computer (seating.12); `arms`, an `L` object's (catalog.17); none of either for a
 * palette tile or a new piece.
 */
export type SymbolOf = (w: number, d: number, kind: string, options: ObjectOptions, arms?: Arms) => Parts;
/** A palette group's symbols, keyed `${kind}.${config}`. */
export type SymbolTable = ReadonlyMap<string, SymbolOf>;

export const seg = (ax: number, ay: number, bx: number, by: number): Primitive =>
  ({ kind: "segment", a: { x: ax, y: ay }, b: { x: bx, y: by }, width: LINE, color: COLORS.objectEdge, cap: "butt" });

export const arc = (cx: number, cy: number, radius: number, from: number, to: number): Primitive =>
  ({ kind: "arc", center: { x: cx, y: cy }, radius, from, to, width: LINE, color: COLORS.objectEdge });

/** The rectangle [x0, x1] × [y0, y1] as four lines. */
export function rect(x0: number, y0: number, x1: number, y1: number): Primitive[] {
  return [seg(x0, y0, x1, y0), seg(x1, y0, x1, y1), seg(x1, y1, x0, y1), seg(x0, y1, x0, y0)];
}

/** A rectangle with quarter-arc corners of radius r (clamped to half the smaller side). */
export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Primitive[] {
  const k = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  return [
    seg(x0 + k, y0, x1 - k, y0), seg(x1, y0 + k, x1, y1 - k), seg(x1 - k, y1, x0 + k, y1), seg(x0, y1 - k, x0, y0 + k),
    arc(x1 - k, y1 - k, k, 0, Math.PI / 2), arc(x0 + k, y1 - k, k, Math.PI / 2, Math.PI),
    arc(x0 + k, y0 + k, k, Math.PI, Math.PI * 1.5), arc(x1 - k, y0 + k, k, Math.PI * 1.5, TAU),
  ];
}

/** An ellipse as a closed run of `n` lines: 16 unless it must look smooth at 1:50 on paper. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, n = 16): Primitive[] {
  const at = (i: number) => ({ x: cx + rx * Math.cos((i / n) * TAU), y: cy + ry * Math.sin((i / n) * TAU) });
  return Array.from({ length: n }, (_, i) => {
    const a = at(i);
    const b = at(i + 1);
    return seg(a.x, a.y, b.x, b.y);
  });
}

/** Detail inset from the outline: a little, in proportion to the smaller side. */
export const insetOf = (w: number, d: number) => Math.min(w, d) * 0.06;

/** A fixed size m, shrunk to a share f of the smaller side on small pieces (as `insetOf`). */
export const upTo = (m: number, w: number, d: number, f: number) => Math.min(m, f * Math.min(w, d));

/** The same primitives moved by dy along y. */
export function shiftY(primitives: readonly Primitive[], dy: number): Primitive[] {
  return primitives.map((p): Primitive => {
    switch (p.kind) {
      case "segment":
        return { ...p, a: { x: p.a.x, y: p.a.y + dy }, b: { x: p.b.x, y: p.b.y + dy } };
      case "arc":
        return { ...p, center: { x: p.center.x, y: p.center.y + dy } };
      case "polygon":
      case "disc":
      case "text":
        return p; // symbols draw lines and arcs only
      default:
        return assertNever(p);
    }
  });
}

/** A closed ring as lines: n points give n segments, the last back to the first. */
export function ringSegments(ring: readonly Point[]): Primitive[] {
  return ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return b ? [seg(a.x, a.y, b.x, b.y)] : [];
  });
}

/** Symbol primitives moved from footprint space to a placement: turned counter-clockwise by `rotation` about `at`. */
export function placeSymbol(symbol: readonly Primitive[], at: Point, rotation: number): Primitive[] {
  const move = (p: Point): Point => rotateAbout({ x: p.x + at.x, y: p.y + at.y }, at, rotation);
  const turn = (rotation * Math.PI) / 180;
  return symbol.map((p): Primitive => {
    switch (p.kind) {
      case "segment":
        return { ...p, a: move(p.a), b: move(p.b) };
      case "polygon":
        return { ...p, points: p.points.map(move), holes: p.holes.map((h) => h.map(move)) };
      case "arc":
        return { ...p, center: move(p.center), from: p.from + turn, to: p.to + turn };
      case "disc":
        return { ...p, center: move(p.center) };
      case "text":
        return { ...p, at: move(p.at) };
      default:
        return assertNever(p);
    }
  });
}
