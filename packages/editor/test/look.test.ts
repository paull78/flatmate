import { describe, expect, it } from "vitest";
import { emptyDocument, underlayRect, type Box, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { LOOK_FADE, LOOK_LONG_SIDE, LOOK_RULER, lookPicture, type LookPicture } from "../src/view/look";
import { LOOK_STYLE, pictureBounds, planPicture } from "../src/view/picture";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { floorView } from "../src/view/plan-view";
import { CHROME_FONT, textWidth } from "../src/view/fonts";

// Claude's look picture (import.12, AC-08, AC-14): what it holds, as plain data. One SVG unit is one look pixel, so
// px sizes are look pixels; the PNG and its pixel checks are the MCP shell's (step 08).

/** A 900 × 1400 px picture at 0.01 m/px (9 × 14 m), top-left at (−1.37, 5.21): rect x −1.37..7.63, y −8.79..5.21. */
const UNDER = withCommands(roomDoc(), { type: "placeUnderlay", pictureId: "p1", data: "QUFB/+/=", width: 900, height: 1400, at: { x: -1.37, y: 5.21 } });
const TALL: Box = { minX: 12.34, minY: -3.21, maxX: 14.34, maxY: -0.21 }; // 2 × 3 m, off the origin
const WIDE: Box = { minX: -17.5, minY: 3.25, maxX: 22.5, maxY: 10.25 }; // 40 × 7 m

/** roomDoc (6 × 4) with a labelled room, a swing door on the bottom wall, a bed in s0 and a 3 m dimension (picture.test.ts). */
function furnishedDoc(): Document {
  const doc = roomDoc();
  return withCommands(
    doc,
    { type: "labelZone", id: "L1", at: { x: 4, y: 2 }, name: "Studio", finish: null },
    { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 4.5 },
    { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3.85 } },
    { type: "addDimension", opId: "m1", a: { x: 0.5, y: 1 }, b: { x: 3.5, y: 1 }, offset: 0.5 },
  );
}

function look(doc: Document, region: Box | null = null): LookPicture {
  const r = lookPicture(doc, region);
  if ("refused" in r) throw new Error(`refused: ${r.refused}`);
  return r;
}

type Label = Extract<Primitive, { kind: "text" }>;
/** The ruler labels: the trailing run of text primitives (bands and ticks come before them). x labels are centred. */
function labels(p: LookPicture): { all: Label[]; x: Label[]; y: Label[] } {
  const all: Label[] = [];
  for (let i = p.primitives.length - 1; i >= 0; i--) {
    const q = p.primitives[i];
    if (q?.kind !== "text") break;
    all.unshift(q);
  }
  return { all, x: all.filter((l) => l.align === "center"), y: all.filter((l) => l.align === "right") };
}

/** A label's box in look pixels from the frame's top-left, measured as the FakeHost does (0.6 em wide, `size` tall). */
function box(l: Label, p: LookPicture): { left: number; right: number; top: number; bottom: number } {
  const w = textWidth(CHROME_FONT, l.text, l.size);
  const x = (l.at.x - p.frame.min.x) * p.frame.zoom;
  const y = (p.frame.max.y - l.at.y) * p.frame.zoom;
  const left = l.align === "center" ? x - w / 2 : l.align === "right" ? x - w : x;
  return { left, right: left + w, top: y - l.size / 2, bottom: y + l.size / 2 };
}

const BAND_PX = LOOK_RULER.size + 2 * LOOK_RULER.pad;
const leftBandPx = (p: LookPicture): number => Math.max(0, ...labels(p).y.map((l) => textWidth(CHROME_FONT, l.text, l.size))) + 2 * LOOK_RULER.pad;

/** The ruler step, read off neighbouring labels and cleaned to six significant digits (the 1-2-5 value). */
function stepOf(values: number[]): number {
  const s = values.length >= 2 ? Math.abs((values[1] ?? 0) - (values[0] ?? 0)) : NaN;
  return Number(s.toPrecision(6));
}

/** Every rule a ruler keeps, as failure strings (empty when all hold). */
function rulerProblems(p: LookPicture): string[] {
  const out: string[] = [];
  const { x, y } = labels(p);
  const w = (p.frame.max.x - p.frame.min.x) * p.frame.zoom;
  const h = (p.frame.max.y - p.frame.min.y) * p.frame.zoom;
  const left = leftBandPx(p);
  for (const [axis, ls] of [["x", x], ["y", y]] as const) {
    const at = (l: Label): number => (axis === "x" ? l.at.x : l.at.y);
    const step = stepOf(ls.map(at));
    if (ls.length >= 2 && step * p.frame.zoom < LOOK_RULER.minStepPx - 1e-6) out.push(`${axis} step ${step} under minStepPx`);
    for (const l of ls) {
      if (!/^-?\d+(\.\d+)?$/.test(l.text) || l.text.startsWith("-0") && Number(l.text) === 0 || /\.\d{12,}/.test(l.text)) out.push(`${axis} text ${l.text}`);
      if (Math.abs(Number(l.text) - at(l)) > 1e-9) out.push(`${axis} label ${l.text} at ${at(l)}`);
      if (ls.length >= 2 && Math.abs(at(l) / step - Math.round(at(l) / step)) > 1e-6) out.push(`${axis} label ${l.text} off the step ${step}`);
      if (l.color !== LOOK_RULER.ink) out.push(`${axis} label ${l.text} colour ${l.color}`);
      const b = box(l, p);
      if (b.left < -1e-9 || b.right > w + 1e-9 || b.top < -1e-9 || b.bottom > h + 1e-9) out.push(`${axis} label ${l.text} leaves the frame`);
      if (axis === "x" && b.left < left - 1e-9) out.push(`x label ${l.text} enters the left band`);
      if (axis === "y" && b.bottom > h - BAND_PX + 1e-9) out.push(`y label ${l.text} enters the bottom band`);
    }
    for (let i = 1; i < ls.length; i++) {
      const [a, b] = [ls[i - 1], ls[i]].map((l) => (l ? box(l, p) : null));
      if (!a || !b) continue;
      if (axis === "x" && b.left - a.right < LOOK_RULER.labelGap - 1e-9) out.push(`x labels ${ls[i - 1]?.text} and ${ls[i]?.text} collide`);
      if (axis === "y" && a.top < b.bottom + 1e-9 && b.top < a.bottom + 1e-9) out.push(`y labels ${ls[i - 1]?.text} and ${ls[i]?.text} overlap`);
    }
  }
  return out;
}

/** mulberry32, as packages/domain/test/helpers.ts `rng`: a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("lookPicture: framing (import.12, AC-08)", () => {
  it("frames a region taller than wide on its height: long side 1100", () => {
    const { frame } = look(roomDoc(), TALL);
    expect(frame.min).toEqual({ x: TALL.minX, y: TALL.minY });
    expect(frame.max).toEqual({ x: TALL.maxX, y: TALL.maxY });
    expect(frame.zoom).toBeCloseTo(1100 / 3, 9);
    expect(3 * frame.zoom).toBeCloseTo(LOOK_LONG_SIDE, 9);
    expect(2 * frame.zoom).toBeCloseTo(733.33, 2);
  });

  it("frames a region wider than tall on its width", () => {
    const { frame } = look(roomDoc(), WIDE);
    expect(40 * frame.zoom).toBeCloseTo(1100, 9);
    expect(7 * frame.zoom).toBeCloseTo(192.5, 9);
  });

  it("the default region is the underlay's rect plus 4 % of its long side, with the picture as a grey faded backdrop", () => {
    // The rect is 9 × 14 m; 0.04 × 14 = 0.56 m on every side keeps the ruler bands off the plan's edges (import.37).
    const { frame } = look(UNDER);
    expect(frame.min.x).toBeCloseTo(-1.93, 9);
    expect(frame.min.y).toBeCloseTo(-9.35, 9);
    expect(frame.max.x).toBeCloseTo(8.19, 9);
    expect(frame.max.y).toBeCloseTo(5.77, 9);
    expect(frame.zoom).toBeCloseTo(1100 / 15.12, 9);
    expect(frame.backdrop).toEqual({ data: "QUFB/+/=", rect: underlayRect(UNDER), fade: LOOK_FADE, grey: true });
    expect(frame.background).toBe("#ffffff");
  });

  it("without an underlay the default region is the drawing's bounds with their margin, and there is no backdrop", () => {
    const { frame } = look(roomDoc());
    const bounds = pictureBounds(roomDoc(), null);
    expect({ min: frame.min, max: frame.max }).toEqual(bounds);
    expect(bounds.min.x).toBeCloseTo(-0.6, 9);
    expect(bounds.max.y).toBeCloseTo(4.6, 9);
    expect(frame.backdrop).toBeUndefined();
  });

  it("a given region overrides the underlay's", () => {
    const { frame } = look(UNDER, TALL);
    expect(frame.min).toEqual({ x: TALL.minX, y: TALL.minY });
    expect(frame.max).toEqual({ x: TALL.maxX, y: TALL.maxY });
    expect(frame.backdrop?.rect).toEqual(underlayRect(UNDER));
  });

  it("refuses with neither an underlay nor a drawing", () => {
    for (const region of [null, TALL]) {
      const r = lookPicture(emptyDocument(), region);
      expect("refused" in r && r.refused.length > 0).toBe(true);
    }
    const dimOnly = withCommands(emptyDocument(), { type: "addDimension", opId: "m1", a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, offset: 0.5 });
    const { frame } = look(dimOnly);
    expect({ min: frame.min, max: frame.max }).toEqual(pictureBounds(dimOnly, null));
    const pictureOnly = withCommands(emptyDocument(), { type: "placeUnderlay", pictureId: "p1", data: "QUFB", width: 10, height: 10, at: { x: 0, y: 0 } });
    expect("refused" in lookPicture(pictureOnly, null)).toBe(false);
  });

  it("refuses a region without area, too small, too large or too far out", () => {
    const bad: Box[] = [
      { minX: 1, minY: 0, maxX: 1, maxY: 2 },
      { minX: 0, minY: 3, maxX: 2, maxY: 2 },
      { minX: NaN, minY: 0, maxX: 2, maxY: 2 },
      { minX: 0, minY: 0, maxX: Infinity, maxY: 2 },
      { minX: 0, minY: -Infinity, maxX: 2, maxY: 2 },
      // Each of these broke the rulers: 2^53 multiples (an endless loop), over 100 decimals, an infinite width.
      { minX: 9999, minY: 9999, maxX: 9999 + 1e-11, maxY: 9999 + 1e-11 },
      { minX: 1e6, minY: 0, maxX: 1e6 + 3e-10, maxY: 3e-10 },
      { minX: 0, minY: 0, maxX: 1e-150, maxY: 1e-150 },
      { minX: 0, minY: 0, maxX: 0.049, maxY: 0.01 },
      { minX: -1e308, minY: 0, maxX: 1e308, maxY: 1 },
      { minX: 0, minY: 0, maxX: 100_001, maxY: 1 },
      { minX: 1_000_000, minY: 0, maxX: 1_000_001, maxY: 1 },
      // A short side under one look pixel: resvg has nothing to draw.
      { minX: 0, minY: 0, maxX: 10, maxY: 0.00001 },
      { minX: 0, minY: 0, maxX: 11, maxY: 0.0099 },
    ];
    for (const region of bad) {
      const r = lookPicture(roomDoc(), region);
      expect("refused" in r && r.refused.length > 0, JSON.stringify(region)).toBe(true);
    }
    // The refusal prints look's own limits (cleanup.09): the same words as before they came from constants.
    const r = lookPicture(roomDoc(), { minX: 0, minY: 0, maxX: 100_001, maxY: 1 });
    expect("refused" in r && r.refused).toBe(
      `The region needs finite edges with min below max, within 1000000 m of the origin, a long side from 0.05 m to 100000 m, and a short side at least 1/${LOOK_LONG_SIDE} of its long side`,
    );
    for (const region of [{ minX: 0, minY: 0, maxX: 0.05, maxY: 0.01 }, { minX: 0, minY: 0, maxX: 11, maxY: 0.01 }, { minX: -50_000, minY: 999_000, maxX: 50_000, maxY: 1_000_000 }]) {
      expect(rulerProblems(look(roomDoc(), region)), JSON.stringify(region)).toEqual([]);
    }
  });

  it("refuses a default region the underlay makes too small", () => {
    const tiny = withCommands(UNDER, { type: "scaleUnderlay", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, distance: 1e-4 });
    const r = lookPicture(tiny, null);
    expect("refused" in r && r.refused.includes("scale it again")).toBe(true);
    expect("refused" in lookPicture(tiny, TALL)).toBe(false);
  });
});

describe("lookPicture: rulers (AC-08, AC-14)", () => {
  it("a ruler label sits at its metre", () => {
    const p = look(roomDoc());
    const { all, x, y } = labels(p);
    // The default region (7.2 m wide) gets a 0.5 m step, so labels carry one decimal.
    const three = x.find((l) => l.text === "3.0");
    expect(three?.at.x).toBe(3);
    expect(three && three.at.y > p.frame.min.y && three.at.y < p.frame.min.y + BAND_PX / p.frame.zoom).toBe(true);
    const two = y.find((l) => l.text === "2.0");
    expect(two?.at.y).toBe(2);
    expect(two && two.at.x > p.frame.min.x && two.at.x < p.frame.min.x + leftBandPx(p) / p.frame.zoom).toBe(true);
    expect(all.length).toBe(x.length + y.length);
    for (const l of all) expect(l.color).toBe(LOOK_RULER.ink);
  });

  it("labels read negative and fractional metres at the right place", () => {
    const p = look(roomDoc(), TALL);
    const { x, y } = labels(p);
    expect(x.some((l) => l.text.includes("."))).toBe(true);
    expect(y.every((l) => l.text.startsWith("-"))).toBe(true);
    expect(rulerProblems(p)).toEqual([]);
  });

  it("the ruler step keeps labels apart: a 3 m and a 40 m region", () => {
    const small = look(roomDoc(), TALL);
    const big = look(roomDoc(), WIDE);
    for (const p of [small, big]) {
      expect(rulerProblems(p)).toEqual([]);
      expect(labels(p).x.length).toBeGreaterThanOrEqual(2);
      expect(labels(p).y.length).toBeGreaterThanOrEqual(2);
    }
    expect(stepOf(labels(small).x.map((l) => l.at.x))).toBeLessThanOrEqual(0.5);
    expect(stepOf(labels(big).x.map((l) => l.at.x))).toBeGreaterThanOrEqual(2);
  });

  it("a frame too thin for a band's labels drops them, and every kept label stays inside", () => {
    const flat = look(roomDoc(), { minX: -20, minY: 0, maxX: 20, maxY: 0.2 }); // 1100 × 5.5 px
    expect(labels(flat).x).toEqual([]);
    expect(rulerProblems(flat)).toEqual([]);
    const narrow = look(roomDoc(), { minX: 0, minY: -1234.6, maxX: 1, maxY: -1194.6 }); // 27.5 × 1100 px, labels like "-1230"
    expect(labels(narrow).y).toEqual([]);
    expect(rulerProblems(narrow)).toEqual([]);
    for (const p of [flat, narrow]) {
      for (const q of p.primitives) {
        if (q.kind !== "polygon" || q.color !== LOOK_RULER.band) continue;
        for (const v of q.points) {
          expect(v.x).toBeGreaterThanOrEqual(p.frame.min.x - 1e-9);
          expect(v.x).toBeLessThanOrEqual(p.frame.max.x + 1e-9);
          expect(v.y).toBeGreaterThanOrEqual(p.frame.min.y - 1e-9);
          expect(v.y).toBeLessThanOrEqual(p.frame.max.y + 1e-9);
        }
      }
    }
  });

  it("draws two bands, an inward tick per label and a grid line per step under the plan", () => {
    const p = look(roomDoc());
    const { min, max, zoom } = p.frame;
    const { x, y } = labels(p);
    const bandTop = min.y + BAND_PX / zoom;
    const bandRight = min.x + leftBandPx(p) / zoom;
    const bands = p.primitives.flatMap((q) => (q.kind === "polygon" && q.color === LOOK_RULER.band ? [q] : []));
    expect(bands.map((b) => b.points)).toEqual([
      [{ x: min.x, y: min.y }, { x: max.x, y: min.y }, { x: max.x, y: bandTop }, { x: min.x, y: bandTop }],
      [{ x: min.x, y: bandTop }, { x: bandRight, y: bandTop }, { x: bandRight, y: max.y }, { x: min.x, y: max.y }],
    ].map((pts) => pts.map((v) => ({ x: expect.closeTo(v.x, 9), y: expect.closeTo(v.y, 9) }))));
    const segs = p.primitives.flatMap((q) => (q.kind === "segment" ? [q] : []));
    const ticks = segs.filter((q) => q.color === LOOK_RULER.ink);
    expect(ticks.length).toBe(x.length + y.length);
    for (const l of x) {
      expect(ticks.some((t) => t.a.x === l.at.x && t.b.x === l.at.x && Math.abs(t.a.y - bandTop) < 1e-9 && t.b.y > t.a.y)).toBe(true);
    }
    for (const l of y) {
      expect(ticks.some((t) => t.a.y === l.at.y && t.b.y === l.at.y && Math.abs(t.a.x - bandRight) < 1e-9 && t.b.x > t.a.x)).toBe(true);
    }
    const grid = segs.filter((q) => q.color === LOOK_RULER.grid);
    const step = stepOf(x.map((l) => l.at.x));
    const count = (lo: number, hi: number): number => Math.floor(hi / step + 1e-9) - Math.ceil(lo / step - 1e-9) + 1;
    expect(grid.filter((g) => g.a.x === g.b.x).length).toBe(count(min.x, max.x));
    expect(grid.filter((g) => g.a.y === g.b.y).length).toBe(count(min.y, max.y));
    const firstWall = p.primitives.findIndex((q) => q.color === LOOK_STYLE.wall);
    expect(firstWall).toBeGreaterThan(0);
    expect(p.primitives.slice(firstWall).some((q) => q.color === LOOK_RULER.grid)).toBe(false);
  });

  it("seeded fuzz: rulers hold for 500 random regions", () => {
    const seed = 7;
    const r = rng(seed);
    for (let i = 0; i < 500; i++) {
      const long = 0.05 * Math.pow(10, r() * Math.log10(5000 / 0.05));
      const aspect = Math.pow(20, 2 * r() - 1); // width / height, 1:20 to 20:1
      const [w, h] = aspect >= 1 ? [long, long / aspect] : [long * aspect, long];
      const minX = (2 * r() - 1) * 10_000;
      const minY = (2 * r() - 1) * 10_000;
      const region: Box = { minX, minY, maxX: minX + w, maxY: minY + h };
      const where = `seed ${seed}, region ${i} ${JSON.stringify(region)}`;
      const p = look(roomDoc(), region);
      const realW = region.maxX - region.minX;
      const realH = region.maxY - region.minY;
      expect(Math.abs(Math.max(realW, realH) * p.frame.zoom - 1100), where).toBeLessThan(1e-6);
      expect(rulerProblems(p), where).toEqual([]);
      // A frame narrower than the widest y label drops them, so only a frame wide enough for any is held to this.
      const longAxis = realW >= realH ? labels(p).x : labels(p).y;
      if (Math.min(realW, realH) * p.frame.zoom >= 100) expect(longAxis.length, where).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("lookPicture: caption (import.13)", () => {
  it("caption: UNSCALED first exactly while the underlay is unscaled", () => {
    expect(look(UNDER).caption).toBe("UNSCALED · region x -1.93 to 8.19 m, y -9.35 to 5.77 m · 0.0137 m per look pixel · y up");
    const scaled = withCommands(UNDER, { type: "scaleUnderlay", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, distance: 5 });
    const rect = underlayRect(scaled);
    const after = look(scaled);
    expect(after.caption).not.toContain("UNSCALED");
    expect(rect).not.toBeNull();
    if (rect) {
      const m = 0.04 * Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY);
      expect(after.frame.min.x).toBeCloseTo(rect.minX - m, 9);
      expect(after.frame.min.y).toBeCloseTo(rect.minY - m, 9);
      expect(after.caption).toContain(`region x ${(rect.minX - m).toFixed(2)} to ${(rect.maxX + m).toFixed(2)} m, y ${(rect.minY - m).toFixed(2)} to ${(rect.maxY + m).toFixed(2)} m`);
    }
    expect(look(roomDoc()).caption).not.toContain("UNSCALED");
    for (const c of [look(UNDER).caption, after.caption, look(roomDoc()).caption, look(UNDER, TALL).caption]) expect(c.endsWith("y up")).toBe(true);
  });

  it("negative zero reads as 0 in the caption", () => {
    expect(look(roomDoc(), { minX: -0.001, minY: -0.004, maxX: 1, maxY: 1 }).caption).toContain("region x 0.00 to 1.00 m, y 0.00 to 1.00 m");
  });
});

describe("lookPicture: the plan in LOOK_STYLE", () => {
  it("draws a stair as the canvas does, label included, with the first layout's other pieces (AC-13, mcp.03)", () => {
    const stair = { type: "placeObject", deck: null, opId: "st", state: "s0", object: { kind: "storageStair" }, at: { x: 4.5, y: 3.9 } } as const;
    const doc = withCommands(furnishedDoc(), stair);
    const p = look(doc);
    const objects = planPicture(doc, floorView(doc, "s0"), LOOK_STYLE, p.frame.zoom, false).objects;
    const drawn = new Set(p.primitives.map((q) => JSON.stringify(q)));
    const shown = objects.filter((q) => drawn.has(JSON.stringify(q)));
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.length).toBe(objects.length); // the bed too (mcp.03)
    expect(shown).toContainEqual(expect.objectContaining({ kind: "text", text: "UP · 10 R", size: LOOK_STYLE.stairLabel, color: LOOK_STYLE.tag.text }));
  });

  it("draws walls, openings, room names and dimension lines in one ink; no room fills", () => {
    const doc = furnishedDoc();
    const p = look(doc);
    const pic = planPicture(doc, floorView(doc, "s0"), LOOK_STYLE, p.frame.zoom, false);
    const plan = [...pic.walls, ...pic.openings, ...pic.tags, ...pic.dimensions];
    expect(pic.openings.length).toBeGreaterThan(0);
    const first = JSON.stringify(plan[0]);
    const start = p.primitives.findIndex((q) => JSON.stringify(q) === first);
    expect(start).toBeGreaterThan(0); // the grid comes first
    expect(p.primitives.slice(start, start + plan.length)).toEqual(plan);
    const inks = new Set([LOOK_STYLE.wall, LOOK_STYLE.openingFloor, LOOK_STYLE.openingGlass]);
    for (const q of plan) expect(inks.has(q.color), `${q.kind} ${q.color}`).toBe(true);
    for (const q of p.primitives) expect([COLORS.object, COLORS.objectEdge, COLORS.zoneFill]).not.toContain(q.color);
    // The first layout's pieces are drawn (mcp.03), in look's ink by their own primitives; the rest are grid and rulers.
    const furniture = new Set(planPicture(doc, floorView(doc, "s0"), LOOK_STYLE, p.frame.zoom, false).objects.map((q) => JSON.stringify(q)));
    expect(furniture.size).toBeGreaterThan(0);
    const drawn = new Set(p.primitives.map((q) => JSON.stringify(q)));
    for (const q of furniture) expect(drawn.has(q)).toBe(true);
    const ruler = new Set<string>([LOOK_RULER.ink, LOOK_RULER.band, LOOK_RULER.grid]);
    const rest = [...p.primitives.slice(0, start), ...p.primitives.slice(start + plan.length)].filter((q) => !furniture.has(JSON.stringify(q)));
    for (const q of rest) expect(ruler.has(q.color), `${q.kind} ${q.color}`).toBe(true);
    const texts = plan.flatMap((q) => (q.kind === "text" ? [q] : []));
    expect(texts.find((t) => t.text === "Studio")?.color).toBe(LOOK_STYLE.wall);
    expect(texts.find((t) => t.text === "3.00")?.color).toBe(LOOK_STYLE.wall);
    const { all } = labels(p);
    expect(all.length).toBeGreaterThan(0);
    expect(p.primitives.slice(-all.length)).toEqual(all);
  });

  it("LOOK_STYLE is one strong ink in look pixels", () => {
    const s = LOOK_STYLE;
    const ink = s.wall;
    for (const c of [s.openingLine, s.tag.text, s.tag.muted, s.dim.ink, s.dim.selected]) expect(c).toBe(ink);
    const spread = (hex: string): number => {
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return Math.max(...rgb) - Math.min(...rgb);
    };
    expect(spread(ink)).toBeGreaterThan(60);
    expect(s.tag.plate).toBeNull();
    const all = [s.wall, s.objectFill, s.objectLine, s.objectDetail, s.openingFloor, s.openingGlass, s.openingLine, s.tag.text, s.tag.muted, s.accent, s.dim.ink, s.dim.selected, LOOK_RULER.ink, LOOK_RULER.band, LOOK_RULER.grid];
    for (const c of all) expect(c).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    expect(LOOK_RULER).toMatchObject({ size: 13, pad: 4, tick: 6, labelGap: 12, minStepPx: 48 }); // look pixels
    expect(LOOK_RULER.ink).not.toBe(ink);
    expect(spread(LOOK_RULER.ink)).toBeGreaterThan(60);
  });
});
