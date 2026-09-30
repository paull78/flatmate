import { describe, expect, it } from "vitest";
import { fromStored, isValidId, parseJoint, parseWall, parseZoneLabel, toStored } from "../src/shape";
import { docOf } from "./helpers";

describe("shape (I8)", () => {
  it("accepts plain IDs and rejects others", () => {
    for (const id of ["J1", "op-7/j0", "a.b:c_d"]) expect(isValidId(id)).toBe(true);
    for (const id of ["", "has space", "x".repeat(129), 7, null]) expect(isValidId(id)).toBe(false);
  });

  it("rejects IDs that name Object.prototype members", () => {
    for (const id of ["constructor", "__proto__", "toString"]) expect(isValidId(id)).toBe(false);
    const r = fromStored({ joints: { J1: { id: "J1", x: 0, y: 0 } }, walls: { W: { id: "W", a: "constructor", b: "J1" } }, zoneLabels: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid walls entry W" } });
  });

  it("parses entities", () => {
    expect(parseJoint({ id: "J1", x: 1, y: 2 })).toEqual({ id: "J1", x: 1, y: 2 });
    expect(parseJoint({ id: "J1", x: Number.NaN, y: 2 })).toBeNull();
    expect(parseJoint({ id: "J1", x: Infinity, y: 2 })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2" })).toEqual({ id: "W1", a: "J1", b: "J2" });
    expect(parseWall({ id: "W1", a: "J1" })).toBeNull();
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "Kitchen" })).toEqual({ id: "L1", at: { x: 1, y: 1 }, name: "Kitchen" });
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "x".repeat(201) })).toBeNull();
  });

  it("rejects entities with unknown fields, so stored documents hold only validated fields", () => {
    expect(parseJoint({ id: "J1", x: 1, y: 2, color: "red" })).toBeNull();
    expect(parseWall({ id: "W1", a: "J1", b: "J2", extra: { deep: [1] } })).toBeNull();
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1 }, name: "Hall", z: 0 })).toBeNull();
    expect(parseZoneLabel({ id: "L1", at: { x: 1, y: 1, z: 0 }, name: "Hall" })).toBeNull();
    const r = fromStored({ joints: { J1: { id: "J1", x: 0, y: 0, note: "x" } }, walls: {}, zoneLabels: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid joints entry J1" } });
  });

  it("round-trips through the stored shape", () => {
    const doc = docOf({ joints: [["J1", 0, 0], ["J2", 1, 0]], walls: [["W1", "J1", "J2"]], labels: [["L1", 5, 5, "Hall"]] });
    const back = fromStored(toStored(doc));
    expect(back).toEqual({ ok: true, value: doc });
  });

  it("rejects an entry whose key differs from its ID", () => {
    const r = fromStored({ joints: { J1: { id: "J9", x: 0, y: 0 } }, walls: {}, zoneLabels: {} });
    expect(r).toMatchObject({ ok: false, error: { kind: "format", message: "Invalid joints entry J1" } });
  });
});
