import { describe, expect, it } from "vitest";
import { canSwitchKind, emptyDocument, execute, inEveryLayout, kindOf, rectangleRoom, type Command, type Document, type Placement } from "../src";

// The Wheel well kind (trailer.07, .11, .12; AC-06): a piece placed at will, the same in every layout state as a stair.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${r.error.message}`);
  return r.value.doc;
};
/** A 7 × 2.5 room with two layouts. */
const twoLayouts = (): Document => build(...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "c"), { type: "addState", opId: "n", name: "Night" });
const states = (doc: Document): string[] => Object.keys(doc.states).sort();
const copies = (doc: Document, object: string): Placement[] => Object.values(doc.placements).filter((p) => p.object === object);

describe("the kind", () => {
  it("is 1.80 × 0.40 m and 0.35 m tall, with Single, Tandem and Triple presets", () => {
    const k = kindOf("wheelWell");
    expect(k?.label).toBe("Wheel well");
    expect(k?.configs.map((c) => [c.w, c.d, c.h, c.z])).toEqual([[1.8, 0.4, 0.35, 0]]);
    expect(k?.presets.map((p) => [p.id, p.w, p.d.standard, p.h?.standard])).toEqual([["Single", 0.9, 0.4, 0.35], ["Tandem", 1.8, 0.4, 0.35], ["Triple", 2.7, 0.4, 0.35]]);
    expect(k?.sides).toEqual({ front: false, back: false, left: false, right: false });
    expect(inEveryLayout("wheelWell")).toBe(true);
    expect(inEveryLayout("stair")).toBe(true);
    expect(inEveryLayout("bench")).toBe(false);
  });

  it("switches kind with neither furniture nor a stair", () => {
    expect(canSwitchKind("wheelWell", "block")).toBe(false);
    expect(canSwitchKind("block", "wheelWell")).toBe(false);
    expect(canSwitchKind("wheelWell", "stair")).toBe(false);
  });
});

describe("in every layout (AC-06)", () => {
  const [day] = states(twoLayouts());
  const placed = (): Document => run(twoLayouts(), { type: "placeObject", opId: "w", state: day ?? "", object: { kind: "wheelWell" }, at: { x: 3, y: 1.2 }, deck: null });

  it("placed in one layout, it stands in every layout, in the same place", () => {
    const doc = placed();
    const c = copies(doc, "w/o0");
    expect(c.map((p) => p.state).sort()).toEqual(states(doc));
    expect(new Set(c.map((p) => JSON.stringify([p.at, p.rotation])))).toHaveProperty("size", 1);
  });

  it("moved in one layout, it moves in all", () => {
    const doc = placed();
    const night = copies(doc, "w/o0").find((p) => p.state !== day);
    const moved = run(doc, { type: "movePlacement", placementId: night?.id ?? "", at: { x: 4, y: 1.2 }, rotation: 0 });
    expect(copies(moved, "w/o0").map((p) => p.at.x)).toEqual([4, 4]);
  });

  it("deleted in one layout, it goes from all", () => {
    const doc = placed();
    const first = copies(doc, "w/o0")[0];
    const gone = run(doc, { type: "deleteEntities", ids: [{ table: "placements", id: first?.id ?? "" }] });
    expect(copies(gone, "w/o0")).toEqual([]);
    expect(gone.objects["w/o0"]).toBeUndefined();
  });

  it("a new layout gets it too", () => {
    const doc = run(placed(), { type: "addState", opId: "e", name: "Evening" });
    expect(copies(doc, "w/o0")).toHaveLength(3);
  });
});
