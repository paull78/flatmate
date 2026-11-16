import { describe, expect, it } from "vitest";
import { isRecord, parseStoredDocument, unwrap } from "@fm/protocol";
import { CURRENT_VERSION, MIGRATIONS, deserialize, fillOnLoad, migrateJson, serialize, upgradeStored } from "../src/serialize";
import { fromStored } from "../src/shape-tables";
import { nullZones } from "../src/use-zone";
import { emptyDocument, type Document, type Wall, sameGuards } from "../src/model";
import { docOf, rectDoc, wallRow } from "./helpers";

describe("serialize / deserialize", () => {
  it("round-trips a document as the current version", () => {
    const doc = { ...rectDoc(0, 0, 6, 4), zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name: "Hall", finish: null } } };
    const json = serialize(doc);
    expect(json.format).toBe("flatmate");
    expect(json.version).toBe(4);
    expect(deserialize(JSON.parse(JSON.stringify(json)))).toEqual({ ok: true, value: doc });
  });

  it("rejects other formats, unknown and newer versions with readable errors", () => {
    expect(deserialize({ format: "dwg" })).toMatchObject({ ok: false, error: { kind: "format", message: "Not a Flatmate drawing" } });
    expect(deserialize({ format: "flatmate", version: 0 })).toMatchObject({ ok: false, error: { message: "Unknown file version" } });
    const newer = deserialize({ format: "flatmate", version: CURRENT_VERSION + 1, joints: {}, walls: {}, zoneLabels: {} });
    expect(newer).toMatchObject({ ok: false, error: { kind: "format" } });
    expect(newer.ok ? "" : newer.error.message).toContain("newer");
  });

  it("rejects malformed and invalid content", () => {
    expect(deserialize({ format: "flatmate", version: 1, joints: [], walls: {}, zoneLabels: {} })).toMatchObject({ ok: false });
    const invalid = serialize(docOf({ joints: [["A", 0, 0], ["B", 0.001, 0]], walls: [["W", "A", "B"]] }));
    expect(deserialize(invalid)).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("writes the current version for every document, whatever it holds (sheet.31)", () => {
    expect(serialize(emptyDocument()).version).toBe(CURRENT_VERSION);
  });

  it("opens a version 2 file with one state s0 \"Layout\", no objects, placements or openings, and saves it as the current version (AC-12)", () => {
    const v2 = {
      format: "flatmate", version: 2,
      joints: { A: { id: "A", x: 0, y: 0 }, B: { id: "B", x: 4, y: 0 } },
      walls: { W: { id: "W", a: "A", b: "B", thickness: 0.3 } },
      zoneLabels: {},
    };
    const r = deserialize(v2);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.states).toEqual({ s0: { id: "s0", name: "Layout", order: 0 } });
    expect([r.value.objects, r.value.placements, r.value.openings]).toEqual([{}, {}, {}]);
    expect(r.value.walls.W?.thickness).toBe(0.3);
    const saved = serialize(r.value);
    expect(saved.version).toBe(4);
    expect(saved.states).toEqual({ s0: { id: "s0", name: "Layout", order: 0 } });
  });

  it("migrates a version 1 file: every wall gets thickness 0.20 and it saves as the current version (AC-23)", () => {
    const v1 = {
      format: "flatmate", version: 1,
      joints: { A: { id: "A", x: 0, y: 0 }, B: { id: "B", x: 4, y: 0 }, C: { id: "C", x: 4, y: 5 }, D: { id: "D", x: 0, y: 5 } },
      walls: { W1: { id: "W1", a: "A", b: "B" }, W2: { id: "W2", a: "B", b: "C" }, W3: { id: "W3", a: "C", b: "D" }, W4: { id: "W4", a: "D", b: "A" } },
      zoneLabels: {},
    };
    const r = deserialize(v1);
    if (!r.ok) throw new Error(r.error.message);
    expect(Object.values(r.value.walls).map((w) => w.thickness)).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(Object.keys(r.value.states)).toEqual(["s0"]); // both migrations ran
    expect(serialize(r.value).version).toBe(4);
  });

  it("refuses version 5 with the supported version in the message", () => {
    const r = deserialize({ format: "flatmate", version: 5, joints: {}, walls: {}, zoneLabels: {} });
    expect(r.ok ? "" : r.error.message).toContain("supported 4");
  });

  it("the shipped migrations are idempotent: a wall that has a thickness keeps it (layout-states.32)", () => {
    const json = { walls: { W1: { id: "W1", a: "A", b: "B", thickness: 0.3 }, W2: { id: "W2", a: "B", b: "C" } } };
    let once: Record<string, unknown> = json;
    for (const m of MIGRATIONS) once = m.migrate(once);
    let twice = once;
    for (const m of MIGRATIONS) twice = m.migrate(twice);
    expect(twice).toEqual(once);
    expect(once).toEqual({
      walls: { W1: { id: "W1", a: "A", b: "B", thickness: 0.3 }, W2: { id: "W2", a: "B", b: "C", thickness: 0.2 } },
      states: { s0: { id: "s0", name: "Layout", order: 0 } }, objects: {}, placements: {}, openings: {}, projectFields: {},
    });
    expect(MIGRATIONS.map((m) => m.migrate({ walls: "broken" }).walls)).toEqual(["broken", "broken", "broken"]);
  });

  it("the 2 → 3 migration adds the Layout state only when states is missing or empty, and keeps other tables", () => {
    const m = MIGRATIONS.find((x) => x.from === 2);
    if (!m) throw new Error("no migration from 2");
    const night = { n: { id: "n", name: "Night", order: 0 } };
    expect(m.migrate({ states: night, objects: { o: 1 } })).toEqual({ states: night, objects: { o: 1 }, placements: {}, openings: {} });
    expect(m.migrate({ states: {} }).states).toEqual({ s0: { id: "s0", name: "Layout", order: 0 } });
  });

  it("upgradeStored brings an unversioned stored document to the current shape (server data, layout-states.32)", () => {
    const stored = {
      joints: { A: { id: "A", x: 0, y: 0 }, B: { id: "B", x: 1, y: 0 } },
      walls: { W: { id: "W", a: "A", b: "B" } },
      zoneLabels: {},
    };
    // As the server reads an old project file: missing tables are empty (layout-states.39).
    const old = parseStoredDocument(stored, "empty");
    if (!old) throw new Error("unparseable");
    expect(upgradeStored(old)).toEqual({
      ...stored,
      walls: { W: { id: "W", a: "A", b: "B", thickness: 0.2, top: "ceiling", base: "floor", column: false } },
      states: { s0: { id: "s0", name: "Layout", order: 0 } }, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {}, underlays: {}, logos: {}, ceilings: {}, decks: {}, deckHoles: {}, sheets: {}, sections: {}, areas: {},
    });
    const current = upgradeStored(old);
    expect(upgradeStored(current)).toEqual(current);
  });

  it("an old document's labels load with finish null (finishes.24)", () => {
    const old = {
      format: "flatmate", version: 1,
      joints: { A: { id: "A", x: 0, y: 0 }, B: { id: "B", x: 4, y: 0 }, C: { id: "C", x: 4, y: 3 }, D: { id: "D", x: 0, y: 3 } },
      walls: { W1: { id: "W1", a: "A", b: "B" }, W2: { id: "W2", a: "B", b: "C" }, W3: { id: "W3", a: "C", b: "D" }, W4: { id: "W4", a: "D", b: "A" } },
      zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name: "Hall" } },
    };
    const doc = unwrap(deserialize(old));
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1, y: 1 }, name: "Hall", finish: null } });
    const stored = parseStoredDocument({ joints: old.joints, walls: old.walls, zoneLabels: old.zoneLabels }, "empty");
    if (!stored) throw new Error("unparseable");
    expect(unwrap(fromStored(upgradeStored(stored))).zoneLabels.L1?.finish).toBeNull();
  });

  it("a stored wall without base or column loads as floor, not a column (pillars)", () => {
    const tables = {
      joints: { A: { id: "A", x: 0, y: 0 }, B: { id: "B", x: 1, y: 0 }, C: { id: "C", x: 3, y: 0 }, D: { id: "D", x: 3.3, y: 0 } },
      walls: { W: { id: "W", a: "A", b: "B", thickness: 0.2, top: "ceiling" }, K: { id: "K", a: "C", b: "D", thickness: 0.3, top: "ceiling", base: "floor", column: true } },
      zoneLabels: {}, states: { s0: { id: "s0", name: "Layout", order: 0 } }, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {}, underlays: {},
    };
    const doc = unwrap(deserialize({ format: "flatmate", version: 4, ...tables }));
    expect(doc.walls.W).toEqual({ id: "W", a: "A", b: "B", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(doc.walls.K?.column).toBe(true); // a stored value is never replaced
    const stored = parseStoredDocument(tables, "empty");
    if (!stored) throw new Error("unparseable");
    expect(fromStored(upgradeStored(stored))).toMatchObject({ ok: true, value: { walls: { W: { base: "floor", column: false } } } });
    expect(fillOnLoad(fillOnLoad(tables))).toEqual(fillOnLoad(tables));
  });

  it("rejects IDs that name Object.prototype members", () => {
    const inherited = { format: "flatmate", version: 1, joints: { J1: { id: "J1", x: 0, y: 0 } }, walls: { W: { id: "W", a: "constructor", b: "J1" } }, zoneLabels: {} };
    expect(deserialize(inherited)).toMatchObject({ ok: false, error: { kind: "format" } });
    // JSON.parse makes "__proto__" an own key; an object literal would set the prototype instead.
    const proto: unknown = JSON.parse(
      '{"format":"flatmate","version":1,"joints":{"A":{"id":"A","x":0,"y":0},"B":{"id":"B","x":1,"y":0},' +
        '"__proto__":{"id":"__proto__","x":5,"y":5}},"walls":{"W":{"id":"W","a":"A","b":"B"}},"zoneLabels":{}}',
    );
    expect(deserialize(proto)).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("the thickness migration keeps a wall keyed __proto__ as an own key, so the file is refused, not loaded without it (cleanup.12, AC-19)", () => {
    const json: Record<string, unknown> = JSON.parse(
      '{"format":"flatmate","version":1,"joints":{"A":{"id":"A","x":0,"y":0},"B":{"id":"B","x":1,"y":0}},' +
        '"walls":{"__proto__":{"id":"__proto__","a":"A","b":"B"},"W":{"id":"W","a":"A","b":"B"}},"zoneLabels":{}}',
    );
    const migrate = MIGRATIONS.find((m) => m.from === 1)?.migrate;
    const walls = migrate?.(json).walls;
    expect(isRecord(walls) && Object.hasOwn(walls, "__proto__")).toBe(true);
    expect(isRecord(walls) ? Object.getPrototypeOf(walls) : null).toBe(Object.prototype);
    expect(deserialize(json)).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("drops unknown top-level fields and rejects unknown entity fields", () => {
    const json = { format: "flatmate", version: 1, extra: 1, joints: { A: { id: "A", x: 0, y: 0 }, B: { id: "B", x: 1, y: 0 } }, walls: { W: { id: "W", a: "A", b: "B" } }, zoneLabels: {} };
    expect(deserialize(json)).toEqual({ ok: true, value: docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] }) });
    const withEntityField = { ...json, joints: { ...json.joints, A: { id: "A", x: 0, y: 0, z: 9 } } };
    expect(deserialize(withEntityField)).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid joints entry A" } });
  });

  it("applies version-gated JSON migrations in order", () => {
    const migrations = [
      { from: 1, migrate: (j: Record<string, unknown>) => ({ ...j, step1: true }) },
      { from: 2, migrate: (j: Record<string, unknown>) => ({ ...j, step2: true }) },
    ];
    expect(migrateJson({ v: 1 }, 1, 3, migrations)).toEqual({ ok: true, value: { v: 1, step1: true, step2: true } });
    expect(migrateJson({}, 1, 3, [])).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("the shipped migration list is read-only (type test; checked by pnpm typecheck)", () => {
    const mutate = (): void => {
      // @ts-expect-error MIGRATIONS is read-only
      MIGRATIONS.push({ from: 1, migrate: (j: Record<string, unknown>) => j });
    };
    expect(mutate).toBeTypeOf("function");
    expect(migrateJson({ v: 1 }, 1, 1, MIGRATIONS)).toEqual({ ok: true, value: { v: 1 } });
    expect(CURRENT_VERSION).toBe(4);
  });
});

// Heights (heights.09, .10, .28, .37): drawings saved before the cycle load with their kinds' heights, walls to the
// ceiling and no ceiling row, through both load paths, with no migration and version 4.
describe("heights on load", () => {
  const FRONT = { front: true, back: false, left: false, right: false };
  const LEFT_RIGHT = { front: false, back: false, left: true, right: true };
  const placement = (id: string, object: string, x: number, y: number, config: string, sides: typeof FRONT) => ({
    id, object, state: "s0", at: { x, y }, rotation: 0, config, sides, zones: nullZones(),
  });
  /** A version 4 file from before the cycle: no top, h, z or ceilings anywhere. */
  function preCycleFile() {
    return {
      format: "flatmate", version: 4,
      joints: { J1: { id: "J1", x: 0, y: 0 }, J2: { id: "J2", x: 6, y: 0 }, J3: { id: "J3", x: 6, y: 4 }, J4: { id: "J4", x: 0, y: 4 } },
      walls: {
        W1: { id: "W1", a: "J1", b: "J2", thickness: 0.2, top: "ceiling" }, W2: { id: "W2", a: "J2", b: "J3", thickness: 0.2, top: "ceiling" },
        W3: { id: "W3", a: "J3", b: "J4", thickness: 0.2, top: "ceiling" }, W4: { id: "W4", a: "J4", b: "J1", thickness: 0.2, top: "ceiling" },
      },
      zoneLabels: {},
      states: { s0: { id: "s0", name: "Layout", order: 0 } },
      objects: {
        bed: { id: "bed", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 } },
        sb: { id: "sb", kind: "sofaBed", name: "Sofa bed", w: { sofa: 2, bed: 2 }, d: { sofa: 0.9, bed: 1.6 } },
      },
      placements: { "bed/s0": placement("bed/s0", "bed", 1.5, 3.9, "standard", LEFT_RIGHT), "sb/s0": placement("sb/s0", "sb", 4.5, 3.9, "sofa", FRONT) },
      openings: {}, dimensions: {}, projectFields: {}, underlays: {},
    };
  }
  const wall = (id: string, a: string, b: string): Wall => wallRow(id, a, b);
  const expected: Document = {
    joints: { J1: { id: "J1", x: 0, y: 0 }, J2: { id: "J2", x: 6, y: 0 }, J3: { id: "J3", x: 6, y: 4 }, J4: { id: "J4", x: 0, y: 4 } },
    walls: { W1: wall("W1", "J1", "J2"), W2: wall("W2", "J2", "J3"), W3: wall("W3", "J3", "J4"), W4: wall("W4", "J4", "J1") },
    zoneLabels: {},
    states: { s0: { id: "s0", name: "Layout", order: 0 } },
    objects: {
      bed: { id: "bed", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 }, h: { standard: 1 }, z: { standard: 0 } },
      sb: { id: "sb", kind: "sofaBed", name: "Sofa bed", w: { sofa: 2, bed: 2 }, d: { sofa: 0.9, bed: 1.6 }, h: { sofa: 0.9, bed: 0.9 }, z: { sofa: 0, bed: 0 } },
    },
    placements: {
      "bed/s0": { ...placement("bed/s0", "bed", 1.5, 3.9, "standard", LEFT_RIGHT), deck: null },
      "sb/s0": { ...placement("sb/s0", "sb", 4.5, 3.9, "sofa", FRONT), deck: null },
    },
    openings: {}, dimensions: {}, projectFields: {}, underlays: {}, logos: {}, ceilings: {}, decks: {}, deckHoles: {}, sheets: {}, sections: {}, areas: {},
  };

  it("a pre-cycle drawing loads with kind heights, ceiling tops and no ceiling row", () => {
    expect(deserialize(preCycleFile())).toEqual({ ok: true, value: expected });
    // As the server reads it: missing tables empty, then every migration and fill step (layout-states.32).
    const stored = parseStoredDocument(preCycleFile(), "empty");
    if (!stored) throw new Error("unparseable");
    expect(fromStored(upgradeStored(stored))).toEqual({ ok: true, value: expected });
    expect(serialize(expected).version).toBe(4);
  });

  it("fillOnLoad is idempotent", () => {
    const once = fillOnLoad(preCycleFile());
    expect(fillOnLoad(once)).toEqual(once);
    const stored = parseStoredDocument(preCycleFile(), "empty");
    if (!stored) throw new Error("unparseable");
    const upgraded = upgradeStored(stored);
    expect(upgradeStored(upgraded)).toEqual(upgraded);
  });

  it("a stored height survives a round trip and is not overwritten by the default", () => {
    const file = preCycleFile();
    const objects = { ...file.objects, wr: { id: "wr", kind: "wardrobe", name: "Wardrobe", w: { standard: 1.2 }, d: { standard: 0.6 }, h: { standard: 2.36 } } };
    const placements = { ...file.placements, "wr/s0": placement("wr/s0", "wr", 3, 0.7, "standard", FRONT) };
    const walls = { ...file.walls, W1: { id: "W1", a: "J1", b: "J2", thickness: 0.2, top: 1.1 } };
    const doc = unwrap(deserialize({ ...file, objects, placements, walls }));
    expect(doc.objects.wr).toMatchObject({ h: { standard: 2.36 }, z: { standard: 0 } });
    expect(doc.walls.W1?.top).toBe(1.1);
    expect(doc.walls.W2?.top).toBe("ceiling");
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))))).toEqual(doc);
  });

  it("a ceiling row round-trips, and a missing ceilings table reads as empty", () => {
    const withRow = { ...preCycleFile(), ceilings: { ceiling: { id: "ceiling", height: 2.2 } } };
    const doc = unwrap(deserialize(withRow));
    expect(doc.ceilings).toEqual({ ceiling: { id: "ceiling", height: 2.2 } });
    expect(serialize(doc).ceilings).toEqual({ ceiling: { id: "ceiling", height: 2.2 } });
  });
});

// Decks (decks.03, .04): drawings saved before the cycle load with no decks and every placement on the floor,
// through both load paths, with no migration and version 4.
describe("decks on load", () => {
  const SIDES = { front: false, back: false, left: true, right: true };
  const wall = (id: string, a: string, b: string) => ({ id, a, b, thickness: 0.2, top: "ceiling" });
  /** The tables of a version 4 file from before the cycle: no decks table and no placement's deck. */
  function preCycleTables() {
    return {
      joints: { J1: { id: "J1", x: 0, y: 0 }, J2: { id: "J2", x: 6, y: 0 }, J3: { id: "J3", x: 6, y: 4 }, J4: { id: "J4", x: 0, y: 4 } },
      walls: { W1: wall("W1", "J1", "J2"), W2: wall("W2", "J2", "J3"), W3: wall("W3", "J3", "J4"), W4: wall("W4", "J4", "J1") },
      zoneLabels: {},
      states: { s0: { id: "s0", name: "Day", order: 0 }, s1: { id: "s1", name: "Night", order: 1 } },
      objects: { bed: { id: "bed", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 }, h: { standard: 1 }, z: { standard: 0 } } },
      placements: {
        "bed/s0": { id: "bed/s0", object: "bed", state: "s0", at: { x: 1.5, y: 3.9 }, rotation: 0, config: "standard", sides: SIDES, zones: nullZones() },
        "bed/s1": { id: "bed/s1", object: "bed", state: "s1", at: { x: 4.5, y: 3.9 }, rotation: 0, config: "standard", sides: SIDES, zones: nullZones() },
      },
      openings: {}, dimensions: {}, projectFields: {}, underlays: {}, ceilings: {},
    };
  }
  const preCycleFile = () => ({ format: "flatmate", version: 4, ...preCycleTables() });

  it("a pre-cycle document loads with no decks and every placement on the floor", () => {
    const file = preCycleFile();
    const onFloor = Object.fromEntries(Object.entries(file.placements).map(([id, p]) => [id, { ...p, deck: null }]));
    const floorWalls = Object.fromEntries(Object.entries(file.walls).map(([id, w]) => [id, { ...w, base: "floor", column: false }]));
    const expected = { ...preCycleTables(), logos: {}, decks: {}, deckHoles: {}, sheets: {}, sections: {}, areas: {}, placements: onFloor, walls: floorWalls };
    expect(deserialize(file)).toEqual({ ok: true, value: expected });
    // As the server reads it: missing tables empty, then every migration and fill step (layout-states.32).
    const stored = parseStoredDocument(file, "empty");
    if (!stored) throw new Error("unparseable");
    expect(fromStored(upgradeStored(stored))).toEqual({ ok: true, value: expected });
    expect(serialize(unwrap(deserialize(file))).version).toBe(4);
  });

  it("fillOnLoad is idempotent and never replaces a stored deck", () => {
    const once = fillOnLoad(preCycleFile());
    expect(fillOnLoad(once)).toEqual(once);
    const file = preCycleFile();
    const onPlatform = { ...file.placements["bed/s1"], deck: "stage/k0" };
    const filled = fillOnLoad({ ...file, placements: { ...file.placements, "bed/s1": onPlatform } });
    expect(filled.placements).toEqual({ "bed/s0": { ...file.placements["bed/s0"], deck: null }, "bed/s1": onPlatform });
  });

  it("a deck row and a placement on it round-trip", () => {
    // Flush with the inner faces of W2 and W3, holding the Night bed (3.7–5.3 × 1.9–3.9).
    const platform = { id: "stage/k0", name: "Platform", at: { x: 4.5, y: 2.9 }, w: 2.8, d: 2, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") };
    const file = preCycleFile();
    const withDeck = { ...file, decks: { [platform.id]: platform }, placements: { ...file.placements, "bed/s1": { ...file.placements["bed/s1"], deck: platform.id } } };
    const doc = unwrap(deserialize(withDeck));
    expect(doc.decks).toEqual({ [platform.id]: platform });
    expect(doc.placements["bed/s1"]?.deck).toBe(platform.id);
    expect(serialize(doc).decks).toEqual({ [platform.id]: platform });
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))))).toEqual(doc);
  });
});

// Deck holes (stairwell.03, .14, .20): drawings saved before the cycle load with an empty table; a hole round-trips.
describe("deck holes on load", () => {
  const wall = (id: string, a: string, b: string) => ({ id, a, b, thickness: 0.2, top: "ceiling", base: "floor", column: false });
  const loft = { id: "loft/k0", name: "Loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, rotation: 0, top: 2.15, solid: false, finish: null, ...sameGuards("railing") };
  const hole = { id: "h/h0", deck: "loft/k0", at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65, guard: { kind: "railing" as const, height: 1 } };
  const file = () => ({
    format: "flatmate", version: 4,
    joints: { J1: { id: "J1", x: 0, y: 0 }, J2: { id: "J2", x: 4, y: 0 }, J3: { id: "J3", x: 4, y: 3 }, J4: { id: "J4", x: 0, y: 3 } },
    walls: { W1: wall("W1", "J1", "J2"), W2: wall("W2", "J2", "J3"), W3: wall("W3", "J3", "J4"), W4: wall("W4", "J4", "J1") },
    zoneLabels: {}, decks: { [loft.id]: loft },
    states: { s0: { id: "s0", name: "Layout", order: 0 } }, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {}, underlays: {}, ceilings: {},
  });

  it("a drawing saved before deckHoles loads with an empty table, through both load paths", () => {
    expect(unwrap(deserialize(file())).deckHoles).toEqual({});
    const stored = parseStoredDocument(file(), "empty");
    if (!stored) throw new Error("unparseable");
    expect(unwrap(fromStored(upgradeStored(stored))).deckHoles).toEqual({});
  });

  it("a deck hole round-trips", () => {
    const doc = unwrap(deserialize({ ...file(), deckHoles: { [hole.id]: hole } }));
    expect(doc.deckHoles).toEqual({ [hole.id]: hole });
    expect(serialize(doc).deckHoles).toEqual({ [hole.id]: hole });
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))))).toEqual(doc);
  });
});
