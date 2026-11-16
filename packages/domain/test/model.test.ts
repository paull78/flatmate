import { describe, expect, it } from "vitest";
import { invariantsMessage, topologyMessage } from "../src/errors";
import { OBJECT_KINDS, defaultSize, isObjectSize, kindOf } from "../src/kinds";
import { DEFAULT_WALL_THICKNESS, EPS, MAX_WALL_THICKNESS, MIN_EDGE, MIN_WALL_THICKNESS, emptyDocument, isWallThickness } from "../src/model";

describe("model", () => {
  it("starts with one state, s0 \"Layout\", and nothing else (layout-states.39)", () => {
    expect(emptyDocument()).toEqual({
      joints: {}, walls: {}, zoneLabels: {}, decks: {}, deckHoles: {},
      states: { s0: { id: "s0", name: "Layout", order: 0 } }, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {}, underlays: {}, logos: {}, ceilings: {}, sheets: {}, sections: {}, areas: {},
    });
  });

  it("OBJECT_KINDS has eighty-eight kinds in spec order; seven have two configurations; chair and the blocks have no use zone", () => {
    expect(OBJECT_KINDS.map((k) => k.id)).toEqual([
      "bed", "mattress", "liftBed", "loftBed", "builtInTable", "builtInDesk", "murphyBed", "sofaBed", "sofa", "armchair", "coffeeTable", "foldingTable", "extendingTable", "roundTable",
      "desk", "deskSet", "kitchenBlock", "hobUnit", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "wallCabinet",
      "bathroomBlock", "toilet", "bidet", "washbasin", "cornerBasin", "showerTray", "cornerShower", "bathtub", "washingMachine",
      "wardrobe", "drawers", "nightstand", "chair", "shelf", "tvUnit", "block", "roundBlock", "cornerBlock",
      "stair", "openStair", "storageStair", "shipsLadder", "alternatingTread", "rungLadder", "spiralStair",
      "winderStair", "storageSteps", // a winder, and two or three steps up to a platform (spec steps)
      "cornerDesk", "cornerWardrobe", "cornerCounter", "cornerSofa", "plant", "cot", "radiator", "towelRail", "rug", "roundRug", "vanityUnit", "palm", "fern", "rosette", "seatedDining", "seatedRound",
      "range", "cookerHood", "tallPantry", "stool", "barTable", "bench", "storageChest", "electricFireplace", "wallUnit", "woodStove", // the pieces for small homes (spec pieces)
      "wheelWell", // the trailer's wheel well (spec trailer)
      "beam", // beams and collar ties (spec beams)
      "picture", "mirror", "clock", "wallTv", "pegboard", "coatHooks", "coatStand", // hung on a wall, and a coat stand (spec hangings)
      "glassCabinet", "halfGlassCabinet", // tall bookcases with glass doors
    ]);
    expect(OBJECT_KINDS.filter((k) => k.configs.length === 2).map((k) => k.id)).toEqual(["liftBed", "builtInTable", "builtInDesk", "murphyBed", "sofaBed", "foldingTable", "extendingTable"]);
    expect(kindOf("murphyBed")?.configs).toEqual([
      { id: "folded", label: "Closed", w: 1.6, d: 0.4, zone: null, h: 2.24, z: 0 },
      { id: "down", label: "Open", w: 1.6, d: 2.1, zone: 0.6, h: 2.24, z: 0 },
    ]);
    expect(kindOf("chair")?.configs.map((c) => c.zone)).toEqual([null]);
    expect(kindOf("block")?.configs).toEqual([{ id: "standard", label: "Standard", w: 0.6, d: 0.6, zone: null, h: 1, z: 0 }]);
    expect(kindOf("roundBlock")?.configs).toEqual([{ id: "standard", label: "Standard", w: 0.6, d: 0.6, zone: null, h: 1, z: 0 }]);
    expect(kindOf("cornerBlock")?.configs).toEqual([{ id: "standard", label: "Standard", w: 0.6, d: 0.6, zone: null, h: 1, z: 0 }]);
    expect(kindOf("constructor")).toBeNull();
    expect(defaultSize("sofaBed")).toEqual({ w: { sofa: 2.1, bed: 2.1 }, d: { sofa: 0.9, bed: 1.6 }, h: { sofa: 0.9, bed: 0.9 }, z: { sofa: 0, bed: 0 } });
    // Every default size is a valid size (the folded table, 0.15 m deep, set the minimum: layout-states.43).
    for (const k of OBJECT_KINDS) for (const c of k.configs) expect([c.w, c.d].every(isObjectSize), `${k.id} ${c.id}`).toBe(true);
  });

  it("bounds wall thickness and fixes tolerances (spec: domain, layout-states.27)", () => {
    expect([DEFAULT_WALL_THICKNESS, MIN_WALL_THICKNESS, MAX_WALL_THICKNESS]).toEqual([0.2, 0.05, 0.5]);
    expect([0.05, 0.2, 0.5].every(isWallThickness)).toBe(true);
    expect([0.049, 0.501, Number.NaN, Infinity].some(isWallThickness)).toBe(false);
    expect(EPS).toBe(0.001);
    expect(MIN_EDGE).toBe(0.01);
  });

  it("names topology failures with toast texts", () => {
    const v = (invariant: "I2" | "I4" | "I5") => ({ invariant, message: "", entities: [] });
    expect(topologyMessage([v("I5")])).toBe("Walls can't cross");
    expect(topologyMessage([v("I2")])).toBe("Wall too short");
    expect(topologyMessage([v("I4")])).toBe("Joints can't overlap");
    expect(topologyMessage([{ invariant: "I13", message: "", entities: [] }])).toBe("Wall thickness must be between 0.05 and 0.50 m");
    expect(topologyMessage([v("I2"), v("I5")])).toBe("Walls can't cross");
    // I15 names the dimension by ID for MCP and logs; people get the plain sentence.
    const lost = { invariant: "I15" as const, message: "Dimension x/m0 needs joint J2", entities: [{ table: "dimensions" as const, id: "x/m0" }] };
    expect(topologyMessage([lost])).toBe("A dimension needs this corner");
  });

  it("maps invariant ids to toast texts, or null when none has one", () => {
    expect(invariantsMessage(new Set(["I5"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I6"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I7"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I2"]))).toBe("Wall too short");
    expect(invariantsMessage(new Set(["I4"]))).toBe("Joints can't overlap");
    expect(invariantsMessage(new Set(["I2", "I7"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I15"]))).toBe("A dimension needs this corner");
    expect(invariantsMessage(new Set(["I16"]))).toBe("The underlay picture can't be stored");
    expect(invariantsMessage(new Set(["I1", "I3", "I8"]))).toBeNull();
    // I9 (a row naming one that's gone) has its own text, after every named one (cleanup.09, AC-11).
    expect(invariantsMessage(new Set(["I9"]))).toBe("This edit needs something that was just removed");
    expect(invariantsMessage(new Set(["I5", "I9"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set())).toBeNull();
  });
});
