import { describe, expect, it } from "vitest";
import { CEILING_ID, type Ceiling, type Document } from "@fm/domain";
import { roofLines } from "../src/view/roof-layer";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE as PAPER_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";

// The roof on the plan (roofs.11, .37, AC-08): its edge in a long dash at the walls' box plus the overhang, apart from
// pieces above the cut and decks, a gable's ridge in the same dash labelled "Ridge", and an arrow down each slope with
// its pitch. roomDoc's outer box is −0.1…6.1 × −0.1…4.1.

const roofed = (c: Omit<Ceiling, "id">): Document => ({ ...roomDoc(), ceilings: { [CEILING_ID]: { id: CEILING_ID, ...c } } });
const segments = (ps: readonly Primitive[]): Extract<Primitive, { kind: "segment" }>[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const texts = (ps: readonly Primitive[]): string[] => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
type Text = Extract<Primitive, { kind: "text" }>;
const textsAt = (ps: readonly Primitive[]): Text[] => ps.flatMap((p) => (p.kind === "text" ? [p] : []));
const box = (ps: readonly Primitive[]): { minX: number; minY: number; maxX: number; maxY: number } => {
  const pts = segments(ps).filter((s) => s.dash?.[0] === CANVAS_STYLE.roof.dash[0]).flatMap((s) => [s.a, s.b]);
  return { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) };
};

describe("the roof on the plan", () => {
  it("draws nothing under a flat ceiling", () => {
    expect(roofLines(roomDoc(), CANVAS_STYLE)).toEqual([]);
  });

  it("a shed: its edge dashed at the box plus 0.30, one arrow toward the low side with its pitch", () => {
    const ps = roofLines(roofed({ height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 }), CANVAS_STYLE);
    const b = box(ps);
    expect([b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.4, -0.4, 6.4, 4.4]);
    expect(texts(ps)).toEqual(["10°"]);
    const arrows = segments(ps).filter((s) => s.dash === undefined);
    expect(arrows.length).toBe(1);
    const [a] = arrows;
    expect(a && a.b.y < a.a.y).toBe(true); // it points down the slope, toward −y
    expect(segments(ps).filter((s) => s.dash !== undefined).length).toBe(4); // the edge only: no ridge, no label
  });

  it("an overhang of 0 draws the edge on the box", () => {
    const b = box(roofLines(roofed({ height: 2.5, shape: "shed", pitch: 10, falls: "+x", overhang: 0 }), CANVAS_STYLE));
    expect([b.minX, b.maxX].map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.1, 6.1]);
  });

  it("the edge's dash is longer than the one for pieces above the cut and decks' edges, in every style", () => {
    for (const style of [CANVAS_STYLE, PAPER_STYLE, LOOK_STYLE]) {
      const [dash = 0] = style.roof.dash;
      expect(dash).toBeGreaterThan(style.aboveDash[0] ?? 0);
      expect(dash).toBeGreaterThan(style.deck.dash[0] ?? 0);
    }
  });

  it("a gable: the ridge along x in the edge's dash, and two arrows away from it", () => {
    const ps = roofLines(roofed({ height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3 }), CANVAS_STYLE);
    const ridge = segments(ps).filter((s) => s.dash !== undefined && Math.abs(s.a.y - s.b.y) < 1e-9 && Math.abs(s.a.y - 2) < 1e-6);
    expect(ridge.length).toBe(1);
    expect(ridge[0]?.dash).toEqual(CANVAS_STYLE.roof.dash);
    expect(texts(ps).sort()).toEqual(["35°", "35°", "Ridge"]);
    const arrows = segments(ps).filter((s) => s.dash === undefined);
    expect(arrows.map((s) => Math.sign(s.b.y - s.a.y)).sort()).toEqual([-1, 1]);
  });

  for (const falls of ["-y", "+x"] as const) {
    it(`a gable falling ${falls}: "Ridge" beside its ridge, clear of the arrows' pitch`, () => {
      const ps = roofLines(roofed({ height: 2.3, shape: "gable", pitch: 35, falls, overhang: 0.3 }), CANVAS_STYLE);
      const ts = textsAt(ps);
      const ridge = ts.find((t) => t.text === "Ridge");
      expect(ridge).toBeDefined();
      const off = falls === "-y" ? Math.abs((ridge?.at.y ?? 0) - 2) : Math.abs((ridge?.at.x ?? 0) - 3);
      expect(off).toBeLessThan(0.5); // beside the ridge line (y 2, or x 3)
      for (const t of ts.filter((q) => q.text === "35°")) expect(Math.hypot(t.at.x - (ridge?.at.x ?? 0), t.at.y - (ridge?.at.y ?? 0))).toBeGreaterThan(1);
      expect(Math.hypot((ridge?.at.x ?? 0) - 3, (ridge?.at.y ?? 0) - 2)).toBeGreaterThan(1); // off the middle, where a room's tag sits
    });
  }

  it("draws on paper in the paper's units", () => {
    const ps = roofLines(roofed({ height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 }), PAPER_STYLE);
    expect(segments(ps).every((s) => "px" in s.width && s.width.px === PAPER_STYLE.roof.line)).toBe(true);
  });
});

describe("the roof in the scene and on paper", () => {
  it("the plan carries it above the walls and openings, with the decks' labels, and nothing new under a flat ceiling", async () => {
    const { FakeShell } = await import("./fake-shell");
    const shed = FakeShell.withDocument(roofed({ height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 }));
    const flat = FakeShell.withDocument(roomDoc());
    const overheads = (s: InstanceType<typeof FakeShell>): readonly Primitive[] => s.scene().layers.find((l) => l.name === "deckLabels")?.primitives ?? [];
    expect(texts(overheads(shed))).toEqual(["10°"]);
    expect(overheads(flat)).toEqual([]);
  });
});

describe("the roof on paper", () => {
  it("the paper plan's overheads carry the roof's edge and pitch", async () => {
    const { planPicture } = await import("../src/view/picture");
    const { floorView } = await import("../src/view/plan-view");
    const doc = roofed({ height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3 });
    const p = planPicture(doc, floorView(doc, null), PAPER_STYLE, 20, true);
    expect(texts(p.roof).sort()).toEqual(["35°", "35°", "Ridge"]);
    expect(segments(p.roof).filter((s) => s.dash?.[0] === PAPER_STYLE.roof.dash[0]).length).toBe(5); // the edge and the ridge
  });

  it("draws after the walls and the openings, so a door's span never cuts a slope's arrow (the user's review)", async () => {
    const { pictureLayers, planPicture } = await import("../src/view/picture");
    const { floorView } = await import("../src/view/plan-view");
    const doc = roofed({ height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3 });
    const p = planPicture(doc, floorView(doc, null), PAPER_STYLE, 20, true);
    const all = pictureLayers(p);
    const first = p.roof[0];
    const lastWall = p.walls[p.walls.length - 1];
    if (!first || !lastWall) throw new Error("no roof or no walls");
    expect(all.indexOf(first)).toBeGreaterThan(all.lastIndexOf(lastWall));
  });
});

describe("the roof on a project card", () => {
  it("is left out: a card shows the plan, not its overhead roof (the hands-on run, roofs.28)", async () => {
    const { cardPicture } = await import("../src/view/cards");
    const doc = roofed({ height: 2.3, shape: "gable", pitch: 35, falls: "-y", overhang: 0.3 });
    const flat = cardPicture(roomDoc(), null);
    expect(cardPicture(doc, null)?.primitives.length).toBe(flat?.primitives.length);
  });
});

describe("framing the roof", () => {
  it("a sheet's fit and an image take the roof's overhang", async () => {
    const { drawnBounds, markedBounds } = await import("../src/view/picture");
    const doc = roofed({ height: 2.5, shape: "shed", pitch: 10, falls: "-y", overhang: 1 });
    expect(drawnBounds(doc, null)?.min.x).toBeCloseTo(-1.1, 6);
    expect(markedBounds(doc, null).min.x).toBeCloseTo(-1.6, 6);
    expect(markedBounds(roomDoc(), null).min.x).toBeCloseTo(-0.6, 6);
  });
});
