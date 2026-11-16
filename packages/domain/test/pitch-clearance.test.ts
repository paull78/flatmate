import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { rectangleRoom, type Document } from "../src";
import { defaultSize } from "../src/kinds";
import { emptyDocument } from "../src/model";
import { candidateShape, footprintFit } from "../src/queries/fit";
import { stairChecks } from "../src/queries/stair-checks";
import { rng } from "./helpers";

// A flight is solid only under its pitch line, and a person needs 1.00 m over it (riser.08, .15, .04): whatever leaves
// that clears it, whether a slab or a hung piece; a tight fit is the headroom warning; a rung ladder and a spiral keep their box.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/** An 8 × 3 m room, faces x 0.1–7.9, y 0.1–2.9, under a 5.40 ceiling, so the ceiling never sets the headroom. */
function room(ceiling = 5.4): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 8, 3, "r")) doc = run(doc, cmd);
  return run(doc, { type: "setCeiling", height: ceiling });
}

const FLOOR = "floor/k0";
/** The room with a slab over all of it, 2.58–2.70, and a hole `length` long ending at x 6, y 1–2. */
function floorWithHole(length: number): Document {
  let doc = run(room(), { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2.7 });
  doc = run(doc, { type: "addDeckHole", opId: "h", deck: FLOOR, at: { x: 6 - length / 2, y: 1.5 }, w: length, d: 1 });
  return doc;
}
/** 15 risers of 0.18, going 0.27, 3.78 m, rising toward +x with its back at (x, 1.5), reaching the slab. */
const flight = (kind = "stair", x = 6, extra: Partial<Extract<Command, { type: "placeObject" }>> = {}): Command => ({
  type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w: 0.9, d: 3.78 } }, at: { x, y: 1.5 }, rotation: 270, deck: null, reaches: FLOOR, ...extra,
});
const headroom = (doc: Document): number => {
  const c = stairChecks(doc, "st/o0").find((x) => x.id === "headroom");
  if (!c || c.id === "reach") throw new Error("no headroom check");
  return c.value;
};

describe("a shorter hole (AC-03)", () => {
  it("takes the whole flight, as today", () => {
    expect(refusal(floorWithHole(3.78), flight())).toBe("accepted");
  });

  it("takes a hole of 3.20 m with comfortable headroom", () => {
    const doc = run(floorWithHole(3.2), flight());
    expect(headroom(doc)).toBeCloseTo(2.013, 2);
    expect(stairChecks(doc, "st/o0").find((c) => c.id === "headroom")?.ok).toBe(true);
  });

  it("takes a hole of 2.50 m, and the headroom warning says so", () => {
    const doc = run(floorWithHole(2.5), flight());
    expect(headroom(doc)).toBeCloseTo(1.547, 2);
    expect(stairChecks(doc, "st/o0").find((c) => c.id === "headroom")?.ok).toBe(false);
  });

  it("lets a hole be shrunk under a stair already there", () => {
    const doc = run(floorWithHole(3.78), flight());
    const hole = Object.keys(doc.deckHoles)[0] ?? "";
    expect(refusal(doc, { type: "setDeckHole", holeId: hole, at: { x: 4.4, y: 1.5 }, w: 3.2 })).toBe("accepted");
  });

  it("is what the preview says too", () => {
    const doc = floorWithHole(2.5);
    const shape = candidateShape("stair", { x: 6, y: 1.5 }, 0.9, 3.78, 270);
    const pose = { kind: "stair", at: { x: 6, y: 1.5 }, rotation: 270, w: 0.9, d: 3.78, riser: null };
    expect(footprintFit(doc, shape.ring, "s0", { h: 2.7, z: 0 }, null, [], shape.centre, pose).fits).toBe(true);
    expect(footprintFit(doc, shape.ring, "s0", { h: 2.7, z: 0 }, null, [], shape.centre, undefined).fits).toBe(false);
  });
});

describe("room to get past (AC-03, riser.15)", () => {
  it("takes 1.70 m of hole, about 1.01 m of clearance, and refuses 1.65 m, about 0.97 m", () => {
    expect(refusal(floorWithHole(1.7), flight())).toBe("accepted");
    expect(refusal(floorWithHole(1.65), flight())).toContain("0.00–2.70");
  });

  it("refuses a 0.50 m hole and no hole at all, with both heights", () => {
    expect(refusal(floorWithHole(0.5), flight())).toContain("2.58–2.70");
    expect(refusal(run(room(), { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2.7 }), flight())).toContain("2.58–2.70");
  });

  it("refuses deleting the stair's only hole, and shrinking it past the line", () => {
    const doc = run(floorWithHole(3.2), flight());
    const hole = Object.keys(doc.deckHoles)[0] ?? "";
    expect(refusal(doc, { type: "deleteEntities", ids: [{ table: "deckHoles", id: hole }] })).toContain("Stair");
    expect(refusal(doc, { type: "setDeckHole", holeId: hole, at: { x: 5.5, y: 1.5 }, w: 1 })).toContain("Stair");
    expect(refusal(doc, { type: "setDeckHole", holeId: hole, at: { x: 5, y: 1.5 }, w: 2 })).toBe("accepted");
  });
});

describe("what leaves too little over the pitch line collides (AC-03, AC-11)", () => {
  /** A stair rising 2.70, 3.78 m, with its back at (x, 1.5) turned by `rotation`, in a room under `ceiling`. */
  const standing = (x: number, rotation: number, kind = "stair", ceiling = 5.4): Document => {
    const doc = run(room(ceiling), { type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w: 0.9, d: 3.78 } }, at: { x, y: 1.5 }, rotation, deck: null });
    return run(doc, { type: "setObjectSize", objectId: "st/o0", w: 0.9, d: {}, h: { standard: 2.7 } });
  };
  /** A lower deck's slab, 2.08–2.20, over x from..to, y 0.1–2.9. */
  const slab = (from: number, to: number): Command => ({ type: "addDeck", opId: "low", preset: "loft", at: { x: (from + to) / 2, y: 1.5 }, w: to - from, d: 2.8, top: 2.2 });
  /** A 0.8 m box against the ceiling, its back at x 7, off the flight; `moved` puts it elsewhere. */
  const cupboard = (doc: Document): Document => [
    { type: "placeObject", opId: "cup", state: "s0", object: { kind: "block", size: { w: 0.8, d: 0.8, h: 0.8 } }, at: { x: 7.2, y: 1.9 }, rotation: 0, deck: null } satisfies Command,
    { type: "setObjectSize", objectId: "cup/o0", w: 0.8, d: {}, z: { standard: "ceiling" } } satisfies Command,
  ].reduce<Document>(run, doc);
  const cupId = (doc: Document): string => Object.keys(doc.placements).find((id) => doc.placements[id]?.object === "cup/o0") ?? "";

  it("refuses a slab over the flight's high end, with both heights", () => {
    const message = refusal(standing(6, 270), slab(4, 7.9));
    expect(message).toContain("0.00–2.70");
    expect(message).toContain("2.08–2.20");
  });

  it("accepts the same slab over its low end, with headroom warning", () => {
    const doc = run(standing(2, 90), slab(4.8, 7.9));
    expect(headroom(doc)).toBeLessThan(2);
  });

  it("accepts a cupboard hung over the low steps, with headroom warning, and refuses it over the high steps", () => {
    const doc = cupboard(standing(2, 90, "stair", 3.2)); // the cupboard 2.40–3.20; rising toward −x, its foot at x 5.78
    const on = (x: number): Command => ({ type: "movePlacement", placementId: cupId(doc), at: { x, y: 1.9 }, rotation: 0 });
    const low = run(doc, on(5.2));
    expect(headroom(low)).toBeLessThan(2);
    const message = refusal(doc, on(2.6));
    expect(message).toContain("0.00–2.70");
    expect(message).toContain("2.40–3.20");
  });

  it("leaves a cupboard on the floor colliding with the flight", () => {
    const doc = standing(2, 90);
    expect(refusal(doc, { type: "placeObject", opId: "cup", state: "s0", object: { kind: "block", size: { w: 0.8, d: 0.8, h: 0.8 } }, at: { x: 5.2, y: 1.9 }, rotation: 0, deck: null })).toContain("overlap");
  });

  it("clears an open flight from both sides, and refuses what lies between", () => {
    const doc = cupboard(standing(2, 90, "openStair", 3.2));
    const p = cupId(doc);
    expect(refusal(doc, { type: "movePlacement", placementId: p, at: { x: 2.6, y: 1.9 }, rotation: 0 })).toContain("overlap"); // over the high steps, reaching below the line
    expect(refusal(doc, { type: "movePlacement", placementId: p, at: { x: 5.2, y: 1.9 }, rotation: 0 })).toBe("accepted"); // above the line
    const lowered = run(run(doc, { type: "setObjectSize", objectId: "cup/o0", w: 0.8, d: {}, z: { standard: 0 } }), { type: "setObjectSize", objectId: "cup/o0", w: 0.8, d: {}, h: { standard: 0.3 } });
    expect(refusal(lowered, { type: "movePlacement", placementId: p, at: { x: 3.2, y: 1.9 }, rotation: 0 })).toBe("accepted"); // under its underside
    const between = run(lowered, { type: "setObjectSize", objectId: "cup/o0", w: 0.8, d: {}, h: { standard: 1.6 } });
    expect(refusal(between, { type: "movePlacement", placementId: p, at: { x: 3.2, y: 1.9 }, rotation: 0 })).toContain("underside");
  });
});

describe("the kinds that keep their box (AC-04)", () => {
  it.each(["rungLadder", "spiralStair"])("refuses a %s through a hole shorter than its box", (kind) => {
    const doc = floorWithHole(0.3);
    expect(refusal(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w: 1, d: 1 } }, at: { x: 6, y: 1.5 }, rotation: 270, deck: null, reaches: FLOOR })).toContain("overlap");
  });

  it.each(["openStair", "storageStair", "shipsLadder", "alternatingTread"])("accepts a %s through a short hole", (kind) => {
    const doc = floorWithHole(1.6);
    expect(refusal(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w: 0.9, d: 2.2 } }, at: { x: 6, y: 1.5 }, rotation: 270, deck: null, reaches: FLOOR })).toBe("accepted");
  });
});

describe("what stands on the slab over a flight", () => {
  it("accepts a piece and a wall on the slab over the lower flight", () => {
    const doc = run(floorWithHole(2.5), flight());
    expect(refusal(doc, { type: "placeObject", opId: "bed", state: "s0", object: { kind: "block", size: { w: 0.8, d: 0.8, h: 0.5 } }, at: { x: 3, y: 1.9 }, rotation: 0, deck: FLOOR })).toBe("accepted");
    expect(refusal(doc, { type: "addWall", opId: "w", from: { at: { x: 2.5, y: 1.2 } }, to: { at: { x: 2.5, y: 2.5 } }, base: FLOOR, top: 0.4 })).toBe("accepted");
  });

  it("refuses a slab with no hole for a full wall under it, as ever", () => {
    const doc = room();
    const wall = run(doc, { type: "addWall", opId: "w", from: { at: { x: 4, y: 0.1 } }, to: { at: { x: 4, y: 2.9 } } });
    expect(refusal(wall, { type: "addDeck", opId: "d", preset: "loft", at: { x: 4, y: 1.5 }, w: 2, d: 2 })).not.toBe("accepted");
  });
});

describe("the preview agrees with validation", () => {
  it("over random stairs and holes", () => {
    const random = rng(20261104);
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 300; i += 1) {
      const length = 0.3 + random() * 3.5;
      let doc = run(room(), { type: "addDeck", opId: "floor", preset: "loft", at: { x: 4, y: 1.5 }, w: 7.8, d: 2.8, top: 2 + random() * 0.3 });
      doc = run(doc, { type: "addDeckHole", opId: "h", deck: FLOOR, at: { x: 6 - length / 2, y: 1.5 }, w: length, d: 1 });
      const kind = ["stair", "openStair", "storageStair", "rungLadder"][Math.floor(random() * 4)] ?? "stair";
      const at = { x: 3 + random() * 3.5, y: 1 + random() };
      const [w, d] = [0.6 + random() * 0.4, 1 + random() * 3];
      const shape = candidateShape(kind, at, w, d, 270);
      const pose = { kind, at, rotation: 270, w, d, riser: null };
      const h = defaultSize(kind)?.h.standard ?? 0;
      const fits = footprintFit(doc, shape.ring, "s0", { h, z: 0 }, null, [], shape.centre, pose).fits;
      const said = execute(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w, d } }, at, rotation: 270, deck: null });
      expect(said.ok, `${kind} at ${at.x},${at.y} ${w}×${d} hole ${length}`).toBe(fits);
      if (said.ok) accepted += 1; else refused += 1;
    }
    expect(accepted).toBeGreaterThan(30);
    expect(refused).toBeGreaterThan(30);
  });
});

describe("reaching through a short hole (AC-03, riser.06)", () => {
  const reach = (doc: Document) => stairChecks(doc, "st/o0").find((c) => c.id === "reach");

  it("reads as reaching with its back on the hole's side, however short the hole", () => {
    for (const length of [3.2, 2.5, 1.7]) expect(reach(run(floorWithHole(length), flight()))?.ok, `hole ${length}`).toBe(true);
  });

  it("reads as reaching from outside a deck's edge, as ever", () => {
    let doc = run(room(), { type: "addDeck", opId: "floor", preset: "loft", at: { x: 7, y: 1.5 }, w: 1.8, d: 2.8, top: 2.7 });
    doc = run(doc, flight("stair", 6.1));
    expect(reach(doc)?.ok).toBe(true);
  });

  it("doesn't read as reaching with its back short of the hole's side", () => {
    const doc = run(floorWithHole(3.78), flight("stair", 5.9));
    expect(reach(doc)?.ok).toBe(false);
  });
});
