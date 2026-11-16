import { describe, expect, it } from "vitest";
import { emptyStored, parseStoredDocument, unwrap, validateChangeset, type EntityKey, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Dimension, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { dimensionLength, dimensionPoints } from "../src/queries/dimensions";
import { rectangleRoom } from "../src/scripts";
import { deserialize, serialize } from "../src/serialize";
import { parseDimension } from "../src/shape";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// Placed dimensions (dims): a row of two ends and an offset. The points here are off every joint and corner, so their
// ends are free; anchoring is in dimension-anchors.test.ts.

const room = rectDoc(0, 0, 3.2, 2); // J1 (0,0), J2 (3.2,0), J3 (3.2,2), J4 (0,2)
const A = { x: 0.137, y: 0.25 };
const B = { x: 2.537, y: 3.45 };
const key: EntityKey = { table: "dimensions", id: "m1/m0" };

const add = (a: Point, b: Point, offset: number, opId = "m1"): Command => ({ type: "addDimension", opId, a, b, offset });
const setOffset = (id: string, offset: number): Command => ({ type: "setDimensionOffset", id, offset });
function refusal(doc: Document, cmd: Command): string {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
}
function violations(doc: Document, cmd: Command) {
  const r = execute(doc, cmd);
  return r.ok ? [] : r.error.violations;
}
const added = unwrap(execute(room, add(A, B, -0.5))).doc;

function withRow(row: Dimension): Document {
  return { ...room, dimensions: { [row.id]: row } };
}
const invariants = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : r.error.map((v) => v.invariant);
};

describe("addDimension", () => {
  it("stores a diagonal drawn off the grid as two free ends", () => {
    const r = unwrap(execute(room, add(A, B, -0.5)));
    expect(r.doc.dimensions["m1/m0"]).toEqual({ id: "m1/m0", a: { x: A.x, y: A.y }, b: { x: B.x, y: B.y }, offset: -0.5 });
    expect(r.patch.puts).toEqual([{ table: "dimensions", entity: r.doc.dimensions["m1/m0"] }]);
    expect(r.patch.deletes).toEqual([]);
    expect(r.patch.dependencies).toEqual([key]);
    const row = r.doc.dimensions["m1/m0"];
    if (!row) throw new Error("no row");
    expect(dimensionLength(r.doc, row)).toBeCloseTo(4, 12);
  });

  it("stores a copy of each point, so a point with an extra key still gives an exact free end", () => {
    const a = { x: 0.5, y: 0.5, kind: "grid" }; // off the joints and corners, so free
    const r = unwrap(execute(room, add(a, { x: 2.5, y: 0.5 }, 0)));
    expect(r.doc.dimensions["m1/m0"]).toEqual({ id: "m1/m0", a: { x: 0.5, y: 0.5 }, b: { x: 2.5, y: 0.5 }, offset: 0 });
    a.x = 5;
    expect(r.doc.dimensions["m1/m0"]?.a).toEqual({ x: 0.5, y: 0.5 });
  });

  it("refuses ends closer than 1 cm", () => {
    expect(refusal(room, add({ x: 1, y: 1 }, { x: 1.0099, y: 1 }, 0))).toBe("Dimension too short");
    expect(refusal(room, add({ x: 1, y: 1 }, { x: 1.01, y: 1 }, 0))).toBe("accepted");
  });

  it("refuses non-finite numbers", () => {
    for (const cmd of [add(A, B, NaN), add({ x: Infinity, y: 0 }, B, 0)]) {
      const r = execute(room, cmd);
      expect(r.ok ? null : [r.error.kind, r.error.message]).toEqual(["invalidInput", "Invalid dimension"]);
    }
  });

  it("the offset bound is I15", () => {
    expect(refusal(room, add(A, B, 1000))).toBe("accepted");
    expect(refusal(room, add(A, B, 1000.5))).not.toBe("accepted");
    expect(violations(room, add(A, B, 1000.5))).toContainEqual(expect.objectContaining({ invariant: "I15", entities: [key] }));
  });

  it("operation IDs: invalid or already used", () => {
    expect(refusal(room, add(A, B, 0, ""))).toBe("Invalid operation ID");
    expect(refusal(added, add(A, B, 0, "m1"))).toBe("Operation ID already used");
  });
});

describe("setDimensionOffset", () => {
  it("changes only the offset", () => {
    const r = unwrap(execute(added, setOffset("m1/m0", 0.75)));
    const before = added.dimensions["m1/m0"];
    const after = r.doc.dimensions["m1/m0"];
    expect(after?.offset).toBe(0.75);
    expect(after?.a).toEqual(before?.a);
    expect(after?.b).toEqual(before?.b);
    expect(r.patch.puts).toHaveLength(1);
    expect(r.patch.dependencies).toEqual([key]);
  });

  it("refuses a missing row, returns the input for an unchanged offset, and bounds the offset by I15", () => {
    const missing = execute(added, setOffset("nope", 1));
    expect(missing.ok ? null : [missing.error.kind, missing.error.message]).toEqual(["notFound", "Dimension not found"]);
    const nan = execute(added, setOffset("m1/m0", NaN));
    expect(nan.ok ? null : [nan.error.kind, nan.error.message]).toEqual(["invalidInput", "Invalid offset"]);
    expect(unwrap(execute(added, setOffset("m1/m0", -0.5))).doc).toBe(added);
    expect(violations(added, setOffset("m1/m0", 2000))).toContainEqual(expect.objectContaining({ invariant: "I15", entities: [key] }));
  });
});

describe("deleteEntities", () => {
  it("deletes a dimension; the inverse patch restores it", () => {
    const r = unwrap(execute(added, { type: "deleteEntities", ids: [key] }));
    expect(r.doc.dimensions).toEqual({});
    expect(r.patch.deletes).toEqual([key]);
    expect(r.patch.puts).toEqual([]);
    const back = unwrap(applyPatch(r.doc, invertPatch(r.patch)));
    expect(back.dimensions["m1/m0"]).toEqual(added.dimensions["m1/m0"]);
  });
});

describe("dimensionPoints", () => {
  it("free ends are their points, a centre anchor is its joint, a missing joint is null", () => {
    const row: Dimension = { id: "d", a: { joint: "J2", tx: 0, ty: 0 }, b: { x: 1, y: 1 }, offset: 0 };
    expect(dimensionPoints(room, row)).toEqual({ a: { x: 3.2, y: 0 }, b: { x: 1, y: 1 } });
    const lost: Dimension = { ...row, a: { joint: "J9", tx: 0, ty: 0 } };
    expect(dimensionPoints(room, lost)).toBeNull();
    expect(dimensionLength(room, lost)).toBeNull();
  });
});

describe("I15", () => {
  const free: Dimension["b"] = { x: 1, y: 1 };
  const row = (a: Dimension["a"], offset = 0, b: Dimension["b"] = free): Dimension => ({ id: "d", a, b, offset });
  const anchor = (tx: number, ty: number): Dimension["a"] => ({ joint: "J2", tx, ty });

  it.each([
    ["a missing joint", row({ joint: "J9", tx: 0, ty: 0 })],
    ["a missing joint at end b", row(free, 0, { joint: "J9", tx: 0, ty: 0 })],
    ["a direction of length 0.5 at end b", row(free, 0, anchor(0.5, 0))],
    ["a direction of length 0.5", row(anchor(0.5, 0))],
    ["a direction of length 1 + 2e-6", row(anchor(1 + 2e-6, 0))],
    ["offset −1000.001", row(anchor(0, 0), -1000.001)],
  ])("%s violates I15, naming the dimension", (_, r) => {
    const v = validateDocument(withRow(r));
    expect(v.ok ? [] : v.error).toContainEqual(expect.objectContaining({ invariant: "I15", entities: [{ table: "dimensions", id: "d" }] }));
  });

  it("a NaN offset is refused, naming the dimension (shape is checked first, so I8 reports it)", () => {
    const v = validateDocument(withRow(row(anchor(0, 0), NaN)));
    expect(v.ok ? [] : v.error.flatMap((x) => x.entities)).toContainEqual({ table: "dimensions", id: "d" });
  });

  it.each([
    ["direction (0.6, 0.8)", anchor(0.6, 0.8)],
    ["direction (0, 0)", anchor(0, 0)],
    ["a direction of length 1 + 5e-7", anchor(1 + 5e-7, 0)],
  ])("%s is valid", (_, a) => {
    expect(invariants(withRow(row(a)))).toEqual([]);
  });
});

describe("files", () => {
  const roomJson = (): Record<string, unknown> => {
    const doc = rectangleRoom({ x: 0, y: 0 }, 4, 3).reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument());
    const json: Record<string, unknown> = { ...serialize(doc) };
    delete json.dimensions;
    return json;
  };

  it("a version-4 file without dimensions loads with an empty table (AC-14)", () => {
    const json = roomJson();
    expect(json.version).toBe(4);
    const doc = unwrap(deserialize(json));
    expect(doc.dimensions).toEqual({});
    expect(serialize(doc).version).toBe(4);
  });

  it("only dimensions defaults: a file without openings, or with a dimensions table that is not one, is refused", () => {
    const noOpenings = roomJson();
    delete noOpenings.openings;
    expect(deserialize(noOpenings)).toMatchObject({ ok: false, error: { message: "Invalid openings table" } });
    expect(deserialize({ ...roomJson(), dimensions: 3 })).toMatchObject({ ok: false, error: { message: "Invalid dimensions table" } });
  });
});

describe("shape", () => {
  const good = { id: "d", a: { joint: "J1", tx: 0, ty: 0 }, b: { x: 1, y: 2 }, offset: 0.5 };

  it("parseDimension accepts both end kinds", () => {
    expect(parseDimension(good)).toEqual(good);
  });

  it.each([
    ["an extra key", { ...good, label: "x" }],
    ["an end with both an anchor and a point", { ...good, a: { joint: "J1", tx: 0, ty: 0, x: 0, y: 0 } }],
    ["an anchored end with no direction", { ...good, a: { joint: "J1" } }],
    ["an anchored end with half a direction", { ...good, a: { joint: "J1", tx: 0 } }],
    ["a nested point", { ...good, b: { at: { x: 1, y: 2 } } }],
    ["a bad ID", { ...good, id: "constructor" }],
    ["a bad joint ID", { ...good, a: { joint: "a b", tx: 0, ty: 0 } }],
  ])("parseDimension refuses %s", (_, v) => {
    expect(parseDimension(v)).toBeNull();
  });
});

describe("patch", () => {
  it("applyPatch refuses a malformed dimensions put", () => {
    const entity = { id: "m1/m0", a: A, b: B };
    expect(applyPatch(room, { puts: [{ table: "dimensions", entity }], deletes: [] })).toMatchObject({
      ok: false, error: { message: "Invalid dimensions entity m1/m0" },
    });
  });
});

describe("wire", () => {
  // Wire entities hold primitives or flat objects of primitives only (spec: collaboration): both end kinds must pass.
  const anchored: Dimension = { id: "d", a: { joint: "J1", tx: 0.6, ty: 0.8 }, b: { x: 1, y: 2 }, offset: 0.5 };

  it("an addDimension patch passes the changeset parser", () => {
    const { patch } = unwrap(execute(room, add(A, B, -0.5)));
    const put = { table: "dimensions", entity: anchored };
    const expect_ = [key, { table: "dimensions", id: "d" }].map((k) => ({ ...k, lastCs: null }));
    const cs = validateChangeset({ id: "cs1", patch: { puts: [...patch.puts, put], deletes: [] }, expect: expect_ });
    expect(cs.ok ? cs.value.patch.puts.length : cs.error).toBe(2);
  });

  it("a stored document holding dimensions parses, on the wire and from a server file", () => {
    const stored = { ...emptyStored(), dimensions: { "m1/m0": added.dimensions["m1/m0"], d: anchored } };
    expect(parseStoredDocument(stored)?.dimensions).toEqual(stored.dimensions);
    expect(parseStoredDocument(stored, "empty")?.dimensions).toEqual(stored.dimensions);
  });
});
