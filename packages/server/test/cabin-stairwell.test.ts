import { describe, expect, it } from "vitest";
import { anchorAt, deckView, emptyDocument, execute, footprints, levels, reachesLevel, rectangleRoom, stairChecks, unwrap, validateDocument, type Command, type Document } from "@fm/domain";

// The stairwell sample scene on its cabin (stairwell.12, .21; AC-15), steps 1–5 as the domain runs them for the server
// and Claude: a 4 × 3 room under 3.05 with a Loft at x 0.1–2.1; a ship's ladder along the north wall refused for the
// slab; the notch x 1.40–2.10, y 2.25–2.90 cut; the ladder placed on the notch's west side, reaching the Loft; at the
// loft's level it is drawn whole (reachesLevel).

const LOFT = "loft/k0";
const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const cabin = (): Document => run(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "cabin"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 });
const NOTCH: Command = { type: "addDeckHole", opId: "notch", deck: LOFT, at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 };
const LADDER: Command = { type: "placeStair", opId: "lad", state: "s0", kind: "shipsLadder", deck: LOFT, at: { x: 1.4, y: 2.6 }, shape: "straight", surface: null }; // the back's middle: the editor's slide clamps, the domain doesn't
const box = (doc: Document, id: string): number[] => {
  const q = footprints(doc).get(id) ?? [];
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return [Math.min(...q.map((p) => r(p.x))), Math.max(...q.map((p) => r(p.x))), Math.min(...q.map((p) => r(p.y))), Math.max(...q.map((p) => r(p.y)))];
};

describe("the stairwell sample scene on the cabin (AC-15)", () => {
  it("step 1: the cabin is valid, with the loft at x 0.10–2.10 over the whole depth", () => {
    const doc = cabin();
    expect(validateDocument(doc).ok).toBe(true);
    expect(deckView(doc, LOFT)?.ring.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000])).toEqual([[0.1, 0.1], [2.1, 0.1], [2.1, 2.9], [0.1, 2.9]]);
  });

  it("step 2: the ladder at (1.95, 2.60), rotation 90, reaching the Loft is refused for the slab", () => {
    const r = execute(cabin(), { type: "placeObject", opId: "try", state: "s0", object: { kind: "shipsLadder" }, at: anchorAt({ x: 1.95, y: 2.6 }, 1.1, 90), rotation: 90, deck: null, reaches: LOFT });
    expect(r.ok ? "accepted" : r.error.message).toBe("Ship's ladder (0.00–2.15) and Loft (2.03–2.15) overlap in Layout");
  });

  it("step 3: the notch x 1.40–2.10, y 2.25–2.90 is cut", () => {
    const doc = run(cabin(), NOTCH);
    expect(deckView(doc, LOFT)?.holes.map((h) => h.ring.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]))).toEqual([[[1.4, 2.25], [2.1, 2.25], [2.1, 2.9], [1.4, 2.9]]]);
  });

  it("step 4: on the notch's west side the ladder is placed at x 1.40–2.503, y 2.30–2.90, reaching the Loft, headroom 1.14", () => {
    const doc = run(cabin(), NOTCH, LADDER);
    const p = Object.values(doc.placements).find((q) => doc.objects[q.object]?.kind === "shipsLadder");
    if (!p) throw new Error("no ladder");
    expect(box(doc, p.id)).toEqual([1.4, 2.503, 2.3, 2.9]);
    expect(doc.objects[p.object]?.reaches).toBe(LOFT);
    const checks = stairChecks(doc, p.object);
    const headroom = checks.find((c) => c.id === "headroom");
    expect(headroom && "value" in headroom ? Math.round(headroom.value * 100) / 100 : null).toBe(1.14);
    expect(checks.find((c) => c.id === "reach")).toEqual({ id: "reach", ok: true, deck: LOFT });
  });

  it("step 5: at the loft's level the ladder is drawn whole", () => {
    const doc = run(cabin(), NOTCH, LADDER);
    const level = levels(doc).find((l) => l.deckIds.includes(LOFT));
    const object = Object.values(doc.objects).find((o) => o.kind === "shipsLadder");
    if (!level || !object) throw new Error("no loft level or no ladder");
    expect(reachesLevel(doc, object.id, level)).toBe(true);
  });
});
