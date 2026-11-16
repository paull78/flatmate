import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_CEILING, MIN_WALL_TOP, MOTIF_IDS, OBJECT_KINDS, PROJECT_FIELDS, SET_FIELDS } from "@fm/domain";
import { MAX_COORD, MAX_DELETE, MAX_FIELD_VALUE, MAX_SIZE, MAX_WALLS, SCHEMAS } from "../src/schemas";

const parse = <K extends keyof typeof SCHEMAS>(tool: K, input: unknown) => z.object(SCHEMAS[tool]).safeParse(input);

describe("set_finish's schema (finishes.14, .27)", () => {
  it("takes every motif id and none; colour, strength, size and angle are optional and checked by the domain", () => {
    for (const motif of [...MOTIF_IDS, "none"]) expect(parse("set_finish", { label: "l1", motif }).success, motif).toBe(true);
    const full = { label: "l1", motif: "planks", colour: "#C8A27A", strength: 45, size: 0.2, angle: 0 };
    expect(parse("set_finish", full).data).toEqual(full);
    expect(parse("set_finish", { wall: "w1", side: "left", reset: true }).success).toBe(true); // reset takes no motif (inherit step 03); the tool asks for one otherwise
    expect(parse("set_finish", { label: "l1", motif: "planks", strength: "45" }).success).toBe(false);
  });
});

describe("set_project_field's schema (sheet.06, .32)", () => {
  it("takes the key from the domain's list, as place_object takes kinds, and bounds the value", () => {
    expect(SCHEMAS.set_project_field.key.options).toEqual([...PROJECT_FIELDS, ...SET_FIELDS].map((f) => f.key));
    const unknown = parse("set_project_field", { key: "colour", value: "red" });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.issues[0]?.message).toContain("client");
    const keys = SCHEMAS.set_project_field.key.description ?? "";
    for (const f of [...PROJECT_FIELDS, ...SET_FIELDS]) expect(keys).toContain(f.key);
    expect(parse("set_project_field", { key: "client", value: "Rossi" }).success).toBe(true);
    expect(parse("set_project_field", { key: "client", value: "" }).success).toBe(true);
    expect(parse("set_project_field", { key: "client", value: "x".repeat(MAX_FIELD_VALUE + 1) }).success).toBe(false);
    expect(parse("set_project_field", { key: "has space", value: "x" }).success).toBe(false);
  });
});

describe("tool input schemas (the MCP trust boundary, process lesson 29)", () => {
  it("accepts well-formed inputs, trims names and drops unknown fields", () => {
    expect(parse("draw_room", { corner: { x: 0, y: -2.5 }, width: 4, depth: 3 }).success).toBe(true);
    expect(parse("label_room", { point: { x: 1, y: 1 }, name: "  Bathroom " }).data?.name).toBe("Bathroom");
    expect(parse("move_joint", { joint: "r-1/j0", to: { x: 1, y: 2, z: 9 }, extra: true }).data).toEqual({ joint: "r-1/j0", to: { x: 1, y: 2 } });
    const walls = [{ a: { x: 0, y: 0 }, b: { x: 3, y: 0, z: 1 }, colour: 1 }, { a: { x: 3, y: 0 }, b: { x: 3, y: 3 } }];
    expect(parse("add_walls", { walls, extra: true }).data).toEqual({
      walls: [{ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } }, { a: { x: 3, y: 0 }, b: { x: 3, y: 3 } }],
    });
    expect(parse("get_drawing", {}).success).toBe(true);
    expect(parse("add_dimension", { from: { x: 0.1, y: 1.852 }, to: { x: 0.1, y: 1 }, offset: -0.5 }).success).toBe(true);
    expect(parse("get_drawing", { region: { min: { x: 0, y: 0 }, max: { x: 5, y: 5 } } }).success).toBe(true);
    const most = Array.from({ length: MAX_WALLS }, (_, i) => ({ a: { x: i, y: 0 }, b: { x: i, y: 1 } }));
    expect(parse("add_walls", { walls: most }).success).toBe(true);
  });

  it.each<[string, keyof typeof SCHEMAS, unknown]>([
    ["an infinite coordinate", "draw_room", { corner: { x: Infinity, y: 0 }, width: 1, depth: 1 }],
    ["NaN", "add_wall", { a: { x: NaN, y: 0 }, b: { x: 1, y: 0 } }],
    ["a coordinate out of range", "move_joint", { joint: "j", to: { x: MAX_COORD + 1, y: 0 } }],
    ["a zero width", "draw_room", { corner: { x: 0, y: 0 }, width: 0, depth: 3 }],
    ["a negative length", "set_wall_length", { wall: "w", length: -1 }],
    ["a number as a string", "set_wall_length", { wall: "w", length: "3" }],
    ["an id with a space", "set_wall_length", { wall: "has space", length: 3 }],
    ["an Object.prototype name", "rename", { id: "__proto__", name: "Kitchen" }],
    ["an Object.prototype name as a label", "set_finish", { label: "__proto__", motif: "planks" }],
    ["an unknown motif", "set_finish", { label: "l1", motif: "parquet" }],
    ["a motif's name instead of its id", "set_finish", { label: "l1", motif: "Wide planks" }],
    ["a region with min above max", "get_drawing", { region: { min: { x: 5, y: 0 }, max: { x: 0, y: 5 } } }],
    ["a region corner out of range", "get_drawing", { region: { min: { x: 0, y: 0 }, max: { x: MAX_COORD + 1, y: 1 } } }],
    ["an empty name", "label_room", { point: { x: 0, y: 0 }, name: "   " }],
    ["a 201-character name", "create_project", { name: "x".repeat(201) }],
    ["no ids", "delete", { ids: [] }],
    ["too many ids", "delete", { ids: Array.from({ length: MAX_DELETE + 1 }, (_, i) => `w${i}`) }],
    ["a missing field", "add_wall", { a: { x: 0, y: 0 } }],
    ["no walls", "add_walls", { walls: [] }],
    ["too many walls", "add_walls", { walls: Array.from({ length: MAX_WALLS + 1 }, (_, i) => ({ a: { x: i, y: 0 }, b: { x: i, y: 1 } })) }],
    ["a wall with an infinite coordinate", "add_walls", { walls: [{ a: { x: 0, y: 0 }, b: { x: -Infinity, y: 1 } }] }],
    ["a wall with a coordinate out of range", "add_walls", { walls: [{ a: { x: 0, y: -MAX_COORD - 1 }, b: { x: 0, y: 1 } }] }],
    ["a wall without an end", "add_walls", { walls: [{ a: { x: 0, y: 0 } }] }],
    ["a wall thinner than 0.05 m", "add_walls", { walls: [{ a: { x: 0, y: 0 }, b: { x: 0, y: 1 }, thickness: 0.04 }] }],
    ["a room with walls thicker than 0.50 m", "draw_room", { corner: { x: 0, y: 0 }, width: 4, depth: 3, thickness: 0.51 }],
    ["a dimension offset past 1000 m", "add_dimension", { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, offset: 1001 }],
    ["a dimension offset past -1000 m", "add_dimension", { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, offset: -1001 }],
    ["a dimension without an offset", "add_dimension", { from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }],
  ])("refuses %s", (_name, tool, input) => {
    expect(parse(tool, input).success).toBe(false);
  });

  it("set_wall_thickness refuses 0.04 and 0.51, accepts 0.05 and 0.5; add_wall without thickness is valid", () => {
    expect(parse("set_wall_thickness", { wall: "w", thickness: 0.04 }).success).toBe(false);
    expect(parse("set_wall_thickness", { wall: "w", thickness: 0.51 }).success).toBe(false);
    expect(parse("set_wall_thickness", { wall: "w", thickness: 0.05 }).success).toBe(true);
    expect(parse("set_wall_thickness", { wall: "w", thickness: 0.5 }).success).toBe(true);
    expect(parse("set_wall_thickness", { wall: "w" }).success).toBe(false);
    expect(parse("add_wall", { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }).data).toEqual({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } });
    expect(parse("add_wall", { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 0.1 }).data?.thickness).toBe(0.1);
    expect(parse("add_walls", { walls: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 0.3 }] }).data?.walls[0]?.thickness).toBe(0.3);
    expect(parse("draw_room", { corner: { x: 0, y: 0 }, width: 4, depth: 3, thickness: 0.1 }).data?.thickness).toBe(0.1);
  });

  it("the new kinds and configurations are in the enums", () => {
    const at = { x: 2, y: 2.5 };
    for (const kind of ["sofa", "drawers", "extendingTable"]) expect(parse("place_object", { layout: "s0", kind, centre: at }).success, kind).toBe(true);
    for (const config of ["closed", "extended"]) expect(parse("set_configuration", { layout: "s0", object: "o", config }).success, config).toBe(true);
    const kinds = SCHEMAS.place_object.kind.description ?? "";
    expect(kinds).toContain("drawers = Chest of drawers (standard 1×0.5)");
    expect(kinds).toContain("extendingTable = Extending table (closed 0.8×1.2, extended 0.8×1.66)");
  });

  it("place_object leaves out the retired kinds; every other kind parses (furnish.19, AC-15)", () => {
    const at = { x: 2, y: 2.5 };
    for (const k of OBJECT_KINDS) expect(parse("place_object", { layout: "s0", kind: k.id, centre: at }).success, k.id).toBe(!k.retired);
    const kinds = SCHEMAS.place_object.kind.description ?? "";
    expect(kinds).not.toContain("kitchenBlock");
    expect(kinds).not.toContain("bathroomBlock");
    expect(kinds).toContain("wardrobe = Wardrobe (standard 1.2×0.6)");
    expect(parse("set_configuration", { layout: "s0", object: "o", config: "standard" }).success).toBe(true);
  });

  it("MCP accepts the basic shapes", () => {
    const at = { x: 2, y: 2.5 };
    for (const kind of ["roundBlock", "cornerBlock"]) expect(parse("place_object", { layout: "s0", kind, centre: at }).success, kind).toBe(true);
    const kinds = SCHEMAS.place_object.kind.description ?? "";
    expect(kinds).toContain("roundBlock = Round box (standard 0.6×0.6)");
    expect(kinds).toContain("cornerBlock = Corner box (standard 0.6×0.6)");
  });

  it("the bathroom kinds and their presets are in place_object's enums", () => {
    const at = { x: 2, y: 2.5 };
    for (const kind of ["toilet", "bidet", "washbasin", "cornerBasin", "showerTray", "cornerShower", "bathtub", "washingMachine"]) {
      expect(parse("place_object", { layout: "s0", kind, centre: at }).success, kind).toBe(true);
    }
    const kinds = SCHEMAS.place_object.kind.description ?? "";
    expect(kinds).toContain("toilet = Toilet (standard 0.36×0.54)");
    expect(kinds).toContain("cornerShower = Corner shower (standard 0.8×0.8)");
    expect(SCHEMAS.place_object.preset.unwrap().description ?? "").toContain("showerTray: 70 × 70, 80 × 80, 90 × 90, Rectangular 80 × 120");
    expect(parse("place_object", { layout: "s0", kind: "showerTray", centre: at, preset: "Rectangular" }).success).toBe(true);
    expect(parse("place_object", { layout: "s0", kind: "bathroomBlock", centre: at }).success).toBe(false);
  });

  it("the kitchen and living kinds and the new bed presets are in place_object's enums", () => {
    const at = { x: 2, y: 2.5 };
    const kinds = ["hobUnit", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "roundTable", "armchair", "coffeeTable", "tvUnit", "nightstand"];
    for (const kind of kinds) expect(parse("place_object", { layout: "s0", kind, centre: at }).success, kind).toBe(true);
    const legend = SCHEMAS.place_object.kind.description ?? "";
    expect(legend).toContain("hobUnit = Hob unit (standard 0.6×0.6)");
    expect(legend).toContain("roundTable = Round table (standard 0.9×0.9)");
    expect(legend).toContain("tvUnit = TV unit (standard 1.2×0.4)");
    const presets = SCHEMAS.place_object.preset.unwrap().description ?? "";
    expect(presets).toContain("counter: 30 × 60, 45 × 60, 60 × 60, 90 × 60, 120 × 60");
    expect(presets).toContain("bed: Small single 85 × 195, Narrow single 95 × 205, Single 100 × 210");
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, preset: "Small single" }).success).toBe(true);
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, preset: "Narrow single" }).success).toBe(true);
  });

  it("the corner wardrobe, counter and sofa and their presets are in place_object's enums (catalog.05)", () => {
    const at = { x: 2, y: 2.5 };
    for (const kind of ["cornerDesk", "cornerWardrobe", "cornerCounter", "cornerSofa"]) expect(parse("place_object", { layout: "s0", kind, centre: at }).success, kind).toBe(true);
    const legend = SCHEMAS.place_object.kind.description ?? "";
    expect(legend).toContain("cornerWardrobe = Corner wardrobe (standard 1.5×1)");
    expect(legend).toContain("cornerCounter = Corner counter (standard 2.4×1.8)");
    expect(legend).toContain("cornerSofa = Corner sofa (standard 2.6×2)");
    const presets = SCHEMAS.place_object.preset.unwrap().description ?? "";
    expect(presets).toContain("cornerWardrobe: 100 × 100, 150 × 100, 200 × 150");
    expect(presets).toContain("cornerCounter: 180 × 120, 240 × 180, 300 × 240");
    expect(presets).toContain("cornerSofa: 220 × 160, 260 × 200, 300 × 240");
    expect(parse("place_object", { layout: "s0", kind: "cornerCounter", centre: at, preset: "300 × 240" }).success).toBe(true);
  });

  it("the plant, cot, radiator and towel rail and their presets are in place_object's enums (catalog.08, .23)", () => {
    const at = { x: 2, y: 2.5 };
    for (const kind of ["plant", "cot", "radiator", "towelRail"]) expect(parse("place_object", { layout: "s0", kind, centre: at }).success, kind).toBe(true);
    const legend = SCHEMAS.place_object.kind.description ?? "";
    expect(legend).toContain("plant = Plant (standard 0.4×0.4)");
    expect(legend).toContain("cot = Cot (standard 0.66×1.26)");
    expect(legend).toContain("radiator = Radiator (standard 0.8×0.1)");
    expect(legend).toContain("towelRail = Towel rail (standard 0.5×0.1)");
    const presets = SCHEMAS.place_object.preset.unwrap().description ?? "";
    expect(presets).toContain("plant: 30 × 30, 40 × 40, 60 × 60");
    expect(presets).toContain("radiator: 40 × 10, 60 × 10, 80 × 10, 100 × 10, 120 × 10");
    expect(parse("place_object", { layout: "s0", kind: "radiator", centre: at, preset: "120 × 10" }).success).toBe(true);
  });

  it("the rugs and their presets are in place_object's enums (catalog.08)", () => {
    const at = { x: 2, y: 2.5 };
    for (const kind of ["rug", "roundRug"]) expect(parse("place_object", { layout: "s0", kind, centre: at }).success, kind).toBe(true);
    const legend = SCHEMAS.place_object.kind.description ?? "";
    expect(legend).toContain("rug = Rug (standard 2×1.4)");
    expect(legend).toContain("roundRug = Round rug (standard 1.6×1.6)");
    const presets = SCHEMAS.place_object.preset.unwrap().description ?? "";
    expect(presets).toContain("rug: 160 × 120, 200 × 140, 240 × 170, 300 × 200");
    expect(presets).toContain("roundRug: 120 × 120, 160 × 160, 200 × 200");
  });

  it("place_object refuses an unknown kind; set_size refuses 0.01 and 11", () => {
    const at = { x: 2, y: 2.5 };
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at }).success).toBe(true);
    expect(parse("place_object", { layout: "s0", kind: "piano", centre: at }).success).toBe(false);
    expect(parse("place_object", { layout: "s0", kind: "constructor", centre: at }).success).toBe(false);
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, rotation: 450 }).data?.rotation).toBe(450);
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, rotation: 12.5 }).success).toBe(false);
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, name: "  Guest bed " }).data?.name).toBe("Guest bed");
    expect(parse("set_size", { object: "o", width: 0.01, depth: 1 }).success).toBe(false);
    expect(parse("set_size", { object: "o", width: 1, depth: 11 }).success).toBe(false);
    expect(parse("set_size", { object: "o", width: 0.1, depth: 10 }).success).toBe(true);
    expect(parse("set_size", { object: "o", config: "down", width: 1.6, depth: 2 }).success).toBe(true);
    expect(parse("set_configuration", { layout: "s0", object: "o", config: "down" }).success).toBe(true);
    expect(parse("set_configuration", { layout: "s0", object: "o", config: "upsideDown" }).success).toBe(false);
    expect(parse("move_object", { layout: "s0", object: "o" }).success).toBe(true);
    expect(parse("move_object", { layout: "s0", object: "o", centre: { x: Infinity, y: 0 } }).success).toBe(false);
    expect(parse("add_layout", { name: "  Night " }).data).toEqual({ name: "Night" });
    expect(parse("add_layout", { name: "" }).success).toBe(false);
    expect(parse("copy_layout", { from: "s0", name: "Night" }).success).toBe(true);
    expect(parse("copy_layout", { from: "has space", name: "Night" }).success).toBe(false);
  });

  it("set_size takes a known preset; set_opens_into takes table, desk or bed; set_zones takes booleans (AC-10)", () => {
    expect(parse("set_size", { object: "o", preset: "King" }).success).toBe(true);
    expect(parse("set_size", { object: "o", preset: "Emperor" }).success).toBe(false);
    expect(parse("set_size", { object: "o" }).success).toBe(true); // the handler asks for a preset or a size
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: { x: 2, y: 2.5 }, preset: "US Queen" }).success).toBe(true);
    expect(parse("set_opens_into", { object: "o", into: "bed" }).success).toBe(true);
    expect(parse("set_opens_into", { object: "o", into: "sofa" }).success).toBe(false);
    expect(parse("set_zones", { layout: "s0", object: "o", left: false, front: true }).success).toBe(true);
    expect(parse("set_zones", { layout: "s0", object: "o", left: "yes" }).success).toBe(false);
    expect(parse("set_zones", { layout: "s0", object: "o", left: { depth: 0.4 }, right: "default", front: { depth: 0.5, start: 0, end: 0.2 } }).success).toBe(true);
    expect(parse("set_zones", { layout: "s0", object: "o", left: { depth: 0.05 } }).success).toBe(false); // under 0.10 m
    expect(parse("set_zones", { layout: "s0", object: "o", left: { start: -0.1 } }).success).toBe(false);
    const presets = SCHEMAS.place_object.preset.unwrap().description ?? "";
    expect(presets).toContain("bed: Small single 85 × 195, Narrow single 95 × 205, Single 100 × 210");
    expect(presets).toContain("US Queen 162 × 213");
  });

  it("add_door refuses width 0.4 and an unknown side; add_window refuses width 3.5", () => {
    expect(parse("add_door", { wall: "w", offset: 1.2 }).data).toEqual({ wall: "w", offset: 1.2 });
    expect(parse("add_door", { wall: "w", offset: 1.2, width: 0.9, kind: "sliding", side: "right", hinge: "b", glazed: true }).success).toBe(true);
    expect(parse("add_door", { wall: "w", offset: 1.2, width: 0.5 }).success).toBe(true);
    expect(parse("add_door", { wall: "w", offset: 1.2, width: 0.4 }).success).toBe(false);
    expect(parse("add_door", { wall: "w", offset: 1.2, width: 3 }).success).toBe(true); // a sliding glass door's; the domain checks each kind's range
    expect(parse("add_door", { wall: "w", offset: 1.2, width: 4.1 }).success).toBe(false);
    expect(parse("add_door", { wall: "w", offset: 1.2, side: "inside" }).success).toBe(false);
    expect(parse("add_door", { wall: "w", offset: 1.2, hinge: "c" }).success).toBe(false);
    expect(parse("add_door", { wall: "w", offset: 1.2, kind: "window" }).success).toBe(false);
    expect(parse("add_door", { wall: "w", offset: -0.1 }).success).toBe(false);
    expect(parse("add_door", { wall: "has space", offset: 1 }).success).toBe(false);
    expect(parse("add_window", { wall: "w", offset: 2.5 }).data).toEqual({ wall: "w", offset: 2.5 });
    expect(parse("add_window", { wall: "w", offset: 2.5, width: 3 }).success).toBe(true);
    expect(parse("add_window", { wall: "w", offset: 2.5, width: 3.5 }).success).toBe(false);
    expect(parse("add_window", { wall: "w", offset: 2.5, width: 0.2 }).success).toBe(false);
    expect(parse("add_window", { wall: "w", offset: 2.5, kind: "casement", side: "left", hinge: "b" }).data).toEqual({ wall: "w", offset: 2.5, kind: "casement", side: "left", hinge: "b" });
    expect(parse("add_window", { wall: "w", offset: 2.5, kind: "swing" }).success).toBe(false);
  });
});

describe("opening kinds come from the domain table (arch-review R-01)", () => {
  it("add_door accepts exactly the kinds whose table row is a door, add_window those that are windows", async () => {
    const { OPENING_KINDS, OPENING_KIND_IDS } = await import("@fm/domain");
    for (const kind of OPENING_KIND_IDS) {
      expect(parse("add_door", { wall: "w", offset: 1, kind }).success, kind).toBe(OPENING_KINDS[kind].tool === "add_door");
      expect(parse("add_window", { wall: "w", offset: 1, kind }).success, kind).toBe(OPENING_KINDS[kind].tool === "add_window");
    }
  });
});

describe("look and scale_underlay (import.08, .13)", () => {
  it("look region must have area", () => {
    const region = (min: { x: number; y: number }, max: { x: number; y: number }) => parse("look", { region: { min, max } }).success;
    expect(region({ x: 1, y: 0 }, { x: 1, y: 5 })).toBe(false);
    expect(region({ x: 0, y: 2 }, { x: 5, y: 2 })).toBe(false);
    expect(region({ x: 0, y: 5 }, { x: 5, y: 2 })).toBe(false);
    expect(region({ x: 0, y: 0 }, { x: MAX_COORD + 1, y: 1 })).toBe(false);
    expect(region({ x: 2, y: 3 }, { x: 2.01, y: 3.01 })).toBe(true);
    expect(parse("look", {}).success).toBe(true);
  });

  it("scale_underlay leaves distance sign to the domain", () => {
    const a = { x: -1.12, y: 4.93 };
    const b = { x: 1.88, y: 8.93 };
    expect(parse("scale_underlay", { a, b, distance: 0 }).success).toBe(true);
    expect(parse("scale_underlay", { a, b, distance: -2 }).success).toBe(true);
    expect(parse("scale_underlay", { a, b, distance: 7.05 }).success).toBe(true);
    expect(parse("scale_underlay", { a, b, distance: MAX_SIZE + 1 }).success).toBe(false);
    expect(parse("scale_underlay", { a, b, distance: -MAX_SIZE - 1 }).success).toBe(false);
    expect(parse("scale_underlay", { a, distance: 3 }).success).toBe(false);
    expect(parse("scale_underlay", { a, b: { x: Infinity, y: 0 }, distance: 3 }).success).toBe(false);
  });
});

describe("deck schemas (decks.08, .16)", () => {
  it("add_deck takes a preset, a centre and a size, with the domain's limits; set_deck any field; on takes floor or an ID", async () => {
    const { MAX_DECK_TOP, MIN_DECK_SIZE, MIN_DECK_TOP } = await import("@fm/domain");
    const deck = { centre: { x: 2, y: 1 }, width: 2, depth: 1.4 };
    expect(parse("add_deck", deck).data).toEqual(deck);
    expect(parse("add_deck", { ...deck, preset: "loft", name: " Sleeping loft ", rotation: 90, top: 2.2, solid: true }).data?.name).toBe("Sleeping loft");
    expect(parse("add_deck", { ...deck, preset: "mezzanine" }).success).toBe(false);
    expect(parse("add_deck", { ...deck, width: MIN_DECK_SIZE }).success).toBe(true);
    expect(parse("add_deck", { ...deck, width: MIN_DECK_SIZE - 0.01 }).success).toBe(false);
    expect(parse("add_deck", { ...deck, depth: MIN_DECK_SIZE - 0.01 }).success).toBe(false);
    expect(parse("add_deck", { ...deck, top: MIN_DECK_TOP }).success).toBe(true);
    expect(parse("add_deck", { ...deck, top: MIN_DECK_TOP - 0.01 }).success).toBe(false);
    expect(parse("add_deck", { ...deck, top: MAX_DECK_TOP + 0.01 }).success).toBe(false);
    expect(parse("add_deck", { ...deck, rotation: 12.5 }).success).toBe(false);
    expect(parse("add_deck", { ...deck, solid: "yes" }).success).toBe(false);
    expect(parse("add_deck", { ...deck, centre: { x: MAX_COORD + 1, y: 1 } }).success).toBe(false);
    expect(parse("add_deck", { centre: { x: 2, y: 1 } }).success).toBe(false);
    expect(parse("set_deck", { deck: "a/k0" }).success).toBe(true);
    expect(parse("set_deck", { deck: "a/k0", centre: { x: 3, y: 1 }, top: 0.6, solid: false }).data).toEqual({ deck: "a/k0", centre: { x: 3, y: 1 }, top: 0.6, solid: false });
    expect(parse("set_deck", { deck: "has space", centre: { x: 3, y: 1 } }).success).toBe(false);
    expect(parse("set_deck", { deck: "a/k0", width: 0.2 }).success).toBe(false);
    const at = { x: 2, y: 2.5 };
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, on: "floor" }).data?.on).toBe("floor");
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, on: "a/k0" }).data?.on).toBe("a/k0");
    expect(parse("place_object", { layout: "s0", kind: "bed", centre: at, on: "has space" }).success).toBe(false);
    expect(parse("move_object", { layout: "s0", object: "o", on: "a/k0" }).success).toBe(true);
    expect(parse("move_object", { layout: "s0", object: "o", on: "__proto__" }).success).toBe(false);
    expect(SCHEMAS.add_deck.preset.unwrap().description ?? "").toContain("Platform");
  });
});

describe("the column schemas (pillars.15)", () => {
  it("add_column takes a centre, width, depth and optional rotation; set_column a column id and the fields to change", () => {
    const centre = { x: 2, y: 2.5 };
    expect(SCHEMAS).toHaveProperty("add_column"); // z.object(undefined) parses anything (dims.38)
    expect(SCHEMAS).toHaveProperty("set_column");
    expect(parse("add_column", { centre, width: 0.3, depth: 0.3 }).success).toBe(true);
    expect(parse("add_column", { centre, width: 0.3, depth: 0.3, rotation: 30 }).success).toBe(true);
    expect(parse("add_column", { centre, width: 0.3 }).success).toBe(false);
    expect(parse("add_column", { centre, width: 0, depth: 0.3 }).success).toBe(false);
    expect(parse("add_column", { centre, width: MAX_SIZE + 1, depth: 0.3 }).success).toBe(false);
    // 2.01 parses: the domain refuses it with the range in its reason (AC-04).
    expect(parse("add_column", { centre, width: 2.01, depth: 0.3 }).success).toBe(true);
    expect(parse("set_column", { column: "c/w0" }).success).toBe(true);
    expect(parse("set_column", { column: "c/w0", centre, width: 0.4, depth: 0.2, rotation: 90 }).success).toBe(true);
    expect(parse("set_column", { width: 0.4 }).success).toBe(false);
    expect(parse("set_column", { column: "c/w0", rotation: Infinity }).success).toBe(false);
  });

  it("add_column takes on (the floor or a deck id) and top (the ceiling, a height or a deck id); set_column takes top (pillars.23, .48)", () => {
    const centre = { x: 2, y: 2.5 };
    for (const on of ["floor", "u/k0"]) expect(parse("add_column", { centre, width: 0.2, depth: 0.2, on }).success, on).toBe(true);
    for (const top of ["ceiling", MIN_WALL_TOP, MAX_CEILING, "u/k0"]) {
      expect(parse("add_column", { centre, width: 0.2, depth: 0.2, top }).success, String(top)).toBe(true);
      expect(parse("set_column", { column: "c/w0", top }).success, String(top)).toBe(true);
    }
    for (const top of [MIN_WALL_TOP / 2, MAX_CEILING + 1, "", null]) expect(parse("set_column", { column: "c/w0", top }).success, String(top)).toBe(false);
    expect(parse("add_column", { centre, width: 0.2, depth: 0.2, on: 3 }).success).toBe(false);
  });
});

describe("malformed arguments stop at the schemas (tidy C8, AC-18)", () => {
  it("refuses a null point, ids that are not a list and a number for a field value", () => {
    expect(parse("add_wall", { a: null, b: { x: 1, y: 0 } }).success).toBe(false);
    expect(parse("delete", { ids: "x" }).success).toBe(false);
    expect(parse("set_project_field", { key: "client", value: 5 }).success).toBe(false);
  });
});
