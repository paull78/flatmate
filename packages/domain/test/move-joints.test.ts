import { describe, expect, it } from "vitest";
import { addWall } from "../src/commands/add-wall";
import { execute } from "../src/commands/execute";
import { moveJoints } from "../src/commands/move-joints";
import type { Document } from "../src/model";
import { faceAt, zones } from "../src/queries/zones";
import { deepFreeze, docOf, rectDoc } from "./helpers";

/** The demo room split by a divider d/j0 (3, 0) → d/j1 (3, 4), labelled "Left" at (1.5, 2) and "Right" at (4.5, 2). */
function labelledRooms(extra: Document["zoneLabels"] = {}): Document {
  const r = addWall(rectDoc(0, 0, 6, 4), { type: "addWall", opId: "d", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } });
  if (!r.ok) throw new Error(r.error.message);
  return {
    ...r.value.doc,
    zoneLabels: {
      L1: { id: "L1", at: { x: 1.5, y: 2 }, name: "Left" },
      L2: { id: "L2", at: { x: 4.5, y: 2 }, name: "Right" },
      ...extra,
    },
  };
}

function moveDivider(doc: Document, x: number) {
  const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "d/j0", to: { x, y: 0 } }, { jointId: "d/j1", to: { x, y: 4 } }] });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Each zone's labels and area, sorted by labels. */
function labelledAreas(doc: Document): { labels: readonly string[]; area: number | null }[] {
  return zones(doc).map((z) => ({ labels: z.labelIds, area: z.area })).sort((p, q) => String(p.labels).localeCompare(String(q.labels)));
}

describe("moveJoints", () => {
  it("moves a joint; connected walls follow; deps are the joint and its walls", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6, y: 3.5 } }] });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.J3).toEqual({ id: "J3", x: 6, y: 3.5 });
    expect(r.value.patch.puts).toEqual([{ table: "joints", entity: { id: "J3", x: 6, y: 3.5 } }]);
    expect(r.value.patch.before).toEqual([{ table: "joints", id: "J3", value: { id: "J3", x: 6, y: 4 } }]);
    expect(r.value.patch.dependencies).toEqual([
      { table: "joints", id: "J3" }, { table: "walls", id: "W2" }, { table: "walls", id: "W3" },
    ]);
    expect(doc.joints.J3).toEqual({ id: "J3", x: 6, y: 4 }); // input untouched
  });

  it("only the destination matters: a free wall may jump across another wall", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 0, 4], ["C", 2, 1], ["D", 2, 3]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "C", to: { x: -2, y: 1 } }, { jointId: "D", to: { x: -2, y: 3 } }] });
    expect(r.ok).toBe(true);
  });

  it("rejects a destination that crosses a wall, leaving the document unchanged", () => {
    const make = () => docOf({
      joints: [["A", 0, 0], ["B", 0, 4], ["C", 2, 1], ["D", 2, 3]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    const doc = deepFreeze(make());
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "C", to: { x: -2, y: 1 } }] });
    expect(r).toMatchObject({ ok: false, error: { kind: "topology", message: "Walls can't cross" } });
    expect(doc).toEqual(make());
  });

  it("rejects a move that leaves a wall shorter than 1 cm", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6, y: 0.005 } }] }))
      .toMatchObject({ ok: false, error: { kind: "topology", message: "Wall too short" } });
  });

  it("rejects a move that lands a joint within 1 mm of another joint, leaving the document unchanged", () => {
    const make = () => docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 6, 0], ["D", 6, 3]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    const doc = make();
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "C", to: { x: 4.0005, y: 0 } }] });
    expect(r).toMatchObject({ ok: false, error: { kind: "topology" } });
    expect(r.ok ? [] : r.error.violations.map((v) => v.invariant)).toContain("I4");
    expect(doc).toEqual(make());
  });

  it("rejects a move that lands a joint on another wall's body, leaving the document unchanged", () => {
    const make = () => docOf({
      joints: [["A", 0, 0], ["B", 6, 0], ["C", 3, 1], ["D", 3, 4]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    const doc = make();
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "C", to: { x: 3, y: 0 } }] });
    expect(r).toMatchObject({ ok: false, error: { kind: "topology", message: "Walls can't cross" } });
    expect(r.ok ? [] : r.error.violations.map((v) => v.invariant)).toContain("I6");
    expect(doc).toEqual(make());
  });

  it("reports missing joints and bad input", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "X", to: { x: 0, y: 0 } }] })).toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "toString", to: { x: 0, y: 0 } }] })).toMatchObject({ ok: false, error: { kind: "notFound" } });
    expect(moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "J1", to: { x: Number.NaN, y: 0 } }] })).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(moveJoints(doc, { type: "moveJoints", moves: [] })).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
  });
});

describe("moveJoints keeps labels in their rooms", () => {
  it("moves a label the divider passed over back into its own room", () => {
    const doc = deepFreeze(labelledRooms());
    const room = faceAt(doc, { x: 4.5, y: 2 });
    const { doc: after, patch } = moveDivider(doc, 5); // the divider passes over "Right" at x = 4.5

    // The right room is now 5..6 wide; its floor is 5.1..5.9 × 0.1..3.9, centroid (5.5, 2).
    const label = after.zoneLabels.L2;
    expect(label?.at.x).toBeCloseTo(5.5, 9);
    expect(label?.at.y).toBeCloseTo(2, 9);
    expect(label?.name).toBe("Right");
    expect(label && faceAt(after, label.at)?.key).toBe(room?.key);
    expect(labelledAreas(after)).toEqual([
      { labels: ["L1"], area: expect.closeTo(4.8 * 3.8, 9) },
      { labels: ["L2"], area: expect.closeTo(0.8 * 3.8, 9) },
    ]);
    expect(after.zoneLabels.L1).toBe(doc.zoneLabels.L1); // still inside its room: untouched

    expect(patch.puts.filter((p) => p.table === "zoneLabels")).toEqual([{ table: "zoneLabels", entity: label }]);
    expect(patch.before).toContainEqual({ table: "zoneLabels", id: "L2", value: doc.zoneLabels.L2 });
    expect(patch.dependencies).toContainEqual({ table: "zoneLabels", id: "L2" });
    // The new position depends on the room staying as it is, as for labelZone.
    for (const id of room?.wallIds ?? []) expect(patch.dependencies).toContainEqual({ table: "walls", id });
    for (const id of room?.jointIds ?? []) expect(patch.dependencies).toContainEqual({ table: "joints", id });
    expect(patch.dependencies).not.toContainEqual({ table: "zoneLabels", id: "L1" });
  });

  it("leaves labels that stay in their room untouched", () => {
    const doc = labelledRooms();
    const { doc: after, patch } = moveDivider(doc, 4); // "Right" at x = 4.5 stays right of the divider
    expect(after.zoneLabels).toBe(doc.zoneLabels);
    expect(patch.puts.map((p) => p.table)).toEqual(["joints", "joints"]);
    expect(patch.dependencies.some((k) => k.table === "zoneLabels")).toBe(false);
  });

  it("leaves orphan labels where they are", () => {
    const doc = labelledRooms({ L3: { id: "L3", at: { x: 4.5, y: 6 }, name: "Outside" } });
    const { doc: after } = moveDivider(doc, 5);
    expect(after.zoneLabels.L3).toBe(doc.zoneLabels.L3);
  });

  it("keeps the no-op identity: a move to the current position returns the input", () => {
    const doc = labelledRooms();
    const r = execute(doc, { type: "moveJoints", moves: [{ jointId: "d/j0", to: { x: 3, y: 0 } }] });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc).toBe(doc);
  });

  it("uses a point inside the room when the floor's centroid falls outside it", () => {
    // A U-shaped room open at the top; the label sits in the left arm.
    //   J8─J7   J4─J3
    //   │L │     │  │
    //   │  J6───J5  │
    //   J1─────────J2
    const doc = docOf({
      joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 4, 4], ["J5", 4, 1], ["J6", 2, 1], ["J7", 2, 4], ["J8", 0, 4]],
      walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J5"], ["W5", "J5", "J6"], ["W6", "J6", "J7"], ["W7", "J7", "J8"], ["W8", "J8", "J1"]],
      labels: [["L", 0.5, 3, "U"]],
    });
    const room = faceAt(doc, { x: 0.5, y: 3 });
    // Narrowing the left arm to 1..2 pushes the label out; the floor's centroid (≈ 3.7, 1.8) is in the notch.
    const r = moveJoints(doc, { type: "moveJoints", moves: [{ jointId: "J1", to: { x: 1, y: 0 } }, { jointId: "J8", to: { x: 1, y: 4 } }] });
    if (!r.ok) throw new Error(r.error.message);
    const label = r.value.doc.zoneLabels.L;
    expect(label?.at).not.toEqual({ x: 0.5, y: 3 });
    expect(label && faceAt(r.value.doc, label.at)?.key).toBe(room?.key);
  });
});
