import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { newOpeningId, newWallId } from "../src/commands/created-ids";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { freeFloor } from "../src/queries/free-floor";
import { openingGeometry, suggestOpening } from "../src/queries/openings";
import { zones } from "../src/queries/zones";
import { BED_160x200, place, rectDoc, tinyHouse, withOpening } from "./helpers";

// The 6 × 4 room: W1 runs J1 (0, 0) → J2 (6, 0), so its left side (+y) is the room.

function run(doc: Document, cmd: Command): Document {
  return unwrap(execute(doc, cmd)).doc;
}
function refusal(doc: Document, cmd: Command): string {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
}
const roomAreas = (doc: Document) => zones(doc).map((z) => [z.face.key, z.area]);

describe("created ids (cleanup step 09)", () => {
  it("newOpeningId and newWallId name what addOpening and addWall create", () => {
    const room = rectDoc(0, 0, 4, 3);
    const wall = Object.keys(room.walls)[0] ?? "";
    const opening = unwrap(execute(room, { type: "addOpening", opId: "op9", wall, kind: "swing", offset: 1 }));
    expect(opening.patch.puts.filter((p) => p.table === "openings").map((p) => p.entity.id)).toEqual([newOpeningId("op9")]);
    const walled = unwrap(execute(room, { type: "addWall", opId: "w9", from: { at: { x: 1, y: 0.5 } }, to: { at: { x: 1, y: 2.5 } } }));
    expect(walled.patch.puts.filter((p) => p.table === "walls").map((p) => p.entity.id)).toContain(newWallId("w9"));
  });
});

describe("addOpening (spec: openings)", () => {
  it("a door suggested by a click near the wall's end is shifted to fit, opens to the click's side, hinged at the nearer end (AC-17)", () => {
    const room = rectDoc(0, 0, 6, 4);
    const s = suggestOpening(room, "W1", { x: 5.9, y: 0.3 }, "swing");
    expect(s).toEqual({ offset: 5.2, width: 0.8, side: "left", hinge: "b", sill: 0, head: 2.1 });
    const outside = suggestOpening(room, "W1", { x: 1, y: -0.3 }, "swing");
    expect(outside).toEqual({ offset: 0.6, width: 0.8, side: "right", hinge: "a", sill: 0, head: 2.1 });
    expect(suggestOpening(room, "W1", { x: 3, y: 0 }, "window")).toMatchObject({ offset: 2.5, width: 1 });

    if (!s) throw new Error("no suggestion");
    const next = run(room, { type: "addOpening", opId: "op1", wall: "W1", kind: "swing", ...s });
    expect(next.openings["op1/d0"]).toEqual({ id: "op1/d0", wall: "W1", kind: "swing", offset: 5.2, width: 0.8, side: "left", hinge: "b", glazed: false, sill: 0, head: 2.1 });
    expect(roomAreas(next)).toEqual(roomAreas(room));
  });

  it("defaults to a 0.80 m door, a 1.00 m window, left side, hinge a, not glazed", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(run(room, { type: "addOpening", opId: "a", wall: "W1", kind: "swing", offset: 1 }).openings["a/d0"]).toMatchObject({ width: 0.8, side: "left", hinge: "a", glazed: false });
    expect(run(room, { type: "addOpening", opId: "a", wall: "W1", kind: "window", offset: 1 }).openings["a/d0"]).toMatchObject({ width: 1 });
  });

  it("refuses a missing wall, a width out of the kind's range, a used opId, and a door past the wall's end", () => {
    const room = withOpening(rectDoc(0, 0, 6, 4), { id: "x/d0", wall: "W2", offset: 1 });
    expect(refusal(room, { type: "addOpening", opId: "a", wall: "W9", kind: "swing", offset: 1 })).toBe("Wall not found");
    expect(refusal(room, { type: "addOpening", opId: "a", wall: "W1", kind: "swing", offset: 1, width: 0.4 })).toBe("Swing door width must be between 0.50 and 2.00 m");
    expect(refusal(room, { type: "addOpening", opId: "a", wall: "W1", kind: "window", offset: 1, width: 3.5 })).toBe("Fixed window width must be between 0.30 and 3.00 m");
    expect(refusal(room, { type: "addOpening", opId: "x", wall: "W1", kind: "swing", offset: 1 })).toBe("Operation ID already used");
    expect(refusal(room, { type: "addOpening", opId: "a", wall: "W1", kind: "swing", offset: 5.5 })).toBe("Door a/d0 doesn't fit on wall W1");
  });

  it("a door placed over a window's span is refused by I12 (AC-26)", () => {
    const room = run(rectDoc(0, 0, 6, 4), { type: "addOpening", opId: "w", wall: "W1", kind: "window", offset: 2 });
    expect(clearanceWarnings(room, "s0")).toEqual([]);
    expect(refusal(room, { type: "addOpening", opId: "d", wall: "W1", kind: "swing", offset: 2.5 })).toBe("Door d/d0 overlaps window w/d0 on wall W1");
    // Touching is fine.
    expect(run(room, { type: "addOpening", opId: "d", wall: "W1", kind: "swing", offset: 3 }).openings["d/d0"]).toBeDefined();
  });
});

describe("moveOpening, setOpening, removeOpening", () => {
  const door = () => withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1, hinge: "b" });

  it("moves along the wall, refusing a move past its end", () => {
    expect(run(door(), { type: "moveOpening", openingId: "d", offset: 3 }).openings.d?.offset).toBe(3);
    expect(refusal(door(), { type: "moveOpening", openingId: "d", offset: 5.3 })).toBe("Door d doesn't fit on wall W1");
    expect(refusal(door(), { type: "moveOpening", openingId: "nope", offset: 1 })).toBe("Opening not found");
  });

  it("switching a swing door to sliding and back keeps the hinge; a window keeps side, hinge and glazed (AC-22)", () => {
    const glazed = run(door(), { type: "setOpening", openingId: "d", side: "right", glazed: true });
    const sliding = run(glazed, { type: "setOpening", openingId: "d", kind: "sliding" });
    expect(sliding.openings.d).toMatchObject({ kind: "sliding", hinge: "b", side: "right", glazed: true });
    expect(run(sliding, { type: "setOpening", openingId: "d", kind: "swing" }).openings.d).toMatchObject({ kind: "swing", hinge: "b" });
    expect(run(sliding, { type: "setOpening", openingId: "d", kind: "window" }).openings.d).toMatchObject({ kind: "window", side: "right", hinge: "b", glazed: true, width: 0.8 });
  });

  it("switching a swing door whose clearance covers a bed to sliding removes the warning; back to swing restores it (AC-22)", () => {
    // The swing square: x 1–1.8, y 0.1–0.9. The bed's footprint: x 1.6–3.2, y 0.4–2.4.
    const doc = place(door(), { object: "bed", kind: "bed", at: [2.4, 0.4], rotation: 180, size: BED_160x200 });
    const warning = [{ zone: { table: "openings", id: "d" }, against: { table: "placements", id: "bed/s0" } }];
    expect(clearanceWarnings(doc, "s0")).toEqual(warning);
    const sliding = run(doc, { type: "setOpening", openingId: "d", kind: "sliding" });
    expect(clearanceWarnings(sliding, "s0")).toEqual([]);
    expect(clearanceWarnings(run(sliding, { type: "setOpening", openingId: "d", kind: "swing" }), "s0")).toEqual(warning);
  });

  it("a switch with no width clamps the width into the new kind's range, keeping the centre (openkinds.06)", () => {
    const wide = withOpening(rectDoc(0, 0, 6, 4), { id: "w", wall: "W1", kind: "window", offset: 1, width: 2.5 }); // centre 2.25
    expect(run(wide, { type: "setOpening", openingId: "w", kind: "swing" }).openings.w).toMatchObject({ kind: "swing", width: 2, offset: 1.25 });
    const narrow = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1.7, width: 0.6 }); // a swing door, centre 2.00
    expect(run(narrow, { type: "setOpening", openingId: "d", kind: "double" }).openings.d).toMatchObject({ kind: "double", width: 0.8, offset: 1.6 });
    const fits = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1.6, width: 0.8 });
    expect(run(fits, { type: "setOpening", openingId: "d", kind: "double" }).openings.d).toMatchObject({ kind: "double", width: 0.8, offset: 1.6 });
  });

  it("the clamped switch is refused only when it overlaps a neighbour or leaves the wall, with that reason; nothing changes", () => {
    const narrow = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1.7, width: 0.6 }); // x 1.7–2.3
    const crowded = withOpening(narrow, { id: "w", wall: "W1", kind: "window", offset: 2.35, width: 1 }); // 0.05 past the door's end
    expect(refusal(crowded, { type: "setOpening", openingId: "d", kind: "double" })).toBe("Window w overlaps door d on wall W1");
    const atEnd = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 0, width: 0.6 }); // the clamp would start at −0.10
    expect(refusal(atEnd, { type: "setOpening", openingId: "d", kind: "double" })).toBe("Door d doesn't fit on wall W1");
  });

  it("a width given with the switch is still refused outside the new kind's range", () => {
    const narrow = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1.7, width: 0.6 });
    expect(refusal(narrow, { type: "setOpening", openingId: "d", kind: "double", width: 0.6 })).toBe("Double door width must be between 0.80 and 2.40 m");
    expect(refusal(narrow, { type: "setOpening", openingId: "d", width: 0.4 })).toBe("Swing door width must be between 0.50 and 2.00 m");
  });

  it("the click's hinge is the nearer wall end, or the farther one for a kind whose row says far (openkinds.10)", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(suggestOpening(room, "W1", { x: 1, y: 0.05 }, "swing")?.hinge).toBe("a");
    expect(suggestOpening(room, "W1", { x: 1, y: 0.05 }, "sliding")?.hinge).toBe("b");
    expect(suggestOpening(room, "W1", { x: 5, y: 0.05 }, "sliding")?.hinge).toBe("a");
  });

  it("toggling glazed changes the flag and nothing else: rooms, free floor and warnings are identical (AC-27)", () => {
    const doc = place(door(), { object: "bed", kind: "bed", at: [2.4, 0.4], rotation: 180, size: BED_160x200 });
    const glazed = run(doc, { type: "setOpening", openingId: "d", glazed: true });
    expect(glazed.openings.d).toEqual({ ...doc.openings.d, glazed: true });
    expect(roomAreas(glazed)).toEqual(roomAreas(doc));
    expect([...freeFloor(glazed, "s0")]).toEqual([...freeFloor(doc, "s0")]);
    expect(clearanceWarnings(glazed, "s0")).toEqual(clearanceWarnings(doc, "s0"));
  });

  it("removeOpening and deleteEntities both remove an opening", () => {
    expect(run(door(), { type: "removeOpening", openingId: "d" }).openings).toEqual({});
    expect(run(door(), { type: "deleteEntities", ids: [{ table: "openings", id: "d" }] }).openings).toEqual({});
  });
});

describe("openings on low walls (sills.02, which replaced decks.17's 2.00 m rule)", () => {
  const door = (wall: string): Command => ({ type: "addOpening", opId: "d", wall, kind: "swing", offset: 0.8 });
  const win = (wall: string): Command => ({ type: "addOpening", opId: "w", wall, kind: "window", offset: 0.8 });
  /** The 6 × 4 room with its bottom wall W1 lowered to `top`. */
  const lowered = (top: number): Document => run(rectDoc(0, 0, 6, 4), { type: "setWallTop", wallId: "W1", top });
  const HEAD = (top: string): string => `Door d/d0's head at 2.10 m is less than 0.10 m under wall W1's top at ${top} m`;

  it("a door on a 2.03 m half wall is accepted (the tiny house's partition), and a window too", () => {
    const house = tinyHouse();
    expect(house.walls.P?.top).toBe(2.03);
    expect(run(house, door("P")).openings["d/d0"]).toMatchObject({ wall: "P", kind: "swing", sill: 0, head: 1.93 });
    expect(refusal(house, win("P"))).toBe("accepted");
  });

  it("a 1.99 m wall takes a door and a window; a 1.20 m wall a door, and a window is too short there", () => {
    expect([refusal(lowered(1.99), door("W1")), refusal(lowered(1.99), win("W1"))]).toEqual(["accepted", "accepted"]);
    expect(refusal(lowered(1.2), door("W1"))).toBe("accepted");
    expect(refusal(lowered(1.2), win("W1"))).toBe("Window w/d0 is 0.20 m tall; an opening must be at least 0.30 m tall");
  });

  it("setWallTop under a door's head and its 0.10 m is refused with the values; to 2.20 it is lowered, the door kept", () => {
    const doc = run(rectDoc(0, 0, 6, 4), door("W1"));
    expect(refusal(doc, { type: "setWallTop", wallId: "W1", top: 2.19 })).toBe(HEAD("2.19"));
    const low = run(doc, { type: "setWallTop", wallId: "W1", top: 2.2 });
    expect([low.walls.W1?.top, low.openings["d/d0"]?.wall]).toEqual([2.2, "W1"]);
  });

  it("walls that follow the ceiling count too: a ceiling under a door's head and its 0.10 m is refused (decks.57)", () => {
    const doc = run(rectDoc(0, 0, 6, 4), door("W1"));
    expect(refusal(doc, { type: "setCeiling", height: 2.19 })).toBe(HEAD("2.19"));
    expect(refusal(doc, { type: "setCeiling", height: 2.2 })).toBe("accepted");
    const low = run(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: 1.9 });
    expect(run(low, door("W1")).openings["d/d0"]?.head).toBe(1.8);
  });
});

describe("openingGeometry", () => {
  it("gives the span on the centre line, the normal towards the opening side, and the hinge and free ends on that face", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1, hinge: "b" });
    const g = openingGeometry(doc, "d");
    expect(g).toEqual({
      start: { x: 1, y: 0 }, end: { x: 1.8, y: 0 }, along: { x: 1, y: 0 }, normal: { x: -0, y: 1 }, thickness: 0.2,
      hinge: { x: 1.8, y: 0.1 }, free: { x: 1, y: 0.1 },
    });
    expect(openingGeometry(doc, "nope")).toBeNull();
  });
});

describe("the sliding glass door (AC-05, AC-06)", () => {
  it("takes widths from 1.00 to 4.00 m: 3.00 is accepted, 4.20 refused with its range", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(refusal(room, { type: "addOpening", opId: "g", wall: "W1", kind: "slidingGlass", offset: 1, width: 3 })).toBe("accepted");
    expect(refusal(room, { type: "addOpening", opId: "g", wall: "W1", kind: "slidingGlass", offset: 1, width: 4.2 })).toBe("Sliding glass door width must be between 1.00 and 4.00 m");
    expect(run(room, { type: "addOpening", opId: "g", wall: "W1", kind: "slidingGlass", offset: 1 }).openings["g/d0"]?.width).toBe(2.4);
  });

  it("a 0.80 swing door centred at 2.00 switched to it is 1.00 m centred at 2.00; with a window 0.05 m past the door's end it's refused naming the overlap", () => {
    const door = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1.6, width: 0.8 });
    expect(run(door, { type: "setOpening", openingId: "d", kind: "slidingGlass" }).openings.d).toMatchObject({ kind: "slidingGlass", width: 1, offset: 1.5 });
    const crowded = withOpening(door, { id: "w", wall: "W1", kind: "window", offset: 2.45, width: 1 });
    expect(refusal(crowded, { type: "setOpening", openingId: "d", kind: "slidingGlass" })).toBe("Window w overlaps door d on wall W1");
  });
});
