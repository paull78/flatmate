import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { stairChecks } from "../src/queries/stair-checks";
import { stairEdges } from "../src/queries/stair-edge";
import { touchedDeck } from "../src/queries/stairs";
import { footprints } from "../src/queries/footprints";
import { LOFT, cabinDoc, notchedCabin, run } from "./cabin";

// A stair on a hole's side (stairwell.17; AC-07): the deck's catching edges are its slab's boundary, so a hole's sides
// catch a stair hanging into the hole, and the loft's east side stops at the notch. The notch: x 1.40–2.10, y 2.25–2.90.

const r = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const key = (e: { a: { x: number; y: number }; b: { x: number; y: number } }): string => [e.a, e.b].map((p) => `${r(p.x)},${r(p.y)}`).sort().join(" ");
const ladderAt = (doc: Document, at: { x: number; y: number }): Command => ({ type: "placeStair", opId: "lad", state: "s0", kind: "shipsLadder", deck: LOFT, at, shape: "straight", surface: null });

describe("a hole's sides catch a stair (AC-07)", () => {
  it("the notch's two sides inside the loft are edges, facing into it; the east side stops at the notch", () => {
    const edges = stairEdges(notchedCabin(), null, 0.6);
    const west = edges.find((e) => key(e) === "1.4,2.25 1.4,2.9");
    const south = edges.find((e) => key(e) === "1.4,2.25 2.1,2.25");
    const n = (v?: { x: number; y: number }) => v && [r(v.x), r(v.y)];
    expect(n(west?.normal)).toEqual([1, 0]);
    expect(n(south?.normal)).toEqual([0, 1]);
    expect(edges.map(key)).toContain("2.1,0.1 2.1,2.25");
    expect(edges.map(key)).not.toContain("2.1,0.1 2.1,2.9");
  });

  it("a hole's side against a wall face, or shorter than the stair is wide, catches nothing", () => {
    // A hole against the west wall (x 0.10–0.60): its west side is the loft's, open; its east side 0.40 long catches a 0.30 stair only.
    const doc = run(cabinDoc(), { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 0.35, y: 1.5 }, w: 0.5, d: 0.4 });
    const east = (width: number) => stairEdges(doc, null, width).filter((e) => key(e) === "0.6,1.3 0.6,1.7");
    expect(east(0.4)).toHaveLength(1);
    expect(east(0.6)).toHaveLength(0);
    // A notch along the north wall: its north side is the loft's own edge, against the wall, and catches nothing either way.
    expect(stairEdges(notchedCabin(), null, 0.3).map(key)).not.toContain("1.4,2.9 2.1,2.9");
  });

  it("placeStair on the notch's west side places a ship's ladder 0.60 × 1.103 at x 1.40–2.503, y 2.30–2.90, reaching the loft", () => {
    const r1 = execute(notchedCabin(), ladderAt(notchedCabin(), { x: 1.4, y: 2.6 }));
    if (!r1.ok) throw new Error(r1.error.message);
    const doc = r1.value.doc;
    const object = Object.values(doc.objects).find((o) => o.kind === "shipsLadder");
    expect(object?.reaches).toBe(LOFT);
    const p = Object.values(doc.placements).find((q) => q.object === object?.id);
    const quad = p ? footprints(doc).get(p.id) : undefined;
    const xs = (quad ?? []).map((q) => r(q.x));
    const ys = (quad ?? []).map((q) => r(q.y));
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([1.4, 2.503, 2.3, 2.9]);
    expect(p && touchedDeck(doc, p)).toBe(LOFT);
    expect(stairChecks(doc, object?.id ?? "").filter((c) => c.id === "reach")).toEqual([{ id: "reach", ok: true, deck: LOFT }]);
  });

  it("a spiral attaches to a hole's side, hanging into the hole", () => {
    const doc = run(cabinDoc(), { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 1.05, y: 1.05 }, w: 1.7, d: 1.7 }); // x, y 0.20–1.90
    const r2 = execute(doc, { type: "placeStair", opId: "sp", state: "s0", kind: "spiralStair", deck: LOFT, at: { x: 1.05, y: 1.9 }, shape: "straight", surface: null });
    if (!r2.ok) throw new Error(r2.error.message);
    const p = Object.values(r2.value.doc.placements).find((q) => r2.value.doc.objects[q.object]?.kind === "spiralStair");
    const quad = p ? footprints(r2.value.doc).get(p.id) : undefined;
    expect(Math.max(...(quad ?? []).map((q) => q.y))).toBeCloseTo(1.9, 3);
    expect(r2.value.doc.objects[p?.object ?? ""]?.reaches).toBe(LOFT);
  });
});
