import { describe, expect, it } from "vitest";
import { placedPiece } from "@fm/domain";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Panel, Part } from "../../src/view3d/parts/types";
import { STYLE_3D } from "../../src/view3d/style";
import { PARTS_KINDS, namedSizes, kind, outside, partsOf, pieceOf, type Size } from "./parts-fixtures";

// The kitchen and bathroom kinds in parts (clarity.05, AC-10). The every-kind rules (inside the drawn shape, filling the
// box, no overlaps, the face cap) run on these through PARTS_KINDS; here is what each kind must show.
// Local frame: y from the front (−d/2) to the back (d/2), z up from the bottom.

const MM = 0.001;
const size = (w: number, d: number, h: number): Size => ({ config: "standard", w, d, h, label: `${w}×${d}×${h}` });
const boxes = (parts: readonly Part[]) => parts.flatMap((p) => (p.shape === "box" ? [{ at: p.at, slot: p.slot, panels: p.panels ?? [] }] : []));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const rangeOf = (p: Part): [number, number] => (p.shape === "outline" || p.shape === "ring" ? [p.z0, p.z1] : [p.at.z0, p.at.z1]);
const topOf = (parts: readonly Part[]) => Math.max(...parts.map((p) => rangeOf(p)[1]));
const metal = (parts: readonly Part[]) => parts.filter((p) => p.slot === "metal");
const panelsOf = (p: Part | undefined): readonly Panel[] => p?.panels ?? [];
const isUp = (q: Panel) => q.normal === "+z" && q.slot === "metal";
const STRANGE: readonly [number, number, number][] = [[0.1, 0.1, 0.01], [0.1, 10, 3], [10, 0.1, 0.3], [0.3, 0.6, 0.5], [10, 10, 3], [0.45, 0.45, 1.05], [0.8, 0.8, 2]];

/** Every point the kind draws lies inside its drawn shape, within AC-01's millimetre. */
function expectInsideShape(id: string, s: Size): void {
  const [ring] = placedPiece(id, { x: 5, y: 5 }, s.w, s.d, 0).parts;
  for (const f of partSolids("o", pieceOf(id, s.config, s.w, s.d, s.h), STYLE_3D).flatMap((p) => p.faces)) {
    for (const p of f.points) expect(outside(ring ?? [], p), `${id} ${s.label}`).toBeLessThanOrEqual(MM);
  }
}

describe("the kinds of this step", () => {
  it("are checked by the every-kind properties", () => {
    expect(PARTS_KINDS).toEqual(expect.arrayContaining(["dishwasher", "ovenColumn", "washbasin", "cornerBasin", "bidet", "cornerShower"]));
  });
});

describe("the dishwasher", () => {
  it("a dishwasher's front reaches the box front, with a dark strip under its worktop", () => {
    for (const [w, d, h] of [[0.6, 0.6, 0.9], [0.45, 0.6, 0.9], [0.6, 0.6, 0.3], [0.1, 0.1, 0.01]] as const) {
      const fronts = boxes(partsOf("dishwasher", size(w, d, h))).filter((b) => near(b.at.y0, -d / 2));
      const strip = fronts.find((b) => b.slot === "dark");
      const door = fronts.find((b) => b.slot !== "dark");
      const worktop = fronts.find((b) => b.slot === "wood");
      expect(worktop?.at.z1, `${w} ${h}`).toBeCloseTo(h, 9);
      expect(strip?.at.z1, `${w} ${h}: the strip sits under the worktop`).toBeCloseTo(worktop?.at.z0 ?? NaN, 9);
      expect(door?.at.z1, `${w} ${h}: the strip sits above the door`).toBeLessThanOrEqual(strip?.at.z0 ?? 0);
      expect(door?.panels.filter((q) => q.normal === "-y" && q.slot === "dark"), "a handle").toHaveLength(1);
    }
  });

  it("stands on a dark plinth, set back, under its carcass", () => {
    const parts = boxes(partsOf("dishwasher", size(0.6, 0.6, 0.9)));
    const plinth = parts.filter((b) => b.slot === "dark" && b.at.z0 === 0);
    expect(plinth).toHaveLength(1);
    expect(plinth[0]?.at.y0).toBeGreaterThan(-0.3);
    expect(parts.some((b) => b.at.z0 === plinth[0]?.at.z1 && b.at.y0 > -0.3 && near(b.at.z1, 0.86)), "the carcass").toBe(true);
  });

  it("shares the base units' wood worktop, so a run's top doesn't break here (clarity.52)", () => {
    for (const [w, d, h] of [[0.6, 0.6, 0.9], [0.45, 0.6, 0.9]] as const) {
      const worktop = (ps: readonly Part[]) => boxes(ps).filter((b) => b.slot === "wood").map((b) => b.at);
      expect(worktop(partsOf("dishwasher", size(w, d, h)))).toEqual(worktop(partsOf("counter", size(w, d, h))));
    }
  });
});

describe("the oven column", () => {
  it("an oven column's oven front is dark, between two doors, at any height", () => {
    for (const h of [2.15, 2.03, 1.5, 0.3, 0.01]) {
      const d = 0.6;
      const fronts = boxes(partsOf("ovenColumn", size(0.6, d, h))).filter((b) => near(b.at.y0, -d / 2)).sort((a, b) => a.at.z0 - b.at.z0);
      expect(fronts.map((f) => f.slot), `${h} m`).toEqual(["laminate", "dark", "laminate"]);
      const [lower, oven, upper] = fronts;
      expect(lower?.at.z1, `${h} m`).toBeLessThanOrEqual(oven?.at.z0 ?? 0);
      expect(oven?.at.z1, `${h} m`).toBeLessThanOrEqual(upper?.at.z0 ?? 0);
      expect(lower && lower.at.z1 - lower.at.z0, `${h} m: a lower door to see`).toBeGreaterThan(0);
      expect(upper && upper.at.z1 - upper.at.z0, `${h} m: an upper door to see`).toBeGreaterThan(0);
      expect(upper?.at.z1, `${h} m`).toBeCloseTo(h, 9);
      const handles = oven?.panels ?? [];
      expect(handles, `${h} m: the oven's handle`).toHaveLength(1);
      expect(handles[0]?.slot, `${h} m: a handle that shows on the dark front`).toBe("metal");
    }
  });

  it("keeps the oven at its real height in the default column", () => {
    const oven = boxes(partsOf("ovenColumn", size(0.6, 0.6, 2.15))).find((b) => b.slot === "dark" && near(b.at.y0, -0.3));
    expect(oven?.at.z0).toBeCloseTo(0.85, 9);
    expect(oven?.at.z1).toBeCloseTo(1.45, 9);
  });
});

describe("the washbasin", () => {
  const sizes = [size(0.6, 0.45, 1.05), size(0.5, 0.4, 1.05), size(0.8, 0.5, 0.8), size(0.1, 0.1, 0.01), size(10, 0.1, 3)];

  it("a washbasin's bowl is a solid with a metal +z panel, as the sink's bowl", () => {
    for (const s of sizes) {
      const parts = partsOf("washbasin", s);
      const bowl = parts.find((p) => p.shape === "outline"); // on the drawn soft ring (symbols.05)
      expect(bowl?.slot, s.label).toBe("ceramic");
      const panel = bowl?.panels?.find(isUp);
      const bowlTop = bowl ? rangeOf(bowl)[1] : NaN;
      expect(panel?.at.z1, s.label).toBeCloseTo(bowlTop, 9);
      // A rim stands round the panel, on the solid.
      const rim = boxes(parts).filter((b) => b.slot === "ceramic" && near(b.at.z0, bowlTop));
      expect(rim, s.label).toHaveLength(4);
      for (const r of rim) {
        const clear = (panel?.at.x1 ?? 0) <= r.at.x0 + 1e-9 || r.at.x1 <= (panel?.at.x0 ?? 0) + 1e-9 || (panel?.at.y1 ?? 0) <= r.at.y0 + 1e-9 || r.at.y1 <= (panel?.at.y0 ?? 0) + 1e-9;
        expect(clear, `${s.label}: the rim leaves the panel in view`).toBe(true);
      }
    }
  });

  it("stands on a narrower pedestal, with a metal tap reaching exactly h", () => {
    for (const s of sizes) {
      const parts = partsOf("washbasin", s);
      const pedestal = parts.find((p) => p.shape === "cylinder" && p.slot === "ceramic" && p.at.z0 === 0);
      const bowl = parts.find((p) => p.shape === "outline");
      const [bowlZ0, bowlZ1] = bowl ? rangeOf(bowl) : [NaN, NaN];
      expect(pedestal?.shape === "cylinder" && pedestal.at.z1, s.label).toBeCloseTo(bowlZ0, 9);
      expect(pedestal?.shape === "cylinder" && pedestal.at.x1 - pedestal.at.x0, s.label).toBeLessThan(s.w);
      const tap = metal(parts);
      expect(tap.length, s.label).toBeGreaterThan(0);
      expect(topOf(tap), s.label).toBe(s.h);
      for (const t of tap) expect(rangeOf(t)[0], `${s.label}: the tap stands on the rim`).toBeGreaterThanOrEqual(bowlZ1);
    }
  });

  it("keeps the rim at a real height by default", () => {
    const rimTop = Math.max(...partsOf("washbasin", size(0.6, 0.45, 1.05)).filter((p) => p.slot === "ceramic").map((p) => rangeOf(p)[1]));
    expect(rimTop).toBeCloseTo(0.85, 9);
  });
});

describe("the corner basin", () => {
  it("a corner basin stays inside its corner outline at any size", () => {
    for (const [w, d, h] of STRANGE) {
      const s = size(w, d, h);
      expectInsideShape("cornerBasin", s);
      const parts = partsOf("cornerBasin", s);
      const body = parts.find((p) => p.shape === "outline");
      expect(body?.slot, s.label).toBe("ceramic");
      expect(panelsOf(body).filter(isUp), s.label).toHaveLength(1);
      expect(parts.filter((p) => p.shape === "box" && p.slot === "ceramic"), `${s.label}: no rim strips, a strip's box would cover the piece`).toEqual([]);
      expect(topOf(metal(parts)), s.label).toBe(h);
      expect(parts.some((p) => rangeOf(p)[0] === 0 && p.slot === "ceramic" && p.shape !== "outline"), `${s.label}: a pedestal`).toBe(true);
    }
  });

  it("has its tap in the back corner", () => {
    const [w, d] = [0.45, 0.45];
    const neck = metal(partsOf("cornerBasin", size(w, d, 1.05))).find((p) => p.shape === "cylinder");
    expect(neck?.shape === "cylinder" && (neck.at.x0 + neck.at.x1) / 2).toBeLessThan(-w / 2 + 0.25 * w);
    expect(neck?.shape === "cylinder" && (neck.at.y0 + neck.at.y1) / 2).toBeGreaterThan(d / 2 - 0.25 * d);
  });
});

describe("the bidet", () => {
  it("a bidet has no cistern: every part under its bowl's height but the tap, which reaches exactly h", () => {
    for (const s of [size(0.4, 0.55, 0.55), size(0.1, 0.1, 0.01), size(0.6, 10, 3), size(10, 0.2, 0.3)]) {
      const parts = partsOf("bidet", s);
      const bowl = parts.find((p) => p.shape === "outline"); // on the drawn pan (symbols.05)
      const bowlTop = bowl ? rangeOf(bowl)[1] : NaN;
      const foot = parts.find((p) => p.shape === "cylinder" && p.at.z0 === 0);
      expect(foot?.shape === "cylinder" && foot.at.x1 - foot.at.x0, `${s.label}: a narrower foot, or it reads as a drum`).toBeLessThan(s.w);
      expect(foot?.shape === "cylinder" && foot.at.z1, s.label).toBeCloseTo(bowl?.shape === "outline" ? bowl.z0 : NaN, 9);
      const tap = metal(parts);
      expect(tap.length, s.label).toBeGreaterThan(0);
      expect(topOf(tap), s.label).toBe(s.h);
      for (const p of parts) {
        if (p.slot === "metal") expect(rangeOf(p)[0], `${s.label}: the tap stands on the bowl`).toBeGreaterThanOrEqual(bowlTop);
        else expect(rangeOf(p)[1], s.label).toBeLessThanOrEqual(bowlTop);
      }
    }
  });
});

describe("the corner shower", () => {
  const convex = (ring: readonly { x: number; y: number }[]) => {
    const turns = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length] ?? a;
      const c = ring[(i + 2) % ring.length] ?? a;
      return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    });
    return turns.every((t) => t >= -1e-12) || turns.every((t) => t <= 1e-12);
  };

  it("a corner shower's tray is the quarter outline, and its frame stays inside it at any size", () => {
    const presets = namedSizes(kind("cornerShower")).map((s) => [s.w, s.d, s.h] as const);
    for (const [w, d, h] of [...STRANGE, ...presets]) {
      const s = size(w, d, h);
      expectInsideShape("cornerShower", s);
      const parts = partsOf("cornerShower", s);
      const tray = parts.filter((p) => p.shape === "outline");
      expect(tray, s.label).toHaveLength(1);
      expect(tray[0]?.slot, s.label).toBe("ceramic");
      expect(tray[0] && rangeOf(tray[0])[0], s.label).toBe(0);
      expect(parts.filter((p) => p.slot !== "metal").length, `${s.label}: nothing but the tray and metal, no glass`).toBe(1);
      const frame = parts.filter((p) => p.shape === "ring");
      expect(frame.length, s.label).toBeGreaterThan(0);
      for (const p of frame) if (p.shape === "ring") expect(convex(p.ring), `${s.label}: a part is convex`).toBe(true);
      expect(topOf(frame), `${s.label}: the frame's bar runs along the top`).toBeCloseTo(h, 9);
    }
  });

  it("the frame's bars follow the whole curve, with posts at both ends, and riser and head stand at the back", () => {
    const [w, d, h] = [0.8, 0.8, 2];
    const parts = partsOf("cornerShower", size(w, d, h));
    const rings = parts.flatMap((p) => (p.shape === "ring" ? [p] : []));
    const bars = rings.filter((p) => near(p.z1, h));
    const posts = rings.filter((p) => !near(p.z1, h));
    expect(bars).toHaveLength(8);
    const touches = (ring: readonly { x: number; y: number }[], x: number, y: number) => ring.some((q) => near(q.x, x) && near(q.y, y));
    expect(bars.some((b) => touches(b.ring, -w / 2, -d / 2)), "the bars start at the front-left corner").toBe(true);
    expect(bars.some((b) => touches(b.ring, w / 2, d / 2)), "and end at the back-right corner").toBe(true);
    expect(posts.some((b) => touches(b.ring, -w / 2, -d / 2)), "a post there").toBe(true);
    expect(posts.some((b) => touches(b.ring, w / 2, d / 2)), "and there").toBe(true);
    const riser = parts.find((p) => p.shape === "cylinder" && p.slot === "metal");
    const head = parts.find((p) => p.shape === "box" && p.slot === "metal" && near(p.at.z1, h));
    expect(riser?.shape === "cylinder" && riser.at.y1).toBeCloseTo(d / 2, 9);
    expect(head?.shape === "box" && head.at.y1).toBeCloseTo(d / 2, 9);
  });
});

