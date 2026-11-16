import { describe, expect, it } from "vitest";
import { isRecord, parseStoredDocument, unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { SIDE_IDS, defaultSides, withSide } from "../src/kinds";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { deserialize, fillZoneSides, serialize, upgradeStored } from "../src/serialize";
import { fromStored } from "../src/shape-tables";
import { nullZones } from "../src/use-zone";
import { deepFreeze, rectDoc } from "./helpers";

// Use zones by side (smart.08, .14, .16, .23): each placement stores which of its four sides has a use zone, the
// kind gives the defaults, and stored drawings without sides open with them.

const NONE = { front: false, back: false, left: false, right: false };
const FRONT = { ...NONE, front: true };
const LEFT_RIGHT = { ...NONE, left: true, right: true };

const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command) => unwrap(run(doc, cmd));
const placeKind = (doc: Document, opId: string, kind: string, x: number, y: number): Document =>
  ok(doc, { type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y }, linked: false }).doc;

// A 6 × 4 room (inner faces at 0.1 and 5.9 / 3.9); the bed's back edge on the far wall: x 2.2–3.8, y 1.9–3.9.
const withBed = (): Document =>
  ok(placeKind(rectDoc(0, 0, 6, 4), "b", "bed", 3, 3.9), { type: "setObjectSize", objectId: "b/o0", w: 1.6, d: { standard: 2 } }).doc;
/** The bed in s0 (b/p0) and in Night (n/p0, a copy of s0). */
const dayAndNight = (): Document => ok(withBed(), { type: "copyState", opId: "n", from: "s0", name: "Night" }).doc;

describe("zone sides (smart.08)", () => {
  it("withSide turns one side and keeps the others; defaultSides copies", () => {
    expect(withSide(FRONT, "left", true)).toEqual({ front: true, back: false, left: true, right: false });
    expect(withSide(FRONT, "front", false)).toEqual(NONE);
    const a = defaultSides("bed");
    const b = defaultSides("bed");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(defaultSides("piano")).toBeNull();
  });

  it("placeObject writes the kind's default sides, for a new and an existing object (AC-05)", () => {
    const doc = withBed();
    expect(doc.placements["b/p0"]?.sides).toEqual(LEFT_RIGHT);
    const n = ok(doc, { type: "addState", opId: "n", name: "Night" }).doc;
    const again = ok(n, { type: "placeObject", deck: null, opId: "x", state: "n/s0", object: { existing: "b/o0" }, at: { x: 3, y: 3.9 } }).doc;
    expect(again.placements["x/p0"]?.sides).toEqual(LEFT_RIGHT);
    expect(placeKind(rectDoc(0, 0, 6, 4), "d", "desk", 3, 3.9).placements["d/p0"]?.sides).toEqual(FRONT);
    expect(placeKind(rectDoc(0, 0, 6, 4), "c", "chair", 3, 3.9).placements["c/p0"]?.sides).toEqual(NONE);
  });

  it("setZoneSides changes one layout only and depends on its placement (AC-05, a layout pair where only one has a side on)", () => {
    const doc = dayAndNight();
    const r = ok(doc, { type: "setZoneSides", placementId: "b/p0", sides: { ...LEFT_RIGHT, front: true } });
    expect(r.doc.placements["b/p0"]?.sides).toEqual({ front: true, back: false, left: true, right: true });
    expect(r.doc.placements["n/p0"]?.sides).toEqual(LEFT_RIGHT);
    expect(r.patch.dependencies).toEqual([
      { table: "objects", id: "b/o0" },
      { table: "placements", id: "b/p0" },
      { table: "states", id: "s0" },
    ]);
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["placements/b/p0"]);
    expect(r.patch.deletes).toEqual([]);
  });

  it("setZoneSides with the same sides is an empty patch; a missing placement is notFound; bad sides are invalidInput", () => {
    const doc = dayAndNight();
    const same = ok(doc, { type: "setZoneSides", placementId: "b/p0", sides: { ...LEFT_RIGHT } });
    expect(same.doc).toBe(doc);
    expect([same.patch.puts, same.patch.deletes]).toEqual([[], []]);
    expect(same.patch.dependencies).toHaveLength(3);
    expect(run(doc, { type: "setZoneSides", placementId: "nope", sides: FRONT })).toMatchObject({
      ok: false, error: { kind: "notFound", message: "Placement not found" },
    });
    // MCP and the editor build commands from JSON: the shape is checked, not trusted.
    const bad: Command[] = [
      JSON.parse('{"type":"setZoneSides","placementId":"b/p0","sides":{"front":true,"back":false,"left":"no","right":true}}'),
      JSON.parse('{"type":"setZoneSides","placementId":"b/p0","sides":{"front":true,"back":false,"left":true}}'),
      JSON.parse('{"type":"setZoneSides","placementId":"b/p0","sides":{"front":true,"back":false,"left":true,"right":true,"up":true}}'),
      JSON.parse('{"type":"setZoneSides","placementId":"b/p0","sides":[true,false,true,true]}'),
      JSON.parse('{"type":"setZoneSides","placementId":"b/p0"}'),
    ];
    for (const cmd of bad) expect(run(doc, cmd)).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Invalid sides" } });
  });

  it("setZoneSides flipping any one side alone changes the placement (AC-05: a bed's left off by a wall)", () => {
    const doc = dayAndNight();
    for (const s of SIDE_IDS) {
      const sides = withSide(LEFT_RIGHT, s, !LEFT_RIGHT[s]);
      const r = ok(doc, { type: "setZoneSides", placementId: "b/p0", sides });
      expect(r.doc.placements["b/p0"]?.sides).toEqual(sides);
      expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["placements/b/p0"]);
    }
  });

  it("the inverse patch of setZoneSides restores the document", () => {
    const doc = deepFreeze(dayAndNight());
    const r = ok(doc, { type: "setZoneSides", placementId: "b/p0", sides: { ...NONE, back: true } });
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
  });
});

/**
 * A version 4 file saved before this cycle (no placement has sides), in the 6 × 4 room: a bed (b1), a desk, a
 * chair and a wardrobe, plus a second bed (b2) whose placement already has sides (front only, not its default).
 */
function preCycleFile(): Record<string, unknown> {
  const room = serialize(rectDoc(0, 0, 6, 4));
  const at = (x: number, y: number, rotation = 0) => ({ at: { x, y }, rotation, config: "standard" });
  return {
    ...room,
    objects: {
      b1: { id: "b1", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 } },
      b2: { id: "b2", kind: "bed", name: "Guest bed", w: { standard: 1.6 }, d: { standard: 2 } },
      c: { id: "c", kind: "chair", name: "Chair", w: { standard: 0.45 }, d: { standard: 0.45 } },
      d: { id: "d", kind: "desk", name: "Desk", w: { standard: 1.2 }, d: { standard: 0.6 } },
      w: { id: "w", kind: "wardrobe", name: "Wardrobe", w: { standard: 1.2 }, d: { standard: 0.6 } },
    },
    placements: {
      "b1/s0": { id: "b1/s0", object: "b1", state: "s0", ...at(1, 3.9) }, // x 0.2–1.8, y 1.9–3.9
      "b2/s0": { id: "b2/s0", object: "b2", state: "s0", ...at(3, 3.9), sides: FRONT }, // x 2.2–3.8
      "c/s0": { id: "c/s0", object: "c", state: "s0", ...at(5, 1) }, // x 4.775–5.225, y 0.55–1
      "d/s0": { id: "d/s0", object: "d", state: "s0", ...at(5, 3.9) }, // x 4.4–5.6, y 3.3–3.9
      "w/s0": { id: "w/s0", object: "w", state: "s0", ...at(1, 0.1, 180) }, // x 0.4–1.6, y 0.1–0.7
    },
  };
}

describe("the fill step for stored drawings (smart.14, AC-11)", () => {
  it("fillZoneSides gives old placements their kind's sides and leaves the rest (AC-11)", () => {
    const r = deserialize(preCycleFile());
    if (!r.ok) throw new Error(r.error.message);
    const sides = Object.fromEntries(Object.values(r.value.placements).map((p) => [p.id, p.sides]));
    expect(sides).toEqual({ "b1/s0": LEFT_RIGHT, "b2/s0": FRONT, "c/s0": NONE, "d/s0": FRONT, "w/s0": FRONT });
    expect(deserialize(JSON.parse(JSON.stringify(serialize(r.value))))).toEqual(r);
  });

  it("upgradeStored fills sides and is idempotent", () => {
    const old = parseStoredDocument(preCycleFile());
    if (!old) throw new Error("unparseable");
    expect(fromStored(old).ok).toBe(false);
    const upgraded = upgradeStored(old);
    expect(upgraded.placements["b1/s0"]?.sides).toEqual(LEFT_RIGHT);
    expect(upgraded.placements["b2/s0"]?.sides).toEqual(FRONT);
    expect(upgraded.placements["c/s0"]?.sides).toEqual(NONE);
    expect(upgraded.placements["d/s0"]?.sides).toEqual(FRONT);
    expect(upgradeStored(upgraded)).toEqual(upgraded);
    expect(fromStored(upgraded).ok).toBe(true);
  });

  it("fillZoneSides leaves a placement whose object is missing or of an unknown kind, and never reads an inherited key", () => {
    // JSON.parse makes "__proto__" an own key of placements; objects has no "__proto__" of its own.
    const json: Record<string, unknown> = JSON.parse(
      '{"objects":{"o9":{"id":"o9","kind":"piano","name":"Piano","w":{"standard":1},"d":{"standard":1}}},' +
        '"placements":{"p1":{"id":"p1","object":"__proto__","state":"s0","at":{"x":1,"y":1},"rotation":0,"config":"standard"},' +
        '"p2":{"id":"p2","object":"nope","state":"s0","at":{"x":1,"y":1},"rotation":0,"config":"standard"},' +
        '"p3":{"id":"p3","object":"o9","state":"s0","at":{"x":1,"y":1},"rotation":0,"config":"standard"},' +
        '"p4":{"id":"p4","object":"toString","state":"s0","at":{"x":1,"y":1},"rotation":0,"config":"standard"}}}',
    );
    expect(fillZoneSides(json)).toEqual(json);
    // A placement keyed "__proto__" stays an own key (an assignment would set the prototype and drop it).
    const keyed: Record<string, unknown> = JSON.parse(
      '{"objects":{"b":{"id":"b","kind":"bed"}},"placements":{"__proto__":{"id":"__proto__","object":"b","state":"s0"}}}',
    );
    const out = fillZoneSides(keyed).placements;
    expect(isRecord(out) && Object.hasOwn(out, "__proto__") ? Object.getOwnPropertyDescriptor(out, "__proto__")?.value : null).toEqual({
      id: "__proto__", object: "b", state: "s0", sides: LEFT_RIGHT, zones: nullZones(),
    });
    // An objects table that inherits a real bed: the placement's object is not the table's own, so nothing is filled.
    const inherited = { id: "p", object: "o1", state: "s0" };
    const viaProto = fillZoneSides({ objects: Object.create({ o1: { id: "o1", kind: "bed" } }), placements: { p: inherited } });
    expect(isRecord(viaProto.placements) ? viaProto.placements["p"] : null).toEqual(inherited);
    expect(fillZoneSides({ placements: 3 })).toEqual({ placements: 3 });
    expect(fillZoneSides({})).toEqual({});
    expect(deserialize({ ...preCycleFile(), placements: json.placements })).toMatchObject({ ok: false, error: { kind: "format" } });
  });
  it("fillZoneSides adds zones only to placements that end with sides, and never overwrites stored zones (furnish.21)", () => {
    const filled = fillZoneSides(preCycleFile()).placements;
    const rows = isRecord(filled) ? Object.values(filled) : [];
    expect(rows).toHaveLength(5);
    for (const p of rows) expect(isRecord(p) ? p.zones : null).toEqual(nullZones()); // b2/s0 had sides but no zones
    const zones = { ...nullZones(), frontDepth: 0.5, frontStart: 0.1, frontEnd: 0.2 };
    const p = { id: "p", object: "b", state: "s0", sides: FRONT, zones };
    const json = { objects: { b: { id: "b", kind: "bed" } }, placements: { p } };
    expect(fillZoneSides(json)).toEqual(json);
    expect(fillZoneSides(fillZoneSides(json))).toEqual(json);
    // A row with zones but no sides gets its sides, and keeps its zones.
    const noSides = { id: "q", object: "b", state: "s0", zones };
    const out = fillZoneSides({ objects: { b: { id: "b", kind: "bed" } }, placements: { q: noSides } }).placements;
    expect(isRecord(out) ? out.q : null).toEqual({ ...noSides, sides: LEFT_RIGHT });
  });

  it("a placement stored before this cycle loads with the default zones (AC-21 load)", () => {
    const doc = ok(placeKind(placeKind(rectDoc(0, 0, 6, 4), "b", "bed", 3, 3.9), "d", "desk", 5, 3.9), { type: "setObjectSize", objectId: "b/o0", w: 1.6, d: { standard: 2 } }).doc;
    const json: Record<string, unknown> = JSON.parse(JSON.stringify(serialize(doc)));
    const placements = json.placements;
    if (!isRecord(placements)) throw new Error("no placements");
    expect(Object.keys(placements)).toHaveLength(2);
    for (const p of Object.values(placements)) if (isRecord(p)) delete p.zones;
    expect(Object.values(placements).every((p) => isRecord(p) && !Object.hasOwn(p, "zones"))).toBe(true);
    const r = deserialize(json);
    if (!r.ok) throw new Error(r.error.message);
    for (const p of Object.values(r.value.placements)) expect(p.zones).toEqual(nullZones());
    expect(serialize(r.value).version).toBe(4);
    const old = parseStoredDocument(json);
    if (!old) throw new Error("unparseable");
    expect(fromStored(old).ok).toBe(false);
    const upgraded = upgradeStored(old);
    for (const p of Object.values(upgraded.placements)) expect(isRecord(p) ? p.zones : null).toEqual(nullZones());
    expect(fromStored(upgraded).ok).toBe(true);
    expect(upgradeStored(upgraded)).toEqual(upgraded);
  });
});
