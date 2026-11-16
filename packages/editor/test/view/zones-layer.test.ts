import { describe, expect, it } from "vitest";
import { motifDefaults, zones, type Document } from "@fm/domain";
import { COLORS } from "../../src/view/colors";
import { idsKey } from "../../src/view/memo";
import { ringEdges } from "../../src/view/rings";
import { SELECTED_FLOOR_PX, selectedFloorsLayer, zoneFillsLayer } from "../../src/view/zones-layer";
import { donutDoc, labelledDoc, withCommands } from "../builders";

// Room fills beside the floors layer (AC-03, finishes.03, .47): a finished room draws no blue; the Zone tool's hover
// tints it, and selected it gets an outline instead.

/** labelledDoc with Room 1 (L1) in planks; Room 2 (L2) labelled, unfinished. */
const doc = (): Document => withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("planks") });
const floorOf = (d: Document, label: string) => zones(d).find((z) => z.labelIds.includes(label))?.floor;
const colours = (d: Document, ps: ReturnType<typeof zoneFillsLayer>, label: string): string[] =>
  ps.flatMap((p) => (p.kind === "polygon" && p.points === floorOf(d, label) ? [p.color] : []));

describe("zone fills with finishes (finishes.03)", () => {
  it("a finished room has no blue, selected or not; hovered in the Zone tool, it gets zoneFinishTint (finishes.47)", () => {
    const d = doc();
    expect(colours(d, zoneFillsLayer(d, "", false, null, true), "L1")).toEqual([]);
    expect(colours(d, zoneFillsLayer(d, idsKey(["L1"]), false, null, true), "L1")).toEqual([]); // its colours stay as they are
    expect(colours(d, zoneFillsLayer(d, idsKey(["L1"]), true, null, true), "L1")).toEqual([]); // selected in the Zone tool, not hovered
    const room = zones(d).find((z) => z.labelIds.includes("L1"));
    expect(colours(d, zoneFillsLayer(d, "", true, room?.face.key ?? null, true), "L1")).toEqual([COLORS.zoneFinishTint]); // hovered in the Zone tool
    expect(colours(d, zoneFillsLayer(d, idsKey(["L1"]), true, room?.face.key ?? null, true), "L1")).toEqual([COLORS.zoneFinishTint]);
  });

  it("the tint is the selection blue at about 35 %", () => {
    expect(COLORS.zoneFinishTint.slice(0, 7)).toBe(COLORS.wallSelected);
    expect(parseInt(COLORS.zoneFinishTint.slice(7), 16) / 255).toBeCloseTo(0.35, 2);
  });

  it("an unfinished labelled room keeps zoneFill", () => {
    const d = doc();
    expect(colours(d, zoneFillsLayer(d, "", false, null, true), "L2")).toEqual([COLORS.zoneFill]);
    expect(colours(d, zoneFillsLayer(d, idsKey(["L2"]), false, null, true), "L2")).toEqual([COLORS.zoneFillSelected]);
  });

  it("with finishes off, a finished room draws today's blue", () => {
    const d = doc();
    expect(colours(d, zoneFillsLayer(d, "", false, null, false), "L1")).toEqual([COLORS.zoneFill]);
    expect(colours(d, zoneFillsLayer(d, idsKey(["L1"]), false, null, false), "L1")).toEqual([COLORS.zoneFillSelected]);
  });
});

describe("a selected finished room's outline (finishes.47)", () => {
  const blue = (ring: Parameters<typeof ringEdges>[0]) => ringEdges(ring, COLORS.wallSelected, SELECTED_FLOOR_PX, "round");

  it("is 2 px selection-blue edges along its floor; none unselected, for an unfinished room or with finishes off", () => {
    const d = doc();
    const floor = floorOf(d, "L1");
    if (!floor) throw new Error("no floor");
    expect(SELECTED_FLOOR_PX).toBe(2);
    expect(selectedFloorsLayer(d, idsKey(["L1"]), true)).toEqual(blue(floor));
    expect(selectedFloorsLayer(d, idsKey(["L1", "L2"]), true)).toEqual(blue(floor)); // L2 is unfinished: its fill shows it
    expect(selectedFloorsLayer(d, "", true)).toEqual([]);
    expect(selectedFloorsLayer(d, idsKey(["L2"]), true)).toEqual([]);
    expect(selectedFloorsLayer(d, idsKey(["L1"]), false)).toEqual([]); // the blue fill shows it
  });

  it("outlines each hole's footprint too", () => {
    const d = withCommands(donutDoc(), { type: "labelZone", id: "L1", at: { x: 1.5, y: 4 }, name: "Living", finish: motifDefaults("planks") });
    const room = zones(d).find((z) => z.labelIds.includes("L1"));
    if (!room?.floor || room.holes.length !== 1) throw new Error("no room with one hole");
    const hole = room.holes[0]?.footprint;
    if (!hole) throw new Error("no footprint");
    expect(selectedFloorsLayer(d, idsKey(["L1"]), true)).toEqual([...blue(room.floor), ...blue(hole)]);
  });
});
