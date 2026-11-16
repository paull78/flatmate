import { describe, expect, it } from "vitest";
import { FOLD_DEPTH, geometryOf, type Command, type Document, type Opening, type OpeningGeometry } from "@fm/domain";
import { LEAF_M, REBATE_M } from "../src/view/opening-parts";
import { FRAME_M, openingPrimitives, styleLook } from "../src/view/openings-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";

// The new kinds' plan symbols (openkinds, reports/Drawing doors and windows.md): drawn by `side` and `hinge`, at both
// levels of detail. The room's wall along y = 0 runs from x 0 to 6, 0.20 m thick; its left side (+y) is the room.

type Placed = { kind: Opening["kind"]; width: number; side?: "left" | "right"; hinge?: "a" | "b" };
const OFFSET = 2;
const JAMB = Math.min(FRAME_M, 0.2);

function placed({ kind, width, side = "left", hinge = "a" }: Placed): { o: Opening; g: OpeningGeometry } {
  const base = roomDoc();
  const wall = Object.values(base.walls).find((w) => base.joints[w.a]?.y === 0 && base.joints[w.b]?.y === 0 && (base.joints[w.a]?.x ?? 1) < (base.joints[w.b]?.x ?? 0));
  if (!wall) throw new Error("no wall along y 0 running +x");
  const add: Command = { type: "addOpening", opId: "o", wall: wall.id, kind, offset: OFFSET, width, side, hinge };
  const doc: Document = withCommands(base, add);
  const o = doc.openings["o/d0"];
  const g = o ? geometryOf(doc, o) : null;
  if (!o || !g) throw new Error(`no ${kind} placed`);
  return { o, g };
}
const draw = (p: Placed, detailed = false): Primitive[] => {
  const { o, g } = placed(p);
  return openingPrimitives(o, g, styleLook(CANVAS_STYLE), true, detailed);
};
const of = <K extends Primitive["kind"]>(ps: readonly Primitive[], kind: K): Extract<Primitive, { kind: K }>[] => ps.filter((q): q is Extract<Primitive, { kind: K }> => q.kind === kind);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const glassLines = (ps: readonly Primitive[]) => of(ps, "segment").filter((s) => s.color === CANVAS_STYLE.openingGlass);

describe("a casement window (openkinds)", () => {
  const W = 0.6;

  it("is the three-line window plus one leaf and one thin arc, hinged at its frame's rebate at the hinge end, on the frame's face by the glass (openkinds.39, the user's reference)", () => {
    const ps = draw({ kind: "casement", width: W });
    const arcs = of(ps, "arc");
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.radius).toBeCloseTo(W - 2 * REBATE_M, 6);
    expect(arcs[0]?.center.x).toBeCloseTo(OFFSET + REBATE_M, 6);
    expect(arcs[0]?.center.y).toBeCloseTo(JAMB / 2, 6); // the frame's face on the side the window opens to, not the wall's
    expect(arcs[0]?.width).toEqual({ px: CANVAS_STYLE.openingWeights.hair });
    expect(glassLines(ps)).toHaveLength(1);
  });

  it("flipping side puts the arc on the frame's other face; flipping hinge moves it to the other end", () => {
    const right = of(draw({ kind: "casement", width: W, side: "right" }), "arc")[0];
    expect(right?.center.y).toBeCloseTo(-JAMB / 2, 6);
    const b = of(draw({ kind: "casement", width: W, hinge: "b" }), "arc")[0];
    expect(b?.center.x).toBeCloseTo(OFFSET + W - REBATE_M, 6);
  });

  it("its frames are rebated on the side it opens to, its leaf stands in the opening, and it has no handle", () => {
    const ps = draw({ kind: "casement", width: W }, true);
    const six = of(ps, "polygon").filter((q) => q.points.length === 6);
    expect(six).toHaveLength(2); // the two frames; a door would have two handles more
    for (const f of six) {
      const top = f.points.filter((q) => near(q.y, JAMB / 2)).map((q) => q.x);
      const bottom = f.points.filter((q) => near(q.y, -JAMB / 2)).map((q) => q.x);
      expect(Math.max(...top) - Math.min(...top)).toBeCloseTo(REBATE_M, 6);
      expect(Math.max(...bottom) - Math.min(...bottom)).toBeCloseTo(JAMB, 6);
    }
    const leaf = of(ps, "polygon").find((q) => q.points.length === 4 && Math.max(...q.points.map((v) => v.y)) > 0.3);
    const xs = (leaf?.points ?? []).map((q) => q.x);
    expect(Math.min(...xs)).toBeCloseTo(OFFSET + REBATE_M, 6);
    expect(Math.max(...xs)).toBeCloseTo(OFFSET + REBATE_M + LEAF_M, 6);
  });

  it("draws the window's frames only at the detailed level", () => {
    expect(of(draw({ kind: "casement", width: W }), "polygon")).toHaveLength(1); // the span only
    expect(of(draw({ kind: "casement", width: W }, true), "polygon").length).toBeGreaterThan(2);
  });
});

describe("a two-leaf window (openkinds)", () => {
  const W = 1.2;

  it("draws two leaves of half the clear width, hinged at both ends at the frames' rebates by the glass, with two thin arcs (openkinds.39, the user's reference)", () => {
    const arcs = of(draw({ kind: "twoLeaf", width: W }), "arc");
    expect(arcs).toHaveLength(2);
    for (const a of arcs) expect(a.radius).toBeCloseTo((W - 2 * REBATE_M) / 2, 6);
    const xs = arcs.map((a) => a.center.x).sort((p, q) => p - q);
    expect(near(xs[0] ?? 0, OFFSET + REBATE_M) && near(xs[1] ?? 0, OFFSET + W - REBATE_M)).toBe(true);
    expect(arcs.every((a) => near(a.center.y, JAMB / 2))).toBe(true);
  });

  it("flipping side puts both arcs on the frame's other face; the hinge changes nothing", () => {
    expect(of(draw({ kind: "twoLeaf", width: W, side: "right" }), "arc").every((a) => near(a.center.y, -JAMB / 2))).toBe(true);
    expect(draw({ kind: "twoLeaf", width: W, hinge: "b" })).toEqual(draw({ kind: "twoLeaf", width: W }));
  });

  it("draws the window's frames only at the detailed level", () => {
    expect(of(draw({ kind: "twoLeaf", width: W }), "polygon")).toHaveLength(1);
    expect(of(draw({ kind: "twoLeaf", width: W }, true), "polygon").length).toBeGreaterThan(2);
  });
});

describe("a double door (openkinds)", () => {
  const W = 1.2;

  it("draws two leaves of half the clear width hung in both frames' rebates, each with its arc on the side face", () => {
    const arcs = of(draw({ kind: "double", width: W }), "arc");
    expect(arcs).toHaveLength(2);
    for (const a of arcs) expect(a.radius).toBeCloseTo((W - 2 * REBATE_M) / 2, 6);
    const xs = arcs.map((a) => a.center.x).sort((p, q) => p - q);
    expect(near(xs[0] ?? 0, OFFSET + REBATE_M) && near(xs[1] ?? 0, OFFSET + W - REBATE_M)).toBe(true);
    expect(arcs.every((a) => near(a.center.y, 0.1))).toBe(true);
  });

  it("flipping side moves both to the other face; at the detailed level it has both door frames", () => {
    expect(of(draw({ kind: "double", width: W, side: "right" }), "arc").every((a) => near(a.center.y, -0.1))).toBe(true);
    const simple = of(draw({ kind: "double", width: W }), "polygon").length;
    expect(of(draw({ kind: "double", width: W }, true), "polygon").length).toBeGreaterThanOrEqual(simple + 4); // two frames, two outlined leaves
  });
});

describe("a pocket door (openkinds)", () => {
  const W = 0.8;
  const dashed = (ps: readonly Primitive[]) => of(ps, "segment").filter((q) => q.dash !== undefined);

  it("draws its leaf dashed on the wall's axis over the pocket, one width past its hinge end", () => {
    for (const [hinge, from, to] of [["b", OFFSET + W, OFFSET + 2 * W], ["a", OFFSET - W, OFFSET]] as const) {
      const lines = dashed(draw({ kind: "pocket", width: W, hinge }));
      expect(lines.length, hinge).toBeGreaterThanOrEqual(2);
      const xs = lines.flatMap((l) => [l.a.x, l.b.x]);
      const ys = lines.flatMap((l) => [l.a.y, l.b.y]);
      expect(Math.min(...xs), hinge).toBeCloseTo(from, 6);
      expect(Math.max(...xs), hinge).toBeCloseTo(to, 6);
      expect(Math.max(...ys.map(Math.abs)), hinge).toBeLessThan(0.05); // on the axis, inside the 0.20 wall
    }
  });

  it("fills its pocket with the span's colour under the dashes, a light slot in a black or grey wall (openkinds.40)", () => {
    const ps = draw({ kind: "pocket", width: W, hinge: "b" });
    const slot = of(ps, "polygon").find((q) => q.color === CANVAS_STYLE.spanBackground && Math.min(...q.points.map((p) => p.x)) > OFFSET + W - 1e-6);
    const xs = slot?.points.map((p) => p.x) ?? [];
    const ys = slot?.points.map((p) => p.y) ?? [];
    expect([Math.min(...xs), Math.max(...xs)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([OFFSET + W, OFFSET + 2 * W]);
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(LEAF_M / 2, 6);
    const lastSlot = ps.findIndex((q) => q === slot);
    expect(ps.slice(lastSlot).some((q) => q.kind === "segment" && q.dash !== undefined)).toBe(true); // the dashes on top
  });

  it("its frames are plain jambs with no stop, the hinge end's split by the slot its leaf slides through (openkinds.38)", () => {
    // Hinged at a: the pocket runs west from x 2, the free jamb stands at x 2.8. The span's own quad is the wide one.
    const jambs = of(draw({ kind: "pocket", width: W }, true), "polygon").filter((q) => Math.max(...q.points.map((p) => p.x)) - Math.min(...q.points.map((p) => p.x)) < W / 2);
    const box = (q: (typeof jambs)[number]) => {
      const [xs, ys] = [q.points.map((p) => p.x), q.points.map((p) => p.y)];
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6);
    };
    expect(jambs.every((q) => q.points.length === 4)).toBe(true); // rectangles, no L
    expect(jambs.map(box).sort((m, n) => (m[0] ?? 0) - (n[0] ?? 0) || (m[2] ?? 0) - (n[2] ?? 0))).toEqual([
      [OFFSET, OFFSET + JAMB, -0.1, -0.02],
      [OFFSET, OFFSET + JAMB, 0.02, 0.1],
      [OFFSET + W - JAMB, OFFSET + W, -0.1, 0.1],
    ].map((b) => b.map((v) => Math.round(v * 1e6) / 1e6)));
  });

  it("has no arc and draws the same whichever side it's on", () => {
    expect(of(draw({ kind: "pocket", width: W }), "arc")).toEqual([]);
    expect(dashed(draw({ kind: "pocket", width: W, side: "right" }))).toEqual(dashed(draw({ kind: "pocket", width: W, side: "left" })));
  });
});

describe("a folding door (openkinds.02, .08, AC-02)", () => {
  const W = 0.9;
  const STACK = 0.1 + 0.11 * W;
  const solid = (ps: readonly Primitive[]) => of(ps, "segment").filter((q) => q.dash === undefined);
  const dashed = (ps: readonly Primitive[]) => of(ps, "segment").filter((q) => q.dash !== undefined);
  /** The zigzag: the solid segments off the wall's face. */
  const zigzag = (ps: readonly Primitive[]) => solid(ps).filter((q) => Math.abs(q.a.y) > 0.1 + 1e-6 || Math.abs(q.b.y) > 0.1 + 1e-6);

  it("folds into a zigzag at its hinge end, 0.10 + 0.11 × width long and 0.15 m deep, centred on its side face (openkinds.36), one fold per leaf", () => {
    const z = zigzag(draw({ kind: "folding", width: W }));
    expect(z.length).toBeGreaterThanOrEqual(4);
    const xs = z.flatMap((q) => [q.a.x, q.b.x]);
    const ys = z.flatMap((q) => [q.a.y, q.b.y]);
    expect(Math.min(...xs)).toBeCloseTo(OFFSET + JAMB, 6); // hung inside its frame, as every door (smalls.16)
    expect(Math.max(...xs)).toBeCloseTo(OFFSET + JAMB + STACK, 6);
    expect(Math.min(...ys)).toBeCloseTo(0.1 - FOLD_DEPTH / 2, 6); // its axis on the face, in line with the closing line
    expect(Math.max(...ys)).toBeCloseTo(0.1 + FOLD_DEPTH / 2, 6);
  });

  it("draws a dashed line across the rest of the span, where it closes", () => {
    const d = dashed(draw({ kind: "folding", width: W }));
    expect(d).toHaveLength(1);
    const xs = [d[0]?.a.x ?? 0, d[0]?.b.x ?? 0].sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(OFFSET + JAMB + STACK, 6);
    expect(xs[1]).toBeCloseTo(OFFSET + W - JAMB, 6);
  });

  it("flipping hinge moves the zigzag to the other end; flipping side to the other face", () => {
    const b = zigzag(draw({ kind: "folding", width: W, hinge: "b" })).flatMap((q) => [q.a.x, q.b.x]);
    expect(Math.min(...b)).toBeCloseTo(OFFSET + W - JAMB - STACK, 6);
    const right = zigzag(draw({ kind: "folding", width: W, side: "right" })).flatMap((q) => [q.a.y, q.b.y]);
    expect(Math.min(...right)).toBeCloseTo(-0.1 - FOLD_DEPTH / 2, 6);
    expect(Math.max(...right)).toBeCloseTo(-0.1 + FOLD_DEPTH / 2, 6);
  });
});

describe("a sliding glass door (openkinds)", () => {
  const W = 2.4;
  const OVERLAP = 0.05;
  const along = (ps: readonly Primitive[]) => of(ps, "segment").filter((q) => Math.abs(q.a.y - q.b.y) < 1e-9 && Math.abs(q.a.y) < 0.05);

  it("draws two sashes of about half its width on two tracks either side of the axis, overlapping in the middle, the same on either side", () => {
    const sashes = along(draw({ kind: "slidingGlass", width: W })).filter((q) => q.color !== CANVAS_STYLE.openingGlass);
    expect(sashes).toHaveLength(2);
    const ys = sashes.map((q) => q.a.y).sort((p, q) => p - q);
    expect(ys[0]).toBeLessThan(0);
    expect(ys[1]).toBeGreaterThan(0);
    const spans = sashes.map((q) => [Math.min(q.a.x, q.b.x), Math.max(q.a.x, q.b.x)]).sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0));
    expect(spans[0]?.[0]).toBeCloseTo(OFFSET + JAMB, 6);
    expect(spans[0]?.[1]).toBeCloseTo(OFFSET + W / 2 + OVERLAP / 2, 6);
    expect(spans[1]?.[0]).toBeCloseTo(OFFSET + W / 2 - OVERLAP / 2, 6);
    expect(spans[1]?.[1]).toBeCloseTo(OFFSET + W - JAMB, 6);
    expect(along(draw({ kind: "slidingGlass", width: W, side: "right" }))).toEqual(along(draw({ kind: "slidingGlass", width: W })));
  });

  it("is glazed: each sash holds a glass line at the detailed level; no arc", () => {
    expect(glassLines(draw({ kind: "slidingGlass", width: W }, true))).toHaveLength(2);
    expect(of(draw({ kind: "slidingGlass", width: W }), "arc")).toEqual([]);
  });
});

describe("a curtain (openkinds.01, AC-01)", () => {
  const W = 0.8;
  /** The wave: the solid segments off the wall's faces. */
  const wave = (ps: readonly Primitive[]) => of(ps, "segment").filter((q) => Math.abs(q.a.y) > 0.1 + 1e-6 && Math.abs(q.b.y) > 0.1 + 1e-6);

  it("draws a wavy line across its whole span, just off the face of its side", () => {
    const w = wave(draw({ kind: "curtain", width: W }));
    expect(w.length).toBeGreaterThanOrEqual(8);
    const xs = w.flatMap((q) => [q.a.x, q.b.x]);
    expect(Math.min(...xs)).toBeCloseTo(OFFSET, 6);
    expect(Math.max(...xs)).toBeCloseTo(OFFSET + W, 6);
    const ys = w.flatMap((q) => [q.a.y, q.b.y]);
    expect(Math.min(...ys)).toBeGreaterThan(0.1);
    expect(Math.max(...ys)).toBeLessThan(0.25);
    expect(new Set(ys.map((y) => y.toFixed(4))).size).toBeGreaterThan(2); // it waves
  });

  it("flipping side moves the wave to the other face; no arc, no frames at the detailed level", () => {
    expect(wave(draw({ kind: "curtain", width: W, side: "right" })).every((q) => q.a.y < -0.1 && q.b.y < -0.1)).toBe(true);
    expect(of(draw({ kind: "curtain", width: W }), "arc")).toEqual([]);
    expect(of(draw({ kind: "curtain", width: W }, true), "polygon")).toEqual(of(draw({ kind: "curtain", width: W }), "polygon"));
  });
});

describe("an open passage (openkinds, AC-12)", () => {
  const W = 0.9;
  const dashed = (ps: readonly Primitive[]) => of(ps, "segment").filter((q) => q.dash !== undefined);

  it("draws two dashed lines across its span for the lintel, on the wall's faces, and no leaf, arc or frame", () => {
    for (const detailed of [false, true]) {
      const ps = draw({ kind: "passage", width: W }, detailed);
      const d = dashed(ps);
      expect(d).toHaveLength(2);
      expect(d.map((q) => Math.abs(q.a.y)).every((y) => near(y, 0.1))).toBe(true);
      for (const q of d) expect([Math.min(q.a.x, q.b.x), Math.max(q.a.x, q.b.x)]).toEqual([OFFSET, OFFSET + W]);
      expect(of(ps, "arc")).toEqual([]);
      expect(of(ps, "polygon")).toHaveLength(1); // the span only
    }
  });
});
