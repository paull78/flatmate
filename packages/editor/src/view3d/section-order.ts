import type { Ring } from "./types";

// The order of what lies past a section's plane, far to near (AC-07), on the plan as the picture sees it: x along the
// line, y the depth away from it. The camera is fixed, so each pair that overlaps in the picture has an answer of its own:
//
//       y ▲            ╱ long wall          at the middle of an overlap, the ray that meets a solid first says it's nearer.
//         │  ▒▒     ╱           ▒▒          So the wall hides the piece on the left, and the piece on the right hides
//         │      ╱              ▒▒          the wall: no single depth for the wall could give both.
//         │   ╱
//         └──────────────▶ x
//
// Pairs that don't overlap stay unordered, so a topological order of the rest is all it takes. Solids that interlock can
// run in a circle with no order at all: one is then drawn out of turn, a limit in the spec.

/** A stretch of the line, or of a ray. */
export type Span = readonly [number, number];
/** Part of what lies past the plane: outer rings and holes as above, where it lies along the line, and its range in height. */
export type Solid = { key: string; rings: readonly Ring[]; spans: readonly Span[]; bottom: number; top: number };

const EPS = 1e-9;
/** m: pairs that overlap by less than this only touch. */
const TOUCH = 1e-6;

/** Where the ray at `x` lies inside the rings, nearest first: even-odd over every crossing, so a hole counts as a gap. */
export function raySpans(rings: readonly Ring[], x: number): Span[] {
  const ys = rings.flatMap((ring) => ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    return p.x <= x === q.x <= x ? [] : [p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x)];
  })).sort((a, b) => a - b);
  return ys.flatMap((lo, i): Span[] => {
    const hi = ys[i + 1] ?? lo;
    return i % 2 === 0 && hi - lo > EPS ? [[lo, hi]] : [];
  });
}

/** The middle of the first stretch where two solids overlap along the line. */
function middleOfOverlap(a: Solid, b: Solid): number | null {
  for (const [alo, ahi] of a.spans) {
    for (const [blo, bhi] of b.spans) {
      const [lo, hi] = [Math.max(alo, blo), Math.min(ahi, bhi)];
      if (hi - lo > TOUCH) return (lo + hi) / 2;
    }
  }
  return null;
}

/** How much nearer `a` is than `b` where they overlap in the picture: positive when it's `a`, 0 when nothing orders them. */
function nearerBy(a: Solid, b: Solid): number {
  if (Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) <= TOUCH) return 0;
  const x = middleOfOverlap(a, b);
  if (x === null) return 0;
  const [ya, yb] = [raySpans(a.rings, x)[0]?.[0], raySpans(b.rings, x)[0]?.[0]];
  if (ya === undefined || yb === undefined || Math.abs(ya - yb) <= EPS) return 0;
  return yb - ya;
}

type Node<T> = { solid: T; farther: Node<T>[]; nearer: Node<T>[]; waiting: number; placed: boolean };

/** With none ready, each solid left has a farther one left, so walking back that far has to end up on a cycle. */
function onCycle<T>(nodes: readonly Node<T>[]): Node<T> | undefined {
  const left = (n: Node<T>): boolean => !n.placed;
  return nodes.reduce((node) => node?.farther.find(left), nodes.find(left));
}

/**
 * `solids` far to near, and how many were drawn out of turn to break a cycle. Names decide wherever depth doesn't, so the
 * order doesn't depend on the input's. One solid of a cycle goes next, and everything else keeps its order around it.
 */
export function farToNear<T extends Solid>(solids: readonly T[]): { order: T[]; broken: number } {
  const nodes = [...solids].sort((a, b) => (a.key < b.key ? -1 : 1)).map((solid): Node<T> => ({ solid, farther: [], nearer: [], waiting: 0, placed: false }));
  nodes.forEach((a, i) => {
    for (const b of nodes.slice(i + 1)) {
      const by = nearerBy(a.solid, b.solid);
      if (by === 0) continue;
      const [far, near] = by > 0 ? [b, a] : [a, b];
      far.nearer.push(near);
      near.farther.push(far);
      near.waiting++;
    }
  });
  const ready = nodes.filter((n) => n.waiting === 0);
  const order: T[] = [];
  let broken = 0;
  while (order.length < nodes.length) {
    const queued = ready.shift();
    const node = queued ?? onCycle(nodes);
    if (node === undefined) break; // never: `order` is short, so one is left
    if (node.placed) continue;
    if (queued === undefined) broken++;
    node.placed = true;
    order.push(node.solid);
    for (const near of node.nearer) if (--near.waiting === 0) ready.push(near);
  }
  return { order, broken };
}
