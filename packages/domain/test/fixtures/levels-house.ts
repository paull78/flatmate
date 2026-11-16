import { unwrap } from "@fm/protocol";
import { execute } from "../../src/commands/execute";
import type { Command } from "../../src/commands/types";
import { motifDefaults } from "../../src/finishes";
import { emptyDocument, type Document } from "../../src/model";
import { rectangleRoom } from "../../src/scripts";

// The levels fixture (cycle home, spec: levels): one house every room feature and per-level query is run against, in
// `levels-fixture.test.ts`. The Tokyo loft's proportions, so a wall on the loft is tall enough for a door.
//
//   y 3.9 ┌──────────────────────┬─────────┬──────────┐      ceiling 5.20
//         │ loft (top 2.45)      │         │ platform │      room "Main": walls sage, a floor finish,
//         │ wardrobe  ║ loft     │  floor  │ (top .45)│      a named area on the floor, outside brick
//         │           ║ wall,    │  ║ floor│  chest   │
//         │           ║ door,    │  ║ wall │          │
//   y 0.1 └───────────╨─window───┴──╨──────┴──────────┘
//       x 0.1        2.5        4.1  5.0   5.9       7.9

export const STATE = "s0";
export const ROOM = "main";
export const LOFT = "loft/k0";
export const PLATFORM = "platform/k0";
export const LOFT_WALL = "lw/w0";
export const FLOOR_WALL = "fw/w0";
/** An outside wall: the room on its left, outside on its right. */
export const SHELL_WALL = "shell-1/w0";
export const LOFT_DOOR = "ld/d0";
export const LOFT_WINDOW = "lwin/d0";
export const LOFT_PIECE = "lp/p0";
export const PLATFORM_PIECE = "pp/p0";
export const FLOOR_PIECE = "fp/p0";
export const AREA = "area/a0";

export const SAGE = { ...motifDefaults("plain"), colour: "#a8b59a" };
export const NAVY = { ...motifDefaults("plain"), colour: "#2f3e57" };
export const BRICK = motifDefaults("brick");

export function run(doc: Document, ...commands: Command[]): Document {
  return commands.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

/** The house with no piece and no wall on its loft: the room, its defaults, the two decks, the floor wall and the area. */
export function levelsShell(): Document {
  return run(emptyDocument(),
    ...rectangleRoom({ x: 0, y: 0 }, 8, 4, "shell"),
    { type: "setCeiling", height: 5.2 },
    { type: "labelZone", id: ROOM, at: { x: 5.4, y: 3 }, name: "Main", finish: motifDefaults("widePlanks") },
    { type: "setRoomWallFinishes", labelId: ROOM, part: "finish", finish: SAGE },
    { type: "setOutsideFinish", part: "finish", finish: BRICK },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.1, y: 2 }, w: 4, d: 3.8, top: 2.45 },
    { type: "addDeck", opId: "platform", preset: "platform", at: { x: 6.9, y: 2 }, w: 2, d: 3.8 },
    { type: "addWall", opId: "fw", from: { at: { x: 5, y: 0.1 } }, to: { at: { x: 5, y: 2 } } },
    { type: "addArea", opId: "area", at: { x: 5, y: 3 }, w: 1.4, d: 1, name: "Nook" });
}

/** The loft's piece alone, for a house whose only piece stands on the loft. */
export const PLACE_LOFT_PIECE: Command = { type: "placeObject", opId: "lp", state: STATE, object: { kind: "wardrobe", name: "Loft wardrobe" }, at: { x: 1, y: 1.5 }, deck: LOFT };

/** The house without the wall on its loft: for counts that the loft wall must not change. */
export function levelsHouseBare(): Document {
  return run(levelsShell(),
    PLACE_LOFT_PIECE,
    { type: "placeObject", opId: "pp", state: STATE, object: { kind: "storageChest", name: "Platform chest" }, at: { x: 7.4, y: 3 }, deck: PLATFORM },
    { type: "placeObject", opId: "fp", state: STATE, object: { kind: "storageChest", name: "Floor chest" }, at: { x: 5.4, y: 3.5 }, deck: null });
}

/** The levels fixture: the bare house plus the wall on the loft with its door and window. */
export function levelsHouse(): Document {
  return run(levelsHouseBare(),
    { type: "addWall", opId: "lw", from: { at: { x: 2.5, y: 0.1 } }, to: { at: { x: 2.5, y: 3.9 } }, base: LOFT },
    { type: "addOpening", opId: "ld", wall: LOFT_WALL, kind: "swing", offset: 2.6, width: 0.8 },
    { type: "addOpening", opId: "lwin", wall: LOFT_WALL, kind: "window", offset: 0.5, width: 0.8 });
}
