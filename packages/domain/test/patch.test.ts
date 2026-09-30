import { describe, expect, it } from "vitest";
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
      { table: "zoneLabels", entity: { id: "L1", at: { x: 1, y: 1 }, name: "Kitchen" } },
    ]);
    expect(p.deletes).toEqual([{ table: "joints", id: "C" }, { table: "walls", id: "W2" }]);
    expect(p.before).toEqual([
      { table: "joints", id: "B", value: { id: "B", x: 4, y: 0 } },
      { table: "joints", id: "C", value: { id: "C", x: 4, y: 3 } },
      { table: "joints", id: "D", value: null },
      { table: "walls", id: "W2", value: { id: "W2", a: "B", b: "C" } },
      { table: "zoneLabels", id: "L1", value: { id: "L1", at: { x: 1, y: 1 }, name: "Hall" } },
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
    expect(entityValue(before, { table: "walls", id: "W2" })).toEqual({ id: "W2", a: "B", b: "C" });
    expect(entityValue(before, { table: "walls", id: "nope" })).toBeNull();
  });
});

describe("changesTopology", () => {
  it("is false for moves and label edits", () => {
    expect(changesTopology(before, { puts: [{ table: "joints", entity: { id: "B", x: 5, y: 0 } }], deletes: [] })).toBe(false);
    expect(changesTopology(before, { puts: [{ table: "zoneLabels", entity: { id: "L2", at: { x: 0, y: 0 }, name: "" } }], deletes: [{ table: "zoneLabels", id: "L1" }] })).toBe(false);
  });

  it("is true for created or deleted joints and walls, and changed endpoints", () => {
    expect(changesTopology(before, { puts: [{ table: "joints", entity: { id: "N", x: 9, y: 0 } }], deletes: [] })).toBe(true);
    expect(changesTopology(before, { puts: [], deletes: [{ table: "walls", id: "W2" }] })).toBe(true);
    expect(changesTopology(before, { puts: [{ table: "walls", entity: { id: "W2", a: "B", b: "A" } }], deletes: [] })).toBe(true);
  });
});
