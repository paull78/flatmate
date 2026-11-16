import { describe, expect, it } from "vitest";
import { emptyDocument, execute, levels, unwrap, wallOutlines, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { floorView } from "../src/view/plan-view";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { ghostsLayer, wallsLayer } from "../src/view/walls-layer";
import { FakeShell } from "./fake-shell";
import { floorHash } from "./random-floors";

// A full wall takes the joint (mitres.01, .04): where one wall reaches the cut and the others don't, at an L or a T whose
// stem is the full wall, the other wall ends in a cut straight across its width, filled up to it in the full wall's colour.

const J = { x: 2, y: 2 };
const wall = (opId: string, a: Point, b: Point, thickness = 0.2): Command => ({ type: "addWall", opId, from: { at: a }, to: { at: b }, thickness, base: "floor" });
const build = (cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument());
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

function idAt(doc: Document, a: Point, b: Point): string {
  const at = (id: string, p: Point): boolean => {
    const j = doc.joints[id];
    return j !== undefined && near(j, p);
  };
  const found = Object.values(doc.walls).find((w) => (at(w.a, a) && at(w.b, b)) || (at(w.a, b) && at(w.b, a)));
  if (!found) throw new Error(`no wall ${JSON.stringify([a, b])}`);
  return found.id;
}

const lowered = (doc: Document, ...ends: [Point, Point][]): Document =>
  ends.reduce((d, [a, b]) => unwrap(execute(d, { type: "setWallTop", wallId: idAt(d, a, b), top: 1 })).doc, doc);

const layer = (doc: Document, selected = "", hovered: string | null = null, invalid = ""): readonly Primitive[] =>
  wallsLayer(doc, floorView(doc, null).level, CANVAS_STYLE, selected, hovered, invalid, null);
type Polygon = Extract<Primitive, { kind: "polygon" }>;
const isPolygon = (p: Primitive): p is Polygon => p.kind === "polygon";

/** The fills that aren't a wall's own outline: what this rule adds. */
function added(doc: Document, primitives: readonly Primitive[] = layer(doc)): Polygon[] {
  const outlines = [...wallOutlines(doc).values()];
  const same = (a: readonly Point[], b: readonly Point[]): boolean => a.length === b.length && a.every((p, i) => near(p, b[i] ?? p));
  return primitives.filter(isPolygon).filter((p) => !outlines.some((o) => same(o, p.points)));
}

function area(points: readonly Point[]): number {
  const sum = points.reduce((s, p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    return s + p.x * q.y - q.x * p.y;
  }, 0);
  return Math.abs(sum) / 2;
}

const expectRing = (ring: readonly Point[], points: Point[]): void => {
  expect(ring).toHaveLength(points.length);
  for (const p of points) expect(ring.some((q) => near(q, p)), JSON.stringify(p)).toBe(true);
};

const P = { x: 0.8, y: 2 };
const Q = { x: 2, y: 0.8 };
const corner = (full = 0.2, half = 0.2): Document => lowered(build([wall("a", P, J, full), wall("b", J, Q, half)]), [J, Q]);

const TL = { x: 0.8, y: 2 };
const TR = { x: 3.2, y: 2 };
const TS = { x: 2, y: 3.2 };
const fullStem = (): Document => lowered(build([wall("bar", TL, TR), wall("stem", TS, J)]), [TL, J], [J, TR]);

/** An L whose half wall leaves the joint at `degrees` from the full wall. */
function bent(degrees: number): Document {
  const a = ((180 + degrees) * Math.PI) / 180;
  const q = { x: 2 + 1.2 * Math.cos(a), y: 2 + 1.2 * Math.sin(a) };
  const doc = build([wall("a", P, J), wall("b", J, q)]);
  const half = Object.values(doc.walls).find((w) => w.id.startsWith("b/"));
  if (!half) throw new Error("no half wall");
  return unwrap(execute(doc, { type: "setWallTop", wallId: half.id, top: 1 })).doc;
}

describe("an L of a full and a half wall (AC-01)", () => {
  it("fills the half wall's tip, making a square corner in the wall colour", () => {
    const fills = added(corner());
    expect(fills).toHaveLength(1);
    expectRing(fills[0]?.points ?? [], [{ x: 1.9, y: 1.9 }, { x: 2.1, y: 1.9 }, { x: 2.1, y: 2.1 }]);
    expect(fills[0]?.color).toBe(CANVAS_STYLE.wall);
  });

  it("follows each wall's thickness", () => {
    const fills = added(corner(0.3, 0.1));
    expect(fills).toHaveLength(1);
    expectRing(fills[0]?.points ?? [], [{ x: 1.95, y: 1.85 }, { x: 2.05, y: 1.85 }, { x: 2.05, y: 2.15 }]);
  });

  it("leaves the full wall's own outline as it was", () => {
    const doc = corner();
    const outline = wallOutlines(doc).get(idAt(doc, P, J));
    expect(layer(doc).filter(isPolygon).some((p) => p.points === outline)).toBe(true);
  });
});

describe("a T whose stem is full (AC-02)", () => {
  it("runs the stem through to the bar's far face, across the stem's width", () => {
    const fills = added(fullStem());
    expect(fills).toHaveLength(2);
    const points = fills.flatMap((f) => [...f.points]);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(1.9, 9);
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(1.9, 9);
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(2.1, 9);
    // With the stem's mitred point (0.01 m²), the fills make the whole square, so no point shows.
    expect(fills.reduce((s, f) => s + area(f.points), 0) + 0.01).toBeCloseTo(0.04, 9);
  });
});

describe("a corner that isn't square (AC-03)", () => {
  it("at 120° the fill is a triangle with one side straight across the half wall", () => {
    const fills = added(bent(120));
    expect(fills).toHaveLength(1);
    const ring = fills[0]?.points ?? [];
    expect(ring).toHaveLength(3);
    const a = ((180 + 120) * Math.PI) / 180;
    const along = { x: Math.cos(a), y: Math.sin(a) };
    const across = ring.some((p, i) => {
      const q = ring[(i + 1) % ring.length] ?? p;
      const d = { x: q.x - p.x, y: q.y - p.y };
      return Math.abs(Math.hypot(d.x, d.y) - 0.2) < 1e-3 && Math.abs(d.x * along.x + d.y * along.y) < 1e-3;
    });
    expect(across).toBe(true);
  });

  it("sweeping from 90° to 179° the fill never jumps, and shrinks toward nothing near straight", () => {
    let last = area(added(bent(90))[0]?.points ?? []);
    expect(last).toBeCloseTo(0.02, 3);
    for (let deg = 91; deg <= 179; deg++) {
      const now = added(bent(deg)).reduce((s, f) => s + area(f.points), 0);
      expect(Math.abs(now - last), `${deg}°`).toBeLessThan(0.0015);
      last = now;
    }
    expect(last).toBeLessThan(0.0005);
  });
});

describe("joints this rule leaves alone (AC-05)", () => {
  // Hashes taken before the rule was written, so each draws exactly what it drew.
  const S = { x: 2, y: 0.8 };
  const LEFT_ALONE: [string, () => Document, string][] = [
    ["a T with a full bar", () => lowered(build([wall("bar", TL, TR), wall("stem", J, S)]), [J, S]), "78d8a7cf"],
    ["two full walls at an L", () => build([wall("a", P, J), wall("b", J, Q)]), "c8fcccc3"],
    ["four walls, one full", () => lowered(build([wall("bar", TL, TR), wall("up", TS, J), wall("down", J, S)]), [TL, J], [J, TR], [J, S]), "9dfe8bcb"],
    ["a full wall in line with a half wall", () => lowered(build([wall("a", TL, J), wall("b", J, TR)]), [J, TR]), "c92a9fa8"],
    ["a T with an unequal bar", () => lowered(build([wall("l", TL, J, 0.2), wall("r", J, TR, 0.1), wall("stem", TS, J)]), [TL, J], [J, TR]), "df7ebe09"],
    ["a full wall within a bar", () => lowered(build([wall("bar", TL, TR), wall("stem", TS, J)]), [J, TR], [TS, J]), "011695e5"],
    ["a corner the outlines bevel", () => bent(15), "5504d45d"],
  ];

  it.each(LEFT_ALONE)("%s", (_name, doc, hash) => {
    expect(floorHash(doc())).toBe(hash);
  });
});

describe("the fill's colour (AC-06)", () => {
  it("follows the full wall when it's selected", () => {
    const shell = FakeShell.withDocument(corner());
    shell.click({ x: 1.2, y: 2 });
    const walls = shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
    expect(added(shell.doc(), walls).map((f) => f.color)).toEqual([COLORS.wallSelected]);
  });

  it("stays the wall colour when the half wall is selected, and no blue line crosses it", () => {
    const shell = FakeShell.withDocument(corner());
    shell.click({ x: 2, y: 1.2 });
    const doc = shell.doc();
    expect(shell.state.selection).toEqual([{ table: "walls", id: idAt(doc, J, Q) }]);
    const walls = shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
    expect(added(doc, walls).map((f) => f.color)).toEqual([CANVAS_STYLE.wall]);
    const inner = { x: 1.9, y: 1.9 };
    const outer = { x: 2.1, y: 2.1 };
    const crossing = walls.filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected && ((near(p.a, inner) && near(p.b, outer)) || (near(p.a, outer) && near(p.b, inner))));
    expect(crossing).toEqual([]);
  });

  it("follows the full wall when it's hovered or refused", () => {
    const doc = corner();
    const id = idAt(doc, P, J);
    expect(added(doc, layer(doc, "", id)).map((f) => f.color)).toEqual([COLORS.wallHover]);
    expect(added(doc, layer(doc, "", null, id)).map((f) => f.color)).toEqual([COLORS.invalid]);
  });
});

describe("ghosts at an upper level (AC-04)", () => {
  const R = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] as const;
  const room = (extra: Command[], lower: [Point, Point][]): Document => {
    const shell = build([wall("r0", R[0], R[1]), wall("r1", R[1], R[2]), wall("r2", R[2], R[3]), wall("r3", R[3], R[0]), ...extra]);
    const low = lowered(shell, ...lower);
    return unwrap(execute(low, { type: "addDeck", opId: "k", preset: "loft", at: { x: 1.5, y: 1.5 } })).doc;
  };
  const atLoft = (doc: Document) => {
    const level = levels(doc)[1];
    if (!level) throw new Error("no loft level");
    const args = [doc, level, CANVAS_STYLE, "", null, "", null] as const;
    return { walls: wallsLayer(...args), ghosts: ghostsLayer(...args) };
  };

  it("an L whose other wall is a ghost takes the same fill, and no ghost line crosses it", () => {
    const { walls, ghosts } = atLoft(room([], [[R[1], R[2]]]));
    const fills = walls.filter(isPolygon).filter((p) => p.points.some((q) => near(q, { x: 4.1, y: 0.1 })));
    expect(fills).toHaveLength(1);
    expectRing(fills[0]?.points ?? [], [{ x: 3.9, y: 0.1 }, { x: 4.1, y: 0.1 }, { x: 4.1, y: -0.1 }]);
    const inner = { x: 3.9, y: 0.1 };
    const outer = { x: 4.1, y: -0.1 };
    const crossing = ghosts.filter((s) => s.kind === "segment" && ((near(s.a, inner) && near(s.b, outer)) || (near(s.a, outer) && near(s.b, inner))));
    expect(crossing).toEqual([]);
  });

  it("a T whose bar is a ghost takes the same fill", () => {
    const stem = { x: 3.4, y: 2 }; // clear of the loft
    const foot = { x: 3.4, y: 0 };
    const doc = room([wall("s", stem, foot)], [[R[0], foot], [foot, R[1]]]);
    const added_ = atLoft(doc).walls.filter(isPolygon).filter((p) => p.points.some((q) => near(q, { x: 3.3, y: -0.1 }) || near(q, { x: 3.5, y: -0.1 })));
    expect(added_).toHaveLength(2);
    expect(added_.reduce((s, f) => s + area(f.points), 0)).toBeCloseTo(0.03, 9);
  });
});

describe("every picture carries the fill (AC-08)", () => {
  it.each([["paper", PRESENTATION_STYLE], ["look", LOOK_STYLE]])("%s", (_name, style) => {
    const doc = corner();
    const level = floorView(doc, null).level;
    const primitives = wallsLayer(doc, level, style, "", null, "", null);
    const fills = added(doc, primitives);
    expect(fills).toHaveLength(1);
    expect(fills[0]?.color).toBe(style.wall);
  });
});
