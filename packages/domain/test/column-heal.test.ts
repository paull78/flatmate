import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { DomainError } from "../src/errors";
import type { Document } from "../src/model";
import { faceAt, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc, withOpening } from "./helpers";

// Deleting a column in a wall's line heals the wall (pillars.13, .25; AC-15): the halves merge when thickness, top and
// base match, else a segment like the thinner half joins them; openings keep their place in the world.

type P = { x: number; y: number };
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
const del = (...ids: string[]): Command => ({ type: "deleteEntities", ids: ids.map((id) => ({ table: "walls", id })) });
/** An opening's two ends in the world, sorted by x then y (the same physical opening whichever way its wall runs). */
function span(doc: Document, id: string): [P, P] {
  const o = doc.openings[id];
  const w = o ? doc.walls[o.wall] : undefined;
  const a = w ? doc.joints[w.a] : undefined;
  const b = w ? doc.joints[w.b] : undefined;
  if (!o || !a || !b) throw new Error(`no opening ${id}`);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const at = (t: number): P => ({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
  const [p, q] = [at(o.offset), at(o.offset + o.width)];
  return p.x < q.x || (p.x === q.x && p.y < q.y) ? [p, q] : [q, p];
}
function sameSpan(before: Document, after: Document, id: string): void {
  const [[p0, q0], [p1, q1]] = [span(before, id), span(after, id)];
  expect(Math.hypot(p0.x - p1.x, p0.y - p1.y)).toBeLessThan(1e-9);
  expect(Math.hypot(q0.x - q1.x, q0.y - q1.y)).toBeLessThan(1e-9);
}
function areaAt(doc: Document, x: number, y: number): number {
  const key = faceAt(doc, { x, y })?.key;
  const z = zones(doc).find((r) => r.face.key === key);
  if (!z || z.area === null) throw new Error(`no room with an area at (${x}, ${y})`);
  return z.area;
}

/** A 6 × 4 m room of 0.20 walls W1..W4 (W1 along y = 0 from J1 (0, 0) to J2 (6, 0)). */
const ROOM = rectDoc(0, 0, 6, 4);
/** ROOM with door D1 on W1 (x 1.0–1.8) and D2 (x 4.0–4.8). */
const DOORED = withOpening(withOpening(ROOM, { id: "D1", wall: "W1", offset: 1 }), { id: "D2", wall: "W1", offset: 4 });
/** DOORED with a 0.40 × 0.40 column c/w0 at (3, 0): W1 J1 → c/j0, c/w1 c/j1 → J2 carrying D2. */
const COLUMN = run(DOORED, { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.4 });

/** ROOM's bottom wall split around column K (Ka 2.80, Kb 3.20) into halves W1a and W1b running as given. */
function split(w1a: [string, string], w1b: [string, string], thickness: [number, number] = [0.2, 0.2], depth = 0.4): Document {
  return docOf({
    joints: [["J1", 0, 0], ["Ka", 2.8, 0], ["Kb", 3.2, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
    walls: [["W1a", ...w1a, thickness[0]], ["W1b", ...w1b, thickness[1]], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
    columns: [["K", "Ka", "Kb", depth]],
  });
}

describe("deleting a column between two matching halves", () => {
  it("leaves one wall with the original far joints, the openings where they were, the area back (AC-15)", () => {
    expect(areaAt(COLUMN, 3, 2)).toBeLessThan(areaAt(ROOM, 3, 2));
    const doc = run(COLUMN, del("c/w0"));
    expect(doc.walls.W1).toEqual(ROOM.walls.W1);
    expect(Object.keys(doc.walls).sort()).toEqual(Object.keys(ROOM.walls).sort());
    expect(Object.keys(doc.joints).sort()).toEqual(Object.keys(ROOM.joints).sort());
    expect(doc.openings.D1).toEqual(DOORED.openings.D1);
    expect(doc.openings.D2?.wall).toBe("W1");
    expect(doc.openings.D2?.offset).toBeCloseTo(4, 9);
    sameSpan(DOORED, doc, "D2");
    expect(areaAt(doc, 3, 2)).toBeCloseTo(areaAt(ROOM, 3, 2), 9);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("a door on a half running the other way is the same physical door: side and hinge flip", () => {
    const before = withOpening(split(["J1", "Ka"], ["J2", "Kb"]), { id: "D", wall: "W1b", offset: 1, side: "left", hinge: "a" });
    expect(validateDocument(before).ok).toBe(true);
    const doc = run(before, del("K"));
    expect(doc.walls.W1a).toMatchObject({ a: "J1", b: "J2" });
    expect(doc.walls.W1b).toBeUndefined();
    expect(doc.openings.D).toMatchObject({ wall: "W1a", side: "right", hinge: "b" });
    expect(doc.openings.D?.offset).toBeCloseTo(4.2, 9);
    sameSpan(before, doc, "D");
  });

  it("the kept half keeps its sense: running Ka → J1, the merged wall runs J2 → J1", () => {
    const halves = split(["Ka", "J1"], ["Kb", "J2"]);
    const before = withOpening(withOpening(halves, { id: "D", wall: "W1a", offset: 0.5 }), { id: "E", wall: "W1b", offset: 0.5, side: "right", hinge: "b" });
    expect(validateDocument(before).ok).toBe(true);
    const doc = run(before, del("K"));
    expect(doc.walls.W1a).toMatchObject({ a: "J2", b: "J1" });
    expect(doc.openings.D).toMatchObject({ wall: "W1a", side: "left", hinge: "a" });
    expect(doc.openings.D?.offset).toBeCloseTo(3.7, 9);
    expect(doc.openings.E).toMatchObject({ wall: "W1a", side: "left", hinge: "a" });
    expect(doc.openings.E?.offset).toBeCloseTo(1.5, 9);
    sameSpan(before, doc, "D");
    sameSpan(before, doc, "E");
  });

  it("a dimension anchored to the column's joint is deleted; one anchored elsewhere stays", () => {
    const dimensioned: Document = {
      ...COLUMN,
      dimensions: {
        m1: { id: "m1", a: { joint: "c/j0", tx: 0, ty: 0 }, b: { x: 3, y: 2 }, offset: 0.3 },
        m2: { id: "m2", a: { joint: "J1", tx: 0, ty: 0 }, b: { x: 3, y: 2 }, offset: 0.3 },
      },
    };
    expect(validateDocument(dimensioned).ok).toBe(true);
    const doc = run(dimensioned, del("c/w0"));
    expect(Object.keys(doc.dimensions)).toEqual(["m2"]);
  });
});

describe("deleting a column between halves that differ", () => {
  it("between a 0.20 and a 0.10 half, a 0.10 segment joins them", () => {
    const before = withOpening(split(["J1", "Ka"], ["Kb", "J2"], [0.2, 0.1], 0.2), { id: "D", wall: "W1b", offset: 1 });
    expect(validateDocument(before).ok).toBe(true);
    const doc = run(before, del("K"));
    expect(doc.walls.K).toEqual({ id: "K", a: "Ka", b: "Kb", thickness: 0.1, top: "ceiling", base: "floor", column: false });
    expect(doc.walls.W1a).toEqual(before.walls.W1a);
    expect(doc.walls.W1b).toEqual(before.walls.W1b);
    expect(doc.joints).toEqual(before.joints);
    expect(doc.openings).toEqual(before.openings);
  });

  it("between halves of different tops, a segment like the thinner (here the first) half", () => {
    const halves = split(["J1", "Ka"], ["Kb", "J2"]);
    const w1b = halves.walls.W1b;
    if (!w1b) throw new Error("no W1b");
    const before: Document = { ...halves, walls: { ...halves.walls, W1b: { ...w1b, top: 2.2 } } };
    const doc = run(before, del("K"));
    expect(doc.walls.K).toMatchObject({ column: false, thickness: 0.2, top: "ceiling" });
  });
});

describe("deleting a half", () => {
  it("a column deleted with one of its halves goes with it, no heal: the other half stays as it was", () => {
    const doc = run(COLUMN, del("c/w0", "c/w1"));
    expect(doc.walls["c/w0"]).toBeUndefined();
    expect(doc.walls["c/w1"]).toBeUndefined();
    expect(doc.walls.W1).toEqual(COLUMN.walls.W1);
    expect(doc.joints["c/j1"]).toBeUndefined();
    expect(doc.openings.D2).toBeUndefined();
  });

  it("deleting a half alone is refused in plain words", () => {
    const e = refused(COLUMN, del("c/w1"));
    expect(e.violations.find((v) => v.invariant === "I20")?.plain).toBe("This column has a wall at one end only; a column stands free or in a wall's line");
  });
});
