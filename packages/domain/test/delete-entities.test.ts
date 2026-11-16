import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { deleteEntities } from "../src/commands/delete-entities";
import { execute } from "../src/commands/execute";
import type { CommandOf } from "../src/commands/types";
import { emptyDocument, type Document, type EntityRef, sameGuards } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { AREA_UNAVAILABLE } from "../src/queries/area";
import { dimensionPoints } from "../src/queries/dimensions";
import { orphanLabelIds, zones } from "../src/queries/zones";
import { deepFreeze, docOf, place, rectDoc, withOpening } from "./helpers";

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
    expect(del(lone, [wall("W")]).doc).toEqual(emptyDocument());
  });

  it("deleting a label keeps the walls", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"]]), [{ table: "zoneLabels", id: "L1" }]);
    expect(doc.zoneLabels).toEqual({});
    expect(Object.keys(doc.walls)).toHaveLength(7);
  });

  it("merges two labelled rooms: names in label-ID order, first label kept", () => {
    const { doc, patch } = del(divided([["L2", 4.5, 2, "Dining"], ["L1", 1.5, 2, "Kitchen"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining", finish: null } });
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
    expect(full.doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "a".repeat(200), finish: null } });
    expect(full.patch.deletes).toContainEqual({ table: "zoneLabels", id: "L2" });
  });

  it("an empty name adds nothing to the merged name", () => {
    const { doc, patch } = del(divided([["L1", 1.5, 2, ""], ["L2", 4.5, 2, "Dining"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Dining", finish: null } });
    expect(patch.deletes).toContainEqual({ table: "zoneLabels", id: "L2" });
    const second = del(divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, ""]]), [wall("D")]);
    expect(second.doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen", finish: null } });
    const both = del(divided([["L1", 1.5, 2, ""], ["L2", 4.5, 2, ""]]), [wall("D")]);
    expect(both.doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "", finish: null } });
  });

  it("leaves a single surviving label unchanged (unlabelled room adds no name)", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"]]), [wall("D")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen", finish: null } });
  });

  it("excludes explicitly deleted labels from the merge", () => {
    const { doc } = del(divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]), [wall("D"), { table: "zoneLabels", id: "L2" }]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen", finish: null } });
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

  it("writes the divider, both labels and the stitched sides; depends on both labels and the rooms' boundaries", () => {
    // The divider's ends S1 and S2 are left as straight joints, so the bottom and top sides stitch (straight.05).
    const { doc, patch } = del(kitchenDining(), [wall("D")]);
    expect(patch.puts).toEqual(expect.arrayContaining([
      { table: "zoneLabels", entity: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen / Dining", finish: null } },
      { table: "walls", entity: { id: "B1", a: "J1", b: "J2", thickness: 0.2, top: "ceiling", base: "floor", column: false } },
    ]));
    expect(patch.deletes).toEqual(expect.arrayContaining([{ table: "walls", id: "D" }, { table: "zoneLabels", id: "L2" }, wall("B2"), wall("T2"), { table: "joints", id: "S1" }, { table: "joints", id: "S2" }]));
    expect(Object.keys(doc.walls).sort()).toEqual(["B1", "L", "R", "T1"]);
    expect(patch.before).toEqual(expect.arrayContaining([
      { table: "walls", id: "D", value: { id: "D", a: "S1", b: "S2", thickness: 0.2, top: "ceiling", base: "floor", column: false } },
      { table: "zoneLabels", id: "L1", value: { id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen", finish: null } },
      { table: "zoneLabels", id: "L2", value: { id: "L2", at: { x: 4.5, y: 2 }, name: "Dining", finish: null } },
    ]));
    // The two rooms together use every wall and joint of the fixture.
    expect(patch.dependencies).toEqual(expect.arrayContaining([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "joints", id: "J4" },
      { table: "joints", id: "S1" }, { table: "joints", id: "S2" },
      { table: "walls", id: "B1" }, { table: "walls", id: "B2" }, { table: "walls", id: "D" }, { table: "walls", id: "L" },
      { table: "walls", id: "R" }, { table: "walls", id: "T1" }, { table: "walls", id: "T2" },
      { table: "zoneLabels", id: "L1" }, { table: "zoneLabels", id: "L2" },
    ]));
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

// Finishes (finishes.15): the merge keeps the first label whole, finish included; the second goes with its finish.
describe("deleteEntities: merging finished rooms", () => {
  const oak = { motif: "planks", colour: "#c8a27a", strength: 45, size: 0.2, angle: 0 };
  const mosaic = { motif: "mosaic", colour: "#a9c9d6", strength: 50, size: 0.025, angle: 0 };

  it("merging two finished rooms keeps l10's finish (l10 < l9 in string order) and deletes l9; undo restores both", () => {
    const base = divided([]);
    const before: Document = {
      ...base,
      zoneLabels: {
        l9: { id: "l9", at: { x: 1.5, y: 2 }, name: "Bath", finish: mosaic },
        l10: { id: "l10", at: { x: 4.5, y: 2 }, name: "Main", finish: oak },
      },
    };
    const { doc, patch } = del(before, [wall("D")]);
    expect(doc.zoneLabels).toEqual({ l10: { id: "l10", at: { x: 4.5, y: 2 }, name: "Main / Bath", finish: oak } });
    expect(patch.deletes).toContainEqual({ table: "zoneLabels", id: "l9" });
    expect(applyPatch(doc, invertPatch(patch))).toEqual({ ok: true, value: before });
  });
});

describe("deleteEntities: merges and non-merges by topology", () => {
  it("Delete on the divider's middle joint joins its halves: the rooms stay apart (straight.05)", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4], ["M", 3, 2]],
      walls: [
        ["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"],
        ["D1", "S1", "M"], ["D2", "M", "S2"],
      ],
      labels: [["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]],
    });
    const { doc: after, patch } = del(doc, [{ table: "joints", id: "M" }]);
    expect(after.zoneLabels).toEqual(doc.zoneLabels);
    expect(patch.deletes).toEqual([{ table: "joints", id: "M" }, wall("D2")]);
    expect(after.walls.D1).toMatchObject({ a: "S1", b: "S2" });
    expect(Object.keys(after.joints).sort()).toEqual(["J1", "J2", "J3", "J4", "S1", "S2"]);
  });

  it("deleting a divider end joint opens both rooms: labels stay unchanged as orphans; the top side stitches", () => {
    const before = divided([["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"]]);
    const { doc, patch } = del(before, [{ table: "joints", id: "S1" }]);
    expect(patch.puts).toEqual([{ table: "walls", entity: { ...before.walls.T1, b: "J4" } }]); // T1 absorbs T2 (straight.05)
    expect(patch.deletes).toEqual(expect.arrayContaining([{ table: "joints", id: "S1" }, wall("B1"), wall("B2"), wall("D"), wall("T2"), { table: "joints", id: "S2" }]));
    expect(Object.keys(doc.joints).sort()).toEqual(["J1", "J2", "J3", "J4"]);
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

  it("three labelled rooms merged into one keep their labels unchanged; the sides stitch into one wall each", () => {
    const before = row([["L1", 1.5, 2, "One"], ["L2", 4.5, 2, "Two"], ["L3", 7.5, 2, "Three"]]);
    const { doc, patch } = del(before, [wall("D1"), wall("D2")]);
    expect(doc.zoneLabels).toEqual(before.zoneLabels);
    expect(Object.keys(doc.walls).sort()).toEqual(["Bot1", "L", "R", "Top3"]); // the piece keeping its joint a survives each stitch (straight.35)
    expect(patch.deletes).toEqual(expect.arrayContaining([wall("D1"), wall("D2"), wall("Bot2"), wall("Bot3"), wall("Top1"), wall("Top2")]));
  });

  it("three rooms merged into one with two labels combine them (the middle room is unlabelled)", () => {
    const { doc, patch } = del(row([["L1", 1.5, 2, "One"], ["L3", 7.5, 2, "Three"]]), [wall("D1"), wall("D2")]);
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "One / Three", finish: null } });
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
    expect(doc.zoneLabels).toEqual({ L1: { id: "L1", at: { x: 4.075, y: 1.5 }, name: "Closet / Hall", finish: null } });
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

describe("deleteEntities and layout rows (spec: layouts)", () => {
  const twoStates = () => {
    const base = rectDoc(0, 0, 6, 5);
    const doc = { ...base, states: { ...base.states, night: { id: "night", name: "Night", order: 1 } } };
    return place(place(doc, { object: "bed", kind: "bed", at: [2, 2.5] }), { object: "bed", kind: "bed", at: [4, 2.5], state: "night" });
  };
  it("a placement goes like removePlacement; an object goes with all its placements", () => {
    const one = unwrap(deleteEntities(twoStates(), { type: "deleteEntities", ids: [{ table: "placements", id: "bed/s0" }] })).doc;
    expect(Object.keys(one.placements)).toEqual(["bed/night"]);
    const all = unwrap(deleteEntities(twoStates(), { type: "deleteEntities", ids: [{ table: "objects", id: "bed" }] })).doc;
    expect([Object.keys(all.placements), Object.keys(all.objects)]).toEqual([[], []]);
  });
  it("refuses states (deleteState) and deleting a wall that would leave a bed outside every room", () => {
    expect(deleteEntities(twoStates(), { type: "deleteEntities", ids: [{ table: "states", id: "night" }] })).toMatchObject({ ok: false });
    expect(deleteEntities(twoStates(), { type: "deleteEntities", ids: [{ table: "walls", id: "W1" }] })).toMatchObject({
      ok: false, error: { message: "Bed in Night is not inside a room" }, // the first placement in ID order
    });
  });
});


describe("deleteEntities and openings (spec: openings)", () => {
  it("deleting a wall deletes its two openings in the same patch (AC-19)", () => {
    let doc = withOpening(rectDoc(0, 0, 6, 4), { id: "d1", wall: "W1", offset: 1 });
    doc = withOpening(doc, { id: "d2", wall: "W1", offset: 3, kind: "window" });
    doc = withOpening(doc, { id: "d3", wall: "W2", offset: 1 });
    const r = del(doc, [wall("W1")]);
    expect(Object.keys(r.doc.openings)).toEqual(["d3"]);
    expect(r.patch.deletes).toEqual(expect.arrayContaining([{ table: "openings", id: "d1" }, { table: "openings", id: "d2" }]));
    expect(r.patch.dependencies).toEqual(expect.arrayContaining([{ table: "openings", id: "d1" }, { table: "openings", id: "d2" }]));
  });
});

describe("deleteEntities and anchored dimensions (dims.07)", () => {
  // L: A(0,0)–B(4,0)–C(4,3). k measures W2's inner face from B to C, g W1's inner face from A to B.
  const L = docOf({ joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3]], walls: [["W1", "A", "B"], ["W2", "B", "C"]] });
  const add = (doc: Document, opId: string, a: { x: number; y: number }, b: { x: number; y: number }): Document =>
    unwrap(execute(doc, { type: "addDimension", opId, a, b, offset: -0.5 })).doc;
  const before = add(add(L, "k", { x: 3.9, y: 0.1 }, { x: 3.9, y: 3 }), "g", { x: 0, y: 0.1 }, { x: 3.9, y: 0.1 });
  const dim = (id: string): EntityRef => ({ table: "dimensions", id });

  it("a deleted wall takes the dimensions anchored to the joint that goes with it; the joint left keeps its own (AC-06)", () => {
    expect([before.dimensions["k/m0"]?.a, before.dimensions["g/m0"]?.a]).toEqual([
      expect.objectContaining({ joint: "B" }), expect.objectContaining({ joint: "A" }),
    ]);
    const { doc, patch } = del(before, [wall("W1")]);
    expect(Object.keys(doc.dimensions)).toEqual(["k/m0"]);
    expect(patch.deletes).toContainEqual(dim("g/m0"));
    expect(patch.dependencies).toContainEqual(dim("g/m0"));
    expect(patch.puts.some((p) => p.table === "dimensions")).toBe(false);
    expect(patch.deletes).not.toContainEqual(dim("k/m0"));
    const k = doc.dimensions["k/m0"];
    expect(k && dimensionPoints(doc, k)?.a).toEqual({ x: 3.9, y: 0 }); // W2's free end now
    expect(unwrap(applyPatch(doc, invertPatch(patch)))).toEqual(before);
  });

  it("deleting a joint takes the dimensions anchored to it", () => {
    const { doc, patch } = del(before, [{ table: "joints", id: "C" }]);
    expect(Object.keys(doc.dimensions)).toEqual(["g/m0"]);
    expect(patch.deletes).toContainEqual(dim("k/m0"));
    expect(unwrap(applyPatch(doc, invertPatch(patch)))).toEqual(before);
  });
});

describe("deleteEntities on decks (decks.03)", () => {
  const platform = { id: "stage/k0", name: "Platform", at: { x: 3, y: 2 }, w: 2, d: 1.4, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") };
  const withDeck = (): Document => ({ ...rectDoc(0, 0, 6, 4), decks: { [platform.id]: platform } });

  it("deleting a deck removes its row in one undoable patch and keeps the walls", () => {
    const before = withDeck();
    const { doc, patch } = del(before, [{ table: "decks", id: platform.id }]);
    expect(doc).toEqual(rectDoc(0, 0, 6, 4));
    expect([patch.puts, patch.deletes]).toEqual([[], [{ table: "decks", id: platform.id }]]);
    expect(unwrap(applyPatch(doc, invertPatch(patch)))).toEqual(before);
  });

  it("a missing deck is not found", () => {
    const r = deleteEntities(withDeck(), { type: "deleteEntities", ids: [{ table: "decks", id: "gone/k0" }] });
    expect(r).toMatchObject({ ok: false, error: { kind: "notFound", message: "Deck not found" } });
  });
});
