import { describe, expect, it } from "vitest";
import { emptyDocument, execute, kindOf, kindsSwitchable, placementRange, rectangleRoom, type Command, type Document } from "../src";

// The Beam kind (beams.03, .04; AC-01): hung from the ceiling by default, 2.40 × 0.15 m and 0.20 m deep, the same in
// every layout state, switching kind only with another beam. A 3 × 3 m room of 0.20 m walls on centrelines.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const run = (doc: Document, c: Command): Document => {
  const r = execute(doc, c);
  if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
  return r.value.doc;
};
const stateByName = (doc: Document, name: string): string => Object.values(doc.states).find((s) => s.name === name)?.id ?? "";

describe("the Beam kind", () => {
  it("a default beam is 2.40 × 0.15 m and spans 2.30–2.50 under a 2.50 m ceiling", () => {
    const room = build(...rectangleRoom({ x: 0, y: 0 }, 3, 3, "c"));
    const doc = run(room, { type: "placeObject", opId: "b", state: stateByName(room, "Layout"), object: { kind: "beam" }, at: { x: 1.5, y: 1.6 }, deck: null });
    const p = Object.values(doc.placements)[0];
    const o = p ? doc.objects[p.object] : undefined;
    expect([o?.w.standard, o?.d.standard]).toEqual([2.4, 0.15]);
    expect(placementRange(doc, p?.id ?? "")).toEqual({ bottom: 2.3, top: 2.5 });
  });

  it("stands in every layout state; moving it in one moves it in all", () => {
    const two = build(...rectangleRoom({ x: 0, y: 0 }, 3, 3, "c"), { type: "addState", opId: "n", name: "Night" });
    const day = stateByName(two, "Layout");
    const placed = run(two, { type: "placeObject", opId: "b", state: day, object: { kind: "beam" }, at: { x: 1.5, y: 1.6 }, deck: null });
    expect(Object.values(placed.placements).map((p) => doc_state(placed, p.state)).sort()).toEqual(["Layout", "Night"]);
    const id = Object.values(placed.placements).find((p) => p.state === day)?.id ?? "";
    const moved = run(placed, { type: "movePlacement", placementId: id, at: { x: 1.5, y: 1.2 }, rotation: 0 });
    expect(Object.values(moved.placements).map((p) => p.at)).toEqual([{ x: 1.5, y: 1.2 }, { x: 1.5, y: 1.2 }]);
  });

  it("switches kind only with another beam", () => {
    const beam = kindOf("beam");
    const block = kindOf("block");
    if (!beam || !block) throw new Error("no kind");
    expect(kindsSwitchable(beam, block)).toBe(false);
    expect(kindsSwitchable(block, beam)).toBe(false);
  });
});

function doc_state(doc: Document, id: string): string {
  return doc.states[id]?.name ?? "";
}
