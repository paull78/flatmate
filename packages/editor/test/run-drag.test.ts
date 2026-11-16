import { describe, expect, it } from "vitest";
import { columnOf, execute, openingGeometry, unwrap, type Document } from "@fm/domain";
import { zeroMoveDependencies } from "../src/tools/drag-commit";
import { wallsTarget } from "../src/tools/run-drag";
import { dividedRoomDoc, jointAt, pointOf, roomDoc, wallBetween, wallDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// Step 05 (straight.02, .03, .04): a wall drag moves the wall's straight run; a connected run only across itself;
// a free run like an object; Ctrl keeps the axis and rounds to the millimetre. The grid is 0.2 m at 80 px/m.

describe("a wall drag moves its run, across only", () => {
  it("drags a wall joined at both ends across only: the hand's wobble along it is dropped (AC-01)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.drag({ x: 6, y: 2 }, { x: 6.4, y: 2.13 }); // 0.13 along would round to 0.2 on the old per-axis grid
    expect(pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 0 }))).toEqual({ x: 6.4, y: 0 });
    expect(pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 4 }))).toEqual({ x: 6.4, y: 4 });
  });

  it("moves the kinked house's top run whole, through its T, verticals staying vertical (AC-02)", () => {
    const shell = FakeShell.withDocument(kinkedHouseDoc());
    shell.ui({ type: "setSnapStep", step: 0.01 });
    shell.drag({ x: 10, y: 2.85 }, { x: 10.04, y: 2.64 });
    const doc = shell.doc();
    for (const j of ["c9b9", "db4f", "afdbb"]) expect(doc.joints[j]?.y).toBeCloseTo(2.64, 9);
    expect(doc.joints.c9b9?.x).toBe(8.875);
    expect(doc.joints.db4f?.x).toBe(11.577);
    expect(doc.joints.afdbb?.x).toBe(13);
    expect(doc.joints["372a"]).toEqual(kinkedHouseDoc().joints["372a"]); // the slanted piece's far end stays
  });

  it("moves a free wall in x and y; Shift keeps the larger axis (AC-03)", () => {
    const free = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 3, y: 0 }));
    free.drag({ x: 1.5, y: 0 }, { x: 2.13, y: 0.79 });
    expect(pointOf(free.doc(), jointAt(wallDoc({ x: 0, y: 0 }, { x: 3, y: 0 }), { x: 0, y: 0 }))).toEqual({ x: 0.6, y: 0.8 });
    const shift = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 3, y: 0 }));
    shift.drag({ x: 1.5, y: 0 }, { x: 2.13, y: 0.79 }, { shift: true });
    expect(pointOf(shift.doc(), jointAt(wallDoc({ x: 0, y: 0 }, { x: 3, y: 0 }), { x: 0, y: 0 }))).toEqual({ x: 0, y: 0.8 });
  });

  it("carries a column in the wall's line rigidly (AC-04)", () => {
    const doc = withCommands(roomDoc(), { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.3 });
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 1, y: 0 }, { x: 1, y: 0.4 });
    const column = columnOf(shell.doc(), "c/w0");
    expect(column?.centre.y).toBeCloseTo(0.4, 9);
    expect(column?.width).toBeCloseTo(0.4, 9);
    expect(column?.line).not.toBeNull();
  });

  it("with Ctrl keeps across-only and rounds to the millimetre", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.drag({ x: 6, y: 2 }, { x: 6.6337, y: 2.13 }, { ctrl: true });
    const moved = pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 4 }));
    expect(Math.abs(moved.x - 6.634)).toBeLessThanOrEqual(1e-9);
    expect(moved.y).toBe(4);
  });

  it("depends on every joint of the run before the first attempt", () => {
    const doc = kinkedHouseDoc();
    const target = wallsTarget(doc, "wc9b9");
    expect(target).toMatchObject({ kind: "walls", wallIds: ["wc9b9", "wdb4fb"] });
    const deps = zeroMoveDependencies(doc, target);
    for (const id of ["c9b9", "db4f", "afdbb"]) expect(deps).toContainEqual({ table: "joints", id });
  });

  it("moving a partition across leaves the windows on the wall it T's into at their places (AC-07)", () => {
    const base = dividedRoomDoc(); // a divider (3, 0) → (3, 4) T-ing into the bottom and top walls
    const bottomRight = wallBetween(base, { x: 3, y: 0 }, { x: 6, y: 0 });
    const doc: Document = unwrap(execute(base, { type: "addOpening", opId: "win", wall: bottomRight, kind: "window", offset: 1.5 })).doc;
    const before = openingGeometry(doc, "win/d0")?.start;
    const shell = FakeShell.withDocument(doc);
    shell.drag({ x: 3, y: 2 }, { x: 3.8, y: 2 });
    expect(shell.doc().joints[jointAt(base, { x: 3, y: 0 })]?.x).toBeCloseTo(3.8, 9);
    expect(openingGeometry(shell.doc(), "win/d0")?.start.x).toBeCloseTo(before?.x ?? 0, 9);
  });
});
