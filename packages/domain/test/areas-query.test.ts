import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { areaM2, areaRoom } from "../src/queries/areas";
import { deckViews, slabArea } from "../src/queries/decks";
import { faceAt } from "../src/queries/zones";
import { rectDoc } from "./helpers";

// An area's room and m² (areas.04, .17): one query, cut to its room's clear floor, less what stands inside it.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const room = (): Document => rectDoc(0, 0, 6, 4); // clear floor 0.1–5.9 × 0.1–3.9
const add = (x: number, y: number, w: number, d: number): Command => ({ type: "addArea", opId: "k", at: { x, y }, w, d });
const moveRightWall = (x: number): Command => ({ type: "moveJoints", moves: [{ jointId: "J2", to: { x, y: 0 } }, { jointId: "J3", to: { x, y: 4 } }] });

describe("areaM2", () => {
  it("is its rectangle in a plain room", () => {
    expect(areaM2(run(room(), add(2, 2, 2, 3)), "k/a0")).toBeCloseTo(6, 9);
  });

  it("counts only the part in its room after a wall cuts it (AC-04)", () => {
    expect(areaM2(run(room(), add(4.4, 2, 3, 2), moveRightWall(5.4)), "k/a0")).toBeCloseTo(4.8, 9);
  });

  it("takes off a free column standing inside it", () => {
    const doc = run(room(), add(2, 2, 2, 2), { type: "placeColumn", opId: "c", at: { x: 2, y: 2 }, width: 0.3, depth: 0.3 });
    expect(areaM2(doc, "k/a0")).toBeCloseTo(4 - 0.09, 9);
  });

  it("is null with its centre in no room, and for an unknown area", () => {
    expect(areaM2(run(room(), add(4.4, 2, 3, 2), moveRightWall(4)), "k/a0")).toBeNull();
    expect(areaM2(room(), "nope")).toBeNull();
  });
});

describe("areaRoom", () => {
  it("is the room holding its centre", () => {
    const doc = run(room(), add(2, 2, 2, 2));
    expect(areaRoom(doc, "k/a0")?.face.key).toBe(faceAt(doc, { x: 2, y: 2 })?.key);
  });

  it("is null once its centre is outside every room", () => {
    expect(areaRoom(run(room(), add(4.4, 2, 3, 2), moveRightWall(4)), "k/a0")).toBeNull();
  });
});

describe("a deck's area", () => {
  it("is its rectangle less its holes: 2.40 × 1.75 less 0.80 × 1.00 is 3.40", () => {
    const doc = run(rectDoc(0, 0, 6, 4),
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.5, y: 1.2 }, w: 2.4, d: 1.75 },
      { type: "addDeckHole", opId: "well", deck: "loft/k0", at: { x: 1.5, y: 1.2 }, w: 0.8, d: 1 });
    const deck = deckViews(doc)[0];
    expect(deck && slabArea(deck)).toBeCloseTo(3.4, 9);
  });
});
