import { describe, expect, it } from "vitest";
import { motifDefaults, type Document } from "@fm/domain";
import { COLORS } from "../../src/view/colors";
import { LAYER_ORDER } from "../../src/view/scene";
import type { LayerName, Primitive, Scene } from "../../src/view/scene-types";
import { LOFT_ROOM_LOFT, loftRoomDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";

// Where the floors layer sits and when it is built (finishes.03, spec "On the plan", "The Finishes switch").

const layer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];

/** The loft room (6 × 4 shell under a loft) labelled and finished in planks. */
const finishedLoftRoom = (): Document =>
  withCommands(
    loftRoomDoc(),
    { type: "labelZone", id: "L1", at: { x: 4.5, y: 1 }, name: "Living", finish: null },
    { type: "setFinish", id: "L1", finish: motifDefaults("planks") },
  );

describe("the finishes layer in the Scene", () => {
  it("the finishes layer sits below zoneFills; empty at an upper level and when finishesOn is false", () => {
    const i = LAYER_ORDER.indexOf("finishes");
    expect(LAYER_ORDER[i - 1]).toBe("ghosts");
    expect(LAYER_ORDER[i + 1]).toBe("zoneFills");

    const shell = FakeShell.withDocument(finishedLoftRoom());
    expect(shell.state.finishesOn).toBe(true);
    expect(layer(shell.scene(), "finishes").length).toBeGreaterThan(1);
    expect(layer(shell.scene(), "zoneFills")).toEqual([]); // the one room is finished: no blue

    shell.state = { ...shell.state, finishesOn: false };
    expect(layer(shell.scene(), "finishes")).toEqual([]);
    expect(layer(shell.scene(), "zoneFills")).toHaveLength(1); // today's blue

    shell.state = { ...shell.state, finishesOn: true };
    shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    expect(shell.state.viewedDeck).toBe(LOFT_ROOM_LOFT);
    expect(layer(shell.scene(), "finishes")).toEqual([]);
  });
});

describe("a selected finished room in the Scene (finishes.47)", () => {
  it("draws its outline in the annotations layer, above the walls, and no tint", () => {
    const shell = FakeShell.withDocument(finishedLoftRoom());
    shell.state = { ...shell.state, selection: [{ table: "zoneLabels", id: "L1" }] };
    const scene = shell.scene();
    expect(LAYER_ORDER.indexOf("annotations")).toBeGreaterThan(LAYER_ORDER.indexOf("walls"));
    expect(layer(scene, "zoneFills")).toEqual([]);
    const outline = layer(scene, "annotations").filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected);
    expect(outline.length).toBeGreaterThanOrEqual(4);
    shell.state = { ...shell.state, selection: [] };
    expect(layer(shell.scene(), "annotations").filter((p) => p.kind === "segment" && p.color === COLORS.wallSelected)).toEqual([]);
  });
});
