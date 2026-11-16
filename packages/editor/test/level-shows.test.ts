import { describe, expect, it } from "vitest";
import { emptyDocument, levelOf, rectangleRoom, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { guideBoxes } from "../src/snapping/guides";
import { tagAt, tagLayout } from "../src/view/tags";
import { flipObjectsLayer, warningsLayer } from "../src/view/objects-layer";
import { floorView } from "../src/view/plan-view";
import { planView } from "../src/levels";
import type { LayerName, Primitive, Scene } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// What the floor level shows and lets you select (spec "What a level shows and what you can click", shown.01, .02;
// AC-01 to AC-03, AC-05, AC-06). A piece standing on a loft belongs to the loft: the floor doesn't draw it, hit it,
// box it, keep it selected or snap to it.

const LOFT = "loft/k0";
const MATTRESS = "mat/p0";
const LIFT = "lift/p0";

/**
 * The studio's bathroom: the 5.8 × 3.8 shell (roomDoc, ceiling 2.50) with a 2.03 partition at x = 1.6, closing a
 * bathroom (x 0.1–1.5) labelled "Bathroom" at (0.8, 2). A Loft (+2.15) over x 0.1–2.3, the whole depth, carries a
 * 1.40 × 3.60 mattress over the whole bathroom (x 0.1–1.5, y 0.2–3.8), so the tag has no free spot and stays under it.
 * In the main room a desk raised above the cut (1.30–1.60) stands on the floor, as the lift bed does by Day.
 */
function studio(): Document {
  return withCommands(
    roomDoc(),
    { type: "addWall", opId: "part", from: { at: { x: 1.6, y: 0 } }, to: { at: { x: 1.6, y: 4 } } },
    { type: "setWallTop", wallId: "part/w0", top: 2.03 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.2, y: 2 }, w: 2.2, d: 3.8 },
    { type: "labelZone", id: "B", at: { x: 0.8, y: 2 }, name: "Bathroom", finish: null },
    { type: "placeObject", deck: LOFT, opId: "mat", state: "s0", object: { kind: "mattress", size: { w: 1.4, d: 3.6 } }, at: { x: 0.8, y: 3.8 } },
    { type: "placeObject", deck: null, opId: "lift", state: "s0", object: { kind: "desk" }, at: { x: 4, y: 3.9 } },
    { type: "setObjectSize", objectId: "lift/o0", w: 1.2, d: { standard: 0.6 }, h: { standard: 0.3 }, z: { standard: 1.3 } },
  );
}

const TAG: Point = { x: 0.8, y: 2 };
const LIFT_AT: Point = { x: 4, y: 3.6 };
const piece = (id: string): EntityRef => ({ table: "placements", id });
const atLoft = (shell: FakeShell): FakeShell => {
  shell.ui({ type: "setViewedLevel", deck: LOFT });
  return shell;
};
const atFloor = (shell: FakeShell): FakeShell => {
  shell.ui({ type: "setViewedLevel", deck: null });
  return shell;
};
const layer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];
const pointsOf = (p: Primitive): readonly Point[] =>
  p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "text" ? [p.at] : [p.center];
/** The primitives wholly inside the box. */
const within = (ps: readonly Primitive[], x0: number, x1: number, y0: number, y1: number): Primitive[] =>
  ps.filter((p) => pointsOf(p).every((q) => q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && q.y >= y0 - 1e-6 && q.y <= y1 + 1e-6));
const mattress = (ps: readonly Primitive[]) => within(ps, 0.1, 1.5, 0.2, 3.8);
const lift = (ps: readonly Primitive[]) => within(ps, 3.4, 4.6, 3.3, 3.9);

describe("the floor level and a loft's pieces", () => {
  it("the fixture: the mattress stands on the loft, the tag lies under it, the desk is on the floor", () => {
    const doc = studio();
    expect(doc.placements[MATTRESS]?.deck).toBe(LOFT);
    expect(doc.placements[LIFT]?.deck).toBeNull();
    const shell = FakeShell.withDocument(doc);
    expect(tagAt(doc, TAG, shell.state.camera, "s0")).toBe("B");
  });

  it("AC-01: the floor draws no primitive for the loft's mattress; the raised desk still draws dashed", () => {
    const scene = FakeShell.withDocument(studio()).scene();
    expect(mattress(layer(scene, "objects"))).toEqual([]);
    const desk = lift(layer(scene, "objects"));
    expect(desk.length).toBeGreaterThan(0);
    expect(desk.every((p) => p.kind === "segment" && p.dash !== undefined)).toBe(true);
  });

  it("AC-03: the loft draws the mattress", () => {
    const scene = atLoft(FakeShell.withDocument(studio())).scene();
    expect(mattress(layer(scene, "objects")).length).toBeGreaterThan(0);
  });

  it("AC-02: at the floor a click on the bathroom's tag selects the bathroom; at the loft the same click selects the mattress", () => {
    const floor = FakeShell.withDocument(studio());
    floor.click(TAG);
    expect(floor.state.selection).toEqual([{ table: "zoneLabels", id: "B" }]);
    const loft = atLoft(FakeShell.withDocument(studio()));
    loft.click(TAG);
    expect(loft.state.selection).toEqual([piece(MATTRESS)]);
  });

  it("AC-04: at the floor a click on the raised desk selects it", () => {
    const shell = FakeShell.withDocument(studio());
    shell.click(LIFT_AT);
    expect(shell.state.selection).toEqual([piece(LIFT)]);
  });

  it("AC-02: a box over the whole plan at the floor selects the desk and not the mattress", () => {
    const shell = FakeShell.withDocument(studio());
    shell.drag({ x: -1, y: -1 }, { x: 7, y: 5 });
    expect(shell.state.selection.filter((r) => r.table === "placements")).toEqual([piece(LIFT)]); // the walls inside the box come too (straight.09)
  });

  it("AC-05: viewing the floor with the mattress selected at the loft drops it", () => {
    const shell = atLoft(FakeShell.withDocument(studio()));
    shell.click(TAG);
    expect(shell.state.selection).toEqual([piece(MATTRESS)]);
    atFloor(shell);
    expect(shell.state.selection).toEqual([]);
  });

  it("AC-06: at the floor the guides leave out the loft's mattress; at the loft they keep it", () => {
    const doc = studio();
    const floor = levelOf(doc, null);
    const loft = levelOf(doc, LOFT);
    const ids = (level: typeof floor): number => guideBoxes(doc, "s0", new Set(), level).length;
    expect(ids(floor)).toBe(1); // the desk
    expect(guideBoxes(doc, "s0", new Set([LIFT]), loft)).toHaveLength(1); // the mattress
  });
});

describe("moving a piece onto a loft from the floor", () => {
  it("Stands on: Loft at the floor drops the piece from the selection; at the loft an undo back to the floor drops it", () => {
    const doc = withCommands(studio(), { type: "movePlacement", placementId: MATTRESS, at: { x: 0.8, y: 3.8 }, rotation: 0, deck: null } satisfies Command);
    const shell = FakeShell.withDocument(doc);
    shell.click(TAG);
    expect(shell.state.selection).toEqual([piece(MATTRESS)]);
    shell.ui({ type: "setField", fieldId: "standsOn", value: LOFT });
    expect(shell.doc().placements[MATTRESS]?.deck).toBe(LOFT);
    expect(shell.state.selection).toEqual([]);
  });
});

describe("room tags at the floor and a loft's pieces (AC-06)", () => {
  /** The studio with a shorter mattress over the tag (y 1.2–2.8), leaving free bathroom floor below and above it. */
  const shorter = (): Document =>
    withCommands(studio(), { type: "setObjectSize", objectId: "mat/o0", w: 1.4, d: { standard: 1.6 } }, { type: "movePlacement", placementId: MATTRESS, at: { x: 0.8, y: 2.8 }, rotation: 0, deck: LOFT });

  it("the bathroom's tag stays at its point under the loft's mattress: the floor doesn't show the mattress", () => {
    const tag = tagLayout(shorter(), "B", { zoom: 80 }, "s0");
    if (!tag) throw new Error("no tag");
    expect((tag.min.x + tag.max.x) / 2).toBeCloseTo(0.8, 9);
    expect((tag.min.y + tag.max.y) / 2).toBeCloseTo(2, 9);
  });

  it("a floor piece in the same place still moves the tag off it", () => {
    const doc = withCommands(shorter(), { type: "movePlacement", placementId: MATTRESS, at: { x: 0.8, y: 2.8 }, rotation: 0, deck: null });
    const tag = tagLayout(doc, "B", { zoom: 80 }, "s0");
    if (!tag) throw new Error("no tag");
    const y = (tag.min.y + tag.max.y) / 2;
    expect(y < 1.2 || y > 2.8).toBe(true);
  });
});

describe("a stair on the floor reaching the loft (AC-04)", () => {
  /**
   * The 7 × 2.5 studio (inner x 0.1–6.9, y 0.1–2.4) under a 3.05 ceiling, a Loft over x 0.1–3.6, and a straight stair
   * on the floor from the loft's edge at x 3.6 rising toward it, reaching it (stair-kinds-symbol.test.ts's studio).
   */
  const STAIR = "s/p0";
  const doc = (): Document =>
    withCommands(
      emptyDocument(),
      ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"),
      { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
      { type: "placeObject", opId: "s", state: "s0", object: { kind: "stair" }, at: { x: 3.6, y: 1.95 }, rotation: 90, deck: null, reaches: LOFT },
    );
  const ON_STAIR = { x: 4.5, y: 1.95 };

  it("draws and selects at the floor; draws at the loft and doesn't select there", () => {
    const floor = FakeShell.withDocument(doc());
    expect(within(layer(floor.scene(), "objects"), 3.6, 6.6, 1.4, 2.4).length).toBeGreaterThan(0);
    floor.click(ON_STAIR);
    expect(floor.state.selection).toEqual([piece(STAIR)]);
    const loft = atLoft(FakeShell.withDocument(doc()));
    expect(within(layer(loft.scene(), "objects"), 3.6, 6.6, 1.4, 2.4).length).toBeGreaterThan(0);
    loft.click(ON_STAIR);
    expect(loft.state.selection).toEqual([]);
  });

  it("its blocked use zone warns at the loft as at the floor, since the loft draws it whole", () => {
    const d = doc();
    const floor = warningsLayer(d, floorView(d, "s0"));
    expect(floor.length).toBeGreaterThan(0);
    const view = planView(atLoft(FakeShell.withDocument(d)).state);
    if (!view) throw new Error("no view");
    expect(view.level.height).toBe(2.15);
    expect(warningsLayer(d, view)).toEqual(floor);
  });
});

describe("the Day/Night flip at the floor (shown.02)", () => {
  it("halfway through a flip the floor draws the raised desk and not the loft's mattress; the loft draws the mattress", () => {
    const doc = withCommands(studio(), { type: "copyState", opId: "night", from: "s0", name: "Night" });
    const flip = { from: "s0", to: "night/s0", t: 0.5 };
    const floor = flipObjectsLayer(doc, levelOf(doc, null), flip);
    expect(lift(floor).length).toBeGreaterThan(0); // the raised desk, dashed, as the still plan draws it
    expect(mattress(floor)).toEqual([]);
    expect(mattress(flipObjectsLayer(doc, levelOf(doc, LOFT), flip)).length).toBeGreaterThan(0);
  });
});
