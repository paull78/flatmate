import { describe, expect, it } from "vitest";
import { CHAIR_SIZE, SEAT_BACK, SEATED_HEIGHT, convexOverlap } from "@fm/domain";
import type { Box3, Part } from "../../src/view3d/parts/types";
import { kind, namedSizes, partsOf, type Size } from "./parts-fixtures";

// The built-in table and desk (clarity.05, AC-10). The every-kind rules run on them through PARTS_KINDS; here is what a
// built-in must show. Local frame: y from the front (−d/2) to the back (d/2), z up from the bottom.

const UNITS = ["builtInTable", "builtInDesk"] as const;
const FAR = 1e-9;
const near = (a: number, b: number) => Math.abs(a - b) < FAR;
const boxes = (parts: readonly Part[]): Box3[] => parts.flatMap((p) => (p.shape === "box" ? [p.at] : []));
const openSizes = (id: string): Size[] => namedSizes(kind(id)).filter((s) => s.config === "down");
const foldedSizes = (id: string): Size[] => namedSizes(kind(id)).filter((s) => s.config === "folded");
const closedDepth = (id: string): number => kind(id).configs[0]?.d ?? NaN;
/** The top of a default chair's seat: the highest box as deep as the chair, its back being thinner. */
function chairSeatTop(): number {
  const c = kind("chair").configs[0];
  if (!c) throw new Error("no chair");
  const all = boxes(partsOf("chair", { config: c.id, w: c.w, d: c.d, h: c.h, label: "chair" }));
  return Math.max(...all.filter((b) => near(b.y1 - b.y0, c.d)).map((b) => b.z1));
}

/** An open unit read by shape: what stands at the back, the board across the front, what stands on the floor at the front. */
function openUnit(id: string, s: Size) {
  const all = boxes(partsOf(id, s));
  const back = all.filter((b) => near(b.y1, s.d / 2));
  const top = all.filter((b) => b.y1 < s.d / 2 - FAR && b.z0 > 0 && near(b.x0, -s.w / 2) && near(b.x1, s.w / 2));
  const legs = all.filter((b) => b.y1 < s.d / 2 - FAR && near(b.z0, 0));
  return { back, top: top[0], tops: top.length, legs };
}

describe("the built-in table and desk", () => {
  it("a built-in draws differently folded and open: different part counts at the same size", () => {
    for (const id of UNITS) {
      for (const c of kind(id).configs) {
        const at = (config: string) => partsOf(id, { config, w: c.w, d: c.d, h: c.h, label: `${id} ${config}` }).length;
        expect(at("folded"), `${id} at ${c.id}'s size`).not.toBe(at("down"));
      }
    }
  });

  it("open, the top sits at its seated height and the leg reaches the floor", () => {
    for (const id of UNITS) {
      for (const s of openSizes(id)) {
        const { top, tops, legs } = openUnit(id, s);
        expect(tops, s.label).toBe(1);
        expect(top?.z1, s.label).toBeCloseTo(SEATED_HEIGHT, 9);
        expect(top?.y0, s.label).toBeCloseTo(-s.d / 2, 9);
        expect(legs, s.label).toHaveLength(2); // one at each front corner, so neither floats (clarity.46)
        for (const leg of legs) {
          expect(leg.z1, s.label).toBeCloseTo(top?.z0 ?? NaN, 9); // up to the top's underside
          expect(leg.y0, s.label).toBeCloseTo(-s.d / 2, 9); // at the front
        }
      }
    }
  });

  it("open, the cabinet stands behind the top, reaches the unit's height and is as deep as the plan's band", () => {
    for (const id of UNITS) {
      for (const s of openSizes(id)) {
        const { back, top } = openUnit(id, s);
        const cabinet = Math.min(closedDepth(id), s.d / 2); // `openUnit` in view/symbols/sleep.ts
        expect(Math.max(...back.map((b) => b.z1)), s.label).toBeCloseTo(s.h, 9);
        expect(Math.min(...back.map((b) => b.z0)), s.label).toBeCloseTo(0, 9);
        for (const b of back) expect(b.y0, s.label).toBeCloseTo(s.d / 2 - cabinet, 9);
        expect(top?.y1, s.label).toBeCloseTo(s.d / 2 - cabinet, 9);
      }
    }
  });

  it("the top's height comes from one owner: the desk's and the tables' own, and never the unit's stored height", () => {
    const owners = [["desk", "standard"], ["cornerDesk", "standard"], ["extendingTable", "closed"], ["extendingTable", "extended"], ["roundTable", "standard"], ["foldingTable", "open"]] as const;
    for (const [id, config] of owners) expect(kind(id).configs.find((c) => c.id === config)?.h, id).toBe(SEATED_HEIGHT);
    expect(kind("builtInTable").configs.map((c) => c.h)).toEqual([1.6, 1.6]);
    expect(kind("builtInDesk").configs.map((c) => c.h)).toEqual([1.4, 1.4]);
    for (const id of UNITS) {
      for (const h of [1.4, 1.6, 2.2]) expect(openUnit(id, { config: "down", w: 1.2, d: 1.15, h, label: `${h}` }).top?.z1, `${id} at ${h}`).toBeCloseTo(SEATED_HEIGHT, 9);
    }
  });

  it("a unit too low for its top keeps the top under its own height, at any height", () => {
    for (const id of UNITS) {
      for (const h of [0.01, 0.1, 0.5, 0.75, 0.9, 1.0]) {
        const { top } = openUnit(id, { config: "down", w: 1.2, d: 1.15, h, label: `${h}` });
        expect(top?.z1, `${id} at ${h}`).toBeLessThan(h);
        expect(top?.z1, `${id} at ${h}`).toBeGreaterThan(top?.z0 ?? Infinity);
      }
    }
  });

  it("folded, nothing leaves the cabinet's depth, and it shows a door with a handle", () => {
    for (const id of UNITS) {
      for (const s of foldedSizes(id)) {
        const parts = partsOf(id, s);
        const panels = parts.flatMap((p) => p.panels ?? []);
        for (const b of [...boxes(parts), ...panels.map((p) => p.at)]) {
          expect(b.y0, s.label).toBeGreaterThanOrEqual(-s.d / 2 - FAR);
          expect(b.y1, s.label).toBeLessThanOrEqual(s.d / 2 + FAR);
        }
        expect(parts.length).toBeGreaterThan(0);
        expect(parts.every((p) => p.shape === "box"), s.label).toBe(true);
        expect(panels.filter((p) => p.normal === "-y").map((p) => p.slot).sort(), s.label).toEqual(["dark", "laminate"]);
      }
    }
  });

  it("a chair tucked at the middle of the top's front edge misses the leg, with its seat under the top (seatsUnder is untouched)", () => {
    for (const id of UNITS) {
      expect(kind(id).seatsUnder).toEqual(["down"]);
      for (const s of openSizes(id)) {
        const { legs, top } = openUnit(id, s);
        const front = -s.d / 2;
        const chair = [
          { x: -CHAIR_SIZE.w / 2, y: front - SEAT_BACK },
          { x: CHAIR_SIZE.w / 2, y: front - SEAT_BACK },
          { x: CHAIR_SIZE.w / 2, y: front + CHAIR_SIZE.d - SEAT_BACK },
          { x: -CHAIR_SIZE.w / 2, y: front + CHAIR_SIZE.d - SEAT_BACK },
        ];
        for (const leg of legs) {
          const ring = [{ x: leg.x0, y: leg.y0 }, { x: leg.x1, y: leg.y0 }, { x: leg.x1, y: leg.y1 }, { x: leg.x0, y: leg.y1 }];
          expect(convexOverlap(chair, ring, 0.001), s.label).toBe(false);
        }
        expect(top?.z0, s.label).toBeGreaterThan(chairSeatTop());
      }
    }
  });

  it("at every size between folded and open, in both directions, the target's parts stay whole (parts are rebuilt each flip frame, parts.03)", () => {
    for (const id of UNITS) {
      const [a, b] = kind(id).configs;
      if (!a || !b) throw new Error(id);
      for (const [from, to] of [[a, b], [b, a]] as const) {
        for (let i = 0; i <= 100; i++) {
          const t = i / 100;
          const s: Size = { config: to.id, w: from.w + (to.w - from.w) * t, d: from.d + (to.d - from.d) * t, h: from.h, label: `${id} ${from.id}→${to.id} t ${t}` };
          const all = boxes(partsOf(id, s));
          for (const box of all) {
            expect(box.x1, s.label).toBeGreaterThan(box.x0);
            expect(box.y1, s.label).toBeGreaterThan(box.y0);
            expect(box.z1, s.label).toBeGreaterThan(box.z0);
            expect(box.y0, s.label).toBeGreaterThanOrEqual(-s.d / 2 - FAR);
            expect(box.y1, s.label).toBeLessThanOrEqual(s.d / 2 + FAR);
          }
          expect(Math.min(...all.map((box) => box.y0)), s.label).toBeCloseTo(-s.d / 2, 9);
          expect(Math.max(...all.map((box) => box.y1)), s.label).toBeCloseTo(s.d / 2, 9);
          if (to.id === "down") expect(openUnit(id, s).top?.z1, s.label).toBeCloseTo(SEATED_HEIGHT, 9);
        }
      }
    }
  });
});
