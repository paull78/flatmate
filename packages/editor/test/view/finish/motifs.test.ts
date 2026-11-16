import { describe, expect, it } from "vitest";
import { MOTIF_IDS, type MotifId } from "@fm/domain";
import { MOTIF_DRAWINGS, type MotifDrawing } from "../../../src/view/finish/motifs";

// The motif drawing table (finishes.07, .16): one drawing per domain motif, in units of the finish's size.

describe("the motif drawings", () => {
  it("every MotifId has a drawing whose spacing is positive and lines lie in one cell", () => {
    const table: Readonly<Record<MotifId, MotifDrawing>> = MOTIF_DRAWINGS; // a motif without a drawing doesn't compile
    for (const id of MOTIF_IDS) {
      const d = table[id];
      expect(d.spacing, id).toBeGreaterThan(0);
      const [u, v] = d.repeat;
      expect(Math.abs(u.x * v.y - u.y * v.x), `${id} repeat vectors span the plane`).toBeGreaterThan(0);
      const corners = [{ x: 0, y: 0 }, u, v, { x: u.x + v.x, y: u.y + v.y }];
      const lo = { x: Math.min(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) };
      const hi = { x: Math.max(...corners.map((c) => c.x)), y: Math.max(...corners.map((c) => c.y)) };
      // Whole units, so a line's offset is its integer index (finishes.18).
      for (const p of [u, v]) expect(Number.isInteger(p.x) && Number.isInteger(p.y), `${id} repeat on whole units`).toBe(true);
      for (const line of d.lines) {
        const what = `${id} ${JSON.stringify(line)}`;
        for (const p of [line.a, line.b]) {
          expect(Number.isInteger(p.x) && Number.isInteger(p.y), what).toBe(true);
          expect(p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y, `${what} lies in the cell's box`).toBe(true);
        }
        const along = line.family === "x" ? line.a.y === line.b.y && line.a.x < line.b.x : line.a.x === line.b.x && line.a.y < line.b.y;
        expect(along, `${what} runs along its family`).toBe(true);
        expect(line.shade > 0 && line.shade <= 1, what).toBe(true);
      }
      for (const shape of d.shapes) {
        const what = `${id} ${JSON.stringify(shape)}`;
        expect(shape.points.length, what).toBeGreaterThanOrEqual(3);
        expect(shape.shade > 0 && shape.shade <= 1, what).toBe(true);
        // Convex and counter-clockwise: every turn is a strict left turn (the clipper needs a convex clip polygon).
        shape.points.forEach((p, i) => {
          const q = shape.points[(i + 1) % shape.points.length] ?? p;
          const r = shape.points[(i + 2) % shape.points.length] ?? p;
          expect((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x), what).toBeGreaterThan(0);
        });
      }
      if (!["cementTiles", "boardAndBatten", "corrugated", "roofTiles"].includes(id)) expect(d.shapes, id).toEqual([]); // the motifs with filled shapes (surfaces.06)
    }
    expect(MOTIF_DRAWINGS.plain.lines).toEqual([]);
  });

  it("cement tiles: a unit grid, a diamond in each tile and a diamond across each grid corner", () => {
    const { repeat, lines, shapes } = MOTIF_DRAWINGS.cementTiles;
    expect(repeat).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }]);
    expect(lines.map((l) => [l.family, l.a, l.b])).toEqual([["x", { x: 0, y: 0 }, { x: 1, y: 0 }], ["y", { x: 0, y: 0 }, { x: 0, y: 1 }]]);
    const centre = (ps: readonly { x: number; y: number }[]) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
    expect(shapes.map((s) => centre(s.points))).toEqual([{ x: 0.5, y: 0.5 }, { x: 0, y: 0 }]);
    // The diamonds don't overlap: within a cell the centre one keeps x + y ≥ 0.65, the corner one x + y ≤ 0.25.
    const [mid, corner] = shapes;
    expect(Math.min(...(mid?.points ?? []).map((p) => Math.abs(p.x - 0.5) + Math.abs(p.y - 0.5)))).toBeCloseTo(0.35, 12);
    expect(Math.max(...(corner?.points ?? []).map((p) => Math.abs(p.x) + Math.abs(p.y)))).toBeCloseTo(0.25, 12);
  });
});
