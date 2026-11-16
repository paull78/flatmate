import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { setObjectKind } from "../src/commands/objects";
import type { Command } from "../src/commands/types";
import { defaultSize, type Sides } from "../src/kinds";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { clearanceWarnings } from "../src/queries/clearance";
import { useZones } from "../src/queries/footprints";
import { nullZones } from "../src/use-zone";
import { place, rectDoc, withStoredZone } from "./helpers";

// Built-in units (smart.02, .03, .04, .21; spec: layouts): the built-in table, desk and Murphy bed are one family that
// shares the configurations folded ("Closed") and down ("Open"); the Kind switch keeps their sides.

// A 6 × 5 room (inner faces at 0.1 and 5.9 / 4.9) with a Night state.
const room = (): Document => {
  const doc = rectDoc(0, 0, 6, 5);
  return { ...doc, states: { ...doc.states, night: { id: "night", name: "Night", order: 1 } } };
};
const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command) => unwrap(run(doc, cmd));
const r9 = (v: number): number => +v.toFixed(9) + 0;

// A 2.40 m table unit named "Kitchen hideaway", closed in Layout and open in Night (x 1.8–4.2, y 3.75–4.9), with a
// chair in Night at y 3.15–3.6, inside the open unit's front zone.
const hideaway = (): Document => {
  const size = { w: { folded: 2.4, down: 2.4 }, d: { folded: 0.35, down: 1.15 } };
  let doc = place(room(), { object: "u", kind: "builtInTable", at: [3, 4.9], config: "folded", size });
  doc = place(doc, { object: "u", kind: "builtInTable", at: [3, 4.9], state: "night", config: "down" });
  doc = place(doc, { object: "c", kind: "chair", at: [3, 3.6], state: "night" });
  const u = doc.objects.u;
  if (!u) throw new Error("no unit");
  return { ...doc, objects: { ...doc.objects, u: { ...u, name: "Kitchen hideaway" } } };
};

describe("built-in units (AC-01, AC-02)", () => {
  it("a table unit is 1.20 × 0.35 closed and 1.20 × 1.15 open; open, it refuses a sofa 0.50 m from the cabinet front, closed it does not; at 1.00 m the sofa fits open and the table's front zone warns (AC-01)", () => {
    expect(defaultSize("builtInTable")).toEqual({ w: { folded: 1.2, down: 1.2 }, d: { folded: 0.35, down: 1.15 }, h: { folded: 1.6, down: 1.6 }, z: { folded: 0, down: 0 } });
    // The back edge on the top wall's face: open y 3.75–4.9 in Layout, closed y 4.55–4.9 in Night.
    const doc = place(place(room(), { object: "u", kind: "builtInTable", at: [3, 4.9], config: "down" }), { object: "u", kind: "builtInTable", at: [3, 4.9], state: "night", config: "folded" });
    // The sofa's back 0.50 m from the cabinet front (y 4.55): y 3.15–4.05.
    const sofa = (state: string, y: number): Command => ({ type: "placeObject", deck: null, opId: "s", state, object: { kind: "sofa" }, at: { x: 3, y } });
    const refused = run(doc, sofa("s0", 4.05));
    expect(refused).toMatchObject({ ok: false, error: { kind: "invalid" } });
    const message = refused.ok ? "" : refused.error.message;
    for (const word of ["Sofa", "Built-in table", "Layout"]) expect(message).toContain(word);
    expect(run(doc, sofa("night", 4.05)).ok).toBe(true);
    // 1.00 m from the cabinet front: y 2.65–3.55, inside the open table's front zone (y 3.15–3.75).
    const fits = ok(doc, sofa("s0", 3.55)).doc;
    expect(clearanceWarnings(fits, "s0")).toContainEqual({ zone: { table: "placements", id: "u/s0", side: "front" }, against: { table: "placements", id: "s/p0" } });
  });

  it("setObjectKind switches within the family, keeps sizes and name, and changes the zone (AC-02)", () => {
    const doc = hideaway();
    expect(clearanceWarnings(doc, "night")).toEqual([]); // a seat at a sit-at piece
    const r = ok(doc, { type: "setObjectKind", objectId: "u", kind: "murphyBed" });
    expect(r.doc.objects.u).toEqual({ id: "u", kind: "murphyBed", name: "Kitchen hideaway", w: { folded: 2.4, down: 2.4 }, d: { folded: 0.35, down: 1.15 }, h: { folded: 2.24, down: 2.24 }, z: { folded: 0, down: 0 } });
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["objects/u"]);
    expect(r.patch.dependencies).toEqual([
      { table: "objects", id: "u" },
      { table: "placements", id: "u/night" },
      { table: "placements", id: "u/s0" },
    ]);
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    // A bed is not sat at: the chair now blocks its front zone.
    expect(clearanceWarnings(r.doc, "night")).toEqual([{ zone: { table: "placements", id: "u/night", side: "front" }, against: { table: "placements", id: "c/night" } }]);

    const desk = ok(r.doc, { type: "setObjectKind", objectId: "u", kind: "builtInDesk" }).doc;
    expect(clearanceWarnings(desk, "night")).toEqual([]);
    const front = useZones(desk).get("u/night")?.find((z) => z.side === "front");
    const ys = (front?.quad ?? []).map((p) => r9(p.y));
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([2.95, 3.75]);
  });

  it("setObjectKind refusals", () => {
    let doc = place(place(hideaway(), { object: "b", kind: "bed", at: [1.5, 3] }), { object: "m", kind: "murphyBed", at: [5.05, 4.9] });
    doc = place(doc, { object: "f", kind: "foldingTable", at: [4.5, 2] });
    const refused = (message: string) => ({ ok: false, error: { kind: "invalidInput", message } });
    expect(run(doc, { type: "setObjectKind", objectId: "b", kind: "murphyBed" })).toMatchObject(refused("Can't switch Bed to Murphy bed"));
    expect(run(doc, { type: "setObjectKind", objectId: "m", kind: "bed" })).toMatchObject(refused("Can't switch Murphy bed to Bed"));
    expect(run(doc, { type: "setObjectKind", objectId: "f", kind: "builtInTable" })).toMatchObject(refused("Can't switch Folding table to Built-in table"));
    expect(run(doc, { type: "setObjectKind", objectId: "u", kind: "piano" })).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Unknown kind" } });
    expect(run(doc, { type: "setObjectKind", objectId: "nope", kind: "murphyBed" })).toMatchObject({ ok: false, error: { kind: "notFound", message: "Object not found" } });
    const same = ok(doc, { type: "setObjectKind", objectId: "u", kind: "builtInTable" });
    expect(same.doc).toBe(doc);
    expect(same.patch.puts).toEqual([]);
    expect(same.patch.dependencies).toEqual([
      { table: "objects", id: "u" },
      { table: "placements", id: "u/night" },
      { table: "placements", id: "u/s0" },
    ]);
  });

  // A name still equal to the old kind's label follows the switch; a name the user chose stays (smart.38).
  describe("the name and the switch", () => {
    // A table unit placed by command, so it gets the name placing gives (the kind's label unless one is passed).
    const placed = (name?: string): Document =>
      ok(room(), { type: "placeObject", deck: null, opId: "u", state: "s0", object: name === undefined ? { kind: "builtInTable" } : { kind: "builtInTable", name }, at: { x: 3, y: 4.9 }, linked: false }).doc;
    const nameOf = (doc: Document): string | undefined => doc.objects["u/o0"]?.name;
    const kind = (doc: Document, k: string) => ok(doc, { type: "setObjectKind", objectId: "u/o0", kind: k });

    it("a default name follows the switch", () => {
      const doc = placed();
      expect(nameOf(doc)).toBe("Built-in table");
      const bed = kind(doc, "murphyBed");
      expect(nameOf(bed.doc)).toBe("Murphy bed");
      expect(bed.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["objects/u/o0"]);
      expect(bed.patch.dependencies).toEqual([{ table: "objects", id: "u/o0" }, { table: "placements", id: "u/p0" }]);
      expect(unwrap(applyPatch(bed.doc, invertPatch(bed.patch)))).toEqual(doc);
      expect(nameOf(kind(bed.doc, "builtInDesk").doc)).toBe("Built-in desk");
    });

    it("a custom name stays", () => {
      const doc = placed("Kitchen hideaway");
      const bed = kind(doc, "murphyBed").doc;
      expect(bed.objects["u/o0"]).toMatchObject({ kind: "murphyBed", name: "Kitchen hideaway" });
      // Only an exact match follows: a near miss is a name the user typed.
      expect(nameOf(kind(placed("built-in table"), "murphyBed").doc)).toBe("built-in table");
    });

    it("a switch to the same kind changes nothing", () => {
      const doc = placed();
      // The command itself, not execute: execute already hands back the input document for an empty patch.
      const same = unwrap(setObjectKind(doc, { type: "setObjectKind", objectId: "u/o0", kind: "builtInTable" }));
      expect(same.doc).toBe(doc);
      expect(same.patch.puts).toEqual([]);
      expect(nameOf(same.doc)).toBe("Built-in table");
    });
  });
});

// The Kind switch between single-configuration kinds (furnish.17, AC-06): size, place and configuration stay; the
// sides become the new kind's defaults in every layout. A family switch keeps the sides (smart.21).
describe("switching single-configuration kinds (furnish.17)", () => {
  const LEFT: Sides = { front: false, back: false, left: true, right: false };
  const BACK: Sides = { front: false, back: true, left: false, right: false };
  const FRONT: Sides = { front: true, back: false, left: false, right: false };
  const twoLayouts = (): Document =>
    place(place(room(), { object: "w", kind: "wardrobe", at: [3, 4.9], sides: LEFT }), { object: "w", kind: "wardrobe", at: [3, 4.9], state: "night", sides: BACK });

  it("a single-configuration switch keeps size, position and configuration and resets sides in every layout (AC-06)", () => {
    const doc = twoLayouts();
    expect(useZones(doc).get("w/s0")?.map((z) => z.side)).toEqual(["left"]);
    const r = ok(doc, { type: "setObjectKind", objectId: "w", kind: "drawers" });
    expect(r.doc.objects.w).toEqual({ id: "w", kind: "drawers", name: "Chest of drawers", w: { standard: 1.2 }, d: { standard: 0.6 }, h: { standard: 0.9 }, z: { standard: 0 } });
    for (const id of ["w/s0", "w/night"]) {
      expect(r.doc.placements[id]).toMatchObject({ sides: FRONT, at: { x: 3, y: 4.9 }, rotation: 0, config: "standard" });
    }
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`).sort()).toEqual(["objects/w", "placements/w/night", "placements/w/s0"]);
    expect(r.patch.dependencies).toEqual([
      { table: "objects", id: "w" },
      { table: "placements", id: "w/night" },
      { table: "placements", id: "w/s0" },
    ]);
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    const zones = useZones(r.doc).get("w/s0") ?? [];
    expect(zones.map((z) => z.side)).toEqual(["front"]);
    const ys = (zones[0]?.quad ?? []).map((p) => r9(p.y));
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([3.4, 4.3]); // the drawers' 0.9 m zone, not the wardrobe's 0.6
  });

  it("a bed switched to a sofa takes the sofa's sides", () => {
    const doc = place(room(), { object: "b", kind: "bed", at: [1.5, 4.9] });
    const r = ok(doc, { type: "setObjectKind", objectId: "b", kind: "sofa" });
    expect(r.doc.placements["b/s0"]?.sides).toEqual(FRONT);
    expect(r.doc.objects.b).toMatchObject({ kind: "sofa", name: "Sofa", w: { standard: 1.7 }, d: { standard: 2.1 } });
  });

  it("a family switch keeps the sides (smart.21)", () => {
    const base = place(room(), { object: "u", kind: "builtInTable", at: [3, 4.9], config: "folded" });
    const u = base.placements["u/s0"];
    if (!u) throw new Error("u/s0 missing");
    const doc = { ...base, placements: { ...base.placements, "u/s0": { ...u, sides: BACK } } };
    const r = ok(doc, { type: "setObjectKind", objectId: "u", kind: "murphyBed" });
    expect(r.doc.placements["u/s0"]?.sides).toEqual(BACK);
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["objects/u"]);
  });

  it("a single-configuration Kind switch resets stored zones in every layout; a family switch keeps them (AC-06, furnish.17, furnish.21)", () => {
    let doc = place(place(room(), { object: "w", kind: "wardrobe", at: [3, 4.9] }), { object: "w", kind: "wardrobe", at: [3, 4.9], state: "night" });
    doc = withStoredZone(doc, "w/s0", "front", { depth: 0.4, start: 0.2, end: 0.5 });
    doc = withStoredZone(doc, "w/night", "front", { depth: 0.5, start: 0, end: 0 });
    expect(doc.placements["w/s0"]?.sides).toEqual(FRONT);
    const r = ok(doc, { type: "setObjectKind", objectId: "w", kind: "drawers" });
    for (const id of ["w/s0", "w/night"]) expect(r.doc.placements[id]?.zones).toEqual(nullZones());
    for (const id of ["w/s0", "w/night"]) expect(r.doc.placements[id]?.sides).toEqual(FRONT); // the sides alone don't change
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`).sort()).toEqual(["objects/w", "placements/w/night", "placements/w/s0"]);
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    // The reset shows in the bands: the drawers' 0.9 full side, not the stored 0.4 deep x 2.6–3.1 one.
    const front = useZones(r.doc).get("w/s0")?.find((z) => z.side === "front")?.quad ?? [];
    const span = (v: number[]) => [Math.min(...v), Math.max(...v)];
    expect(span(front.map((p) => r9(p.y)))).toEqual([3.4, 4.3]);
    expect(span(front.map((p) => r9(p.x)))).toEqual([2.4, 3.6]);

    const unit = withStoredZone(hideaway(), "u/night", "front", { depth: 0.6, start: 0.3, end: 0.3 });
    const family = ok(unit, { type: "setObjectKind", objectId: "u", kind: "murphyBed" });
    expect(family.doc.placements["u/night"]?.zones).toEqual(unit.placements["u/night"]?.zones);
    expect(family.doc.placements["u/night"]?.zones.frontDepth).toBe(0.6);
    expect(family.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["objects/u"]);
  });

  it("a default name follows a single-configuration switch; a custom one stays", () => {
    const named = (name?: string): string | undefined => {
      const placed = ok(room(), { type: "placeObject", deck: null, opId: "x", state: "s0", object: name === undefined ? { kind: "wardrobe" } : { kind: "wardrobe", name }, at: { x: 3, y: 4.9 } }).doc;
      return ok(placed, { type: "setObjectKind", objectId: "x/o0", kind: "drawers" }).doc.objects["x/o0"]?.name;
    };
    expect(named()).toBe("Chest of drawers");
    expect(named("Hall cupboard")).toBe("Hall cupboard");
    expect(named("wardrobe")).toBe("wardrobe");
  });

  it("a switch to the same single-configuration kind changes nothing", () => {
    const doc = twoLayouts();
    const same = unwrap(setObjectKind(doc, { type: "setObjectKind", objectId: "w", kind: "wardrobe" }));
    expect(same.doc).toBe(doc);
    expect(same.patch.puts).toEqual([]);
    expect(same.doc.placements["w/s0"]?.sides).toEqual(LEFT);
  });
});
