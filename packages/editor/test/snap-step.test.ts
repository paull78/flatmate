import { describe, expect, it } from "vitest";
import { boxOf, footprints, placementCentre, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { TRACING_STEP, snapStep } from "../src/snapping/snap";
import { SNAP_STEPS, type SnapStep } from "../src/types";
import { bed160x200, jointAt, pointOf, roomDoc, studioDoc, underlayDoc, wallBetween, wallDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The chosen snap step (direct.14, AC-14). studioDoc's bed bed/p0 is anchored at (1.5, 3): x 0.7–2.3, y 1–3, width
// 1.6, centre (1.5, 2). Drags round their delta from the press; joints and wall drawing snap absolute points.

const BED = { x: 1.5, y: 2 };

/** A fresh shell on `doc` at `zoom`, with `step` chosen (none: Auto). */
function shellOn(doc: Document, zoom: number, step?: SnapStep): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
  if (step !== undefined) shell.ui({ type: "setSnapStep", step });
  return shell;
}

function bedAt(shell: FakeShell): Point | undefined {
  return shell.doc().placements["bed/p0"]?.at;
}

/** A swing door d/d0 on the bottom wall (0, 0)–(6, 0), offset 2.6: span x 2.6–3.4 (as select-openings.test.ts). */
const doorDoc = (): Document => {
  const doc = roomDoc();
  return withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2.6, side: "left" });
};

describe("snap step", () => {
  it("snapStep: the zoom grid on Auto, 1 cm on Auto while a shown underlay exists, else the chosen step", () => {
    expect(SNAP_STEPS).toEqual(["auto", 0.01, 0.05, 0.1, 0.25, 0.5]);
    expect(TRACING_STEP).toBe(0.01);
    const zooms = [[20, 1], [80, 0.2], [320, 0.05]] as const;
    for (const [zoom, grid] of zooms) {
      expect(snapStep(shellOn(roomDoc(), zoom).state), `no picture, zoom ${zoom}`).toBe(grid); // visible, but no row
      expect(snapStep(shellOn(underlayDoc(), zoom).state), `shown, zoom ${zoom}`).toBe(0.01);
      const hidden = shellOn(underlayDoc(), zoom);
      hidden.ui({ type: "toggleUnderlay" });
      expect(snapStep(hidden.state), `hidden, zoom ${zoom}`).toBe(grid);
      const fixed = shellOn(underlayDoc(), zoom, 0.25);
      expect(snapStep(fixed.state), `0.25 shown, zoom ${zoom}`).toBe(0.25);
      fixed.ui({ type: "toggleUnderlay" });
      expect(snapStep(fixed.state), `0.25 hidden, zoom ${zoom}`).toBe(0.25);
    }
    const shell = shellOn(underlayDoc(), 80);
    expect(snapStep({ ...shell.state, document: null })).toBe(0.2);
  });

  it("setSnapStep keeps the step in editor state; the grid chip still follows the zoom (direct.14)", () => {
    const shell = shellOn(studioDoc(), 80);
    expect(shell.view().snapStep).toBe("auto");
    expect(shell.view().snapSteps.map((s) => s.label)).toEqual(["Auto", "1", "5", "10", "25", "50"]);
    shell.ui({ type: "setSnapStep", step: 0.25 });
    expect(shell.state.snapSettings).toEqual({ tolerancePx: 10, step: 0.25 });
    expect(shell.view().snapStep).toBe(0.25);
    expect(shell.view().gridStep).toBe(0.2);
  });

  it("a furniture drag moves by multiples of 25 cm at zooms 20, 80 and 320 (AC-14)", () => {
    const to = { x: 2.37, y: 2 };
    for (const zoom of [20, 80, 320]) {
      const shell = shellOn(studioDoc(), zoom, 0.25);
      shell.drag(BED, to);
      expect(bedAt(shell), `zoom ${zoom}`).toEqual({ x: 2.25, y: 3 }); // 0.87 rounds to 3 × 0.25
    }
    for (const [zoom, x] of [[20, 2.5], [80, 2.3], [320, 2.35]] as const) {
      const auto = shellOn(studioDoc(), zoom);
      auto.drag(BED, to);
      expect(bedAt(auto)?.x, `Auto at zoom ${zoom}`).toBeCloseTo(x, 6);
    }
    const ctrl = shellOn(studioDoc(), 80, 0.25);
    ctrl.drag(BED, to, { ctrl: true });
    expect(bedAt(ctrl)?.x).toBeCloseTo(2.37, 3);
  });

  it("a group drag moves every piece by the same 25 cm multiple (AC-14)", () => {
    // The desk spans x 3.4–4.6, y 1.9–2.5, centre (4, 2.2).
    const doc = withCommands(studioDoc(), { type: "placeObject", deck: null, opId: "desk", state: "s0", object: { kind: "desk" }, at: { x: 4, y: 2.5 } });
    const shell = shellOn(doc, 80, 0.25);
    shell.click(BED);
    shell.click({ x: 4, y: 2.2 }, { shift: true });
    shell.drag(BED, { x: 2.37, y: 2 });
    const desk = Object.entries(shell.doc().placements).find(([id]) => id !== "bed/p0")?.[1];
    expect(bedAt(shell)?.x).toBe(2.25);
    expect(desk?.at.x).toBe(4.75);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("wall drags, joint drags and opening slides use the step (AC-14)", () => {
    const wall = shellOn(roomDoc(), 80, 0.25);
    wall.drag({ x: 6, y: 2 }, { x: 6.63, y: 2.05 });
    expect(pointOf(wall.doc(), jointAt(roomDoc(), { x: 6, y: 4 }))).toEqual({ x: 6.75, y: 4 }); // Auto: 6.6

    const single = wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 });
    const end = jointAt(single, { x: 2, y: 0 });
    const joint = shellOn(single, 80, 0.25);
    joint.drag({ x: 2, y: 0 }, { x: 2.37, y: 0.6 });
    expect(pointOf(joint.doc(), end)).toEqual({ x: 2.25, y: 0.5 }); // Auto: (2.4, 0.6)
    const autoJoint = shellOn(single, 80);
    autoJoint.drag({ x: 2, y: 0 }, { x: 2.37, y: 0.6 });
    expect(pointOf(autoJoint.doc(), end)).toEqual({ x: 2.4, y: 0.6 });

    const door = shellOn(doorDoc(), 80, 0.25);
    door.drag({ x: 3, y: 0 }, { x: 3.37, y: 0 });
    expect(door.doc().openings["d/d0"]?.offset).toBeCloseTo(2.85, 6);
    const autoDoor = shellOn(doorDoc(), 80);
    autoDoor.drag({ x: 3, y: 0 }, { x: 3.37, y: 0 });
    expect(autoDoor.doc().openings["d/d0"]?.offset).toBeCloseTo(3, 6);
  });

  it("a one-piece drag decides the contact turn on the chosen step (AC-14, furnish.16)", () => {
    // A bed centred on (3, 2), turned 10° (as select-objects.test.ts): its lowest corner is 1.124 m below its centre.
    const tilted = (step?: SnapStep): FakeShell => {
      const doc = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3 } }, bed160x200("bed/o0"));
      const shell = shellOn(doc, 80, step);
      shell.click({ x: 3, y: 2 });
      shell.ui({ type: "setField", fieldId: "angle", value: "10" });
      shell.key("Escape");
      return shell;
    };
    const quarter = tilted(0.25);
    quarter.drag({ x: 3, y: 2 }, { x: 3, y: 1.35 }); // -0.65 rounds to -0.75: the corner comes 0.026 m from the face
    expect(quarter.doc().placements["bed/p0"]).toMatchObject({ at: { x: 3, y: 0.1 }, rotation: 180 }); // turned and flush
    const auto = tilted();
    auto.drag({ x: 3, y: 2 }, { x: 3, y: 1.35 }); // Auto at zoom 80 rounds to -0.6: 0.176 m, out of reach, no turn
    expect(auto.doc().placements["bed/p0"]?.rotation).toBe(10);
  });

  it("wall drawing snaps to 25 cm at zooms 20, 80 and 320 (AC-14)", () => {
    const draw = (zoom: number, step?: SnapStep): Document => {
      const shell = FakeShell.local();
      shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
      if (step !== undefined) shell.ui({ type: "setSnapStep", step });
      shell.key("w");
      shell.click({ x: 0, y: 0 });
      shell.click({ x: 1.37, y: 0.04 });
      return shell.doc();
    };
    for (const zoom of [20, 80, 320]) {
      const doc = draw(zoom, 0.25);
      expect(() => jointAt(doc, { x: 1.25, y: 0 }), `zoom ${zoom}`).not.toThrow();
    }
    expect(() => jointAt(draw(80), { x: 1.4, y: 0 })).not.toThrow();
  });

  it.each([20, 80, 320])("a resize moves the size in 25 cm steps at zoom %i (AC-14)", (zoom) => {
    const shell = shellOn(studioDoc(), zoom, 0.25);
    shell.click(BED);
    shell.drag({ x: 2.3, y: 2 }, { x: 2.6, y: 2 }); // +0.30 along the width; the walls' faces are at x 0.1 and 5.9
    const d = shell.doc();
    const p = d.placements["bed/p0"];
    expect(p ? d.objects[p.object]?.w[p.config] : undefined).toEqual(1.85); // 1.6 + roundTo(0.30, 0.25)
    const quad = footprints(d).get("bed/p0");
    expect(quad ? boxOf(quad).minX : undefined).toBeCloseTo(0.7, 6);
    expect(shell.state.undo.past).toHaveLength(1);

    const auto = shellOn(studioDoc(), 320);
    auto.click(BED);
    auto.drag({ x: 2.3, y: 2 }, { x: 2.6, y: 2 });
    const a = auto.doc();
    const ap = a.placements["bed/p0"];
    expect(ap ? a.objects[ap.object]?.w[ap.config] : undefined).toBeCloseTo(1.9, 6); // Auto at zoom 320: 0.05 m
  });

  it("the nudge and the Object tool's ghost ignore the step (direct.09, direct.19)", () => {
    const nudge = shellOn(studioDoc(), 80, 0.25);
    nudge.click(BED);
    nudge.key("ArrowRight");
    nudge.click({ x: 8, y: 6 }); // empty canvas: commits the run (direct.10)
    expect(bedAt(nudge)?.x).toBeCloseTo(1.51, 6);

    const ghost = shellOn(roomDoc(), 80, 0.25);
    ghost.key("o"); // Bed armed
    ghost.click({ x: 3.37, y: 2.03 });
    const d = ghost.doc();
    const placed = Object.values(d.placements)[0];
    const centre = placed ? placementCentre(d, placed) : null;
    expect(centre?.x).toBeCloseTo(3.37, 6);
    expect(centre?.y).toBeCloseTo(2.03, 6);
  });
});
