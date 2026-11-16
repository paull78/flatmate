import { describe, expect, it } from "vitest";
import { columnOf } from "../src/column-checks";
import type { InvariantId } from "../src/errors";
import type { Document } from "../src/model";
import { parseWall } from "../src/shape";
import { validateDocument } from "../src/validate";
import { loops, rectLoop, wallRow, type Spec } from "./helpers";

// Columns as wall rows (pillars.01, .04, .18, .21): sizes by role, ends free or in a wall's line, free bodies clear.

/** An 8 × 6 m room of 0.20 walls R1..R4 (R1 along y = 0, inner faces at 0.1, 7.9 and 5.9). */
const ROOM = rectLoop("R", 0, 0, 8, 6);
const mm = (v: number): number => Math.round(v * 1000) / 1000;

/** A column K centred at (cx, cy), w along its centreline turned `rotation` degrees, d deep; joints Ka and Kb. */
function column(cx: number, cy: number, w: number, d: number, rotation = 0, round = false): Spec {
  const r = (rotation * Math.PI) / 180;
  const [ux, uy] = [(Math.cos(r) * w) / 2, (Math.sin(r) * w) / 2];
  const f = round ? mm : (v: number): number => v;
  return { joints: [["Ka", f(cx - ux), f(cy - uy)], ["Kb", f(cx + ux), f(cy + uy)]], columns: [["K", "Ka", "Kb", d]] };
}

function messages(doc: Document): string[] {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => v.message);
}

function invariants(doc: Document): InvariantId[] {
  const r = validateDocument(doc);
  return r.ok ? [] : [...new Set(r.error.map((v) => v.invariant))].sort();
}

/** The free column at (4, 3), 0.30 wide, with extra joints and walls at its ends. */
function withEnds(joints: Spec["joints"], walls: Spec["walls"], depth = 0.3): Document {
  return loops(ROOM, column(4, 3, 0.3, depth), { joints, walls });
}

describe("columns: sizes (I20, pillars.04)", () => {
  it("a free 0.30 × 0.30 column validates", () => {
    expect(messages(loops(ROOM, column(4, 3, 0.3, 0.3)))).toEqual([]);
  });

  it("width 0.10 and 2.00 accepted, 0.09 and 2.01 refused with \"0.10–2.00\" in the message", () => {
    for (const w of [0.1, 2]) expect(messages(loops(ROOM, column(4, 3, w, 0.3)))).toEqual([]);
    for (const w of [0.09, 2.01]) {
      const doc = loops(ROOM, column(4, 3, w, 0.3));
      expect(invariants(doc)).toEqual(["I20"]);
      const [message] = messages(doc);
      expect(message).toContain("Column K");
      expect(message).toContain("width");
      expect(message).toContain("0.10–2.00");
    }
    expect(messages(loops(ROOM, column(4, 3, 2.01, 0.3)))).toEqual(["Column K width 2.01 m is outside 0.10–2.00 m"]);
  });

  it("depth 0.10 and 2.00 accepted, 0.09 and 2.01 refused with \"0.10–2.00\" in the message", () => {
    for (const d of [0.1, 2]) expect(messages(loops(ROOM, column(4, 3, 0.3, d)))).toEqual([]);
    for (const d of [0.09, 2.01]) {
      const doc = loops(ROOM, column(4, 3, 0.3, d));
      expect(invariants(doc)).toEqual(["I20"]);
      const [message] = messages(doc);
      expect(message).toContain("Column K");
      expect(message).toContain("depth");
      expect(message).toContain("0.10–2.00");
    }
  });

  it("sizes compare within 0.5 mm", () => {
    expect(messages(loops(ROOM, column(4, 3, 0.3, 0.0996)))).toEqual([]);
    expect(messages(loops(ROOM, column(4, 3, 0.3, 2.0004)))).toEqual([]);
    expect(invariants(loops(ROOM, column(4, 3, 0.3, 0.0994)))).toEqual(["I20"]);
    expect(invariants(loops(ROOM, column(4, 3, 0.3, 2.0006)))).toEqual(["I20"]);
  });

  it("a wall thickness of 0.60 is refused for a wall and accepted as a column depth", () => {
    const wall = loops(ROOM, { joints: [["A", 2, 3], ["B", 6, 3]], walls: [["W", "A", "B", 0.6]] });
    expect(messages(wall)).toEqual(["Wall W thickness 0.6 m is outside 0.05 to 0.50 m"]);
    expect(messages(loops(ROOM, column(4, 3, 0.3, 0.6)))).toEqual([]);
    // A column's depth is checked against the column limits only, never as a wall's thickness (I13).
    expect(invariants(loops(ROOM, column(4, 3, 0.3, 0.04)))).toEqual(["I20"]);
  });
});

describe("columns: ends (I20, pillars.21)", () => {
  it("a column with a wall at one end only is refused", () => {
    const doc = withEnds([["X", 5, 3]], [["WX", "Kb", "X"]]);
    expect(invariants(doc)).toEqual(["I20"]);
    expect(messages(doc)).toEqual(["Column K has a wall at one end only; a column stands free or in a wall's line"]);
  });

  it("two walls at one column end are refused", () => {
    const doc = withEnds([["P", 3, 3], ["X", 5, 3], ["Y", 4.15, 4]], [["WP", "P", "Ka"], ["WX", "Kb", "X"], ["WY", "Kb", "Y"]]);
    expect(invariants(doc)).toEqual(["I20"]);
    expect(messages(doc)).toEqual(["Column K has more than one wall at an end; a column stands free or in a wall's line"]);
  });

  it("a non-collinear wall at a column end is refused", () => {
    const doc = withEnds([["P", 3, 3], ["Y", 4.15, 4]], [["WP", "P", "Ka"], ["WY", "Kb", "Y"]]);
    expect(invariants(doc)).toEqual(["I20"]);
    expect(messages(doc)).toEqual(["Column K is not in line with walls WP and WY"]);
  });

  it("an in-line column (wall, column, wall sharing joints, collinear) validates, a 1.20-deep one in a 0.20 wall's line too", () => {
    const line = (depth: number): Document => withEnds([["P", 1, 3], ["Q", 7, 3]], [["WP", "P", "Ka"], ["WQ", "Kb", "Q"]], depth);
    expect(messages(line(0.3))).toEqual([]);
    expect(messages(line(1.2))).toEqual([]);
    expect(columnOf(line(1.2), "K")?.line).toEqual(["WP", "WQ"]);
  });

  it("an in-line column on an off-grid, slanted line validates with its joints rounded to the millimetre", () => {
    const [p, q] = [{ x: 0.613, y: 0.871 }, { x: 7.288, y: 5.104 }];
    const at = (t: number): [number, number] => [mm(p.x + (q.x - p.x) * t), mm(p.y + (q.y - p.y) * t)];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const doc = loops(ROOM, {
      joints: [["P", p.x, p.y], ["Q", q.x, q.y], ["Ka", ...at(0.45)], ["Kb", ...at(0.45 + 0.4 / len)]],
      walls: [["WP", "P", "Ka"], ["WQ", "Kb", "Q"]],
      columns: [["K", "Ka", "Kb", 0.5]],
    });
    expect(messages(doc)).toEqual([]);
    expect(columnOf(doc, "K")?.line).toEqual(["WP", "WQ"]);
  });
});

describe("columns: bodies (I20, pillars.21)", () => {
  it("a free column whose body touches or overlaps a wall body is refused", () => {
    // R1's body is y −0.10 to 0.10; the column is 0.30 deep along x, so its body's bottom is at cy − 0.15.
    for (const cy of [0.2, 0.25, 0.2505]) {
      const doc = loops(ROOM, column(4, cy, 0.3, 0.3));
      expect(invariants(doc)).toEqual(["I20"]);
      expect(messages(doc)).toEqual(["Column K touches wall R1"]);
    }
    expect(messages(loops(ROOM, column(4, 0.252, 0.3, 0.3)))).toEqual([]); // 2 mm clear
  });

  it("an in-line column whose body touches a wall other than its two neighbours is refused", () => {
    // In a line at y = 0.5, 0.80 deep: its body reaches down to 0.10, R1's inner face.
    const doc = loops(ROOM, column(4, 0.5, 0.3, 0.8), { joints: [["P", 1, 0.5], ["Q", 7, 0.5]], walls: [["WP", "P", "Ka"], ["WQ", "Kb", "Q"]] });
    expect(messages(doc)).toEqual(["Column K touches wall R1"]);
  });
});

describe("columnOf", () => {
  it("reads back centre, width, depth and rotation for a turned, off-grid column", () => {
    const doc = loops(ROOM, column(2.345, 1.678, 0.4, 0.25, 30, true));
    const k = columnOf(doc, "K");
    expect(k).not.toBeNull();
    expect(k?.id).toBe("K");
    expect(k?.centre.x).toBeCloseTo(2.345, 3);
    expect(k?.centre.y).toBeCloseTo(1.678, 3);
    expect(k?.width).toBeCloseTo(0.4, 2);
    expect(Math.abs((k?.width ?? 0) - 0.4)).toBeLessThan(0.0015);
    expect(k?.depth).toBe(0.25);
    expect(Math.abs((k?.rotation ?? 0) - 30)).toBeLessThan(0.25);
    expect(k?.line).toBeNull();
    expect(messages(doc)).toEqual([]);
    const back = columnOf(loops(ROOM, column(2.345, 1.678, 0.4, 0.25, 210, true)), "K");
    expect(Math.abs((back?.rotation ?? 0) - 210)).toBeLessThan(0.25);
  });

  it("is null for a wall row and a missing row", () => {
    const doc = loops(ROOM, column(4, 3, 0.3, 0.3));
    expect(columnOf(doc, "R1")).toBeNull();
    expect(columnOf(doc, "nope")).toBeNull();
  });
});

describe("a wall row's base and column (I8)", () => {
  it("parses a floor or deck base and a boolean column, and refuses other values", () => {
    const row = wallRow("W", "A", "B");
    expect(parseWall(row)).toEqual(row);
    expect(parseWall({ ...row, base: "D1" })).toEqual({ ...row, base: "D1" });
    expect(parseWall({ ...row, column: true })).toEqual({ ...row, column: true });
    expect(parseWall({ ...row, base: 7 })).toBeNull();
    expect(parseWall({ ...row, column: "yes" })).toBeNull();
    const noBase: Record<string, unknown> = { ...row };
    delete noBase.base;
    expect(parseWall(noBase)).toBeNull();
  });

  it("validation refuses a malformed base or column, and a base naming a missing deck (I21)", () => {
    const doc = (patch: Record<string, unknown>): Document => {
      const d = loops(ROOM);
      const r1 = d.walls.R1;
      if (!r1) throw new Error("no R1");
      return { ...d, walls: { ...d.walls, R1: { ...r1, ...patch } } };
    };
    expect(invariants(doc({ base: 7 }))).toEqual(["I8"]);
    expect(invariants(doc({ column: "yes" }))).toEqual(["I8"]);
    expect(messages(doc({ base: "D1" }))).toEqual(["Wall R1 stands on a missing deck"]);
  });
});
