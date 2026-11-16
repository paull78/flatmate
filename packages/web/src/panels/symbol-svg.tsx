import type { Primitive, Width } from "@fm/editor";
import { assertNever, type Point } from "@fm/protocol";

// Scene primitives in footprint space (furnitureSymbol: x from −w/2 to w/2, y from −d to 0, world y up) drawn as a
// small SVG for the palette tiles (ux-polish item 6, decision ux-polish.10: one source of symbols, this only converts).
// The viewBox is in metres with y flipped (screen y = −world y), so the back edge is at the top; `{ px }` widths are
// divided by the fitted scale to stay screen-constant, `{ m }` widths scale with the tile.

const MARGIN = 2; // px kept clear around the footprint, so edge strokes are not clipped
const TAU = Math.PI * 2;

type Size = { width: number; height: number };

/** A footprint of w × d metres fitted and centred in a `size` px box. Text primitives are not drawn. */
export function SymbolSvg({ primitives, w, d, size }: { primitives: readonly Primitive[]; w: number; d: number; size: Size }) {
  const scale = Math.min((size.width - 2 * MARGIN) / w, (size.height - 2 * MARGIN) / d); // px per metre
  const vw = size.width / scale;
  const vh = size.height / scale;
  const viewBox = `${-vw / 2} ${d / 2 - vh / 2} ${vw} ${vh}`;
  return (
    <svg width={size.width} height={size.height} viewBox={viewBox} aria-hidden="true">
      {primitives.map((p, i) => element(p, i, scale))}
    </svg>
  );
}

const sx = (p: Point): number => p.x;
const sy = (p: Point): number => -p.y;
const widthOf = (width: Width, scale: number): number => ("px" in width ? width.px / scale : width.m);

function element(p: Primitive, key: number, scale: number) {
  switch (p.kind) {
    case "polygon": {
      const d = [p.points, ...p.holes].map((r) => `${r.map((q, i) => `${i === 0 ? "M" : "L"}${sx(q)} ${sy(q)}`).join(" ")} Z`).join(" ");
      return <path key={key} d={d} fill={p.color} fillRule={p.holes.length > 0 ? "evenodd" : undefined} />;
    }
    case "segment":
      return (
        <line
          key={key}
          x1={sx(p.a)}
          y1={sy(p.a)}
          x2={sx(p.b)}
          y2={sy(p.b)}
          stroke={p.color}
          strokeWidth={widthOf(p.width, scale)}
          strokeLinecap={p.cap}
          strokeDasharray={p.dash?.map((n) => n / scale).join(" ")}
        />
      );
    case "arc": {
      const d = arcPath(p.center, p.radius, p.from, p.to);
      return d === null ? null : <path key={key} d={d} fill="none" stroke={p.color} strokeWidth={widthOf(p.width, scale)} />;
    }
    case "disc":
      return <circle key={key} cx={sx(p.center)} cy={sy(p.center)} r={widthOf(p.radius, scale)} fill={p.color} />;
    case "text":
      return null; // tiles carry their name as HTML text
    default:
      return assertNever(p);
  }
}

/**
 * An arc counter-clockwise (world y up) from `from` to `to` radians, as the canvas renderer reads it: a span of 2π or
 * more is a full circle, otherwise the span is taken modulo 2π. The card shows the world with y up, so the arc stays
 * counter-clockwise as seen: SVG's sweep 0 (symbols.16).
 */
export function arcPath(c: Point, r: number, from: number, to: number): string | null {
  const at = (t: number) => `${c.x + r * Math.cos(t)} ${-(c.y + r * Math.sin(t))}`;
  if (to - from >= TAU) return `M${at(from)} A${r} ${r} 0 0 1 ${at(from + Math.PI)} A${r} ${r} 0 0 1 ${at(from)}`;
  const span = (((to - from) % TAU) + TAU) % TAU;
  if (span === 0) return null;
  return `M${at(from)} A${r} ${r} 0 ${span > Math.PI ? 1 : 0} 0 ${at(from + span)}`;
}
