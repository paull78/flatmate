import { describe, expect, it } from "vitest";
import { columnOf, columnTakes } from "../src/column-checks";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { DomainError } from "../src/errors";
import type { Document, Opening } from "../src/model";
import { faceAt, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc, withOpening } from "./helpers";

// placeColumn into a wall's line (pillars.03, .19, .21, .25; AC-01, AC-03, AC-04, AC-19): a centre in a wall's body
// splits the wall into wall, column, wall sharing joints, on the wall's centreline and in its direction.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refused = (doc: Document, cmd: Command): DomainError => {
  const r = execute(doc, cmd);
  if (r.ok) throw new Error("expected a refusal");
  return r.error;
};
type Place = Extract<Command, { type: "placeColumn" }>;
const place = (opId: string, x: number, y: number, extra: Partial<Place> = {}): Place => ({ type: "placeColumn", opId, at: { x, y }, width: 0.4, depth: 0.4, ...extra });

/** The area of the room holding p. */
function areaAt(doc: Document, x: number, y: number): number {
  const key = faceAt(doc, { x, y })?.key;
  const z = zones(doc).find((r) => r.face.key === key);
  if (!z || z.area === null) throw new Error(`no room with an area at (${x}, ${y})`);
  return z.area;
}

/** An opening's centre in the world, from its wall's joints and its offset from joint a. */
function openingCentre(doc: Document, id: string): { x: number; y: number } {
  const o: Opening | undefined = doc.openings[id];
  const w = o ? doc.walls[o.wall] : undefined;
  const a = w ? doc.joints[w.a] : undefined;
  const b = w ? doc.joints[w.b] : undefined;
  if (!o || !a || !b) throw new Error(`no opening ${id}`);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = (o.offset + o.width / 2) / len;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A 6 × 4 m room of 0.20 walls W1..W4 (W1 along y = 0 from J1 (0, 0) to J2 (6, 0)). */
const ROOM = rectDoc(0, 0, 6, 4);

/** ROOM split by a 0.20 partition P from Ja (3, 0) to Jb (3, 4): two rooms either side. */
const TWO_ROOMS = docOf({
  joints: [["J1", 0, 0], ["Ja", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["Jb", 3, 4], ["J4", 0, 4]],
  walls: [["W1a", "J1", "Ja"], ["W1b", "Ja", "J2"], ["W2", "J2", "J3"], ["W3a", "J3", "Jb"], ["W3b", "Jb", "J4"], ["W4", "J4", "J1"], ["P", "Ja", "Jb"]],
});

/** A closed quadrilateral room with an off-grid slanted wall S from P1 (0.13, 0.27) to P2 (4.71, 2.09). */
const SLANTED = docOf({
  joints: [["P1", 0.13, 0.27], ["P2", 4.71, 2.09], ["P3", 4.2, 5.33], ["P4", -0.61, 4.08]],
  walls: [["S", "P1", "P2"], ["S2", "P2", "P3"], ["S3", "P3", "P4"], ["S4", "P4", "P1"]],
});

/** ROOM with a 0.40 × 0.40 column c/w0 in W1's line at (3, 0): c/j0 (2.8, 0), c/j1 (3.2, 0). */
const withColumn = (): Document => run(ROOM, place("c", 3, 0));

describe("placeColumn into a wall's line", () => {
  it("a 0.40 × 0.40 column dropped at the middle of a 0.20 wall splits it into three rows sharing joints", () => {
    const doc = withColumn();
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.walls.W1).toEqual({ ...ROOM.walls.W1, b: "c/j0" });
    expect(doc.walls["c/w0"]).toEqual({ id: "c/w0", a: "c/j0", b: "c/j1", thickness: 0.4, top: "ceiling", base: "floor", column: true });
    expect(doc.walls["c/w1"]).toEqual({ ...ROOM.walls.W1, id: "c/w1", a: "c/j1", b: "J2" });
    expect(doc.joints["c/j0"]).toEqual({ id: "c/j0", x: 2.8, y: 0 });
    expect(doc.joints["c/j1"]).toEqual({ id: "c/j1", x: 3.2, y: 0 });
    expect(columnOf(doc, "c/w0")?.line).toEqual(["W1", "c/w1"]);
    expect(Object.keys(doc.walls).sort()).toEqual(["W1", "W2", "W3", "W4", "c/w0", "c/w1"]);
  });

  it("takes 0.40 × 0.10 off each room on a side it stands proud (AC-01): both rooms by a partition", () => {
    const doc = run(TWO_ROOMS, place("c", 3, 2));
    expect(columnOf(doc, "c/w0")?.line).toEqual(["P", "c/w1"]);
    expect(areaAt(doc, 1, 1)).toBeCloseTo(areaAt(TWO_ROOMS, 1, 1) - 0.04, 9);
    expect(areaAt(doc, 5, 1)).toBeCloseTo(areaAt(TWO_ROOMS, 5, 1) - 0.04, 9);
    expect(zones(doc)).toHaveLength(2);
  });

  it("takes 0.40 × 0.10 off only the inside room on a shell wall (AC-01)", () => {
    const doc = run(ROOM, place("c", 6, 2));
    expect(areaAt(doc, 3, 2)).toBeCloseTo(areaAt(ROOM, 3, 2) - 0.04, 9);
    expect(zones(doc)).toHaveLength(1);
  });

  it("on an off-grid slanted wall a click 0.05 off the centreline puts the column on it, in its direction", () => {
    const [ax, ay, bx, by] = [0.13, 0.27, 4.71, 2.09];
    const len = Math.hypot(bx - ax, by - ay);
    const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
    const mid = { x: (ax + bx) / 2, y: (ay + by) / 2 };
    const doc = run(SLANTED, place("c", mid.x - uy * 0.05, mid.y + ux * 0.05, { width: 0.4, depth: 0.4 }));
    const c = columnOf(doc, "c/w0");
    if (!c) throw new Error("no column");
    expect(Math.abs(c.centre.x - mid.x)).toBeLessThan(1e-9);
    expect(Math.abs(c.centre.y - mid.y)).toBeLessThan(1e-9);
    expect(Math.abs(c.width - 0.4)).toBeLessThan(1e-9);
    expect(Math.abs(c.rotation - (Math.atan2(by - ay, bx - ax) * 180) / Math.PI)).toBeLessThan(1e-9);
    expect(c.line).toEqual(["S", "c/w1"]);
    expect(validateDocument(doc).ok).toBe(true);
    // Proud by (0.40 − 0.20) / 2 on the room's side, along 0.40 of the wall.
    expect(Math.abs(areaAt(doc, 2, 2.5) - (areaAt(SLANTED, 2, 2.5) - 0.4 * 0.1))).toBeLessThan(1e-9);
  });

  it("a 1.20 deep column in a 0.20 wall's line is accepted (AC-04)", () => {
    const doc = run(ROOM, place("d", 3, 0, { width: 0.3, depth: 1.2 }));
    expect(columnOf(doc, "d/w0")).toMatchObject({ depth: 1.2, line: ["W1", "d/w1"] });
    expect(areaAt(doc, 3, 2)).toBeCloseTo(areaAt(ROOM, 3, 2) - 0.3 * 0.5, 9);
  });

  it("a column in a wall's line is at least as deep as the wall (pillars.42): a 0.10 column in a 0.20 wall is refused", () => {
    const r = execute(ROOM, place("t", 3, 0, { depth: 0.1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toBe("Column t/w0 is thinner than its wall; a column in a wall's line is at least as deep as the wall");
      expect(r.error.violations.find((v) => v.invariant === "I20")?.plain).toBe("A column in a wall's line is at least as deep as the wall");
    }
    expect(execute(ROOM, place("t", 3, 0, { depth: 0.2 })).ok).toBe(true);
  });

  it("takes the wall's top and base", () => {
    const w1 = ROOM.walls.W1;
    if (!w1) throw new Error("no W1");
    const half: Document = { ...ROOM, walls: { ...ROOM.walls, W1: { ...w1, top: 1.1 } } };
    const doc = run(half, place("c", 3, 0));
    expect(doc.walls["c/w0"]).toMatchObject({ top: 1.1, base: "floor", column: true });
    expect(doc.walls["c/w1"]).toMatchObject({ top: 1.1, base: "floor", column: false });
    expect(doc.walls.W1?.top).toBe(1.1);
  });

  it("ignores a rotation passed for an in-line placement", () => {
    const doc = run(ROOM, place("c", 3, 0, { rotation: 30 }));
    expect(columnOf(doc, "c/w0")?.rotation).toBe(0);
  });

  it("refuses a half shorter than 1 cm", () => {
    expect(refused(ROOM, place("c", 0.205, 0)).message).toBe("A column needs at least 1 cm of wall on each side");
    expect(refused(ROOM, place("c", 5.795, 0)).message).toBe("A column needs at least 1 cm of wall on each side");
  });

  it("refuses a column proud into a perpendicular wall near a corner, naming the wall", () => {
    const e = refused(ROOM, place("c", 0.28, 0));
    expect(e.message).toContain("Column c/w0");
    expect(e.message).toContain("W4");
  });

  it("refuses a size out of range before anything else", () => {
    expect(refused(ROOM, place("c", 3, 0, { width: 2.01 })).message).toContain("0.10–2.00");
  });
});

describe("openings on the split wall", () => {
  const withDoors = withOpening(withOpening(ROOM, { id: "D1", wall: "W1", offset: 1 }), { id: "D2", wall: "W1", offset: 4 });

  it("a column over a door is refused, naming the door, with an I12 violation", () => {
    const e = refused(withDoors, place("c", 1.5, 0));
    expect(e.message).toBe("A column can't cover door D1");
    expect(e.violations).toEqual([expect.objectContaining({ invariant: "I12", entities: [{ table: "openings", id: "D1" }, { table: "walls", id: "W1" }] })]);
    // Just touching the door's jamb is fine: column x 1.8–2.2, door x 1.0–1.8.
    expect(execute(withDoors, place("c", 2, 0)).ok).toBe(true);
  });

  it("a door on the far half moves to it with its world position kept; one on the near half is unchanged", () => {
    const doc = run(withDoors, place("c", 3, 0));
    expect(doc.openings.D1).toEqual(withDoors.openings.D1);
    expect(doc.openings.D2).toMatchObject({ wall: "c/w1" });
    expect(doc.openings.D2?.offset).toBeCloseTo(0.8, 12);
    const before = openingCentre(withDoors, "D2");
    const after = openingCentre(doc, "D2");
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("on a slanted wall too", () => {
    const doors = withOpening(SLANTED, { id: "D", wall: "S", offset: 3.3, kind: "window" });
    const doc = run(doors, place("c", 1.5, 0.81));
    expect(doc.openings.D?.wall).toBe("c/w1");
    const before = openingCentre(doors, "D");
    const after = openingCentre(doc, "D");
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1e-9);
  });
});

describe("addWall never ends on nor splits an in-line column (AC-03, AC-19)", () => {
  const wall = (opId: string, from: { x: number; y: number }, to: { x: number; y: number }): Command => ({ type: "addWall", opId, from: { at: from }, to: { at: to } });

  it("a wall drawn from the column's face is refused naming the column", () => {
    expect(refused(withColumn(), wall("x", { x: 3, y: 0.2 }, { x: 3, y: 3 })).message).toContain("Column c/w0");
  });

  it("a wall drawn across the column is refused naming the column", () => {
    expect(refused(withColumn(), wall("x", { x: 3, y: -1 }, { x: 3, y: 3 })).message).toContain("Column c/w0");
  });

  it("a wall drawn to end on its centreline or at one of its joints is refused by the lock", () => {
    const locked = "Column c/w0 can't be edited as a wall; edit its position, width and depth";
    expect(refused(withColumn(), wall("x", { x: 3, y: 3 }, { x: 3, y: 0 })).message).toBe(locked);
    expect(refused(withColumn(), wall("x", { x: 2.8, y: 3 }, { x: 2.8, y: 0 })).message).toBe(locked);
    expect(refused(withColumn(), { type: "addWall", opId: "x", from: { existing: "c/j1" }, to: { at: { x: 3.2, y: 3 } } }).message).toBe(locked);
  });
});

describe("columnTakes: the floor a column takes off its rooms", () => {
  it("free: width × depth; in a shell wall's line: only the part proud into the room", () => {
    const free = run(ROOM, place("f", 2, 2, { width: 0.3, depth: 0.4 }));
    expect(columnTakes(free, "f/w0")).toBeCloseTo(0.12, 9);
    const inLine = run(ROOM, place("c", 3, 0, { width: 0.3, depth: 0.4 }));
    expect(columnTakes(inLine, "c/w0")).toBeCloseTo(0.03, 9);
    expect(areaAt(ROOM, 3, 2) - areaAt(inLine, 3, 2)).toBeCloseTo(0.03, 9);
  });
});
