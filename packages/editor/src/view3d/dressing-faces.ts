import type { Point } from "@fm/protocol";
import { orient, prism } from "./prism";
import type { Style3d } from "./style";
import type { Dressing3d, Face3d } from "./types";

// A window's dressing in 3D (hangings.04, .05): the shutter box a joinery block, the sheer curtain pale strips with
// gaps between them, read as sheer with no transparency. Owned by the wall, so a hidden wall hides them too.
//
//   rail ┌┐ ┌┐ ┌┐ ┌┐ ┌┐      plan:  wall face ───────────
//        ││ ││ ││ ││ ││                        ┊ SHEER.off
//        ││ ││ ││ ││ ││             strips ▬  ▬  ▬  ▬  ▬
//        └┘ └┘ └┘ └┘ └┘                     STRIP GAP

/** A strip's width and the gap after it: a sheer's folds, 10 cm apart. */
const STRIP = 0.06;
const GAP = 0.04;

/** The sheer's strips along `a` → `b`, each its two ends on the plan, centred with the same margin at both ends. */
export function sheerStrips(a: Point, b: Point): [Point, Point][] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-9) return [];
  const n = Math.max(1, Math.floor((length + GAP) / (STRIP + GAP)));
  const start = (length - (n * STRIP + (n - 1) * GAP)) / 2;
  const at = (t: number): Point => ({ x: a.x + ((b.x - a.x) * t) / length, y: a.y + ((b.y - a.y) * t) / length });
  return Array.from({ length: n }, (_, i): [Point, Point] => [at(start + i * (STRIP + GAP)), at(start + i * (STRIP + GAP) + STRIP)]);
}

export function dressingFaces(owner: string, d: Dressing3d, style: Style3d): Face3d[] {
  const box = d.box ? prism(owner, d.box.quad, d.box.bottom, d.box.top, style.joinery) : [];
  const c = d.curtain;
  if (!c) return box;
  const strips = sheerStrips(c.a, c.b).map(([p, q]): Face3d[] => {
    const ring = [{ ...p, z: c.bottom }, { ...q, z: c.bottom }, { ...q, z: c.top }, { ...p, z: c.top }];
    // two faces back to back, the room side lit and the window side shaded, so the folds read from either side
    return [1, -1].map((sign) => ({ points: orient(ring, { x: c.out.x * sign, y: c.out.y * sign, z: 0 }), holes: [], color: sign > 0 ? style.sheer.lit : style.sheer.shaded, owner }));
  });
  return [...box, ...strips.flat()];
}
