import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { columnTakes } from "../src/column-checks";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { FLOOR_BASE, type Document, type Wall } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { footprints } from "../src/queries/footprints";
import { nearestObstacles } from "../src/queries/nearest";
import { stairEdges } from "../src/queries/stair-edge";
import { orphanLabelIds, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { loftStudio, place, withDeck, withOpening } from "./helpers";

// Walls on a loft (pillars.08, .09, .24; AC-06, AC-07): the pair checks and the column body check apply only to walls
// whose ranges overlap, every wall at a joint has one base, and rooms, clearance warnings, nearest distances and stair
// edges come from the walls based on the floor.

/**
 * The studio fixture with a bathroom: a 0.10 partition P from (1.5, 0) to (1.5, 2.5), 2.03 m high (up to the loft's
 * underside), splitting the shell's south and north walls (W1 | W1b, W3 | W3b); labels Bath and Main.
 */
function studio(): Document {
  const doc = loftStudio();
  const w = (id: string, a: string, b: string, row: Partial<Wall> = {}): Wall => ({ id, a, b, thickness: 0.2, top: "ceiling", base: FLOOR_BASE, column: false, ...row });
  return {
    ...doc,
    joints: { ...doc.joints, Ja: { id: "Ja", x: 1.5, y: 0 }, Jb: { id: "Jb", x: 1.5, y: 2.5 } },
    walls: {
      ...doc.walls,
      W1: w("W1", "J1", "Ja"), W1b: w("W1b", "Ja", "J2"), W3: w("W3", "J3", "Jb"), W3b: w("W3b", "Jb", "J4"),
      P: w("P", "Ja", "Jb", { thickness: 0.1, top: 2.03 }),
    },
    zoneLabels: { bath: { id: "bath", at: { x: 0.75, y: 1.25 }, name: "Bath", finish: null }, main: { id: "main", at: { x: 2.15, y: 0.65 }, name: "Main", finish: null } },
  };
}

/** The studio without its mattress, so a loft wall may run anywhere on the loft. */
const bare = (): Document => ({ ...studio(), objects: {}, placements: {} });

/** A copy of `doc` with a free-standing row `id` from p to q (joints `${id}a`, `${id}b`), 0.10 thick on the loft by default. */
function withRow(doc: Document, id: string, p: [number, number], q: [number, number], row: Partial<Wall> = {}): Document {
  const [a, b] = [`${id}a`, `${id}b`];
  const wall: Wall = { id, a, b, thickness: 0.1, top: "ceiling", base: "loft", column: false, ...row };
  return { ...doc, joints: { ...doc.joints, [a]: { id: a, x: p[0], y: p[1] }, [b]: { id: b, x: q[0], y: q[1] } }, walls: { ...doc.walls, [id]: wall } };
}

/** A loop of four 0.10 rows L1..L4 through the corners (x0, y0) → (x1, y0) → (x1, y1) → (x0, y1), with this base and top. */
function withLoop(doc: Document, x0: number, y0: number, x1: number, y1: number, row: Partial<Wall>): Document {
  const corners: [string, number, number][] = [["L1", x0, y0], ["L2", x1, y0], ["L3", x1, y1], ["L4", x0, y1]];
  const joints = { ...doc.joints };
  const walls = { ...doc.walls };
  corners.forEach(([id, x, y], i) => {
    const next = corners[(i + 1) % 4]?.[0] ?? id;
    joints[id] = { id, x, y };
    walls[id] = { id, a: id, b: next, thickness: 0.1, top: "ceiling", base: "loft", column: false, ...row };
  });
  return { ...doc, joints, walls };
}

const messages = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => v.message);
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

describe("a wall on the loft over a partition (AC-07)", () => {
  // Body y 2.25–2.35, crossing P (x 1.50) in plan.
  const over = (row: Partial<Wall>): Document => withRow(bare(), "K", [0.6, 2.3], [2.4, 2.3], row);

  it("the fixture is valid", () => {
    expect(messages(studio())).toEqual([]);
  });

  it("a 0.10 wall on the loft crossing over the 2.03 partition is accepted", () => {
    expect(messages(over({}))).toEqual([]);
  });

  it("the same wall on the floor with a top of 2.00 is refused, the crossing among the reasons", () => {
    expect(messages(over({ base: FLOOR_BASE, top: 2 }))).toContain("Walls K and P cross");
  });

  it("a partition reaching 2 mm into the loft wall's range crosses it; 1 mm is the ranges' tolerance, and the loft refuses it", () => {
    const reaching = (top: number): Document => {
      const doc = over({});
      const p = doc.walls.P;
      if (!p) throw new Error("no partition");
      return { ...doc, walls: { ...doc.walls, P: { ...p, top } } };
    };
    expect(messages(reaching(2.152))).toContain("Walls K and P cross");
    const oneMm = messages(reaching(2.151));
    expect(oneMm).not.toContain("Walls K and P cross");
    expect(oneMm.length).toBeGreaterThan(0); // through the loft's slab (I18)
  });

  it("a loft wall may end over a floor wall's centreline, and its joint over a floor joint", () => {
    expect(messages(withRow(bare(), "K", [1.5, 1.8], [2.2, 1.8]))).toEqual([]);
    expect(messages(withRow(bare(), "K", [1.5, 1.8], [2.2, 1.8], { base: FLOOR_BASE, top: 2 }))).toContain("Joint Ka lies on wall P");
  });
});

describe("one base per joint", () => {
  it("a loft wall and a floor wall sharing a joint are refused", () => {
    const loft = withRow(bare(), "K", [2.0, 1.2], [2.4, 1.2]);
    const doc: Document = { ...loft, walls: { ...loft.walls, S: { id: "S", a: "Kb", b: "Sb", thickness: 0.1, top: 2, base: FLOOR_BASE, column: false } }, joints: { ...loft.joints, Sb: { id: "Sb", x: 2.4, y: 0.1 } } };
    expect(messages(doc)).toEqual(["Walls at joint Kb stand on different bases"]);
    const r = validateDocument(doc);
    expect(r.ok ? null : r.error[0]?.plain).toBe("Walls meeting at a joint stand on one base");
  });

  it("two loft walls sharing a joint are accepted", () => {
    const loft = withRow(bare(), "K", [2.0, 1.2], [2.4, 1.2]);
    const doc: Document = { ...loft, walls: { ...loft.walls, S: { id: "S", a: "Kb", b: "Sb", thickness: 0.1, top: "ceiling", base: "loft", column: false } }, joints: { ...loft.joints, Sb: { id: "Sb", x: 2.4, y: 0.3 } } };
    expect(messages(doc)).toEqual([]);
  });
});

describe("rows on a deck flush against another level's wall (pillars.50)", () => {
  type Place = Extract<Command, { type: "placeColumn" }>;
  const post = (x: number, y: number, extra: Partial<Place> = {}): Place => ({ type: "placeColumn", opId: "o", at: { x, y }, width: 0.2, depth: 0.2, base: "loft", ...extra });

  it("a loft column flush with the shell's inner face is accepted", () => {
    expect(refusal(studio(), post(0.2, 1.0))).toBe("accepted");
  });

  it("a loft column overlapping into the shell is refused", () => {
    const doc = withRow(studio(), "C", [0.09, 1.0], [0.29, 1.0], { column: true, thickness: 0.2 });
    expect(messages(doc)).toContain("Column C touches wall W4");
  });

  it("a loft column touching a loft wall is still refused: within one base a free column stands clear", () => {
    const doc = withRow(bare(), "K", [0.6, 1.5], [1.2, 1.5]);
    expect(refusal(doc, post(0.9, 1.65))).toBe("Column o/w0 touches wall K");
  });

  it("the body check skips walls apart in height: a post under the loft passes below a loft wall", () => {
    // The post's body (y 1.0–1.2) overlaps K's (y 0.95–1.05) in plan; its centre is off K's body, so it stands free.
    const under = post(1.0, 1.1, { base: "floor", top: "loft" });
    expect(refusal(withRow(bare(), "K", [0.6, 1.0], [1.4, 1.0]), under)).toBe("accepted");
    expect(refusal(withRow(bare(), "K", [0.6, 1.0], [1.4, 1.0], { base: FLOOR_BASE, top: 2 }), under)).toBe("Column o/w0 touches wall K");
  });
});

describe("rooms and warnings come from floor walls (AC-06)", () => {
  // A desk under the loft in the main room (x 1.6–2.8, y 0.1–0.7, front up), a door in the partition, a Night layout.
  const furnished = (): Document => {
    const desk = place(studio(), { object: "desk", kind: "desk", at: [2.2, 0.1], rotation: 180 });
    const night = place(desk, { object: "desk", kind: "desk", at: [4, 0.1], rotation: 180, state: "night" });
    return withOpening(night, { id: "D", wall: "P", offset: 1.4 });
  };
  // Over the desk and its front zone in plan: bodies x 1.85–2.45, y 0.25–1.05, clear of the mattress (x ≤ 1.8).
  const loop = (doc: Document): Document => withLoop(doc, 1.9, 0.3, 2.4, 1.0, {});
  const rooms = (doc: Document) => zones(doc).map((z) => ({ key: z.face.key, area: z.area, labels: z.labelIds, holes: z.holes.length }));
  const warnings = (doc: Document) => Object.keys(doc.states).sort().map((s) => clearanceWarnings(doc, s));

  it("four walls on the loft closing a loop are valid", () => {
    expect(messages(furnished())).toEqual([]);
    expect(messages(loop(furnished()))).toEqual([]);
  });

  it("leave the floor's rooms, areas and labels unchanged and add no room", () => {
    const before = furnished();
    expect(rooms(before)).toHaveLength(2);
    expect(rooms(loop(before))).toEqual(rooms(before));
    expect(orphanLabelIds(loop(before))).toEqual(orphanLabelIds(before));
  });

  it("leave each layout's clearance warnings unchanged", () => {
    const before = furnished();
    expect(warnings(loop(before))).toEqual(warnings(before));
  });

  it("a post on the loft takes no floor off the room under it, and is no hole of it", () => {
    const doc = execute(bare(), { type: "placeColumn", opId: "o", at: { x: 2.2, y: 1.2 }, width: 0.3, depth: 0.3, base: "loft" });
    if (!doc.ok) throw new Error(doc.error.message);
    expect(rooms(doc.value.doc)).toEqual(rooms(bare()));
    expect(columnTakes(doc.value.doc, "o/w0")).toBe(0);
  });

  it("the same loop on the floor would add a room and a warning (the fixture shows the difference)", () => {
    const before = furnished();
    const floor = withLoop(before, 1.9, 0.3, 2.4, 1.0, { base: FLOOR_BASE, top: 2 });
    expect(rooms(floor)).toHaveLength(3);
    expect(warnings(floor)).not.toEqual(warnings(before));
  });
});

describe("nearest distances and stair edges ignore loft walls", () => {
  const quadOf = (doc: Document, id: string): readonly Point[] => {
    const quad = footprints(doc).get(id);
    if (!quad) throw new Error(`no footprint for ${id}`);
    return quad;
  };

  it("a chair under the loft measures past a loft wall above it to the shell", () => {
    // Chair x 1.775–2.225, y 0.1–0.55, front up; the loft wall's body y 1.15–1.25 over it.
    const chair = place(bare(), { object: "chair", kind: "chair", at: [2, 0.1], rotation: 180 });
    const front = (doc: Document) => nearestObstacles(doc, quadOf(doc, "chair/s0"), "s0", new Set(["chair/s0"])).front;
    const loft = withRow(chair, "K", [1.7, 1.2], [2.4, 1.2]);
    expect(front(loft)?.obstacle).toEqual({ table: "walls", id: "W3" });
    expect(front(loft)?.gap).toBeCloseTo(1.85, 9);
    expect(front(withRow(chair, "K", [1.7, 1.2], [2.4, 1.2], { base: FLOOR_BASE, top: 2 }))?.obstacle).toEqual({ table: "walls", id: "K" });
  });

  it("a deck edge flush against a wall on the next deck still takes a stair", () => {
    // A second loft east of the first (x 2.5–3.5), with a wall on it flush with the shared edge: body x 2.5–2.6.
    const east = withDeck(bare(), { id: "east", name: "East", at: [3, 1.25], w: 1, d: 2.3, top: 2.15, solid: false });
    const edges = stairEdges(east, null, 0.9);
    expect(stairEdges(withRow(east, "K", [2.55, 0.5], [2.55, 2.0], { base: "east" }), null, 0.9)).toEqual(edges);
    expect(stairEdges(withRow(east, "K", [2.55, 0.5], [2.55, 2.0], { base: FLOOR_BASE, top: 2 }), null, 0.9)).toHaveLength(edges.length - 1);
  });
});
