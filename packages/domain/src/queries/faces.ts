import type { Point } from "@fm/protocol";
import { add, boxOf, inBox, pointInPolygon, scale, signedArea, sub, type Box } from "../geometry";
import { sortedIds, wallFrame } from "../graph";
import { MIN_FACE_AREA, isFloorWall, type Document } from "../model";
import { BOX_MARGIN, facesNear, indexFaces } from "./face-index";

/**
 * A hole of a room, its ring clockwise (negative signed area). Either a wall group's outside walk along the
 * centrelines (`wallIds[i]` leaves `jointIds[i]`), or a free column (`column` set): its row, its joints a and b, and
 * its body rectangle as the ring, which is its footprint as is (pillars.01).
 */
export type Hole = {
  readonly jointIds: readonly string[];
  readonly wallIds: readonly string[];
  readonly ring: readonly Readonly<Point>[];
  readonly column: boolean;
};

/**
 * Read-only down to the ring points: face analyses may be shared between callers. `wallIds[i]` leaves `jointIds[i]`.
 * The key is the outer ring's walls only, so a hole drawn or removed never changes it (holes.09).
 */
export type Face = {
  readonly key: string;
  readonly jointIds: readonly string[];
  readonly wallIds: readonly string[];
  readonly ring: readonly Readonly<Point>[];
  /** Sorted by each hole's leftmost joint ID. */
  readonly holes: readonly Hole[];
};
export type BoundedFace = Face & { readonly simple: boolean; readonly centreArea: number; readonly box: Box };

export type Edge = { wallId: string; a: string; b: string };

/**
 * Walls whose removal disconnects their endpoints: they belong to no cycle (spec: walls-rooms step 1). Tarjan's bridge
 * search, iterative and linear in the walls: a wall is a bridge when nothing below it in the depth-first tree
 * reaches back above it. Parallel walls are told apart by wall ID, so two walls between the same joints are no bridge.
 */
export function bridges(edges: readonly Edge[]): Set<string> {
  const adjacent = new Map<string, Edge[]>();
  for (const e of edges) {
    for (const v of [e.a, e.b]) {
      const list = adjacent.get(v);
      if (list) list.push(e);
      else adjacent.set(v, [e]);
    }
  }
  const order = new Map<string, number>(); // discovery time
  const low = new Map<string, number>(); // earliest discovery time reachable from the subtree
  const out = new Set<string>();
  let time = 0;
  for (const root of adjacent.keys()) {
    if (order.has(root)) continue;
    order.set(root, time);
    low.set(root, time);
    time += 1;
    const stack: { v: string; via: string | null; next: number }[] = [{ v: root, via: null, next: 0 }];
    for (let top = stack[stack.length - 1]; top !== undefined; top = stack[stack.length - 1]) {
      const e = adjacent.get(top.v)?.[top.next];
      if (e) {
        top.next += 1;
        if (e.wallId === top.via) continue;
        const w = e.a === top.v ? e.b : e.a;
        const seen = order.get(w);
        if (seen === undefined) {
          order.set(w, time);
          low.set(w, time);
          time += 1;
          stack.push({ v: w, via: e.wallId, next: 0 });
        } else {
          low.set(top.v, Math.min(low.get(top.v) ?? seen, seen));
        }
        continue;
      }
      stack.pop();
      const parent = stack[stack.length - 1];
      if (!parent || top.via === null) continue;
      const childLow = low.get(top.v) ?? 0;
      low.set(parent.v, Math.min(low.get(parent.v) ?? childLow, childLow));
      if (childLow > (order.get(parent.v) ?? 0)) out.add(top.via);
    }
  }
  return out;
}

type HalfEdge = { from: string; to: string; wallId: string; angle: number };

/** A closed walk, its signed area and the wall group (union-find root) it belongs to. */
type Walk = Omit<Hole, "column"> & { readonly area: number; readonly group: string };

/** The joint with the smallest x, then smallest y, then ID: always on its group's outside walk. */
function leftmost(w: Pick<Hole, "jointIds" | "ring">): { id: string; at: Readonly<Point> } | null {
  let best: { id: string; at: Readonly<Point> } | null = null;
  for (let i = 0; i < w.jointIds.length; i++) {
    const id = w.jointIds[i];
    const at = w.ring[i];
    if (id === undefined || !at) continue;
    if (!best || at.x < best.at.x || (at.x === best.at.x && (at.y < best.at.y || (at.y === best.at.y && id < best.id)))) best = { id, at };
  }
  return best;
}

/**
 * Free columns (pillars.01): column rows with no other wall at either joint, each with its body rectangle (centreline
 * ± half its depth, square ends), clockwise, and its leftmost joint, which sorts it among a room's holes.
 */
function freeColumns(doc: Document, edges: readonly Edge[]): { first: string; centre: Point; hole: Hole }[] {
  const uses = new Map<string, number>();
  for (const e of edges) for (const v of [e.a, e.b]) uses.set(v, (uses.get(v) ?? 0) + 1);
  return edges.flatMap((e) => {
    const f = doc.walls[e.wallId]?.column && uses.get(e.a) === 1 && uses.get(e.b) === 1 ? wallFrame(doc, e.wallId) : null;
    const first = f ? leftmost({ jointIds: [e.a, e.b], ring: [f.a, f.b] }) : null;
    if (!f || !first) return [];
    const n = scale(f.left, f.half);
    const ring = [sub(f.a, n), add(f.a, n), add(f.b, n), sub(f.b, n)];
    return [{ first: first.id, centre: scale(add(f.a, f.b), 0.5), hole: { jointIds: [e.a, e.b], wallIds: [e.wallId], ring, column: true } }];
  });
}

/**
 * Bounded faces of the wall graph with their holes (spec: walls-rooms steps 1–3). Bridges are ignored. Face boundaries are
 * walked with the interior on the left, so bounded faces run counter-clockwise (y up) and each wall group's outside
 * walk runs clockwise. Counter-clockwise walks smaller than MIN_FACE_AREA are ignored. Each outside walk, whatever
 * its size, becomes a hole of the smallest face of another group around the group's leftmost joint, or is dropped
 * when no face holds it (holes.01, holes.05). A free column, a bridge, becomes a hole of the smallest face around its
 * centre, its body the ring (pillars.01). A face whose walk repeats a joint is not simple: it has no area and holds no
 * labels. Only rows based on the floor count: a loop on a deck makes no room (pillars.08, .24).
 */
export function boundedFaces(doc: Document): BoundedFace[] {
  const edges: Edge[] = [];
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    if (w && isFloorWall(w) && doc.joints[w.a] && doc.joints[w.b] && w.a !== w.b) edges.push({ wallId: id, a: w.a, b: w.b });
  }
  const cut = bridges(edges);
  const outgoing = new Map<string, HalfEdge[]>();
  const angleOf = (from: string, to: string): number => {
    const p = doc.joints[from];
    const q = doc.joints[to];
    return p && q ? Math.atan2(q.y - p.y, q.x - p.x) : 0;
  };
  // Wall groups: union-find over the joints of the walls that are not bridges, with path compression.
  const parent = new Map<string, string>();
  const find = (v: string): string => {
    let root = v;
    for (let up = parent.get(root); up !== undefined && up !== root; up = parent.get(root)) root = up;
    for (let x = v, up = parent.get(x); up !== undefined && up !== root; x = up, up = parent.get(x)) parent.set(x, root);
    return root;
  };
  for (const e of edges) {
    if (cut.has(e.wallId)) continue;
    for (const [from, to] of [[e.a, e.b], [e.b, e.a]] as const) {
      const list = outgoing.get(from) ?? [];
      list.push({ from, to, wallId: e.wallId, angle: angleOf(from, to) });
      outgoing.set(from, list);
    }
    const ra = find(e.a);
    const rb = find(e.b);
    parent.set(ra, rb);
  }
  for (const list of outgoing.values()) list.sort((p, q) => p.angle - q.angle);

  // Turning rule: after arriving at v along u→v, leave by the edge just clockwise of v→u.
  const next = (h: HalfEdge): HalfEdge | undefined => {
    const list = outgoing.get(h.to) ?? [];
    const i = list.findIndex((x) => x.to === h.from && x.wallId === h.wallId);
    return list[(i - 1 + list.length) % list.length];
  };

  const visited = new Set<string>();
  const rooms: { walk: Walk; box: Box; holes: { first: string; hole: Hole }[] }[] = [];
  const outsides: Walk[] = [];
  const halfKey = (h: HalfEdge): string => `${h.wallId}|${h.from}`; // "|" is outside the ID alphabet
  for (const start of [...outgoing.keys()].sort()) {
    for (const h0 of outgoing.get(start) ?? []) {
      if (visited.has(halfKey(h0))) continue;
      const jointIds: string[] = [];
      const wallIds: string[] = [];
      let h: HalfEdge | undefined = h0;
      while (h && !visited.has(halfKey(h))) {
        visited.add(halfKey(h));
        jointIds.push(h.from);
        wallIds.push(h.wallId);
        h = next(h);
      }
      const ring = jointIds.map((id) => {
        const j = doc.joints[id];
        return { x: j?.x ?? 0, y: j?.y ?? 0 };
      });
      const walk: Walk = { jointIds, wallIds, ring, area: signedArea(ring), group: find(start) };
      // After bridge removal I2/I7 rule out a walk of zero area; a tiny counter-clockwise one is no room.
      if (walk.area >= MIN_FACE_AREA) rooms.push({ walk, box: boxOf(ring), holes: [] });
      else if (walk.area < 0) outsides.push(walk);
    }
  }

  // Walls cannot cross (I5–I7), so a group lies wholly inside or outside each face of another group, and the
  // smallest face around its leftmost joint is the innermost one. That joint stays EPS clear of other groups (I4, I6).
  const index = indexFaces(rooms);
  const smallestAround = (at: Readonly<Point>, group: string | null): (typeof rooms)[number] | null => {
    let best: (typeof rooms)[number] | null = null;
    for (const f of facesNear(index, at)) {
      if (f.walk.group === group || !inBox(at, f.box, BOX_MARGIN) || !pointInPolygon(at, f.walk.ring)) continue;
      if (!best || f.walk.area < best.walk.area) best = f;
    }
    return best;
  };
  for (const walk of outsides) {
    const p = leftmost(walk);
    if (p) smallestAround(p.at, walk.group)?.holes.push({ first: p.id, hole: { jointIds: walk.jointIds, wallIds: walk.wallIds, ring: walk.ring, column: false } });
  }
  // A free column stands EPS clear of every wall body (I20), so the face around its centre holds all of it.
  for (const c of freeColumns(doc, edges)) smallestAround(c.centre, null)?.holes.push({ first: c.first, hole: c.hole });

  const faces = rooms.map(({ walk, box, holes }): BoundedFace => ({
    key: [...walk.wallIds].sort().join("|"),
    jointIds: walk.jointIds,
    wallIds: walk.wallIds,
    ring: walk.ring,
    holes: holes.sort((p, q) => (p.first < q.first ? -1 : p.first > q.first ? 1 : 0)).map((h) => h.hole),
    simple: new Set(walk.jointIds).size === walk.jointIds.length,
    centreArea: walk.area,
    box,
  }));
  return faces.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
}
