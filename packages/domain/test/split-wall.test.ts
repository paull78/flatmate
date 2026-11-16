import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import type { Document } from "../src/model";
import { openingGeometry } from "../src/queries/openings";
import { sidesOf } from "../src/wall-sides";
import { rectDoc, withOpening } from "./helpers";

// splitWall (step 12, spec M2 "Split"): a 6 × 4 room; W1 runs J1 (0, 0) → J2 (6, 0), its room face (left of a → b) from
// x 0.1 to 5.9. A split at 1.20 from the face's start lands at x 1.3.

const split = (wallId: string, offset: number, opId = "s"): Command => ({ type: "splitWall", opId, wallId, offset });
const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };

function run(doc: Document, cmd: Command): Document {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

describe("splitWall", () => {
  it("splits at the typed distance from the room face's start, both pieces copying the row (AC-12)", () => {
    const doc = run(rectDoc(0, 0, 6, 4), { type: "setWallSide", wallId: "W1", side: "left", finish: navy, lower: null });
    const after = run(doc, split("W1", 1.2));
    expect(after.joints["s/j0"]).toMatchObject({ x: 1.3, y: 0 });
    expect(after.walls.W1).toMatchObject({ a: "J1", b: "s/j0", thickness: 0.2 });
    expect(after.walls["s/w1"]).toMatchObject({ a: "s/j0", b: "J2", thickness: 0.2, top: "ceiling", base: "floor" });
    expect(sidesOf(after.walls["s/w1"]!)).toEqual(sidesOf(doc.walls.W1!));
    expect(Object.keys(after.walls)).toHaveLength(5);
  });

  it("moves an opening past the split onto the fragment, at its world place", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 4 });
    const before = openingGeometry(doc, "d")?.start;
    const after = run(doc, split("W1", 1.2));
    expect(after.openings.d?.wall).toBe("s/w1");
    expect(openingGeometry(after, "d")?.start).toEqual(before);
  });

  it("refuses a split inside a door, naming it", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1 }); // x 1..1.8
    expect(refusal(doc, split("W1", 1.2))).toBe("A wall can't be split inside door d");
  });

  it("refuses a split leaving a piece shorter than 1 cm", () => {
    expect(refusal(rectDoc(0, 0, 6, 4), split("W1", 5.895))).toBe("Split would leave a wall shorter than 1 cm");
    expect(refusal(rectDoc(0, 0, 6, 4), split("W1", -0.095))).toBe("Split would leave a wall shorter than 1 cm");
  });

  it("refuses a column row, an unknown wall, a used opId and a bad offset", () => {
    const withColumn = run(rectDoc(0, 0, 6, 4), { type: "placeColumn", opId: "c", at: { x: 3, y: 0 }, width: 0.4, depth: 0.3 });
    expect(refusal(withColumn, split("c/w0", 0.1))).toMatch(/Column/);
    expect(refusal(rectDoc(0, 0, 6, 4), split("nope", 1))).toBe("Wall not found");
    expect(refusal(run(rectDoc(0, 0, 6, 4), split("W1", 1.2)), split("W2", 1, "s"))).toBe("Operation ID already used");
    expect(refusal(rectDoc(0, 0, 6, 4), split("W1", Number.NaN))).toBe("Invalid offset");
  });

  it("is one patch that undoes back to the unsplit wall", () => {
    const r = execute(rectDoc(0, 0, 6, 4), split("W1", 1.2));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.puts.map((p) => `${p.table}:${p.entity.id}`).sort()).toEqual(["joints:s/j0", "walls:W1", "walls:s/w1"]);
    expect(r.value.patch.dependencies).toEqual(expect.arrayContaining([{ table: "walls", id: "W1" }, { table: "joints", id: "J1" }, { table: "joints", id: "J2" }]));
  });
});
