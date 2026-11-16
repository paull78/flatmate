import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document, type EntityRef } from "@fm/domain";
import { roomDoc } from "../builders";
import { FakeShell } from "../fake-shell";

// Picking pieces that overlap in plan (heights.16, .33, .38, AC-10): pieces under the cursor are taken in the one
// stacking order (by bottom, then ID); a click picks the first, a click where the selected piece lies picks the next
// and back round; a press and drag moves the selected piece when it is under the cursor.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } });
const P = (id: string): EntityRef => ({ table: "placements", id });
const TABLE = P("t/p0");
const BED = P("l/p0");

/** The 6 × 4 room: a desk (the table) on the top wall at x 2.4–3.6, y 3.3–3.9, under a lift bed up at x 2.15–3.85, y 1.8–3.9. */
const tableUnderBed = (): Document => ok(roomDoc(), place("t", "desk", 3, 3.9), place("l", "liftBed", 3, 3.9));
const ON_BOTH = { x: 3, y: 3.6 };

describe("selection cycling (AC-10)", () => {
  it("click on the table picks the table, again the lift bed, again the table", () => {
    const shell = FakeShell.withDocument(tableUnderBed());
    shell.click(ON_BOTH);
    expect(shell.state.selection).toEqual([TABLE]);
    shell.click(ON_BOTH);
    expect(shell.state.selection).toEqual([BED]);
    shell.click(ON_BOTH);
    expect(shell.state.selection).toEqual([TABLE]);
  });

  it("bare floor inside the bed's outline picks the bed at once", () => {
    const shell = FakeShell.withDocument(tableUnderBed());
    shell.click({ x: 3, y: 2.5 });
    expect(shell.state.selection).toEqual([BED]);
  });

  it("a drag after cycling moves the bed, not the table; a drag with nothing selected moves the table", () => {
    const shell = FakeShell.withDocument(tableUnderBed());
    shell.click(ON_BOTH);
    shell.click(ON_BOTH); // the bed
    const before = shell.doc();
    shell.drag(ON_BOTH, { x: 3.4, y: 3.6 });
    expect(shell.doc().placements["l/p0"]?.at.x).toBeCloseTo(3.4, 6);
    expect(shell.doc().placements["t/p0"]).toEqual(before.placements["t/p0"]);
    const fresh = FakeShell.withDocument(tableUnderBed());
    fresh.drag(ON_BOTH, { x: 3.4, y: 3.6 });
    expect(fresh.doc().placements["t/p0"]?.at.x).toBeCloseTo(3.4, 6);
    expect(fresh.doc().placements["l/p0"]).toEqual(tableUnderBed().placements["l/p0"]);
  });

  it("three pieces stacked in plan cycle by bottom: table, a box from 0.80, the bed, and round", () => {
    const doc = ok(tableUnderBed(), place("b", "block", 5, 3.9), { type: "setObjectSize", objectId: "b/o0", w: 0.6, d: { standard: 0.6 }, h: { standard: 0.2 }, z: { standard: 0.8 } },
      { type: "movePlacement", placementId: "b/p0", at: { x: 3, y: 3.9 }, rotation: 0 }); // raised first, then moved over the table
    const shell = FakeShell.withDocument(doc);
    const picks: EntityRef[][] = [];
    for (let i = 0; i < 4; i++) {
      shell.click(ON_BOTH);
      picks.push(shell.state.selection);
    }
    expect(picks).toEqual([[TABLE], [P("b/p0")], [BED], [TABLE]]);
  });

  it("walls are hit before pieces: a click on a peninsula half wall under a wall cabinet selects the wall", () => {
    let doc = ok(roomDoc(), { type: "addWall", opId: "pen", from: { at: { x: 1, y: 2 } }, to: { at: { x: 2.5, y: 2 } } });
    doc = ok(doc, { type: "setWallTop", wallId: "pen/w0", top: 1.1 }, place("c", "wallCabinet", 1.75, 2.5),
      { type: "setObjectSize", objectId: "c/o0", w: 0.6, d: { standard: 0.7 } }); // y 1.80–2.50 at 1.40, over the wall body y 1.9–2.1
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 1.75, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: "pen/w0" }]);
    shell.click({ x: 1.75, y: 2.45 }); // beside the wall body, on the cabinet
    expect(shell.state.selection).toEqual([P("c/p0")]);
  });

  it("box select catches both pieces", () => {
    const shell = FakeShell.withDocument(tableUnderBed());
    shell.drag({ x: -0.5, y: -0.5 }, { x: 6.5, y: 4.5 });
    expect(shell.state.selection.filter((r) => r.table === "placements")).toEqual([BED, TABLE]); // with the room's walls (straight.09)
  });
});
