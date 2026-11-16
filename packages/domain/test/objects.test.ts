import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { CEILING_ID, emptyDocument, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { MESSAGES } from "../src/errors";
import { footprints } from "../src/queries/footprints";
import { validateDocument } from "../src/validate";
import { nullZones } from "../src/use-zone";
import { BED_160x200, deepFreeze, place, rectDoc, tinyHouse, withDeck, withStoredZone } from "./helpers";
import { FLIGHT_1, L_ROOM, PLATFORM } from "./the-l";

// A 6 × 5 room (inner faces at 0.1 and 5.9 / 4.9) with a Night state.
const room = (): Document => {
  const doc = rectDoc(0, 0, 6, 5);
  return { ...doc, states: { ...doc.states, night: { id: "night", name: "Night", order: 1 } } };
};
const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command) => unwrap(run(doc, cmd));

describe("placeObject (spec: layouts)", () => {
  it("creates object op/o0 with the kind's default sizes and placement op/p0; placing it in another state adds a row only", () => {
    const a = ok(room(), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "murphyBed" }, at: { x: 3, y: 4.6 }, linked: false });
    expect(a.doc.objects["a/o0"]).toEqual({ id: "a/o0", kind: "murphyBed", name: "Murphy bed", w: { folded: 1.6, down: 1.6 }, d: { folded: 0.4, down: 2.1 }, h: { folded: 2.24, down: 2.24 }, z: { folded: 0, down: 0 } });
    expect(a.doc.placements["a/p0"]).toEqual({
      id: "a/p0", object: "a/o0", state: "s0", at: { x: 3, y: 4.6 }, rotation: 0, config: "folded", sides: { front: true, back: false, left: false, right: false },
      zones: nullZones(), deck: null,
    });
    // Turned 180° the bed opens upwards from its back edge: y 2.0–4.1.
    const b = ok(a.doc, { type: "placeObject", deck: null, opId: "b", state: "night", object: { existing: "a/o0" }, at: { x: 3, y: 2 }, rotation: 180, config: "down" });
    expect(Object.keys(b.doc.objects)).toEqual(["a/o0"]);
    expect(b.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["placements/b/p0"]);
    expect(b.doc.placements["b/p0"]).toMatchObject({ object: "a/o0", state: "night", rotation: 180, config: "down" });
  });

  it("placeObject writes twelve nulls, also for an existing object in another layout (furnish.21)", () => {
    const placed = ok(rectDoc(0, 0, 6, 4), { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 }, linked: false }).doc;
    expect(placed.placements["b/p0"]?.zones).toEqual(nullZones());
    const stored = withStoredZone(placed, "b/p0", "left", { depth: 0.4, start: 0, end: 0.2 });
    expect(stored.placements["b/p0"]?.zones.leftDepth).toBe(0.4);
    const added = ok(stored, { type: "addState", opId: "n", name: "Night" }).doc;
    const x = ok(added, { type: "placeObject", deck: null, opId: "x", state: "n/s0", object: { existing: "b/o0" }, at: { x: 3, y: 3.9 } });
    expect(x.doc.placements["x/p0"]?.zones).toEqual(nullZones());
    expect(x.doc.placements["b/p0"]?.zones.leftDepth).toBe(0.4);
  });

  it("is refused over a wall, over another object in the same state, or outside every room, naming the object and state (AC-02)", () => {
    const base = place(room(), { object: "chair", kind: "chair", at: [3, 2.5] });
    const at = (x: number, y: number): Command => ({ type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: "bed" }, at: { x, y } });
    expect(run(base, at(3, 0.5))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Bed (0.00–1.00) overlaps a wall in Layout" } });
    expect(run(base, at(3, 2.5))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Bed (0.00–1.00) and Chair (0.00–0.90) overlap in Layout" } }); // names in placement-ID order
    expect(run(base, at(20, 20))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Bed in Layout is not inside a room" } });
  });

  it("refuses an unknown kind or configuration, a missing state or object, a second placement in one state, a used opId", () => {
    const base = place(room(), { object: "o", kind: "bed", at: [3, 2.5] });
    const cmd = (c: Partial<Extract<Command, { type: "placeObject" }>>): Command =>
      ({ type: "placeObject", deck: null, opId: "n", state: "s0", object: { kind: "chair" }, at: { x: 1, y: 1 }, ...c });
    expect(run(base, cmd({ object: { kind: "piano" } }))).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(run(base, cmd({ config: "down" }))).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(run(base, cmd({ state: "nope" }))).toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(run(base, cmd({ object: { existing: "nope" } }))).toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(run(base, cmd({ object: { existing: "o" } }))).toMatchObject({ ok: false, error: { message: "Already placed in this state" } });
    const used = ok(base, cmd({}));
    expect(run(used.doc, cmd({ at: { x: 5, y: 1 } }))).toMatchObject({ ok: false, error: { message: "Operation ID already used" } });
  });

  it("placeObject with a preset makes the object at the preset's sizes (smart.12)", () => {
    const at = (kind: string, preset: string): Command => ({ type: "placeObject", deck: null, opId: "p", state: "s0", object: { kind, preset }, at: { x: 3, y: 4 } });
    expect(ok(room(), at("bed", "Single")).doc.objects["p/o0"]).toMatchObject({ w: { standard: 1 }, d: { standard: 2.1 } });
    expect(ok(room(), at("bed", "US Queen")).doc.objects["p/o0"]).toMatchObject({ w: { standard: 1.62 }, d: { standard: 2.13 } });
    expect(ok(room(), at("sofaBed", "2 seats")).doc.objects["p/o0"]).toMatchObject({ w: { sofa: 1.5, bed: 1.5 }, d: { sofa: 0.9, bed: 1.6 } });
    const doc = deepFreeze(room());
    expect(run(doc, at("bed", "Emperor"))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Unknown preset" } });
    expect(run(doc, at("wardrobe", "Single"))).toMatchObject({ ok: false, error: { message: "Unknown preset" } }); // a bed's preset
    expect(doc).toEqual(room());
  });

  it("a Single bed fits where the default bed is refused", () => {
    // Inner face at x 0.1; anchored at x 0.65 the default 1.70 bed's left edge is at −0.2, a Single's at 0.15.
    const at = (object: { kind: string; preset?: string }): Command => ({ type: "placeObject", deck: null, opId: "p", state: "s0", object, at: { x: 0.65, y: 3.5 } });
    const doc = rectDoc(0, 0, 4, 5);
    expect(run(doc, at({ kind: "bed" }))).toMatchObject({ ok: false, error: { message: "Bed (0.00–1.00) overlaps a wall in Layout" } });
    expect(ok(doc, at({ kind: "bed", preset: "Single" })).doc.objects["p/o0"]).toMatchObject({ w: { standard: 1 } });
  });

  it("placeObject with a size makes the object at that width and first depth; other configurations keep the kind's default depth (furnish.04)", () => {
    const at = (kind: string, size: { w: number; d: number }, y: number): Command => ({ type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind, size }, at: { x: 3, y } });
    expect(ok(room(), at("wardrobe", { w: 1.5, d: 0.55 }, 4)).doc.objects["s/o0"]).toMatchObject({ w: { standard: 1.5 }, d: { standard: 0.55 } });
    const murphy = ok(room(), at("murphyBed", { w: 1.2, d: 0.37 }, 4.9)).doc;
    expect(murphy.objects["s/o0"]).toMatchObject({ w: { folded: 1.2, down: 1.2 }, d: { folded: 0.37, down: 2.1 } });
    expect(murphy.placements["s/p0"]).toMatchObject({ config: "folded" });
    expect(ok(room(), at("sofaBed", { w: 1.8, d: 0.8 }, 4)).doc.objects["s/o0"]).toMatchObject({ w: { sofa: 1.8, bed: 1.8 }, d: { sofa: 0.8, bed: 1.6 } });
  });

  it("a size is refused outside 0.02–10 m; the document is unchanged", () => {
    const doc = deepFreeze(room());
    const at = (object: { kind: string; preset?: string; size?: { w: number; d: number } }): Command => ({ type: "placeObject", deck: null, opId: "s", state: "s0", object, at: { x: 3, y: 4 } });
    for (const size of [{ w: 0.01, d: 2 }, { w: 1, d: 10.5 }, { w: NaN, d: 1 }]) {
      expect(run(doc, at({ kind: "bed", size }))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Size must be between 0.02 and 10 m" } });
    }
    expect(doc).toEqual(room());
  });

  it("fit checks the given size", () => {
    // As above: anchored at x 0.65 the default 1.70 bed crosses the wall at x 0.1; a 1.00 bed spans 0.15–1.15.
    const at = (object: { kind: string; size?: { w: number; d: number } }): Command => ({ type: "placeObject", deck: null, opId: "p", state: "s0", object, at: { x: 0.65, y: 3.5 } });
    const doc = rectDoc(0, 0, 4, 5);
    expect(run(doc, at({ kind: "bed" }))).toMatchObject({ ok: false, error: { message: "Bed (0.00–1.00) overlaps a wall in Layout" } });
    expect(ok(doc, at({ kind: "bed", size: { w: 1, d: 2.1 } })).doc.objects["p/o0"]).toMatchObject({ w: { standard: 1 } });
  });
});

describe("placement and object edits", () => {
  const twoStates = (): Document =>
    place(place(room(), { object: "bed", kind: "bed", at: [2, 2.5], size: BED_160x200 }), { object: "bed", kind: "bed", at: [4, 2.5], state: "night", size: BED_160x200 });

  it("movePlacement with a new rotation changes that state only (AC-08)", () => {
    const r = ok(twoStates(), { type: "movePlacement", placementId: "bed/s0", at: { x: 2.5, y: 2.5 }, rotation: 90 });
    expect(r.doc.placements["bed/s0"]).toMatchObject({ at: { x: 2.5, y: 2.5 }, rotation: 90 });
    expect(r.doc.placements["bed/night"]).toEqual(twoStates().placements["bed/night"]);
    expect(ok(twoStates(), { type: "movePlacement", placementId: "bed/s0", at: { x: 2, y: 2.5 }, rotation: -270 }).doc.placements["bed/s0"]?.rotation).toBe(90);
  });

  it("setConfiguration that makes a murphy bed overlap a wall is refused; otherwise the configuration changes", () => {
    const tight = place(room(), { object: "m", kind: "murphyBed", at: [3, 1.0] }); // folded 0.4 deep: y 0.8–1.2
    expect(run(tight, { type: "setConfiguration", placementId: "m/s0", config: "down" })).toMatchObject({
      ok: false, error: { message: "Murphy bed (0.00–2.24) overlaps a wall in Layout" },
    });
    const roomy = place(room(), { object: "m", kind: "murphyBed", at: [3, 2.5] });
    expect(ok(roomy, { type: "setConfiguration", placementId: "m/s0", config: "down" }).doc.placements["m/s0"]?.config).toBe("down");
    expect(run(roomy, { type: "setConfiguration", placementId: "m/s0", config: "open" })).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });

  it("an extending table at its default is 0.80 × 1.20 closed and 0.80 × 1.66 extended; extending it into a wall is refused (AC-04)", () => {
    const at = (y: number) => ok(room(), { type: "placeObject", deck: null, opId: "t", state: "s0", object: { kind: "extendingTable" }, at: { x: 3, y } }).doc;
    const near = at(1.6); // closed: y 0.4–1.6
    expect(near.objects["t/o0"]).toMatchObject({ kind: "extendingTable", name: "Extending table", w: { closed: 0.8, extended: 0.8 }, d: { closed: 1.2, extended: 1.66 } });
    expect(near.placements["t/p0"]?.config).toBe("closed");
    expect(footprints(near).get("t/p0")?.map((p) => +p.y.toFixed(9))).toEqual([0.4, 0.4, 1.6, 1.6]);
    // Extended it would span y −0.06–1.6, through the bottom wall's inner face at 0.1.
    expect(run(near, { type: "setConfiguration", placementId: "t/p0", config: "extended" })).toMatchObject({
      ok: false, error: { message: "Extending table (0.00–0.75) overlaps a wall in Layout" },
    });
    const extended = ok(at(1.9), { type: "setConfiguration", placementId: "t/p0", config: "extended" }).doc;
    expect(footprints(extended).get("t/p0")?.map((p) => +p.y.toFixed(9))).toEqual([0.24, 0.24, 1.9, 1.9]);
  });

  it("setObjectSize applies in every state; refused when the Night placement would overlap a wall, naming Night (AC-16)", () => {
    const r = ok(twoStates(), { type: "setObjectSize", objectId: "bed", w: 1.8, d: { standard: 2 } });
    expect(r.doc.objects.bed).toMatchObject({ w: { standard: 1.8 }, d: { standard: 2 } });
    const nearWall = place(place(room(), { object: "bed", kind: "bed", at: [2, 2.5] }), { object: "bed", kind: "bed", at: [5, 2.5], state: "night" });
    expect(run(nearWall, { type: "setObjectSize", objectId: "bed", w: 1.9, d: { standard: 2 } })).toMatchObject({
      ok: false, error: { message: "Bed (0.00–1.00) overlaps a wall in Night" },
    });
    expect(run(nearWall, { type: "setObjectSize", objectId: "bed", w: 0.01, d: { standard: 2 } })).toMatchObject({
      ok: false, error: { kind: "invalidInput", message: "Size must be between 0.02 and 10 m" },
    });
  });

  it("removePlacement on an object placed in two states deletes one row; placed once, the row and the object in one patch (AC-10)", () => {
    const one = ok(twoStates(), { type: "removePlacement", placementId: "bed/s0" });
    expect(Object.keys(one.doc.placements)).toEqual(["bed/night"]);
    expect(one.doc.objects.bed).toBeDefined();
    const last = ok(one.doc, { type: "removePlacement", placementId: "bed/night" });
    expect(last.doc.objects).toEqual({});
    expect(last.patch.deletes).toEqual([{ table: "objects", id: "bed" }, { table: "placements", id: "bed/night" }]);
    expect(validateDocument(last.doc).ok).toBe(true);
  });

  it("renameObject renames it in every state; the same name is a no-op returning the input", () => {
    const doc = twoStates();
    expect(ok(doc, { type: "renameObject", objectId: "bed", name: "Guest bed" }).doc.objects.bed?.name).toBe("Guest bed");
    expect(ok(doc, { type: "renameObject", objectId: "bed", name: "Bed" }).doc).toBe(doc);
    expect(ok(doc, { type: "movePlacement", placementId: "bed/s0", at: { x: 2, y: 2.5 }, rotation: 0 }).doc).toBe(doc);
  });

  const cases: [string, Command][] = [
    ["placeObject", { type: "placeObject", deck: null, opId: "p", state: "s0", object: { kind: "chair" }, at: { x: 5, y: 4 } }],
    ["movePlacement", { type: "movePlacement", placementId: "bed/s0", at: { x: 2.2, y: 2.5 }, rotation: 0 }],
    ["movePlacements", { type: "movePlacements", moves: [{ placementId: "bed/s0", at: { x: 2.2, y: 2.5 }, rotation: 0 }] }],
    ["setObjectSize", { type: "setObjectSize", objectId: "bed", w: 1.4, d: { standard: 2 } }],
    // The s0 bed spans x 1.2–3.0 after the resize; the Night bed keeps its back-edge middle, x 3.1–4.9.
    ["resizePlacement", { type: "resizePlacement", placementId: "bed/s0", side: "right", size: 1.8 }],
    ["renameObject", { type: "renameObject", objectId: "bed", name: "Cot" }],
    // The bed covers x 1.2–2.8, so the copy covers x 2.8–4.4.
    ["duplicatePlacements", { type: "duplicatePlacements", opId: "dup", copies: [{ placementId: "bed/s0", at: { x: 3.6, y: 2.5 }, rotation: 0 }] }],
    ["removePlacement (last)", { type: "removePlacement", placementId: "bed/s0" }],
  ];
  for (const [name, cmd] of cases) {
    it(`${name}: the inverse patch restores the document`, () => {
      const doc = deepFreeze(name.endsWith("(last)") ? place(room(), { object: "bed", kind: "bed", at: [2, 2.5], size: BED_160x200 }) : twoStates());
      const r = ok(doc, cmd);
      expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    });
  }
});

describe("setObjectSize: one width for every configuration (smart.05, .16)", () => {
  // Murphy bed m (1.60 wide, 0.40 folded, 2.10 down) with its back on the top wall: folded in s0, down in Night.
  const murphy = (nightX = 3): Document =>
    place(place(room(), { object: "m", kind: "murphyBed", at: [3, 4.9] }), { object: "m", kind: "murphyBed", at: [nightX, 4.9], state: "night", config: "down" });
  const size = (w: number, d: Record<string, number>): Command => ({ type: "setObjectSize", objectId: "m", w, d });
  const xsOf = (doc: Document, id: string): number[] => (footprints(doc).get(id) ?? []).map((p) => +p.x.toFixed(9));
  const deps = [{ table: "objects", id: "m" }, { table: "placements", id: "m/night" }, { table: "placements", id: "m/s0" }];

  it("writes the width to every configuration and only the given depths (AC-03)", () => {
    const doc = deepFreeze(murphy());
    const r = ok(doc, size(2.4, { folded: 0.4 }));
    expect(r.doc.objects.m).toMatchObject({ w: { folded: 2.4, down: 2.4 }, d: { folded: 0.4, down: 2.1 } });
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["objects/m"]);
    expect(r.patch.dependencies).toEqual(deps);
    expect(xsOf(r.doc, "m/night")).toEqual([1.8, 4.2, 4.2, 1.8]);
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
  });

  it("a width that pushes the other configuration into a wall is refused, naming Night", () => {
    const doc = murphy(4.8); // Night down: x 4.0–5.6; at 2.40 it would span 3.6–6.0, past the 5.9 face
    expect(run(doc, size(2.4, { folded: 0.4 }))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Murphy bed (0.00–2.24) overlaps a wall in Night" } });
  });

  it("every depth in one patch", () => {
    const doc = murphy();
    const r = ok(doc, size(1.0, { folded: 0.35, down: 1.15 }));
    expect(r.doc.objects.m).toMatchObject({ w: { folded: 1, down: 1 }, d: { folded: 0.35, down: 1.15 } });
    expect(r.patch.puts).toHaveLength(1);
  });

  it("refuses unknown configuration keys and sizes out of range", () => {
    const doc = murphy();
    const unknown: Record<string, number>[] = [{ open: 1 }, { constructor: 1 }];
    for (const d of unknown) {
      expect(run(doc, size(1.6, d))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Unknown configuration" } });
    }
    for (const [w, d] of [[0.01, { folded: 0.4 }], [1.6, { down: 11 }]] as const) {
      expect(run(doc, size(w, d))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Size must be between 0.02 and 10 m" } });
    }
  });

  it("the same sizes are a no-op that keeps the dependencies", () => {
    const doc = murphy();
    const r = ok(doc, size(1.6, { folded: 0.4 }));
    expect(r.doc).toBe(doc);
    expect(r.patch.puts).toEqual([]);
    expect(r.patch.dependencies).toEqual(deps);
  });

  it("a piece stored with different widths is aligned by its next width edit", () => {
    const doc = place(room(), { object: "s", kind: "sofaBed", at: [3, 4.9], size: { w: { sofa: 2, bed: 1.8 }, d: { sofa: 0.9, bed: 1.6 } } });
    expect(validateDocument(doc).ok).toBe(true);
    const r = ok(doc, { type: "setObjectSize", objectId: "s", w: 2, d: { sofa: 0.9 } });
    expect(r.doc.objects.s?.w).toEqual({ sofa: 2, bed: 2 });
    expect(r.patch.puts).toHaveLength(1);
  });

  it("d: {} writes the width only", () => {
    const doc = murphy();
    const r = ok(doc, size(1.8, {}));
    expect(r.doc.objects.m).toMatchObject({ w: { folded: 1.8, down: 1.8 }, d: { folded: 0.4, down: 2.1 } });
  });
});

describe("movePlacements (direct.16)", () => {
  const group = (): Document =>
    place(place(place(room(),
      { object: "a", kind: "chair", at: [2, 2.5] }), // a/s0: 0.45 × 0.45, x 1.775–2.225, y 2.05–2.5
      { object: "b", kind: "block", at: [3.5, 2.5] }), // b/s0: 0.6 × 0.6, x 3.2–3.8, y 1.9–2.5
      { object: "a", kind: "chair", at: [4, 2.5], state: "night" });
  type Move = { placementId: string; at: { x: number; y: number }; rotation: number };
  const mv = (placementId: string, x: number, y: number, rotation = 0): Move => ({ placementId, at: { x, y }, rotation });
  const moves = (...m: Move[]): Command => ({ type: "movePlacements", moves: m });
  const pair = moves(mv("a/s0", 2.5, 2.5), mv("b/s0", 4.5, 2.5));
  const deps = [
    { table: "objects", id: "a" }, { table: "objects", id: "b" },
    { table: "placements", id: "a/s0" }, { table: "placements", id: "b/s0" }, { table: "states", id: "s0" },
  ];
  const xs = (doc: Document, id: string) => footprints(doc).get(id)?.map((p) => +p.x.toFixed(9));

  it("moves every listed piece in one patch; the other layout is untouched", () => {
    const doc = group();
    const r = ok(doc, pair);
    expect(r.doc.placements["a/s0"]?.at).toEqual({ x: 2.5, y: 2.5 });
    expect(r.doc.placements["b/s0"]?.at).toEqual({ x: 4.5, y: 2.5 });
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["placements/a/s0", "placements/b/s0"]);
    expect(r.doc.placements["a/night"]).toBe(doc.placements["a/night"]);
  });

  it("checks fit once at the end: a piece may move onto a place another piece is leaving (direct.16)", () => {
    // Two movePlacement calls in a row would refuse the first: a would overlap b before b leaves.
    const r = ok(group(), moves(mv("a/s0", 3.5, 2.5), mv("b/s0", 4.5, 2.5)));
    expect(Math.min(...(xs(r.doc, "a/s0") ?? []))).toBeCloseTo(3.275, 9);
    expect(Math.max(...(xs(r.doc, "a/s0") ?? []))).toBeCloseTo(3.725, 9);
    expect(Math.min(...(xs(r.doc, "b/s0") ?? []))).toBeCloseTo(4.2, 9);
    expect(Math.max(...(xs(r.doc, "b/s0") ?? []))).toBeCloseTo(4.8, 9);
    expect(ok(group(), moves(mv("b/s0", 4.5, 2.5), mv("a/s0", 3.5, 2.5))).doc).toEqual(r.doc);
  });

  it("is refused as a whole when any piece breaks the fit, naming it (AC-08)", () => {
    expect(run(group(), moves(mv("a/s0", 3.3, 2.5), mv("b/s0", 3.5, 2.5)))).toMatchObject({
      ok: false,
      error: {
        kind: "invalid", message: "Chair (0.00–0.90) and Custom box (0.00–1.00) overlap in Layout",
        violations: [{ invariant: "I11", entities: [{ table: "placements", id: "a/s0" }, { table: "placements", id: "b/s0" }] }],
      },
    });
    // b spans x 5.5–6.1, across W2's body (5.9–6.1).
    expect(run(group(), moves(mv("a/s0", 2.5, 2.5), mv("b/s0", 5.8, 2.5)))).toMatchObject({
      ok: false,
      error: {
        kind: "invalid", message: "Custom box (0.00–1.00) overlaps a wall in Layout",
        violations: [{ invariant: "I10", entities: [{ table: "placements", id: "b/s0" }, { table: "walls", id: "W2" }] }],
      },
    });
    expect(run(group(), moves(mv("b/s0", 20, 20)))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Custom box in Layout is not inside a room" } });
  });

  it("turns pieces with whole degrees only: a 90° group turn about the bounding box centre (AC-09)", () => {
    // Box x 1.775–3.8, y 1.9–2.5, centre (2.7875, 2.2); the editor computes each new anchor.
    const r = ok(group(), moves(mv("a/s0", 2.4875, 1.4125, 90), mv("b/s0", 2.4875, 2.9125, 90)));
    expect(r.doc.placements["a/s0"]?.rotation).toBe(90);
    expect(r.doc.placements["b/s0"]?.rotation).toBe(90);
    // The box's old east edge (1.0125 east of the centre) is now its north edge.
    expect(Math.max(...(footprints(r.doc).get("b/s0")?.map((p) => p.y) ?? []))).toBeCloseTo(3.2125, 9);
    expect(ok(group(), moves(mv("a/s0", 2, 2.5, -270))).doc.placements["a/s0"]?.rotation).toBe(90);
  });

  it("refuses bad input with readable messages", () => {
    const bad: [Command, string, string][] = [
      [moves(), "invalidInput", "Nothing to move"],
      [moves(mv("a/s0", 2.5, 2.5), mv("a/s0", 2.6, 2.5)), "invalidInput", "Placement listed twice"],
      [moves(mv("a/s0", 2.5, 2.5), mv("a/night", 4.5, 2.5)), "invalidInput", "Placements must be in one layout"],
      [moves(mv("nope", 2.5, 2.5)), "notFound", "Placement not found"],
      [moves(mv("a/s0", Number.NaN, 1)), "invalidInput", "Invalid position"],
      [moves(mv("a/s0", 2.5, 2.5, 12.5)), "invalidInput", "Invalid rotation"],
    ];
    for (const [cmd, kind, message] of bad) expect(run(group(), cmd)).toMatchObject({ ok: false, error: { kind, message } });
  });

  it("depends on every moved placement, its object and the layout", () => {
    expect(ok(group(), pair).patch.dependencies).toEqual(deps);
  });

  it("to where the pieces already are is ok, returns the input and keeps the dependencies (zeroMoveDependencies)", () => {
    const doc = group();
    const r = ok(doc, moves(mv("a/s0", 2, 2.5, 360), mv("b/s0", 3.5, 2.5)));
    expect(r.doc).toBe(doc); // execute returns the input for an empty patch
    expect(r.patch.puts).toEqual([]);
    expect(r.patch.deletes).toEqual([]);
    expect(r.patch.dependencies).toEqual(deps);
    const partial = ok(doc, moves(mv("a/s0", 2, 2.5, 360), mv("b/s0", 4.5, 2.5)));
    expect(partial.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["placements/b/s0"]);
    expect(partial.doc.placements["a/s0"]).toBe(doc.placements["a/s0"]);
  });

  it("the inverse patch restores the document (two pieces)", () => {
    const doc = deepFreeze(group());
    const r = ok(doc, pair);
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    expect(unwrap(applyPatch(doc, r.patch))).toEqual(r.doc);
  });
});

describe("the back edge is the anchor (layout-states.49)", () => {
  it("a folded murphy bed with its back against the top wall goes down into the room; folding it again restores it (AC-28)", () => {
    // Top wall's inner face at y = 4.9: the bed's back edge sits on it.
    const doc = place(room(), { object: "m", kind: "murphyBed", at: [3, 4.9] });
    const down = ok(doc, { type: "setConfiguration", placementId: "m/s0", config: "down" });
    expect(down.doc.placements["m/s0"]?.at).toEqual({ x: 3, y: 4.9 });
    expect(footprints(down.doc).get("m/s0")?.map((p) => +p.y.toFixed(9))).toEqual([2.8, 2.8, 4.9, 4.9]);
    const up = ok(down.doc, { type: "setConfiguration", placementId: "m/s0", config: "folded" });
    expect(footprints(up.doc).get("m/s0")?.map((p) => +p.y.toFixed(9))).toEqual([4.5, 4.5, 4.9, 4.9]);
  });

  it("a resize keeps the back edge: a bed 2.0 deep set to 2.2 grows towards its front", () => {
    const doc = place(room(), { object: "b", kind: "bed", at: [3, 4.9] });
    const r = ok(doc, { type: "setObjectSize", objectId: "b", w: 1.6, d: { standard: 2.2 } });
    expect(footprints(r.doc).get("b/s0")?.map((p) => +p.y.toFixed(9))).toEqual([2.7, 2.7, 4.9, 4.9]);
  });
});


describe("commands set a surface (decks.11)", () => {
  // The tiny house's main room (x 2.1–6.9, y 0.1–2.4) under a 3.50 m ceiling, with a loft (2.15) at x 3.3–5.7,
  // y 0.8–2.4 and a 1.40 × 1.20 mattress (0.35 high) at x 3.8–5.2, y 1.2–2.4 on `deck`.
  const MATTRESS = { w: { standard: 1.4 }, d: { standard: 1.2 }, h: { standard: 0.35 }, z: { standard: 0 } };
  const loftDoc = (deck: string | null): Document =>
    place(withDeck({ ...tinyHouse(), ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 3.5 } } }, { id: "loft", name: "Loft", at: [4.5, 1.6], w: 2.4, d: 1.6, top: 2.15, solid: false }), { object: "bed", kind: "bed", at: [4.5, 2.4], size: MATTRESS, deck });

  it("placeObject writes the deck", () => {
    const doc = loftDoc(null);
    const on = ok(doc, { type: "placeObject", opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3.55, y: 1.25 }, deck: "loft", config: "standard" });
    expect(on.doc.placements["c/p0"]?.deck).toBe("loft");
    expect(on.patch.dependencies).toContainEqual({ table: "decks", id: "loft" });
    expect(ok(doc, { type: "placeObject", opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3.55, y: 1.25 }, deck: null }).doc.placements["c/p0"]?.deck).toBeNull();
    const missing = run(doc, { type: "placeObject", opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3.55, y: 1.25 }, deck: "gone" });
    expect(missing.ok ? "accepted" : missing.error.message).toBe("Deck not found");
  });

  it("movePlacement with only a new deck changes the surface in place; without one it keeps it", () => {
    const doc = loftDoc(null);
    const up = ok(doc, { type: "movePlacement", placementId: "bed/s0", at: { x: 4.5, y: 2.4 }, rotation: 0, deck: "loft" });
    expect(up.doc.placements["bed/s0"]).toMatchObject({ at: { x: 4.5, y: 2.4 }, deck: "loft" });
    expect(up.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["placements/bed/s0"]);
    expect(up.patch.dependencies).toContainEqual({ table: "decks", id: "loft" });
    const along = ok(up.doc, { type: "movePlacement", placementId: "bed/s0", at: { x: 5, y: 2.4 }, rotation: 0 });
    expect(along.doc.placements["bed/s0"]).toMatchObject({ at: { x: 5, y: 2.4 }, deck: "loft" });
    expect(along.patch.dependencies).toContainEqual({ table: "decks", id: "loft" }); // a piece on a deck depends on its row
    // The no-op needs position, rotation and surface unchanged.
    expect(ok(up.doc, { type: "movePlacement", placementId: "bed/s0", at: { x: 4.5, y: 2.4 }, rotation: 0, deck: "loft" }).doc).toBe(up.doc);
    expect(ok(up.doc, { type: "movePlacement", placementId: "bed/s0", at: { x: 4.5, y: 2.4 }, rotation: 0, deck: null }).doc.placements["bed/s0"]?.deck).toBeNull();
    const missing = run(doc, { type: "movePlacement", placementId: "bed/s0", at: { x: 4.5, y: 2.4 }, rotation: 0, deck: "gone" });
    expect(missing.ok ? "accepted" : missing.error.message).toBe("Deck not found");
  });

  it("duplicatePlacements copies keep the source's deck", () => {
    // A coffee table on the loft at x 3.5–4.5, y 1.9–2.4.
    const doc = place(loftDoc(null), { object: "t", kind: "coffeeTable", at: [4, 2.4], deck: "loft" });
    const without = { ...doc, objects: { ...doc.objects }, placements: { ...doc.placements } };
    delete without.objects.bed;
    delete without.placements["bed/s0"];
    const copy = ok(without, { type: "duplicatePlacements", opId: "dup", copies: [{ placementId: "t/s0", at: { x: 5, y: 2.4 }, rotation: 0 }] });
    const added = Object.values(copy.doc.placements).filter((p) => p.id !== "t/s0");
    expect(added.map((p) => p.deck)).toEqual(["loft"]);
    // Off the loft, the copy is refused rather than dropped to the floor.
    const off = run(without, { type: "duplicatePlacements", opId: "dup", copies: [{ placementId: "t/s0", at: { x: 6, y: 2.4 }, rotation: 0 }] });
    expect(off.ok ? "accepted" : off.error.message).toBe("Coffee table lies outside Loft in Layout");
  });

  it("resizePlacement on a piece on a loft keeps it on the loft, or is refused", () => {
    const doc = loftDoc("loft"); // x 3.8–5.2
    const wider = ok(doc, { type: "resizePlacement", placementId: "bed/s0", side: "right", size: 1.9 });
    expect(wider.doc.placements["bed/s0"]?.deck).toBe("loft");
    const r = run(doc, { type: "resizePlacement", placementId: "bed/s0", side: "right", size: 2.0 }); // to x 5.8, past 5.7
    expect(r.ok ? "accepted" : r.error.message).toBe("Bed lies outside Loft in Layout");
  });
});

describe("setObjectKind on a linked stair (stairdraw.03)", () => {
  it("setObjectKind on a stair linked to a 1.08 platform keeps h 1.08", () => {
    const linked = [...L_ROOM, FLIGHT_1].reduce((d: Document, c) => ok(d, c).doc, emptyDocument());
    expect(linked.objects["f1/o0"]).toMatchObject({ kind: "stair", reaches: PLATFORM, h: { standard: 1.08 } });
    const open = ok(linked, { type: "setObjectKind", objectId: "f1/o0", kind: "openStair" }).doc;
    expect(open.objects["f1/o0"]).toMatchObject({ kind: "openStair", reaches: PLATFORM, h: { standard: 1.08 } });
    expect(validateDocument(open).ok).toBe(true);
  });
});

describe("placeObject with a height (clarity.06, .11)", () => {
  const at = (object: { kind: string; preset?: string; size?: { w: number; d: number; h?: number } }, y = 4): Command =>
    ({ type: "placeObject", deck: null, opId: "h", state: "s0", object, at: { x: 3, y } });
  const refusal = (cmd: Command): string => {
    const r = run(room(), cmd);
    return r.ok ? "accepted" : r.error.message;
  };

  it("placeObject with h stores it, rounded to the mm", () => {
    const placed = ok(room(), at({ kind: "wardrobe", size: { w: 1.2, d: 0.6, h: 2.0304 } })).doc.objects["h/o0"];
    expect(placed).toMatchObject({ h: { standard: 2.03 }, z: { standard: 0 } });
  });

  it("with a preset and h, h wins and z stays", () => {
    // A wall shelf: 0.30 tall at 1.50.
    const preset = ok(room(), at({ kind: "shelf", preset: "Wall shelf" })).doc.objects["h/o0"];
    expect(preset).toMatchObject({ h: { standard: 0.3 }, z: { standard: 1.5 } });
    const lowered = ok(room(), at({ kind: "shelf", preset: "Wall shelf", size: { w: 0.8, d: 0.25, h: 0.25 } })).doc.objects["h/o0"];
    expect(lowered).toMatchObject({ h: { standard: 0.25 }, z: { standard: 1.5 } });
  });

  it("h on a Murphy bed or a stair is refused", () => {
    expect(refusal(at({ kind: "murphyBed", size: { w: 1.6, d: 0.4, h: 2 } }, 4.6))).toBe(MESSAGES.fixedHeight);
    expect(refusal(at({ kind: "stair", size: { w: 0.9, d: 2.99, h: 2 } }))).toBe(MESSAGES.fixedHeight);
    const r = run(room(), at({ kind: "murphyBed", size: { w: 1.6, d: 0.4, h: 2 } }, 4.6));
    expect(r.ok ? null : r.error.kind).toBe("invalidInput");
  });

  it("h under the minimum or over the maximum is refused", () => {
    const wardrobe = (h: number): Command => at({ kind: "wardrobe", size: { w: 1.2, d: 0.6, h } });
    expect(refusal(wardrobe(0.004))).toBe(MESSAGES.objectHeight);
    expect(refusal(wardrobe(10.5))).toBe(MESSAGES.objectHeight);
    expect(refusal(wardrobe(Number.NaN))).toBe(MESSAGES.objectHeight);
  });

  it("h above the ceiling is refused by validation", () => {
    const r = run(room(), at({ kind: "wardrobe", size: { w: 1.2, d: 0.6, h: 2.6 } }));
    expect(r.ok ? null : r.error.kind).toBe("invalid");
    expect(r.ok ? [] : r.error.violations.map((v) => v.invariant)).toEqual(["I17"]);
  });

  it("without h nothing changes", () => {
    const sized = { kind: "wardrobe", size: { w: 1.2, d: 0.6 } };
    expect(ok(room(), at(sized)).doc.objects["h/o0"]).toEqual(ok(room(), at({ kind: "wardrobe" })).doc.objects["h/o0"]);
    expect(ok(room(), at({ kind: "murphyBed", size: { w: 1.6, d: 0.4 } }, 4.6)).doc.objects["h/o0"]).toMatchObject({ h: { folded: 2.24, down: 2.24 } });
  });
});
