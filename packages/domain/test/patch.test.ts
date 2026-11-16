import { describe, expect, it } from "vitest";
import { sameGuards } from "../src/model";
import { applyPatch, changesTopology, diffPatch, entityValue, invertPatch } from "../src/patch";
import { docOf } from "./helpers";

const before = docOf({
  joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 3]],
  walls: [["W1", "A", "B"], ["W2", "B", "C"]],
  labels: [["L1", 1, 1, "Hall"]],
});

describe("diffPatch", () => {
  it("records puts, deletes and previous values, ordered by table then ID", () => {
    const after = docOf({
      joints: [["A", 0, 0], ["B", 4, 0.5], ["D", 9, 9]],
      walls: [["W1", "A", "B"]],
      labels: [["L1", 1, 1, "Kitchen"]],
    });
    const p = diffPatch(before, after, [{ table: "walls", id: "W1" }, { table: "walls", id: "W1" }]);
    expect(p.puts).toEqual([
      { table: "joints", entity: { id: "B", x: 4, y: 0.5 } },
      { table: "joints", entity: { id: "D", x: 9, y: 9 } },
      { table: "zoneLabels", entity: { id: "L1", at: { x: 1, y: 1 }, name: "Kitchen", finish: null } },
    ]);
    expect(p.deletes).toEqual([{ table: "joints", id: "C" }, { table: "walls", id: "W2" }]);
    expect(p.before).toEqual([
      { table: "joints", id: "B", value: { id: "B", x: 4, y: 0 } },
      { table: "joints", id: "C", value: { id: "C", x: 4, y: 3 } },
      { table: "joints", id: "D", value: null },
      { table: "walls", id: "W2", value: { id: "W2", a: "B", b: "C", thickness: 0.2, top: "ceiling", base: "floor", column: false } },
      { table: "zoneLabels", id: "L1", value: { id: "L1", at: { x: 1, y: 1 }, name: "Hall", finish: null } },
    ]);
    expect(p.dependencies).toEqual([{ table: "walls", id: "W1" }]);
  });

  it("is empty when nothing changed", () => {
    const p = diffPatch(before, { ...before, joints: { ...before.joints } }, []);
    expect(p.puts).toEqual([]);
    expect(p.deletes).toEqual([]);
  });
});

describe("applyPatch and invertPatch", () => {
  it("apply then invert returns the original document", () => {
    const after = docOf({ joints: [["A", 0, 0], ["B", 4, 1]], walls: [["W1", "A", "B"]], labels: [["L1", 1, 1, "Hall"]] });
    const p = diffPatch(before, after, []);
    const applied = applyPatch(before, p);
    expect(applied).toEqual({ ok: true, value: after });
    const back = applied.ok ? applyPatch(applied.value, invertPatch(p)) : applied;
    expect(back).toEqual({ ok: true, value: before });
  });

  it("rejects malformed put values", () => {
    const r = applyPatch(before, { puts: [{ table: "joints", entity: { id: "X", x: "1", y: 0 } }], deletes: [] });
    expect(r).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("reads entity values by key", () => {
    expect(entityValue(before, { table: "walls", id: "W2" })).toEqual({ id: "W2", a: "B", b: "C", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(entityValue(before, { table: "walls", id: "nope" })).toBeNull();
  });
});

describe("changesTopology", () => {
  it("is false for moves and label edits", () => {
    expect(changesTopology(before, { puts: [{ table: "joints", entity: { id: "B", x: 5, y: 0 } }], deletes: [] })).toBe(false);
    expect(changesTopology(before, { puts: [{ table: "zoneLabels", entity: { id: "L2", at: { x: 0, y: 0 }, name: "", finish: null } }], deletes: [{ table: "zoneLabels", id: "L1" }] })).toBe(false);
  });

  it("is true for created or deleted joints and walls, and changed endpoints", () => {
    expect(changesTopology(before, { puts: [{ table: "joints", entity: { id: "N", x: 9, y: 0 } }], deletes: [] })).toBe(true);
    expect(changesTopology(before, { puts: [], deletes: [{ table: "walls", id: "W2" }] })).toBe(true);
    expect(changesTopology(before, { puts: [{ table: "walls", entity: { id: "W2", a: "B", b: "A", thickness: 0.2, top: "ceiling", base: "floor", column: false } }], deletes: [] })).toBe(true);
  });
});

describe("decks in patches", () => {
  it("a deck put and delete applies and diffs", () => {
    const platform = { id: "stage/k0", name: "Platform", at: { x: 2, y: 1 }, w: 2, d: 1.4, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") };
    const withDeck = applyPatch(before, { puts: [{ table: "decks", entity: platform }], deletes: [] });
    expect(withDeck.ok && withDeck.value.decks).toEqual({ [platform.id]: platform });
    if (!withDeck.ok) return;
    expect(entityValue(withDeck.value, { table: "decks", id: platform.id })).toEqual(platform);
    const put = diffPatch(before, withDeck.value, []);
    expect([put.puts, put.deletes, put.before]).toEqual([[{ table: "decks", entity: platform }], [], [{ table: "decks", id: platform.id, value: null }]]);
    const removed = applyPatch(withDeck.value, { puts: [], deletes: [{ table: "decks", id: platform.id }] });
    expect(removed).toEqual({ ok: true, value: before });
    const del = diffPatch(withDeck.value, before, []);
    expect([del.puts, del.deletes]).toEqual([[], [{ table: "decks", id: platform.id }]]);
    expect(applyPatch(before, { puts: [{ table: "decks", entity: { ...platform, solid: "yes" } }], deletes: [] })).toMatchObject({ ok: false, error: { kind: "format" } });
  });

  it("decks diff after zone labels and before states (TABLE_NAMES order)", () => {
    const platform = { id: "stage/k0", name: "Platform", at: { x: 2, y: 1 }, w: 2, d: 1.4, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") };
    const after = { ...before, zoneLabels: {}, decks: { [platform.id]: platform }, states: {} };
    const p = diffPatch(before, after, []);
    expect(p.before.map((x) => x.table)).toEqual(["zoneLabels", "decks", "states"]);
  });
});

describe("deck holes in patches", () => {
  it("a deck hole put and delete applies and diffs", () => {
    const hole = { id: "h/h0", deck: "loft/k0", at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65, guard: { kind: "railing", height: 1 } };
    const withHole = applyPatch(before, { puts: [{ table: "deckHoles", entity: hole }], deletes: [] });
    expect(withHole.ok && withHole.value.deckHoles).toEqual({ [hole.id]: hole });
    if (!withHole.ok) return;
    expect(entityValue(withHole.value, { table: "deckHoles", id: hole.id })).toEqual(hole);
    const put = diffPatch(before, withHole.value, []);
    expect([put.puts, put.deletes]).toEqual([[{ table: "deckHoles", entity: hole }], []]);
    const changed = applyPatch(withHole.value, { puts: [{ table: "deckHoles", entity: { ...hole, w: 0.8 } }], deletes: [] });
    expect(changed.ok && changed.value.deckHoles[hole.id]?.w).toBe(0.8);
    expect(applyPatch(withHole.value, { puts: [], deletes: [{ table: "deckHoles", id: hole.id }] })).toEqual({ ok: true, value: before });
    expect(applyPatch(before, { puts: [{ table: "deckHoles", entity: { ...hole, w: "wide" } }], deletes: [] })).toMatchObject({ ok: false, error: { kind: "format" } });
  });
});

