import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { cardFrame3d, view3dFrame } from "../../src/view3d-state";
import { DEFAULT_ANGLES } from "../../src/view3d/camera3d";
import { lookScene3d } from "../../src/view3d/look3d";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d } from "../../src/view3d/types";
import { clearRoomDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";

// Steps at doors on wheels (trailer.06; AC-05, AC-10): three solid treads down from each outside door to the ground
// 0.75 m below, 0.28 m deep, as wide as the opening plus 0.10 m a side, in wood, in the panel, look and cards.

/** A 7 × 2.5 room, a 0.80 m swing door on its lower wall (y = 0, outer face y = −0.1) from x 3 to 3.8. */
const withDoor = (surroundings: string, ...more: Parameters<typeof withCommands>[1][]): Document =>
  withCommands(
    clearRoomDoc(7, 2.5, "c"),
    { type: "addOpening", opId: "d", wall: "c-1/w0", kind: "swing", offset: 3, width: 0.8 },
    { type: "setProjectField", key: "surroundings", value: surroundings },
    ...more,
  );
const look = (doc: Document): Face3d[] => {
  const l = lookScene3d(doc, "s0", DEFAULT_ANGLES);
  if ("refused" in l) throw new Error(l.refused);
  return l.faces;
};
const steps = (fs: readonly Face3d[]): Face3d[] => fs.filter((f) => f.owner.startsWith("trailer/steps-"));
const range = (fs: readonly Face3d[], k: "x" | "y" | "z"): [number, number] => {
  const v = fs.flatMap((f) => f.points.map((p) => p[k]));
  return [Math.min(...v), Math.max(...v)];
};
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

describe("steps at an outside door (AC-05)", () => {
  it("three treads, 0.1875 m apart in height, 0.28 m deep, 0.84 m out from the outer face, the door's width plus 0.10 a side", () => {
    const s = steps(look(withDoor("wheels")));
    expect(s.length).toBeGreaterThan(0);
    expect(new Set(s.map((f) => f.owner))).toEqual(new Set(["trailer/steps-d/d0"]));
    // The tread tops: flat faces, their heights and their depths out from the wall.
    const tops = s.filter((f) => f.points.every((p) => Math.abs(p.z - (f.points[0]?.z ?? 0)) < 1e-9) && f.color === STYLE_3D.slots.wood.top);
    expect(tops.map((f) => round(f.points[0]?.z ?? 0)).sort((a, b) => b - a)).toEqual([-0.1875, -0.375, -0.5625]);
    for (const t of tops) expect(round(range([t], "y")[1] - range([t], "y")[0])).toBe(0.28);
    expect(range(s, "y").map(round)).toEqual([-0.1 - 0.84, -0.1].map(round));
    expect(range(s, "x").map(round)).toEqual([2.9, 3.9]);
    expect(round(range(s, "z")[0])).toBe(-0.75);
  });

  it("none under Outside, none for a door between rooms, none for a window", () => {
    expect(steps(look(withDoor("outside")))).toEqual([]);
    const window = withCommands(clearRoomDoc(7, 2.5, "c"), { type: "addOpening", opId: "d", wall: "c-1/w0", kind: "window", offset: 3, width: 0.8 }, { type: "setProjectField", key: "surroundings", value: "wheels" });
    expect(steps(look(window))).toEqual([]);
    const inner = withCommands(
      clearRoomDoc(7, 2.5, "c"),
      { type: "addWall", opId: "p", from: { at: { x: 4, y: 0 } }, to: { at: { x: 4, y: 2.5 } } },
      { type: "addOpening", opId: "d", wall: "p/w0", kind: "swing", offset: 0.8, width: 0.8 },
      { type: "setProjectField", key: "surroundings", value: "wheels" },
    );
    expect(steps(look(inner))).toEqual([]);
  });
});

describe("the panel, look and cards (AC-10)", () => {
  it("draw the same steps", () => {
    const doc = withDoor("wheels");
    const fromLook = steps(look(doc));
    expect(fromLook.length).toBeGreaterThan(0);
    const s = FakeShell.withDocument(doc);
    s.key("3");
    expect(steps(view3dFrame(s.state)?.scene.trailer ?? [])).toEqual(fromLook);
    expect(steps(cardFrame3d(doc, "s0", null, DEFAULT_ANGLES.yaw, DEFAULT_ANGLES.tilt)?.scene.trailer ?? [])).toEqual(fromLook);
  });
});
