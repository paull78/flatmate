import { describe, expect, it } from "vitest";
import { columnOf } from "../src/column-checks";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { DomainError } from "../src/errors";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { docOf, withOpening } from "./helpers";

// setColumn on a column in a wall's line (pillars.13, .25; AC-14, AC-16): it slides along the line through its
// neighbours' far joints, the halves stretching, every opening keeping its place in the world.

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
const joint = (doc: Document, id: string): P => {
  const j = doc.joints[id];
  if (!j) throw new Error(`no joint ${id}`);
  return { x: j.x, y: j.y };
};
const length = (doc: Document, wallId: string): number => {
  const w = doc.walls[wallId];
  if (!w) throw new Error(`no wall ${wallId}`);
  const [a, b] = [joint(doc, w.a), joint(doc, w.b)];
  return Math.hypot(b.x - a.x, b.y - a.y);
};
/** An opening's two ends in the world, its start (at its offset from joint a) first. */
function ends(doc: Document, id: string): [P, P] {
  const o = doc.openings[id];
  const w = o ? doc.walls[o.wall] : undefined;
  if (!o || !w) throw new Error(`no opening ${id}`);
  const [a, b] = [joint(doc, w.a), joint(doc, w.b)];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const at = (t: number): P => ({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
  return [at(o.offset), at(o.offset + o.width)];
}
const near = (p: P, q: P): number => Math.hypot(p.x - q.x, p.y - q.y);

/** A closed quadrilateral room with an off-grid slanted wall S from P1 (0.13, 0.27) to P2 (4.71, 2.09). */
const SLANTED = docOf({
  joints: [["P1", 0.13, 0.27], ["P2", 4.71, 2.09], ["P3", 4.2, 5.33], ["P4", -0.61, 4.08]],
  walls: [["S", "P1", "P2"], ["S2", "P2", "P3"], ["S3", "P3", "P4"], ["S4", "P4", "P1"]],
});
const [P1, P2] = [{ x: 0.13, y: 0.27 }, { x: 4.71, y: 2.09 }];
const L = Math.hypot(P2.x - P1.x, P2.y - P1.y);
const U = { x: (P2.x - P1.x) / L, y: (P2.y - P1.y) / L };
/** The point `t` metres from P1 along S, `n` metres off it to the left. */
const along = (t: number, n = 0): P => ({ x: P1.x + U.x * t - U.y * n, y: P1.y + U.y * t + U.x * n });
/** The distance of p from the line P1–P2. */
const offLine = (p: P): number => Math.abs((p.x - P1.x) * U.y - (p.y - P1.y) * U.x);

/** SLANTED with a 0.30 × 0.30 column c/w0 in S's line at its middle: S runs P1 → c/j0, c/w1 runs c/j1 → P2. */
const COLUMN = run(SLANTED, { type: "placeColumn", opId: "c", at: along(L / 2), width: 0.3, depth: 0.3 });
/** COLUMN with door D on S (0.50–1.30 from P1) and door E on c/w1 (0.80 from c/j1: 3.41–4.21 from P1). */
const DOORS = withOpening(withOpening(COLUMN, { id: "D", wall: "S", offset: 0.5 }), { id: "E", wall: "c/w1", offset: 0.8 });
const slide = (t: number, n = 0): Command => ({ type: "setColumn", wallId: "c/w0", at: along(t, n) });

describe("sliding a column along its wall's line", () => {
  it("the fixture: the column is in S's line, the doors on its halves", () => {
    expect(columnOf(DOORS, "c/w0")?.line).toEqual(["S", "c/w1"]);
    expect(validateDocument(DOORS).ok).toBe(true);
  });

  it("sliding 0.50 along a slanted wall moves both joints 0.50 along the line and nothing off it (AC-14)", () => {
    const doc = run(COLUMN, slide(L / 2 + 0.5));
    for (const j of ["c/j0", "c/j1"]) {
      const [before, after] = [joint(COLUMN, j), joint(doc, j)];
      expect(near(after, { x: before.x + U.x * 0.5, y: before.y + U.y * 0.5 })).toBeLessThan(1e-9);
      expect(offLine(after)).toBeLessThan(1e-9);
    }
    expect(length(doc, "S")).toBeCloseTo(length(COLUMN, "S") + 0.5, 9);
    expect(length(doc, "c/w1")).toBeCloseTo(length(COLUMN, "c/w1") - 0.5, 9);
    expect(columnOf(doc, "c/w0")?.line).toEqual(["S", "c/w1"]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("an at off the line (0.20 across) is projected onto it", () => {
    const doc = run(COLUMN, slide(L / 2 + 0.5, 0.2));
    const straight = run(COLUMN, slide(L / 2 + 0.5));
    for (const j of ["c/j0", "c/j1"]) expect(near(joint(doc, j), joint(straight, j))).toBeLessThan(1e-9);
  });

  it("a door on the half whose joint a is the column's stays where it was in the world", () => {
    const doc = run(DOORS, slide(L / 2 + 0.5));
    expect(doc.openings.E?.wall).toBe("c/w1");
    expect(doc.openings.E?.offset).toBeCloseTo(0.3, 9);
    const [[s0, e0], [s1, e1]] = [ends(DOORS, "E"), ends(doc, "E")];
    expect(near(s0, s1)).toBeLessThan(1e-9);
    expect(near(e0, e1)).toBeLessThan(1e-9);
  });

  it("a door on the half whose joint b is the column's keeps its offset and its place", () => {
    const doc = run(DOORS, slide(L / 2 - 0.5));
    expect(doc.openings.D).toEqual(DOORS.openings.D);
    expect(near(ends(DOORS, "D")[0], ends(doc, "D")[0])).toBeLessThan(1e-9);
  });

  it("stops before a half shorter than 1 cm, and nothing changes", () => {
    expect(refused(COLUMN, slide(L - 0.15 - 0.005)).message).toBe("A column needs at least 1 cm of wall on each side");
    expect(refused(COLUMN, slide(0.15 + 0.005)).message).toBe("A column needs at least 1 cm of wall on each side");
  });

  it("stops before covering a door, naming it with an I12 violation", () => {
    const e = refused(DOORS, slide(L / 2 + 1));
    expect(e.message).toBe("A column can't cover door E");
    expect(e.violations).toEqual([expect.objectContaining({ invariant: "I12", entities: [{ table: "openings", id: "E" }, { table: "walls", id: "c/w1" }] })]);
    expect(refused(DOORS, slide(1.35)).message).toBe("A column can't cover door D");
    // Touching the door's jamb is fine: the column's end at 1.30 from P1, where door D ends.
    expect(execute(DOORS, slide(1.45)).ok).toBe(true);
  });
});

describe("a column can't pass an opening (fixes AC-09)", () => {
  it("past the door on its far half: refused naming it, and the door stays where it was", () => {
    const e = refused(DOORS, slide(4.4)); // door E is 3.41–4.21 from P1
    expect(e.message).toBe("A column can't pass door E");
    expect(e.violations).toEqual([expect.objectContaining({ invariant: "I12" })]);
  });

  it("past the door on its near half too", () => {
    expect(refused(DOORS, slide(0.3)).message).toBe("A column can't pass door D"); // door D is 0.50–1.30 from P1
  });

  it("two doors on the far half give the same refusal, not an overlap between them", () => {
    const both = withOpening(withOpening(COLUMN, { id: "E", wall: "c/w1", offset: 1 }), { id: "F", wall: "c/w1", offset: 0.1 });
    expect(refused(both, slide(4.7)).message).toMatch(/^A column can't pass door [EF]$/);
  });

  it("moving away from a door, and sliding to touch its jamb, are still accepted", () => {
    expect(execute(DOORS, slide(L / 2 + 0.2)).ok).toBe(true);
    expect(execute(DOORS, slide(1.45)).ok).toBe(true); // its end at 1.30, where door D ends
    expect(execute(DOORS, slide(3.26)).ok).toBe(true); // its end at 3.41, where door E starts
  });

  it("a slide and a wider column at once can't get over it either", () => {
    const wider = { type: "setColumn", wallId: "c/w0", at: along(4.2), width: 1.3 } as const;
    expect(refused(DOORS, wider).message).toMatch(/^A column can't (pass|cover) door E$/);
  });
});

describe("resizing a column in a wall's line", () => {
  it("width 0.60 for a 0.30 column keeps its centre and shortens each half by 0.15 (AC-16)", () => {
    const doc = run(DOORS, { type: "setColumn", wallId: "c/w0", width: 0.6 });
    const [before, after] = [columnOf(DOORS, "c/w0"), columnOf(doc, "c/w0")];
    if (!before || !after) throw new Error("no column");
    expect(near(after.centre, before.centre)).toBeLessThan(1e-9);
    expect(after.width).toBeCloseTo(0.6, 9);
    expect(length(doc, "S")).toBeCloseTo(length(DOORS, "S") - 0.15, 9);
    expect(length(doc, "c/w1")).toBeCloseTo(length(DOORS, "c/w1") - 0.15, 9);
    expect(near(ends(DOORS, "E")[0], ends(doc, "E")[0])).toBeLessThan(1e-9);
  });

  it("a width of 2.01 is refused with the range", () => {
    expect(refused(COLUMN, { type: "setColumn", wallId: "c/w0", width: 2.01 }).message).toContain("0.10–2.00");
  });

  it("a rotation change is refused: it turns with its wall; its own rotation is accepted", () => {
    const rotation = columnOf(COLUMN, "c/w0")?.rotation ?? 0;
    expect(refused(COLUMN, { type: "setColumn", wallId: "c/w0", rotation: rotation + 10 }).message).toBe("A column in a wall's line turns with its wall");
    expect(execute(COLUMN, { type: "setColumn", wallId: "c/w0", rotation }).ok).toBe(true);
  });

  it("depth changes its thickness only; thinner than its wall is refused", () => {
    const doc = run(COLUMN, { type: "setColumn", wallId: "c/w0", depth: 0.5 });
    expect(doc.walls["c/w0"]?.thickness).toBe(0.5);
    expect(doc.joints).toBe(COLUMN.joints);
    expect(refused(COLUMN, { type: "setColumn", wallId: "c/w0", depth: 0.1 }).message).toContain("thinner than its wall");
  });
});

describe("halves running either way", () => {
  /** A 6 × 4 room whose bottom wall runs J2 → Kb (W1b) and Ka → J1 (W1a) around column K (Ka 2.85, Kb 3.15). */
  const REVERSED = withOpening(
    withOpening(
      docOf({
        joints: [["J1", 0, 0], ["Ka", 2.85, 0], ["Kb", 3.15, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
        walls: [["W1a", "Ka", "J1"], ["W1b", "J2", "Kb"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
        columns: [["K", "Ka", "Kb", 0.3]],
      }),
      { id: "D", wall: "W1a", offset: 0.5 },
    ),
    { id: "E", wall: "W1b", offset: 0.5 },
  );

  it("a column can't pass a door whichever way its half runs (fixes AC-09)", () => {
    expect(refused(REVERSED, { type: "setColumn", wallId: "K", at: { x: 1, y: 0 } }).message).toBe("A column can't pass door D");
    expect(refused(REVERSED, { type: "setColumn", wallId: "K", at: { x: 5.7, y: 0 } }).message).toBe("A column can't pass door E");
  });

  it("both doors keep their place in the world, sliding either way", () => {
    expect(validateDocument(REVERSED).ok).toBe(true);
    for (const x of [2.6, 3.5]) {
      const doc = run(REVERSED, { type: "setColumn", wallId: "K", at: { x, y: 0 } });
      expect(joint(doc, "Ka").x).toBeCloseTo(x - 0.15, 9);
      for (const id of ["D", "E"]) {
        const [[s0, e0], [s1, e1]] = [ends(REVERSED, id), ends(doc, id)];
        expect(near(s0, s1)).toBeLessThan(1e-9);
        expect(near(e0, e1)).toBeLessThan(1e-9);
      }
      expect(doc.openings.E).toEqual(REVERSED.openings.E);
    }
  });
});
