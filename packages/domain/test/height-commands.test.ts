import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { CEILING_ID, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { ceilingHeight, placementRange, wallRange } from "../src/queries/vertical";
import { deserialize, serialize } from "../src/serialize";
import { place, rectDoc, withOpening } from "./helpers";

// The height commands (heights.09, .10, .11, .24, .35): setObjectSize with heights and elevations, setWallTop,
// setCeiling, the kind switch resetting heights, openings off walls lower than 2.00 m (decks.17).

const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command): Document => unwrap(run(doc, cmd)).doc;
const refusal = (doc: Document, cmd: Command): string => {
  const r = run(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/** A 6 × 4 room with a lift-bed-like Murphy bed: folded ("Up") at the ceiling by Day, down ("Down") at 0.20 at Night. */
function liftDoc(): Document {
  let doc = place(rectDoc(0, 0, 6, 4), { object: "lift", kind: "murphyBed", at: [3, 3.9], config: "folded", state: "day" });
  doc = place(doc, { object: "lift", kind: "murphyBed", at: [3, 3.9], config: "down", state: "night" });
  return ok(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, h: { folded: 0.35, down: 0.35 }, z: { folded: "ceiling", down: 0.2 } });
}

describe("setObjectSize with heights", () => {
  it("setting the Up elevation moves the bed by Day only (AC-01)", () => {
    const doc = liftDoc();
    expect([placementRange(doc, "lift/day"), placementRange(doc, "lift/night")]).toEqual([{ bottom: 2.15, top: 2.5 }, { bottom: 0.2, top: 0.55 }]);
    const raised = ok(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, z: { folded: 1.9 } });
    expect(placementRange(raised, "lift/day")).toEqual({ bottom: 1.9, top: 2.25 });
    expect(placementRange(raised, "lift/night")).toEqual({ bottom: 0.2, top: 0.55 });
  });

  it("z \"ceiling\" round-trips; a negative elevation, a null and a 0.005 height are refused; values are kept to the millimetre", () => {
    const doc = liftDoc();
    expect(doc.objects.lift?.z).toEqual({ folded: "ceiling", down: 0.2 });
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))))).toEqual(doc);
    expect(refusal(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, z: { down: -0.1 } })).toBe("Elevation must be 0 to 10 m, or the ceiling");
    expect(refusal(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, h: { down: 0.005 } })).toBe("Height must be between 0.01 and 10 m");
    expect(refusal(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, h: { open: 1 } })).toBe("Unknown configuration");
    const mm = ok(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, h: { down: 0.35049 }, z: { down: 0.20049 } });
    expect([mm.objects.lift?.h.down, mm.objects.lift?.z.down]).toEqual([0.35, 0.2]);
  });

  it("a top through the ceiling is refused with the ceiling text; heights alone leave width and depth", () => {
    const doc = liftDoc();
    expect(refusal(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, z: { folded: 2.2 } })).toBe("Murphy bed (Closed) reaches 2.55 m in day; the ceiling is 2.50 m");
    const taller = ok(doc, { type: "setObjectSize", objectId: "lift", w: 1.6, d: {}, h: { down: 0.4 } });
    expect([taller.objects.lift?.w, taller.objects.lift?.d]).toEqual([doc.objects.lift?.w, doc.objects.lift?.d]);
  });
});

describe("setConfiguration in height (AC-07)", () => {
  it("switching to a taller configuration is refused when its top passes the ceiling", () => {
    // A Murphy bed whose open configuration is 2.40 tall, under a 2.30 ceiling: closed (2.24) fits, open does not.
    let doc = place(rectDoc(0, 0, 6, 4), { object: "m", kind: "murphyBed", at: [3, 3.9], config: "folded" });
    doc = ok(doc, { type: "setObjectSize", objectId: "m", w: 1.6, d: {}, h: { down: 2.4 } });
    doc = ok(doc, { type: "setCeiling", height: 2.3 });
    expect(refusal(doc, { type: "setConfiguration", placementId: "m/s0", config: "down" })).toBe("Murphy bed (Open) reaches 2.40 m in Layout; the ceiling is 2.30 m");
    expect(run(ok(doc, { type: "setCeiling", height: 2.4 }), { type: "setConfiguration", placementId: "m/s0", config: "down" }).ok).toBe(true);
  });
});

describe("setObjectKind resets heights (heights.24)", () => {
  /** A built-in table unit, folded, against the top wall. */
  const unit = (): Document => place(rectDoc(0, 0, 6, 4), { object: "u", kind: "builtInTable", at: [3, 3.9], config: "folded" });

  it("a built-in table switched to a Murphy bed gets 2.24 and keeps width and depth", () => {
    const doc = ok(unit(), { type: "setObjectSize", objectId: "u", w: 1.4, d: {}, h: { folded: 1.5 } });
    const r = ok(doc, { type: "setObjectKind", objectId: "u", kind: "murphyBed" });
    expect(r.objects.u).toMatchObject({ kind: "murphyBed", w: doc.objects.u?.w, d: doc.objects.u?.d, h: { folded: 2.24, down: 2.24 }, z: { folded: 0, down: 0 } });
  });

  it("under a 2.20 ceiling the switch is refused", () => {
    const low = ok(unit(), { type: "setCeiling", height: 2.2 });
    expect(refusal(low, { type: "setObjectKind", objectId: "u", kind: "murphyBed" })).toBe("Murphy bed (Closed) reaches 2.24 m in Layout; the ceiling is 2.20 m");
  });
});

describe("setWallTop (heights.10, decks.17)", () => {
  it("1.10 accepted; 2.50 under 2.50 accepted as a fixed top, 2.60 refused; back to \"ceiling\" accepted; a wall with a door refused (AC-02, AC-19)", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const half = ok(doc, { type: "setWallTop", wallId: "W1", top: 1.1 });
    expect(wallRange(half, "W1")).toEqual({ bottom: 0, top: 1.1 });
    expect(wallRange(ok(doc, { type: "setWallTop", wallId: "W1", top: 2.5 }), "W1")).toEqual({ bottom: 0, top: 2.5 });
    expect(refusal(doc, { type: "setWallTop", wallId: "W1", top: 2.6 })).toBe("A wall can't be taller than the 2.50 m ceiling");
    expect(refusal(doc, { type: "setWallTop", wallId: "W1", top: 0.05 })).toBe("A half wall must be at least 0.10 m high");
    expect(ok(half, { type: "setWallTop", wallId: "W1", top: "ceiling" }).walls.W1?.top).toBe("ceiling");
    const door = withOpening(doc, { id: "D", wall: "W1", offset: 1 });
    expect(refusal(door, { type: "setWallTop", wallId: "W1", top: 1.1 })).toBe("Door D's head at 2.10 m is less than 0.10 m under wall W1's top at 1.10 m");
    expect(refusal(doc, { type: "setWallTop", wallId: "nope", top: 1.1 })).toBe("Wall not found");
    expect(refusal(doc, { type: "setWallTop", wallId: "W1", top: Number.NaN })).toBe("Invalid height");
  });

  it("a 1.10 m half wall refuses a new window (AC-19)", () => {
    const half = ok(rectDoc(0, 0, 6, 4), { type: "setWallTop", wallId: "W1", top: 1.1 });
    expect(refusal(half, { type: "addOpening", opId: "win", wall: "W1", kind: "window", offset: 1 })).toBe("Window win/d0 is 0.10 m tall; an opening must be at least 0.30 m tall");
    expect(run(half, { type: "addOpening", opId: "win", wall: "W2", kind: "window", offset: 1 }).ok).toBe(true);
  });

  it("depends on the wall only, and its inverse restores the document", () => {
    const doc = rectDoc(0, 0, 6, 4);
    const r = unwrap(run(doc, { type: "setWallTop", wallId: "W1", top: 1.1 }));
    expect(r.patch.dependencies).toEqual([{ table: "walls", id: "W1" }]);
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
  });
});

describe("setCeiling (heights.11)", () => {
  it("2.20 accepted and full walls follow, a half wall stays (AC-02)", () => {
    const doc = ok(rectDoc(0, 0, 6, 4), { type: "setWallTop", wallId: "W2", top: 1.1 });
    const low = ok(doc, { type: "setCeiling", height: 2.2 });
    expect(low.ceilings).toEqual({ [CEILING_ID]: { id: CEILING_ID, height: 2.2 } });
    expect([ceilingHeight(low), wallRange(low, "W1")?.top, wallRange(low, "W2")?.top]).toEqual([2.2, 2.2, 1.1]);
    expect(ceilingHeight(ok(low, { type: "setCeiling", height: 2.7 }))).toBe(2.7);
    expect(refusal(doc, { type: "setCeiling", height: 0.9 })).toBe("The ceiling must be between 1.00 and 10 m");
    expect(refusal(doc, { type: "setCeiling", height: Number.POSITIVE_INFINITY })).toBe("Invalid height");
  });

  it("lowering under a wardrobe is refused (AC-07)", () => {
    const doc = place(rectDoc(0, 0, 6, 4), { object: "w", kind: "wardrobe", at: [1, 3.9] });
    expect(run(doc, { type: "setCeiling", height: 2.05 }).ok).toBe(true);
    expect(refusal(doc, { type: "setCeiling", height: 2 })).toBe("Wardrobe reaches 2.05 m in Layout; the ceiling is 2.00 m");
  });

  it("with a \"ceiling\" lift bed over a table: 2.20 accepted (bed at 1.85), 1.00 refused (AC-18)", () => {
    const doc = place(liftDoc(), { object: "t", kind: "desk", at: [3, 3.9], state: "day" });
    const low = ok(doc, { type: "setCeiling", height: 2.2 });
    expect(placementRange(low, "lift/day")).toEqual({ bottom: 2.2 - 0.35, top: 2.2 });
    expect(refusal(doc, { type: "setCeiling", height: 1 })).toBe("Desk (0.00–0.75) and Murphy bed (0.65–1.00) overlap in day"); // by placement ID
  });

  it("depends on the row, every wall and every placement; a second call changes the row", () => {
    const doc = liftDoc();
    const r = unwrap(run(doc, { type: "setCeiling", height: 2.4 }));
    expect(r.patch.puts).toEqual([{ table: "ceilings", entity: { id: CEILING_ID, height: 2.4 } }]);
    const deps = r.patch.dependencies.map((k) => `${k.table}/${k.id}`);
    expect(deps).toEqual(expect.arrayContaining(["ceilings/ceiling", "walls/W1", "walls/W4", "placements/lift/day", "placements/lift/night"]));
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
  });

  it("the ceiling row cannot be deleted", () => {
    const low = ok(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: 2.2 });
    expect(refusal(low, { type: "deleteEntities", ids: [{ table: "ceilings", id: CEILING_ID }] })).toBe("The ceiling is set, not deleted");
  });
});
