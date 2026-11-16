import { describe, expect, it } from "vitest";
import { columnOf } from "../src/column-checks";
import { execute } from "../src/commands/execute";
import type { Command, JointRef } from "../src/commands/types";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

// placeColumn and setColumn for a free column, and the lock on wall commands (pillars.18, .22, .30; AC-04, AC-19).

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
type Place = Extract<Command, { type: "placeColumn" }>;
const place = (opId: string, x: number, y: number, extra: Partial<Place> = {}): Place => ({ type: "placeColumn", opId, at: { x, y }, width: 0.3, depth: 0.3, ...extra });

/** A 6 × 4 m room of 0.20 walls W1..W4 (W1 along y = 0). */
const ROOM = rectDoc(0, 0, 6, 4);
/** ROOM with a free 0.30 × 0.30 column c/w0 at (2, 1), joints c/j0 (1.85, 1) and c/j1 (2.15, 1). */
const WITH_COLUMN = run(ROOM, place("c", 2, 1));
const LOCKED = "Column c/w0 can't be edited as a wall; edit its position, width and depth";

/** ROOM with W1 split around an in-line 0.30 × 0.30 column K (Ka at x 2.85, Kb at x 3.15) between W1a and W1b. */
const IN_LINE = docOf({
  joints: [["J1", 0, 0], ["Ka", 2.85, 0], ["Kb", 3.15, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
  walls: [["W1a", "J1", "Ka"], ["W1b", "Kb", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
  columns: [["K", "Ka", "Kb", 0.3]],
});

describe("placeColumn, free", () => {
  it("at (2, 1) 0.30 × 0.30 adds one column row and two joints; columnOf reads back centre and size", () => {
    expect(Object.keys(WITH_COLUMN.walls).filter((id) => !(id in ROOM.walls))).toEqual(["c/w0"]);
    expect(Object.keys(WITH_COLUMN.joints).filter((id) => !(id in ROOM.joints)).sort()).toEqual(["c/j0", "c/j1"]);
    expect(WITH_COLUMN.walls["c/w0"]).toEqual({ id: "c/w0", a: "c/j0", b: "c/j1", thickness: 0.3, top: "ceiling", base: "floor", column: true });
    expect(WITH_COLUMN.joints["c/j0"]).toEqual({ id: "c/j0", x: 1.85, y: 1 });
    expect(WITH_COLUMN.joints["c/j1"]).toEqual({ id: "c/j1", x: 2.15, y: 1 });
    expect(columnOf(WITH_COLUMN, "c/w0")).toMatchObject({ centre: { x: 2, y: 1 }, depth: 0.3, rotation: 0, line: null });
    expect(columnOf(WITH_COLUMN, "c/w0")?.width).toBeCloseTo(0.3, 12);
    expect(validateDocument(WITH_COLUMN).ok).toBe(true);
  });

  it("a turned, off-grid column reads back its centre, width and rotation within 1e-9 (joints not rounded, pillars.30)", () => {
    const doc = run(ROOM, place("t", 2.345, 1.234, { width: 0.5, depth: 0.25, rotation: 30 }));
    const c = columnOf(doc, "t/w0");
    if (!c) throw new Error("no column");
    expect(Math.abs(c.width - 0.5)).toBeLessThan(1e-9);
    expect(Math.abs(c.rotation - 30)).toBeLessThan(1e-9);
    expect(Math.abs(c.centre.x - 2.345)).toBeLessThan(1e-9);
    expect(Math.abs(c.centre.y - 1.234)).toBeLessThan(1e-9);
    expect(c.depth).toBe(0.25);
    // a is at the negative end along the rotation.
    const a = doc.joints["t/j0"];
    expect(a && a.x < 2.345 && a.y < 1.234).toBe(true);
  });

  it("width 2.01 or depth 0.09 is refused naming the range (AC-04)", () => {
    expect(refusal(ROOM, place("w", 3, 2, { width: 2.01 }))).toContain("0.10–2.00");
    expect(refusal(ROOM, place("w", 3, 2, { depth: 0.09 }))).toContain("0.10–2.00");
    expect(refusal(ROOM, place("w", 3, 2, { width: 2, depth: 0.1 }))).toBe("accepted");
  });

  it("outside every room is refused", () => {
    expect(refusal(ROOM, place("o", 8, 2))).toBe("A column stands inside a room");
    expect(refusal(docOf({}), place("o", 0, 0))).toBe("A column stands inside a room");
  });

  it("a body touching a wall's body is refused naming the wall", () => {
    const message = refusal(ROOM, place("b", 3, 0.2));
    expect(message).toContain("Column b/w0");
    expect(message).toContain("W1");
  });

  it("refuses a bad, long or used operation ID and a non-finite size or position", () => {
    expect(refusal(ROOM, place("bad id", 2, 1))).toBe("Invalid operation ID");
    expect(refusal(ROOM, place("a".repeat(121), 2, 1))).toBe("Invalid operation ID");
    expect(refusal(WITH_COLUMN, place("c", 4, 2))).toBe("Operation ID already used");
    expect(refusal(ROOM, place("n", Number.NaN, 1))).toBe("Invalid position");
    expect(refusal(ROOM, place("n", 2, 1, { width: Number.POSITIVE_INFINITY }))).toBe("Invalid size");
    expect(refusal(ROOM, place("n", 2, 1, { rotation: Number.NaN }))).toBe("Invalid rotation");
  });
});

describe("setColumn, free", () => {
  it("moves, resizes and turns a free column", () => {
    const moved = run(WITH_COLUMN, { type: "setColumn", wallId: "c/w0", at: { x: 3, y: 2 } });
    expect(columnOf(moved, "c/w0")).toMatchObject({ centre: { x: 3, y: 2 }, depth: 0.3, rotation: 0 });
    const resized = run(moved, { type: "setColumn", wallId: "c/w0", width: 0.4, depth: 0.2 });
    const r = columnOf(resized, "c/w0");
    expect(r?.depth).toBe(0.2);
    expect(r?.width).toBeCloseTo(0.4, 9);
    expect(r?.centre.x).toBeCloseTo(3, 9);
    const turned = run(resized, { type: "setColumn", wallId: "c/w0", rotation: 90 });
    const t = columnOf(turned, "c/w0");
    expect(t?.rotation).toBeCloseTo(90, 9);
    expect(t?.width).toBeCloseTo(0.4, 9);
    expect(t?.centre.y).toBeCloseTo(2, 9);
    expect(Object.keys(turned.joints).length).toBe(Object.keys(WITH_COLUMN.joints).length);
  });

  it("a depth change alone leaves the joints as they are", () => {
    const doc = run(WITH_COLUMN, { type: "setColumn", wallId: "c/w0", depth: 0.4 });
    expect(doc.joints).toBe(WITH_COLUMN.joints);
    expect(doc.walls["c/w0"]?.thickness).toBe(0.4);
  });

  it("is refused into a wall body, out of every room, past the size range, on a non-column, and turning an in-line column", () => {
    const into = refusal(WITH_COLUMN, { type: "setColumn", wallId: "c/w0", at: { x: 3, y: 0.15 } });
    expect(into).toContain("Column c/w0");
    expect(into).toContain("W1");
    expect(refusal(WITH_COLUMN, { type: "setColumn", wallId: "c/w0", at: { x: 8, y: 2 } })).toBe("A column stands inside a room");
    expect(refusal(WITH_COLUMN, { type: "setColumn", wallId: "c/w0", width: 2.01 })).toContain("0.10–2.00");
    expect(refusal(WITH_COLUMN, { type: "setColumn", wallId: "W1", depth: 0.3 })).toBe("Wall W1 is not a column");
    expect(refusal(WITH_COLUMN, { type: "setColumn", wallId: "nope", depth: 0.3 })).toBe("Wall not found");
    expect(refusal(IN_LINE, { type: "setColumn", wallId: "K", rotation: 90 })).toBe("A column in a wall's line turns with its wall");
  });
});

describe("the lock: wall commands refuse a column (pillars.18, .22, AC-19)", () => {
  it("the in-line fixture is valid", () => {
    expect(validateDocument(IN_LINE).ok).toBe(true);
  });

  it("moveJoints on a column's joint", () => {
    expect(refusal(WITH_COLUMN, { type: "moveJoints", moves: [{ jointId: "c/j0", to: { x: 1.8, y: 1 } }] })).toBe(LOCKED);
    expect(refusal(IN_LINE, { type: "moveJoints", moves: [{ jointId: "J1", to: { x: 0, y: 0.1 } }, { jointId: "Kb", to: { x: 3.2, y: 0 } }] })).toContain("Column K ");
  });

  it("setWallLength on a column row, or moving a column's joint", () => {
    expect(refusal(WITH_COLUMN, { type: "setWallLength", wallId: "c/w0", length: 0.4, keep: "a" })).toBe(LOCKED);
    expect(refusal(IN_LINE, { type: "setWallLength", wallId: "W1a", length: 2.5, keep: "a" })).toContain("Column K ");
  });

  it("setWallThickness and setWallTop on a column row", () => {
    expect(refusal(WITH_COLUMN, { type: "setWallThickness", wallId: "c/w0", thickness: 0.2 })).toBe(LOCKED);
    expect(refusal(WITH_COLUMN, { type: "setWallTop", wallId: "c/w0", top: 2 })).toBe(LOCKED);
  });

  it("addWall ending on a column's joint, splitting a column, or crossing or touching one", () => {
    const wall = (opId: string, from: JointRef, to: { x: number; y: number }): Command => ({ type: "addWall", opId, from, to: { at: to } });
    expect(refusal(WITH_COLUMN, wall("x", { existing: "c/j0" }, { x: 1.85, y: 3 }))).toBe(LOCKED);
    expect(refusal(WITH_COLUMN, wall("x", { at: { x: 1.85, y: 1 } }, { x: 1.85, y: 3 }))).toBe(LOCKED);
    expect(refusal(WITH_COLUMN, wall("x", { at: { x: 2, y: 1 } }, { x: 2, y: 3 }))).toBe(LOCKED);
    expect(refusal(IN_LINE, wall("x", { existing: "Ka" }, { x: 2.85, y: 3 }))).toContain("Column K ");
    expect(refusal(WITH_COLUMN, wall("x", { at: { x: 2, y: 0 } }, { x: 2, y: 4 }))).toBe("Column c/w0 touches wall x/w0");
    expect(refusal(WITH_COLUMN, wall("x", { at: { x: 0, y: 1.2 } }, { x: 6, y: 1.2 }))).toBe("Column c/w0 touches wall x/w0");
  });

  it("deleting a column's joint", () => {
    expect(refusal(WITH_COLUMN, { type: "deleteEntities", ids: [{ table: "joints", id: "c/j1" }] })).toBe(LOCKED);
  });

  it("addOpening on a column row", () => {
    expect(refusal(WITH_COLUMN, { type: "addOpening", opId: "d", wall: "c/w0", kind: "window", offset: 0, width: 0.3 })).toBe(LOCKED);
  });

  it("other walls stay editable", () => {
    expect(refusal(WITH_COLUMN, { type: "setWallThickness", wallId: "W2", thickness: 0.3 })).toBe("accepted");
    expect(refusal(WITH_COLUMN, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6.5, y: 4 } }] })).toBe("accepted");
  });
});

describe("deleting a column", () => {
  it("deleteEntities with the column row removes it and both joints", () => {
    const doc = run(WITH_COLUMN, { type: "deleteEntities", ids: [{ table: "walls", id: "c/w0" }] });
    expect(doc.walls["c/w0"]).toBeUndefined();
    expect(doc.joints["c/j0"]).toBeUndefined();
    expect(doc.joints["c/j1"]).toBeUndefined();
    expect(Object.keys(doc.walls).sort()).toEqual(Object.keys(ROOM.walls).sort());
  });
});

describe("execute: IDs in the column commands", () => {
  it("an invalid wall ID in setColumn is \"Invalid ID\"; placeColumn's opId has its own message", () => {
    for (const wallId of ["constructor", "__proto__", "has space"]) {
      expect(execute(WITH_COLUMN, { type: "setColumn", wallId, depth: 0.3 })).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Invalid ID" } });
    }
    expect(execute(ROOM, place("__proto__ x", 2, 1))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Invalid operation ID" } });
  });
});

describe("clashes name the column with its range (Try it step 2)", () => {
  it("a piece moved into a column", () => {
    const state = Object.keys(WITH_COLUMN.states)[0] ?? "";
    expect(refusal(WITH_COLUMN, { type: "placeObject", opId: "o", state, object: { kind: "chair" }, at: { x: 2, y: 0.95 }, deck: null }))
      .toMatch(/^Chair \(0\.00–0\.\d\d\) and Column \(0\.00–2\.50\) overlap in /);
  });
});
