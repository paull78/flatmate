import { SIDE_BOARD, UNDERSIDE_DEPTH, type StairGeometry } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { prism } from "./prism";
import { slab, type Local } from "./slab";
import type { Shades } from "./style";
import { stepsFrom, type Face3d, type PieceItem } from "./types";

// An open flight in the 3D view (stairs steps 11, 12): two side boards, sloped with the pitch line and 0.23 deep below
// it (the underside the fit checks, stairs.03), and thin open treads between them, nothing underneath; an alternating
// tread adds a centre stringer like the boards and puts half treads, each two goings deep, on alternate sides of it.
// Every part's faces, in any order: the depth buffer hides what is behind (real3d.09).

const TREAD = 0.035; // m: an open tread's thickness
const STRINGER = 0.04; // m: an alternating tread's centre stringer, as thick as a side board

/**
 * The faces of an open flight with geometry `g`; `at` places a local point (x across, y along the run from −d/2).
 * With `alternating`, tread k stands on the right half (+x) when k is even, on the left when odd, as the plan's
 * nosings alternate (stair-lines.ts).
 */
export function openFlightFaces(owner: string, item: PieceItem, shades: Shades, g: StairGeometry, at: (x: number, y: number) => Point, alternating = false): Face3d[] {
  const r = (item.rotation * Math.PI) / 180;
  const across = { x: Math.cos(r), y: Math.sin(r) };
  const inner = item.w / 2 - SIDE_BOARD;
  const mid = alternating ? STRINGER / 2 : 0;
  const localX = (p: Point): number => (p.x - item.centre.x) * across.x + (p.y - item.centre.y) * across.y;
  const treads: Face3d[] = [];
  for (let k = 1; k <= g.treads; k++) {
    const half = alternating ? (k % 2 === 0 ? 1 : -1) : 0;
    const [x0, x1] = half > 0 ? [mid, inner] : half < 0 ? [-inner, -mid] : [-inner, inner];
    const y0 = -item.d / 2 + (k - 1) * g.going;
    const y1 = -item.d / 2 + Math.min(g.run, (alternating ? k + 1 : k) * g.going);
    const top = stepsFrom(item) + k * g.riser;
    const ring = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
    // Its ends meet the boards (and the stringer), which cover them unless the part's underside, 0.23 below the pitch
    // line, passes above the tread's back, as on a steep flight: then they stay.
    const covered = g.pitch(y1 + item.d / 2) - UNDERSIDE_DEPTH <= k * g.riser - TREAD + 1e-9;
    const ends = alternating ? [inner, -inner, mid, -mid] : [inner, -inner];
    const againstPart = (f: Face3d): boolean => ends.some((x) => f.points.every((p) => Math.abs(localX(p) - x) < 1e-9));
    treads.push(...prism(owner, ring, top - TREAD, top, shades).filter((f) => !covered || !againstPart(f)));
  }
  const profile = boardProfile(item, g);
  const part = (x0: number, x1: number): Face3d[] => slab(owner, item, shades, at, profile, x0, x1);
  return [...part(-item.w / 2, -inner), ...treads, ...(alternating ? part(-mid, mid) : []), ...part(inner, item.w / 2)];
}

/**
 * A side board's outline in the plane of the run, counter-clockwise (a metres along the run from the front edge, z up):
 * its top on the pitch line from the first nosing to the top, its bottom 0.23 below it, cut off where its steps begin.
 */
function boardProfile(item: PieceItem, g: StairGeometry): Local[] {
  const base = stepsFrom(item);
  const pitch = (a: number): number => base + g.pitch(a);
  const under = (a: number): number => pitch(a) - UNDERSIDE_DEPTH;
  const slope = g.riser / g.going;
  const a0 = Math.min(g.run, Math.max(0, (base - under(0)) / slope)); // where the underside leaves its base
  const out: Local[] = a0 > 0 ? [{ a: 0, z: base }, { a: a0, z: base }] : [{ a: 0, z: under(0) }];
  if (a0 < g.run) out.push({ a: g.run, z: under(g.run) });
  out.push({ a: g.run, z: pitch(g.run) }, { a: 0, z: pitch(0) });
  return out;
}
