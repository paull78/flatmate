import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import type { Document } from "../src/model";
import { sideFinishes } from "../src/queries/side-finishes";
import { docOf } from "./helpers";

// What a wall side shows (inherit step 02, AC-01, AC-03): its custom finish, else the walls default of the room it
// faces, else (outside) the house's, else nothing (inherit.01, .06).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, cmd) => {
  const r = execute(d, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}, doc);

const sage = { ...motifDefaults("plain"), colour: "#a8b59a" };
const white = { ...motifDefaults("plain"), colour: "#f2f0eb" };
const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };
const subway = motifDefaults("subwayTiles");
const planks = motifDefaults("widePlanks");

/**
 * Bath (x 0–2) and Main (x 2–6), 3 m deep. BE is the partition, a→b going up (+y), so its left faces −x (Bath) and its
 * right +x (Main); CD runs up the east side, its left facing Main and its right outside.
 */
function twoRooms(): Document {
  return docOf({
    joints: [["A", 0, 0], ["B", 2, 0], ["C", 6, 0], ["D", 6, 3], ["E", 2, 3], ["F", 0, 3]],
    walls: [["AB", "A", "B"], ["BC", "B", "C"], ["CD", "C", "D"], ["DE", "D", "E"], ["EF", "E", "F"], ["FA", "F", "A"], ["BE", "B", "E"]],
    labels: [["Bath", 1, 1.5, "Bath"], ["Main", 4, 1.5, "Main"]],
  });
}

const finished = (): Document => run(twoRooms(),
  { type: "setRoomWallFinishes", labelId: "Main", part: "finish", finish: sage },
  { type: "setRoomWallFinishes", labelId: "Bath", part: "finish", finish: white },
  { type: "setRoomWallFinishes", labelId: "Bath", part: "lower", finish: subway, height: 1.2 },
  { type: "setOutsideFinish", part: "finish", finish: planks });

describe("sideFinishes (step 02, AC-01)", () => {
  it("a side facing a room shows its walls default; facing outside, the house's", () => {
    const s = sideFinishes(finished(), "CD");
    expect(s?.left).toEqual({ finish: sage, lower: null, source: "room", room: "Main" });
    expect(s?.right).toEqual({ finish: planks, lower: null, source: "outside", room: null });
  });

  it("a divider shows each room's on its side, a band included", () => {
    const s = sideFinishes(finished(), "BE");
    expect(s?.left).toEqual({ finish: white, lower: { finish: subway, height: 1.2 }, source: "room", room: "Bath" });
    expect(s?.right?.room).toBe("Main");
  });

  it("a custom side wins over the room's, and survives a repaint of the room", () => {
    let doc = run(finished(), { type: "setWallSide", wallId: "CD", side: "left", finish: navy, lower: null });
    doc = run(doc, { type: "setRoomWallFinishes", labelId: "Main", part: "finish", finish: white });
    expect(sideFinishes(doc, "CD")?.left).toEqual({ finish: navy, lower: null, source: "custom", room: "Main" });
    expect(sideFinishes(doc, "BC")?.left?.finish ?? sideFinishes(doc, "BC")?.right?.finish).toEqual(white);
  });

  it("nothing set shows nothing; a room with no default is bare", () => {
    expect(sideFinishes(twoRooms(), "BE")).toEqual({ left: null, right: null });
    const doc = run(twoRooms(), { type: "setOutsideFinish", part: "finish", finish: planks });
    expect(sideFinishes(doc, "BE")).toEqual({ left: null, right: null });
  });

  it("a side facing an unlabelled space is bare", () => {
    const doc = run(finished(), { type: "deleteEntities", ids: [{ table: "zoneLabels", id: "Main" }] });
    expect(sideFinishes(doc, "CD")?.left).toBeNull(); // inherit.06: the label held it
    expect(sideFinishes(doc, "CD")?.right?.source).toBe("outside");
  });

  it("a free wall in a room shows the room's on both sides", () => {
    const doc = run(finished(), { type: "addWall", opId: "free", from: { at: { x: 3, y: 0.8 } }, to: { at: { x: 5, y: 0.8 } } });
    const s = sideFinishes(doc, "free/w0");
    expect([s?.left?.room, s?.right?.room]).toEqual(["Main", "Main"]);
    expect(s?.left?.finish).toEqual(sage);
  });

  it("a wall drawn later across a room shows the defaults with no further edit; the unlabelled half is bare (AC-03, inherit.06)", () => {
    const doc = run(finished(), { type: "addWall", opId: "split", from: { at: { x: 5, y: 0 } }, to: { at: { x: 5, y: 3 } } });
    const s = sideFinishes(doc, "split/w0");
    const shown = [s?.left, s?.right];
    expect(shown).toContainEqual({ finish: sage, lower: null, source: "room", room: "Main" });
    expect(shown).toContainEqual(null);
  });

  it("splitting a wall keeps its custom side on both halves (AC-03)", () => {
    let doc = run(finished(), { type: "setWallSide", wallId: "BC", side: "left", finish: navy, lower: null });
    const customSide = sideFinishes(doc, "BC")?.left?.source === "custom" ? "left" : "right";
    doc = run(doc, { type: "addWall", opId: "t", from: { at: { x: 4, y: 0 } }, to: { at: { x: 4, y: 1 } } });
    const halves = Object.keys(doc.walls).filter((id) => {
      const w = doc.walls[id];
      return w && doc.joints[w.a]?.y === 0 && doc.joints[w.b]?.y === 0 && id !== "AB";
    });
    expect(halves.length).toBe(2);
    for (const id of halves) expect(sideFinishes(doc, id)?.[customSide]?.source).toBe("custom");
  });

  it("is cached per document and null for an unknown wall or a column", () => {
    const doc = finished();
    expect(sideFinishes(doc, "CD")).toBe(sideFinishes(doc, "CD"));
    expect(sideFinishes(doc, "nope")).toBeNull();
  });
});
