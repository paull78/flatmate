import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document, Placement } from "../src/model";
import { validateDocument } from "../src/validate";
import { tinyHouse, withDeck } from "./helpers";

// A stair is in every layout (stairs.08, .18, AC-05): one placement per state, equal in pose, surface, sides and zones;
// every stair edit in one state is made in all of them, a new state gets it, and furniture stays per layout.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(`${r.error.message} ${r.error.violations.map((v) => v.message).join("; ")}`);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/** The decks' tiny house under 3.20 with a loft over x 4.9–6.9 and two layouts, Day (s0) and Night (n/s0). */
function house(): Document {
  let doc = run(tinyHouse(), { type: "setCeiling", height: 3.2 });
  doc = withDeck(doc, { id: "L", name: "Loft", at: [5.9, 1.25], w: 2, d: 2.3, top: 2.15, solid: false });
  return run(doc, { type: "addState", opId: "n", name: "Night" });
}
const placeStair = (state = "s0"): Command => ({ type: "placeObject", opId: "st", state, object: { kind: "storageStair" }, at: { x: 4.9, y: 0.5 }, rotation: 270, deck: null });
const copies = (doc: Document, object = "st/o0"): Placement[] => Object.values(doc.placements).filter((p) => p.object === object).sort((a, b) => (a.state < b.state ? -1 : 1));
const poses = (doc: Document, object = "st/o0") => copies(doc, object).map((p) => ({ state: p.state, at: p.at, rotation: p.rotation }));
const inState = (doc: Document, state: string, object = "st/o0"): Placement => {
  const p = copies(doc, object).find((q) => q.state === state);
  if (!p) throw new Error(`no copy in ${state}`);
  return p;
};

describe("a stair in every layout (AC-05)", () => {
  it("placing it in Day creates a placement in every state", () => {
    const doc = run(house(), placeStair());
    expect(poses(doc)).toEqual([
      { state: "n/s0", at: { x: 4.9, y: 0.5 }, rotation: 270 },
      { state: "s0", at: { x: 4.9, y: 0.5 }, rotation: 270 },
    ]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("moving it in Night moves it in Day", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "movePlacement", placementId: inState(doc, "n/s0").id, at: { x: 4.6, y: 0.5 }, rotation: 270 });
    expect(poses(doc).map((p) => p.at)).toEqual([{ x: 4.6, y: 0.5 }, { x: 4.6, y: 0.5 }]);
  });

  it("a group move in one state that includes the stair moves its other copy too", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "movePlacements", moves: [{ placementId: inState(doc, "s0").id, at: { x: 4.5, y: 0.6 }, rotation: 270 }] });
    expect(poses(doc).map((p) => p.at)).toEqual([{ x: 4.5, y: 0.6 }, { x: 4.5, y: 0.6 }]);
  });

  it("resizing it from Night resizes and re-anchors both copies", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "resizePlacement", placementId: inState(doc, "n/s0").id, side: "front", size: 1.5 });
    expect(doc.objects["st/o0"]?.d.standard).toBe(1.5);
    expect(inState(doc, "s0").at).toEqual(inState(doc, "n/s0").at);
  });

  it("deleting it from one state removes it everywhere", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "removePlacement", placementId: inState(doc, "n/s0").id });
    expect(copies(doc)).toEqual([]);
    expect(doc.objects["st/o0"]).toBeUndefined();
  });

  it("deleting it through deleteEntities removes it everywhere", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "deleteEntities", ids: [{ table: "placements", id: inState(doc, "s0").id }] });
    expect(copies(doc)).toEqual([]);
    expect(doc.objects["st/o0"]).toBeUndefined();
  });

  it("addState and copyState give the new state the stair", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "addState", opId: "e", name: "Evening" });
    doc = run(doc, { type: "copyState", opId: "c", from: "s0", name: "Copy" });
    expect(copies(doc).map((p) => p.state).sort()).toEqual(["c/s0", "e/s0", "n/s0", "s0"]);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("deleting a layout keeps the stair in the others", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "deleteState", stateId: "n/s0" });
    expect(copies(doc).map((p) => p.state)).toEqual(["s0"]);
  });

  it("duplicating it makes a new stair in every state", () => {
    let doc = run(house(), placeStair());
    doc = run(doc, { type: "duplicatePlacements", opId: "dup", copies: [{ placementId: inState(doc, "s0").id, at: { x: 4.4, y: 1.6 }, rotation: 270 }] });
    const dup = Object.keys(doc.objects).find((id) => id.startsWith("dup/"));
    expect(dup).toBeDefined();
    expect(copies(doc, dup).map((p) => p.state).sort()).toEqual(["n/s0", "s0"]);
  });

  it("is refused when it fits by Day but hits a Night piece, naming Night", () => {
    let doc = run(house(), { type: "placeObject", opId: "b", state: "n/s0", object: { kind: "block" }, at: { x: 4, y: 0.8 }, deck: null, linked: false });
    expect(refusal(doc, placeStair())).toContain("Night");
    doc = run(doc, { type: "removePlacement", placementId: "b/p0" });
    expect(copies(run(doc, placeStair()))).toHaveLength(2);
  });

  it("an exception is untouched: a block placed by Day with linked: false stays only in Day (review.06)", () => {
    const doc = run(house(), { type: "placeObject", opId: "b", state: "s0", object: { kind: "block" }, at: { x: 4, y: 1.5 }, deck: null, linked: false });
    expect(Object.values(doc.placements).filter((p) => p.object === "b/o0").map((p) => p.state)).toEqual(["s0"]);
  });
});

describe("the copies invariant", () => {
  const placed = (): Document => run(house(), placeStair());

  it("refuses a stair missing in one state", () => {
    const doc = placed();
    const placements = { ...doc.placements };
    delete placements[inState(doc, "n/s0").id];
    expect(validateDocument({ ...doc, placements }).ok).toBe(false);
  });

  it("refuses two copies at different positions", () => {
    const doc = placed();
    const p = inState(doc, "n/s0");
    expect(validateDocument({ ...doc, placements: { ...doc.placements, [p.id]: { ...p, at: { x: 4.6, y: 0.5 } } } }).ok).toBe(false);
  });

  it("allows copies in different configurations", () => {
    const doc = placed();
    const p = inState(doc, "n/s0");
    expect(validateDocument({ ...doc, placements: { ...doc.placements, [p.id]: { ...p, config: "standard" } } }).ok).toBe(true);
  });
});

describe("a stair's zones in every layout (stairdraw.46)", () => {
  it("setZoneSides on one copy changes every copy, and validates", () => {
    const doc = run(run(house(), placeStair()), { type: "setZoneSides", placementId: inState(run(house(), placeStair()), "s0").id, sides: { front: true, back: false, left: true, right: false } });
    for (const p of copies(doc)) expect(p.sides).toEqual({ front: true, back: false, left: true, right: false });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("setZoneExtent on one copy changes every copy, and validates", () => {
    const placed = run(house(), placeStair());
    const doc = run(placed, { type: "setZoneExtent", placementId: inState(placed, "s0").id, side: "front", extent: { depth: 0.6, start: 0.05, end: 0.05 } });
    const zones = copies(doc).map((p) => p.zones);
    expect(zones[0]).toEqual(zones[1]);
    expect(inState(doc, "n/s0").zones).toEqual(inState(doc, "s0").zones);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("furniture keeps its zones per layout", () => {
    const doc = run(house(), { type: "placeObject", opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 1, y: 1.25 }, rotation: 0, deck: null });
    const desk = Object.values(doc.placements).find((p) => p.object === "d/o0");
    if (!desk) throw new Error("no desk");
    const next = run(doc, { type: "setZoneSides", placementId: desk.id, sides: { front: false, back: false, left: false, right: false } });
    const other = Object.values(next.placements).find((p) => p.object === "d/o0" && p.id !== desk.id); // linked, so in Night too (review.05)
    expect(other?.sides).toEqual(desk.sides);
  });
});
