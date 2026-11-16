import type { Point } from "@fm/protocol";
import { finishGeometry, patternShows } from "../view/finish/geometry";
import type { PlanStyle } from "../view/plan-style";
import type { Primitive } from "../view/scene-types";
import { clipRing, mix2 } from "./ceiling-clip";
import { alongOf, type SectionFrame } from "./section-cut";
import type { WallItem } from "./types";
import { sideBands } from "./wall-faces";

// A wall's finishes on a section's walls beyond (surfaces step 13, AC-07): the side facing the viewer, in its bands' true
// colours, its pattern laid as in 3D (up from 0.00, along from the side's left end as you face it) and seen along the
// section's line, and a line at a lower band's top. Openings draw over it as before.
//
//    ┌──────────────────┐  paint
//    ├──────────────────┤  the band's line at its height
//    │▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢│  tiles

/** The paint of `item`'s side facing the viewer, for each stretch's outline in the picture, or none without a finish. */
export function wallPaint(frame: SectionFrame, ink: PlanStyle["section"], item: WallItem, minSpacing: number): ((outline: readonly Point[]) => Primitive[]) | undefined {
  if (!item.sides) return undefined;
  const facesUs = item.left.x * frame.seen.x + item.left.y * frame.seen.y < 0; // the left side looks back at the viewer
  const n = facesUs ? item.left : { x: -item.left.x, y: -item.left.y };
  const bands = sideBands(item, n);
  if (bands.every((b) => b.finish === null)) return undefined;
  // The face's own frame: u from its left end as you face it, toward your right; a point on the face line.
  const right = { x: -n.y, y: n.x };
  const u0 = Math.min(...item.outline.map((p) => p.x * right.x + p.y * right.y));
  const f = Math.max(...item.outline.map((p) => p.x * n.x + p.y * n.y));
  const at = (u: number): Point => ({ x: right.x * (u0 + u) + n.x * f, y: right.y * (u0 + u) + n.y * f });
  const x0 = alongOf(frame, at(0));
  const k = alongOf(frame, at(1)) - x0; // the picture's x per metre along the face: 1 square on, less when turned
  return (outline) => {
    const xs = outline.map((p) => p.x);
    const out: Primitive[] = [];
    for (const band of bands) {
      const clipped = clipRing(clipRing([...outline], (p) => band.lo - p.y, mix2), (p) => p.y - band.hi, mix2);
      if (clipped.length < 3) continue;
      out.push({ kind: "polygon", points: clipped, holes: [], color: band.finish?.colour ?? ink.beyond });
      if (!band.finish || Math.abs(k) < 1e-6) continue;
      const g = finishGeometry(clipped.map((p) => ({ x: (p.x - x0) / k, y: p.y })), [], band.finish);
      if (g.tooFine || !patternShows(g, minSpacing)) continue;
      const toPicture = (p: Point): Point => ({ x: x0 + k * p.x, y: p.y });
      for (const s of g.shapes) out.push({ kind: "polygon", points: s.points.map(toPicture), holes: [], color: s.color });
      for (const l of g.lines) out.push({ kind: "segment", a: toPicture(l.a), b: toPicture(l.b), width: { px: ink.beyondPartWidth }, color: l.color, cap: "butt" });
    }
    const cut = bands.length > 1 ? bands[0]?.hi : undefined;
    if (cut !== undefined) out.push({ kind: "segment", a: { x: Math.min(...xs), y: cut }, b: { x: Math.max(...xs), y: cut }, width: { px: ink.beyondPartWidth }, color: ink.beyondWall, cap: "butt" });
    return out;
  };
}
