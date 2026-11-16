import { describe, expect, it } from "vitest";
import { sameGuards } from "../src/model";
import { emptyStored } from "@fm/protocol";
import { SIDE_IDS } from "../src/kinds";
import { isValidId, parseCeiling, parseDeck, parseDeckHole, parseJoint, parseLayoutObject, parseLayoutState, parseOpening, parsePlacement, parseWall, parseZoneLabel } from "../src/shape";
import { fromStored, toStored } from "../src/shape-tables";
import { nullZones } from "../src/use-zone";
import { validateDocument } from "../src/validate";
import { docOf } from "./helpers";

describe("shape (I8)", () => {
  it("accepts plain IDs and rejects others", () => {
    for (const id of ["J1", "op-7/j0", "a.b:c_d"]) expect(isValidId(id)).toBe(true);
    for (const id of ["", "has space", "x".repeat(129), 7, null]) expect(isValidId(id)).toBe(false);
  });

  it("rejects IDs that name Object.prototype members", () => {
    for (const id of ["constructor", "__proto__", "toString"]) expect(isValidId(id)).toBe(false);
    const r = fromStored({ ...emptyStored(), joints: { J1: { id: "J1", x: 0, y: 0 } }, walls: { W: { id: "W", a: "constructor", b: "J1", thickness: 0.2, top: "ceiling", base: "floor", column: false } }, zoneLabels: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid walls entry W" } });
  });

  it("parses entities", () => {
    expect(parseJoint({ id: "J1", x: 1, y: 2 })).toEqual({ id: "J1", x: 1, y: 2 });
    expect(parseJoint({ id: "J1", x: Number.NaN, y: 2 })).toBeNull();
    expect(parseJoint({ id: "J1", x: Infinity, y: 2 })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2", thickness: 0.1, top: "ceiling", base: "floor", column: false })).toEqual({ id: "W1", a: "J1", b: "J2", thickness: 0.1, top: "ceiling", base: "floor", column: false });
    expect(parseWall({ id: "W1", a: "J1", thickness: 0.2 })).toBeNull();
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "Kitchen", finish: null })).toEqual({ id: "L1", at: { x: 1, y: 1 }, name: "Kitchen", finish: null });
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "x".repeat(201) })).toBeNull();
  });

  it("rejects entities with unknown fields, so stored documents hold only validated fields", () => {
    expect(parseJoint({ id: "J1", x: 1, y: 2, color: "red" })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2", thickness: 0.2, extra: { deep: [1] } })).toBeNull();
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "Hall", z: 0 })).toBeNull();
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1, z: 0 }, name: "Hall" })).toBeNull();
    const r = fromStored({ ...emptyStored(), joints: { J1: { id: "J1", x: 0, y: 0, note: "x" } }, walls: {}, zoneLabels: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid joints entry J1" } });
  });

  it("parseWall refuses a wall without thickness, with a non-finite one, or with extra keys (spec: domain, layout-states.27)", () => {
    expect(parseWall({ id: "W1", a: "J1", b: "J2" })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2", thickness: Number.NaN })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2", thickness: Infinity })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2", thickness: "0.2" })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2", thickness: 0.2, color: "red" })).toBeNull();
  });

  it("round-trips through the stored shape", () => {
    const doc = docOf({ joints: [["J1", 0, 0], ["J2", 1, 0]], walls: [["W1", "J1", "J2"]], labels: [["L1", 5, 5, "Hall"]] });
    const back = fromStored(toStored(doc));
    expect(back).toEqual({ ok: true, value: doc });
  });

  it("rejects an entry whose key differs from its ID", () => {
    const r = fromStored({ ...emptyStored(), joints: { J1: { id: "J9", x: 0, y: 0 } }, walls: {}, zoneLabels: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid joints entry J1" } });
  });

  it("parses layout states, objects, placements and openings (layout-states.39)", () => {
    expect(parseLayoutState({ id: "s0", name: "Night", order: 2 })).toEqual({ id: "s0", name: "Night", order: 2 });
    expect(parseLayoutState({ id: "s0", name: "Night", order: Number.NaN })).toBeNull();
    const bed = { id: "o0", kind: "murphyBed", name: "Bed", w: { folded: 1.6, down: 1.6 }, d: { folded: 0.4, down: 2.1 }, h: { folded: 2.24, down: 2.24 }, z: { folded: 0, down: 0 } };
    expect(parseLayoutObject(bed)).toEqual(bed);
    const place = { id: "p0", object: "o0", state: "s0", at: { x: 1, y: 2 }, rotation: 0, config: "folded", sides: { front: true, back: false, left: false, right: false }, zones: nullZones(), deck: null };
    expect(parsePlacement(place)).toEqual(place);
    expect(parsePlacement({ ...place, rotation: 359 })).not.toBeNull();
    const door = { id: "d0", wall: "w1", kind: "swing", offset: 1, width: 0.8, side: "left", hinge: "a", glazed: false, sill: 0, head: 2.1 };
    expect(parseOpening(door)).toEqual(door);
  });

  it("parseLayoutObject refuses an unknown kind, a size missing a configuration, and sizes of 0.01 or 11 m", () => {
    const bed = { id: "o0", kind: "murphyBed", name: "Bed", w: { folded: 1.6, down: 1.6 }, d: { folded: 0.4, down: 2.1 }, h: { folded: 2.24, down: 2.24 }, z: { folded: 0, down: 0 } };
    expect(parseLayoutObject({ ...bed, kind: "piano" })).toBeNull();
    expect(parseLayoutObject({ ...bed, kind: "toString" })).toBeNull();
    expect(parseLayoutObject({ ...bed, w: { folded: 1.6 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, d: { folded: 0.4, down: 2.1, open: 1 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, w: { folded: 0.01, down: 1.6 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, w: { folded: 0.1, down: 1.6 } })).not.toBeNull();
    expect(parseLayoutObject({ ...bed, d: { folded: 0.4, down: 11 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, name: "x".repeat(201) })).toBeNull();
  });

  it("parsePlacement refuses rotation 360, -1 and 45.5, and accepts 0 and 359", () => {
    const place = { id: "p0", object: "o0", state: "s0", at: { x: 1, y: 2 }, rotation: 0, config: "folded", sides: { front: true, back: false, left: false, right: false }, zones: nullZones(), deck: null };
    for (const rotation of [360, -1, 45.5, Number.NaN]) expect(parsePlacement({ ...place, rotation })).toBeNull();
    for (const rotation of [0, 359]) expect(parsePlacement({ ...place, rotation })).not.toBeNull();
    expect(parsePlacement({ ...place, at: { x: Infinity, y: 0 } })).toBeNull();
    expect(parsePlacement({ ...place, extra: 1 })).toBeNull();
  });

  it("parsePlacement requires sides of four booleans", () => {
    const place = { id: "p0", object: "o0", state: "s0", at: { x: 1, y: 2 }, rotation: 0, config: "standard", zones: nullZones(), deck: null };
    const sides = { front: true, back: false, left: false, right: false };
    expect(parsePlacement({ ...place, sides })).toEqual({ ...place, sides });
    expect(parsePlacement(place)).toBeNull();
    for (const k of SIDE_IDS) for (const v of ["yes", 1, null]) expect(parsePlacement({ ...place, sides: { ...sides, [k]: v } })).toBeNull();
    expect(parsePlacement({ ...place, sides: { ...sides, up: true } })).toBeNull();
    expect(parsePlacement({ ...place, sides: { front: true, back: false, left: false } })).toBeNull();
    expect(parsePlacement({ ...place, sides: [true, false, false, false] })).toBeNull();
  });

  it("parsePlacement checks the zone field: twelve flat keys, each side all null or all numbers in range (furnish.21)", () => {
    const sides = { front: true, back: false, left: false, right: false };
    const place = { id: "p0", object: "o0", state: "s0", at: { x: 1, y: 2 }, rotation: 0, config: "standard", sides, deck: null };
    const zonesOf = (zones: unknown) => parsePlacement({ ...place, zones })?.zones ?? null;
    const stored = { ...nullZones(), frontDepth: 0.6, frontStart: 0.2, frontEnd: 0.3 };
    for (const zones of [
      nullZones(),
      stored,
      { ...nullZones(), leftDepth: 0.1, leftStart: 0, leftEnd: 0 },
      { ...nullZones(), rightDepth: 10, rightStart: 0, rightEnd: 10 },
    ]) expect(zonesOf(zones)).toEqual(zones);
    const input = { ...place, zones: stored };
    expect(parsePlacement(input)?.zones).not.toBe(stored);
    expect(parsePlacement(place)).toBeNull();
    const eleven: Record<string, number | null> = nullZones();
    delete eleven.rightEnd;
    for (const zones of [
      eleven,
      { ...nullZones(), upDepth: null },
      { ...nullZones(), frontDepth: 0.6, frontStart: null, frontEnd: 0.3 },
      { ...stored, frontDepth: 0.09 },
      { ...stored, frontDepth: 10.01 },
      { ...stored, frontStart: -0.01 },
      { ...stored, frontEnd: 10.01 },
      { ...stored, frontDepth: Infinity },
      { ...stored, frontStart: Number.NaN },
      { ...stored, frontStart: "0.2" },
      { front: { depth: 0.6, start: 0, end: 0 }, back: null, left: null, right: null },
      null,
      [],
    ]) expect(zonesOf(zones)).toBeNull();
  });

  it("parseOpening checks the shape only: kind, side and hinge words, a boolean glazed, finite numbers", () => {
    const door = { id: "d0", wall: "w1", kind: "swing", offset: 1, width: 0.8, side: "left", hinge: "a", glazed: false, sill: 0, head: 2.1 };
    expect(parseOpening({ ...door, kind: "arch" })).toBeNull();
    expect(parseOpening({ ...door, side: "up" })).toBeNull();
    expect(parseOpening({ ...door, hinge: "c" })).toBeNull();
    expect(parseOpening({ ...door, glazed: "yes" })).toBeNull();
    expect(parseOpening({ ...door, width: Infinity })).toBeNull();
    for (const kind of ["sliding", "window"]) expect(parseOpening({ ...door, kind })).not.toBeNull();
  });

  it("parseOpening refuses a 0.4 m door, a 3.5 m window, an unknown kind, a non-boolean glazed (spec: openings)", () => {
    const door = { id: "d0", wall: "w1", kind: "swing", offset: 1, width: 0.8, side: "left", hinge: "a", glazed: false, sill: 0, head: 2.1 };
    expect(parseOpening({ ...door, width: 0.4 })).toBeNull();
    expect(parseOpening({ ...door, kind: "sliding", width: 2.1 })).toBeNull();
    expect(parseOpening({ ...door, kind: "window", width: 3.5 })).toBeNull();
    expect(parseOpening({ ...door, kind: "window", width: 0.25 })).toBeNull();
    expect(parseOpening({ ...door, kind: "hatch" })).toBeNull();
    expect(parseOpening({ ...door, glazed: 1 })).toBeNull();
    for (const [kind, width] of [["swing", 0.5], ["sliding", 2], ["window", 0.3], ["window", 3]] as const) {
      expect(parseOpening({ ...door, kind, width })).not.toBeNull();
    }
  });
});


// Heights (heights.09, .10, .37): an object's h and z per configuration, a wall's top, the one-row ceilings table.
describe("shape of heights", () => {
  const bed = { id: "o0", kind: "murphyBed", name: "Bed", w: { folded: 1.6, down: 1.6 }, d: { folded: 0.4, down: 2.1 }, h: { folded: 2.24, down: 2.24 }, z: { folded: 0, down: 0 } };
  const wall = { id: "W1", a: "J1", b: "J2", thickness: 0.2, base: "floor", column: false };

  it("null top or z is refused; \"ceiling\" and a number pass (heights.37)", () => {
    expect(parseWall({ ...wall, top: null })).toBeNull();
    expect(parseWall({ ...wall, top: "ceiling" })).toEqual({ ...wall, top: "ceiling" });
    expect(parseWall({ ...wall, top: 1.1 })).toEqual({ ...wall, top: 1.1 });
    expect(parseWall({ ...wall, top: "floor" })).toBeNull();
    expect(parseWall({ ...wall, top: Number.NaN })).toBeNull();
    expect(parseWall(wall)).toBeNull();
    expect(parseLayoutObject({ ...bed, z: { folded: null, down: 0 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, z: { folded: "ceiling", down: 0 } })).toEqual({ ...bed, z: { folded: "ceiling", down: 0 } });
    expect(parseLayoutObject({ ...bed, z: { folded: -0.1, down: 0 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, h: { folded: "ceiling", down: 2.24 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, h: { folded: null, down: 2.24 } })).toBeNull();
    expect(parseLayoutObject(bed)).toEqual(bed);
  });

  it("h and z must have exactly the kind's config keys", () => {
    expect(parseLayoutObject({ ...bed, h: { folded: 2.24 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, z: { folded: 0, down: 0, open: 0 } })).toBeNull();
    expect(parseLayoutObject({ ...bed, h: { standard: 2.24 } })).toBeNull();
    const { id, kind, name, w, d, h, z } = bed;
    expect(parseLayoutObject({ id, kind, name, w, d, z })).toBeNull();
    expect(parseLayoutObject({ id, kind, name, w, d, h })).toBeNull();
    expect(parseLayoutObject({ ...bed, h: { folded: 0.005, down: 2.24 } })).toBeNull(); // heights from 0.01 (catalog.22)
    expect(parseLayoutObject({ ...bed, h: { folded: 11, down: 2.24 } })).toBeNull();
  });

  it("I8 refuses a wall whose top is neither a number nor \"ceiling\", in a document built in code", () => {
    const doc = JSON.parse(JSON.stringify(docOf({ joints: [["J1", 0, 0], ["J2", 4, 0]], walls: [["W1", "J1", "J2"]] })));
    expect(validateDocument(doc).ok).toBe(true);
    doc.walls.W1.top = null;
    const r = validateDocument(doc);
    expect(r.ok ? [] : r.error.map((v) => [v.invariant, v.entities])).toEqual([["I8", [{ table: "walls", id: "W1" }]]]);
  });

  it("parseCeiling takes an id and a finite height, and a roof's fields when given (roofs.20)", () => {
    expect(parseCeiling({ id: "ceiling", height: 2.5 })).toEqual({ id: "ceiling", height: 2.5 });
    expect(parseCeiling({ id: "ceiling", height: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseCeiling({ id: "ceiling", height: "2.5" })).toBeNull();
    const shed = { id: "ceiling", height: 2.75, shape: "shed", pitch: 10, falls: "-y", overhang: 0.3 };
    expect(parseCeiling(shed)).toEqual(shed);
    expect(parseCeiling({ id: "ceiling", height: 2.5, shape: "flat" })).toEqual({ id: "ceiling", height: 2.5, shape: "flat" });
    expect(parseCeiling({ ...shed, shape: "hip" })).toBeNull();
    expect(parseCeiling({ ...shed, falls: "north" })).toBeNull();
    expect(parseCeiling({ ...shed, pitch: "10" })).toBeNull();
    expect(parseCeiling({ ...shed, overhang: Number.NaN })).toBeNull();
    expect(parseCeiling({ ...shed, ridge: "x" })).toBeNull();
  });
});

// Decks (decks.03, .04): a deck row is flat but for its centre point; a placement names its surface.
describe("shape of decks", () => {
  const loft = { id: "loft/k0", name: "Loft", at: { x: 2, y: 1.5 }, w: 2, d: 1.4, rotation: 0, top: 2.15, solid: false, finish: null, ...sameGuards("railing") };

  it("parseDeck takes exactly id, name, at, w, d, rotation, top and solid", () => {
    expect(parseDeck(loft)).toEqual(loft);
    expect(parseDeck({ ...loft, solid: true, rotation: 359 })).toEqual({ ...loft, solid: true, rotation: 359 });
  });

  it("parseDeck takes a rotation in whole degrees, 0 to 359, as a placement's (spec: Decks)", () => {
    for (const rotation of [360, -1, 30.5]) expect(parseDeck({ ...loft, rotation }), String(rotation)).toBeNull();
    for (const rotation of [0, 15, 359]) expect(parseDeck({ ...loft, rotation }), String(rotation)).not.toBeNull();
  });

  it("parseDeck refuses unknown keys, a string top, a non-boolean solid", () => {
    expect(parseDeck({ ...loft, colour: "oak" })).toBeNull();
    expect(parseDeck({ ...loft, top: "2.15" })).toBeNull();
    expect(parseDeck({ ...loft, top: "ceiling" })).toBeNull();
    expect(parseDeck({ ...loft, solid: 1 })).toBeNull();
    expect(parseDeck({ ...loft, solid: "true" })).toBeNull();
    expect(parseDeck(Object.fromEntries(Object.entries(loft).filter(([k]) => k !== "solid")))).toBeNull();
  });

  it("parseDeck refuses a non-finite number, a bad ID, a name too long and an at that is not a point", () => {
    for (const key of ["w", "d", "rotation", "top"]) {
      expect(parseDeck({ ...loft, [key]: Number.NaN }), key).toBeNull();
      expect(parseDeck({ ...loft, [key]: Number.POSITIVE_INFINITY }), key).toBeNull();
    }
    expect(parseDeck({ ...loft, id: "bad id" })).toBeNull();
    expect(parseDeck({ ...loft, name: "x".repeat(201) })).toBeNull();
    expect(parseDeck({ ...loft, at: { x: 2 } })).toBeNull();
    expect(parseDeck({ ...loft, at: { x: 2, y: 1.5, z: 0 } })).toBeNull();
    expect(parseDeck({ ...loft, at: [2, 1.5] })).toBeNull();
  });

  it("parsePlacement requires deck: a deck ID or null", () => {
    const place = { id: "p0", object: "o0", state: "s0", at: { x: 1, y: 2 }, rotation: 0, config: "standard", sides: { front: true, back: false, left: false, right: false }, zones: nullZones() };
    expect(parsePlacement({ ...place, deck: null })).toEqual({ ...place, deck: null });
    expect(parsePlacement({ ...place, deck: "loft/k0" })).toEqual({ ...place, deck: "loft/k0" });
    expect(parsePlacement(place)).toBeNull();
    expect(parsePlacement({ ...place, deck: "bad id" })).toBeNull();
    expect(parsePlacement({ ...place, deck: 0 })).toBeNull();
    expect(parsePlacement({ ...place, deck: false })).toBeNull();
  });
});

// Deck holes (stairwell.03, .20): a hole row is flat but for its centre point.
describe("shape of deck holes", () => {
  const hole = { id: "h/h0", deck: "loft/k0", at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65, guard: { kind: "railing", height: 1 } };

  it("parseDeckHole takes exactly id, deck, at, w, d and guard", () => {
    expect(parseDeckHole(hole)).toEqual(hole);
  });

  it("parseDeckHole refuses an extra or a missing key, a non-finite size, a bad ID and an at that is not a point", () => {
    expect(parseDeckHole({ ...hole, rotation: 0 })).toBeNull();
    expect(parseDeckHole(Object.fromEntries(Object.entries(hole).filter(([k]) => k !== "d")))).toBeNull();
    for (const key of ["w", "d"]) expect(parseDeckHole({ ...hole, [key]: Number.NaN }), key).toBeNull();
    expect(parseDeckHole({ ...hole, id: "bad id" })).toBeNull();
    expect(parseDeckHole({ ...hole, deck: "" })).toBeNull();
    expect(parseDeckHole({ ...hole, at: { x: 1 } })).toBeNull();
    expect(parseDeckHole({ ...hole, guard: { kind: "railing", height: 1.5 } })).toBeNull();
    expect(parseDeckHole({ ...hole, guard: "railing" })).toBeNull();
  });
});


// A label's finish (finishes.17, .24): the parser checks the shape only; the rules are I8's (finishProblem).
describe("shape of a label's finish", () => {
  const label = { id: "L1", at: { x: 1, y: 1 }, name: "Hall" };
  const finish = { motif: "planks", colour: "#c8a27a", strength: 45, size: 0.2, angle: 0 };

  it("a label row without finish parses with finish null", () => {
    expect(parseZoneLabel(label)).toEqual({ ...label, finish: null });
    expect(parseZoneLabel({ ...label, finish: null })).toEqual({ ...label, finish: null });
    const r = fromStored({ ...emptyStored(), zoneLabels: { L1: label } });
    expect(r).toMatchObject({ ok: true, value: { zoneLabels: { L1: { ...label, finish: null } } } });
  });

  it("parses a finish with the five keys as a fresh object, rules unchecked", () => {
    const parsed = parseZoneLabel({ ...label, finish });
    expect(parsed).toEqual({ ...label, finish });
    expect(parsed?.finish).not.toBe(finish);
    const outOfRange = { motif: "parquet", colour: "red", strength: 500, size: -1, angle: 0.5 };
    expect(parseZoneLabel({ ...label, finish: outOfRange })).toEqual({ ...label, finish: outOfRange });
  });

  it("a finish with an extra key fails", () => {
    expect(parseZoneLabel({ ...label, finish: { ...finish, offset: 0 } })).toBeNull();
    const r = fromStored({ ...emptyStored(), zoneLabels: { L1: { ...label, finish: { ...finish, offset: 0 } } } });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid zoneLabels entry L1" } });
  });

  it("a finish with a string strength fails", () => {
    expect(parseZoneLabel({ ...label, finish: { ...finish, strength: "45" } })).toBeNull();
  });

  it("a finish with a missing key, a wrong type or a non-finite number fails, as does a finish that is not an object", () => {
    for (const key of Object.keys(finish)) {
      expect(parseZoneLabel({ ...label, finish: Object.fromEntries(Object.entries(finish).filter(([k]) => k !== key)) }), key).toBeNull();
    }
    expect(parseZoneLabel({ ...label, finish: { ...finish, motif: 1 } })).toBeNull();
    expect(parseZoneLabel({ ...label, finish: { ...finish, colour: null } })).toBeNull();
    for (const key of ["strength", "size", "angle"]) expect(parseZoneLabel({ ...label, finish: { ...finish, [key]: Number.NaN } }), key).toBeNull();
    for (const v of ["planks", 0, false, [], undefined]) expect(parseZoneLabel({ ...label, finish: v }), String(v)).toBeNull();
  });
});
