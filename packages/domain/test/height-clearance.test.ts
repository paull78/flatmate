import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { freeFloor } from "../src/queries/free-floor";
import { place as helperPlace, rectDoc, withOpening } from "./helpers";

// Use zones and free floor in height (heights.36, AC-11): a piece whose bottom is at or above 1.20 m blocks no use
// zone and takes no floor, whatever the ceiling; from decks.18 it blocks no door swing either (below).

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const place = (opId: string, kind: string, x: number, y: number, rotation = 0): Command =>
  ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y }, rotation });
const blocked = (doc: Document): string[] => clearanceWarnings(doc, "s0").map((w) => `${w.zone.id}${w.zone.table === "placements" ? ` ${w.zone.side}` : ""} by ${w.against.id}`);

/** A 6 × 4 room (inner faces 0.1–5.9 × 0.1–3.9) with a desk on the top wall: x 2.4–3.6, y 3.3–3.9, its chair zone below. */
const withDesk = (): Document => ok(rectDoc(0, 0, 6, 4), place("d", "desk", 3, 3.9));

describe("use zones in height", () => {
  it("a raised lift bed over a table blocks none of its zones (AC-11)", () => {
    // The lift bed 1.70 × 2.10 on the top wall: x 2.15–3.85, y 1.8–3.9, at 2.15–2.50, over the desk and its zone.
    expect(blocked(ok(withDesk(), place("l", "liftBed", 3, 3.9)))).toEqual([]);
    // The same footprint as a floor box blocks the desk's zone: the height is what frees it.
    const box = ok(withDesk(), place("b", "block", 3, 3.0), { type: "setObjectSize", objectId: "b/o0", w: 1.7, d: { standard: 1.2 }, h: { standard: 0.35 }, z: { standard: 0.8 } });
    expect(blocked(box)).toEqual(["d/p0 front by b/p0"]);
  });

  it("a loft bed (1.45) leaves the desk's chair zone free; a shelf from 1.15 blocks it, under 2.50 and under 2.20 alike", () => {
    const loft = ok(withDesk(), place("l", "loftBed", 3, 3.9)); // x 2.5–3.5, y 1.8–3.9
    const shelf = ok(withDesk(), place("s", "block", 3, 3.0), { type: "setObjectSize", objectId: "s/o0", w: 0.6, d: { standard: 0.6 }, h: { standard: 0.3 }, z: { standard: 1.15 } });
    for (const ceiling of [2.5, 2.2]) {
      expect(blocked(ok(loft, { type: "setCeiling", height: ceiling }))).toEqual([]);
      expect(blocked(ok(shelf, { type: "setCeiling", height: ceiling }))).toEqual(["d/p0 front by s/p0"]);
    }
    const at120 = ok(shelf, { type: "setObjectSize", objectId: "s/o0", w: 0.6, d: { standard: 0.6 }, z: { standard: 1.2 } });
    expect(blocked(at120)).toEqual([]);
  });

});

// Raised pieces block nothing on the floor (decks.18, overriding heights.36's door-swing part): a piece whose bottom
// is at or above 1.20 m blocks no door swing and owns no use zone that warns.

/** A door on the bottom wall W1 at x 1–1.8 opening up into the room: swing x 1–1.8, y 0.1–0.9. */
const withDoor = (): Document => withOpening(rectDoc(0, 0, 6, 4), { id: "D", wall: "W1", offset: 1 });
const lift = (doc: Document, objectId: string, z: number): Document =>
  ok(doc, { type: "setObjectSize", objectId, w: doc.objects[objectId]?.w.standard ?? 0, d: {}, z: { standard: z } });

describe("door swings in height (decks.18)", () => {
  it("a wall cabinet at 1.40 over a door swing doesn't block it", () => {
    const cabinet = ok(withDoor(), place("c", "wallCabinet", 1.4, 0.1, 180)); // x 1.1–1.7, y 0.1–0.45, at 1.40–2.15
    expect(blocked(cabinet)).toEqual([]);
  });

  it("a lift bed Up (bottom 2.15) over a door swing doesn't block it; Down (0.20) does", () => {
    const up = ok(withDoor(), place("l", "liftBed", 1.9, 0.1, 180)); // x 1.05–2.75, y 0.1–2.2, Up at 2.15–2.50
    expect(up.placements["l/p0"]?.config).toBe("up");
    expect(blocked(up)).toEqual([]);
    const down = ok(up, { type: "setConfiguration", placementId: "l/p0", config: "down" });
    expect(blocked(down)).toContain("D by l/p0");
  });

  it("a wardrobe still blocks a swing", () => {
    expect(blocked(ok(withDoor(), place("w", "wardrobe", 1.4, 0.1, 180)))).toContain("D by w/p0"); // x 0.8–2.0, y 0.1–0.7
  });

  it("a box over the swing blocks it from 1.19, not from 1.20", () => {
    const box = ok(withDoor(), place("s", "block", 1.4, 0.1, 180)); // x 1.1–1.7, y 0.1–0.7
    expect(blocked(lift(box, "s/o0", 1.19))).toEqual(["D by s/p0"]);
    expect(blocked(lift(box, "s/o0", 1.2))).toEqual([]);
  });
});

describe("raised owners (decks.18)", () => {
  it("a bed on a loft owns no warning about a desk below; the same bed on the floor warns", () => {
    // Ceiling 3.20; a loft x 2–4, y 1.7–3.9 (2.03–2.15) flush with the top wall; a bed x 2.15–3.85, y 1.8–3.9 with side
    // zones x 1.55–2.15 and 3.85–4.45, y 1.8–3.45; a desk x 4.2–5.4, y 3.3–3.9 on the floor under the right one.
    const base = ok(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: 3.2 }, { type: "addDeck", opId: "k", preset: "loft", at: { x: 3, y: 2.8 }, w: 2, d: 2.2 }, place("d", "desk", 4.8, 3.9));
    const bed = (deck: string | null): Command => ({ type: "placeObject", deck, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 }, rotation: 0 });
    const onLoft = ok(base, bed("k/k0"));
    expect(onLoft.placements["b/p0"]?.deck).toBe("k/k0");
    expect(blocked(onLoft)).toEqual([]);
    expect(blocked(ok(base, bed(null))).filter((w) => w.startsWith("b/p0"))).toEqual([expect.stringMatching(/^b\/p0 (left|right) by d\/p0$/)]);
  });

  it("a bed whose bottom is 1.19 warns against a wall and a desk; at 1.20 it warns nothing", () => {
    // A bed x 0.15–1.85, y 1.8–3.9: one side zone runs into the left wall W4, the other over a desk x 2.2–3.4, y 3.3–3.9.
    const doc = ok(rectDoc(0, 0, 6, 4), place("b", "bed", 1, 3.9), place("d", "desk", 2.8, 3.9));
    const of = (z: number): string[] => blocked(lift(doc, "b/o0", z)).filter((w) => w.startsWith("b/p0")).map((w) => w.replace(/ (left|right) /, " "));
    expect(of(1.19)).toEqual(["b/p0 by W4", "b/p0 by d/p0"].sort());
    expect(of(1.2)).toEqual([]);
  });
});

describe("free floor in height", () => {
  it("a raised bed takes no floor; two floor pieces stacked in plan are both counted; free floor never goes below 0", () => {
    const room = (doc: Document): number | null => [...freeFloor(doc, "s0").values()][0] ?? null;
    const base = room(rectDoc(0, 0, 6, 4)) ?? 0;
    const desk = withDesk();
    expect(room(desk)).toBeCloseTo(base - 1.2 * 0.6, 9);
    expect(room(ok(desk, place("l", "loftBed", 3, 3.9)))).toBeCloseTo(base - 1.2 * 0.6, 9);
    // A 0.30 low box under the loft... and a second floor piece stacked under a raised one: both counted.
    const stacked = ok(desk, place("l", "loftBed", 3, 3.9), { type: "setObjectSize", objectId: "l/o0", w: 1, d: { standard: 2.1 }, z: { standard: 1 } });
    expect(room(stacked)).toBeCloseTo(base - 1.2 * 0.6 - 1 * 2.1, 9);
    // A room filled by floor pieces stacked over each other clamps at 0.
    let full = rectDoc(0, 0, 1.2, 1.2); // inner 1.0 × 1.0
    full = helperPlace(full, { object: "a", kind: "block", at: [0.6, 1.1], size: { w: { standard: 1 }, d: { standard: 1 }, h: { standard: 0.5 }, z: { standard: 0 } } });
    full = helperPlace(full, { object: "b", kind: "block", at: [0.6, 1.1], size: { w: { standard: 1 }, d: { standard: 1 }, h: { standard: 0.3 }, z: { standard: 0.5 } } });
    expect(room(full)).toBe(0);
  });

  it("zone and free-floor results never change when only the ceiling changes", () => {
    const doc = ok(withDesk(), place("l", "liftBed", 3, 3.9), place("s", "wardrobe", 0.7, 0.1, 180));
    const low = ok(doc, { type: "setCeiling", height: 2.2 });
    expect([blocked(low), [...freeFloor(low, "s0")]]).toEqual([blocked(doc), [...freeFloor(doc, "s0")]]);
  });
});
