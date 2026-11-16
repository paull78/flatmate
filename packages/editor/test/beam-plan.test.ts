import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { PALETTE_KINDS } from "../src/view/palette";
import { searchPalette } from "../src/view/palette-search";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { DEFAULT_ANGLES } from "../src/view3d/camera3d";
import { lookScene3d } from "../src/view3d/look3d";
import { appearanceOf } from "../src/view3d/parts";
import { clearRoomDoc, withCommands } from "./builders";

// A beam on the plan, in 3D and in the palette (beams.03, .08; AC-06, AC-07, AC-08). A 3 × 3 m clear room (inner faces
// at 0.1 and 3.1); the beam's back edge at y 1.6, its front at 1.45, from x 0.4 to 2.8.

const place = (opId: string, x: number, backY: number): Command => ({
  type: "placeObject", deck: null, opId, state: "s0", object: { kind: "beam" }, at: { x, y: backY }, rotation: 0,
});
/** The beam's object `b/o0` set to 0.40 m deep at an elevation of 1.00 m. */
const lowered: Command = { type: "setObjectSize", objectId: "b/o0", w: 2.4, d: { standard: 0.15 }, h: { standard: 0.4 }, z: { standard: 1 } };
const beam = (...cmds: Command[]): Document => withCommands(clearRoomDoc(3, 3, "c"), ...cmds);
const layer = (doc: Document): readonly Primitive[] => objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);
/** A line along the beam's whole length at depth `y`. */
const along = (p: Primitive, y: number): boolean => p.kind === "segment" && Math.abs(p.a.y - y) < 1e-6 && Math.abs(p.b.y - y) < 1e-6 && Math.abs(p.a.x - p.b.x) > 2;
const inBeam = (p: Primitive): boolean => p.kind === "segment" && [p.a, p.b].every((q) => q.x >= 0.4 - 1e-6 && q.x <= 2.8 + 1e-6 && q.y >= 1.45 - 1e-6 && q.y <= 1.6 + 1e-6);

describe("a beam on the plan", () => {
  it("hung from the ceiling, wholly above the cut, it draws a dashed outline and no symbol", () => {
    const lines = layer(beam(place("b", 1.6, 1.6))).filter(inBeam);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((p) => p.kind === "segment" && p.dash !== undefined)).toBe(true);
    // No symbol: nothing along it at a third or two thirds of its depth.
    expect(lines.some((p) => along(p, 1.55) || along(p, 1.5))).toBe(false);
  });

  it("lowered across the cut (1.00–1.40), it draws a solid outline and two lines along its length", () => {
    const lines = layer(beam(place("b", 1.6, 1.6), lowered)).filter(inBeam);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((p) => p.kind === "segment" && p.dash === undefined)).toBe(true);
    expect(lines.some((p) => along(p, 1.55)) && lines.some((p) => along(p, 1.5))).toBe(true);
  });
});

describe("a beam in 3D", () => {
  it("is one wood box", () => {
    const parts = appearanceOf("beam")("standard", 2.4, 0.15, 0.2);
    expect(parts.length).toBe(1);
    expect(parts[0]?.slot).toBe("wood");
  });

  it("look draws it from 2.30 to 2.50", () => {
    const look = lookScene3d(beam(place("b", 1.6, 1.6)), "s0", DEFAULT_ANGLES);
    if ("refused" in look) throw new Error(look.refused);
    const zs = look.faces.filter((f) => f.owner === "piece/b/p0").flatMap((f) => f.points.map((p) => p.z));
    expect(zs.length).toBeGreaterThan(0);
    expect([Math.min(...zs), Math.max(...zs)].map((z) => Math.round(z * 1000) / 1000)).toEqual([2.3, 2.5]);
  });
});

describe("a beam in the palette", () => {
  it("the Basic group has its card after the Wheel well", () => {
    const basic = PALETTE_KINDS.find((g) => g.group === "Basic")?.cards ?? [];
    const kinds = basic.map((c) => c.kind);
    expect(kinds.indexOf("beam")).toBe(kinds.indexOf("wheelWell") + 1);
    const card = basic.find((c) => c.kind === "beam");
    expect([card?.name, card?.w, card?.d]).toEqual(["Beam", 2.4, 0.15]);
  });

  it("quick add finds it by its name, joist and collar tie", () => {
    expect(searchPalette("beam")[0]?.kind).toBe("beam");
    expect(searchPalette("joist")[0]?.kind).toBe("beam");
    expect(searchPalette("collar tie").some((r) => r.kind === "beam")).toBe(true);
  });
});
