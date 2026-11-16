import { isFurnitureSet } from "../src/furniture-sets";
import { describe, expect, it } from "vitest";
import { MAX_OBJECT_SIZE, MIN_OBJECT_SIZE, OBJECT_KINDS, footprintOf, outlineOf, pieceShape, shapeRing, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { bedPillows, furnitureSymbol, objectLook, placeSymbol, sofaSeats } from "../src/view/furniture";
import { PALETTE } from "../src/view/palette";
import type { Primitive } from "../src/view/scene-types";
import { withCommands, roomDoc } from "./builders";
import { insideRing, reach } from "./object-look-helpers";

const TOL = 0.001; // 1 mm

const configs = OBJECT_KINDS.flatMap((k) => k.configs.map((c) => ({ kind: k.id, config: c.id, w: c.w, d: c.d })));
const clamp = (v: number) => Math.min(MAX_OBJECT_SIZE, Math.max(MIN_OBJECT_SIZE, v));
const sizes = (w: number, d: number): [number, number][] => [
  [w, d], [clamp(w * 2), clamp(d * 0.5)], [clamp(w * 0.4), clamp(d * 3)], [MIN_OBJECT_SIZE, MIN_OBJECT_SIZE], [MAX_OBJECT_SIZE, MIN_OBJECT_SIZE],
];

/** Signed distance from p to the inside of a convex counter-clockwise polygon (positive inside). */
function insideBy(p: Point, quad: readonly Point[]): number {
  let min = Infinity;
  quad.forEach((a, i) => {
    const b = quad[(i + 1) % quad.length];
    if (!b) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    min = Math.min(min, ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len);
  });
  return min;
}

describe("furniture symbols (AC-07)", () => {
  it("every kind and configuration in OBJECT_KINDS gives a non-empty symbol with every point inside its footprint (1 mm), at default and resized sizes", () => {
    for (const { kind, config, w, d } of configs) {
      // A winder stair is deeper than wide by 0.05 at least (I19, steps.09): no other size exists.
      for (const [sw, sd] of sizes(w, d).filter(([a, b]) => kind !== "winderStair" || b >= a + 0.05)) {
        const symbol = furnitureSymbol(kind, config, sw, sd);
        expect(symbol.length, `${kind}.${config}`).toBeGreaterThan(0);
        for (const q of symbol.flatMap(reach)) {
          const where = `${kind}.${config} ${sw}×${sd} at (${q.x}, ${q.y})`;
          expect(Number.isFinite(q.x) && Number.isFinite(q.y), where).toBe(true);
          expect(q.x >= -sw / 2 - TOL && q.x <= sw / 2 + TOL && q.y >= -sd - TOL && q.y <= TOL, where).toBe(true);
        }
      }
    }
  });

  it("placed at 0°, 30° and 90°, every symbol point lies inside the placement's footprint quad", () => {
    for (const { kind, config, w, d } of configs) {
      for (const rotation of [0, 30, 90]) {
        const doc: Document = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "o", state: "s0", object: { kind }, at: { x: 3, y: 3.5 }, config }); // back edge high enough for a 2.99 m stair
        const p = doc.placements["o/p0"];
        if (!p) throw new Error(`no placement for ${kind}.${config}`);
        const placement = { ...p, rotation };
        const quad = footprintOf(doc, placement);
        if (!quad) throw new Error("no footprint");
        const placed = placeSymbol(furnitureSymbol(kind, config, w, d), placement.at, rotation);
        expect(placed.length).toBeGreaterThan(0);
        for (const prim of placed) {
          for (const q of reach(prim)) expect(insideBy(q, quad), `${kind}.${config} at ${rotation}°`).toBeGreaterThanOrEqual(-TOL);
        }
      }
    }
  });

  it("the murphy bed's folded and down symbols differ; the folding table's open symbol has a hinge line and the folded one does not", () => {
    expect(furnitureSymbol("murphyBed", "folded", 1.6, 2.1)).not.toEqual(furnitureSymbol("murphyBed", "down", 1.6, 2.1));
    // A line across the table, parallel to the back edge, strictly between the back and the front.
    const hinges = (symbol: readonly Primitive[], d: number) =>
      symbol.filter((p) => p.kind === "segment" && Math.abs(p.a.y - p.b.y) < 1e-9 && p.a.y < -1e-6 && p.a.y > -d + 1e-6);
    expect(hinges(furnitureSymbol("foldingTable", "open", 1.2, 0.8), 0.8)).toHaveLength(1);
    expect(hinges(furnitureSymbol("foldingTable", "folded", 1.2, 0.15), 0.15)).toHaveLength(0);
  });

  it("placeSymbol turns a polygon's holes with its points", () => {
    const ring = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    const [placed] = placeSymbol([{ kind: "polygon", points: ring, holes: [[{ x: 1, y: 0 }, { x: 0, y: 0.5 }, { x: 0.5, y: 0 }]], color: "#000000" }], { x: 2, y: 1 }, 90);
    if (placed?.kind !== "polygon") throw new Error("not a polygon");
    const outer = placed.points[0];
    const hole = placed.holes[0]?.[0];
    for (const q of [outer, hole]) {
      expect(q?.x).toBeCloseTo(2, 9);
      expect(q?.y).toBeCloseTo(2, 9);
    }
  });
});


// The segments of a symbol, with their ends sorted so that a.y <= b.y.
const segments = (symbol: readonly Primitive[]) =>
  symbol.flatMap((p) => (p.kind === "segment" ? [p.a.y <= p.b.y ? { a: p.a, b: p.b } : { a: p.b, b: p.a }] : []));
const near = (u: number, v: number) => Math.abs(u - v) < 1e-9;

describe("the new kinds' symbols (smart.15, AC-09)", () => {
  it("sofa seats follow one rule (smart.15, seating.03, AC-09)", () => {
    expect([1.5, 2, 2.1, 2.7, 0.1].map(sofaSeats)).toEqual([2, 2, 3, 3, 1]);
    // Half seats round up, whatever the float noise: 2.05 typed or computed, 2.75, and 9.75.
    expect([2.05, 2.05 + 1.98 - 1.98, 2.75, 9.75].map(sofaSeats)).toEqual([3, 3, 4, 14]);
  });

  it("a sofa draws a cushion per seat: 3 at \"4 seats\" 2.70 × 0.90, 2 at 1.50 × 0.90, and a stored 2.00 × 0.90 sofa bed 2 (AC-09, seating.03)", () => {
    // Each cushion is a rounded rectangle, four arcs; nothing else in a sofa draws an arc.
    const cushions = (kind: string, config: string, w: number, d: number) =>
      furnitureSymbol(kind, config, w, d).filter((p) => p.kind === "arc").length / 4;
    for (const [kind, config] of [["sofa", "standard"], ["sofaBed", "sofa"]] as const) {
      expect(cushions(kind, config, 2.7, 0.9), `${kind} 2.70`).toBe(3);
      expect(cushions(kind, config, 1.5, 0.9), `${kind} 1.50`).toBe(2);
      expect(cushions(kind, config, 2, 0.9), `${kind} 2.00`).toBe(2);
    }
  });

  it("the extending table draws one seam closed and two extended; a chest of drawers does not look like a wardrobe", () => {
    // A seam: a line across the inset top's full width, strictly between the back and the front.
    const seams = (config: string, w: number, d: number) => {
      const i = Math.min(w, d) * 0.06;
      return segments(furnitureSymbol("extendingTable", config, w, d)).filter((s) =>
        near(s.a.y, s.b.y) && s.a.y < -1e-6 && s.a.y > -d + 1e-6 && near(Math.min(s.a.x, s.b.x), -w / 2 + i) && near(Math.max(s.a.x, s.b.x), w / 2 - i));
    };
    expect(seams("closed", 0.8, 1.2).map((s) => s.a.y)).toEqual([expect.closeTo(-0.6, 9)]);
    const leaf = 0.14 * 1.66;
    expect(seams("extended", 0.8, 1.66).map((s) => s.a.y).sort((u, v) => u - v))
      .toEqual([expect.closeTo(-0.83 - leaf, 9), expect.closeTo(-0.83 + leaf, 9)]);

    expect(furnitureSymbol("drawers", "standard", 1.2, 0.6)).not.toEqual(furnitureSymbol("wardrobe", "standard", 1.2, 0.6));
    const chest = segments(furnitureSymbol("drawers", "standard", 1, 0.5));
    expect(chest.filter((s) => near(s.a.y, s.b.y) && near(s.a.y, -0.93 * 0.5)), "pull ticks").toHaveLength(2);
    expect(chest.filter((s) => near(s.a.x, s.b.x) && near(s.a.y, -0.5) && near(s.b.y, -0.86 * 0.5)), "dividers").toHaveLength(1);
    expect(chest.filter((s) => near(s.a.y, s.b.y) && near(s.a.y, -0.86 * 0.5) && near(Math.abs(s.b.x - s.a.x), 1)), "strip").toHaveLength(1);
    const wardrobe = segments(furnitureSymbol("wardrobe", "standard", 1.2, 0.6));
    expect(wardrobe.filter((s) => near(s.a.y, s.b.y) && near(s.a.y, -0.9 * 0.6) && near(Math.abs(s.b.x - s.a.x), 1.2)), "door line").toHaveLength(1);
    // Straight hangers across the rail at −0.45·d (seating.04), inside the outline's sides.
    const hangers = wardrobe.filter((s) =>
      near(s.a.x, s.b.x) && Math.abs(s.a.x) < 0.6 - 1e-6 && Math.min(s.a.y, s.b.y) < -0.27 && Math.max(s.a.y, s.b.y) > -0.27);
    expect(hangers).toHaveLength(12);
  });
});

describe("built-in units' symbols (smart.02, .04)", () => {
  const units = ["builtInTable", "builtInDesk", "murphyBed"];
  // A horizontal segment across the full width at y.
  const across = (symbol: readonly Primitive[], w: number, y: number) =>
    symbol.filter((p) => p.kind === "segment" && near(p.a.y, y) && near(p.b.y, y) && near(Math.abs(p.b.x - p.a.x), w));

  it("built-in units draw the same cabinet closed and their own content open", () => {
    const [table, desk, bed] = units.map((k) => furnitureSymbol(k, "folded", 2.4, 0.35));
    expect(desk).toEqual(table);
    expect(bed).toEqual(table);
    const open = units.map((k) => furnitureSymbol(k, "down", 2.4, 1.15));
    for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) expect(open[i], `${units[i]} vs ${units[j]}`).not.toEqual(open[j]);
    // The cabinet front at the kind's default closed depth.
    expect(across(furnitureSymbol("builtInTable", "down", 2.4, 1.15), 2.4, -0.35), "table").toHaveLength(1);
    expect(across(furnitureSymbol("builtInDesk", "down", 2.4, 1.15), 2.4, -0.35), "desk").toHaveLength(1);
    expect(across(furnitureSymbol("murphyBed", "down", 2.4, 1.15), 2.4, -0.4), "bed").toHaveLength(1);
  });

  it("an open unit's content sits in front of the cabinet band", () => {
    // The open built-in desk's content is the plain desk, which draws nothing (seating.04): only the band.
    for (const [kind, cd] of [["builtInTable", 0.35], ["murphyBed", 0.4]] as const) {
      // Past the outline rectangle (the first four), less the band's two full-width lines.
      const band = (p: Primitive) => p.kind === "segment" && near(p.a.y, p.b.y) && (near(p.a.y, -cd) || near(p.a.y, -cd / 2)) && near(Math.abs(p.b.x - p.a.x), 2.4);
      const content = furnitureSymbol(kind, "down", 2.4, 1.15).slice(4).filter((p) => !band(p));
      expect(content.length, kind).toBeGreaterThan(0);
      const ys = content.flatMap((p) => (p.kind === "segment" ? [p.a.y, p.b.y] : p.kind === "arc" ? [p.center.y] : []));
      expect(ys.length, kind).toBe(content.length * 2 - content.filter((p) => p.kind === "arc").length);
      for (const y of ys) expect(y, kind).toBeLessThanOrEqual(-cd + 1e-9);
    }
  });

  it("the cabinet front takes the outline colour and width, the band's middle line the detail colour", () => {
    const look = { line: "#111111", frontPx: 2, linePx: 1, detail: "#999999", detailPx: 0.5 };
    const colours = (symbol: readonly Primitive[], y: number) =>
      across(symbol, 2.4, y).map((p) => (p.kind === "segment" && "px" in p.width ? [p.color, p.width.px] : null));
    for (const kind of units) {
      const closed = objectLook(kind, "folded", 2.4, 0.35, look);
      expect(colours(closed, -0.82 * 0.35), `${kind} closed front`).toEqual([["#111111", 1]]);
      expect(colours(closed, -0.41 * 0.35), `${kind} closed middle`).toEqual([["#999999", 0.5]]);
    }
    expect(colours(objectLook("builtInTable", "down", 2.4, 1.15, look), -0.35)).toEqual([["#111111", 1]]);
    expect(colours(objectLook("builtInDesk", "down", 2.4, 1.15, look), -0.35)).toEqual([["#111111", 1]]);
    expect(colours(objectLook("murphyBed", "down", 2.4, 1.15, look), -0.4)).toEqual([["#111111", 1]]);
    // Selected, ghost and refused pieces (no detail colour) stay one colour.
    const one = objectLook("murphyBed", "down", 2.4, 1.15, { line: "#2563eb", frontPx: 2, linePx: 1 });
    expect(new Set(one.map((p) => p.color))).toEqual(new Set(["#2563eb"]));
  });
});

describe("the open Murphy bed's mattress (furnish.20, AC-20)", () => {
  // The two mattress side lines: vertical segments from the cabinet front (cd = 0.4) to the foot.
  const sideLines = (symbol: readonly Primitive[], x: number, d: number) =>
    symbol.filter((p) => p.kind === "segment" && near(p.a.x, x) && near(p.b.x, x) && near(Math.min(p.a.y, p.b.y), -d) && near(Math.max(p.a.y, p.b.y), -0.4));

  it("the open Murphy bed's mattress is inset 0.10 m at each end", () => {
    for (const [w, x] of [[1.6, 0.7], [1, 0.4], [0.25, 0.05]] as const) {
      const symbol = furnitureSymbol("murphyBed", "down", w, 2.1);
      expect(sideLines(symbol, -x, 2.1), `${w} left`).toHaveLength(1);
      expect(sideLines(symbol, x, 2.1), `${w} right`).toHaveLength(1);
    }
    // Past the outline rectangle, less the cabinet band's two full-width lines, nothing reaches past the mattress.
    const band = (p: Primitive) => p.kind === "segment" && near(p.a.y, p.b.y) && (near(p.a.y, -0.4) || near(p.a.y, -0.2)) && near(Math.abs(p.b.x - p.a.x), 1.6);
    const content = furnitureSymbol("murphyBed", "down", 1.6, 2.1).slice(4).filter((p) => !band(p));
    expect(content.length).toBeGreaterThan(2);
    for (const p of content) for (const q of reach(p)) expect(Math.abs(q.x)).toBeLessThanOrEqual(0.7 + 1e-9);
  });
});

describe("bed pillows (furnish.06, AC-08)", () => {
  it("bedPillows compares the width at the centimetre shown (furnish.06, AC-08)", () => {
    // 1.2996 shows as 1.30, so two pillows (not w < 1.3); 1.20 keeps one (not the rejected 1.20 m threshold).
    expect([0.85, 1.0, 1.2, 1.29, 1.2949, 1.2996, 1.3, 1.6, 2.1].map(bedPillows)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2]);
    // 1.295 shows as 1.30 since halves round away from zero (cleanup.13; toFixed read the stored 1.29499… as 1.29).
    expect(bedPillows(1.295)).toBe(2);
  });

  it("a bed draws one centred pillow below 1.30 m and two from 1.30 m: bed, open Murphy bed, sofa bed's bed (AC-08)", () => {
    // The only arcs in these symbols are the pillows' rounded corners, four per pillow.
    const cases: [string, string, number, number, number][] = [
      ["bed", "standard", 1.29, 2.0, 4], ["bed", "standard", 1.2996, 2.0, 8], ["bed", "standard", 1.3, 2.0, 8],
      ["bed", "standard", 1.0, 2.0, 4], ["bed", "standard", 1.6, 2.0, 8],
      ["murphyBed", "down", 1.0, 2.1, 4], ["murphyBed", "down", 1.29, 2.1, 4], ["murphyBed", "down", 1.3, 2.1, 8], ["murphyBed", "down", 1.6, 2.1, 8],
      ["sofaBed", "bed", 1.29, 1.6, 4], ["sofaBed", "bed", 1.5, 1.6, 8], ["sofaBed", "bed", 2.1, 1.6, 8],
    ];
    for (const [kind, config, w, d, arcs] of cases) {
      const label = `${kind} ${config} ${w}`;
      const xs = furnitureSymbol(kind, config, w, d).flatMap((p) => (p.kind === "arc" ? [p.center.x] : []));
      expect(xs, label).toHaveLength(arcs);
      if (arcs === 4) {
        for (const x of xs) expect(Math.abs(x), label).toBeLessThanOrEqual(0.3 * w + 1e-9);
        expect(Math.min(...xs), label).toBeLessThan(0);
        expect(Math.max(...xs), label).toBeGreaterThan(0);
        expect(Math.abs(Math.min(...xs) + Math.max(...xs)), label).toBeLessThan(1e-9);
      } else {
        expect(xs.filter((x) => x < 0), label).toHaveLength(4);
        expect(xs.filter((x) => x > 0), label).toHaveLength(4);
      }
    }
  });
});

describe("the symbols split by palette group (step 11a)", () => {
  it("every kind's symbol survives the split", () => {
    // Frozen before the split, per kind and configuration at its default size: the primitive count and the sum of
    // every coordinate's size (|x| + |y| of segment ends; an arc's |centre|, radius and |angles|). A lost case draws
    // only the outline (4 primitives); a moved function with a changed body moves the sum. The seating cycle redrew the
    // sofa, bed (and the beds that draw it), desk, chair, wardrobe, drawers and shelf rows on purpose (seating.03, .04).
    const frozen: [string, number, number][] = [
      ["bed.standard", 22, 88.3859], ["builtInTable.folded", 6, 9.461], ["builtInTable.down", 15, 56.0507],
      ["builtInDesk.folded", 6, 8.261], ["builtInDesk.down", 6, 10.85], ["murphyBed.folded", 6, 12.184],
      ["murphyBed.down", 26, 107.2363], ["sofaBed.sofa", 31, 132.9382], ["sofaBed.bed", 22, 89.2959], ["sofa.standard", 31, 132.9382],
      ["foldingTable.folded", 4, 5.4], ["foldingTable.open", 5, 9.5], ["extendingTable.closed", 13, 46.3007],
      ["extendingTable.extended", 14, 53.7247], ["desk.standard", 4, 7.2], ["kitchenBlock.standard", 16, 82.4216],
      ["bathroomBlock.standard", 30, 65.88], ["wardrobe.standard", 19, 25.4262], ["drawers.standard", 12, 17.13],
      ["chair.standard", 16, 36.0927], ["shelf.standard", 49, 39.732], ["block.standard", 6, 7.2],
    ];
    const size = (p: Primitive): number => {
      if (p.kind === "segment") return Math.abs(p.a.x) + Math.abs(p.a.y) + Math.abs(p.b.x) + Math.abs(p.b.y);
      if (p.kind === "arc") return Math.abs(p.center.x) + Math.abs(p.center.y) + p.radius + Math.abs(p.from) + Math.abs(p.to);
      throw new Error(`a symbol draws lines and arcs only, not a ${p.kind}`);
    };
    // The kinds of this moment: later kinds add no rows, so each row is looked up rather than the whole list compared.
    for (const [key, count, sum] of frozen) {
      const row = configs.find(({ kind, config }) => `${kind}.${config}` === key);
      if (!row) throw new Error(`no configuration ${key}`);
      const symbol = furnitureSymbol(row.kind, row.config, row.w, row.d);
      expect(symbol.length, key).toBe(count);
      expect(symbol.reduce((t, p) => t + size(p), 0), key).toBeCloseTo(sum, 3);
    }
  });
});

describe("shaped symbols (furnish.12, .22, AC-13)", () => {
  const segs = (symbol: readonly Primitive[]) => symbol.flatMap((p) => (p.kind === "segment" ? [p] : []));
  const has = (symbol: readonly Primitive[], ax: number, ay: number, bx: number, by: number, tol = 1e-9) =>
    segs(symbol).some((s) => {
      const close = (u: { x: number; y: number }, x: number, y: number) => Math.abs(u.x - x) < tol && Math.abs(u.y - y) < tol;
      return (close(s.a, ax, ay) && close(s.b, bx, by)) || (close(s.a, bx, by) && close(s.b, ax, ay));
    });

  it("a shaped kind draws its shape, not the rectangle", () => {
    const round = furnitureSymbol("roundBlock", "standard", 0.6, 0.6);
    expect(segs(round).filter((s) => near(s.a.y, 0) && near(s.b.y, 0)), "back edge").toHaveLength(0);
    expect(segs(round).filter((s) => near(s.a.x, 0.3) && near(s.b.x, 0.3)), "right edge").toHaveLength(0);
    const ring = shapeRing("round", 0.6, 0.6);
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      expect(round[i], `ring edge ${i}`).toMatchObject({ kind: "segment", a, b });
    });
    const corner = furnitureSymbol("cornerBlock", "standard", 0.6, 0.6);
    expect(corner.slice(0, 3)).toMatchObject([
      { kind: "segment", a: { x: -0.3, y: 0 }, b: { x: -0.3, y: -0.6 } },
      { kind: "segment", a: { x: -0.3, y: -0.6 }, b: { x: 0.3, y: 0 } },
      { kind: "segment", a: { x: 0.3, y: 0 }, b: { x: -0.3, y: 0 } },
    ]);
    expect(has(corner, 0.3, 0, 0.3, -0.6), "right edge").toBe(false);
    expect(segs(corner).filter((s) => near(s.a.y, -0.6) && near(s.b.y, -0.6)), "front edge").toHaveLength(0);
  });

  it("basic blocks' details", () => {
    const round = furnitureSymbol("roundBlock", "standard", 0.6, 0.6);
    expect(has(round, 0.2121, -0.0879, -0.2121, -0.5121, 1e-4)).toBe(true);
    expect(has(round, -0.2121, -0.0879, 0.2121, -0.5121, 1e-4)).toBe(true);
    expect(has(furnitureSymbol("cornerBlock", "standard", 0.6, 0.6), -0.3, 0, 0, -0.3)).toBe(true);
    const block = furnitureSymbol("block", "standard", 0.6, 0.6);
    expect(has(block, -0.3, -0.6, 0.3, 0)).toBe(true);
    expect(has(block, -0.3, 0, 0.3, -0.6)).toBe(true);
  });

  it("every palette kind draws a detail beyond its outline (AC-13)", () => {
    // The plain desk is the exception: just its top (seating.04).
    for (const k of PALETTE.flatMap((g) => g.cards).filter((k) => k.kind !== "desk" && !isFurnitureSet(k.kind))) {
      expect(furnitureSymbol(k.kind, k.config, k.w, k.d).length, k.kind).toBeGreaterThan(shapeRing(outlineOf(k.kind), k.w, k.d).length);
    }
  });

  it("every shaped kind's details lie inside its shape, at default and resized sizes", () => {
    const D = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 1, detail: "D" }).filter((p) => p.color === "D");
    const shaped = OBJECT_KINDS.filter((k) => outlineOf(k.id) !== "rect");
    expect(shaped.length).toBeGreaterThanOrEqual(4);
    for (const k of shaped) {
      for (const c of k.configs) {
        for (const [sw, sd] of sizes(c.w, c.d)) {
          // Inside its shape: a convex one by `insideBy`, an `L`'s six-corner outline by point in polygon (catalog.16).
          const { outline } = pieceShape(k.id, sw, sd);
          const detail = D(k.id, sw, sd);
          expect(detail.length, `${k.id} ${sw}×${sd}`).toBeGreaterThan(0);
          const inside = (q: Point): boolean => (outlineOf(k.id) === "ell" ? insideRing(q, outline, TOL) : insideBy(q, outline) >= -TOL);
          for (const q of detail.flatMap(reach)) expect(inside(q), `${k.id} ${sw}×${sd} at (${q.x}, ${q.y})`).toBe(true);
        }
      }
    }
  });

  it("objectLook's front and fill follow the shape", () => {
    const look = { fill: "#ffffff", line: "#000000", frontPx: 2 };
    const fronts = (kind: string) => segs(objectLook(kind, "standard", 0.6, 0.6, look)).filter((s) => "px" in s.width && s.width.px === 2);
    const fill = (kind: string) => {
      const [first] = objectLook(kind, "standard", 0.6, 0.6, look);
      return first?.kind === "polygon" ? first.points.length : 0;
    };
    expect(fill("roundBlock")).toBe(32);
    const round = fronts("roundBlock");
    expect(round).toHaveLength(16);
    for (const s of round) for (const q of [s.a, s.b]) expect(q.y).toBeLessThanOrEqual(-0.3 + 1e-9);
    expect(fill("cornerBlock")).toBe(3);
    expect(fronts("cornerBlock")).toMatchObject([{ a: { x: -0.3, y: -0.6 }, b: { x: 0.3, y: 0 } }]);
    expect(fill("block")).toBe(4);
    expect(fronts("block")).toMatchObject([{ a: { x: -0.3, y: -0.6 }, b: { x: 0.3, y: -0.6 } }]);
  });
});
