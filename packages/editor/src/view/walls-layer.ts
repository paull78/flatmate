import { relationAt, wallCorners, wallOutlines, wallRange, type Document, type Level, type WallEnd } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "./colors";
import { idsOf, memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import { ringEdges } from "./rings";
import type { Color, Primitive } from "./scene-types";

type WallParts = { ghosts: readonly Primitive[]; walls: readonly Primitive[] };
const NONE: readonly Primitive[] = [];
const IN_LINE = 1e-6; // the sine of the angle under which two walls count as one line

/**
 * Each wall or column is its filled outline, then thin segments along the outline's edges in the same colour (spec: rendering):
 * under WebGL the segments give wall edges analytic antialiasing. All fills come before all edges, the order the
 * WebGL renderer draws a layer in (polygons, then segments). By its range against the `level`'s cut (spec: levels): one ending
 * at or below the cut is only its outline, at the style's projection width (heights.15); one wholly above it (a post or
 * a knee wall on the loft, seen from the floor) is a dashed outline with no fill and no joint share, as pieces above the
 * cut draw (pillars.10); at an upper level one ending at or below the level is a ghost,
 * the style's unfilled hairline (levels.04), built by `ghostWalls`. The ghost lines are a layer of their own, drawn
 * before the decks so they pass under the level's decks and pieces (levels.50); the ghosts' joint shares stay with
 * the solid walls. A projected wall takes its joint share the same way (`jointShares`, cleanup.04), and its outline
 * edges on a share are left out, so a half wall meeting the shell at a T at the floor leaves no notch. Selection,
 * hover, refusal and the Wall tool's preview wall are canvas arguments; an export passes none.
 */
const wallParts = memoLast(
  (doc: Document, level: Level, style: PlanStyle, selectedWalls: string, hovered: string | null, invalidWallIds: string, previewWall: string | null): WallParts => {
    const selected = idsOf(selectedWalls);
    const lit = idsOf(hovered ?? ""); // the hovered wall, or the walls of a run (straight.16): an ids key
    const invalid = idsOf(invalidWallIds);
    const out: Primitive[] = [];
    const edges: Primitive[] = [];
    const ghosts: Ghost[] = [];
    const projections: Ghost[] = [];
    const projectionEdges = new Map<string, readonly Primitive[]>(); // a projected wall's edges, as pushed to `edges`
    const filled: (readonly Point[])[] = [];
    const filledAt = new Map<string, { color: Color; count: number }>(); // per joint: its filled walls' shared colour (else the plain wall's), their count
    for (const [id, points] of wallOutlines(doc)) {
      const range = wallRange(doc, id);
      const relation = range && relationAt(range, level);
      const color = invalid.has(id)
        ? COLORS.invalid
        : id === previewWall
          ? COLORS.preview
          : selected.has(id)
            ? COLORS.wallSelected
            : lit.has(id)
              ? COLORS.wallHover
              : style.wall;
      if (relation === "under") {
        ghosts.push({ id, points, color });
        continue;
      }
      if (relation === "above") { // a dashed outline with no fill, as a piece wholly above the cut (pillars.10)
        edges.push(...ringEdges(points, color, style.aboveWidth, "butt", style.aboveDash));
        continue;
      }
      const projected = relation === "below";
      if (!projected) {
        out.push({ kind: "polygon", points, holes: [], color });
        filled.push(points);
        const w = doc.walls[id];
        for (const joint of w ? [w.a, w.b] : []) {
          const seen = filledAt.get(joint);
          filledAt.set(joint, { color: seen === undefined || seen.color === color ? color : style.wall, count: (seen ? seen.count : 0) + 1 });
        }
      }
      const own = ringEdges(points, color, projected ? style.projectionWidth : style.wallEdge, "round");
      edges.push(...own);
      if (projected) {
        projections.push({ id, points, color });
        projectionEdges.set(id, own);
      }
    }
    const lines = ghosts.length > 0 ? ghostWalls(doc, ghosts, filled, filledAt, style, out, edges) : NONE;
    const shared = projections.length > 0 ? jointShares(doc, projections, filled, filledAt, style, out, edges) : new Set<string>();
    if (shared.size === 0) return { ghosts: lines, walls: [...out, ...edges] };
    const hidden = new Set(projections.flatMap((w) => (projectionEdges.get(w.id) ?? []).filter((e) => e.kind === "segment" && shared.has(edgeKey(e.a, e.b)))));
    return { ghosts: lines, walls: [...out, ...edges.filter((e) => !hidden.has(e))] };
  },
);

/** The walls drawn solid or projected, with the ghosts' joint shares and face lines. */
export const wallsLayer = (...args: Parameters<typeof wallParts>): readonly Primitive[] => wallParts(...args).walls;

/** The ghost walls' lines, drawn before the decks (levels.50); empty at the floor. */
export const ghostsLayer = (...args: Parameters<typeof wallParts>): readonly Primitive[] => wallParts(...args).ghosts;

type Ghost = { id: string; points: readonly Point[]; color: Color };

/**
 * The ghosts' lines, returned to be drawn before every solid fill and edge, so a solid face line wins where a ghost runs
 * along it (levels.31, .33, .40, .50). At a joint of 3 or more with two or more filled walls, each ghost's share of the
 * joint (from its corners to the joint, which its own fill would cover) is filled in the filled walls' shared colour
 * (else the plain wall's), with a face line across the ghost's end: where a ghost partition meets a shell at a T the shell reads
 * unbroken. A share is a triangle, so where the solids beside it don't run straight through the joint their corner can
 * come out chamfered (a supported constraint). With one filled wall, `takenEnd` says whether it takes the joint; where
 * it doesn't, that wall keeps its own end.
 * A ghost edge on the boundary of a filled area is left out, so no hairline runs along a solid wall's outline. Share
 * fills go to `out`, face lines to `edges`.
 */
function ghostWalls(doc: Document, ghosts: readonly Ghost[], filled: (readonly Point[])[], filledAt: ReadonlyMap<string, { color: Color; count: number }>, style: PlanStyle, out: Primitive[], edges: Primitive[]): Primitive[] {
  jointShares(doc, ghosts, filled, filledAt, style, out, edges);
  const covered = new Set(filled.flatMap((ring) => ring.map((a, i) => edgeKey(a, ring[(i + 1) % ring.length] ?? a))));
  return ghosts.flatMap((ghost) => {
    const line = ghost.color === style.wall ? style.ghost.line : ghost.color;
    return ringEdges(ghost.points, line, style.ghost.width, "round").filter((s) => s.kind !== "segment" || !covered.has(edgeKey(s.a, s.b)));
  });
}

/**
 * The joint shares of unfilled walls (ghosts or projected walls): at a joint of 3 or more with two or more filled
 * walls, the wall's share of the joint, from its corners to the joint, is filled in the filled walls' colour when they
 * share one, else the plain wall colour, so selecting one shell wall doesn't tint its neighbour's half (cleanup.27),
 * with a face line across the wall's end (levels.34, cleanup.04). With one filled wall, the end it takes (`takenEnd`) is
 * filled the same way. Share fills go to `out` and `filled`, face lines to `edges`. Returns the keys of the shares' edges.
 */
function jointShares(doc: Document, walls: readonly Ghost[], filled: (readonly Point[])[], filledAt: ReadonlyMap<string, { color: Color; count: number }>, style: PlanStyle, out: Primitive[], edges: Primitive[]): Set<string> {
  const corners = wallCorners(doc);
  const unfilled = new Set(walls.map((w) => w.id));
  const keys = new Set<string>();
  for (const wall of walls) {
    const ends = corners.get(wall.id);
    for (const end of ends ? [ends.a, ends.b] : []) {
      const at = filledAt.get(end.joint);
      if (at === undefined) continue;
      const color = at.color;
      const taken = at.count === 1 ? takenEnd(doc, wall.id, end, unfilled) : null;
      if (taken === null && (end.through.length === 0 || at.count < 2)) continue;
      const share = taken ? taken.ring : [...end.left.points, ...end.through, ...[...end.right.points].reverse()];
      const [first, last] = taken ? [taken.cut[0], taken.cut[1]] : [share[0], share[share.length - 1]];
      if (!first || !last) continue;
      out.push({ kind: "polygon", points: share, holes: [], color });
      filled.push(share);
      edges.push({ kind: "segment", a: last, b: first, width: { px: style.wallEdge }, color, cap: "round" });
      share.forEach((a, i) => keys.add(edgeKey(a, share[(i + 1) % share.length] ?? a)));
    }
  }
  return keys;
}

/**
 * Where the one wall reaching the cut takes this unfilled wall's end (mitres.01, .04): an L, or a T whose stem is that
 * wall and whose bar is this wall and one in line with it, of equal thickness. The end's ring gains one point, its
 * corner reaching furthest along the wall moved straight across the wall's thickness, so the wall stops in a square
 * cut: never longer than the wall is thick, and shrinking to nothing near straight, so it needs no angle limit. Null
 * where the joint keeps its own drawing, a corner the outlines bevel or end flat included.
 */
function takenEnd(doc: Document, wallId: string, end: WallEnd, unfilled: ReadonlySet<string>): { ring: Point[]; cut: [Point, Point] } | null {
  const wall = doc.walls[wallId];
  const away = wall && axis(doc, wallId, end.joint);
  const [left, right] = [end.left.points[0], end.right.points[0]];
  if (!wall || !away || !left || !right || end.left.points.length !== 1 || end.right.points.length !== 1) return null;
  const others = Object.values(doc.walls).filter((v) => v.id !== wallId && (v.a === end.joint || v.b === end.joint));
  const full = others.filter((v) => !unfilled.has(v.id));
  const toFull = full[0] && axis(doc, full[0].id, end.joint);
  if (full.length !== 1 || !toFull || Math.abs(away.x * toFull.y - away.y * toFull.x) < IN_LINE) return null;
  const partner = others.find((v) => unfilled.has(v.id));
  if (others.length === 2) {
    const along = partner && axis(doc, partner.id, end.joint);
    if (!partner || !along || partner.thickness !== wall.thickness || Math.abs(away.x * along.y - away.y * along.x) >= IN_LINE) return null;
    if (end.left.faceCorner === end.right.faceCorner) return null; // one side meets the stem, the other runs on through the bar
  } else if (others.length !== 1 || !end.left.faceCorner || !end.right.faceCorner) return null;
  const joint = doc.joints[end.joint];
  if (!joint) return null;
  const reach = (p: Point): number => (p.x - joint.x) * away.x + (p.y - joint.y) * away.y;
  const [near, far] = reach(left) >= reach(right) ? [left, right] : [right, left];
  const normal = { x: -away.y, y: away.x };
  const side = Math.sign((near.x - joint.x) * normal.x + (near.y - joint.y) * normal.y) * wall.thickness;
  const across = { x: near.x - normal.x * side, y: near.y - normal.y * side };
  return { ring: [near, across, far, ...end.through], cut: [near, across] };
}

/** The unit direction along a wall, away from one of its joints. */
function axis(doc: Document, wallId: string, jointId: string): Point | null {
  const w = doc.walls[wallId];
  const [from, to] = w ? (w.a === jointId ? [doc.joints[w.a], doc.joints[w.b]] : [doc.joints[w.b], doc.joints[w.a]]) : [];
  const length = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  return from && to && length > 0 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : null;
}

/** An edge's key either way round, to the micrometre: two walls compute a shared corner from the same two lines. */
function edgeKey(a: Point, b: Point): string {
  const k = (p: Point): string => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
  const [p, q] = [k(a), k(b)];
  return p < q ? `${p}|${q}` : `${q}|${p}`;
}
