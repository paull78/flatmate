import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import { CEILING_ID, type Document } from "../src/model";
import { deserialize, serialize } from "../src/serialize";
import { validateDocument } from "../src/validate";
import { outsideOf, roomWallsOf } from "../src/wall-defaults";
import { sidesOf } from "../src/wall-sides";
import { docOf } from "./helpers";

// Room and house defaults (inherit step 01, AC-02, AC-04): a room's Walls on its label, the house's Outside walls on the
// ceiling row (inherit.01, .07); a wall's six fields mean a custom side, which always has a finish (inherit.02).

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const messages = (d: Document): string[] => { const r = validateDocument(d); return r.ok ? [] : r.error.map((v) => v.message); };

const sage = { ...motifDefaults("plain"), colour: "#a8b59a" };
const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };
const subway = motifDefaults("subwayTiles");
const planks = motifDefaults("widePlanks");

/** Two rooms side by side, "Bath" (x 0–2) and "Main" (x 2–6), 3 m deep. */
function twoRooms(): Document {
  return docOf({
    joints: [["A", 0, 0], ["B", 2, 0], ["C", 6, 0], ["D", 6, 3], ["E", 2, 3], ["F", 0, 3]],
    walls: [["AB", "A", "B"], ["BC", "B", "C"], ["CD", "C", "D"], ["DE", "D", "E"], ["EF", "E", "F"], ["FA", "F", "A"], ["BE", "B", "E"]],
    labels: [["Bath", 1, 1.5, "Bath"], ["Main", 4, 1.5, "Main"]],
  });
}

describe("a room's Walls default lives on its label (inherit.01)", () => {
  it("setRoomWallFinishes writes the label and no wall", () => {
    const doc0 = twoRooms();
    const doc = run(run(doc0,
      { type: "setRoomWallFinishes", labelId: "Main", part: "finish", finish: sage }),
      { type: "setRoomWallFinishes", labelId: "Main", part: "lower", finish: subway, height: 1.2 });
    expect(roomWallsOf(doc.zoneLabels.Main!)).toEqual({ finish: sage, lower: { finish: subway, height: 1.2 } });
    expect(doc.walls).toEqual(doc0.walls);
  });

  it("clears to nothing stored", () => {
    let doc = run(twoRooms(), { type: "setRoomWallFinishes", labelId: "Main", part: "finish", finish: sage });
    doc = run(doc, { type: "setRoomWallFinishes", labelId: "Main", part: "finish", finish: null });
    expect(roomWallsOf(doc.zoneLabels.Main!)).toBeNull();
    expect(Object.keys(doc.zoneLabels.Main!).sort()).toEqual(["at", "finish", "id", "name"]);
  });

  it("its patch touches only the label", () => {
    const r = execute(twoRooms(), { type: "setRoomWallFinishes", labelId: "Main", part: "finish", finish: sage });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.puts.map((p) => p.table)).toEqual(["zoneLabels"]);
  });
});

describe("the house's Outside walls default lives on the ceiling row (inherit.07)", () => {
  it("setOutsideFinish writes it, and setCeiling keeps it", () => {
    let doc = run(twoRooms(), { type: "setOutsideFinish", part: "finish", finish: planks });
    doc = run(doc, { type: "setOutsideFinish", part: "lower", finish: subway, height: 0.5 });
    expect(outsideOf(doc)).toEqual({ finish: planks, lower: { finish: subway, height: 0.5 } });
    doc = run(doc, { type: "setCeiling", shape: "shed" });
    expect(outsideOf(doc)?.finish).toEqual(planks);
    doc = run(doc, { type: "setCeiling", height: 2.6 });
    expect(outsideOf(doc)?.lower?.height).toBe(0.5);
  });

  it("refuses a band without a height in range, naming it", () => {
    expect(refusal(twoRooms(), { type: "setOutsideFinish", part: "lower", finish: subway, height: 5 })).toBe("height must be 0.10–3.00");
  });
});

describe("a custom side (inherit.02, .04)", () => {
  it("setWallSide sets the whole side in one command; resetWallSide clears that side only", () => {
    let doc = run(twoRooms(), { type: "setWallSide", wallId: "BC", side: "left", finish: navy, lower: subway, height: 1.2 });
    doc = run(doc, { type: "setWallSide", wallId: "BC", side: "right", finish: planks, lower: null });
    expect(sidesOf(doc.walls.BC!)).toEqual({ left: { finish: navy, lower: { finish: subway, height: 1.2 } }, right: { finish: planks, lower: null } });
    const r = execute(doc, { type: "resetWallSide", wallId: "BC", side: "left" });
    if (!r.ok) throw new Error(r.error.message);
    expect(sidesOf(r.value.doc.walls.BC!)).toEqual({ left: null, right: { finish: planks, lower: null } });
  });

  it("can't have no finish: setWallFinish and setWallSide refuse None, and a band needs the side's finish first", () => {
    const custom = run(twoRooms(), { type: "setWallSide", wallId: "BC", side: "left", finish: navy, lower: null });
    expect(refusal(custom, { type: "setWallFinish", wallId: "BC", side: "left", part: "finish", finish: null })).toBe("A custom side needs a finish; Reset returns it to its room's");
    expect(refusal(twoRooms(), { type: "setWallFinish", wallId: "BC", side: "left", part: "lower", finish: subway, height: 1.2 })).toBe("Set this side's finish first: a custom side needs one");
    expect(refusal(custom, { type: "setWallFinish", wallId: "BC", side: "left", part: "lower", finish: subway, height: 1.2 })).toBe("accepted");
    expect(refusal(custom, { type: "setWallFinish", wallId: "BC", side: "left", part: "lower", finish: null })).toBe("accepted");
  });

  it("a stored band without its side's finish is refused by I8", () => {
    const doc = twoRooms();
    const bad: Document = { ...doc, walls: { ...doc.walls, BC: { ...doc.walls.BC!, lowerLeft: subway, lowerLeftHeight: 1.2 } } };
    expect(messages(bad).join(" ")).toContain("lowerLeft needs finishLeft");
  });

  it("resetting a side that isn't custom changes nothing", () => {
    const doc = twoRooms();
    const r = execute(doc, { type: "resetWallSide", wallId: "BC", side: "left" });
    expect(r.ok && r.value.doc).toBe(doc);
  });
});

describe("stored and checked", () => {
  it("label and ceiling defaults round-trip through storage", () => {
    let doc = run(twoRooms(), { type: "setRoomWallFinishes", labelId: "Main", part: "lower", finish: subway, height: 1.2 });
    doc = run(doc, { type: "setOutsideFinish", part: "finish", finish: planks });
    const back = deserialize(serialize(doc));
    expect(back.ok && roomWallsOf(back.value.zoneLabels.Main!)).toEqual({ finish: null, lower: { finish: subway, height: 1.2 } });
    expect(back.ok && outsideOf(back.value)).toEqual({ finish: planks, lower: null });
  });

  it("I8 names a bad default's field, and a band's height goes with its band", () => {
    const doc = twoRooms();
    const label = { ...doc.zoneLabels.Main!, wallsLower: subway };
    expect(messages({ ...doc, zoneLabels: { ...doc.zoneLabels, Main: label } }).join(" ")).toContain("wallsLower and wallsLowerHeight go together");
    const ceiling = { id: CEILING_ID, height: 2.5, outside: { ...planks, motif: "herringbone" as const } };
    expect(messages({ ...doc, ceilings: { [CEILING_ID]: ceiling } }).join(" ")).toContain("outside.motif");
    const high = { ...doc.zoneLabels.Main!, wallsLower: subway, wallsLowerHeight: 4 };
    expect(messages({ ...doc, zoneLabels: { ...doc.zoneLabels, Main: high } }).join(" ")).toContain("wallsLowerHeight must be 0.10–3.00");
  });
});
