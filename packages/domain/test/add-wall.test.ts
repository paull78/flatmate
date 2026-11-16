import { describe, expect, it } from "vitest";
import { unwrap, type EntityKey } from "@fm/protocol";
import { addWall } from "../src/commands/add-wall";
import type { JointRef } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { onFloor } from "../src/queries/floor";
import { faceAt, zoneOfLabel, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc, withOpening } from "./helpers";

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
  return { ...doc, joints: reversed(doc.joints), walls: reversed(doc.walls), zoneLabels: reversed(doc.zoneLabels) };
}

describe("addWall", () => {
  it("creates a free wall with IDs op/j0, op/j1, op/w0", () => {
    const { doc, patch } = ok(emptyDocument(), "op1", at(0, 0), at(6, 0));
    expect(doc.joints).toEqual({ "op1/j0": { id: "op1/j0", x: 0, y: 0 }, "op1/j1": { id: "op1/j1", x: 6, y: 0 } });
    expect(doc.walls).toEqual({ "op1/w0": { id: "op1/w0", a: "op1/j0", b: "op1/j1", thickness: 0.2, top: "ceiling", base: "floor", column: false } });
    expect(patch.deletes).toEqual([]);
    expect(patch.dependencies).toEqual([]);
  });

  it("reuses a joint within EPS and records it as a dependency", () => {
    const first = ok(emptyDocument(), "op1", at(0, 0), at(6, 0));
    const { doc, patch } = ok(first.doc, "op2", at(6.0004, 0), at(6, 4));
    expect(doc.walls["op2/w0"]).toEqual({ id: "op2/w0", a: "op1/j1", b: "op2/j0", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(patch.dependencies).toEqual([{ table: "joints", id: "op1/j1" }]);
  });

  it("accepts an existing-joint reference", () => {
    const first = ok(emptyDocument(), "op1", at(0, 0), at(6, 0));
    const { doc } = ok(first.doc, "op2", { existing: "op1/j0" }, at(0, 4));
    expect(doc.walls["op2/w0"]?.a).toBe("op1/j0");
    expect(add(first.doc, "op3", { existing: "nope" }, at(1, 1))).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("splitting a half wall keeps its top on both parts; the new wall goes to the ceiling (heights.31)", () => {
    const room = rectDoc(0, 0, 6, 4);
    const half: Document = { ...room, walls: { ...room.walls, W1: { id: "W1", a: "J1", b: "J2", thickness: 0.2, top: 1.1, base: "floor", column: false } } };
    const { doc } = ok(half, "d", at(3, 0), at(3, 2));
    expect([doc.walls.W1?.top, doc.walls["d/w1"]?.top, doc.walls["d/w0"]?.top]).toEqual([1.1, 1.1, "ceiling"]);
  });

  it("splits a wall at a T-junction; the a-side fragment keeps the wall's ID", () => {
    const room = rectDoc(0, 0, 6, 4); // W1: J1(0,0) → J2(6,0)
    const { doc, patch } = ok(room, "d", at(3, 0), at(3, 2));
    expect(doc.joints["d/j0"]).toEqual({ id: "d/j0", x: 3, y: 0 });
    expect(doc.walls.W1).toEqual({ id: "W1", a: "J1", b: "d/j0", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(doc.walls["d/w1"]).toEqual({ id: "d/w1", a: "d/j0", b: "J2", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "d/j0", b: "d/j1", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "walls", id: "W1" },
    ]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("splits both walls for the sample divider (3,0) → (3,4)", () => {
    const { doc, patch } = ok(rectDoc(0, 0, 6, 4), "d", at(3, 0), at(3, 4));
    expect(doc.walls["d/w0"]).toEqual({ id: "d/w0", a: "d/j0", b: "d/j1", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(doc.walls["d/w1"]).toEqual({ id: "d/w1", a: "d/j0", b: "J2", thickness: 0.2, top: "ceiling", base: "floor", column: false });   // from-side fragment of W1
    expect(doc.walls.W3).toEqual({ id: "W3", a: "J3", b: "d/j1", thickness: 0.2, top: "ceiling", base: "floor", column: false });          // W3: J3(6,4) → J4(0,4)
    expect(doc.walls["d/w2"]).toEqual({ id: "d/w2", a: "d/j1", b: "J4", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    // spec: collaboration: split walls and their endpoints.
    expect(patch.dependencies).toEqual([
      { table: "joints", id: "J1" }, { table: "joints", id: "J2" }, { table: "joints", id: "J3" }, { table: "joints", id: "J4" },
      { table: "walls", id: "W1" }, { table: "walls", id: "W3" },
    ]);
    expect(patch.before).toEqual([
      { table: "joints", id: "d/j0", value: null },
      { table: "joints", id: "d/j1", value: null },
      { table: "walls", id: "W1", value: { id: "W1", a: "J1", b: "J2", thickness: 0.2, top: "ceiling", base: "floor", column: false } },
      { table: "walls", id: "W3", value: { id: "W3", a: "J3", b: "J4", thickness: 0.2, top: "ceiling", base: "floor", column: false } },
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
    expect(add(emptyDocument(), "x", at(0, 0), at(0.005, 0)))
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
    const first = ok(emptyDocument(), "op1", at(0, 0), at(6, 0));
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
    expect(next.walls.WA).toEqual({ id: "WA", a: "A1", b: "x/j0", thickness: 0.2, top: "ceiling", base: "floor", column: false });
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
    expect(next.walls.WA).toEqual({ id: "WA", a: "A1", b: "x/j0", thickness: 0.2, top: "ceiling", base: "floor", column: false });
  });

  it("refuses an invalid operation ID and one longer than 120 characters", () => {
    const empty: Document = emptyDocument();
    for (const opId of ["not valid", "toString", "", "x".repeat(121)]) {
      expect(add(empty, opId, at(0, 0), at(1, 0)), opId).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    }
    expect(add(empty, "x".repeat(120), at(0, 0), at(1, 0)).ok).toBe(true);
  });

  it("refuses a non-finite point", () => {
    const empty: Document = emptyDocument();
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

describe("addWall: thickness (layout-states.27)", () => {
  it("stores the given thickness on the new wall and 0.20 by default", () => {
    const thin = unwrapOk(addWall(docOf({}), { type: "addWall", opId: "t", from: at(0, 0), to: at(3, 0), thickness: 0.1 }));
    expect(thin.doc.walls["t/w0"]?.thickness).toBe(0.1);
    expect(ok(docOf({}), "d", at(0, 0), at(3, 0)).doc.walls["d/w0"]?.thickness).toBe(0.2);
  });

  it("a split keeps the split wall's thickness on both fragments; the new wall has its own", () => {
    const doc = docOf({ joints: [["A", 0, 0], ["B", 4, 0]], walls: [["W", "A", "B", 0.3]] });
    const r = unwrapOk(addWall(doc, { type: "addWall", opId: "s", from: at(2, 0), to: at(2, 3), thickness: 0.1 }));
    expect(r.doc.walls.W?.thickness).toBe(0.3);
    expect(r.doc.walls["s/w1"]?.thickness).toBe(0.3);
    expect(r.doc.walls["s/w0"]?.thickness).toBe(0.1);
    expect(validateDocument(r.doc).ok).toBe(true);
  });

  it("refuses a thickness outside 0.05 to 0.50 m or not a number", () => {
    for (const thickness of [0.04, 0.51, Number.NaN]) {
      expect(addWall(docOf({}), { type: "addWall", opId: "t", from: at(0, 0), to: at(3, 0), thickness })).toMatchObject({
        ok: false, error: { kind: "invalidInput", message: "Wall thickness must be between 0.05 and 0.50 m" },
      });
    }
  });
});

function unwrapOk<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("addWall and openings (spec: openings)", () => {
  it("a new wall ending inside a door's span is refused; one ending past it splits the wall and the door lands on the right fragment (AC-19)", () => {
    const inside = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 2.6 }); // 2.6–3.4
    const r = add(inside, "x", at(3, 0), at(3, 4));
    expect(r.ok ? "accepted" : r.error.message).toBe("A wall can't end inside door d");
    // The refusal carries its facts as data (arch-review R-09): an I12 violation naming the opening and the wall.
    expect(r.ok ? [] : r.error.violations).toEqual([
      { invariant: "I12", message: "A wall can't end inside door d", entities: [{ table: "openings", id: "d" }, { table: "walls", id: "W1" }] },
    ]);

    let doc = withOpening(rectDoc(0, 0, 6, 4), { id: "far", wall: "W1", offset: 3.5 }); // 3.5–4.3, past the split
    doc = withOpening(doc, { id: "near", wall: "W1", offset: 1 }); // 1–1.8, before it
    doc = withOpening(doc, { id: "edge", wall: "W1", offset: 2.2 }); // 2.2–3.0, touching it
    const { doc: next, patch } = ok(doc, "x", at(3, 0), at(3, 4));
    expect(next.walls["x/w1"]).toMatchObject({ a: "x/j0", b: "J2" });
    expect(next.openings.far).toEqual({ ...doc.openings.far, wall: "x/w1", offset: 0.5 });
    expect(next.openings.near).toEqual(doc.openings.near);
    expect(next.openings.edge).toEqual(doc.openings.edge);
    expect(patch.dependencies).toEqual(expect.arrayContaining([{ table: "openings", id: "far" }]));
  });
});

describe("addWall keeps labels in their rooms (holes.03)", () => {
  /** The 10 × 8 apartment (W1..W4, J1..J4) labelled "Living" (L) at `p`. */
  const living = (p: { x: number; y: number }): Document => ({ ...rectDoc(0, 0, 10, 8), zoneLabels: { L: { id: "L", at: p, name: "Living", finish: null } } });
  const apartmentKey = (doc: Document) => faceAt(doc, { x: 1, y: 1 })?.key;
  /** Core C's first three walls, (3.5, 2.5) → (6.5, 2.5) → (6.5, 5.5) → (3.5, 5.5): a run that closes no loop. */
  function threeCoreWalls(doc: Document): Document[] {
    const c1 = ok(doc, "c1", at(3.5, 2.5), at(6.5, 2.5)).doc;
    const c2 = ok(c1, "c2", at(6.5, 2.5), at(6.5, 5.5)).doc;
    const c3 = ok(c2, "c3", at(6.5, 5.5), at(3.5, 5.5)).doc;
    return [c1, c2, c3];
  }
  /** The room containing `p` (faces carry no labels; zones do). */
  const zoneAt = (doc: Document, p: { x: number; y: number }) => zones(doc).find((z) => z.face.key === faceAt(doc, p)?.key);
  const labelKeys = (deps: readonly EntityKey[]) => deps.filter((k) => k.table === "zoneLabels");

  it("closing a free-standing core around a label moves the label onto the ring's floor (AC-13)", () => {
    const start = living({ x: 5, y: 4 });
    const key = apartmentKey(start);
    const [c1, c2, c3] = threeCoreWalls(start);
    for (const doc of [c1, c2, c3]) expect(doc?.zoneLabels).toBe(start.zoneLabels);
    if (!c3) throw new Error("no c3");
    const { doc: after, patch } = ok(c3, "c4", at(3.5, 5.5), at(3.5, 2.5));

    const label = after.zoneLabels.L;
    expect(label?.at.x).toBeCloseTo(1.75, 6);
    expect(label?.at.y).toBeCloseTo(4, 6);
    const zone = zoneOfLabel(after, "L");
    expect(zone && label && onFloor(zone, label.at)).toBe(true);
    expect(zone?.face.key).toBe(key);
    const core = faceAt(after, { x: 5, y: 4 });
    expect(core?.key).not.toBe(key);
    expect(zoneAt(after, { x: 5, y: 4 })?.labelIds).toEqual([]);

    expect(patch.puts).toContainEqual({ table: "zoneLabels", entity: label });
    expect(patch.before).toContainEqual({ table: "zoneLabels", id: "L", value: { id: "L", at: { x: 5, y: 4 }, name: "Living", finish: null } });
    const expected: EntityKey[] = [
      { table: "zoneLabels", id: "L" },
      ...["W1", "W2", "W3", "W4"].map((id): EntityKey => ({ table: "walls", id })),
      ...["J1", "J2", "J3", "J4"].map((id): EntityKey => ({ table: "joints", id })),
      ...(core?.wallIds ?? []).map((id): EntityKey => ({ table: "walls", id })),
      ...(core?.jointIds ?? []).map((id): EntityKey => ({ table: "joints", id })),
    ];
    expect(core?.wallIds).toHaveLength(4);
    expect(patch.dependencies).toEqual(expect.arrayContaining(expected));

    expect(unwrap(applyPatch(after, invertPatch(patch)))).toEqual(c3);
  });

  it("a closet built against the room's walls splits it: the label names the closet (AC-15)", () => {
    const start = living({ x: 8, y: 6 });
    const k1 = ok(start, "k1", at(7, 8), at(7, 5)).doc; // splits W3
    const { doc: after, patch } = ok(k1, "k2", at(7, 5), at(10, 5)); // splits W2
    expect(after.zoneLabels.L).toBe(start.zoneLabels.L);
    const closet = faceAt(after, { x: 8, y: 6 });
    expect(zoneOfLabel(after, "L")?.face.key).toBe(closet?.key);
    expect(closet?.ring).toHaveLength(4);
    expect(zoneAt(after, { x: 2, y: 2 })?.labelIds).toEqual([]);
    expect(labelKeys(patch.dependencies)).toEqual([]);
  });

  it("a free-standing closet around the label leaves it on the apartment (AC-15)", () => {
    const start = living({ x: 8, y: 6 });
    const key = apartmentKey(start);
    let doc = start;
    const corners = [at(7, 5), at(9, 5), at(9, 7), at(7, 7), at(7, 5)];
    for (let i = 0; i < 4; i++) {
      const from = corners[i];
      const to = corners[i + 1];
      if (!from || !to) throw new Error("corner");
      doc = ok(doc, `k${i}`, from, to).doc;
    }
    const label = doc.zoneLabels.L;
    expect(label?.at.x).toBeCloseTo(5, 6);
    expect(label?.at.y).toBeCloseTo(4, 6);
    const inFootprint = !!label && label.at.x > 6.9 && label.at.x < 9.1 && label.at.y > 4.9 && label.at.y < 7.1;
    expect(inFootprint).toBe(false);
    expect(zoneOfLabel(doc, "L")?.face.key).toBe(key);
    expect(zoneAt(doc, { x: 8, y: 6 })?.labelIds).toEqual([]);
  });

  it("a core drawn away from the label leaves labels untouched", () => {
    const start = living({ x: 1, y: 1 });
    const [, , c3] = threeCoreWalls(start);
    if (!c3) throw new Error("no c3");
    const { doc: after, patch } = ok(c3, "c4", at(3.5, 5.5), at(3.5, 2.5));
    expect(after.zoneLabels).toBe(start.zoneLabels);
    expect(labelKeys(patch.dependencies)).toEqual([]);
  });
});
