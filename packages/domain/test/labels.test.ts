import { describe, expect, it } from "vitest";
import { labelZone, renameZone } from "../src/commands/labels";
import type { CommandOf } from "../src/commands/types";
import { orphanLabelIds, zones } from "../src/queries/zones";
import { deepFreeze, docOf, rectDoc } from "./helpers";

const labelled = (name = "A") => ({ ...rectDoc(0, 0, 6, 4), zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name } } });

describe("labelZone", () => {
  it("labels an unlabelled room; deps are the label and the room's walls and joints", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const r = labelZone(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L1).toEqual({ id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" });
    expect(r.value.patch.puts).toEqual([{ table: "zoneLabels", entity: { id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" } }]);
    expect(r.value.patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "joints", id: "J4" },
      { table: "walls", id: "W1" }, { table: "walls", id: "W2" }, { table: "walls", id: "W3" }, { table: "walls", id: "W4" },
      { table: "zoneLabels", id: "L1" },
    ]);
  });

  it("refuses points outside rooms or on a boundary", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(labelZone(doc, { type: "labelZone", id: "L1", at: { x: 9, y: 2 }, name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notInRoom", message: "Click inside a room" } });
    expect(labelZone(doc, { type: "labelZone", id: "L1", at: { x: 0.0005, y: 2 }, name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notInRoom" } });
  });

  it("refuses a second label in a labelled room, a used ID and a long name", () => {
    expect(labelZone(labelled(), { type: "labelZone", id: "L2", at: { x: 5, y: 3 }, name: "B" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput", message: "This room already has a label" } });
    // Outside every room, so only the ID check can refuse it with this message.
    expect(labelZone(labelled(), { type: "labelZone", id: "L1", at: { x: 9, y: 2 }, name: "B" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Label already exists" } });
    expect(labelZone(rectDoc(0, 0, 6, 4), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "x".repeat(201) }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });

  it("refuses a non-finite position", () => {
    for (const at of [{ x: NaN, y: 2 }, { x: 1.5, y: NaN }, { x: Infinity, y: 2 }, { x: 1.5, y: -Infinity }]) {
      expect(labelZone(rectDoc(0, 0, 6, 4), { type: "labelZone", id: "L1", at, name: "x" }))
        .toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Invalid position" } });
    }
  });

  it("labels a room whose area is unavailable", () => {
    const narrow = rectDoc(0, 0, 0.15, 3); // too narrow for its walls: the inset fails
    expect(zones(narrow)[0]?.area).toBeNull();
    const r = labelZone(narrow, { type: "labelZone", id: "L1", at: { x: 0.075, y: 1.5 }, name: "Duct" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L1).toEqual({ id: "L1", at: { x: 0.075, y: 1.5 }, name: "Duct" });
    expect(zones(r.value.doc)[0]?.labelIds).toEqual(["L1"]);
  });

  it("refuses a face whose walk repeats a joint", () => {
    // A triangle hangs from the room's corner J1, so the room's walk passes J1 twice (spec §3.6 step 3).
    const doc = docOf({
      joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["T1", 2, 1], ["T2", 1, 2]],
      walls: [
        ["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"],
        ["A1", "J1", "T1"], ["A2", "T1", "T2"], ["A3", "T2", "J1"],
      ],
    });
    expect(zones(doc).find((z) => z.face.wallIds.includes("W1"))?.unavailable).toBe("Area unavailable: unsupported boundary");
    expect(labelZone(doc, { type: "labelZone", id: "L1", at: { x: 4, y: 3 }, name: "Hall" }))
      .toMatchObject({ ok: false, error: { kind: "notInRoom", message: "Click inside a room" } });
  });

  it("accepts an empty name", () => {
    const r = labelZone(rectDoc(0, 0, 6, 4), { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L1).toEqual({ id: "L1", at: { x: 1.5, y: 2 }, name: "" });
  });
});

describe("renameZone", () => {
  it("renames with the label as its only dependency", () => {
    const doc = labelled();
    const r = renameZone(doc, { type: "renameZone", id: "L1", name: "Kitchen" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L1?.name).toBe("Kitchen");
    expect(r.value.patch.dependencies).toEqual([{ table: "zoneLabels", id: "L1" }]);
    expect(renameZone(doc, { type: "renameZone", id: "nope", name: "x" })).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("refuses IDs that name Object.prototype members", () => {
    const doc = labelled();
    expect(renameZone(doc, { type: "renameZone", id: "constructor", name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(renameZone(doc, { type: "renameZone", id: "toString", name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(labelZone(rectDoc(0, 0, 6, 4), { type: "labelZone", id: "constructor", at: { x: 1, y: 1 }, name: "x" }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });

  it("accepts 200 characters and refuses 201", () => {
    expect(renameZone(labelled(), { type: "renameZone", id: "L1", name: "x".repeat(200) }))
      .toMatchObject({ ok: true, value: { doc: { zoneLabels: { L1: { name: "x".repeat(200) } } } } });
    expect(renameZone(labelled(), { type: "renameZone", id: "L1", name: "x".repeat(201) }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Name too long" } });
  });

  it("renames an orphan label outside every room", () => {
    const doc = { ...rectDoc(0, 0, 6, 4), zoneLabels: { L9: { id: "L9", at: { x: 20, y: 20 }, name: "Lost" } } };
    expect(orphanLabelIds(doc)).toEqual(["L9"]);
    const r = renameZone(doc, { type: "renameZone", id: "L9", name: "Found" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L9).toEqual({ id: "L9", at: { x: 20, y: 20 }, name: "Found" });
    expect(r.value.patch.dependencies).toEqual([{ table: "zoneLabels", id: "L9" }]);
  });

  it("renaming to the current name writes nothing, depends on the label and keeps the document", () => {
    const doc = labelled("Kitchen");
    const r = renameZone(doc, { type: "renameZone", id: "L1", name: "Kitchen" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch).toEqual({ puts: [], deletes: [], before: [], dependencies: [{ table: "zoneLabels", id: "L1" }] });
    expect(r.value.doc).toBe(doc);
  });

  it("accepts an empty name", () => {
    const r = renameZone(labelled(), { type: "renameZone", id: "L1", name: "" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.zoneLabels.L1).toEqual({ id: "L1", at: { x: 1, y: 1 }, name: "" });
  });
});

describe("labelZone and renameZone never mutate their inputs", () => {
  it("works on deep-frozen documents and commands", () => {
    const doc = deepFreeze(rectDoc(0, 0, 6, 4));
    const add: CommandOf<"labelZone"> = deepFreeze({ type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" });
    const added = labelZone(doc, add);
    if (!added.ok) throw new Error(added.error.message);
    const rename: CommandOf<"renameZone"> = deepFreeze({ type: "renameZone", id: "L1", name: "Kitchen" });
    const renamed = renameZone(deepFreeze(added.value.doc), rename);
    if (!renamed.ok) throw new Error(renamed.error.message);
    expect(renamed.value.doc.zoneLabels.L1).toEqual({ id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" });
    expect(doc).toEqual(rectDoc(0, 0, 6, 4));
    expect(added.value.doc.zoneLabels.L1).toEqual({ id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" });
  });
});
