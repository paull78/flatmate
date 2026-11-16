import { describe, expect, it } from "vitest";
import { UNDERLAY_ID, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc, studioDoc, underlayCommand, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The underlay can't be selected (import.06, AC-04): clicks, the box, snapping and Delete act on the drawing as if
// the picture were not there. Each test runs the same gestures on a drawing with a picture covering it and without.

const COVER = underlayCommand({ width: 900, height: 700 }); // x −1.373 to 7.627, y −1.783 to 5.217: the whole room
const CORNER: Point = { x: -1.373, y: 5.217 }; // the picture's top-left, off the grid

/** box-select.test.ts's drawing: the studio with a label and chairs c1, c2 in Layout and one in Night. */
const boxDoc = (): Document =>
  withCommands(
    studioDoc(),
    { type: "labelZone", id: "L1", at: { x: 3, y: 0.6 }, name: "Studio", finish: null },
    { type: "placeObject", linked: false, deck: null, opId: "c1", state: "s0", object: { kind: "chair" }, at: { x: 4, y: 3 } },
    { type: "placeObject", linked: false, deck: null, opId: "c2", state: "s0", object: { kind: "chair" }, at: { x: 5, y: 3 } },
    { type: "placeObject", linked: false, deck: null, opId: "cn", state: "n/s0", object: { kind: "chair" }, at: { x: 4, y: 3 } },
  );

/** The same drawing with and without the covering picture. */
function pair(doc: Document): { covered: FakeShell; plain: FakeShell } {
  return { covered: FakeShell.withDocument(withCommands(doc, COVER)), plain: FakeShell.withDocument(doc) };
}

const onUnderlay = (refs: readonly (EntityRef | null)[]): boolean => refs.some((r) => r?.table === "underlays");

describe("the underlay passes input through to the drawing (AC-04)", () => {
  it("a click on empty floor and on a wall acts on the drawing only", () => {
    const { covered, plain } = pair(roomDoc());
    expect(covered.doc().underlays[UNDERLAY_ID]).toBeDefined();
    for (const at of [{ x: 2, y: 0 }, { x: 4.7, y: 2.3 }, { x: 2.9, y: 4 }]) {
      for (const shell of [covered, plain]) shell.click(at);
      expect(covered.state.selection, `click at ${at.x},${at.y}`).toEqual(plain.state.selection);
      expect(covered.state.hover).toEqual(plain.state.hover);
      expect(onUnderlay([...covered.state.selection, covered.state.hover])).toBe(false);
    }
    expect(covered.state.selection).toHaveLength(1); // the last click selected the top wall
  });

  it("a box selection over the underlay selects the same placements", () => {
    const { covered, plain } = pair(boxDoc());
    for (const shell of [covered, plain]) shell.drag({ x: 3.5, y: 2.4 }, { x: 5.5, y: 3.2 });
    expect(covered.state.selection).toEqual(plain.state.selection);
    expect(covered.state.selection.length).toBeGreaterThan(0);
    expect(onUnderlay(covered.state.selection)).toBe(false);
  });

  it("Delete over the underlay deletes the selected wall and leaves the underlay", () => {
    const { covered, plain } = pair(roomDoc());
    const row = covered.doc().underlays[UNDERLAY_ID];
    for (const shell of [covered, plain]) {
      shell.click({ x: 2, y: 0 });
      expect(shell.state.selection.map((r) => r.table)).toEqual(["walls"]);
      shell.key("Delete");
    }
    expect(Object.keys(covered.doc().walls)).toHaveLength(3);
    expect(covered.doc().walls).toEqual(plain.doc().walls);
    expect(covered.doc().underlays[UNDERLAY_ID]).toBe(row);
  });

  it("snapping ignores the underlay's corners", () => {
    const { covered } = pair(roomDoc());
    covered.ui({ type: "pickTool", tool: "wall" });
    covered.moveTo({ x: CORNER.x + 0.02, y: CORNER.y });
    const snap = covered.state.snap;
    expect(snap?.kind).not.toBe("endpoint");
    if (snap) expect(Math.hypot(snap.point.x - CORNER.x, snap.point.y - CORNER.y)).toBeGreaterThan(0.005);
  });
});
