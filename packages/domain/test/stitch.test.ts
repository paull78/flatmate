import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import type { Document, EntityRef } from "../src/model";
import { openingGeometry } from "../src/queries/openings";
import { docOf, rectDoc, withOpening } from "./helpers";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// Stitching (straight.05, .17): deleting a wall that cut another stitches the pieces it leaves, when they are now in
// line and alike; Delete on a straight joint joins it, or refuses naming the difference; a near-straight joint refuses.

const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };
const white = { ...motifDefaults("plain"), colour: "#ffffff" };

function run(doc: Document, cmd: Command): Document {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const del = (ids: EntityRef[]): Command => ({ type: "deleteEntities", ids });
const joint = (id: string): EntityRef => ({ table: "joints", id });
const wallRef = (id: string): EntityRef => ({ table: "walls", id });

/** The 6 × 4 room with a partition T-ing into the bottom wall at x 3, splitting it into B1 (0..3) and B2 (3..6). */
function teed(): Document {
  return run(rectDoc(0, 0, 6, 4), { type: "addWall", opId: "p", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 2 } } });
}

describe("stitch on delete", () => {
  it("deleting a T partition leaves one wall: the one keeping its joint a, its openings at their world places (AC-09)", () => {
    const base = teed();
    expect(Object.keys(base.walls)).toHaveLength(6);
    const doc = withOpening(base, { id: "win", wall: "p/w1", offset: 1, kind: "window" }); // on the right piece, x 4..5
    const before = openingGeometry(doc, "win")?.start;
    const after = run(doc, del([wallRef("p/w0")]));
    expect(Object.keys(after.walls).sort()).toEqual(["W1", "W2", "W3", "W4"]);
    expect(after.walls.W1).toMatchObject({ a: "J1", b: "J2" });
    expect(Object.keys(after.joints).sort()).toEqual(["J1", "J2", "J3", "J4"]);
    expect(after.openings.win?.wall).toBe("W1");
    expect(openingGeometry(after, "win")?.start).toEqual(before);
  });

  it("pieces that differ stay two walls: a custom tile on one side", () => {
    const doc = run(teed(), { type: "setWallSide", wallId: "p/w1", side: "left", finish: navy, lower: null });
    const after = run(doc, del([wallRef("p/w0")]));
    expect(Object.keys(after.walls)).toHaveLength(5);
  });

  it("a custom white beside an inherited white stitches (shown finishes compared)", () => {
    const labelled = run(teed(), { type: "labelZone", id: "L", at: { x: 1, y: 3 }, name: "Room", finish: null });
    const doc = run(run(labelled, { type: "setRoomWallFinishes", labelId: "L", part: "finish", finish: white }), { type: "setWallSide", wallId: "p/w1", side: "left", finish: white, lower: null });
    const after = run(doc, del([wallRef("p/w0")]));
    expect(Object.keys(after.walls)).toHaveLength(4);
  });

  it("a dimension anchored to the stitched joint goes with it", () => {
    const doc = run(teed(), { type: "addDimension", opId: "m", a: { x: 3, y: 0 }, b: { x: 6, y: 0 }, offset: 0.5 });
    expect(Object.keys(doc.dimensions)).toHaveLength(1);
    const after = run(doc, del([wallRef("p/w0")]));
    expect(Object.keys(after.dimensions)).toHaveLength(0);
  });

  it("two partitions deleted at once stitch three pieces into one", () => {
    const doc = run(teed(), { type: "addWall", opId: "q", from: { at: { x: 4.5, y: 0 } }, to: { at: { x: 4.5, y: 2 } } });
    expect(Object.keys(doc.walls)).toHaveLength(8);
    const after = run(doc, del([wallRef("p/w0"), wallRef("q/w0")]));
    expect(Object.keys(after.walls).sort()).toEqual(["W1", "W2", "W3", "W4"]);
  });

  it("records both far joints, both walls and their openings as dependencies", () => {
    const doc = withOpening(teed(), { id: "win", wall: "p/w1", offset: 1, kind: "window" });
    const r = execute(doc, del([wallRef("p/w0")]));
    if (!r.ok) throw new Error(r.error.message);
    for (const dep of [{ table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "walls", id: "W1" }, { table: "walls", id: "p/w1" }, { table: "openings", id: "win" }]) {
      expect(r.value.patch.dependencies).toContainEqual(dep);
    }
  });

  it("a joint the delete didn't leave behind is never stitched", () => {
    // A split joint S elsewhere stays, since the deleted wall doesn't end at it.
    const doc = docOf({
      joints: [["J1", 0, 0], ["S", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["F1", 1, 2], ["F2", 2, 2]],
      walls: [["B1", "J1", "S"], ["B2", "S", "J2"], ["R", "J2", "J3"], ["T", "J3", "J4"], ["L", "J4", "J1"], ["F", "F1", "F2"]],
    });
    const after = run(doc, del([wallRef("F")]));
    expect(Object.keys(after.walls).sort()).toEqual(["B1", "B2", "L", "R", "T"]);
  });
});

describe("Delete on a straight joint", () => {
  const split = (): Document => docOf({
    joints: [["J1", 0, 0], ["S", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
    walls: [["B1", "J1", "S"], ["B2", "S", "J2"], ["R", "J2", "J3"], ["T", "J3", "J4"], ["L", "J4", "J1"]],
  });

  it("joins matching walls and opens no room (AC-10)", () => {
    const after = run(split(), del([joint("S")]));
    expect(Object.keys(after.walls).sort()).toEqual(["B1", "L", "R", "T"]);
    expect(after.walls.B1).toMatchObject({ a: "J1", b: "J2" });
    expect(after.joints.S).toBeUndefined();
  });

  it("refuses walls of different thickness, naming both, changing nothing", () => {
    const doc = split();
    doc.walls.B2 = { ...doc.walls.B2!, thickness: 0.12 };
    expect(refusal(doc, del([joint("S")]))).toBe("The walls differ in thickness (0.20 and 0.12 m)");
  });

  it("refuses walls that differ in finish, naming the side", () => {
    const doc = run(split(), { type: "setWallSide", wallId: "B2", side: "left", finish: navy, lower: null });
    expect(refusal(doc, del([joint("S")]))).toMatch(/differ in finish/);
  });

  it("refuses the kinked house's joint at (7.256, 2.84): 0.35° out of line (AC-11)", () => {
    expect(refusal(kinkedHouseDoc(), del([joint("372a")]))).toBe("These walls are 0.35° out of line: move one side to line them up");
  });

  it("a corner and a T keep today's rule: their walls go", () => {
    const after = run(split(), del([joint("J2")]));
    expect(Object.keys(after.walls).sort()).toEqual(["B1", "L", "T"]);
  });
});
