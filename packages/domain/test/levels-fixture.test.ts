import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Document } from "../src/model";
import { areaM2, areaRoom } from "../src/queries/areas";
import { clearanceWarnings } from "../src/queries/clearance";
import { placementRoom } from "../src/queries/footprints";
import { freeFloor, furnishedRooms } from "../src/queries/free-floor";
import { wallChain, wallSideRooms } from "../src/queries/helpers";
import { levels, openingShown, placementLevel, shownAt, type Level } from "../src/queries/levels";
import { roomWallSides } from "../src/queries/room-walls";
import { sideFinishes } from "../src/queries/side-finishes";
import { zones } from "../src/queries/zones";
import {
  AREA, FLOOR_PIECE, FLOOR_WALL, LOFT, LOFT_DOOR, LOFT_PIECE, LOFT_WALL, LOFT_WINDOW, NAVY, PLACE_LOFT_PIECE, PLATFORM, PLATFORM_PIECE, ROOM, SHELL_WALL, STATE,
  levelsHouse, levelsHouseBare, levelsShell, run,
} from "./fixtures/levels-house";

// The levels table (cycle home, spec: levels): every room feature and every per-level query, run against one house, each row
// checking that nothing crosses between the floor level and the loft and that the platform's things stay with the room.
// A room feature follows the level: it reaches the floor, platforms and raised floors, and stops at a loft. A clearance
// is measured from the surface its owner stands on.
//
// A new room feature or per-level query adds a row here: the "At levels:" line of its spec section points to this file.
//
// Most rows pin behaviour that was already right when the table was written (home.26); the wall-finish rows and the
// furnished-room row failed first. The table proves a row exists, not that it is complete. A wall stands on the floor or
// on a loft only (I21), so the house has no wall on its platform.

const floorOf = (doc: Document): Level => levels(doc)[0] ?? fail("no floor level");
const loftOf = (doc: Document): Level => levels(doc)[1] ?? fail("no loft level");
function fail(message: string): never { throw new Error(message); }
const roomKey = (doc: Document): string => zones(doc)[0]?.face.key ?? fail("no room");
const roles = (doc: Document, level: Level): string[] => (wallChain(doc, LOFT_WALL, level)?.pieces ?? []).map((p) => p.role);
/** A stool in front of the loft's wardrobe on the plan, standing on `deck`. */
const stoolAt = (deck: string | null): Document =>
  run(levelsHouse(), { type: "placeObject", opId: "b", state: STATE, object: { kind: "stool" }, at: { x: 1, y: 0.7 }, deck });

const ROWS: { name: string; check: () => void }[] = [
  {
    name: "levels: the floor and the loft; the platform is no level",
    check: () => {
      const doc = levelsHouse();
      expect(levels(doc).map((l) => l.deckIds)).toEqual([[], [LOFT]]);
      expect([LOFT_PIECE, PLATFORM_PIECE, FLOOR_PIECE].map((p) => placementLevel(doc, p)?.height)).toEqual([2.45, 0, 0]);
    },
  },
  {
    name: "wall finishes: a loft wall shows nothing without a custom finish",
    check: () => expect(sideFinishes(levelsHouse(), LOFT_WALL)).toEqual({ left: null, right: null }),
  },
  {
    name: "wall finishes: a loft wall shows its custom finish",
    check: () => {
      const shown = sideFinishes(run(levelsHouse(), { type: "setWallSide", wallId: LOFT_WALL, side: "left", finish: NAVY, lower: null }), LOFT_WALL);
      expect(shown?.left).toMatchObject({ finish: NAVY, source: "custom", room: null });
      expect(shown?.right).toBeNull();
    },
  },
  {
    name: "wall finishes: the floor wall beside the loft shows the room's default",
    check: () => {
      const shown = sideFinishes(levelsHouse(), FLOOR_WALL);
      expect([shown?.left?.source, shown?.right?.source]).toEqual(["room", "room"]);
      expect([shown?.left?.room, shown?.right?.room]).toEqual([ROOM, ROOM]);
    },
  },
  {
    name: "a room's walls at once: the floor wall, not the loft wall",
    check: () => {
      const walls = roomWallSides(levelsHouse(), ROOM).map((s) => s.wallId);
      expect(walls).toContain(FLOOR_WALL);
      expect(walls).not.toContain(LOFT_WALL);
    },
  },
  {
    name: "what a wall side faces: a room, outside, or the loft",
    check: () => {
      const doc = levelsHouse();
      expect(wallSideRooms(doc, LOFT_WALL)).toEqual({ left: { kind: "loft" }, right: { kind: "loft" } });
      expect(wallSideRooms(doc, SHELL_WALL)).toMatchObject({ left: { kind: "room" }, right: { kind: "outside" } });
      expect(wallSideRooms(doc, FLOOR_WALL)).toMatchObject({ left: { kind: "room" }, right: { kind: "room" } });
    },
  },
  {
    name: "areas: the room's area and its named area don't change with the loft's wall and piece",
    check: () => {
      const [shell, house] = [levelsShell(), levelsHouse()];
      expect(zones(house).map((z) => z.area)).toEqual(zones(shell).map((z) => z.area));
      expect(areaM2(house, AREA)).toBe(areaM2(shell, AREA));
      expect(areaRoom(house, AREA)?.face.key).toBe(roomKey(house));
    },
  },
  {
    name: "tags: the house is one room with its one label, with or without the loft's wall",
    check: () => {
      expect(zones(levelsHouse()).map((z) => z.labelIds)).toEqual([[ROOM]]);
      expect(zones(levelsHouse()).map((z) => z.face.key)).toEqual(zones(levelsShell()).map((z) => z.face.key));
    },
  },
  {
    name: "free floor: the platform's and the floor's piece take floor, the loft's takes none",
    check: () => {
      const shell = levelsShell();
      const area = zones(shell)[0]?.area ?? 0;
      expect(freeFloor(run(shell, PLACE_LOFT_PIECE), STATE).get(roomKey(shell))).toBe(area);
      const free = freeFloor(levelsHouseBare(), STATE).get(roomKey(shell)) ?? 0;
      expect(area - free).toBeCloseTo(2 * 0.8 * 0.45, 6); // the two chests
    },
  },
  {
    name: "furnished rooms: a room whose only piece stands on the loft is not furnished; a platform piece furnishes it",
    check: () => {
      const shell = levelsShell();
      expect([...furnishedRooms(run(shell, PLACE_LOFT_PIECE))]).toEqual([]);
      expect([...furnishedRooms(levelsHouseBare())]).toEqual([roomKey(shell)]);
      expect(placementRoom(levelsHouseBare(), PLATFORM_PIECE)).toBe(roomKey(shell)); // decks.34
    },
  },
  {
    name: "shown at a level: the loft's piece at the loft only, the platform's and the floor's at the floor only",
    check: () => {
      const doc = levelsHouse();
      const at = (p: string): boolean[] => [shownAt(doc, p, floorOf(doc)), shownAt(doc, p, loftOf(doc))];
      expect([at(LOFT_PIECE), at(PLATFORM_PIECE), at(FLOOR_PIECE)]).toEqual([[false, true], [true, false], [true, false]]);
    },
  },
  {
    name: "openings at a level: the loft wall's door and window are cut at the loft and hidden at the floor",
    check: () => {
      const doc = levelsHouse();
      for (const o of [LOFT_DOOR, LOFT_WINDOW]) expect([openingShown(doc, o, floorOf(doc)), openingShown(doc, o, loftOf(doc))]).toEqual(["hidden", "cut"]);
    },
  },
  {
    name: "the wall chain: the loft wall's openings are measured at the loft, not at the floor",
    check: () => {
      const doc = levelsHouse();
      expect(roles(doc, floorOf(doc))).toEqual(["gap"]);
      expect(roles(doc, loftOf(doc))).toEqual(["gap", "opening", "gap", "opening", "gap"]);
    },
  },
  {
    name: "use zones: a loft piece's zone is blocked by a piece on the loft, not by one under it on the floor",
    check: () => {
      expect(clearanceWarnings(stoolAt(LOFT), STATE)).toEqual([{ zone: { table: "placements", id: LOFT_PIECE, side: "front" }, against: { table: "placements", id: "b/p0" } }]);
      expect(clearanceWarnings(stoolAt(null), STATE)).toEqual([]);
    },
  },
  {
    name: "door swings: a loft door's swing is blocked by a piece on the loft, not by one under it on the floor",
    check: () => {
      const stool = (deck: string | null): Document => run(levelsHouse(), { type: "placeObject", opId: "b", state: STATE, object: { kind: "stool" }, at: { x: 2, y: 3.2 }, deck });
      expect(clearanceWarnings(stool(LOFT), STATE)).toEqual([{ zone: { table: "openings", id: LOFT_DOOR }, against: { table: "placements", id: "b/p0" } }]);
      expect(clearanceWarnings(stool(null), STATE)).toEqual([]);
    },
  },
  {
    name: "wheel wells: floor only, refused on the platform and on the loft, placed on the floor under the loft",
    check: () => {
      const well = (deck: string | null, x: number, y: number) => execute(levelsHouse(), { type: "placeObject", opId: "ww", state: STATE, object: { kind: "wheelWell", size: { w: 0.9, d: 0.4 } }, at: { x, y }, deck });
      expect([well(PLATFORM, 6.6, 1).ok, well(LOFT, 3, 3).ok, well(null, 3, 3).ok]).toEqual([false, false, true]);
    },
  },
];

describe("the levels table", () => {
  it.each(ROWS)("$name", ({ check }) => check());
});
