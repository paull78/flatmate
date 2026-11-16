import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { FAMILY_LABELS, MIN_HEIGHT, OBJECT_KINDS, WORKTOP_HEIGHT, canSwitchKind, configOf, configsOf, defaultSize, familyKinds, kindConfigs, kindOf, kindsSwitchable } from "../src/kinds";
import { deserialize, serialize } from "../src/serialize";
import { MURPHY_MATTRESS_INSET } from "../src/use-zone";
import { BED_160x200, place, rectDoc } from "./helpers";

// One lookup from an object to its kind's configurations (arch-review R-04).
describe("configurations of a kind", () => {
  it("kindConfigs lists a kind's configurations in order, and none for an unknown kind", () => {
    expect(kindConfigs("murphyBed").map((c) => c.id)).toEqual(["folded", "down"]);
    expect(kindConfigs("spaceship")).toEqual([]);
  });

  it("configsOf and configOf read an object's kind", () => {
    const bed = { kind: "murphyBed" };
    expect(configsOf(bed).map((c) => c.id)).toEqual(["folded", "down"]);
    expect(configOf(bed, "down")).toMatchObject({ id: "down", w: 1.6, d: 2.1, zone: 0.6 });
    expect(configOf(bed, "open")).toBeNull();
    expect(configOf({ kind: "spaceship" }, "standard")).toBeNull();
  });

  it("every catalogue kind is reachable through kindConfigs", () => {
    for (const k of OBJECT_KINDS) expect(kindConfigs(k.id)).toBe(k.configs);
  });
});

// Per-kind columns of the smart cycle: default use-zone sides, and the seat rule's pair (smart.08, .19, .23).
describe("kind columns", () => {
  it("every kind has default sides; bed left+right, chair and the blocks none, the rest front", () => {
    const none = { front: false, back: false, left: false, right: false };
    const front = { ...none, front: true };
    expect(OBJECT_KINDS.map((k) => [k.id, k.sides])).toEqual([
      ["bed", { ...none, left: true, right: true }],
      ["mattress", none],
      ["liftBed", { ...none, left: true, right: true }],
      ["loftBed", none],
      ["builtInTable", front],
      ["builtInDesk", front],
      ["murphyBed", front],
      ["sofaBed", front],
      ["sofa", front],
      ["armchair", front],
      ["coffeeTable", none],
      ["foldingTable", front],
      ["extendingTable", { ...none, left: true, right: true }],
      ["roundTable", { front: true, back: true, left: true, right: true }],
      ["desk", front],
      ["deskSet", front],
      ["kitchenBlock", front],
      ["hobUnit", front],
      ["sinkUnit", front],
      ["counter", front],
      ["fridge", front],
      ["dishwasher", front],
      ["ovenColumn", front],
      ["wallCabinet", none],
      ["bathroomBlock", front],
      ["toilet", front],
      ["bidet", front],
      ["washbasin", front],
      ["cornerBasin", front],
      ["showerTray", front],
      ["cornerShower", front],
      ["bathtub", front],
      ["washingMachine", front],
      ["wardrobe", front],
      ["drawers", front],
      ["nightstand", none],
      ["chair", none],
      ["shelf", front],
      ["tvUnit", none],
      ["block", none],
      ["roundBlock", none],
      ["cornerBlock", none],
      ["stair", front],
      ["openStair", front],
      ["storageStair", front],
      ["shipsLadder", front],
      ["alternatingTread", front],
      ["rungLadder", front],
      ["spiralStair", front],
      ["winderStair", { ...none, right: true }],
      ["storageSteps", front],
      ["cornerDesk", front],
      ["cornerWardrobe", front],
      ["cornerCounter", front],
      ["cornerSofa", front],
      ["plant", none],
      ["cot", front],
      ["radiator", none],
      ["towelRail", none],
      ["rug", none],
      ["roundRug", none],
      ["vanityUnit", front],
      ["palm", none],
      ["fern", none],
      ["rosette", none],
      ["seatedDining", { front: true, back: true, left: true, right: true }],
      ["seatedRound", { front: true, back: true, left: true, right: true }],
      ["range", front],
      ["cookerHood", none],
      ["tallPantry", front],
      ["stool", none],
      ["barTable", front],
      ["bench", none],
      ["storageChest", none],
      ["electricFireplace", none],
      ["wallUnit", none],
      ["woodStove", front],
      ["wheelWell", none],
      ["beam", none],
      ["picture", none], ["mirror", none], ["clock", none], ["wallTv", none], ["pegboard", none], ["coatHooks", none], ["coatStand", none],
      ["glassCabinet", front], ["halfGlassCabinet", front],
    ]);
  });

  it("sitAt is exactly the built-in table and desk, the desk, the corner desk, the bar table (pieces.14) and the folding and extending tables; seat is exactly chair and stool", () => {
    expect(OBJECT_KINDS.filter((k) => k.sitAt).map((k) => k.id)).toEqual(["builtInTable", "builtInDesk", "foldingTable", "extendingTable", "roundTable", "desk", "cornerDesk", "barTable"]);
    expect(OBJECT_KINDS.filter((k) => k.seat !== null).map((k) => k.id)).toEqual(["chair", "stool"]);
  });
});

// Use-zone defaults (furnish.15, .20): one entry per side, full sides but for three kinds.
describe("zone defaults", () => {
  it("the defaults differ only for beds, desks (the desk set's too), the Murphy bed and the winder stair (kinds.test.ts)", () => {
    const full = { start: 0, end: 0 };
    expect(MURPHY_MATTRESS_INSET).toBe(0.1);
    expect(kindOf("bed")?.zoneDefaults).toEqual({ front: full, back: full, left: { start: 0.45, end: 0 }, right: { start: 0.45, end: 0 } });
    expect(kindOf("desk")?.zoneDefaults).toEqual({ front: { centred: 0.7 }, back: full, left: full, right: full });
    expect(kindOf("murphyBed")?.zoneDefaults).toEqual({ front: { start: MURPHY_MATTRESS_INSET, end: MURPHY_MATTRESS_INSET }, back: full, left: full, right: full });
    expect(kindOf("liftBed")?.zoneDefaults).toEqual(kindOf("bed")?.zoneDefaults);
    expect(kindOf("deskSet")?.zoneDefaults).toEqual(kindOf("desk")?.zoneDefaults);
    expect(kindOf("winderStair")?.zoneDefaults).toEqual({ front: full, back: full, left: { frontSquare: true }, right: { frontSquare: true } }); // steps.09
    const others = OBJECT_KINDS.filter((k) => !["bed", "liftBed", "desk", "deskSet", "murphyBed", "winderStair"].includes(k.id));
    expect(others.map((k) => k.id)).toEqual(expect.arrayContaining(["builtInDesk", "builtInTable", "nightstand", "toilet", "hobUnit", "cornerBlock"]));
    for (const k of others) expect(k.zoneDefaults, k.id).toEqual({ front: full, back: full, left: full, right: full });
  });
});

// Sofa, chest of drawers and extending table (smart.15, .18; spec: layouts).
describe("the new kinds' rows", () => {
  const none = { front: false, back: false, left: false, right: false };

  it("sofa: one state 2.10 × 0.90, front zone 0.5; not sat at, not a seat", () => {
    expect(kindConfigs("sofa")).toMatchObject([{ id: "standard", label: "Standard", w: 2.1, d: 0.9, zone: 0.5 }]);
    expect(kindOf("sofa")).toMatchObject({ label: "Sofa", sides: { ...none, front: true }, sitAt: false, seat: null, family: null }); // its presets: presets.test.ts
  });

  it("drawers: a chest of drawers, one state 1.00 × 0.50, front zone 0.9", () => {
    expect(kindConfigs("drawers")).toMatchObject([{ id: "standard", label: "Standard", w: 1, d: 0.5, zone: 0.9 }]);
    expect(kindOf("drawers")).toMatchObject({ label: "Chest of drawers", sides: { ...none, front: true }, sitAt: false, seat: null });
  });

  it("extendingTable: closed 0.80 × 1.20 then extended 0.80 × 1.66, zones 0.6 left and right, sat at", () => {
    expect(kindConfigs("extendingTable")).toMatchObject([
      { id: "closed", label: "Closed", w: 0.8, d: 1.2, zone: 0.6 },
      { id: "extended", label: "Extended", w: 0.8, d: 1.66, zone: 0.6 },
    ]);
    expect(kindOf("extendingTable")).toMatchObject({ label: "Extending table", sides: { ...none, left: true, right: true }, sitAt: true, seat: null });
    expect(defaultSize("extendingTable")).toMatchObject({ w: { closed: 0.8, extended: 0.8 }, d: { closed: 1.2, extended: 1.66 } });
  });
});

// Built-in units (smart.02, .04, .21): one family, Opens into Table, Desk or Bed.
describe("the built-in family", () => {
  it("is the built-in table, desk and Murphy bed in OBJECT_KINDS order, sharing folded and down, labelled Closed and Open", () => {
    expect(FAMILY_LABELS.builtIn).toBe("Built-in unit");
    expect(familyKinds("builtIn").map((k) => [k.id, k.opensInto])).toEqual([["builtInTable", "Table"], ["builtInDesk", "Desk"], ["murphyBed", "Bed"]]);
    for (const k of familyKinds("builtIn")) {
      expect(kindConfigs(k.id).map((c) => [c.id, c.label]), k.id).toEqual([["folded", "Closed"], ["down", "Open"]]);
      expect(k.family).toBe("builtIn");
    }
    expect(kindOf("bed")?.family).toBeNull();
    expect(kindOf("bed")?.opensInto).toBeNull();
    expect(OBJECT_KINDS.filter((k) => k.opensInto !== null).map((k) => k.id)).toEqual(["builtInTable", "builtInDesk", "murphyBed"]);
  });

  it("the table and desk rows: closed 0.35 deep with no zone, open with a 0.6 and a 0.8 front zone", () => {
    expect(kindConfigs("builtInTable")).toMatchObject([
      { id: "folded", label: "Closed", w: 1.2, d: 0.35, zone: null },
      { id: "down", label: "Open", w: 1.2, d: 1.15, zone: 0.6 },
    ]);
    expect(kindConfigs("builtInDesk")).toMatchObject([
      { id: "folded", label: "Closed", w: 1, d: 0.35, zone: null },
      { id: "down", label: "Open", w: 1, d: 0.95, zone: 0.8 },
    ]);
    expect(kindOf("builtInTable")).toMatchObject({ label: "Built-in table", sitAt: true, seat: null });
    expect(kindOf("builtInDesk")).toMatchObject({ label: "Built-in desk", sitAt: true, seat: null });
    expect(kindOf("murphyBed")).toMatchObject({ label: "Murphy bed", sitAt: false });
  });
});

// Every default size is one of the kind's presets (spec: layouts size presets): the bed is King.
describe("default sizes", () => {
  it("a new bed is 1.70 × 2.10 and a new sofa bed 2.10 wide in both configurations", () => {
    const room = rectDoc(0, 0, 6, 5);
    const bed = unwrap(execute(room, { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 4 } })).doc;
    expect(bed.objects["a/o0"]).toMatchObject({ w: { standard: 1.7 }, d: { standard: 2.1 } });
    const sofaBed = unwrap(execute(room, { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "sofaBed" }, at: { x: 3, y: 4 } })).doc;
    expect(sofaBed.objects["b/o0"]).toMatchObject({ w: { sofa: 2.1, bed: 2.1 }, d: { sofa: 0.9, bed: 1.6 } });
    // A stored bed keeps its size.
    const stored = unwrap(deserialize(serialize(place(room, { object: "o", kind: "bed", at: [3, 4], size: BED_160x200 }))));
    expect(stored.objects.o).toMatchObject({ w: { standard: 1.6 }, d: { standard: 2 } });
  });
});

// The Kind switch (furnish.17): same configuration ids in order, the target not retired, not the same kind.
describe("canSwitchKind (furnish.17)", () => {
  it("same configuration ids switch; different ones don't", () => {
    const yes: [string, string][] = [["wardrobe", "drawers"], ["bed", "sofa"], ["block", "bed"], ["builtInTable", "murphyBed"], ["murphyBed", "builtInDesk"]];
    for (const [from, to] of yes) expect(canSwitchKind(from, to), `${from} → ${to}`).toBe(true);
    // The folding table and the built-in table share `folded` only; the sofa bed's first id is not "standard".
    const no: [string, string][] = [
      ["wardrobe", "wardrobe"], ["bed", "murphyBed"], ["murphyBed", "bed"], ["sofaBed", "sofa"], ["sofa", "sofaBed"],
      ["foldingTable", "builtInTable"], ["builtInTable", "foldingTable"], ["bed", "piano"], ["piano", "bed"],
    ];
    for (const [from, to] of no) expect(canSwitchKind(from, to), `${from} → ${to}`).toBe(false);
  });

  it("the sofa bed, folding table and extending table switch to nothing", () => {
    for (const id of ["sofaBed", "foldingTable", "extendingTable"]) expect(OBJECT_KINDS.filter((k) => canSwitchKind(id, k.id)), id).toEqual([]);
  });

  it("a single-configuration kind's targets are the other single-configuration kinds but the L ones and the sets, in catalogue order", () => {
    const targets = OBJECT_KINDS.filter((k) => canSwitchKind("wardrobe", k.id)).map((k) => k.id);
    expect(targets).toEqual(OBJECT_KINDS.filter((k) => k.id !== "wardrobe" && !k.retired && k.aggregate === null && k.configs.length === 1 && k.stair === null && !k.well && !k.beam && k.outline !== "ell").map((k) => k.id));
    expect(targets).toEqual(expect.arrayContaining(["bed", "drawers", "block"]));
    for (const id of ["wardrobe", "sofaBed", "murphyBed", "builtInTable", "foldingTable", "extendingTable"]) expect(targets).not.toContain(id);
  });

  it("a retired target is refused; a retired source may switch", () => {
    const wardrobe = kindOf("wardrobe");
    const drawers = kindOf("drawers");
    if (!wardrobe || !drawers) throw new Error("kinds missing");
    expect(kindsSwitchable(wardrobe, { ...drawers, retired: true })).toBe(false);
    expect(kindsSwitchable({ ...wardrobe, retired: true }, drawers)).toBe(true);
    expect(canSwitchKind("wardrobe", "kitchenBlock")).toBe(false); // the Kitchen block is retired (step 10)
  });
});

// The kinds table's semantic class, outline and retired columns (furnish.19, .22; spec: layouts).
describe("semantic class, outline and retired (furnish.19, .22)", () => {
  const stored = () => place(place(rectDoc(0, 0, 6, 4), { object: "k", kind: "kitchenBlock", at: [3, 3.85] }), { object: "w", kind: "wardrobe", at: [1, 3.85] });

  it("every kind's semantic class is the spec's (AC-15)", () => {
    expect(Object.fromEntries(OBJECT_KINDS.map((k) => [k.id, k.semanticClass]))).toEqual({
      bed: "IfcFurniture BED", mattress: "IfcFurniture BED", liftBed: "IfcFurniture BED", loftBed: "IfcFurniture BED", wallCabinet: "IfcFurniture USERDEFINED", builtInTable: "IfcFurniture TABLE", builtInDesk: "IfcFurniture DESK", murphyBed: "IfcFurniture BED",
      sofaBed: "IfcFurniture SOFA", sofa: "IfcFurniture SOFA", armchair: "IfcFurniture CHAIR", coffeeTable: "IfcFurniture TABLE",
      foldingTable: "IfcFurniture TABLE", extendingTable: "IfcFurniture TABLE", roundTable: "IfcFurniture TABLE", desk: "IfcFurniture DESK",
      deskSet: "IfcFurniture DESK", seatedDining: "IfcFurniture TABLE", seatedRound: "IfcFurniture TABLE",
      range: "IfcElectricAppliance ELECTRICCOOKER", cookerHood: "IfcElectricAppliance USERDEFINED", tallPantry: "IfcFurniture USERDEFINED",
      stool: "IfcFurniture CHAIR", barTable: "IfcFurniture TABLE", bench: "IfcFurniture USERDEFINED", storageChest: "IfcFurniture USERDEFINED",
      electricFireplace: "IfcSpaceHeater USERDEFINED", wallUnit: "IfcUnitaryEquipment USERDEFINED", wheelWell: "IfcBuildingElementProxy USERDEFINED", beam: "IfcBeam BEAM", woodStove: "IfcSpaceHeater USERDEFINED",
      picture: "IfcFurnishingElement USERDEFINED", mirror: "IfcFurnishingElement USERDEFINED", clock: "IfcFurnishingElement USERDEFINED", wallTv: "IfcAudioVisualAppliance DISPLAY",
      pegboard: "IfcFurnishingElement USERDEFINED", coatHooks: "IfcFurnishingElement USERDEFINED", coatStand: "IfcFurniture USERDEFINED",
      glassCabinet: "IfcFurniture USERDEFINED", halfGlassCabinet: "IfcFurniture USERDEFINED",
      kitchenBlock: "IfcFurniture USERDEFINED", hobUnit: "IfcElectricAppliance ELECTRICCOOKER", sinkUnit: "IfcSanitaryTerminal SINK",
      counter: "IfcFurniture USERDEFINED", fridge: "IfcElectricAppliance FRIDGE_FREEZER", dishwasher: "IfcElectricAppliance DISHWASHER",
      ovenColumn: "IfcElectricAppliance ELECTRICCOOKER", bathroomBlock: "IfcFurniture USERDEFINED",
      toilet: "IfcSanitaryTerminal TOILETPAN", bidet: "IfcSanitaryTerminal BIDET", washbasin: "IfcSanitaryTerminal WASHHANDBASIN",
      cornerBasin: "IfcSanitaryTerminal WASHHANDBASIN", showerTray: "IfcSanitaryTerminal SHOWER", cornerShower: "IfcSanitaryTerminal SHOWER",
      bathtub: "IfcSanitaryTerminal BATH", washingMachine: "IfcElectricAppliance WASHINGMACHINE", wardrobe: "IfcFurniture USERDEFINED", drawers: "IfcFurniture USERDEFINED",
      nightstand: "IfcFurniture USERDEFINED", chair: "IfcFurniture CHAIR", shelf: "IfcFurniture USERDEFINED", tvUnit: "IfcAudioVisualAppliance DISPLAY", block: "IfcFurnishingElement USERDEFINED",
      roundBlock: "IfcFurnishingElement USERDEFINED", cornerBlock: "IfcFurnishingElement USERDEFINED",
      storageStair: "IfcStair STRAIGHT_RUN_STAIR", stair: "IfcStair STRAIGHT_RUN_STAIR", openStair: "IfcStair STRAIGHT_RUN_STAIR",
      shipsLadder: "IfcStair STRAIGHT_RUN_STAIR", alternatingTread: "IfcStair STRAIGHT_RUN_STAIR", rungLadder: "IfcStair LADDER", spiralStair: "IfcStair SPIRAL_STAIR", winderStair: "IfcStair QUARTER_WINDING_STAIR", storageSteps: "IfcStair STRAIGHT_RUN_STAIR",
      cornerDesk: "IfcFurniture DESK", cornerWardrobe: "IfcFurniture USERDEFINED", cornerCounter: "IfcFurniture USERDEFINED", cornerSofa: "IfcFurniture SOFA",
      plant: "IfcFurnishingElement USERDEFINED", palm: "IfcFurnishingElement USERDEFINED", fern: "IfcFurnishingElement USERDEFINED", rosette: "IfcFurnishingElement USERDEFINED", cot: "IfcFurniture BED", radiator: "IfcSpaceHeater RADIATOR", towelRail: "IfcSpaceHeater RADIATOR", vanityUnit: "IfcSanitaryTerminal WASHHANDBASIN",
      rug: "IfcFurnishingElement USERDEFINED", roundRug: "IfcFurnishingElement USERDEFINED",
    });
    for (const k of OBJECT_KINDS) expect(k.semanticClass, k.id).toMatch(/^Ifc[A-Z][A-Za-z]+ [A-Z_]+$/);
  });

  it("retired is exactly the kitchen block and the bathroom block; their rows stay", () => {
    expect(OBJECT_KINDS.filter((k) => k.retired).map((k) => k.id)).toEqual(["kitchenBlock", "bathroomBlock"]);
    expect(kindOf("kitchenBlock")?.configs).toMatchObject([{ id: "standard", label: "Standard", w: 2.4, d: 0.6, zone: 1 }]);
    expect(kindOf("bathroomBlock")?.configs).toMatchObject([{ id: "standard", label: "Standard", w: 1.8, d: 1.5, zone: 0.6 }]);
    expect(OBJECT_KINDS).toHaveLength(88);
  });

  it("every kind draws a rectangle outline but the round table and set, the corner basin, the corner shower, the round and corner blocks, the corner kinds, the plant and the round rug", () => {
    expect(OBJECT_KINDS.filter((k) => k.outline !== "rect").map((k) => [k.id, k.outline])).toEqual([
      ["roundTable", "round"], ["toilet", "pan"], ["bidet", "pan"], ["washbasin", "soft"], ["cornerBasin", "corner"], ["cornerShower", "quarter"], ["nightstand", "soft"], ["roundBlock", "round"], ["cornerBlock", "corner"], ["cornerDesk", "ell"],
      ["cornerWardrobe", "ell"], ["cornerCounter", "ell"], ["cornerSofa", "ell"], ["plant", "round"], ["roundRug", "round"], ["palm", "round"], ["fern", "round"], ["rosette", "round"], ["seatedRound", "round"], ["stool", "round"], ["coatStand", "round"],
    ]);
    for (const k of OBJECT_KINDS) expect(["rect", "round", "quarter", "corner", "ell", "soft", "pan"], k.id).toContain(k.outline);
  });

  it("canSwitchKind never targets a retired kind, but a retired piece switches away", () => {
    expect(canSwitchKind("wardrobe", "kitchenBlock")).toBe(false);
    expect(canSwitchKind("block", "bathroomBlock")).toBe(false);
    expect(canSwitchKind("kitchenBlock", "bathroomBlock")).toBe(false);
    expect(canSwitchKind("kitchenBlock", "wardrobe")).toBe(true);
  });

  it("the basic shapes switch to and from any single-configuration kind", () => {
    expect(canSwitchKind("roundBlock", "wardrobe")).toBe(true);
    expect(canSwitchKind("cornerBlock", "block")).toBe(true);
    expect(canSwitchKind("block", "roundBlock")).toBe(true);
    expect(canSwitchKind("roundBlock", "sofaBed")).toBe(false);
  });

  it("setObjectKind refuses a retired target and turns a stored kitchen block into a wardrobe at 2.40 × 0.60", () => {
    // The block at x 1.8–4.2 and the wardrobe at x 0.4–1.6, both at y 3.25–3.85.
    const doc = stored();
    expect(execute(doc, { type: "setObjectKind", objectId: "w", kind: "kitchenBlock" }).ok).toBe(false);
    expect(unwrap(execute(doc, { type: "setObjectKind", objectId: "k", kind: "wardrobe" })).doc.objects.k).toEqual({
      id: "k", kind: "wardrobe", name: "Wardrobe", w: { standard: 2.4 }, d: { standard: 0.6 }, h: { standard: 2.05 }, z: { standard: 0 },
    });
  });

  it("the class, outline and retired flag are never stored", () => {
    const json = JSON.stringify(serialize(stored()));
    for (const word of ["Ifc", "semanticClass", "outline", "retired"]) expect(json, word).not.toContain(word);
  });
});

// Default heights per kind configuration (heights.22, the spec's table): a top of at most 2.50 keeps every stored
// drawing valid under the default ceiling.
describe("default heights", () => {
  it("every config has a height in MIN_HEIGHT (0.01)–10 and a top at most 2.50", () => {
    for (const k of OBJECT_KINDS) {
      for (const c of k.configs) {
        expect({ kind: k.id, config: c.id, ok: c.h >= MIN_HEIGHT && c.h <= 10 }).toEqual({ kind: k.id, config: c.id, ok: true });
        if (c.z === "ceiling") continue;
        expect({ kind: k.id, config: c.id, top: c.z + c.h <= 2.5 + 1e-9 }).toEqual({ kind: k.id, config: c.id, top: true });
      }
    }
  });

  it("kitchen modules share WORKTOP_HEIGHT", () => {
    expect(WORKTOP_HEIGHT).toBe(0.9);
    for (const id of ["hobUnit", "sinkUnit", "counter", "dishwasher", "kitchenBlock"]) {
      expect({ id, h: kindConfigs(id).map((c) => c.h) }).toEqual({ id, h: [WORKTOP_HEIGHT] });
    }
  });

  it("the spec's table: height and elevation per kind configuration, for every kind (AC-20)", () => {
    const floor = (h: number) => [[h, 0]];
    const table: Record<string, (number | "ceiling")[][]> = {
      bed: floor(1), mattress: floor(0.25), liftBed: [[0.35, "ceiling"], [0.35, 0.2]], loftBed: [[0.35, 1.45]], builtInTable: [[1.6, 0], [1.6, 0]],
      builtInDesk: [[1.4, 0], [1.4, 0]], murphyBed: [[2.24, 0], [2.24, 0]], sofaBed: [[0.9, 0], [0.9, 0]], sofa: floor(0.9),
      armchair: floor(1), chair: floor(0.9), coffeeTable: floor(0.45), desk: floor(0.75), roundTable: floor(0.75),
      deskSet: floor(0.9), seatedDining: floor(0.9), seatedRound: floor(0.9),
      range: floor(0.9), cookerHood: [[0.9, "ceiling"]], tallPantry: floor(2.1), stool: floor(0.75), barTable: floor(1.05), bench: floor(0.45), storageChest: floor(0.5), electricFireplace: [[0.55, 0.3]], wallUnit: [[0.28, 2]], wheelWell: floor(0.35), beam: [[0.2, "ceiling"]], woodStove: floor(0.65),
      picture: [[0.73, 1.15]], mirror: [[0.8, 1.1]], clock: [[0.3, 1.8]], wallTv: [[0.72, 1]], pegboard: [[0.6, 1]], coatHooks: [[0.12, 1.6]], coatStand: floor(1.75), glassCabinet: floor(2.02), halfGlassCabinet: floor(2.02),
      foldingTable: [[0.75, 0], [0.75, 0]], extendingTable: [[0.75, 0], [0.75, 0]], tvUnit: floor(1.2), nightstand: floor(0.6),
      hobUnit: floor(0.9), sinkUnit: floor(0.9), counter: floor(0.9), dishwasher: floor(0.9), kitchenBlock: floor(0.9),
      fridge: floor(1.9), ovenColumn: floor(2.15), wallCabinet: [[0.75, 1.4]], toilet: floor(0.42), bidet: floor(0.42),
      washbasin: floor(1.05), cornerBasin: floor(1.05), showerTray: floor(2), cornerShower: floor(2), bathroomBlock: floor(2),
      bathtub: floor(0.75), washingMachine: floor(0.85), wardrobe: floor(2.05), drawers: floor(0.9), shelf: floor(1.5),
      block: floor(1), roundBlock: floor(1), cornerBlock: floor(1), storageStair: floor(2.15), stair: floor(2.15), openStair: floor(2.15),
      shipsLadder: floor(2.15), alternatingTread: floor(2.15), rungLadder: floor(2.15), spiralStair: floor(2.15), winderStair: floor(2.15), storageSteps: floor(0.45),
      cornerDesk: floor(0.75), cornerWardrobe: floor(2.05), cornerCounter: floor(0.9), cornerSofa: floor(0.9),
      vanityUnit: floor(1.05), palm: floor(1.8), fern: floor(0.8), rosette: floor(0.3), plant: floor(1.2), cot: floor(0.9), radiator: [[0.6, 0.15]], towelRail: [[1.2, 0.15]], rug: floor(0.01), roundRug: floor(0.01),
    };
    expect(OBJECT_KINDS.map((k) => k.id).sort()).toEqual(Object.keys(table).sort());
    for (const k of OBJECT_KINDS) expect({ kind: k.id, configs: k.configs.map((c) => [c.h, c.z]) }).toEqual({ kind: k.id, configs: table[k.id] });
  });

  it("defaultSize copies h and z per configuration", () => {
    expect(defaultSize("murphyBed")).toEqual({ w: { folded: 1.6, down: 1.6 }, d: { folded: 0.4, down: 2.1 }, h: { folded: 2.24, down: 2.24 }, z: { folded: 0, down: 0 } });
  });
});

// The corner desk (catalog.05, .17): an `L` kind with default arms; only `ell` kinds have arms.
describe("the corner desk row", () => {
  it("is a 1.60 × 1.20 desk on the ell outline, 0.75 tall, sat at, with 0.60 arms and four presets", () => {
    expect(kindConfigs("cornerDesk")).toEqual([{ id: "standard", label: "Standard", w: 1.6, d: 1.2, zone: 0.8, h: 0.75, z: 0 }]);
    expect(kindOf("cornerDesk")).toMatchObject({ label: "Corner desk", outline: "ell", arms: { back: 0.6, left: 0.6 }, sitAt: true, seatsUnder: ["standard"], semanticClass: "IfcFurniture DESK" });
    expect(kindOf("cornerDesk")?.presets.map((p) => [p.id, p.label, p.w, p.d.standard])).toEqual([
      ["120 × 120", "120 × 120", 1.2, 1.2], ["140 × 140", "140 × 140", 1.4, 1.4], ["160 × 120", "160 × 120", 1.6, 1.2], ["180 × 140", "180 × 140", 1.8, 1.4],
    ]);
    expect(OBJECT_KINDS.filter((k) => k.arms !== null).map((k) => k.id)).toEqual(OBJECT_KINDS.filter((k) => k.outline === "ell").map((k) => k.id));
  });
});

// The new kinds of the heights cycle (heights.22, .25, .26): lift bed, loft bed, wall cabinet; Block relabelled.
describe("the heights kinds", () => {
  it("the lift bed is Up at the ceiling and Down at 0.20, 1.70 × 2.10 in both, bed sides with a zone only Down", () => {
    expect(kindConfigs("liftBed")).toEqual([
      { id: "up", label: "Up", w: 1.7, d: 2.1, zone: null, h: 0.35, z: "ceiling" },
      { id: "down", label: "Down", w: 1.7, d: 2.1, zone: 0.6, h: 0.35, z: 0.2 },
    ]);
    expect(kindOf("liftBed")).toMatchObject({ label: "Lift bed", sides: { front: false, back: false, left: true, right: true }, semanticClass: "IfcFurniture BED", family: null });
    expect(kindOf("liftBed")?.presets.map((p) => [p.label, p.w, p.d])).toContainEqual(["Single 100 × 210", 1, { up: 2.1, down: 2.1 }]);
  });

  it("the loft bed and the wall cabinet: one configuration, raised, no zone", () => {
    expect(kindConfigs("loftBed")).toEqual([{ id: "standard", label: "Standard", w: 1, d: 2.1, zone: null, h: 0.35, z: 1.45 }]);
    expect(kindOf("loftBed")?.presets.map((p) => p.label)).toEqual(["Single 100 × 210", "Double 150 × 210"]);
    expect(kindConfigs("wallCabinet")).toEqual([{ id: "standard", label: "Standard", w: 0.6, d: 0.35, zone: null, h: 0.75, z: 1.4 }]);
    expect(kindOf("wallCabinet")?.presets.map((p) => [p.w, p.d])).toEqual([[0.4, { standard: 0.35 }], [0.6, { standard: 0.35 }], [0.8, { standard: 0.35 }]]);
    expect(kindOf("wallCabinet")).toMatchObject({ label: "Wall cabinet", semanticClass: "IfcFurniture USERDEFINED" });
  });

  it("lift bed and built-ins cannot switch into each other (config ids differ)", () => {
    expect(canSwitchKind("liftBed", "murphyBed")).toBe(false);
    expect(canSwitchKind("murphyBed", "liftBed")).toBe(false);
    expect(canSwitchKind("loftBed", "wallCabinet")).toBe(true);
  });

  it("relabelled blocks keep their ids; a stored block named \"Block\" keeps its name", () => {
    expect(["block", "roundBlock", "cornerBlock"].map((id) => kindOf(id)?.label)).toEqual(["Custom box", "Round box", "Corner box"]);
    const doc = place(rectDoc(0, 0, 6, 4), { object: "b", kind: "block", at: [3, 2] });
    const b = doc.objects.b;
    if (!b) throw new Error("no block");
    const stored = { ...doc, objects: { b: { ...b, name: "Block" } } };
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(stored))))).objects.b?.name).toBe("Block");
  });
});
