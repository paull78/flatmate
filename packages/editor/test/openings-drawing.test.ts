import { describe, expect, it } from "vitest";
import { geometryOf, type Command, type Document, type Opening, type OpeningGeometry } from "@fm/domain";
import type { Field } from "../src/view/view-model-types";
import { CARD_STYLE } from "../src/view/card-look";
import { COLORS } from "../src/view/colors";
import { LEAF_M, REBATE_M } from "../src/view/opening-parts";
import { FRAME_M, openingPrimitives, openingsDetailed, parkedBox, styleLook } from "../src/view/openings-layer";
import { drawnBounds } from "../src/view/picture";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Doors and windows to common drafting conventions (AC-07; reports/Drawing doors and windows.md): line weights in order,
// a leaf in outline, a three-line window, and frames only when a 6 cm frame is big enough to read.

const docWith = (kind: Opening["kind"], glazed = false, width = 1, offset = 2): Document => {
  const base = roomDoc();
  const wall = Object.values(base.walls).find((w) => {
    const [a, b] = [base.joints[w.a], base.joints[w.b]];
    return a && b && a.y === 0 && b.y === 0;
  });
  if (!wall) throw new Error("no wall along y 0");
  const add: Command = { type: "addOpening", opId: "o", wall: wall.id, kind, offset, width, side: "left", hinge: "a" };
  const doc = withCommands(base, add);
  const row = doc.openings["o/d0"] ?? Object.values(doc.openings)[0];
  return row && glazed ? withCommands(doc, { type: "setOpening", openingId: row.id, glazed: true }) : doc;
};
const opening = (doc: Document): { o: Opening; g: OpeningGeometry } => {
  const o = Object.values(doc.openings)[0];
  const g = o ? geometryOf(doc, o) : null;
  if (!o || !g) throw new Error("no opening");
  return { o, g };
};
const draw = (kind: Opening["kind"], detailed: boolean, style = CANVAS_STYLE, glazed = false): Primitive[] => {
  const { o, g } = opening(docWith(kind, glazed));
  return openingPrimitives(o, g, styleLook(style), true, detailed);
};
const px = (p: Primitive): number => ((p.kind === "segment" || p.kind === "arc") && "px" in p.width ? p.width.px : Number.NaN);
const of = <K extends Primitive["kind"]>(ps: readonly Primitive[], kind: K): Extract<Primitive, { kind: K }>[] => ps.filter((p): p is Extract<Primitive, { kind: K }> => p.kind === kind);

describe("the weights", () => {
  it.each([["the canvas", CANVAS_STYLE], ["paper", PRESENTATION_STYLE]] as const)("on %s rank frame and leaf, then glass and low wall, then the arc", (_, style) => {
    const w = style.openingWeights;
    expect(w.frame).toBeGreaterThan(w.line);
    expect(w.line).toBeGreaterThan(w.hair);
  });

  it("match the spec's first numbers: 1.25, 1, 0.75 px and 0.25, 0.18, 0.13 mm", () => {
    expect(CANVAS_STYLE.openingWeights).toEqual({ frame: 1.25, line: 1, hair: 0.75 });
    expect(PRESENTATION_STYLE.openingWeights).toEqual({ frame: 0.25, line: 0.18, hair: 0.13 });
  });
});

describe("a swing door, simple", () => {
  it("its leaf is a line at the frame's weight, never a 4 cm solid bar", () => {
    const leaf = of(draw("swing", false), "segment");
    expect(leaf).toHaveLength(1);
    expect(leaf[0]?.width).toEqual({ px: CANVAS_STYLE.openingWeights.frame });
  });

  it("its arc is a hairline", () => {
    const [arc] = of(draw("swing", false), "arc");
    expect(arc?.width).toEqual({ px: CANVAS_STYLE.openingWeights.hair });
  });
});

describe("a swing door, detailed", () => {
  it("hangs in its frames' rebates: the hinge at the rebate's corner on the face, the leaf and arc the clear width between the rebates (the user's reference)", () => {
    const { g } = opening(docWith("swing"));
    const [arc] = of(draw("swing", true), "arc");
    const toFree = (g.free.x - g.hinge.x) * g.along.x + (g.free.y - g.hinge.y) * g.along.y >= 0 ? 1 : -1;
    expect(arc?.center.x).toBeCloseTo(g.hinge.x + toFree * g.along.x * REBATE_M, 6);
    expect(arc?.center.y).toBeCloseTo(g.hinge.y + toFree * g.along.y * REBATE_M, 6);
    expect(arc?.radius).toBeCloseTo(1 - 2 * REBATE_M, 6);
  });

  it("its leaf stands in the opening, off the frame: from the hinge towards the free end, LEAF_M thick", () => {
    const { g } = opening(docWith("swing"));
    const toFree = (g.free.x - g.hinge.x) * g.along.x + (g.free.y - g.hinge.y) * g.along.y >= 0 ? 1 : -1;
    const leaf = of(draw("swing", true), "polygon").find((p) => p.points.length === 4 && Math.max(...p.points.map((q) => (q.x - g.hinge.x) * g.normal.x + (q.y - g.hinge.y) * g.normal.y)) > 0.5);
    const along = (leaf?.points ?? []).map((q) => toFree * ((q.x - g.hinge.x) * g.along.x + (q.y - g.hinge.y) * g.along.y));
    expect(Math.min(...along)).toBeCloseTo(REBATE_M, 6);
    expect(Math.max(...along)).toBeCloseTo(REBATE_M + LEAF_M, 6);
  });

  it("a double door has its lever handle on one leaf only (the user's review)", () => {
    const { g } = opening(docWith("double"));
    const up = (q: { x: number; y: number }) => (q.x - g.hinge.x) * g.normal.x + (q.y - g.hinge.y) * g.normal.y;
    const handles = of(draw("double", true), "polygon").filter((p) => p.points.length === 6 && Math.min(...p.points.map(up)) > 0.2);
    expect(handles).toHaveLength(2); // one leaf's two faces
  });

  it("has a lever handle in outline on each face near its free end, at the detailed level only", () => {
    const { g } = opening(docWith("swing"));
    const toFree = (g.free.x - g.hinge.x) * g.along.x + (g.free.y - g.hinge.y) * g.along.y >= 0 ? 1 : -1;
    const up = (q: { x: number; y: number }) => (q.x - g.hinge.x) * g.normal.x + (q.y - g.hinge.y) * g.normal.y;
    const along = (q: { x: number; y: number }) => toFree * ((q.x - g.hinge.x) * g.along.x + (q.y - g.hinge.y) * g.along.y);
    const handles = (ps: Primitive[]) => of(ps, "polygon").filter((p) => p.points.length === 6 && Math.min(...p.points.map(up)) > 0.5);
    expect(handles(draw("swing", false))).toHaveLength(0);
    const found = handles(draw("swing", true));
    expect(found).toHaveLength(2); // an L on each face: a stem and a lever
    const radius = 1 - 2 * REBATE_M;
    for (const h of found) {
      for (const q of h.points) { expect(up(q)).toBeLessThanOrEqual(radius - 0.05); expect(up(q)).toBeGreaterThanOrEqual(radius - 0.3); }
      const [lo, hi] = [Math.min(...h.points.map(along)), Math.max(...h.points.map(along))];
      expect(hi - lo).toBeGreaterThan(0.05); // it has a thickness: no stick
      expect(Math.max(...h.points.map(up)) - Math.min(...h.points.map(up))).toBeGreaterThan(0.1); // the lever, along the leaf
    }
    // one starts at each face of the leaf: the hinge side's at the rebate, the other LEAF_M further into the opening
    expect(found.map((h) => Math.max(...h.points.map(along))).sort((x, y) => x - y)[0]).toBeCloseTo(REBATE_M, 6);
    expect(found.map((h) => Math.min(...h.points.map(along))).sort((x, y) => x - y)[1]).toBeCloseTo(REBATE_M + LEAF_M, 6);
    // drawn at the line weight, lighter than the leaf and the frames
    const light = of(draw("swing", true), "segment").filter((s) => "px" in s.width && s.width.px === CANVAS_STYLE.openingWeights.line && Math.min(up(s.a), up(s.b)) > 0.5);
    expect(light).toHaveLength(12);
  });

  it("has two stepped frames through the whole wall, at the ends of the span (smalls.18)", () => {
    const { g } = opening(docWith("swing"));
    const inWall = (p: { points: readonly { x: number; y: number }[] }) => Math.max(...p.points.map((q) => (q.x - g.hinge.x) * g.normal.x + (q.y - g.hinge.y) * g.normal.y)) < 1e-6; // the handles stand out in the room
    const frames = of(draw("swing", true), "polygon").filter((p) => p.color === styleLook(CANVAS_STYLE).span && p.points.length === 6 && inWall(p));
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      const across = f.points.map((p) => (p.x - g.hinge.x) * g.normal.x + (p.y - g.hinge.y) * g.normal.y);
      expect(Math.max(...across)).toBeCloseTo(0, 6); // from the opening side's face
      expect(Math.min(...across)).toBeCloseTo(-g.thickness, 6); // to the other face
      for (const p of f.points) {
        const along = (p.x - g.start.x) * g.along.x + (p.y - g.start.y) * g.along.y;
        expect(along).toBeGreaterThanOrEqual(-1e-6);
        expect(along).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it("each frame is rebated at the opening side's face, where the closed leaf sits, and wider behind it, where the leaf stops", () => {
    const { g } = opening(docWith("swing"));
    const frame = of(draw("swing", true), "polygon").find((p) => p.color === styleLook(CANVAS_STYLE).span && p.points.length === 6);
    const widthAt = (depth: number): number => {
      const pts = (frame?.points ?? []).map((p) => ({ along: (p.x - g.start.x) * g.along.x + (p.y - g.start.y) * g.along.y, across: (p.x - g.hinge.x) * g.normal.x + (p.y - g.hinge.y) * g.normal.y }));
      const inBand = pts.filter((q) => Math.abs(q.across + depth) < 1e-6);
      return Math.max(...inBand.map((q) => q.along)) - Math.min(...inBand.map((q) => q.along));
    };
    expect(widthAt(0)).toBeCloseTo(REBATE_M, 6);
    expect(widthAt(g.thickness)).toBeCloseTo(FRAME_M, 6);
  });

  it("its leaf is an outline, at the frame's weight", () => {
    const ps = draw("swing", true);
    const edges = of(ps, "segment").filter((s) => "px" in s.width && s.width.px === CANVAS_STYLE.openingWeights.frame);
    expect(edges.length).toBe(4 + 12); // the leaf's four edges and each stepped frame's six
  });

  it("a frame never runs past a thin wall", () => {
    const { o, g } = opening(docWith("swing"));
    const thin = { ...g, thickness: 0.05 };
    const ps = openingPrimitives(o, thin, styleLook(CANVAS_STYLE), false, true);
    const [frame] = of(ps, "polygon");
    const across = (frame?.points ?? []).map((p) => (p.x - g.hinge.x) * g.normal.x + (p.y - g.hinge.y) * g.normal.y);
    expect(Math.min(...across)).toBeCloseTo(-0.05, 6);
    expect(Math.max(...across)).toBeCloseTo(0, 6);
    expect(of(ps, "arc")[0]?.radius).toBeCloseTo(1 - 2 * REBATE_M, 6); // the leaf hangs at the rebate, 4 cm in, in a 5 cm wall too
  });

  it("a glazed leaf adds a glass line", () => {
    const glassed = of(draw("swing", true, CANVAS_STYLE, true), "segment").filter((s) => s.color === CANVAS_STYLE.openingGlass);
    expect(glassed).toHaveLength(1);
  });
});

describe("a window", () => {
  it("simple: two low-wall lines on the faces, one glass line on the axis, no tint", () => {
    const { g } = opening(docWith("window"));
    const ps = draw("window", false);
    const lines = of(ps, "segment");
    expect(lines).toHaveLength(3);
    expect(lines.filter((s) => s.color === CANVAS_STYLE.openingLine)).toHaveLength(2);
    const [glass] = lines.filter((s) => s.color === CANVAS_STYLE.openingGlass);
    expect(glass?.a).toEqual(g.start);
    expect(of(ps, "polygon").map((p) => p.color)).toEqual([CANVAS_STYLE.spanBackground]);
    expect(ps.some((p) => "color" in p && p.color === COLORS.windowTint)).toBe(false);
  });

  it("detailed: frames, two sash lines and the glass between them", () => {
    const ps = draw("window", true);
    const lines = of(ps, "segment");
    expect(lines.filter((s) => "px" in s.width && s.width.px === CANVAS_STYLE.openingWeights.hair)).toHaveLength(2);
    expect(lines.filter((s) => s.color === CANVAS_STYLE.openingGlass)).toHaveLength(1);
    expect(lines.filter((s) => "px" in s.width && s.width.px === CANVAS_STYLE.openingWeights.frame)).toHaveLength(8);
  });

  it("on paper the glass is ink", () => {
    const ps = draw("window", false, PRESENTATION_STYLE);
    expect(of(ps, "segment").every((s) => s.color === PRESENTATION_STYLE.openingLine)).toBe(true);
    expect(PRESENTATION_STYLE.openingGlass).toBe(PRESENTATION_STYLE.openingLine);
  });
});

describe("a sliding door", () => {
  it("simple: a line, not a bar; detailed: an outline", () => {
    expect(of(draw("sliding", false), "segment").map(px).filter((w) => w === CANVAS_STYLE.openingWeights.frame).length).toBeGreaterThanOrEqual(1);
    expect(draw("sliding", false).some((p) => p.kind === "segment" && "m" in p.width)).toBe(false);
    expect(of(draw("sliding", true), "polygon").length).toBeGreaterThanOrEqual(2);
  });
});

describe("which level of detail", () => {
  it("on paper: 1:50 yes, 1:100 no, by a 6 cm frame reaching 1 mm", () => {
    expect(openingsDetailed(PRESENTATION_STYLE, 1000 / 50)).toBe(true);
    expect(openingsDetailed(PRESENTATION_STYLE, 1000 / 100)).toBe(false);
  });

  it("on the canvas: from about 4 px (smalls.14)", () => {
    expect(openingsDetailed(CANVAS_STYLE, 67)).toBe(true);
    expect(openingsDetailed(CANVAS_STYLE, 66)).toBe(false);
  });

  it("look and cards stay simple at any zoom", () => {
    expect(openingsDetailed(LOOK_STYLE, 1000)).toBe(false);
    expect(openingsDetailed(CARD_STYLE, 1000)).toBe(false);
  });
});

describe("the walls", () => {
  it("are mid-grey on the canvas, black on paper, and an opening's lines stay ink on both", () => {
    expect(CANVAS_STYLE.wall).toBe("#8a8c93");
    expect(PRESENTATION_STYLE.wall).toBe(PRESENTATION_STYLE.openingLine);
    expect(CANVAS_STYLE.openingLine).toBe(COLORS.ink);
  });
});

describe("a sliding door's parked leaf (AC-08)", () => {
  const dashed = (ps: readonly Primitive[]) => of(ps, "segment").filter((p) => p.dash !== undefined);
  const parked = (hinge: "a" | "b"): { ps: Primitive[]; g: OpeningGeometry } => {
    const doc = docWith("sliding");
    const row = Object.values(doc.openings)[0];
    if (!row) throw new Error("no door");
    const set = withCommands(doc, { type: "setOpening", openingId: row.id, hinge });
    const { o, g } = opening(set);
    return { ps: openingPrimitives(o, g, styleLook(CANVAS_STYLE)), g };
  };

  it("is a dashed box a door's width long, off the end `hinge` names, on the opening side's face", () => {
    const { ps, g } = parked("a");
    const box = dashed(ps);
    expect(box).toHaveLength(4);
    const along = box.flatMap((b) => [b.a, b.b]).map((q) => (q.x - g.hinge.x) * (g.hinge.x - g.free.x) + (q.y - g.hinge.y) * (g.hinge.y - g.free.y));
    expect(Math.min(...along)).toBeCloseTo(0, 6);
    expect(Math.max(...along)).toBeCloseTo(1, 6); // the leaf's 1.00 m, away from the free end
    expect(box.every((b) => b.dash === CANVAS_STYLE.deck.dash && "px" in b.width && b.width.px === CANVAS_STYLE.openingWeights.line)).toBe(true);
  });

  it("moves to the other end when `hinge` does", () => {
    const xs = (hinge: "a" | "b"): number[] => dashed(parked(hinge).ps).flatMap((b) => [b.a.x, b.b.x]);
    expect(Math.min(...xs("a"))).toBeLessThan(2);
    expect(Math.max(...xs("b"))).toBeGreaterThan(3);
    expect(Math.min(...xs("b"))).toBeGreaterThanOrEqual(3 - 1e-6);
  });

  it("swing doors and windows have none", () => {
    expect(dashed(draw("swing", true))).toEqual([]);
    expect(dashed(draw("window", true))).toEqual([]);
  });

  it("counts in what the picture draws, so a sheet's fit doesn't cut it off", () => {
    const near = docWith("sliding", false, 1, 0.2);
    const { o, g } = opening(near);
    const reach = Math.min(...parkedBox(o, g).map((p) => p.x));
    expect(reach).toBeLessThan(0);
    expect(drawnBounds(near, "s0")?.min.x).toBeCloseTo(reach, 6);
  });
});

describe("its Properties field (AC-08)", () => {
  it("offers where it parks, sets `hinge`, and undoes; nothing else in the row changes", () => {
    const doc = docWith("sliding");
    const row = Object.values(doc.openings)[0];
    if (!row) throw new Error("no door");
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "selectEntity", ref: { table: "openings", id: row.id } });
    const fields = (x: FakeShell): readonly Field[] => { const p = x.view().properties; return p.kind === "opening" ? p.fields : []; };
    const parks = fields(shell).find((f) => f.id === "hinge");
    expect(parks?.label).toBe("Parks at");
    shell.ui({ type: "setField", fieldId: "hinge", value: "b" });
    const set = shell.doc().openings[row.id];
    expect(set).toEqual({ ...row, hinge: "b" });
    shell.ui({ type: "undo" });
    expect(shell.doc().openings[row.id]).toEqual(row);
  });

  it("a swing door still calls it Hinge", () => {
    const doc = docWith("swing");
    const row = Object.values(doc.openings)[0];
    if (!row) throw new Error("no door");
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "selectEntity", ref: { table: "openings", id: row.id } });
    const p = shell.view().properties;
    expect(p.kind === "opening" ? p.fields.find((f) => f.id === "hinge")?.label : null).toBe("Hinge");
  });
});
