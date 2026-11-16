import { describe, expect, it } from "vitest";
import { levelOf, levels, type Command, type Document, type Level } from "@fm/domain";
import { openingsLayer } from "../../src/view/openings-layer";
import { planPicture } from "../../src/view/picture";
import { floorView } from "../../src/view/plan-view";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../../src/view/plan-style";
import type { Primitive } from "../../src/view/scene-types";
import { LOFT_ROOM_LOFT, loftRoomDoc, wallBetween, withCommands } from "../builders";

// The plan per level (sills step 07, AC-06; sills.05): an opening the level's cut crosses draws as today; one wholly
// above the cut draws its span's outline across the wall dashed, with no leaf, swing or glass; one wholly below isn't
// drawn. loftRoomDoc: the 6 × 4 shell under 3.05, the floor's cut at 1.20, the loft at 2.15 whose cut is 2.60.

const north = (doc: Document): string => wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });
/** loftRoomDoc with one window on its north wall, x 4.5–5.5, sill and head as given. */
function withWindow(sill: number, head: number): Document {
  const doc = loftRoomDoc();
  const wall = north(doc);
  const a = doc.joints[doc.walls[wall]?.a ?? ""];
  const cmd: Command = { type: "addOpening", opId: "w", wall, kind: "window", offset: a?.x === 0 ? 4.5 : (a?.x ?? 0) - 5.5, sill, head };
  return withCommands(doc, cmd);
}
const floorLevel = (doc: Document): Level => levels(doc)[0] ?? levelOf(doc, null);
const layer = (doc: Document, level: Level): readonly Primitive[] => openingsLayer(doc, level, CANVAS_STYLE, "", false, "", true);
const dashed = (ps: readonly Primitive[]): boolean => ps.length > 0 && ps.every((p) => p.kind === "segment" && p.dash !== undefined);

describe("openings at each level's cut (sills step 07)", () => {
  it("at the floor, a window 2.40–2.90 draws only its outline, dashed: two jambs and two faces", () => {
    const doc = withWindow(2.4, 2.9);
    const ps = layer(doc, floorLevel(doc));
    expect(ps).toHaveLength(4);
    expect(dashed(ps)).toBe(true);
  });

  it("at the floor, a window 0.90–2.10 draws as today, with solid lines", () => {
    const doc = withWindow(0.9, 2.1);
    const ps = layer(doc, floorLevel(doc));
    expect(ps.some((p) => p.kind === "segment" && p.dash === undefined)).toBe(true);
  });

  it("at the floor, a window 0.30–1.00 under the cut isn't drawn", () => {
    const doc = withWindow(0.3, 1);
    expect(layer(doc, floorLevel(doc))).toEqual([]);
  });

  it("at the loft's level, cut at 2.60, the window 2.40–2.90 draws as today and the window 0.90–2.10 isn't drawn", () => {
    const high = withWindow(2.4, 2.9);
    expect(layer(high, levelOf(high, LOFT_ROOM_LOFT)).some((p) => p.kind === "segment" && p.dash === undefined)).toBe(true);
    const low = withWindow(0.9, 2.1);
    expect(layer(low, levelOf(low, LOFT_ROOM_LOFT))).toEqual([]);
  });

  it("on paper the floor's plan dashes the window 2.40–2.90", () => {
    const doc = withWindow(2.4, 2.9);
    const p = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true);
    expect(dashed(p.openings)).toBe(true);
    expect(p.openings).toHaveLength(4);
  });
});
