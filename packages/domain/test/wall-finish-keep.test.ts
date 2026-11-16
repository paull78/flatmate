import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import type { Document, Wall, WallSide, WallSides } from "../src/model";
import { sidesOf, withSides } from "../src/wall-sides";

const wallSidesOf = (w: Wall | undefined): WallSides | undefined => (w ? sidesOf(w) : undefined);
import { wallSideRooms } from "../src/queries/helpers";
import { rectDoc, rng } from "./helpers";

// A finish stays with its face (surfaces step 10, AC-04): through moves, splits and the column heal, each finish stays
// on the face it was set on; the heal joins halves only when their finishes match face to face (surfaces.13).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, cmd) => {
  const r = execute(d, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}, doc);
const red = { ...motifDefaults("plain"), colour: "#d0302a" };
const blue = { ...motifDefaults("plain"), colour: "#3050d0" };

/** The 6 × 4 room; W1 runs J1(0,0) → J2(6,0), so its left side faces the room (north) and its right the outside. */
const room = (): Document => rectDoc(0, 0, 6, 4);
const roomKey = (doc: Document): string => {
  const k = wallSideRooms(doc, "W1")?.left;
  if (k?.kind !== "room") throw new Error("W1's left faces no room");
  return k.key;
};
/** The finish on the face of each wall on the bottom line (y 0) that faces the room, by wall ID. */
function roomFaceFinishes(doc: Document): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const w of Object.values(doc.walls)) {
    const [a, b] = [doc.joints[w.a], doc.joints[w.b]];
    if (!a || !b || a.y !== 0 || b.y !== 0 || w.column) continue;
    const rooms = wallSideRooms(doc, w.id);
    const side: WallSide | null = rooms?.left.kind === "room" ? "left" : rooms?.right.kind === "room" ? "right" : null;
    out[w.id] = side ? (sidesOf(w)?.[side]?.finish?.colour ?? null) : null;
  }
  return out;
}

describe("a finish stays with its face (step 10, AC-04)", () => {
  it("moving a joint keeps the finishes", () => {
    const doc = run(room(), { type: "setWallFinish", wallId: "W1", side: "left", part: "finish", finish: red },
      { type: "moveJoints", moves: [{ jointId: "J2", to: { x: 6.5, y: 0 } }] });
    expect(wallSidesOf(doc.walls.W1)?.left?.finish).toEqual(red);
  });

  it("a T-junction split gives both pieces the finish on the same face", () => {
    const doc = run(room(), { type: "setWallFinish", wallId: "W1", side: "left", part: "finish", finish: red },
      { type: "addWall", opId: "t", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 2 } } });
    const faces = roomFaceFinishes(doc);
    expect(Object.keys(faces).length).toBe(2);
    expect(Object.values(faces)).toEqual([red.colour, red.colour]);
    expect(roomKey(room())).toBeTruthy();
  });

  it("a column placed in a wall's line gives both halves its finishes", () => {
    const doc = run(room(), { type: "setWallFinish", wallId: "W1", side: "left", part: "finish", finish: red },
      { type: "setWallFinish", wallId: "W1", side: "right", part: "finish", finish: blue },
      { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.4 });
    const halves = Object.values(doc.walls).filter((w) => !w.column && sidesOf(w));
    expect(halves.length).toBe(2);
    for (const h of halves) expect(sidesOf(h)).toEqual({ left: { finish: red, lower: null }, right: { finish: blue, lower: null } });
  });

  it("deleting that column heals the wall when the halves' finishes match, and leaves two walls when they differ", () => {
    const split = run(room(), { type: "setWallFinish", wallId: "W1", side: "left", part: "finish", finish: red },
      { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.4 });
    const column = Object.values(split.walls).find((w) => w.column)?.id;
    if (!column) throw new Error("no column");
    const healed = run(split, { type: "deleteEntities", ids: [{ table: "walls", id: column }] });
    expect(Object.keys(roomFaceFinishes(healed))).toEqual(["W1"]);
    expect(wallSidesOf(healed.walls.W1)?.left?.finish).toEqual(red);

    const other = Object.values(split.walls).find((w) => !w.column && w.id !== "W1" && sidesOf(w))?.id;
    if (!other) throw new Error("no second half");
    const differ = run(split, { type: "setWallFinish", wallId: other, side: "left", part: "finish", finish: blue },
      { type: "deleteEntities", ids: [{ table: "walls", id: column }] });
    expect(Object.values(roomFaceFinishes(differ)).sort()).toEqual([blue.colour, red.colour, null].sort()); // two halves and the column's segment
  });

  it("heals when the halves run opposite ways and match face to face", () => {
    const split = run(room(), { type: "setWallFinish", wallId: "W1", side: "left", part: "finish", finish: red },
      { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.4 });
    const column = Object.values(split.walls).find((w) => w.column)?.id;
    const other = Object.values(split.walls).find((w) => !w.column && w.id !== "W1" && sidesOf(w));
    if (!column || !other) throw new Error("no split");
    // The second half stored the other way round: its room face is now its right side.
    const flipped: Document = { ...split, walls: { ...split.walls, [other.id]: { ...withSides(other, { left: null, right: sidesOf(other)?.left ?? null }), a: other.b, b: other.a } } };
    const healed = run(flipped, { type: "deleteEntities", ids: [{ table: "walls", id: column }] });
    expect(Object.keys(roomFaceFinishes(healed))).toEqual(["W1"]);
    expect(wallSidesOf(healed.walls.W1)?.left?.finish).toEqual(red);
  });

  it("random T-splits keep every finish on its world face", () => {
    const random = rng(7);
    for (let i = 0; i < 25; i++) {
      const x = 0.5 + Math.round(random() * 50) / 10; // 0.5–5.5 on the bottom wall
      const doc = run(room(), { type: "setWallFinish", wallId: "W1", side: "left", part: "finish", finish: red },
        { type: "setWallFinish", wallId: "W1", side: "right", part: "finish", finish: blue },
        { type: "addWall", opId: `t${i}`, from: { at: { x, y: 0 } }, to: { at: { x, y: 2 } } });
      for (const w of Object.values(doc.walls).filter((v) => doc.joints[v.a]?.y === 0 && doc.joints[v.b]?.y === 0)) {
        const rooms = wallSideRooms(doc, w.id);
        const inside: WallSide = rooms?.left.kind === "room" ? "left" : "right";
        expect(sidesOf(w)?.[inside]?.finish, `${x} ${w.id}`).toEqual(red);
        expect(sidesOf(w)?.[inside === "left" ? "right" : "left"]?.finish, `${x} ${w.id}`).toEqual(blue);
      }
    }
  });
});
