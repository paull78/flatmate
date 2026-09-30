import { describe, expect, it } from "vitest";
import { addWall } from "../src/commands/add-wall";
import type { JointRef } from "../src/commands/types";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

const at = (x: number, y: number): JointRef => ({ at: { x, y } });
function add(doc: Document, opId: string, from: JointRef, to: JointRef) {
  return addWall(doc, { type: "addWall", opId, from, to });
}
function ok(doc: Document, opId: string, from: JointRef, to: JointRef) {
  const r = add(doc, opId, from, to);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Exact in binary: the tied candidates below are 0.73 mm from the probe point (1, 0) and 1.46 mm apart. */
const off = 3 / 4096;
/** Joints B and A are equally far from (1, 0); `nudge` moves A (and its wall) farther. */
const jointTieDoc = (nudge = 0) => docOf({
  joints: [["B", 1 + off, 0], ["A", 1 - off - nudge, 0], ["C", 1 + off, 5], ["D", 1 - off - nudge, -5]],
  walls: [["W1", "B", "C"], ["W2", "A", "D"]],
});
/** Walls WB and WA are equally far from (1, 0); `nudge` moves WA farther. */
const wallTieDoc = (nudge = 0) => docOf({
  joints: [["B1", 1 - off, -5], ["B2", 1 - off, 5], ["A1", 1 + off + nudge, -5], ["A2", 1 + off + nudge, 5]],
  walls: [["WB", "B1", "B2"], ["WA", "A1", "A2"]],
});

const reversed = <T>(table: Record<string, T>) => Object.fromEntries(Object.entries(table).reverse());
function reversedTables(doc: Document): Document {
  return { joints: reversed(doc.joints), walls: reversed(doc.walls), zoneLabels: reversed(doc.zoneLabels) };
}

describe("addWall", () => {
  it("creates a free wall with IDs op/j0, op/j1, op/w0", () => {
    const { doc, patch } = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    expect(doc.joints).toEqual({ "op1/j0": { id: "op1/j0", x: 0, y: 0 }, "op1/j1": { id: "op1/j1", x: 6, y: 0 } });
    expect(doc.walls).toEqual({ "op1/w0": { id: "op1/w0", a: "op1/j0", b: "op1/j1" } });
    expect(patch.deletes).toEqual([]);
    expect(patch.dependencies).toEqual([]);
  });

  it("reuses a joint within EPS and records it as a dependency", () => {
    const first = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    const { doc, patch } = ok(first.doc, "op2", at(6.0004, 0), at(6, 4));
    expect(doc.walls["op2/w0"]).toEqual({ id: "op2/w0", a: "op1/j1", b: "op2/j0" });
    expect(patch.dependencies).toEqual([{ table: "joints", id: "op1/j1" }]);
  });

  it("accepts an existing-joint reference", () => {
    const first = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    const { doc } = ok(first.doc, "op2", { existing: "op1/j0" }, at(0, 4));
    expect(doc.walls["op2/w0"]?.a).toBe("op1/j0");
    expect(add(first.doc, "op3", { existing: "nope" }, at(1, 1))).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("splits a wall at a T-junction; the a-side fragment keeps the wall's ID", () => {
    const room = rectDoc(0, 0, 6, 4); // W1: J1(0,0) → J2(6,0)
    const { doc, patch } = ok(room, "d", at(3, 0), at(3, 2));
    expect(doc.joints["d/j0"]).toEqual({ id: "d/j0", x: 3, y: 0 });
    expect(doc.walls.W1).toEqual({ id: "W1", a: "J1", b: "d/j0" });
    expect(doc.walls["d/w1"]).toEqual({ id: "d/w1", a: "d/j0", b: "J2" });
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "d/j0", b: "d/j1" });
    expect(patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "walls", id: "W1" },
    ]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("splits both walls for the demo divider (3,0) → (3,4)", () => {
    const { doc, patch } = ok(rectDoc(0, 0, 6, 4), "d", at(3, 0), at(3, 4));
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "d/j0", b: "d/j1" });
    expect(doc.walls["d/w1"]).toEqual({ id: "d/w1", a: "d/j0", b: "J2" });   // from-side fragment of W1
    expect(doc.walls.W3).toEqual({ id: "W3", a: "J3", b: "d/j1" });          // W3: J3(6,4) → J4(0,4)
    expect(doc.walls["d/w2"]).toEqual({ id: "d/w2", a: "d/j1", b: "J4" });
    // Spec §4.1: split walls and their endpoints.
    expect(patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "joints", id: "J4" },
      { table: "walls", id: "W1" }, { table: "walls", id: "W3" },
    ]);
    expect(patch.before).toEqual([
      { table: "joints", id: "d/j0", value: null },
      { table: "joints", id: "d/j1", value: null },
      { table: "walls", id: "W1", value: { id: "W1", a: "J1", b: "J2" } },
      { table: "walls", id: "W3", value: { id: "W3", a: "J3", b: "J4" } },
      { table: "walls", id: "d/w0", value: null },
      { table: "walls", id: "d/w1", value: null },
      { table: "walls", id: "d/w2", value: null },
    ]);
  });

  it("projects a point within EPS of a wall onto it", () => {
    const { doc } = ok(rectDoc(0, 0, 6, 4), "d", at(3, 0.0004), at(3, 2));
    expect(doc.joints["d/j0"]).toEqual({ id: "d/j0", x: 3, y: 0 });
  });

  it("accepts a divider 0.30 m from a corner", () => {
    expect(add(rectDoc(0, 0, 6, 4), "d", at(0.3, 0), at(0.3, 4)).ok).toBe(true);
  });

  it("rejects a split that leaves a fragment under 1 cm, atomically", () => {
    const room = rectDoc(0, 0, 6, 4);
    const r = add(room, "d", at(0.005, 0), at(0.005, 2));
    expect(r).toMatchObject({ ok: false, error: { kind: "tooShort", message: "Intersection would create a wall shorter than 1 cm" } });
    expect(Object.keys(room.walls)).toEqual(["W1", "W2", "W3", "W4"]);
  });

  it("rejects a wall shorter than 1 cm", () => {
    expect(add({ joints: {}, walls: {}, zoneLabels: {} }, "x", at(0, 0), at(0.005, 0)))
      .toMatchObject({ ok: false, error: { kind: "tooShort", message: "Wall too short" } });
  });

  it("rejects collinear overlap", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(add(room, "x", at(-2, 0), at(2, 0))).toMatchObject({ ok: false, error: { kind: "overlap", message: "Walls can't overlap" } });
    expect(add(room, "x", at(1, 0), at(2, 0))).toMatchObject({ ok: false, error: { kind: "overlap" } });
    expect(add(room, "x", at(3, 0), { existing: "J2" })).toMatchObject({ ok: false, error: { kind: "overlap" } });
  });

  it("rejects interior crossings and passing through a joint", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(add(room, "x", at(3, -1), at(3, 1))).toMatchObject({ ok: false, error: { kind: "crossing", message: "Walls can't cross" } });
    expect(add(room, "x", at(-1, -1), at(1, 1))).toMatchObject({ ok: false, error: { kind: "crossing" } });
  });

  it("refuses a reused operation ID", () => {
    const first = ok({ joints: {}, walls: {}, zoneLabels: {} }, "op1", at(0, 0), at(6, 0));
    expect(add(first.doc, "op1", at(0, 5), at(6, 5))).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });

  it("breaks equal-distance joint ties by ID", () => {
    const { doc: next } = ok(jointTieDoc(), "x", at(1, 0), at(-5, 0));
    expect(next.walls["x/w0"]?.a).toBe("A");
  });

  it("breaks equal-distance wall ties by ID: the smaller wall ID is split", () => {
    const doc = wallTieDoc();
    // Splitting WB instead would make the new wall cross WA.
    const { doc: next } = ok(doc, "x", at(1, 0), at(5, 0));
    expect(next.joints["x/j0"]).toEqual({ id: "x/j0", x: 1 + off, y: 0 });
    expect(next.walls.WA).toEqual({ id: "WA", a: "A1", b: "x/j0" });
    expect(next.walls.WB).toEqual(doc.walls.WB);
  });

  it("treats joint distances within 1e-9 as a tie: the smaller ID wins even when 1e-12 farther", () => {
    const { doc: next } = ok(jointTieDoc(1e-12), "x", at(1, 0), at(-5, 0));
    expect(next.walls["x/w0"]?.a).toBe("A");
  });

  it("treats wall distances within 1e-9 as a tie: the smaller ID is split even when 1e-12 farther", () => {
    const far = 1 + off + 1e-12;
    const { doc: next } = ok(wallTieDoc(1e-12), "x", at(1, 0), at(5, 0));
    expect(next.joints["x/j0"]).toEqual({ id: "x/j0", x: far, y: 0 });
    expect(next.walls.WA).toEqual({ id: "WA", a: "A1", b: "x/j0" });
  });

  it("refuses an invalid operation ID and one longer than 120 characters", () => {
    const empty: Document = { joints: {}, walls: {}, zoneLabels: {} };
    for (const opId of ["not valid", "toString", "", "x".repeat(121)]) {
      expect(add(empty, opId, at(0, 0), at(1, 0)), opId).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    }
    expect(add(empty, "x".repeat(120), at(0, 0), at(1, 0)).ok).toBe(true);
  });

  it("refuses a non-finite point", () => {
    const empty: Document = { joints: {}, walls: {}, zoneLabels: {} };
    expect(add(empty, "x", at(Number.NaN, 0), at(1, 0))).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(add(empty, "x", at(0, 0), at(1, Number.POSITIVE_INFINITY))).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });

  it("refuses, in the final validation, a nearly parallel wall passing 0.5 mm from a joint", () => {
    // E ends at (2, 0). The new wall slopes 1 cm per metre and passes 0.5 mm above (2, 0), meeting E's line
    // only at x = 2.05, past E's end: steps 1–3 let it through and I6 (a joint on another wall) refuses it.
    const doc = docOf({ joints: [["P", 0, 0], ["Q", 2, 0]], walls: [["E", "P", "Q"]] });
    const r = add(doc, "x", at(-1, 0.0305), at(5, -0.0295));
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid", message: "Walls can't cross" } });
    expect(r.ok ? [] : r.error.violations.map((v) => v.invariant)).toEqual(["I6"]);
  });

  it.each([
    { name: "rectangle divider", doc: () => rectDoc(0, 0, 6, 4), from: at(3, 0), to: at(3, 4) },
    { name: "joint tie", doc: () => jointTieDoc(), from: at(1, 0), to: at(-5, 0) },
    { name: "wall tie", doc: () => wallTieDoc(), from: at(1, 0), to: at(5, 0) },
    { name: "joint near-tie within 1e-9", doc: () => jointTieDoc(1e-12), from: at(1, 0), to: at(-5, 0) },
    { name: "wall near-tie within 1e-9", doc: () => wallTieDoc(1e-12), from: at(1, 0), to: at(5, 0) },
  ])("gives identical results whatever the tables' insertion order: $name", ({ doc, from, to }) => {
    const forward = doc();
    const backward = reversedTables(forward);
    expect(Object.keys(backward.joints)).not.toEqual(Object.keys(forward.joints));
    const a = add(forward, "d", from, to);
    const b = add(backward, "d", from, to);
    expect(b).toEqual(a); // documents and patches
    expect(a.ok).toBe(true);
  });
});
