import { describe, expect, it } from "vitest";
import { onKey } from "../src/keys";
import { PALETTE_KINDS } from "../src/view/palette";
import { PALETTE_ALIASES } from "../src/view/palette-aliases";
import { normalise, osaDistance, searchPalette } from "../src/view/palette-search";
import { NO_MODS } from "../src/types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Quick add's matching (quick-add.02, .04, .10, spec "Matching"): every word must match, by the best tier, and rows go
// by their weakest word's tier, then palette order.

const kinds = (query: string): string[] => searchPalette(query).map((r) => r.kind);

describe("normalise", () => {
  it("lowercases, strips accents, drops apostrophes and turns other punctuation into spaces", () => {
    expect(normalise("Sofà")).toBe("sofa");
    expect(normalise("Ship's ladder")).toBe("ships ladder");
    expect(normalise("Built-in desk")).toBe("built in desk");
    expect(normalise("  Bed,   lift ")).toBe("bed lift");
  });
});

describe("searchPalette: labels and aliases", () => {
  it('"couch" finds the sofa through its alias, shown in brackets', () => {
    const [first] = searchPalette("couch");
    expect(first).toMatchObject({ kind: "sofa", label: "Sofa", detail: "(couch)", group: "Sit and eat" });
  });

  it('"bed" lists Bed, Lift bed, Loft bed, Murphy bed and Sofa bed first, in that order, then the nightstand ("bedside table") and the cot ("baby bed"), then the set', () => {
    expect(kinds("bed")).toEqual(["bed", "liftBed", "loftBed", "murphyBed", "sofaBed", "nightstand", "cot", "bedAndNightstands"]);
  });

  it("every word must match, in any order", () => {
    expect(kinds("bed sofa")).toEqual(["sofaBed"]);
    expect(kinds("bed xyzq")).toEqual([]);
  });

  it('"wc" finds the toilet and neither the washing machine nor the wall cabinet', () => {
    expect(kinds("wc")).toEqual(["toilet"]);
  });

  it("reports the matched part of the label for bold", () => {
    const murphy = searchPalette("bed").find((r) => r.kind === "murphyBed");
    expect(murphy?.matched).toEqual([{ start: 7, end: 10 }]);
    expect(searchPalette("Lift")[0]?.matched).toEqual([{ start: 0, end: 4 }]);
    expect(searchPalette("couch")[0]?.matched).toEqual([]);
  });

  it("an empty or blank query gives no rows", () => {
    expect(searchPalette("")).toEqual([]);
    expect(searchPalette("   ")).toEqual([]);
  });

  it("finds Storage steps first by its aliases (steps.03)", () => {
    for (const q of ["step drawers", "platform steps", "storage steps"]) expect(searchPalette(q)[0]?.kind, q).toBe("storageSteps");
  });

  it("every alias names a palette kind", () => {
    const ids = new Set(PALETTE_KINDS.flatMap((g) => g.cards.map((k) => k.kind)));
    expect(Object.keys(PALETTE_ALIASES).filter((k) => !ids.has(k))).toEqual([]);
  });

  it("a catalogue can be passed in, so ranking is tested apart from the vocabulary", () => {
    const catalogue = [{ kind: "a", label: "Alpha box", group: "G", aliases: ["thing"], presets: [] }];
    expect(searchPalette("thing", catalogue).map((r) => r.kind)).toEqual(["a"]);
  });
});

describe("the keys quick add takes for itself", () => {
  it('the editor gives "/" and Ctrl or ⌘ + K no meaning', () => {
    const shell = FakeShell.withDocument(roomDoc());
    const before = shell.state;
    for (const [key, mods] of [["/", {}], ["k", { ctrl: true }], ["k", { meta: true }]] as const) {
      const step = onKey(before, key, { ...NO_MODS, ...mods }, shell.host);
      expect([key, step.state === before, step.effects]).toEqual([key, true, []]);
    }
  });
});

describe("searchPalette: presets and sizes (step 03)", () => {
  it('"queen" shows Bed · US Queen 162 × 213 first, with the preset to arm', () => {
    expect(searchPalette("queen")[0]).toMatchObject({ kind: "bed", detail: "US Queen 162 × 213", preset: "US Queen 162 × 213" });
  });

  it('"bathtub 160" shows Bathtub · 160 × 70 first', () => {
    expect(searchPalette("bathtub 160")[0]).toMatchObject({ kind: "bathtub", preset: "160 × 70" });
  });

  it('"160" lists several kinds, each with a preset 160 cm wide or deep', () => {
    const rows = searchPalette("160");
    expect(new Set(rows.map((r) => r.kind)).size).toBeGreaterThan(1);
    for (const r of rows) expect([r.kind, r.preset ?? ""]).toEqual([r.kind, expect.stringMatching(/\b160\b/)]);
  });

  it('"160 200" needs one preset with both sizes: the King mattress', () => {
    expect(searchPalette("160x200").map((r) => [r.kind, r.preset])).toEqual([["mattress", "King 160 × 200"]]);
  });

  it('"king" (a preset name) finds the King presets of the bed, the mattress and the lift bed; "super king" the Super king', () => {
    expect(searchPalette("king").map((r) => [r.kind, r.preset])).toEqual([["bed", "King 170 × 210"], ["mattress", "King 160 × 200"], ["liftBed", "King 170 × 210"]]);
    expect(searchPalette("super king")[0]).toMatchObject({ kind: "bed", preset: "Super king 190 × 210" });
  });

  it("a word matching the label beats the same word matching a preset, with no preset shown", () => {
    expect(searchPalette("bed")[0]).toMatchObject({ kind: "bed", preset: null, detail: null });
  });

  it("a number no preset of a kind has fails that kind", () => {
    expect(searchPalette("bathtub 999")).toEqual([]);
  });
});

describe("searchPalette: substrings, typos and the full vocabulary (step 04)", () => {
  it("osaDistance counts a changed, missing, extra or swapped character as one", () => {
    expect([osaDistance("coutner", "counter"), osaDistance("chiar", "chair"), osaDistance("wadrobe", "wardrobe"), osaDistance("abc", "abc"), osaDistance("chair", "stair")]).toEqual([1, 1, 1, 0, 2]);
  });

  it("typos from five characters: coutner, chiar, wadrobe", () => {
    expect(kinds("coutner")[0]).toBe("counter");
    expect(kinds("chiar")[0]).toBe("chair");
    expect(kinds("wadrobe")[0]).toBe("wardrobe");
  });

  it("no typo under five characters or on numbers: chair isn't Stair, deck isn't Desk, 106 isn't 160", () => {
    expect(kinds("chair")).not.toContain("stair");
    expect(kinds("deck")).not.toContain("desk");
    expect(searchPalette("160").length).toBeGreaterThan(0);
    expect(searchPalette("106")).toEqual([]);
  });

  it('a word inside a word, from three characters: "bath tub" finds the bathtub', () => {
    expect(kinds("bath tub")[0]).toBe("bathtub");
  });

  it("a typo match never outranks an exact or word-start match", () => {
    const catalogue = [
      { kind: "typo", label: "Shelf", group: "G", aliases: [], presets: [] },
      { kind: "exact", label: "Shell", group: "G", aliases: [], presets: [] },
    ];
    expect(searchPalette("shell", catalogue).map((r) => r.kind)).toEqual(["exact", "typo"]);
  });

  it.each([
    ["refrigerator", "fridge"],
    ["closet", "wardrobe"],
    ["vanity", "vanityUnit"],
    ["bathroom sink", "vanityUnit"],
    ["bedside table", "nightstand"],
    ["spiral staircase", "spiralStair"],
    ["washer", "washingMachine"],
    ["stove", "woodStove"], // its name now; the range and the hob by alias after it
    ["log burner", "woodStove"],
    ["oven range", "range"], // "cooker" finds the Cooker hood by its name first
    ["extractor", "cookerHood"],
    ["larder", "tallPantry"],
    ["mini split", "wallUnit"],
    ["trunk", "storageChest"],
    ["bar stool", "stool"],
  ])("%s finds %s", (query, kind) => {
    expect(kinds(query)[0]).toBe(kind);
  });

  it("an alias equal to the whole query beats one with a word starting with it", () => {
    const catalogue = [
      { kind: "long", label: "Daybed", group: "G", aliases: ["couch bed"], presets: [] },
      { kind: "exact", label: "Lounger", group: "G", aliases: ["couch"], presets: [] },
    ];
    expect(searchPalette("couch", catalogue).map((r) => r.kind)).toEqual(["exact", "long"]);
  });

  it("the aliases are English only (quick-add.20)", () => {
    const italian = ["divano", "frigo", "letto", "armadio", "lavatrice", "scala", "comodino", "lavabo", "vasca", "doccia"];
    const words = Object.values(PALETTE_ALIASES).flatMap((a) => a.flatMap((x) => x.split(" ")));
    expect(words.filter((w) => italian.includes(w))).toEqual([]);
  });

  it("every palette kind with a common other name has aliases", () => {
    for (const kind of ["sofa", "toilet", "fridge", "wardrobe", "washbasin", "hobUnit", "bathtub", "washingMachine", "desk", "chair", "spiralStair"]) {
      expect([kind, (PALETTE_ALIASES[kind] ?? []).length > 0]).toEqual([kind, true]);
    }
  });
});

// The corner desk (catalog.08, AC-09): quick add finds it by its plain other names.
describe("searchPalette: the corner desk", () => {
  it.each(["L desk", "corner desk", "L-shaped desk"])("%s finds the corner desk first", (query) => {
    expect(kinds(query)[0]).toBe("cornerDesk");
  });
});

// The corner wardrobe and counter (catalog.08, AC-09): quick add finds them by name and their plain other names.
describe("searchPalette: the corner wardrobe and counter", () => {
  it.each([
    ["corner wardrobe", "cornerWardrobe"],
    ["corner kitchen", "cornerCounter"],
    ["L kitchen", "cornerCounter"],
    ["corner counter", "cornerCounter"],
  ])("%s finds %s first", (query, kind) => {
    expect(kinds(query)[0]).toBe(kind);
  });
});

// The corner sofa (catalog.08, AC-09): quick add finds it by name and its plain other names.
describe("searchPalette: the corner sofa", () => {
  it.each(["corner sofa", "L sofa", "sectional", "corner couch"])("%s finds the corner sofa first", (query) => {
    expect(kinds(query)[0]).toBe("cornerSofa");
  });

  it('"couch" still finds the sofa first', () => {
    expect(kinds("couch")[0]).toBe("sofa");
  });
});

// The plant, cot, radiator and towel rail (catalog.08, .23, AC-09): quick add finds them by name and plain other names.
describe("searchPalette: the plant, cot, radiator and towel rail", () => {
  it.each([
    ["plant", "plant"],
    ["houseplant", "plant"],
    ["cot", "cot"],
    ["crib", "cot"],
    ["baby bed", "cot"],
    ["radiator", "radiator"],
    ["heater", "radiator"],
    ["towel rail", "towelRail"],
  ])("%s finds %s first", (query, kind) => {
    expect(kinds(query)[0]).toBe(kind);
  });
});

// The rugs (catalog.08, AC-09): by name and by "carpet" and "mat"; "mat" lists the mattress first, a label match.
describe("searchPalette: the rugs", () => {
  it.each([
    ["rug", "rug"],
    ["round rug", "roundRug"],
    ["carpet", "rug"],
    ["mat", "mattress"],
  ])("%s finds %s first", (query, kind) => {
    expect(kinds(query)[0]).toBe(kind);
  });

  it('"carpet" and "mat" list both rugs', () => {
    expect(kinds("carpet")).toEqual(["rug", "roundRug"]);
    expect(kinds("mat")).toEqual(expect.arrayContaining(["rug", "roundRug"]));
  });
});

// The aggregates (spec "Seating: aggregates", filled without asking): quick add finds them by their usual names.
describe("searchPalette: the aggregates", () => {
  it.each([
    ["dining set", "seatedDining"],
    ["table with chairs", "seatedDining"],
    ["desk and chair", "deskSet"],
    ["desk with chair", "deskSet"],
    ["round dining set", "seatedRound"],
    ["round table with chairs", "seatedRound"],
  ])("%s finds %s first", (query, kind) => {
    expect(kinds(query)[0]).toBe(kind);
  });

  it('"table with chairs" also lists the round set; "desk and chair" leaves out the desk alone', () => {
    expect(kinds("table with chairs")).toContain("seatedRound");
    expect(kinds("desk and chair")).not.toContain("desk");
  });
});

describe("quick add finds a preset with a height (catalog.07)", () => {
  it("\"washer dryer\" is the washing machine's Washer-dryer", () => {
    expect(searchPalette("washer dryer")[0]).toMatchObject({ kind: "washingMachine", preset: "Washer-dryer 60 × 60 h 170" });
  });
});
