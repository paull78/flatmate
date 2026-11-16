import { describe, expect, it } from "vitest";
import { emptyDocument, levels, rectangleRoom, type Command, type Document, type Level, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE, PRESENTATION_STYLE, type PlanStyle } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import type { Field } from "../src/view/view-model-types";
import { faces3d } from "../src/view3d/faces";
import { view3dItems } from "../src/view3d/items";
import { sectionPicture } from "../src/view3d/section-picture";
import { stairFaces } from "../src/view3d/stair-faces";
import { STYLE_3D } from "../src/view3d/style";
import type { Face3d, PieceItem } from "../src/view3d/types";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A stair's Handrail setting (AC-13, guards.28): Railing or Glass in its Properties, one setStair, one undo; Glass draws its
// rail line in the guards' glass ink on the plan, and in 3D an opaque pane under the rail with no posts. The 8 × 6 room's
// loft is at x 0.1–2.1, y 1.5–4.5, top 2.15; a stair's back on its edge at (2.1, 3) runs +x to its foot at x 5.088, y
// 2.55–3.45: 12 risers of 0.179, 11 goings of 0.2716, its rails 0.02 in from its sides.

const LOFT = "l/k0";
const STAIR = "ps/s0/o0";
const RISER = 2.15 / 12;
const RUN = 2.988;
const GOING = RUN / 11;
const FOOT = 5.088;
const RAIL_UNDER = 0.9 - 0.04; // the pane's top: the rail's top less its thickness
const room = (...more: Command[]): Document => withCommands(
  emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const glassLoft: Command = { type: "setDeck", deckId: LOFT, guard: "glass" };
const place = (kind = "stair", shape: "straight" | "l-right" = "straight"): Command => ({ type: "placeStair", opId: "ps", state: "s0", kind, surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape });

describe("Handrail in a stair's Properties", () => {
  const opened = (doc: Document, placement = "ps/s0/p0"): FakeShell => {
    const s = FakeShell.withDocument(doc);
    s.ui({ type: "selectEntity", ref: { table: "placements", id: placement } });
    return s;
  };
  const handrail = (s: FakeShell): Field | undefined => {
    const p = s.view().properties;
    return "fields" in p ? p.fields.find((f) => f.id === "handrail") : undefined;
  };

  const fieldOf = (s: FakeShell, id: string): Field | undefined => {
    const p = s.view().properties;
    return "fields" in p ? p.fields.find((f) => f.id === id) : undefined;
  };
  const OPTIONS = [{ value: "railing", label: "Railing" }, { value: "glass", label: "Glass" }, { value: "none", label: "None" }];

  it("a flight offers Left and Right handrails, Railing, Glass or None, with the stored values (edges.06)", () => {
    const s = opened(room(place()));
    expect(fieldOf(s, "handrailLeft")).toMatchObject({ section: "Stair", label: "Left handrail", value: "railing", readOnly: false });
    expect(fieldOf(s, "handrailRight")).toMatchObject({ section: "Stair", label: "Right handrail", value: "railing", readOnly: false });
    expect(fieldOf(s, "handrailLeft")?.options).toEqual(OPTIONS);
    expect(handrail(s)).toBeUndefined();
    expect(fieldOf(opened(room(glassLoft, place())), "handrailRight")?.value).toBe("glass");
  });

  it("None on Right sends setStair for the right side only, and one undo restores it", () => {
    const s = opened(room(place()));
    s.ui({ type: "setField", fieldId: "handrailRight", value: "none" });
    expect(s.doc().objects[STAIR]?.handrails).toEqual({ left: "railing", right: "none" });
    expect(fieldOf(s, "handrailRight")?.value).toBe("none");
    s.ui({ type: "undo" });
    expect(s.doc().objects[STAIR]?.handrails).toEqual({ left: "railing", right: "railing" });
  });

  it("a value no choice offers is ignored", () => {
    const s = opened(room(place()));
    s.ui({ type: "setField", fieldId: "handrailLeft", value: "wood" });
    expect(s.doc().objects[STAIR]?.handrails).toEqual({ left: "railing", right: "railing" });
  });

  it("a spiral shows one Handrail with None; a rung ladder none", () => {
    const spiral = opened(room(place("spiralStair")));
    expect(handrail(spiral)).toMatchObject({ label: "Handrail", value: "railing" });
    expect(handrail(spiral)?.options).toEqual(OPTIONS);
    expect(fieldOf(spiral, "handrailLeft")).toBeUndefined();
    spiral.ui({ type: "setField", fieldId: "handrail", value: "none" });
    expect(spiral.doc().objects[STAIR]?.handrail).toBe("none");
    const ladder = opened(room(place("rungLadder")));
    expect("fields" in ladder.view().properties).toBe(true);
    expect(handrail(ladder)).toBeUndefined();
    expect(fieldOf(ladder, "handrailLeft")).toBeUndefined();
  });

  it("each flight of an L has both sides", () => {
    const l = room(place("stair", "l-right"));
    expect(fieldOf(opened(l, "ps/s0/p0"), "handrailLeft")).toBeDefined();
    expect(fieldOf(opened(l, "ps/s1/p0"), "handrailRight")).toBeDefined();
  });
});

describe("a side set to None (edges AC-08)", () => {
  const noneRight: Command = { type: "setStair", objectId: STAIR, handrailRight: "none" };

  it("draws no rail line on that side of the plan, and the other side's stays", () => {
    expect(linesAt(atFloor(room(place(), noneRight)), RIGHT)).toEqual([]);
    expect(linesAt(atFloor(room(place(), noneRight)), LEFT)).toHaveLength(1);
  });

  it("has no 3D faces on that side", () => {
    const ys = (doc: Document): number[] => railFaces(pieceOf(doc)).flatMap((f) => f.points.map((q) => q.y));
    expect(ys(room(place(), noneRight)).every((y) => y < 3)).toBe(true);
    expect(ys(room(place())).some((y) => y > 3)).toBe(true);
  });
});

type Segment = Extract<Primitive, { kind: "segment" }>;
type Arc = Extract<Primitive, { kind: "arc" }>;
const atFloor = (doc: Document, style: PlanStyle = CANVAS_STYLE, selected = "") => objectsLayer(doc, floorView(doc, "s0"), style, selected, 80);
/** The lines along the run at world y `y`. */
const linesAt = (ps: readonly Primitive[], y: number): Segment[] =>
  ps.filter((p): p is Segment => p.kind === "segment" && Math.abs(p.a.y - y) < 1e-6 && Math.abs(p.b.y - y) < 1e-6);
const LEFT = 3 - 0.43;
const RIGHT = 3 + 0.43;

describe("a Glass stair on the plan", () => {
  it("draws its rail lines in the guards' glass ink, a Railing's staying in the guards' ink", () => {
    for (const y of [LEFT, RIGHT]) {
      const [glass] = linesAt(atFloor(room(glassLoft, place())), y);
      expect(glass?.color).toBe(CANVAS_STYLE.openingGlass);
      expect(glass?.width).toEqual({ px: CANVAS_STYLE.guard.line });
      const [railing] = linesAt(atFloor(room(place())), y);
      expect(railing?.color).toBe(CANVAS_STYLE.guard.ink);
    }
    expect(CANVAS_STYLE.openingGlass).not.toBe(CANVAS_STYLE.guard.ink);
  });

  it("on paper, in paper's glass ink", () => {
    const [line] = linesAt(atFloor(room(glassLoft, place()), PRESENTATION_STYLE), LEFT);
    expect(line?.color).toBe(PRESENTATION_STYLE.openingGlass);
  });

  it("still takes the selection's colour with its stair", () => {
    const [line] = linesAt(atFloor(room(glassLoft, place()), CANVAS_STYLE, "ps/s0/p0"), LEFT);
    expect(line?.color).not.toBe(CANVAS_STYLE.openingGlass);
    expect(line?.color).not.toBe(CANVAS_STYLE.guard.ink);
  });

  it("a spiral's balustrade and landing rail take it too", () => {
    const loftLevel = (doc: Document): Level => {
      const up = levels(doc).find((l) => l.deckIds.includes(LOFT));
      if (!up) throw new Error("no level");
      return up;
    };
    const rails = (doc: Document): Primitive[] => objectsLayer(doc, viewAt("s0", loftLevel(doc)), CANVAS_STYLE, "", 80)
      .filter((p): p is Segment | Arc => (p.kind === "segment" || p.kind === "arc") && "px" in p.width && p.width.px === CANVAS_STYLE.guard.line);
    const glass = rails(room(glassLoft, place("spiralStair")));
    expect(glass.some((p) => p.kind === "arc")).toBe(true);
    expect(glass.some((p) => p.kind === "segment")).toBe(true);
    expect(new Set(glass.map((p) => p.color))).toEqual(new Set([CANVAS_STYLE.openingGlass]));
    expect(new Set(rails(room(place("spiralStair"))).map((p) => p.color))).toEqual(new Set([CANVAS_STYLE.guard.ink]));
  });
});

const pieces = (doc: Document): PieceItem[] => view3dItems(doc, "s0", null, new Set(), false).filter((i): i is PieceItem => i.item === "piece");
const pieceOf = (doc: Document): PieceItem => {
  const [item] = pieces(doc);
  if (!item) throw new Error("no piece");
  return item;
};
/** The faces a piece's rails add, at the end of its list. */
const railFaces = (item: PieceItem): Face3d[] => {
  const bare = { ...item };
  delete bare.handrails;
  delete bare.spiralRails;
  const all = stairFaces("o", item, STYLE_3D.stair, STYLE_3D.glass) ?? [];
  const body = stairFaces("o", bare, STYLE_3D.stair, STYLE_3D.glass) ?? [];
  return all.slice(body.length);
};
const isGlass = (f: Face3d): boolean => f.color === STYLE_3D.glass;
const pitch = (a: number): number => RISER + Math.min(a, RUN - GOING) * (RISER / GOING);
const up = (p: { x: number }): number => FOOT - p.x;

describe("a Glass flight in 3D", () => {
  it("has a pane on each open side from the pitch line to under the rail, following its bend", () => {
    const panes = railFaces(pieceOf(room(glassLoft, place()))).filter(isGlass);
    expect(panes.length).toBeGreaterThan(0);
    const points = panes.flatMap((f) => f.points);
    for (const y of [LEFT, RIGHT]) expect(points.some((p) => Math.abs(p.y - y) < 0.01)).toBe(true);
    for (const p of points) {
      expect(p.z).toBeGreaterThanOrEqual(pitch(up(p)) - 1e-6);
      expect(p.z).toBeLessThanOrEqual(pitch(up(p)) + RAIL_UNDER + 1e-6);
    }
    for (const a of [0, RUN - GOING, RUN]) {
      const at = points.filter((p) => Math.abs(up(p) - a) < 1e-6);
      expect(Math.min(...at.map((p) => p.z)), `at ${a}`).toBeCloseTo(pitch(a), 6);
      expect(Math.max(...at.map((p) => p.z)), `at ${a}`).toBeCloseTo(pitch(a) + RAIL_UNDER, 6);
    }
  });

  it("has no posts: its rail is all that isn't glass", () => {
    const others = railFaces(pieceOf(room(glassLoft, place()))).filter((f) => !isGlass(f));
    expect(others.length).toBeGreaterThan(0);
    for (const p of others.flatMap((f) => f.points)) expect(p.z).toBeGreaterThanOrEqual(pitch(up(p)) + RAIL_UNDER - 1e-6);
  });

  it("the 3D view draws its panes in the style's glass", () => {
    const item = pieceOf(room(glassLoft, place()));
    expect(faces3d(item).some(isGlass)).toBe(true);
    const tinted = { ...STYLE_3D, glass: "#123456" };
    expect(faces3d(item, tinted).some((f) => f.color === "#123456")).toBe(true);
  });

  it("a Railing has no pane, and its posts", () => {
    const faces = railFaces(pieceOf(room(place())));
    expect(faces.some(isGlass)).toBe(false);
    expect(Math.min(...faces.flatMap((f) => f.points.map((p) => p.z)))).toBeCloseTo(RISER, 6);
  });

  it("each flight of an L has its panes", () => {
    const flights = pieces(room(glassLoft, place("stair", "l-right")));
    expect(flights).toHaveLength(2);
    for (const f of flights) expect(railFaces(f).some(isGlass)).toBe(true);
  });

  it("a section past the line shows it as before, by stairFaces, its top on the rail's", () => {
    const facing: Section = { id: "A", a: { x: 1, y: 2 }, b: { x: 7, y: 2 }, side: 1, depth: 2.5 };
    const ps = sectionPicture(room(glassLoft, place()), facing, "s0", CANVAS_STYLE, 70).primitives;
    const over = ps.filter((p): p is Extract<Primitive, { kind: "polygon" }> => p.kind === "polygon" && p.points.every((q) => q.x >= 1.05 && q.x <= 4.1) && Math.max(...p.points.map((q) => q.y)) > 2.2 && Math.max(...p.points.map((q) => q.y)) < 2.95);
    expect(over.length).toBeGreaterThan(0);
    expect(Math.max(...over.flatMap((p) => p.points.map((q) => q.y)))).toBeCloseTo(1.971 + 0.9, 2);
  });
});

describe("a Glass spiral in 3D", () => {
  // The 7 × 3 room's loft is at x 0.1–3.6; the 1.60 spiral's back edge is on its edge at (3.6, 1.5), turned 90°: centre
  // (4.4, 1.5), 10 risers of 0.215; its landing x 3.6–4.4, y 1.5–2.3, top 2.15, with rails on its right (y 2.28) and front (x 4.38).
  const C: Point = { x: 4.4, y: 1.5 };
  const SPIRAL_RISER = 0.215;
  const spiralRoom = (glass: boolean): Document => withCommands(
    emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 3, "st"), { type: "setCeiling", height: 3.4 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.5 }, w: 3.5, d: 2.8, ...(glass ? { guard: "glass" as const } : {}) },
    { type: "placeObject", opId: "s", state: "s0", object: { kind: "spiralStair" }, at: { x: 3.6, y: 1.5 }, rotation: 90, deck: null, reaches: "loft/k0" },
  );
  const onCircle = (p: Point): boolean => Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - 0.78) <= 0.05;
  const onLanding = (p: Point): boolean => (Math.abs(p.y - 2.28) <= 0.021 && p.x >= 3.6 - 1e-6 && p.x <= 4.4 + 1e-6) || (Math.abs(p.x - 4.38) <= 0.021 && p.y >= 1.5 - 1e-6 && p.y <= 2.3 + 1e-6);
  /** The treads' line `a` degrees clockwise from world 90°, the first tread's low end. */
  const treadsAt = (p: Point): number => {
    const a = (90 - (Math.atan2(p.y - C.y, p.x - C.x) * 180) / Math.PI + 360) % 360;
    return SPIRAL_RISER + ((2.15 - SPIRAL_RISER) * a) / 270;
  };

  it("its balustrade has panes from the treads' line to under its rail, and no posts", () => {
    const faces = railFaces(pieceOf(spiralRoom(true))).filter((f) => f.points.every((p) => onCircle(p) && !onLanding(p)));
    const panes = faces.filter(isGlass);
    expect(panes.length).toBeGreaterThan(0);
    const points = panes.flatMap((f) => f.points);
    expect(Math.min(...points.map((p) => p.z - treadsAt(p)))).toBeCloseTo(0, 2); // standing on the treads' line
    for (const p of points) {
      expect(p.z).toBeGreaterThanOrEqual(treadsAt(p) - 0.01);
      expect(p.z).toBeLessThanOrEqual(treadsAt(p) + RAIL_UNDER + 0.01);
    }
    for (const p of faces.filter((f) => !isGlass(f)).flatMap((f) => f.points)) expect(p.z).toBeGreaterThan(treadsAt(p) + RAIL_UNDER - 0.01);
  });

  it("its landing rail is a pane under a rail, as a deck's Glass is", () => {
    const faces = railFaces(pieceOf(spiralRoom(true))).filter((f) => f.points.every((p) => onLanding(p) && p.z >= 2.15 - 1e-6));
    const panes = faces.filter(isGlass);
    expect(panes.length).toBeGreaterThan(0);
    expect(Math.min(...panes.flatMap((f) => f.points.map((p) => p.z)))).toBeCloseTo(2.15, 6);
    expect(Math.max(...panes.flatMap((f) => f.points.map((p) => p.z)))).toBeCloseTo(2.15 + RAIL_UNDER, 6);
    for (const p of faces.filter((f) => !isGlass(f)).flatMap((f) => f.points)) expect(p.z).toBeGreaterThanOrEqual(2.15 + RAIL_UNDER - 1e-6);
  });

  it("a Railing spiral has no pane", () => {
    expect(railFaces(pieceOf(spiralRoom(false))).some(isGlass)).toBe(false);
  });
});
