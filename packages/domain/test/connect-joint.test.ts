import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { incidentWalls } from "../src/graph";
import type { Document } from "../src/model";
import { zones } from "../src/queries/zones";
import { docOf, rectDoc } from "./helpers";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// connectJoint (straight.06, .18, step 13): a joint dropped on a joint merges into it, on a wall's body splits it and
// joins; anywhere else it is a plain move. Explicit refusals; dimensions on the dropped joint re-pointed.

const connect = (jointId: string, x: number, y: number, opId = "c"): Command => ({ type: "connectJoint", opId, jointId, to: { x, y } });

function run(doc: Document, cmd: Command): Document {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/** The 6 × 4 room plus a free wall inside it from (1, 1) to (3, 1), its end F loose. */
const withFree = (): Document => {
  const doc = rectDoc(0, 0, 6, 4);
  doc.joints.E = { id: "E", x: 1, y: 1 };
  doc.joints.F = { id: "F", x: 3, y: 1 };
  doc.walls.FW = { id: "FW", a: "E", b: "F", thickness: 0.2, top: "ceiling", base: "floor", column: false };
  return doc;
};

describe("connectJoint", () => {
  it("drops the kinked house's loose wall end onto the corner: the corner then holds three walls (AC-13)", () => {
    const after = run(kinkedHouseDoc(), connect("bde4", 10.298, -1.5));
    expect(after.joints.bde4).toBeUndefined();
    expect(incidentWalls(after, "d03f").sort()).toEqual(["wbde4", "wd03fa", "wd03fb"]);
    expect(after.walls.wbde4).toMatchObject({ a: "0d42", b: "d03f" });
  });

  it("drops a free end on a wall's body: a T, the moving joint reused as the split joint", () => {
    const after = run(withFree(), connect("F", 3, 0)); // onto the bottom wall W1
    expect(after.joints.F).toMatchObject({ x: 3, y: 0 });
    expect(incidentWalls(after, "F").sort()).toEqual(["FW", "W1", "c/w1"]);
    expect(after.walls.W1).toMatchObject({ a: "J1", b: "F" });
    expect(after.walls["c/w1"]).toMatchObject({ a: "F", b: "J2" });
    expect(Object.keys(after.walls)).toHaveLength(6);
  });

  it("refuses a drop on the far end of its own wall", () => {
    expect(refusal(withFree(), connect("F", 1, 1))).toBe("Wall too short");
  });

  it("refuses a drop that would make two walls between the same joints", () => {
    const doc = rectDoc(0, 0, 6, 4);
    doc.joints.F = { id: "F", x: 3, y: 2 };
    doc.walls.FW = { id: "FW", a: "J1", b: "F", thickness: 0.2, top: "ceiling", base: "floor", column: false };
    expect(refusal(doc, connect("F", 6, 0))).toBe("Walls can't overlap"); // onto J2: W1 already runs J1 → J2
  });

  it("refuses a drop half a millimetre from a column's joint, naming the column (the named I20 refusal wins)", () => {
    const base = run(rectDoc(0, 0, 6, 4), { type: "placeColumn", opId: "k", at: { x: 3, y: 2 }, width: 0.4, depth: 0.4 });
    const column = base.walls["k/w0"];
    const cj = column ? base.joints[column.a] : undefined;
    if (!cj) throw new Error("no column joint");
    base.joints.F = { id: "F", x: 1, y: 3 };
    base.joints.G = { id: "G", x: 1, y: 3.5 };
    base.walls.FW = { id: "FW", a: "G", b: "F", thickness: 0.2, top: "ceiling", base: "floor", column: false };
    expect(refusal(base, connect("F", cj.x + 0.0005, cj.y))).toMatch(/Column k\/w0/);
  });

  it("anywhere else is a plain move, the same drawing as moveJoints", () => {
    const a = run(withFree(), connect("F", 3.5, 1.5));
    const b = run(withFree(), { type: "moveJoints", moves: [{ jointId: "F", to: { x: 3.5, y: 1.5 } }] });
    expect(a).toEqual(b);
  });

  it("re-points a dimension anchored to the dropped joint onto the joint it merged into", () => {
    const doc = run(kinkedHouseDoc(), { type: "addDimension", opId: "m", a: { x: 10.2, y: -1.5 }, b: { x: 8.875, y: -1.5 }, offset: 0.5 });
    const dim = Object.values(doc.dimensions)[0];
    expect(dim && "joint" in dim.a && dim.a.joint).toBe("bde4");
    const after = run(doc, connect("bde4", 10.298, -1.5));
    const moved = Object.values(after.dimensions)[0];
    expect(moved && "joint" in moved.a && moved.a.joint).toBe("d03f");
  });

  it("a merge that closes a room keeps the label in it", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["E", 0, 3.9]],
      walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J1", "E"]],
      labels: [["L", 3, 2, "Room"]],
    });
    expect(zones(doc).some((z) => z.labelIds.includes("L"))).toBe(false);
    const after = run(doc, connect("E", 0, 4));
    expect(zones(after).some((z) => z.labelIds.includes("L"))).toBe(true);
  });

  it("refuses a column's own joint with the lock, a bad opId, an unknown joint", () => {
    const base = run(rectDoc(0, 0, 6, 4), { type: "placeColumn", opId: "k", at: { x: 3, y: 0 }, width: 0.4, depth: 0.3 });
    const column = base.walls["k/w0"];
    expect(refusal(base, connect(column?.a ?? "", 3, 1))).toMatch(/Column k\/w0/);
    expect(refusal(withFree(), connect("F", 3, 0, "bad id"))).toBe("Invalid operation ID");
    expect(refusal(withFree(), connect("nope", 3, 0))).toBe("Joint not found");
  });
});
