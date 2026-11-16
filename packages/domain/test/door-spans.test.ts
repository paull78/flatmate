import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { doorSpans } from "../src/queries/door-spans";
import { faceAt } from "../src/queries/zones";
import { tinyHouse } from "./helpers";

// A door's span (thresholds.01, .02, .04, .05; spec "Where the floor changes"): between the wall's faces across the
// door, clipped to the wall's clear stretch, reaching 1 cm past the far face; the door line along the face the closed
// leaf lies on (`normal`'s side); the room beyond the far face, else beyond the door line, else none.
//
// The tiny house: a 7 × 2.5 m shell of 0.20 walls (inner faces x 0.1 / 6.9, y 0.1 / 2.4), the partition P on x = 2
// (faces 1.9 and 2.1) from Ja (2, 0) to Jb (2, 2.5): P's left (−x) is the bathroom, its right the main room.

const run = (doc: Document, ...cmds: Command[]): Document =>
  cmds.reduce((d, c) => {
    const r = execute(d, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    return r.value.doc;
  }, doc);
const door = (side: "left" | "right", kind: "swing" | "sliding" = "swing"): Command => ({ type: "addOpening", opId: "d", wall: "P", kind, offset: 1, width: 0.8, side });
const keyAt = (doc: Document, p: Point): string | null => faceAt(doc, p)?.key ?? null;
const BATH = { x: 1, y: 1.25 };
const MAIN = { x: 4, y: 1.25 };
const xs = (ps: readonly Point[]): number[] => [...new Set(ps.map((p) => Math.round(p.x * 1000) / 1000))].sort((a, b) => a - b);
const ys = (ps: readonly Point[]): number[] => [...new Set(ps.map((p) => Math.round(p.y * 1000) / 1000))].sort((a, b) => a - b);
const only = (doc: Document) => {
  const spans = doorSpans(doc);
  expect(spans).toHaveLength(1);
  const s = spans[0];
  if (!s) throw new Error("no span");
  return s;
};

describe("doorSpans", () => {
  it("a swing door swinging into the main room: the bathroom's floor, the line on the main room's face, the ring from 1 cm into the bathroom to that face", () => {
    const doc = run(tinyHouse(), door("right"));
    const s = only(doc);
    expect(s.room).toBe(keyAt(doc, BATH));
    expect(xs(s.line)).toEqual([2.1]);
    expect(ys(s.line)).toEqual([1, 1.8]);
    expect(xs(s.ring)).toEqual([1.89, 2.1]);
    expect(ys(s.ring)).toEqual([1, 1.8]);
  });

  it("the same door swinging into the bathroom: the main room's floor, the line on the bathroom's face", () => {
    const doc = run(tinyHouse(), door("left"));
    const s = only(doc);
    expect(s.room).toBe(keyAt(doc, MAIN));
    expect(xs(s.line)).toEqual([1.9]);
    expect(xs(s.ring)).toEqual([1.9, 2.11]);
  });

  it("a sliding door's door line is the face on its opening side, as a swing door's", () => {
    const doc = run(tinyHouse(), door("right", "sliding"));
    const s = only(doc);
    expect(s.room).toBe(keyAt(doc, BATH));
    expect(xs(s.line)).toEqual([2.1]);
  });

  it("an entrance on the shell swinging in takes the inside room's floor, its line on the inside face", () => {
    // W1b runs from Ja (2, 0) to J2 (7, 0): its left is +y, the inside.
    const doc = run(tinyHouse(), { type: "addOpening", opId: "e", wall: "W1b", kind: "swing", offset: 2, width: 0.9, side: "left" });
    const s = only(doc);
    expect(s.room).toBe(keyAt(doc, MAIN));
    expect(ys(s.line)).toEqual([0.1]);
    expect(ys(s.ring)).toEqual([-0.11, 0.1]);
  });

  it("a door in a stub wall inside one room takes that room's floor", () => {
    const doc = run(
      tinyHouse(),
      { type: "addWall", opId: "s", from: { at: { x: 4, y: 0.5 } }, to: { at: { x: 4, y: 2 } } },
    );
    const stub = Object.keys(doc.walls).find((id) => id.startsWith("s/"));
    if (!stub) throw new Error("no stub wall");
    const withDoor = run(doc, { type: "addOpening", opId: "d", wall: stub, kind: "sliding", offset: 0.3, width: 0.8, side: "left" });
    expect(only(withDoor).room).toBe(keyAt(withDoor, MAIN));
  });

  it("a door at offset 0 against the partition's T starts at the clear stretch, the partition's face, not at the joint", () => {
    // On W1b from Ja: the inside face starts at x 2.1 (the partition's face), the outside runs on to W1a.
    const doc = run(tinyHouse(), { type: "addOpening", opId: "e", wall: "W1b", kind: "swing", offset: 0, width: 0.9, side: "left" });
    const s = only(doc);
    expect(xs(s.ring)[0]).toBeCloseTo(2.1, 9);
    expect(xs(s.line)[0]).toBeCloseTo(2.1, 9);
  });

  it("windows have no span", () => {
    expect(doorSpans(run(tinyHouse(), { type: "addOpening", opId: "w", wall: "W1b", kind: "window", offset: 2, width: 1 }))).toEqual([]);
  });

  it("every ring point lies between 1 cm past the far face and the door line (AC-05)", () => {
    for (const side of ["left", "right"] as const) {
      const s = only(run(tinyHouse(), door(side)));
      const line = s.line[0]?.x ?? 0;
      const far = side === "right" ? 1.89 : 2.11;
      for (const p of s.ring) expect(Math.min(line, far) - 1e-9 <= p.x && p.x <= Math.max(line, far) + 1e-9).toBe(true);
    }
  });
});
