import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { validateDocument } from "../src/validate";
import { deepFreeze, place, rectDoc, withStoredZone } from "./helpers";

// duplicatePlacements (direct.11, direct.16, ghost.06): copies of placements of one layout into new objects, one
// patch, each copy at the place the editor's ghost computed.

// A 6 × 5 room (inner faces at 0.1 and 5.9 / 4.9) with a Night state.
const room = (): Document => {
  const doc = rectDoc(0, 0, 6, 5);
  return { ...doc, states: { ...doc.states, night: { id: "night", name: "Night", order: 1 } } };
};
const valid = (doc: Document): Document => {
  expect(validateDocument(doc).ok).toBe(true);
  return doc;
};
type Copy = { placementId: string; at: { x: number; y: number }; rotation: number };
const copy = (placementId: string, x: number, y: number, rotation = 0): Copy => ({ placementId, at: { x, y }, rotation });
const dup = (copies: Copy[], opId = "d"): Command => ({ type: "duplicatePlacements", opId, copies });
const chair = (doc: Document, object: string, x: number, y: number, rotation = 0): Document =>
  place(doc, { object, kind: "chair", at: [x, y], rotation });
// Chairs turned 90°: c1 x 1–1.45, c2 x 2–2.45, both y 0.775–1.225.
const pair = (): Document => valid(chair(chair(room(), "c1", 1, 1, 90), "c2", 2, 1, 90));
// The pair's copies 1.45 to the right: c1's at x 2.45–2.9, c2's at x 3.45–3.9.
const pairCopies = (): Copy[] => [copy("c2/s0", 3.45, 1, 90), copy("c1/s0", 2.45, 1, 90)];

describe("duplicatePlacements (ghost.06)", () => {
  it("copies kind, name, every configuration's size, configuration, its sides, its zones and its given place, into a new object in this layout only", () => {
    // Back only: not the sofa bed's default (front), so a copy that wrote the defaults would read front.
    const sides = { front: false, back: true, left: false, right: false };
    let doc = place(room(), { object: "sofa", kind: "sofaBed", at: [3.5, 0.1], rotation: 180, config: "bed", sides });
    doc = place(doc, { object: "sofa", kind: "sofaBed", at: [3, 4.9], state: "night", config: "sofa" });
    doc = valid({ ...doc, objects: { ...doc.objects, sofa: { id: "sofa", kind: "sofaBed", name: "Couch", w: { sofa: 2.2, bed: 2 }, d: { sofa: 0.9, bed: 1.6 }, h: { sofa: 0.95, bed: 0.9 }, z: { sofa: 0, bed: 0.1 } } } });
    doc = withStoredZone(doc, "sofa/s0", "back", { depth: 0.3, start: 0.1, end: 0.1 });
    const zones = doc.placements["sofa/s0"]?.zones;
    expect(zones?.backDepth).toBe(0.3);
    const r = unwrap(execute(doc, dup([copy("sofa/s0", 1.5, 0.1, 180)])));
    expect(r.doc.objects["d/o0"]).toEqual({ id: "d/o0", kind: "sofaBed", name: "Couch", w: { sofa: 2.2, bed: 2 }, d: { sofa: 0.9, bed: 1.6 }, h: { sofa: 0.95, bed: 0.9 }, z: { sofa: 0, bed: 0.1 } });
    expect(r.doc.placements["d/p0"]).toEqual({ id: "d/p0", object: "d/o0", state: "s0", at: { x: 1.5, y: 0.1 }, rotation: 180, config: "bed", sides, zones, deck: null });
    expect(r.doc.placements["d/p0"]?.sides).not.toBe(doc.placements["sofa/s0"]?.sides);
    expect(r.doc.placements["d/p0"]?.zones).not.toBe(zones);
    expect(r.doc.placements["sofa/night"]).toEqual(doc.placements["sofa/night"]);
    expect(Object.values(r.doc.placements).filter((p) => p.object === "d/o0")).toHaveLength(1);
  });

  it("stores each copy's place as given, with its own rotation, normalised", () => {
    const doc = valid(chair(room(), "c1", 3, 2.5));
    const turned = unwrap(execute(doc, dup([copy("c1/s0", 4, 2.5, -270)]))).doc.placements["d/p0"]; // x 4–4.45, y 2.275–2.725
    expect(turned?.at).toEqual({ x: 4, y: 2.5 });
    expect(turned?.rotation).toBe(90);
    expect(unwrap(execute(doc, dup([copy("c1/s0", 3.6, 2.5, 360)]))).doc.placements["d/p0"]?.rotation).toBe(0);
  });

  it("a group keeps the given arrangement and gets deterministic IDs in sorted source order", () => {
    const doc = pair();
    const r = unwrap(execute(doc, dup(pairCopies())));
    expect(r.doc.placements["d/p0"]).toEqual({ ...doc.placements["c1/s0"], id: "d/p0", object: "d/o0", at: { x: 2.45, y: 1 } });
    expect(r.doc.placements["d/p1"]).toEqual({ ...doc.placements["c2/s0"], id: "d/p1", object: "d/o1", at: { x: 3.45, y: 1 } });
    expect(r.doc.placements["d/p1"]?.rotation).toBe(90);
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["objects/d/o0", "objects/d/o1", "placements/d/p0", "placements/d/p1"]);
    expect(r.patch.deletes).toEqual([]);
    expect(unwrap(execute(doc, dup([...pairCopies()].reverse())))).toEqual(r);
  });

  it("dependencies are each source placement, its object and the layout", () => {
    expect(unwrap(execute(pair(), dup(pairCopies()))).patch.dependencies).toEqual([
      { table: "objects", id: "c1" }, { table: "objects", id: "c2" },
      { table: "placements", id: "c1/s0" }, { table: "placements", id: "c2/s0" }, { table: "states", id: "s0" },
    ]);
  });

  it("the inverse patch removes the copies", () => {
    const doc = deepFreeze(pair());
    const r = unwrap(execute(doc, dup(pairCopies())));
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
  });

  it("refuses a fit break naming it", () => {
    const one = valid(chair(room(), "c1", 3, 2.5));
    expect(execute(one, dup([copy("c1/s0", 3, 2.5)]))).toMatchObject({ ok: false, error: { kind: "invalid", message: "Chair (0.00–0.90) and Chair (0.00–0.90) overlap in Layout" } });
    const right = valid(chair(room(), "c1", 5.675, 2.5));
    const r = execute(right, dup([copy("c1/s0", 6.125, 2.5)]));
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid", message: "Chair (0.00–0.90) overlaps a wall in Layout" } });
    expect(r.ok ? null : r.error.violations?.[0]?.entities[0]).toEqual({ table: "placements", id: "d/p0" });
  });

  it("a copy touching its source is accepted", () => {
    const r = execute(valid(chair(room(), "c1", 3, 2.5)), dup([copy("c1/s0", 3.45, 2.5)]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateDocument(r.value.doc).ok).toBe(true);
  });

  it("a turned copy at a millimetre place validates", () => {
    const r = execute(valid(chair(room(), "c1", 3, 2.5, 30)), dup([copy("c1/s0", 3.39, 2.725, 30)]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.doc.placements["d/p0"]).toMatchObject({ at: { x: 3.39, y: 2.725 }, rotation: 30 });
  });

  it("refuses every side when the room is full", () => {
    const doc = valid(place(rectDoc(0, 0, 1, 1), { object: "b", kind: "block", at: [0.5, 0.9] })); // x 0.2–0.8, y 0.3–0.9
    for (const c of [copy("b/s0", 1.1, 0.9), copy("b/s0", -0.1, 0.9), copy("b/s0", 0.5, 1.5), copy("b/s0", 0.5, 0.3)]) {
      expect(execute(doc, dup([c]))).toMatchObject({ ok: false, error: { kind: "invalid" } });
    }
  });

  it("refuses bad input", () => {
    const doc = valid(place(pair(), { object: "c2", kind: "chair", at: [3, 3], state: "night" }));
    const used = unwrap(execute(doc, dup([copy("c1/s0", 1, 2, 90)]))).doc;
    const bad: [Document, Command, string, string][] = [
      [doc, dup([]), "invalidInput", "Nothing to duplicate"],
      [doc, dup([copy("nope", 1, 0)]), "notFound", "Placement not found"],
      [doc, dup([copy("c1/s0", 3, 3), copy("c2/night", 4, 3)]), "invalidInput", "Placements must be in one layout"],
      [doc, dup([copy("c1/s0", Number.NaN, 0)]), "invalidInput", "Invalid position"],
      [doc, dup([copy("c1/s0", 3, 3, 22.5)]), "invalidInput", "Invalid rotation"],
      [doc, dup([copy("c1/s0", 3, 3, Number.NaN)]), "invalidInput", "Invalid rotation"],
      [doc, dup([copy("c1/s0", 3, 3), copy("c1/s0", 4, 3)]), "invalidInput", "Placement listed twice"],
      [doc, dup([copy("c1/s0", 3, 3)], "a b"), "invalidInput", "Invalid operation ID"],
      [doc, dup([copy("c1/s0", 3, 3)], "a".repeat(121)), "invalidInput", "Invalid operation ID"],
      [used, dup([copy("c2/s0", 3, 3)]), "invalidInput", "Operation ID already used"],
    ];
    for (const [d, cmd, kind, message] of bad) expect(execute(d, cmd)).toMatchObject({ ok: false, error: { kind, message } });
  });
});
