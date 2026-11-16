import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { defaultSize, kindConfigs, kindOf, presetOf } from "../src/kinds";
import type { Document } from "../src/model";
import { freeFloor } from "../src/queries/free-floor";
import { zones } from "../src/queries/zones";
import { shapeArea } from "../src/shapes";
import { place, rectDoc } from "./helpers";

// The aggregate kinds (spec "Seating: aggregates", AC-04; seating.06, .07): a table or desk and its chairs as
// one piece, so the kinds table and every fit rule treat it like any piece of its size.

const full = { start: 0, end: 0 };
const none = { front: false, back: false, left: false, right: false };

describe("the aggregate kinds' rows", () => {
  it("dining table with chairs: 1.20 × 2.00, 0.90 tall, zones 0.15 all round, a table", () => {
    expect(kindConfigs("seatedDining")).toEqual([{ id: "standard", label: "Standard", w: 1.2, d: 2, zone: 0.15, h: 0.9, z: 0 }]);
    expect(kindOf("seatedDining")).toMatchObject({
      label: "Dining table with chairs", sides: { front: true, back: true, left: true, right: true }, sitAt: false, seat: null, seatsUnder: [],
      semanticClass: "IfcFurniture TABLE", outline: "rect", retired: false, family: null, stair: null,
      zoneDefaults: { front: full, back: full, left: full, right: full },
    });
  });

  it("round table with chairs: a circle 2.16 across by default, zones 0.15 all round", () => {
    expect(kindConfigs("seatedRound")).toEqual([{ id: "standard", label: "Standard", w: 2.16, d: 2.16, zone: 0.15, h: 0.9, z: 0 }]);
    expect(kindOf("seatedRound")).toMatchObject({
      label: "Round table with chairs", retired: false, sides: { front: true, back: true, left: true, right: true }, sitAt: false, seat: null, seatsUnder: [],
      semanticClass: "IfcFurniture TABLE", outline: "round", zoneDefaults: { front: full, back: full, left: full, right: full },
    });
  });

  it("desk with chair: 1.20 × 0.70, a front zone 0.60 deep centred like the desk's", () => {
    expect(kindConfigs("deskSet")).toEqual([{ id: "standard", label: "Standard", w: 1.2, d: 0.7, zone: 0.6, h: 0.9, z: 0 }]);
    expect(kindOf("deskSet")).toMatchObject({
      label: "Desk with chair", sides: { ...none, front: true }, sitAt: false, seat: null, seatsUnder: [],
      semanticClass: "IfcFurniture DESK", outline: "rect",
    });
    expect(kindOf("deskSet")?.zoneDefaults).toEqual(kindOf("desk")?.zoneDefaults);
  });

  it("presets: dining 4, 6, 8 and 10 seats; round 4, 6 and 8 seats; the desk set 120 × 70; each default is its first", () => {
    const rows = (kind: string) => (kindOf(kind)?.presets ?? []).map((p) => [p.id, p.w, p.d.standard, p.label]);
    expect(rows("seatedDining")).toEqual([
      ["4 seats", 1.2, 2, "4 seats 120 × 200"], ["6 seats", 2.6, 2.1, "6 seats 260 × 210"], ["8 seats", 3.2, 2.1, "8 seats 320 × 210"],
      ["10 seats", 3.8, 2.1, "10 seats 380 × 210"],
    ]);
    expect(rows("seatedRound")).toEqual([
      ["4 seats", 2.16, 2.16, "4 seats 216 × 216"], ["6 seats", 2.46, 2.46, "6 seats 246 × 246"], ["8 seats", 2.76, 2.76, "8 seats 276 × 276"],
    ]);
    expect(rows("deskSet")).toEqual([["120", 1.2, 0.7, "120 × 70"]]);
    for (const kind of ["seatedDining", "seatedRound", "deskSet"]) {
      expect(presetOf({ kind, ...(defaultSize(kind) ?? { w: {}, d: {} }) })?.id, kind).toBe(kindOf(kind)?.presets[0]?.id);
    }
  });
});

// The room: 4 × 4 m, inner faces at 0.1 and 3.9 (free floor 3.8² = 14.44).
describe("an aggregate fits like any piece of its size (AC-04)", () => {
  const room = (): Document => rectDoc(0, 0, 4, 4);
  const placeSet = (kind: string, at: { x: number; y: number }, preset?: string) =>
    execute(withState(), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind, ...(preset ? { preset } : {}) }, at });
  const freeOf = (doc: Document): number => {
    const key = zones(doc)[0]?.face.key ?? "";
    return freeFloor(doc, "s0").get(key) ?? Number.NaN;
  };
  const withState = (): Document => place(room(), { object: "far", kind: "nightstand", at: [0.4, 0.5] }); // only to make s0

  it.each([
    ["seatedDining", 1.2, 2],
    ["deskSet", 1.2, 0.7],
  ])("%s: against the top face it fits; 5 cm into the wall it is refused", (kind, w, d) => {
    const doc = withState();
    const at = (y: number) => execute(doc, { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind }, at: { x: 2, y } });
    expect(at(3.9).ok).toBe(true);
    expect(at(3.95).ok).toBe(false);
    const placed = unwrap(at(3.9)).doc;
    expect(freeOf(doc) - freeOf(placed)).toBeCloseTo(w * d, 9);
  });

  it("the 6-seat dining set is 2.60 × 2.10 and takes 5.46 m² off the free floor", () => {
    const doc = withState();
    const placed = unwrap(execute(doc, { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "seatedDining", preset: "6 seats" }, at: { x: 2, y: 3.9 } })).doc;
    expect(placed.objects["a/o0"]).toMatchObject({ kind: "seatedDining", w: { standard: 2.6 }, d: { standard: 2.1 } });
    expect(freeOf(doc) - freeOf(placed)).toBeCloseTo(5.46, 9);
  });

  it("the round set fits inside, is refused across a wall, and takes its circle's shape area off the free floor", () => {
    const doc = withState();
    const at = (y: number) => execute(doc, { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "seatedRound" }, at: { x: 2, y } });
    expect(at(3.9).ok).toBe(true);
    expect(at(3.95).ok).toBe(false);
    expect(freeOf(doc) - freeOf(unwrap(at(3.9)).doc)).toBeCloseTo(shapeArea("round", 2.16, 2.16), 9);
    expect(shapeArea("round", 2.16, 2.16)).toBeLessThan(Math.PI * 1.08 * 1.08); // the inscribed 32-gon
  });

  it("a loose chair never tucks under an aggregate (none is sitAt)", () => {
    const doc = unwrap(placeSet("deskSet", { x: 2, y: 3.9 })).doc;
    // The set's front edge at y 3.2; a chair facing it, its back at 2.6, moved to touch it, then 0.20 under.
    const chair = place(doc, { object: "chair", kind: "chair", at: [2, 2.6], rotation: 180 });
    const moveTo = (y: number) => execute(chair, { type: "movePlacement", placementId: "chair/s0", at: { x: 2, y }, rotation: 180 }).ok;
    expect(moveTo(2.75)).toBe(true);
    expect(moveTo(2.95)).toBe(false);
  });
});
