import type { Point } from "@fm/protocol";
import { signedArea } from "../geometry";
import { sortedIds } from "../graph";
import { MIN_FACE_AREA, type Document } from "../model";

/** Read-only down to the ring points: face analyses may be shared between callers. `wallIds[i]` leaves `jointIds[i]`. */
export type Face = {
  readonly key: string;
  readonly jointIds: readonly string[];
  readonly wallIds: readonly string[];
  readonly ring: readonly Readonly<Point>[];
};
export type BoundedFace = Face & { readonly simple: boolean; readonly centreArea: number };

type Edge = { wallId: string; a: string; b: string };

/** Walls whose removal disconnects their endpoints: they belong to no cycle (spec §3.6 step 1). */
function bridges(edges: Edge[]): Set<string> {
  const adjacent = new Map<string, Edge[]>();
  for (const e of edges) {
    adjacent.set(e.a, [...(adjacent.get(e.a) ?? []), e]);
    adjacent.set(e.b, [...(adjacent.get(e.b) ?? []), e]);
  }
  const out = new Set<string>();
  for (const e of edges) {
    const seen = new Set<string>([e.a]);
    const stack = [e.a];
    for (let v = stack.pop(); v !== undefined && !seen.has(e.b); v = stack.pop()) {
      for (const f of adjacent.get(v) ?? []) {
        if (f.wallId === e.wallId) continue;
        const w = f.a === v ? f.b : f.a;
        if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
    }
    if (!seen.has(e.b)) out.add(e.wallId);
  }
  return out;
}

type HalfEdge = { from: string; to: string; wallId: string; angle: number };

/**
 * Bounded faces of the wall graph (spec §3.6 steps 1–3). Bridges are ignored. Face boundaries are
 * walked with the interior on the left, so bounded faces run counter-clockwise (y up) and each
 * component's exterior runs clockwise and is dropped. Walks smaller than MIN_FACE_AREA are ignored.
 * A face whose walk repeats a joint is not simple: it has no area and holds no labels.
 */
export function boundedFaces(doc: Document): BoundedFace[] {
  const edges: Edge[] = [];
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    if (w && doc.joints[w.a] && doc.joints[w.b] && w.a !== w.b) edges.push({ wallId: id, a: w.a, b: w.b });
  }
  const cut = bridges(edges);
  const outgoing = new Map<string, HalfEdge[]>();
  const angleOf = (from: string, to: string): number => {
    const p = doc.joints[from];
    const q = doc.joints[to];
    return p && q ? Math.atan2(q.y - p.y, q.x - p.x) : 0;
  };
  for (const e of edges) {
    if (cut.has(e.wallId)) continue;
    for (const [from, to] of [[e.a, e.b], [e.b, e.a]] as const) {
      const list = outgoing.get(from) ?? [];
      list.push({ from, to, wallId: e.wallId, angle: angleOf(from, to) });
      outgoing.set(from, list);
    }
  }
  for (const list of outgoing.values()) list.sort((p, q) => p.angle - q.angle);

  // Turning rule: after arriving at v along u→v, leave by the edge just clockwise of v→u.
  const next = (h: HalfEdge): HalfEdge | undefined => {
    const list = outgoing.get(h.to) ?? [];
    const i = list.findIndex((x) => x.to === h.from && x.wallId === h.wallId);
    return list[(i - 1 + list.length) % list.length];
  };

  const visited = new Set<string>();
  const faces: BoundedFace[] = [];
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
      const area = signedArea(ring);
      if (area < MIN_FACE_AREA) continue;
      faces.push({
        key: [...wallIds].sort().join("|"),
        jointIds,
        wallIds,
        ring,
        simple: new Set(jointIds).size === jointIds.length,
        centreArea: area,
      });
    }
  }
  return faces.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
}
