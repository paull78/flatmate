import { describe, expect, it } from "vitest";
import {
  EPS,
  OBJECT_KINDS,
  emptyDocument,
  execute,
  fitShapes,
  placementRug,
  furnishedRooms,
  interiorPoint,
  levelOf,
  onFloor,
  rectangleRoom,
  wallBodies,
  zones,
  type Command,
  type Document,
  type Zone,
} from "@fm/domain";
import type { Point } from "@fm/protocol";
import { drawingArea, MARGIN_MM, columnMm, orientationFor } from "../src/export/paper";
import { planSize, sheetBounds, sheetPages } from "../src/export/sheet";
import { deckLabelBox, labelledDecks } from "../src/view/deck-label";
import { plateBox } from "../src/view/labels";
import { lookPicture } from "../src/view/look";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomTagLayout, tagLayout } from "../src/view/tags";
import { roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { textWidth } from "../src/view/fonts";

// Room tags keep off deck labels on paper and in look (AC-06), and the free-spot rule over random rooms (AC-08). The
// overlap test here is this file's own (edge clipping and point-in-polygon), not tag-spot's convexOverlap.

type Frame = { min: Point; max: Point };
type Text = Extract<Primitive, { kind: "text" }>;

const ring = ({ min, max }: Frame): Point[] => [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];
const centre = ({ min, max }: Frame): Point => ({ x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 });
/** Each line is centred on `x`, at `ys` from the top line down. */
function expectLines(lines: readonly { at: Point }[], x: number, ys: readonly number[]): void {
  expect(lines).toHaveLength(ys.length);
  lines.forEach((l, i) => {
    expect(l.at.x).toBeCloseTo(x, 9);
    expect(l.at.y).toBeCloseTo(ys[i] ?? NaN, 9);
  });
}
const TOUCH = EPS; // the box shrinks this much first: contact within the domain's 1 mm counts as touching, allowed

/** Whether segment p–q meets the closed box (Liang–Barsky clipping). */
function segmentMeetsBox(p: Point, q: Point, b: Frame): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [den, num] of [[-dx, p.x - b.min.x], [dx, b.max.x - p.x], [-dy, p.y - b.min.y], [dy, b.max.y - p.y]] as const) {
    if (den === 0) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Ray casting: whether p is inside the ring (any simple polygon). */
function insideRing(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether the box and the polygon share area beyond touching: an edge enters the shrunk box, or the box lies inside. */
function overlapsBeyondTouching(box: Frame, poly: readonly Point[]): boolean {
  const b = { min: { x: box.min.x + TOUCH, y: box.min.y + TOUCH }, max: { x: box.max.x - TOUCH, y: box.max.y - TOUCH } };
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (p && q && segmentMeetsBox(p, q, b)) return true;
  }
  return insideRing(centre(box), poly);
}

const deckLabelFrames = (doc: Document, style: PlanStyle, zoom: number): Frame[] =>
  labelledDecks(doc, levelOf(doc, null)).map((deck) => deckLabelBox(deck, style, zoom));

/** roomDoc with a Loft at (2.5, 2.6), 2.4 × 2.4, and "Living" (L1) at (2, 3.4): its tag starts over "Loft +2.15". */
const loftDoc = (): Document =>
  withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 }, { type: "labelZone", id: "L1", at: { x: 2, y: 3.4 }, name: "Living", finish: null });

/** The tag's box at its point, before any move: its lines' widest text in the style's font, padded. */
function boxAtPoint(at: Point, texts: readonly string[], style: PlanStyle, zoom: number): Frame {
  const width = Math.max(...texts.map((t) => textWidth(style.font, t, style.tag.size)));
  return plateBox(at, width, texts.length, style.tag, zoom);
}

/** The tag texts of `lines` in `primitives`, in the tag's line order, with the tag's colour. */
function tagTexts(primitives: readonly Primitive[], lines: readonly string[], keep: (t: Text) => boolean): Text[] {
  const found = primitives.flatMap((p) => (p.kind === "text" && p.color === PRESENTATION_STYLE.tag.text && lines.includes(p.text) && keep(p) ? [p] : []));
  expect(found.map((t) => t.text)).toEqual(lines);
  return found;
}

describe("a tag over a deck label moves off it on paper and in look (AC-06)", () => {
  it("on the PDF at 1:50 the tag text sits where the tag layout puts it, off the deck label", () => {
    const doc = loftDoc();
    const host = new FakeHost();
    const k = 20; // 1:50: paper millimetres per metre
    const tag = tagLayout(doc, "L1", { zoom: k }, "s0", PRESENTATION_STYLE);
    if (!tag) throw new Error("no tag");
    const texts = tag.lines.map((l) => l.text);
    expect(texts).toEqual(["Living", "5.80 × 3.80 m", "22.04 m²"]);
    // "5.80 × 3.80 m" is 15.36 mm in Helvetica at 2.5 mm: half-box (7.68 + 0.8, 3 × 3.4 / 2 + 0.4) mm / 20 = (0.424,
    // 0.275) m. At the point the box (y 3.125–3.675) overlaps the two-line label (x 1.38–2.02, y 3.3425–3.7225, areas.10);
    // up leaves the floor (3.9), the 0.25 m spots and the diagonals still overlap it, and left 0.5 m too: right 0.5 m clears it.
    const [label] = deckLabelFrames(doc, PRESENTATION_STYLE, k);
    if (!label) throw new Error("no deck label");
    expect(overlapsBeyondTouching(boxAtPoint({ x: 2, y: 3.4 }, texts, PRESENTATION_STYLE, k), ring(label))).toBe(true);
    expect(centre(tag).x).toBeCloseTo(2.5, 9);
    expect(centre(tag).y).toBeCloseTo(3.4, 9);
    expectLines(tag.lines, 2.5, [3.57, 3.4, 3.23]); // 3.4 mm apart
    expect(overlapsBeyondTouching(tag, ring(label))).toBe(false);
    // The sheet centres the plan in A4's drawing area (as sheet.ts does): world (x, y) → (x·k + dx, y·k + dy).
    const page = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: 50, host, finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    const size = planSize(doc);
    const area = drawingArea("A4", orientationFor(size, "A4"));
    const { min } = sheetBounds(doc);
    const dx = area.x + (area.w - size.w * k) / 2 - min.x * k;
    const dy = area.y + (area.h - size.h * k) / 2 - min.y * k;
    const columnX = page.widthMm - MARGIN_MM - columnMm("A4");
    const printed = tagTexts(page.primitives, texts, (t) => t.at.x < columnX); // the rooms table repeats name and area
    printed.forEach((t, i) => {
      const at = tag.lines[i]?.at;
      if (!at) throw new Error("no line");
      expect(t.at.x).toBeCloseTo(at.x * k + dx, 9);
      expect(t.at.y).toBeCloseTo(at.y * k + dy, 9);
    });
  });

  it("in the SVG (1:100) the tag text sits where the tag layout puts it, off the deck label", () => {
    const doc = loftDoc();
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "svg" });
    const [save] = shell.effectsOf("saveFile");
    if (save?.content.kind !== "svg") throw new Error("not an svg");
    const zoom = save.content.frame.zoom;
    expect(zoom).toBe(10);
    const tag = tagLayout(doc, "L1", { zoom }, "s0", PRESENTATION_STYLE);
    if (!tag) throw new Error("no tag");
    // At 1:100 all three lines leave the floor at the point; name and area (half-box 0.573 × 0.38 m) overlap the two-line
    // label (x 1.34–2.62, y 3.005–3.765, areas.10) until 1.0 m down.
    const texts = tag.lines.map((l) => l.text);
    expect(texts).toEqual(["Living", "22.04 m²"]);
    expect(centre(tag).x).toBeCloseTo(2, 9);
    expect(centre(tag).y).toBeCloseTo(2.4, 9);
    expectLines(tag.lines, 2, [2.57, 2.23]);
    const printed = tagTexts(save.content.primitives, texts, () => true);
    expect(printed.map((t) => t.at)).toEqual(tag.lines.map((l) => l.at));
    const [label] = deckLabelFrames(doc, PRESENTATION_STYLE, zoom);
    if (!label) throw new Error("no deck label");
    expect(overlapsBeyondTouching(boxAtPoint({ x: 2, y: 3.4 }, texts, PRESENTATION_STYLE, zoom), ring(label))).toBe(true);
    expect(overlapsBeyondTouching(tag, ring(label))).toBe(false);
  });

  it("in the look picture the tag moves off the deck label", () => {
    const doc = loftDoc();
    const look = lookPicture(doc, null);
    if ("refused" in look) throw new Error(look.refused);
    const zoom = look.frame.zoom;
    const tag = tagLayout(doc, "L1", { zoom }, null, LOOK_STYLE);
    if (!tag) throw new Error("no tag");
    const texts = tag.lines.map((l) => l.text);
    expect(texts).toEqual(["Living", "5.80 × 3.80 m", "22.04 m²"]);
    const drawn = look.primitives.flatMap((p) => (p.kind === "text" && p.color === LOOK_STYLE.tag.text && texts.includes(p.text) ? [p.at] : []));
    expect(drawn).toEqual(tag.lines.map((l) => l.at));
    const [label] = deckLabelFrames(doc, LOOK_STYLE, zoom);
    if (!label) throw new Error("no deck label");
    // At 152.8 look px/m, Inter at 14 px: "5.80 × 3.80 m" 93.3 px, half-box (0.332, 0.190) m; "Loft +2.15" makes the
    // label x 1.394–1.877, y 3.562–3.706. At the point the box (x 1.668–2.332, y 3.21–3.59) overlaps it; up and left
    // 0.25 m still overlap it, right 0.25 m (box from x 1.918) clears it.
    expect(overlapsBeyondTouching(boxAtPoint({ x: 2, y: 3.4 }, texts, LOOK_STYLE, zoom), ring(label))).toBe(true);
    expect(centre(tag).x).toBeCloseTo(2.25, 9);
    expect(centre(tag).y).toBeCloseTo(3.4, 9);
    const gap = LOOK_STYLE.tag.line / zoom;
    expectLines(tag.lines, 2.25, [3.4 + gap, 3.4, 3.4 - gap]);
    expect(overlapsBeyondTouching(tag, ring(label))).toBe(false);
  });
});

/** A small seeded generator (mulberry32), as random-floors.ts uses. */
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

const VIEWS: readonly [PlanStyle, number][] = [[CANVAS_STYLE, 40], [CANVAS_STYLE, 60], [CANVAS_STYLE, 80], [CANVAS_STYLE, 120], [PRESENTATION_STYLE, 20], [PRESENTATION_STYLE, 10]];
const NAMES = ["Living", "Bedroom", "Hall", "Studio", "K"];
const ROTATIONS = [0, 90, 180, 270, 45, 30, 17];

type Case = { doc: Document; style: PlanStyle; zoom: number; labelled: boolean };

/** One seeded case: a rectangle, an L or a turned rectangle, an optional deck, 0–6 pieces in s0, maybe a label. */
function randomCase(seed: number): Case {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => {
    const x = xs[Math.floor(r() * xs.length)] ?? xs[0];
    if (x === undefined) throw new Error("empty");
    return x;
  };
  const step = (lo: number, hi: number): number => Math.round((lo + r() * (hi - lo)) * 10) / 10;
  let doc = emptyDocument();
  const run = (cmd: Command): boolean => {
    const next = execute(doc, cmd);
    if (next.ok) doc = next.value.doc;
    return next.ok;
  };
  const o = { x: step(-3, 3), y: step(-3, 3) };
  const w = step(2.5, 7);
  const h = step(2.5, 6);
  const shape = pick(["rect", "L", "turned"] as const);
  const a = shape === "turned" ? (step(5, 40) * Math.PI) / 180 : 0;
  /** The point s along the room's bottom wall and t up from it. */
  const at = (s: number, t: number): Point => ({ x: o.x + s * Math.cos(a) - t * Math.sin(a), y: o.y + s * Math.sin(a) + t * Math.cos(a) });
  const loop = (pts: Point[]): void => pts.forEach((p, i) => run({ type: "addWall", opId: `w${i}`, from: { at: p }, to: { at: pts[(i + 1) % pts.length] ?? p } }));
  if (shape === "rect") rectangleRoom(o, w, h).forEach(run);
  else if (shape === "L") {
    const w1 = step(1.2, w - 1);
    const h1 = step(1.2, h - 1);
    loop([at(0, 0), at(w, 0), at(w, h1), at(w1, h1), at(w1, h), at(0, h)]);
  } else loop([at(0, 0), at(w, 0), at(w, h), at(0, h)]);
  // A stub up from the bottom wall: the floor ignores it, so only its wall body keeps tags off it (tidy.21).
  if (r() < 0.4) {
    const s = step(0.5, w - 0.5);
    run({ type: "addWall", opId: "stub", from: { at: at(s, 0) }, to: { at: at(s, step(0.4, 1.6)) } });
  }
  const rand = (): Point => ({ x: o.x - 1 + r() * (w + 2), y: o.y - 1 + r() * (h + 2) });
  // A deck's label hangs inside its top-left corner: half the labels go near there, so some tags start over it.
  let nearLabel: (() => Point) | null = null;
  if (r() < 0.5) {
    const deck = { at: { x: o.x + step(0.5, w - 0.5), y: o.y + step(0.5, h - 0.5) }, w: step(0.6, 3), d: step(0.6, 3) };
    const corner = { x: deck.at.x - deck.w / 2, y: deck.at.y + deck.d / 2 };
    if (run({ type: "addDeck", opId: "deck", preset: pick(["platform", "loft"] as const), ...deck })) {
      nearLabel = () => ({ x: corner.x + step(-0.5, 1.5), y: corner.y + step(-0.8, 0.3) });
    }
  }
  const pieces = Math.floor(r() * 7);
  for (let i = 0; i < pieces; i++) {
    const kind = pick(OBJECT_KINDS).id;
    for (let tries = 0; tries < 5; tries++) {
      const size = { w: step(0.3, 2.2), d: step(0.3, 2.2) };
      if (run({ type: "placeObject", deck: null, opId: `p${i}t${tries}`, state: "s0", object: { kind, size }, at: rand(), rotation: pick(ROTATIONS) })) break;
    }
  }
  let labelled = false;
  if (r() < 0.6) {
    for (let tries = 0; tries < 10 && !labelled; tries++) labelled = run({ type: "labelZone", id: "L1", at: nearLabel && r() < 0.5 ? nearLabel() : rand(), name: pick(NAMES), finish: null });
  }
  const [style, zoom] = pick(VIEWS);
  return { doc, style, zoom, labelled };
}

/** The spec's lattice, written out again: (0.25·i, 0.25·j) m with i² + j² ≤ 64, nearest first, then up, then left. */
const SPOTS: readonly Point[] = (() => {
  const keys: { i: number; j: number }[] = [];
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) if (i * i + j * j <= 64) keys.push({ i, j });
  keys.sort((a, b) => a.i * a.i + a.j * a.j - (b.i * b.i + b.j * b.j) || b.j - a.j || a.i - b.i);
  return keys.map(({ i, j }) => ({ x: i / 4, y: j / 4 }));
})();

type Rings = readonly (readonly Point[])[];
/** What a tag keeps off, from the domain and the deck label box: the layout's drawn pieces, deck labels, wall bodies. */
function obstacles(doc: Document, style: PlanStyle, zoom: number): { pieces: Rings; labels: Rings; walls: Rings } {
  return {
    pieces: [...fitShapes(doc)].filter(([id]) => doc.placements[id]?.state === "s0" && !placementRug(doc, id)).map(([, r]) => r),
    labels: deckLabelFrames(doc, style, zoom).map(ring),
    walls: [...wallBodies(doc).values()],
  };
}

const onTheFloor = (box: Frame, zone: Zone): boolean => ring(box).every((c) => onFloor(zone, c));
const hitsAny = (box: Frame, rings: Rings): boolean => rings.some((r) => overlapsBeyondTouching(box, r));
const shifted = ({ min, max }: Frame, d: Point): Frame => ({ min: { x: min.x + d.x, y: min.y + d.y }, max: { x: max.x + d.x, y: max.y + d.y } });

describe("property: moved tags sit on the floor, off pieces, deck labels and walls (AC-08)", () => {
  it("over seeded random rooms, a moved tag is at the first spot this file's oracle finds free, and the same twice", () => {
    // `refused`: the spots before the first free one that are off the floor, or over each kind of obstacle (walls: on it).
    const stats = { cases: 0, moved: 0, hidden: 0, stayedFree: 0, stayedNoSpot: 0, refused: { floor: 0, pieces: 0, labels: 0, walls: 0 } };
    for (let seed = 1; seed <= 400; seed++) {
      const { doc, style, zoom, labelled } = randomCase(seed);
      const zone = zones(doc)[0];
      if (!zone) throw new Error(`seed ${seed}: no room`);
      if (!labelled && !furnishedRooms(doc).has(zone.face.key)) continue; // no tag to place
      // A copy of the document has its own tag cache, so the second draw recomputes (tags are cached per document).
      const draw = (d: Document) => (labelled ? tagLayout(d, "L1", { zoom }, "s0", style) : roomTagLayout(d, zones(d)[0] ?? zone, { zoom }, "s0", style));
      stats.cases++;
      const point = labelled ? doc.zoneLabels.L1?.at : interiorPoint(zone);
      const tag = draw(doc);
      expect(draw(JSON.parse(JSON.stringify(doc))), `seed ${seed}: the same spot twice`).toEqual(tag);
      if (!tag || !point) {
        stats.hidden++;
        continue;
      }
      const c = centre(tag);
      for (const l of tag.lines) expect(l.at.x, `seed ${seed}: text centred on the box`).toBeCloseTo(c.x, 9);
      expect(tag.lines.reduce((sum, l) => sum + l.at.y, 0) / tag.lines.length, `seed ${seed}: text centred on the box`).toBeCloseTo(c.y, 9);
      const d = { x: c.x - point.x, y: c.y - point.y };
      const index = SPOTS.findIndex((s) => Math.abs(s.x - d.x) < 1e-9 && Math.abs(s.y - d.y) < 1e-9);
      expect(index, `seed ${seed}: the tag sits on a lattice spot`).toBeGreaterThanOrEqual(0);
      const o = obstacles(doc, style, zoom);
      const rings = [...o.pieces, ...o.labels, ...o.walls];
      const atPoint = shifted(tag, { x: -d.x, y: -d.y });
      const firstFree = SPOTS.findIndex((s) => {
        const box = shifted(atPoint, s);
        return onTheFloor(box, zone) && !hitsAny(box, rings);
      });
      for (const s of SPOTS.slice(0, firstFree < 0 ? undefined : firstFree)) {
        const box = shifted(atPoint, s);
        const floor = onTheFloor(box, zone);
        if (!floor) stats.refused.floor++;
        if (hitsAny(box, o.pieces)) stats.refused.pieces++;
        if (hitsAny(box, o.labels)) stats.refused.labels++;
        if (floor && hitsAny(box, o.walls)) stats.refused.walls++; // off the floor, the corner test turns it down anyway
      }
      if (index > 0) {
        stats.moved++;
        expect(onTheFloor(tag, zone), `seed ${seed}: corners on the floor`).toBe(true);
        expect(rings.filter((r) => overlapsBeyondTouching(tag, r)), `seed ${seed}: overlaps`).toEqual([]);
        expect(firstFree, `seed ${seed}: the first free spot`).toBe(index);
      } else if (firstFree === 0) stats.stayedFree++;
      else {
        stats.stayedNoSpot++;
        expect(firstFree, `seed ${seed}: no free spot anywhere`).toBe(-1);
      }
    }
    // Seeds 1–400 give 339 cases: 107 moved, 136 free at the point, 12 with no free spot, 84 hidden (left out).
    expect(stats.moved).toBeGreaterThan(20);
    expect(stats.stayedNoSpot).toBeGreaterThan(0);
    expect(stats.hidden).toBeLessThan(stats.cases / 2);
    expect(Object.values(stats.refused).every((n) => n > 0)).toBe(true); // every rule turns spots down
  });
});
