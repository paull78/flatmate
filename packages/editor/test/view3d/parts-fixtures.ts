import { OBJECT_KINDS, footprintQuad, presetSize, quadCentre, type ObjectKind } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { shapedFill } from "../../src/view/shapes";
import { appearanceOf } from "../../src/view3d/parts";
import type { Part } from "../../src/view3d/parts/types";
import { ccw } from "../../src/view3d/prism";
import type { PieceItem } from "../../src/view3d/types";

// Shared by the parts tests: which kinds are drawn how, pieces built as the 3D view builds them, and the sizes every kind
// is checked at.

/** The kinds that stay one solid: the custom boxes and the rugs (clarity.05). The one list; `every live kind` reads it. */
export const PLAIN_KINDS: readonly string[] = ["block", "roundBlock", "cornerBlock", "rug", "roundRug", "wheelWell", "beam"];

/** Live furniture: stairs draw their own bodies (stairs.39), retired kinds a plain box. */
export const LIVE_KINDS: readonly ObjectKind[] = OBJECT_KINDS.filter((k) => !k.retired && k.stair === null);

/**
 * The kinds the every-kind rules run on: the live ones in parts, read from OBJECT_KINDS so a new kind is checked at once.
 * Not the sets: they lay out their table and chairs their own way, so they fail box-fill and no-overlap (seating.15).
 */
export const PARTS_KINDS: readonly string[] = LIVE_KINDS.filter((k) => k.aggregate === null && !PLAIN_KINDS.includes(k.id)).map((k) => k.id);

export function kind(id: string): ObjectKind {
  const k = OBJECT_KINDS.find((x) => x.id === id);
  if (!k) throw new Error(`no kind ${id}`);
  return k;
}

/** A piece of `kindId` in `config` at a size, placed with its back edge's middle at `at`, as `view3dItems` places it. */
export function pieceOf(kindId: string, config: string, w: number, d: number, h: number, rotation = 0, at: Point = { x: 5, y: 5 }, bottom = 0.3, selected = false): PieceItem {
  const quad = footprintQuad(at, w, d, rotation);
  const centre = quadCentre(quad);
  if (!centre) throw new Error("a footprint has a centre");
  return {
    item: "piece", placement: "p", object: "o", objectKind: kindId, config, ring: shapedFill(kindId, w, d, at, rotation, quad),
    centre, rotation, w, d, bottom, top: bottom + h, selected,
  };
}

export type Size = { config: string; w: number; d: number; h: number; label: string };

/** A kind's default size and every preset, in each configuration (a preset's height through presetSize, catalog.07). */
export function namedSizes(k: ObjectKind): Size[] {
  const out: Size[] = [];
  for (const c of k.configs) {
    out.push({ config: c.id, w: c.w, d: c.d, h: c.h, label: `${k.id}.${c.id} default` });
    for (const p of k.presets) {
      const size = presetSize(k.id, p.id);
      out.push({ config: c.id, w: p.w, d: p.d[c.id] ?? c.d, h: size?.h[c.id] ?? c.h, label: `${k.id}.${c.id} ${p.label}` });
    }
  }
  return out;
}

/** A seeded random stream (Park–Miller), so a failing case can be kept as an example. */
export function stream(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** How far `p` lies outside the convex ring (negative inside). */
export function outside(ring: readonly Point[], p: Point): number {
  const r = ccw(ring);
  let worst = -Infinity;
  r.forEach((a, i) => {
    const b = r[(i + 1) % r.length] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-12) return;
    worst = Math.max(worst, ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len);
  });
  return worst;
}

export const partsOf = (kindId: string, s: Size): readonly Part[] => appearanceOf(kindId)(s.config, s.w, s.d, s.h);
