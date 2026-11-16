import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { invariantsMessage } from "../src/errors";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { rectDoc } from "./helpers";

// Area commands (areas step 02, areas.04, .09): addArea and setArea round to the millimetre, name "Area N", need the
// centre in a room; I26 refuses overlaps and areas under 0.30 m; a wall edit is never refused for an area.

const room = (): Document => rectDoc(0, 0, 6, 4); // clear floor 0.1–5.9 × 0.1–3.9
const run = (doc: Document, cmd: Command) => unwrap(execute(doc, cmd));
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const add = (opId: string, x: number, y: number, w: number, d: number, name?: string): Command => ({ type: "addArea", opId, at: { x, y }, w, d, ...(name === undefined ? {} : { name }) });
const moveRightWall = (x: number): Command => ({ type: "moveJoints", moves: [{ jointId: "J2", to: { x, y: 0 } }, { jointId: "J3", to: { x, y: 4 } }] });

describe("addArea", () => {
  it("adds a rounded row named Area 1, then Area 2, and its inverse removes it", () => {
    const one = run(room(), add("k", 1.10004, 1.1, 1.8, 1.6));
    expect(one.doc.areas["k/a0"]).toEqual({ id: "k/a0", name: "Area 1", at: { x: 1.1, y: 1.1 }, w: 1.8, d: 1.6 });
    const two = run(one.doc, add("l", 4, 1.1, 1.8, 1.6));
    expect(two.doc.areas["l/a0"]?.name).toBe("Area 2");
    expect(unwrap(applyPatch(one.doc, invertPatch(one.patch))).areas).toEqual({});
  });

  it("keeps a given name, and a blank one is numbered", () => {
    expect(run(room(), add("k", 2, 2, 2, 2, "Kitchen")).doc.areas["k/a0"]?.name).toBe("Kitchen");
    expect(run(room(), add("k", 2, 2, 2, 2, "  ")).doc.areas["k/a0"]?.name).toBe("Area 1");
  });

  it("refuses a centre in no room with Draw an area inside a room", () => {
    expect(refusal(room(), add("k", 8, 2, 1, 1))).toBe("Draw an area inside a room");
  });

  it("refuses an area under 0.30 m on a side (I26)", () => {
    expect(refusal(room(), add("k", 2, 2, 0.29, 1))).toBe("A named area is at least 0.30 m a side");
  });

  it("accepts areas sharing a side and refuses a 1 mm overlap with Overlaps Kitchen", () => {
    const doc = run(room(), add("k", 1.1, 2, 2, 2, "Kitchen")).doc; // x 0.1–2.1
    expect(refusal(doc, add("l", 3.1, 2, 2, 2))).toBe("accepted"); // x 2.1–4.1
    expect(refusal(doc, add("l", 3.099, 2, 2, 2))).toBe("Overlaps Kitchen");
  });
});

describe("setArea", () => {
  const two = (): Document => run(run(room(), add("k", 1.1, 2, 2, 2, "Kitchen")).doc, add("l", 4, 2, 1.5, 1.5, "Living")).doc;

  it("renames, moves and resizes, and its inverse restores", () => {
    const doc = two();
    const r = run(doc, { type: "setArea", areaId: "l/a0", name: "Dining", at: { x: 4.5, y: 2.5 }, w: 1.2, d: 1 });
    expect(r.doc.areas["l/a0"]).toEqual({ id: "l/a0", name: "Dining", at: { x: 4.5, y: 2.5 }, w: 1.2, d: 1 });
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch))).areas).toEqual(doc.areas);
  });

  it("refuses moving into another area with Overlaps and the other's name", () => {
    expect(refusal(two(), { type: "setArea", areaId: "l/a0", at: { x: 2.5, y: 2 } })).toBe("Overlaps Kitchen");
    expect(refusal(two(), { type: "setArea", areaId: "k/a0", w: 5 })).toBe("Overlaps Living");
  });

  it("refuses moving the centre out of every room", () => {
    expect(refusal(two(), { type: "setArea", areaId: "l/a0", at: { x: 7, y: 2 } })).toBe("Draw an area inside a room");
  });

  it("refuses an unknown area", () => {
    expect(refusal(two(), { type: "setArea", areaId: "nope", name: "X" })).toBe("Area not found");
  });

  it("resizes an area whose centre a wall left outside every room, keeping its centre", () => {
    const doc = run(run(room(), add("k", 4.4, 2, 3, 2)).doc, moveRightWall(4)).doc; // the centre at x 4.4 is past the face at 3.9
    expect(refusal(doc, { type: "setArea", areaId: "k/a0", w: 2 })).toBe("accepted");
    expect(refusal(doc, { type: "setArea", areaId: "k/a0", at: { x: 4.5, y: 2 } })).toBe("Draw an area inside a room");
  });
});

describe("walls never refused for an area (areas.04)", () => {
  it("a wall moved through an area is accepted and leaves the area as it was", () => {
    const doc = run(room(), add("k", 4.4, 2, 3, 2)).doc; // x 2.9–5.9
    const moved = run(doc, moveRightWall(5.4));
    expect(moved.doc.areas).toEqual(doc.areas);
  });

  it("a wall edit that leaves an area's centre outside every room is accepted", () => {
    const doc = run(room(), add("k", 4.4, 2, 3, 2)).doc;
    expect(refusal(doc, moveRightWall(4))).toBe("accepted");
  });
});

describe("I26 for a server rejection", () => {
  it("has a toast of its own", () => {
    expect(invariantsMessage(new Set(["I26"]))).toBe("Named areas can't overlap");
  });
});
