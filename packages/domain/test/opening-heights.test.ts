import { describe, expect, it } from "vitest";
import { parseStoredDocument, unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { openingRange } from "../src/queries/vertical";
import { deserialize, serialize, upgradeStored } from "../src/serialize";
import { parseOpening } from "../src/shape";
import { fromStored } from "../src/shape-tables";
import { rectDoc, withDeck, withOpening } from "./helpers";

// Stored sill and head (sills step 01, AC-01, AC-03): every opening keeps its own heights above its wall's bottom, new
// ones take the floor's defaults, and a drawing saved before them opens as it drew. The 6 × 4 room: W1 runs (0, 0) →
// (6, 0).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const fail = (): never => {
  throw new Error("missing row");
};
const heights = (doc: Document, id: string) => {
  const o = doc.openings[id];
  return o ? [o.sill, o.head] : null;
};

describe("stored opening heights (sills step 01)", () => {
  it("a new door runs 0 to 2.10 and a new window 0.90 to 2.10", () => {
    const doc = run(rectDoc(0, 0, 6, 4), { type: "addOpening", opId: "d", wall: "W1", kind: "swing", offset: 1 }, { type: "addOpening", opId: "w", wall: "W1", kind: "window", offset: 3 });
    expect(heights(doc, "d/d0")).toEqual([0, 2.1]);
    expect(heights(doc, "w/d0")).toEqual([0.9, 2.1]);
  });

  it("a new door on a 2.03 half wall stops 0.10 under its top", () => {
    const doc = run(rectDoc(0, 0, 6, 4), { type: "setWallTop", wallId: "W1", top: 2.03 }, { type: "addOpening", opId: "d", wall: "W1", kind: "swing", offset: 1 });
    expect(heights(doc, "d/d0")).toEqual([0, 1.93]);
  });

  it("openingRange reads the stored heights above the wall's bottom", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "x", wall: "W1", offset: 1, kind: "window", sill: 1.2, head: 1.8 });
    expect(openingRange(doc, "x")).toEqual({ bottom: 1.2, top: 1.8 });
  });

  it("openingRange measures from the top of the deck a wall stands on", () => {
    const room = withDeck(rectDoc(0, 0, 6, 4), { id: "k", at: [3, 2], w: 6, d: 4, top: 2.15, solid: false });
    const onDeck = { ...room, walls: { ...room.walls, W1: { ...(room.walls.W1 ?? fail()), base: "k", top: 1.8 } } };
    const doc = withOpening(onDeck, { id: "x", wall: "W1", offset: 1, kind: "window", sill: 0.3, head: 1.2 });
    expect(openingRange(doc, "x")).toEqual({ bottom: 2.45, top: 3.35 });
  });

  it("a row with a sill or head that isn't a number isn't an opening", () => {
    const row = { id: "x", wall: "W1", kind: "window", offset: 1, width: 1, side: "left", hinge: "a", glazed: false, sill: 0.9, head: 2.1 };
    expect(parseOpening(row)).not.toBeNull();
    expect(parseOpening({ ...row, sill: "0.9" })).toBeNull();
    expect(parseOpening({ ...row, head: Number.NaN })).toBeNull();
    const noSill = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "sill"));
    expect(parseOpening(noSill)).toBeNull();
  });

  it("splitting a wall keeps an opening's heights", () => {
    const doc = withOpening(rectDoc(0, 0, 6, 4), { id: "x", wall: "W1", offset: 4, kind: "window", sill: 1.2, head: 1.8 });
    const split = run(doc, { type: "addWall", opId: "p", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 4 } } });
    expect(heights(split, "x")).toEqual([1.2, 1.8]);
  });
});

describe("drawings saved before heights (sills step 01, AC-03)", () => {
  // A door on a full wall, a door on a 2.03 half wall, a window under a 2.15 ceiling: today's ranges.
  const old = (): Document => {
    const doc = run(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: 2.15 }, { type: "setWallTop", wallId: "W3", top: 2.03 });
    return [
      { id: "full", wall: "W1", kind: "swing" as const, offset: 1 },
      { id: "half", wall: "W3", kind: "swing" as const, offset: 1 },
      { id: "win", wall: "W1", kind: "window" as const, offset: 3 },
    ].reduce((d, o) => withOpening(d, o), doc);
  };
  const file = (doc: Document, strip: boolean): Record<string, unknown> => {
    const json: Record<string, unknown> = JSON.parse(JSON.stringify(serialize(doc)));
    if (!strip) return json;
    const openings = Object.fromEntries(Object.entries(doc.openings).map(([id, o]) => [id, Object.fromEntries(Object.entries(o).filter(([k]) => k !== "sill" && k !== "head"))]));
    return { ...json, openings };
  };
  const byBothPaths = (json: Record<string, unknown>): Document[] => {
    const parsed = parseStoredDocument(json);
    if (!parsed) throw new Error("unparseable");
    return [unwrap(deserialize(json)), unwrap(fromStored(upgradeStored(parsed)))];
  };

  it("opens with today's ranges, by both load paths", () => {
    for (const doc of byBothPaths(file(old(), true))) {
      expect(heights(doc, "full")).toEqual([0, 2.05]);
      expect(heights(doc, "half")).toEqual([0, 1.93]);
      expect(heights(doc, "win")).toEqual([0.9, 2.05]);
    }
  });

  it("a stored height is kept", () => {
    const heads = { ...old(), openings: Object.fromEntries(Object.entries(old().openings).map(([id, o]) => [id, { ...o, head: id === "half" ? 1.93 : 2.05 }])) };
    const doc = withOpening(heads, { id: "win", wall: "W1", kind: "window", offset: 3, sill: 1.1, head: 1.6 });
    for (const loaded of byBothPaths(file(doc, false))) expect(heights(loaded, "win")).toEqual([1.1, 1.6]);
  });
});
