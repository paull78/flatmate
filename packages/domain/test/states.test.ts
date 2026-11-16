import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { validateDocument } from "../src/validate";
import { deepFreeze, place, rectDoc, withStoredZone } from "./helpers";

const ok = (doc: Document, cmd: Command) => unwrap(execute(doc, cmd));
const furnished = (): Document =>
  place(place(place(rectDoc(0, 0, 6, 5), { object: "table", kind: "foldingTable", at: [3, 2.5] }), { object: "bed", kind: "bed", at: [1.5, 2.5] }), {
    object: "bed", kind: "bed", at: [4.5, 2.5], state: "night",
  });

describe("states (spec: layouts)", () => {
  it("addState adds an empty state op/s0 after the last one", () => {
    const r = ok(furnished(), { type: "addState", opId: "a", name: "Work" });
    expect(r.doc.states["a/s0"]).toEqual({ id: "a/s0", name: "Work", order: 2 });
    expect(Object.values(r.doc.placements).filter((p) => p.state === "a/s0")).toEqual([]);
  });

  it("copyState copies every placement of the source with new IDs op/p0, op/p1… in object-ID order", () => {
    const r = ok(furnished(), { type: "copyState", opId: "c", from: "s0", name: "Day 2" });
    expect(r.doc.states["c/s0"]).toEqual({ id: "c/s0", name: "Day 2", order: 2 });
    expect(r.doc.placements["c/p0"]).toEqual({ ...r.doc.placements["bed/s0"], id: "c/p0", state: "c/s0" });
    expect(r.doc.placements["c/p1"]).toEqual({ ...r.doc.placements["table/s0"], id: "c/p1", state: "c/s0" });
    expect(validateDocument(r.doc).ok).toBe(true);
  });

  it("copyState carries the source's sides, not the defaults", () => {
    // Front and back: not the bed's default (left and right), so a copy that wrote the defaults would read left/right.
    const sides = { front: true, back: true, left: false, right: false };
    const doc = place(rectDoc(0, 0, 6, 5), { object: "bed", kind: "bed", at: [1.5, 2.5], sides });
    const r = ok(doc, { type: "copyState", opId: "c", from: "s0", name: "Night" });
    expect(r.doc.placements["c/p0"]?.sides).toEqual(sides);
    expect(r.doc.placements["c/p0"]?.sides).not.toBe(doc.placements["bed/s0"]?.sides);
  });

  it("copyState carries the stored zones, as a fresh object (furnish.21)", () => {
    const doc = withStoredZone(furnished(), "bed/s0", "left", { depth: 0.4, start: 0.2, end: 0.1 });
    const r = ok(doc, { type: "copyState", opId: "c", from: "s0", name: "Day 2" });
    expect(r.doc.placements["c/p0"]?.zones).toEqual(doc.placements["bed/s0"]?.zones);
    expect(r.doc.placements["c/p0"]?.zones.leftStart).toBe(0.2);
    expect(r.doc.placements["c/p0"]?.zones).not.toBe(doc.placements["bed/s0"]?.zones);
  });

  it("renameState renames; deleteState removes its placements and objects left with none (AC-11)", () => {
    expect(ok(furnished(), { type: "renameState", stateId: "night", name: "Sleep" }).doc.states.night?.name).toBe("Sleep");
    const r = ok(furnished(), { type: "deleteState", stateId: "s0" });
    expect(Object.keys(r.doc.states)).toEqual(["night"]);
    expect(Object.keys(r.doc.placements)).toEqual(["bed/night"]);
    expect(Object.keys(r.doc.objects)).toEqual(["bed"]); // the table was placed in s0 only
    expect(validateDocument(r.doc).ok).toBe(true);
  });

  it("refuses deleting the last state, a missing state, a used opId and an empty or too long name", () => {
    const single = rectDoc(0, 0, 6, 5);
    expect(execute(single, { type: "deleteState", stateId: "s0" })).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "A drawing keeps at least one layout" } });
    expect(execute(single, { type: "deleteState", stateId: "nope" })).toMatchObject({ ok: false, error: { kind: "notFound" } });
    const added = ok(single, { type: "addState", opId: "a", name: "Night" }).doc;
    expect(execute(added, { type: "addState", opId: "a", name: "Again" })).toMatchObject({ ok: false, error: { message: "Operation ID already used" } });
    expect(execute(single, { type: "copyState", opId: "c", from: "nope", name: "X" })).toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(execute(single, { type: "renameState", stateId: "s0", name: "x".repeat(201) })).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });

  const cases: [string, Command][] = [
    ["addState", { type: "addState", opId: "a", name: "Work" }],
    ["copyState", { type: "copyState", opId: "c", from: "s0", name: "Copy" }],
    ["renameState", { type: "renameState", stateId: "night", name: "Sleep" }],
    ["deleteState", { type: "deleteState", stateId: "s0" }],
  ];
  for (const [name, cmd] of cases) {
    it(`${name}: the inverse patch restores the document`, () => {
      const doc = deepFreeze(furnished());
      const r = ok(doc, cmd);
      expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    });
  }
});
