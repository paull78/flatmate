import { describe, expect, it } from "vitest";
import { faces3d, hiddenWalls, STYLE_3D, view3dItems, wallSeams, type Face3d, type Point3 } from "@fm/editor";
import { drawing, fixturePixels, index, yawOf } from "./fixture-pictures";

// The seam pass on the frozen pictures (snags step 06, AC-05): drawn with and without it, every pixel that changes lies
// within 2 px of a wall edge the pass took out, so nothing but walls loses a line. The pictures are the real3d AC-16
// fixtures, each with the camera it was frozen with.

const TOLERANCE = 8; // per channel, as the frozen pictures' own test
const NEAR = 2; // px
const CHANGED_BUDGET = 0.01; // of a picture's pixels: a seam is a line, not a region

type Seg = { a: Point3; b: Point3 };
const keyOf = (s: Seg): string => [s.a, s.b].map((p) => `${+p.x.toFixed(6)},${+p.y.toFixed(6)},${+p.z.toFixed(6)}`).sort().join(" ");
/** The edge-colour segments a face draws: its rings when outlined, else its lines in the edge colour. */
const drawn = (f: Face3d): Seg[] =>
  f.outline !== false
    ? [f.points, ...f.holes].flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] ?? a })))
    : (f.lines ?? []).filter((l) => l.color === STYLE_3D.edge).map(({ a, b }) => ({ a, b }));

describe("the seam pass on the frozen pictures (snags step 06)", () => {
  for (const p of index.pictures) {
    it(`${p.file}: every changed pixel lies near a wall edge the pass took out`, () => {
      const doc = drawing(p.drawing);
      const hidden = hiddenWalls(doc, yawOf(p.turn));
      const raw = view3dItems(doc, p.state, null, new Set(), true).flatMap((i) => (i.item === "wall" && hidden.has(i.wall) ? [] : faces3d(i, STYLE_3D)));
      const after = wallSeams(raw, STYLE_3D);
      const kept = new Set(after.flatMap(drawn).map(keyOf));
      const removed = raw.filter((f) => f.owner.startsWith("wall/")).flatMap(drawn).filter((s) => !kept.has(keyOf(s)));

      const [before, now] = [fixturePixels(p, raw), fixturePixels(p, after)];
      const { width, height } = before;
      const m = p.matrix;
      const toPx = (q: Point3) => {
        const cx = (m[0] ?? 0) * q.x + (m[1] ?? 0) * q.y + (m[2] ?? 0) * q.z + (m[3] ?? 0);
        const cy = (m[4] ?? 0) * q.x + (m[5] ?? 0) * q.y + (m[6] ?? 0) * q.z + (m[7] ?? 0);
        return { x: ((cx + 1) / 2) * width, y: ((1 - cy) / 2) * height };
      };
      const lines = removed.map((s) => [toPx(s.a), toPx(s.b)] as const);
      const nearRemoved = (x: number, y: number): boolean =>
        lines.some(([a, b]) => {
          const [dx, dy] = [b.x - a.x, b.y - a.y];
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(a.x + t * dx - x, a.y + t * dy - y) <= NEAR + 0.75;
        });

      let changed = 0;
      const far: string[] = [];
      for (let k = 0; k < width * height; k++) {
        if (![0, 1, 2].some((c) => Math.abs((before.pixels[4 * k + c] ?? 0) - (now.pixels[4 * k + c] ?? 0)) > TOLERANCE)) continue;
        changed++;
        const [x, y] = [(k % width) + 0.5, Math.floor(k / width) + 0.5];
        if (!nearRemoved(x, y) && far.length < 5) far.push(`(${Math.floor(x)}, ${Math.floor(y)})`);
      }
      expect(far, `${changed} changed pixels, ${removed.length} wall edges taken out`).toEqual([]);
      expect(changed / (width * height)).toBeLessThan(CHANGED_BUDGET);
    });
  }
});
