import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { deleteEntities } from "../src/commands/delete-entities";
import type { CommandOf } from "../src/commands/types";
import type { Document, EntityRef } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { AREA_UNAVAILABLE } from "../src/queries/area";
import { orphanLabelIds, zones } from "../src/queries/zones";
import { deepFreeze, docOf, rectDoc } from "./helpers";

const divided = (labels: [string, number, number, string][]) =>
  docOf({
    joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
    walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    labels,
  });
const del = (doc: Document, ids: EntityRef[]) => {
  const r = deleteEntities(doc, { type: "deleteEntities", ids });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const wall = (id: string): EntityRef => ({ table: "walls", id });

describe("deleteEntities", () => {
  it("deleting a joint deletes its walls and then unused joints", () => {
    const { doc } = del(rectDoc(0, 0, 6, 4), [{ table: "joints", id: "J3" }]);
    expect(Object.keys(doc.walls).sort()).toEqual(["W1", "W4"]);
    expect(Object.keys(doc.joints).sort()).toEqual(["J1", "J2", "J4"]);
  });

  it("deleting a wall removes joints left without walls", () => {
    const lone = docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] });
    expect(del(lone, [wall("W")]).doc).toEqual({ joints: {}, walls: {}, zoneLabels: {} });
  });

  it("deleting a label keeps the walls", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"]]), [{ table: "zoneLabels", id: "L1" }]);
    expect(doc.zoneLabels).toEqual({});
    expect(Object.keys(doc.walls)).toHaveLength(7);
  });

  it("merges two labelled rooms: names in label-ID order, first label kept", () => {
    const { doc, patch } = del(divided([["L2", 4.5, 2, "Dining"], ["L1", 1.5, 2, "Kitchen"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining" } });
    expect(patch.deletes).toContainEqual({ table: "zoneLabels", id: "L2" });
    expect(patch.dependencies).toContainEqual({ table: "zoneLabels", id: "L2" });
    expect(patch.dependencies).toContainEqual({ table: "walls", id: "R" });
  });

  it("keeps existing slashes verbatim", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "A/B"], ["L2", 4.5, 2, "C"]]), [wall("D")]);
    expect(doc.zoneLabels.L1?.name).toBe("A/B / C");
  });

  it("cuts a combined name to 200 characters without splitting a character", () => {
    const emoji = del(divided([["L1", 1.5, 2, "x".repeat(196)], ["L2", 4.5, 2, "😀"]]), [wall("D")]);
    expect(emoji.doc.zoneLabels.L1?.name).toBe("x".repeat(196) + " / ");
    const whole = del(divided([["L1", 1.5, 2, "a".repeat(100)], ["L2", 4.5, 2, "b".repeat(97)]]), [wall("D")]);
    expect(whole.doc.zoneLabels.L1?.name).toBe("a".repeat(100) + " / " + "b".repeat(97));
    expect(whole.doc.zoneLabels.L1?.name).toHaveLength(200);
    const full = del(divided([["L1", 1.5, 2, "a".repeat(200)], ["L2", 4.5, 2, "b".repeat(200)]]), [wall("D")]);
    expect(full.doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "a".repeat(200) } });
    expect(full.patch.deletes).toContainEqual({ table: "zoneLabels", id: "L2" });
  });

  it("an empty name adds nothing to the merged name", () => {
    const { doc, patch } = del(divided([["L1", 1.5, 2, ""], ["L2", 4.5, 2, "Dining"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Dining" } });
    expect(patch.deletes).toContainEqual({ table: "zoneLabels", id: "L2" });
    const second = del(divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, ""]]), [wall("D")]);
    expect(second.doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" } });
    const both = del(divided([["L1", 1.5, 2, ""], ["L2", 4.5, 2, ""]]), [wall("D")]);
    expect(both.doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "" } });
  });

  it("leaves a single surviving label unchanged (unlabelled room adds no name)", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" } });
  });

  it("excludes explicitly deleted labels from the merge", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]), [wall("D"), { table: "zoneLabels", id: "L2" }]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" } });
  });

  it("keeps labels as orphans when the deletion opens the rooms to the exterior", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]), [wall("D"), wall("R")]);
    expect(Object.keys(doc.zoneLabels).sort()).toEqual(["L1", "L2"]);
  });

  it("undo (the inverse patch) restores the divider and both labels at once", () => {
    const before = divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]);
    const { doc, patch } = del(before, [wall("D")]);
    expect(applyPatch(doc, invertPatch(patch))).toEqual({ ok: true, value: before });
  });

  it("reports missing entities", () => {
    const r = deleteEntities(rectDoc(0, 0, 6, 4), { type: "deleteEntities", ids: [wall("nope")] });
    expect(r).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("refuses IDs that name Object.prototype members", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const json = JSON.stringify(doc);
    const refs: EntityRef[] = [wall("constructor"), { table: "joints", id: "toString" }, { table: "zoneLabels", id: "constructor" }];
    for (const ref of refs) {
      expect(deleteEntities(doc, { type: "deleteEntities", ids: [ref] })).toMatchObject({ ok: false, error: { kind: "notFound" } });
    }
    expect(JSON.stringify(doc)).toBe(json);
  });
});

describe("deleteEntities: the merge patch", () => {
  const kitchenDining = () => divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]);

  it("writes the divider and both labels; depends on both labels and the rooms' boundaries", () => {
    const { patch } = del(kitchenDining(), [wall("D")]);
    expect(patch.puts).toEqual([{ table: "zoneLabels", entity: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining" } }]);
    expect(patch.deletes).toEqual([{ table: "walls", id: "D" }, { table: "zoneLabels", id: "L2" }]);
    expect(patch.before).toEqual([
      { table: "walls", id: "D", value: { id: "D", a: "S1", b: "S2" } },
      { table: "zoneLabels", id: "L1", value: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" } },
      { table: "zoneLabels", id: "L2", value: { id: "L2", at: { x: 4.5, y: 2 }, name: "Dining" } },
    ]);
    // The two rooms together use every wall and joint of the fixture.
    expect(patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "joints", id: "J4" },
      { table: "joints", id: "S1" }, { table: "joints", id: "S2" },
      { table: "walls", id: "B1" }, { table: "walls", id: "B2" }, { table: "walls", id: "D" }, { table: "walls", id: "L" },
      { table: "walls", id: "R" }, { table: "walls", id: "T1" }, { table: "walls", id: "T2" },
      { table: "zoneLabels", id: "L1" }, { table: "zoneLabels", id: "L2" },
    ]);
  });

  it("redo (the patch applied after its inverse) gives back the merged document", () => {
    const { doc, patch } = del(kitchenDining(), [wall("D")]);
    const undone = unwrap(applyPatch(doc, invertPatch(patch)));
    expect(applyPatch(undone, patch)).toEqual({ ok: true, value: doc });
  });

  it("never mutates its inputs (deep-frozen document and command)", () => {
    const before = deepFreeze(kitchenDining());
    const cmd: CommandOf<"deleteEntities"> = { type: "deleteEntities", ids: [wall("D")] };
    const r = deleteEntities(before, deepFreeze(cmd));
    expect(r).toMatchObject({ ok: true, value: { doc: { zoneLabels: { L1: { name: "Kitchen / Dining" } } } } });
    expect(before).toEqual(kitchenDining());
    expect(cmd).toEqual({ type: "deleteEntities", ids: [wall("D")] });
  });
});

describe("deleteEntities: merges and non-merges by topology", () => {
  it("merges through a joint: deleting the divider's middle joint takes both halves", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4], ["M", 3, 2]],
      walls: [
        ["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"],
        ["D1", "S1", "M"], ["D2", "M", "S2"],
      ],
      labels: [["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]],
    });
    const { doc: after, patch } = del(doc, [{ table: "joints", id: "M" }]);
    expect(after.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining" } });
    expect(patch.deletes).toEqual([{ table: "joints", id: "M" }, wall("D1"), wall("D2"), { table: "zoneLabels", id: "L2" }]);
    expect(Object.keys(after.joints).sort()).toEqual(["J1", "J2", "J3", "J4", "S1", "S2"]);
  });

  it("deleting a divider end joint opens both rooms: labels stay unchanged as orphans", () => {
    const before = divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]);
    const { doc, patch } = del(before, [{ table: "joints", id: "S1" }]);
    expect(patch.puts).toEqual([]);
    expect(patch.deletes).toEqual([{ table: "joints", id: "S1" }, wall("B1"), wall("B2"), wall("D")]);
    expect(Object.keys(doc.joints).sort()).toEqual(["J1", "J2", "J3", "J4", "S2"]);
    expect(doc.zoneLabels).toEqual(before.zoneLabels);
    expect(orphanLabelIds(doc)).toEqual(["L1", "L2"]);
  });

  // Three 3 m × 4 m rooms in a row, dividers D1 (x = 3) and D2 (x = 6).
  const row = (labels: [string, number, number, string][]) =>
    docOf({
      joints: [["A0", 0, 0], ["A1", 3, 0], ["A2", 6, 0], ["A3", 9, 0], ["B3", 9, 4], ["B2", 6, 4], ["B1", 3, 4], ["B0", 0, 4]],
      walls: [
        ["Bot1", "A0", "A1"], ["Bot2", "A1", "A2"], ["Bot3", "A2", "A3"], ["R", "A3", "B3"],
        ["Top3", "B3", "B2"], ["Top2", "B2", "B1"], ["Top1", "B1", "B0"], ["L", "B0", "A0"],
        ["D1", "A1", "B1"], ["D2", "A2", "B2"],
      ],
      labels,
    });

  it("three labelled rooms merged into one keep their labels unchanged", () => {
    const before = row([["L1", 1.5, 2, "One"], ["L2", 4.5, 2, "Two"], ["L3", 7.5, 2, "Three"]]);
    const { doc, patch } = del(before, [wall("D1"), wall("D2")]);
    expect(doc.zoneLabels).toEqual(before.zoneLabels);
    expect(patch.puts).toEqual([]);
    expect(patch.deletes).toEqual([wall("D1"), wall("D2")]);
  });

  it("three rooms merged into one with two labels combine them (the middle room is unlabelled)", () => {
    const { doc, patch } = del(row([["L1", 1.5, 2, "One"], ["L3", 7.5, 2, "Three"]]), [wall("D1"), wall("D2")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "One / Three" } });
    // The merged room's boundary includes the middle room's walls: a collaborator deleting Bot2 first opens it.
    expect(patch.dependencies).toContainEqual(wall("Bot2"));
    expect(patch.dependencies).toContainEqual(wall("Top2"));
  });

  it("merges with a room whose area is unavailable, in label-ID order", () => {
    // A 0.15 m wide closet (too narrow for its walls) beside a 4 m × 3 m hall, sharing wall D.
    const before = docOf({
      joints: [["H1", 0, 0], ["S1", 4, 0], ["C1", 4.15, 0], ["C2", 4.15, 3], ["S2", 4, 3], ["H2", 0, 3]],
      walls: [["B1", "H1", "S1"], ["B2", "S1", "C1"], ["CR", "C1", "C2"], ["T1", "C2", "S2"], ["T2", "S2", "H2"], ["HL", "H2", "H1"], ["D", "S1", "S2"]],
      labels: [["L1", 4.075, 1.5, "Closet"], ["L2", 2, 1.5, "Hall"]],
    });
    expect(zones(before).find((z) => z.labelIds.includes("L1"))).toMatchObject({ area: null, unavailable: AREA_UNAVAILABLE });
    expect(zones(before).find((z) => z.labelIds.includes("L2"))?.area).not.toBeNull();
    const { doc } = del(before, [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 4.075, y: 1.5 }, name: "Closet / Hall" } });
  });
});

describe("deleteEntities: messages and dependencies", () => {
  it("refuses an empty selection", () => {
    expect(deleteEntities(rectDoc(0, 0, 6, 4), { type: "deleteEntities", ids: [] }))
      .toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Nothing selected" } });
  });

  it("deleting a joint depends on it, its walls and their endpoints; cleanup stays at those endpoints", () => {
    const { patch } = del(rectDoc(0, 0, 6, 4), [{ table: "joints", id: "J3" }]);
    expect(patch.deletes).toEqual([{ table: "joints", id: "J3" }, wall("W2"), wall("W3")]);
    expect(patch.dependencies).toEqual([
      { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "joints", id: "J4" }, wall("W2"), wall("W3"),
    ]);
  });

  it("deleting only a label writes and depends on that label alone", () => {
    const { patch } = del(divided([["L1", 1.5, 2, "Kitchen"]]), [{ table: "zoneLabels", id: "L1" }]);
    expect(patch.puts).toEqual([]);
    expect(patch.deletes).toEqual([{ table: "zoneLabels", id: "L1" }]);
    expect(patch.dependencies).toEqual([{ table: "zoneLabels", id: "L1" }]);
  });
});
