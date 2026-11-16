import { describe, expect, it } from "vitest";
import { MURPHY_MATTRESS_INSET, clampInsets } from "@fm/domain";
import { bedPillows, sofaArm, sofaSeats } from "../../src/view/piece-counts";
import type { Box3, Part } from "../../src/view3d/parts/types";
import { partsOf, type Size } from "./parts-fixtures";

// Each kind's parts, by example (parts AC-02, AC-04): fixed parts keep their size, counts follow the plan's.

const size = (config: string, w: number, d: number, h: number): Size => ({ config, w, d, h, label: `${w}×${d}×${h}` });
const boxes = (parts: readonly Part[], slot?: Part["slot"]): Box3[] =>
  parts.flatMap((p) => (p.shape === "outline" || p.shape === "ring" || (slot && p.slot !== slot) ? [] : [p.at]));
const width = (b: Box3) => b.x1 - b.x0;
const depth = (b: Box3) => b.y1 - b.y0;

describe("sofa", () => {
  it("arms and legs keep their size, and the cushions follow the plan's seats (AC-02)", () => {
    const at = (w: number) => partsOf("sofa", size("standard", w, 0.9, 0.9));
    for (const [w, seats] of [[1.8, 2], [2.8, 4]] as const) {
      const parts = at(w);
      const arms = parts.filter((p) => p.shape === "box" && p.at.z1 > 0.5 && (p.at.x0 <= -w / 2 + 1e-9 || p.at.x1 >= w / 2 - 1e-9));
      expect(arms).toHaveLength(2);
      for (const a of arms) if (a.shape === "box") expect(width(a.at)).toBeCloseTo(sofaArm(w), 6);
      const cushions = parts.filter((p) => p.shape === "box" && p.slot === "fabric" && p.at.z0 > 0.2 && p.at.z1 < 0.6 && p.at.y1 < 0.9 / 2 - 0.1);
      expect(cushions, `${w}`).toHaveLength(seats);
      expect(cushions, `${w}`).toHaveLength(sofaSeats(w));
    }
    const legs = (w: number) => boxes(at(w), "dark").filter((b) => b.z0 === 0).map((b) => [width(b), depth(b), b.z1].map((v) => v.toFixed(6)).join());
    expect(new Set([...legs(1.8), ...legs(2.8)]).size).toBe(1);
  });
});

describe("bed", () => {
  it("draws as many pillows as the plan", () => {
    for (const w of [1.2, 1.6]) {
      const pillows = partsOf("bed", size("standard", w, 2.1, 1)).filter((p) => p.shape === "box" && p.slot === "linen" && depth(p.at) < 0.6);
      expect(pillows).toHaveLength(bedPillows(w));
    }
  });

  it("the lift bed draws the bed's frame, mattress and pillows up and down, and no legs", () => {
    for (const config of ["up", "down"]) {
      const parts = partsOf("liftBed", size(config, 1.6, 2.1, 0.35));
      expect(parts.some((p) => p.slot === "linen")).toBe(true);
      expect(parts.some((p) => p.slot === "wood")).toBe(true);
      expect(boxes(parts, "dark")).toEqual([]);
    }
  });
});

describe("extending table", () => {
  it("has a top as deep as its box in both configurations, and the leaf shows extended", () => {
    for (const [config, d] of [["closed", 1.2], ["extended", 1.66]] as const) {
      const parts = partsOf("extendingTable", size(config, 0.8, d, 0.75));
      const top = parts.find((p) => p.shape === "box" && p.at.z1 === 0.75);
      expect(top?.shape === "box" && depth(top.at)).toBeCloseTo(d, 6);
      expect(top?.panels?.length ?? 0).toBe(config === "extended" ? 1 : 0);
    }
  });
});

describe("kitchen run", () => {
  const worktop = (kindId: string) => partsOf(kindId, size("standard", 0.6, 0.6, 0.9)).find((p) => p.slot === "wood");
  it("counter, hob and sink share the worktop and the plinth", () => {
    const tops = ["counter", "hobUnit", "sinkUnit"].map(worktop);
    for (const t of tops) expect(t?.shape === "box" && [t.at.z0, t.at.z1]).toEqual(tops[0]?.shape === "box" && [tops[0].at.z0, tops[0].at.z1]);
    const plinths = ["counter", "hobUnit", "sinkUnit"].map((k) => boxes(partsOf(k, size("standard", 0.6, 0.6, 0.9)), "dark").find((b) => b.z0 === 0));
    for (const p of plinths) expect(p).toEqual(plinths[0]);
  });

  it("the hob shows its rings and the sink its bowl on top", () => {
    const tops = (kindId: string) => partsOf(kindId, size("standard", 0.6, 0.6, 0.9)).flatMap((p) => (p.panels ?? []).filter((q) => q.normal === "+z"));
    expect(tops("hobUnit").length).toBeGreaterThanOrEqual(2);
    expect(tops("sinkUnit").some((q) => q.slot === "metal")).toBe(true);
    expect(tops("counter")).toEqual([]);
  });
});

describe("the rest of the sleep group", () => {
  it("a mattress is a mattress and its pillows: no legs, no frame", () => {
    const parts = partsOf("mattress", size("standard", 1.6, 2, 0.25));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.slot === "linen")).toBe(true);
    expect(parts.filter((p) => p.shape === "box" && depth(p.at) < 0.6)).toHaveLength(bedPillows(1.6));
  });

  it("the loft bed floats with a rail on its open long side (parts.13)", () => {
    const parts = partsOf("loftBed", size("standard", 1, 2.1, 0.35));
    expect(boxes(parts, "dark")).toEqual([]);
    const rail = boxes(parts, "wood").find((b) => width(b) < 0.1 && depth(b) > 2);
    expect(rail?.x1).toBeCloseTo(0.5, 6);
    expect(rail?.z1).toBeCloseTo(0.35, 6);
  });

  it("a closed Murphy bed draws no linen; an open one draws linen in front of the cabinet on two front legs (AC-04)", () => {
    expect(partsOf("murphyBed", size("folded", 1.6, 0.4, 2.24)).some((p) => p.slot === "linen")).toBe(false);
    const open = partsOf("murphyBed", size("down", 1.6, 2.1, 2.24));
    const cabinet = boxes(open, "laminate").find((b) => b.z1 === 2.24);
    const linen = boxes(open, "linen");
    expect(cabinet).toBeDefined();
    expect(linen.length).toBeGreaterThan(0);
    for (const b of linen) expect(b.y1).toBeLessThanOrEqual((cabinet?.y0 ?? 0) + 1e-9);
    const legs = boxes(open, "dark").filter((b) => b.z0 === 0 && width(b) < 0.2); // the plinth under the cabinet is dark too
    expect(legs).toHaveLength(2);
    for (const l of legs) expect(l.y0).toBeCloseTo(-1.05, 6);
  });

  it("a sofa bed shows the sofa's cushions, or a mattress across its open depth (AC-04)", () => {
    const sofa = partsOf("sofaBed", size("sofa", 2.1, 0.9, 0.9));
    expect(sofa.filter((p) => p.shape === "box" && p.slot === "fabric" && p.at.z0 > 0.2 && p.at.z1 < 0.6 && p.at.y1 < 0.35)).toHaveLength(sofaSeats(2.1));
    const bed = partsOf("sofaBed", size("bed", 2.1, 1.6, 0.9));
    const mattress = boxes(bed, "linen").find((b) => depth(b) > 1);
    expect(mattress?.y0).toBeCloseTo(-0.8, 6);
  });
});

describe("the rest of sit and eat", () => {
  it("a round table's top is its own outline and its pedestal a cylinder inside it", () => {
    const parts = partsOf("roundTable", size("standard", 0.9, 0.9, 0.75));
    const top = parts.find((p) => p.shape === "outline");
    expect(top?.shape === "outline" && top.z1).toBe(0.75);
    const pedestal = parts.find((p) => p.shape === "cylinder" && p.at.z1 > 0.5);
    expect(pedestal?.shape === "cylinder" && width(pedestal.at)).toBeLessThan(0.3);
  });

  it("a folding table folded is a batten and a hanging leaf within its depth; open, a top on a batten and two front legs (AC-04)", () => {
    const folded = partsOf("foldingTable", size("folded", 1.2, 0.15, 0.75));
    expect(folded.length).toBeGreaterThan(0);
    expect(folded.every((p) => p.shape === "box" && p.at.y0 >= -0.075 - 1e-9 && p.at.y1 <= 0.075 + 1e-9)).toBe(true);
    const leaf = boxes(folded, "wood").find((b) => b.z0 === 0 && depth(b) < 0.05);
    expect(leaf?.z1).toBeCloseTo(0.75, 6);
    const open = partsOf("foldingTable", size("open", 1.2, 0.8, 0.75));
    const top = boxes(open, "wood").find((b) => b.z1 === 0.75);
    expect(top && depth(top)).toBeCloseTo(0.8, 6);
    expect(boxes(open, "dark").filter((b) => b.z0 === 0)).toHaveLength(2);
  });

  it("a coffee table has a top, four legs and a shelf between them", () => {
    const parts = partsOf("coffeeTable", size("standard", 1, 0.5, 0.45));
    expect(boxes(parts, "wood").filter((b) => b.z0 === 0)).toHaveLength(4);
    expect(boxes(parts, "wood").filter((b) => b.z0 > 0 && b.z1 < 0.4 && width(b) > 0.5)).toHaveLength(1);
  });

  it("a chair has four legs, a seat at about 0.45 m and a back at the rear up to its top", () => {
    const parts = boxes(partsOf("chair", size("standard", 0.45, 0.45, 0.9)));
    expect(parts.filter((b) => b.z0 === 0)).toHaveLength(4);
    const seat = parts.find((b) => b.z0 > 0.3 && b.z1 < 0.6 && depth(b) > 0.3);
    expect(seat?.z1).toBeGreaterThan(0.4);
    expect(seat?.z1).toBeLessThan(0.5);
    const back = parts.find((b) => b.z1 === 0.9);
    expect(back?.y1).toBeCloseTo(0.225, 6);
  });

  it("a desk's legs keep their size as it widens, and its top spans it", () => {
    const legs = (w: number) => boxes(partsOf("desk", size("standard", w, 0.6, 0.75))).filter((b) => b.z0 === 0).map((b) => [width(b), depth(b), b.z1].map((v) => v.toFixed(6)).join());
    expect(legs(1.2)).toHaveLength(4);
    expect(new Set([...legs(1.2), ...legs(2)]).size).toBe(1);
    const top = boxes(partsOf("desk", size("standard", 2, 0.6, 0.75))).find((b) => b.z1 === 0.75);
    expect(top && width(top)).toBeCloseTo(2, 6);
  });
});

describe("kitchen and storage", () => {
  const fronts = (parts: readonly Part[], slot: Part["slot"]) => boxes(parts, slot).filter((b) => Math.abs(b.y0 + 0.3) < 1e-9 && depth(b) < 0.05);

  it("a fridge has a body and two doors at the front, the freezer's below at about a third, with dark handles", () => {
    const parts = partsOf("fridge", size("standard", 0.6, 0.65, 1.9));
    const doors = boxes(parts, "metal").filter((b) => Math.abs(b.y0 + 0.325) < 1e-9 && depth(b) < 0.05).sort((a, b) => a.z0 - b.z0);
    expect(doors).toHaveLength(2);
    expect(doors[0]?.z1).toBeGreaterThan(0.5);
    expect(doors[0]?.z1).toBeLessThan(0.8);
    expect(parts.flatMap((p) => p.panels ?? []).filter((q) => q.slot === "dark")).toHaveLength(2);
  });

  it("a wardrobe's doors follow its width: one per 0.50 m, at least two, at most eight, on a dark plinth", () => {
    for (const [w, n] of [[0.6, 2], [1.2, 2], [2, 4], [10, 8]] as const) expect(fronts(partsOf("wardrobe", size("standard", w, 0.6, 2.05)), "wood"), `${w} m`).toHaveLength(n);
    expect(boxes(partsOf("wardrobe", size("standard", 1.2, 0.6, 2.05)), "dark").filter((b) => b.z0 === 0)).toHaveLength(1);
  });

  it("a shelf's shelves follow its height, open at the front", () => {
    const shelves = (h: number) => boxes(partsOf("shelf", size("standard", 0.8, 0.4, h)), "wood").filter((b) => width(b) < 0.8 - 1e-9 && width(b) > 0.5 && depth(b) > 0.3); // not the sides
    expect(shelves(1.5)).toHaveLength(5); // the top board included
    expect(shelves(0.7)).toHaveLength(3);
    expect(shelves(9)).toHaveLength(9);
  });

  it("a wall cabinet is laminate only, its doors counted like a counter's, no plinth or worktop", () => {
    const parts = partsOf("wallCabinet", size("standard", 1.2, 0.35, 0.75));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.slot === "laminate")).toBe(true);
    expect(boxes(parts, "laminate").filter((b) => Math.abs(b.y0 + 0.175) < 1e-9 && depth(b) < 0.05)).toHaveLength(2);
  });
});

describe("bathroom", () => {
  it("a shower tray is a ceramic tray and a metal riser with its head at the back reaching the top (parts.14)", () => {
    const parts = partsOf("showerTray", size("standard", 0.8, 0.8, 2));
    const tray = boxes(parts, "ceramic")[0];
    expect(tray && [width(tray), depth(tray)]).toEqual([0.8, 0.8].map((v) => expect.closeTo(v, 6)));
    expect(tray?.z1).toBeLessThan(0.1);
    const fitting = boxes(parts, "metal").filter((b) => Math.abs(b.x0 + b.x1) < 1e-9 && width(b) < 0.7); // centred: riser, head
    expect(fitting).toHaveLength(2);
    expect(Math.max(...fitting.map((b) => b.z1))).toBeCloseTo(2, 6);
    for (const b of fitting) expect(b.y1).toBeCloseTo(0.4, 6);
  });

  it("a shower tray has a screen frame on its open sides, posts and top bars with no pane (hands-on, 2026-10-26)", () => {
    const parts = partsOf("showerTray", size("standard", 0.8, 0.8, 2));
    const frame = boxes(parts, "metal").filter((b) => Math.abs(b.x0 + b.x1) > 1e-9 || width(b) > 0.7); // off-centre, or across
    const posts = frame.filter((b) => b.z1 - b.z0 > 1);
    expect(posts).toHaveLength(2); // the front corners; the back stands against the wall with the riser
    for (const p of posts) {
      expect(p.y0).toBeCloseTo(-0.4, 6);
      expect(p.z0).toBeLessThan(0.1);
    }
    const bars = frame.filter((b) => b.z1 - b.z0 < 0.1);
    expect(bars).toHaveLength(3);
    for (const b of bars) expect(b.z1).toBeCloseTo(2, 6);
    expect(bars.filter((b) => width(b) > 0.7 && b.y0 < -0.39)).toHaveLength(1); // front
    expect(bars.filter((b) => depth(b) > 0.7)).toHaveLength(2); // left and right, back to the wall
    for (const b of frame) expect(Math.min(width(b), depth(b))).toBeLessThan(0.05); // thin: the tray stays in view
  });

  it("a toilet from 0.60 m deep has a cistern at the back reaching its top, and a bowl in front with a seat on it, both on its pan", () => {
    const rings = partsOf("toilet", size("standard", 0.4, 0.65, 0.9)).flatMap((p) => (p.shape === "ring" ? [p] : []));
    expect(rings).toHaveLength(2);
    const cistern = rings.find((p) => p.z1 === 0.9);
    const bowl = rings.find((p) => p.z1 < 0.9);
    expect(Math.max(...(cistern?.ring ?? []).map((p) => p.y))).toBeCloseTo(0.325, 6);
    expect(Math.max(...(bowl?.ring ?? []).map((p) => p.y))).toBeCloseTo(Math.min(...(cistern?.ring ?? []).map((p) => p.y)), 6);
    expect(bowl?.panels?.some((q) => q.normal === "+z")).toBe(true);
  });

  it("a wall-hung toilet has no cistern: a bowl and a rim on its pan, with a seat on top", () => {
    const parts = partsOf("toilet", size("standard", 0.36, 0.54, 0.42));
    expect(parts.map((p) => p.shape)).toEqual(["outline", "outline"]);
    expect(parts[1]?.panels?.some((q) => q.normal === "+z" && q.slot === "laminate")).toBe(true);
  });

  it("a bathtub is a rim around a lower floor, so it reads hollow", () => {
    const parts = boxes(partsOf("bathtub", size("standard", 1.7, 0.7, 0.75)), "ceramic");
    expect(parts.filter((b) => b.z1 === 0.75)).toHaveLength(4);
    const floor = parts.find((b) => b.z1 < 0.5);
    expect(floor && width(floor)).toBeLessThan(1.7);
  });

  it("a washing machine's parts carry its controls; its round door is faces of its own (washer-faces.test.ts)", () => {
    const parts = partsOf("washingMachine", size("standard", 0.6, 0.6, 0.85));
    const controls = parts.flatMap((p) => p.panels ?? []).filter((q) => q.normal === "-y");
    expect(controls.map((q) => q.slot)).toEqual(["plain", "metal", "dark"]); // drawer, dial, display
  });
});

describe("the plan and the 3D view agree (gate M2 review)", () => {
  it("a loft bed draws as many pillows as its plan symbol, counted on its full width", () => {
    for (const w of [1.2, 1.3, 1.33, 1.6]) {
      const pillows = partsOf("loftBed", size("standard", w, 2.1, 0.35)).filter((p) => p.shape === "box" && p.slot === "linen" && depth(p.at) < 0.6);
      expect(pillows, `${w} m`).toHaveLength(bedPillows(w));
    }
  });

  it("an open Murphy bed's mattress is inset as the plan's, by the domain's MURPHY_MATTRESS_INSET at each end", () => {
    for (const w of [1.0, 1.6]) {
      const [s] = clampInsets(w, MURPHY_MATTRESS_INSET, MURPHY_MATTRESS_INSET);
      const mattress = boxes(partsOf("murphyBed", size("down", w, 2.1, 2.24)), "linen").find((b) => depth(b) > 1);
      expect(mattress && width(mattress), `${w} m`).toBeCloseTo(w - 2 * s, 6);
    }
  });
});
