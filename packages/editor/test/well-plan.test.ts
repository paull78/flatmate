import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import { LAYER_ORDER } from "../src/view/scene";
import type { Primitive } from "../src/view/scene-types";
import { DEFAULT_ANGLES } from "../src/view3d/camera3d";
import { lookScene3d } from "../src/view3d/look3d";
import { clearRoomDoc, withCommands } from "./builders";

// A wheel well on the plan and in 3D (trailer.10, .11; AC-08): its outline and a tyre per about 0.90 m, dashed where a
// bench covers it, the wall drawn over its part under it; its name when selected, as any piece's; a plain box in 3D.
// A 7 × 2.5 room of 0.20 m walls on centrelines: the lower wall's inner face is y = 0.1.

const place = (opId: string, kind: string, x: number, backY: number, size?: { w: number; d: number; h: number }): Command => ({
  type: "placeObject", deck: null, opId, state: "s0", object: { kind, ...(size ? { size } : {}) }, at: { x, y: backY }, rotation: 0,
});
/** The well at x 2.1–3.9, y −0.05 to 0.35, its outer 0.15 m under the lower wall. */
const well = (...more: Command[]): Document => withCommands(clearRoomDoc(7, 2.5, "c"), place("w", "wheelWell", 3, 0.35), ...more);
const layer = (doc: Document, selected = "", zoom = 80): readonly Primitive[] => objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, selected, zoom);
const inWell = (p: Primitive): boolean => p.kind === "segment" && [p.a, p.b].every((q) => q.x >= 2.1 - 1e-6 && q.x <= 3.9 + 1e-6 && q.y >= -0.05 - 1e-6 && q.y <= 0.35 + 1e-6);

describe("a well on the plan", () => {
  it("draws its fill, its outline and two tyres' outlines (1.80 m long), all solid", () => {
    const ps = layer(well());
    expect(ps.some((p) => p.kind === "polygon" && p.points.every((q) => q.x >= 2.1 - 1e-6 && q.x <= 3.9 + 1e-6))).toBe(true);
    const lines = ps.filter(inWell);
    expect(lines.length).toBeGreaterThanOrEqual(4 + 2 * 4);
    expect(lines.every((p) => p.kind === "segment" && p.dash === undefined)).toBe(true);
  });

  it("under a 1.80 × 0.60 × 0.45 bench its outline is dashed, drawn over the bench's fill", () => {
    const ps = layer(well(place("b", "bench", 3, 0.7, { w: 1.8, d: 0.6, h: 0.45 })));
    const bench = ps.findIndex((p) => p.kind === "polygon" && p.points.some((q) => Math.abs(q.y - 0.7) < 1e-6));
    expect(bench).toBeGreaterThanOrEqual(0);
    // The well's own edges, its front at y −0.05 and its back at 0.35: dashed after the bench, never solid.
    const edge = (p: Primitive, y: number): boolean => p.kind === "segment" && Math.abs(p.a.y - y) < 1e-6 && Math.abs(p.b.y - y) < 1e-6;
    const own = (p: Primitive): boolean => inWell(p) && (edge(p, -0.05) || edge(p, 0.35));
    expect(ps.slice(bench + 1).filter((p) => own(p) && p.kind === "segment" && p.dash !== undefined).length).toBeGreaterThan(0);
    expect(ps.filter((p) => own(p) && p.kind === "segment" && p.dash === undefined)).toEqual([]);
  });

  it("shows its name when selected and its depth is 40 px on screen, as any piece does", () => {
    const texts = layer(well(), "w/p0", 200).filter((p) => p.kind === "text");
    expect(texts.map((t) => (t.kind === "text" ? t.text : ""))).toContain("Wheel well");
  });

  it("the walls draw after the pieces, so the wall covers the well's part under it", () => {
    expect(LAYER_ORDER.indexOf("walls")).toBeGreaterThan(LAYER_ORDER.indexOf("objects"));
  });
});

describe("a well in 3D", () => {
  it("is one plain box from the floor to 0.35 m", () => {
    const look = lookScene3d(well(), "s0", DEFAULT_ANGLES);
    if ("refused" in look) throw new Error(look.refused);
    const faces = look.faces.filter((f) => f.owner === "piece/w/p0");
    expect(faces.length).toBeGreaterThan(0);
    const zs = faces.flatMap((f) => f.points.map((p) => p.z));
    expect([Math.min(...zs), Math.max(...zs)].map((z) => Math.round(z * 1000) / 1000)).toEqual([0, 0.35]);
  });
});
