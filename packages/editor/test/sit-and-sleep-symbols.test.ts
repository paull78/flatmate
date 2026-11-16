import { describe, expect, it } from "vitest";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import type { Primitive } from "../src/view/scene-types";
import { chairSymbol } from "../src/view/symbols/sit-and-eat";
import { reach, roundRects } from "./object-look-helpers";

// The sit-and-sleep symbols of the seating cycle (seating.03, .04, AC-02, AC-03): sofa, bed, mattress, desk, chair.

type Segment = Extract<Primitive, { kind: "segment" }>;
type Arc = Extract<Primitive, { kind: "arc" }>;

/** The detail lines: the outline and the front take the line colour "L", so only the symbol's inner parts are "D". */
const D = (kind: string, config: string, w: number, d: number) =>
  objectLook(kind, config, w, d, { line: "L", frontPx: 1, detail: "D" }).filter((p) => p.color === "D");
const segs = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const arcs = (ps: readonly Primitive[]): Arc[] => ps.flatMap((p) => (p.kind === "arc" ? [p] : []));
const near = (u: number, v: number, tol = 1e-9) => Math.abs(u - v) < tol;
const at = (p: { x: number; y: number }, x: number, y: number) => near(p.x, x, 1e-9) && near(p.y, y, 1e-9);
const joins = (s: Segment, ax: number, ay: number, bx: number, by: number) =>
  (at(s.a, ax, ay) && at(s.b, bx, by)) || (at(s.a, bx, by) && at(s.b, ax, ay));

describe("sit-and-sleep symbols (seating.04)", () => {
  it("sofa draws one cushion per seat", () => {
    for (const [kind, config] of [["sofa", "standard"], ["sofaBed", "sofa"]] as const) {
      for (const [w, n] of [[1.8, 2], [2.1, 3], [2.8, 4]] as const) {
        const d = 0.9;
        const label = `${kind}.${config} ${w}`;
        const detail = D(kind, config, w, d);
        const cushions = roundRects(detail).sort((a, b) => a.x0 - b.x0);
        expect(cushions, label).toHaveLength(n);
        // Between the 0.15 m arms, inset 0.025 m in each seat's share, from the back line to the front, radius 0.05.
        const step = (w - 0.3) / n;
        cushions.forEach((c, k) => {
          expect(c.x0, label).toBeCloseTo(-w / 2 + 0.15 + k * step + 0.025, 9);
          expect(c.x1, label).toBeCloseTo(-w / 2 + 0.15 + (k + 1) * step - 0.025, 9);
          expect(c.y0, label).toBeCloseTo(-d + 0.025, 9);
          expect(c.y1, label).toBeCloseTo(-0.24 * d - 0.025, 9);
          expect(c.r, label).toBeCloseTo(0.05, 9);
        });
        // The arm lines stop 0.04 m short of the front; the back line runs between them at 0.24·d.
        const lines = segs(detail);
        expect(lines.filter((s) => joins(s, -w / 2 + 0.15, 0, -w / 2 + 0.15, -d + 0.04)), `${label} left arm`).toHaveLength(1);
        expect(lines.filter((s) => joins(s, w / 2 - 0.15, 0, w / 2 - 0.15, -d + 0.04)), `${label} right arm`).toHaveLength(1);
        expect(lines.filter((s) => joins(s, -w / 2 + 0.15, -0.24 * d, w / 2 - 0.15, -0.24 * d)), `${label} back`).toHaveLength(1);
        expect(lines.length, label).toBe(3 + 4 * n);
      }
    }
  });

  it("bed has a two-line duvet band and no turned corner", () => {
    for (const kind of ["bed", "mattress"]) {
      for (const [w, d, pillows] of [[0.9, 2, 1], [1.29, 2, 1], [1.3, 2, 2], [1.6, 2, 2], [1.7, 2.1, 2]] as const) {
        const label = `${kind} ${w}×${d}`;
        const detail = D(kind, "standard", w, d);
        const lines = segs(detail);
        expect(lines.filter((s) => !near(s.a.x, s.b.x) && !near(s.a.y, s.b.y)), `${label} diagonals`).toHaveLength(0);
        expect(lines.filter((s) => joins(s, -w / 2, -0.27 * d, w / 2, -0.27 * d)), `${label} duvet top`).toHaveLength(1);
        expect(lines.filter((s) => joins(s, -w / 2, -0.36 * d, w / 2, -0.36 * d)), `${label} fold`).toHaveLength(1);
        // Pillows (furnish.06, unchanged): one under 1.30 m, two from 1.30 m; nothing else.
        expect(roundRects(detail), label).toHaveLength(pillows);
        expect(lines.length, label).toBe(2 + 4 * pillows);
        expect(arcs(detail).length, label).toBe(4 * pillows);
      }
    }
  });

  it("plain desk has no inner lines", () => {
    for (const [w, d] of [[1.2, 0.6], [0.1, 0.1], [3, 1]] as const) expect(D("desk", "standard", w, d), `${w}×${d}`).toEqual([]);
    // The open built-in desk keeps its cabinet band (front and middle line) and nothing in front of it.
    const open = furnitureSymbol("builtInDesk", "down", 2.4, 1.15).slice(4);
    expect(open).toHaveLength(2);
    for (const s of segs(open)) expect(near(s.a.y, s.b.y) && near(Math.abs(s.b.x - s.a.x), 2.4), "band line").toBe(true);
  });

  it("chair has a backrest band in its back 0.10 m", () => {
    /** The chair's one rounded seat, and the rest of its detail (the band): what lies behind the seat's back edge. */
    const split = (w: number, d: number) => {
      const detail = D("chair", "standard", w, d);
      const seats = roundRects(detail);
      expect(seats, `${w}×${d} seats`).toHaveLength(1);
      const back = seats[0]?.y1 ?? 0;
      return { detail, seat: seats[0], band: detail.filter((p) => Math.max(...reach(p).map((q) => q.y)) > back + 1e-9) };
    };
    const [w, d] = [0.45, 0.45];
    const { detail, seat, band } = split(w, d);
    expect(detail).toEqual(chairSymbol(w, d).map((p) => ({ ...p, color: "D" })));
    expect(detail).toHaveLength(8 + 4);
    // The seat: inset 0.04 m from the sides and the front, up to −0.12, radius 0.04.
    expect(seat).toEqual({ x0: expect.closeTo(-w / 2 + 0.04, 9), x1: expect.closeTo(w / 2 - 0.04, 9), y0: expect.closeTo(-d + 0.04, 9), y1: expect.closeTo(-0.12, 9), r: expect.closeTo(0.04, 9) });
    // The band: a rectangle from y −0.10 to −0.04, inset 0.03 m from the sides.
    const [x0, x1] = [-w / 2 + 0.03, w / 2 - 0.03];
    expect(band).toHaveLength(4);
    for (const [ax, ay, bx, by] of [[x0, -0.1, x1, -0.1], [x1, -0.1, x1, -0.04], [x1, -0.04, x0, -0.04], [x0, -0.04, x0, -0.1]] as const) {
      expect(segs(band).filter((s) => joins(s, ax, ay, bx, by)), `${ax},${ay} → ${bx},${by}`).toHaveLength(1);
    }
    // At any size, every point of the band stays in the back 0.10 m.
    for (const [cw, cd] of [[0.1, 0.1], [0.4, 0.4], [0.45, 0.6], [1, 0.3], [10, 10], [0.1, 10], [10, 0.1]] as const) {
      const sized = split(cw, cd);
      expect(sized.band, `${cw}×${cd} band`).toHaveLength(4);
      for (const q of sized.band.flatMap(reach)) expect(q.y, `${cw}×${cd} band`).toBeGreaterThanOrEqual(-0.1 - 1e-9);
    }
  });

  it("symbols stay inside the footprint", () => {
    const keys = [
      ["sofa", "standard"], ["sofaBed", "sofa"], ["sofaBed", "bed"], ["bed", "standard"], ["mattress", "standard"],
      ["desk", "standard"], ["chair", "standard"], ["builtInDesk", "down"], ["murphyBed", "down"],
    ] as const;
    const sizes = [0.1, 0.45, 1, 3, 10];
    for (const [kind, config] of keys) {
      for (const w of sizes) {
        for (const d of sizes) {
          const symbol = furnitureSymbol(kind, config, w, d);
          for (const p of symbol) {
            const where = `${kind}.${config} ${w}×${d}`;
            expect(p.kind === "segment" || p.kind === "arc", where).toBe(true);
            if (p.kind === "arc") expect(p.radius, where).toBeGreaterThanOrEqual(0);
            for (const q of reach(p)) {
              expect(Number.isFinite(q.x) && Number.isFinite(q.y), where).toBe(true);
              expect(q.x >= -w / 2 - 1e-9 && q.x <= w / 2 + 1e-9 && q.y >= -d - 1e-9 && q.y <= 1e-9, `${where} at (${q.x}, ${q.y})`).toBe(true);
            }
          }
        }
      }
    }
  });
});
