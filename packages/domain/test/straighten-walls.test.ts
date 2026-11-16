import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import { nearSide, straightenPlans } from "../src/commands/straighten-walls";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { footprints } from "../src/queries/footprints";
import { offAxisAngle } from "../src/queries/runs";
import { docOf, place, rectDoc } from "./helpers";
import { kinkedHouseDoc } from "./fixtures/kinked-house";

// straightenWalls (straight.43): a nearly straight, nearly square side, in one or several pieces, lands exactly on one
// axis line; the line most of the side already holds wins, and the next one is tried when the drawing refuses it.

const straighten = (wallId: string): Command => ({ type: "straightenWalls", wallId });
const slanted = (doc: Document): string[] => Object.keys(doc.walls).filter((id) => { const a = offAxisAngle(doc, id); return a > 0 && a <= 1; });

describe("straightenWalls", () => {
  it("puts the kinked house's whole top side on one line, from its slanted piece: no slant left, the verticals vertical", () => {
    const doc = kinkedHouseDoc();
    expect(slanted(doc)).toEqual(["w372a"]);
    expect(nearSide(doc, "w372a")?.walls).toEqual(["wafdb", "w372a", "wc9b9", "wdb4fb"]);
    const r = execute(doc, straighten("w372a"));
    if (!r.ok) throw new Error(r.error.message);
    const after = r.value.doc;
    expect(slanted(after)).toEqual([]);
    const ys = ["afdba", "372a", "c9b9", "db4f", "afdbb"].map((j) => after.joints[j]?.y);
    expect(new Set(ys).size).toBe(1);
    expect(after.joints.afdba?.x).toBe(3);
    expect(after.joints["372a"]?.x).toBe(7.256);
  });

  it("any piece of the side gives the same result", () => {
    const a = execute(kinkedHouseDoc(), straighten("w372a"));
    const b = execute(kinkedHouseDoc(), straighten("wdb4fb"));
    expect(a.ok && b.ok && a.value.doc.joints).toEqual(b.ok && b.value.doc.joints);
  });

  it("takes the line most of the side holds, and the other one when a piece is in the way", () => {
    // A side in two stretches: 6 m at y 0, then 2 m at y 0.01. The long stretch's line wins: the short one moves.
    const base = docOf({ joints: [["A", 0, 0], ["B", 6, 0], ["C", 8, 0.01]], walls: [["L", "A", "B"], ["S", "B", "C"]] });
    const r = execute(base, straighten("S"));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.doc.joints.C).toMatchObject({ x: 8, y: 0 });
    // The same on a room's top side, 2 cm off, with a chair against the short stretch's inner face: moving that stretch
    // down would run into it, so the long stretch comes up instead.
    const room = docOf({
      joints: [["J1", 0, 0], ["J2", 8, 0], ["J3", 8, 4.02], ["M", 6, 4], ["J4", 0, 4]],
      walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["S", "J3", "M"], ["L", "M", "J4"], ["W4", "J4", "J1"]],
    });
    const probe = place(room, { object: "ch", kind: "chair", at: [7.6, 3] });
    const top = Math.max(...(footprints(probe).get("ch/s0") ?? []).map((q) => q.y));
    const blocked = place(room, { object: "ch", kind: "chair", at: [7.6, 3 + (3.91 - top)] }); // its far edge at y 3.91, just under S's face there
    expect(execute(blocked, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 8, y: 4 } }] }).ok).toBe(false); // the short stretch can't come down
    const moved = execute(blocked, straighten("L"));
    if (!moved.ok) throw new Error(moved.error.message);
    expect([moved.value.doc.joints.J4?.y, moved.value.doc.joints.M?.y, moved.value.doc.joints.J3?.y]).toEqual([4.02, 4.02, 4.02]);
  });

  it("has nothing to do on a straight side or one more than 1° off both axes", () => {
    expect(straightenPlans(rectDoc(0, 0, 6, 4), "W1")).toBeNull();
    expect(execute(rectDoc(0, 0, 6, 4), straighten("W1")).ok).toBe(false);
    const diagonal = docOf({ joints: [["A", 0, 0], ["B", 3, 1]], walls: [["D", "A", "B"]] });
    expect(straightenPlans(diagonal, "D")).toBeNull();
  });

  it("is one patch, depending on the moved joints and their walls", () => {
    const r = execute(kinkedHouseDoc(), straighten("w372a"));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.puts.every((p) => p.table === "joints")).toBe(true);
    const deps = r.value.patch.dependencies.map((d) => `${d.table}/${d.id}`);
    expect(deps.filter((d) => d.startsWith("joints/")).length).toBeGreaterThan(0);
    expect(deps).toContain("walls/w372a");
  });
});
