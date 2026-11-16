import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults, type Finish } from "../src/finishes";
import type { Document, Wall, WallSides } from "../src/model";
import { hasSides, sidesOf, withSides } from "../src/wall-sides";

const wallSidesOf = (w: Wall | undefined): WallSides | undefined => (w ? sidesOf(w) : undefined);
import { deserialize, serialize } from "../src/serialize";
import { parseWall } from "../src/shape";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

// A wall side's finish and lower band (surfaces.03, .04; step 02, AC-01).

const white = { ...motifDefaults("plain"), colour: "#f2f0eb" };
const tiles = motifDefaults("squareTiles");
const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const set = (side: "left" | "right", part: "finish" | "lower", finish: Finish | null, height?: number): Command =>
  height === undefined ? { type: "setWallFinish", wallId: "W1", side, part, finish } : { type: "setWallFinish", wallId: "W1", side, part, finish, height };

describe("the wall row's finishes, stored flat (AC-01, surfaces.33)", () => {
  it("a wall row without finishes parses and round-trips unchanged", () => {
    const doc = rectDoc(0, 0, 6, 4);
    expect(parseWall(doc.walls.W1)).toEqual(doc.walls.W1);
    const back = deserialize(serialize(doc));
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value.walls).toEqual(doc.walls);
    expect(back.value.walls.W1 && hasSides(back.value.walls.W1)).toBe(false);
  });

  it("a wall row with finishes stores flat fields only, parses and round-trips", () => {
    const sides: WallSides = { left: { finish: white, lower: { finish: tiles, height: 1.2 } }, right: null };
    const doc = rectDoc(0, 0, 6, 4);
    const w1 = doc.walls.W1;
    if (!w1) throw new Error("no W1");
    const row = withSides(w1, sides);
    expect(row).toEqual({ ...w1, finishLeft: white, lowerLeft: tiles, lowerLeftHeight: 1.2 });
    for (const v of Object.values(row)) if (typeof v === "object") for (const f of Object.values(v)) expect(typeof f).not.toBe("object"); // the wire's flat rule
    expect(parseWall(row)).toEqual(row);
    expect(sidesOf(row)).toEqual(sides);
    const back = deserialize(serialize({ ...doc, walls: { ...doc.walls, W1: row } }));
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value.walls.W1).toEqual(row);
  });

  it("the validator refuses a floor-only motif, a band out of range and a band without its height", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const w1 = doc.walls.W1;
    if (!w1) throw new Error("no W1");
    const withRow = (fields: Partial<typeof w1>): Document => ({ ...doc, walls: { ...doc.walls, W1: { ...w1, ...fields } } });
    const messages = (d: Document): string[] => { const r = validateDocument(d); return r.ok ? [] : r.error.map((v) => v.message); };
    expect(messages(withRow({ finishLeft: white }))).toEqual([]);
    expect(messages(withRow({ finishLeft: motifDefaults("herringbone") })).join()).toMatch(/finishLeft.motif must be a wall motif/);
    expect(messages(withRow({ finishLeft: white, lowerLeft: tiles, lowerLeftHeight: 3.1 })).join()).toMatch(/lowerLeftHeight must be 0.10–3.00/);
    expect(messages(withRow({ lowerLeft: tiles, lowerLeftHeight: 1.2 })).join()).toMatch(/lowerLeft needs finishLeft/); // a custom side has a finish (inherit.02)
    expect(messages(withRow({ lowerRight: tiles })).join()).toMatch(/lowerRight and lowerRightHeight go together/);
    expect(messages(withRow({ lowerRightHeight: 1.2 })).join()).toMatch(/lowerRight and lowerRightHeight go together/);
  });
});

describe("setWallFinish (AC-01)", () => {
  it("sets the left side's finish only", () => {
    const doc = run(rectDoc(0, 0, 6, 4), set("left", "finish", white));
    expect(wallSidesOf(doc.walls.W1)).toEqual({ left: { finish: white, lower: null }, right: null });
    expect(wallSidesOf(doc.walls.W2)).toBeUndefined();
  });

  it("sets the lower band with its height; the finish can't be cleared (inherit.02)", () => {
    const banded = run(run(rectDoc(0, 0, 6, 4), set("left", "finish", white)), set("left", "lower", tiles, 1.2));
    expect(wallSidesOf(banded.walls.W1)?.left).toEqual({ finish: white, lower: { finish: tiles, height: 1.2 } });
    expect(refusal(banded, set("left", "finish", null))).toBe("A custom side needs a finish; Reset returns it to its room's");
    expect(wallSidesOf(run(banded, set("left", "lower", null)).walls.W1)?.left).toEqual({ finish: white, lower: null });
  });

  it("resetWallSide removes a side, and both sides leave the row as it was (inherit.04)", () => {
    const both = run(run(rectDoc(0, 0, 6, 4), set("left", "finish", white)), set("right", "finish", tiles));
    const leftGone = run(both, { type: "resetWallSide", wallId: "W1", side: "left" });
    expect(wallSidesOf(leftGone.walls.W1)).toEqual({ left: null, right: { finish: tiles, lower: null } });
    const none = run(leftGone, { type: "resetWallSide", wallId: "W1", side: "right" });
    expect(none.walls.W1 && hasSides(none.walls.W1)).toBe(false);
    expect(none.walls.W1).toEqual(rectDoc(0, 0, 6, 4).walls.W1);
  });

  it("refuses herringbone, naming the wall motifs", () => {
    expect(refusal(rectDoc(0, 0, 6, 4), set("left", "finish", motifDefaults("herringbone")))).toMatch(/^finish.motif must be a wall motif: /);
  });

  it("refuses a band height out of range, not in whole millimetres, or missing", () => {
    const doc = run(rectDoc(0, 0, 6, 4), set("left", "finish", white));
    expect(refusal(doc, set("left", "lower", tiles, 0.05))).toBe("height must be 0.10–3.00");
    expect(refusal(doc, set("left", "lower", tiles, 3.1))).toBe("height must be 0.10–3.00");
    expect(refusal(doc, set("left", "lower", tiles, 1.2005))).toBe("height must be whole millimetres");
    expect(refusal(doc, set("left", "lower", tiles))).toBe("height must be 0.10–3.00");
    expect(refusal(doc, set("left", "lower", null))).toBe("accepted"); // clearing needs no height
  });

  it("refuses a column and an unknown wall", () => {
    const doc = docOf({ joints: [["a", 0, 0], ["b", 0.3, 0]], columns: [["W1", "a", "b", 0.3]] });
    expect(refusal(doc, set("left", "finish", white))).toBe("A column takes no finish");
    expect(refusal(rectDoc(0, 0, 6, 4), { type: "setWallFinish", wallId: "nope", side: "left", part: "finish", finish: white })).toBe("Wall not found");
  });

  it("the same finish again commits nothing, and the colour is stored in lower case", () => {
    const doc = run(rectDoc(0, 0, 6, 4), set("left", "finish", { ...white, colour: "F2F0EB" }));
    expect(wallSidesOf(doc.walls.W1)?.left?.finish?.colour).toBe("#f2f0eb");
    const r = execute(doc, set("left", "finish", white));
    if (!r.ok) throw new Error(r.error.message);
    expect([r.value.patch.puts, r.value.patch.deletes]).toEqual([[], []]);
  });
});
