import { beforeEach, describe, expect, it, vi } from "vitest";
import { levelOf, swingZone, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { warningsLayer } from "../src/view/objects-layer";
import { floorView, viewAt } from "../src/view/plan-view";
import { shownWarnings } from "../src/view/warnings";
import { LOFT_WALL, loftWallDoc, roomDoc, wallBetween, withCommands } from "./builders";

// Which warnings a viewer sees (clarity.04, .09): one owner, read by the warnings layer and the count.

const rings = vi.hoisted(() => ({ gone: false }));
// A real document never has a use zone without a ring (zoneShapes makes both), so this one case has to pretend.
vi.mock("@fm/domain", async (original) => {
  const domain = await original<typeof import("@fm/domain")>();
  return { ...domain, zoneRings: (doc: Document) => (rings.gone ? new Map() : domain.zoneRings(doc)) };
});
beforeEach(() => {
  rings.gone = false;
});

const place = (opId: string, kind: string, at: Point, more: Partial<Extract<Command, { type: "placeObject" }>> = {}): Command =>
  ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at, ...more });

/** A small low box, its back edge's middle at `at`, so it fits where a test wants it. */
const box = (opId: string, at: Point, deck: string | null = null): Command[] => [
  place(opId, "block", at, { deck, object: { kind: "block", size: { w: 0.2, d: 0.2 } } }),
  { type: "setObjectSize", objectId: `${opId}/o0`, w: 0.2, d: { standard: 0.2 }, h: { standard: 0.3 } },
];

const LOFT = "loft/k0";
/** roomDoc's shell (ceiling 2.50) with a Loft (top 2.15) on the left, away from the right side these tests use. */
const lofted = (...more: Command[]): Document =>
  withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.3, y: 2 }, w: 2.4, d: 3.8 }, ...more);
const atLoft = (doc: Document, layout = "s0") => viewAt(layout, levelOf(doc, LOFT));

/** A wardrobe on the top wall (x 3.4–4.6, y 3.3–3.9), 2.20 tall so it rises past the loft and the loft shows it. */
const wardrobe = (y = 3.9): Command[] => [
  place("w", "wardrobe", { x: 4, y }),
  { type: "setObjectSize", objectId: "w/o0", w: 1.2, d: { standard: 0.6 }, h: { standard: 2.2 } },
];
const front = (id: string) => ({ table: "placements", id, side: "front" }) as const;

/**
 * A door on the bottom wall (x 3–3.8, swinging up to y 0.9) under a 2.20 ceiling, so the floor's cut is 1.10 and a
 * platform at 1.15 beside the swing's left half is a level of its own (x 2.8–3.4): a piece standing on it blocks the
 * swing, being lower than 1.20, and the floor doesn't show it.
 */
function swingWithHiddenBox(...more: Command[]): { doc: Document; door: string } {
  const base = withCommands(roomDoc(), { type: "setCeiling", height: 2.2 });
  const doc = withCommands(base,
    { type: "addOpening", opId: "o", wall: wallBetween(base, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 3 },
    { type: "addDeck", opId: "low", preset: "platform", at: { x: 3.1, y: 0.5 }, w: 0.6, d: 0.8, top: 1.15 },
    ...box("hid", { x: 3.1, y: 0.6 }, "low/k0"),
    ...more,
  );
  return { doc, door: "o/d0" };
}

describe("a door on a loft's wall (cycle home, spec: levels, AC-04)", () => {
  // loftWallDoc's loft (top 2.45) is over x 0.1–2.9 with a wall on it at x 1.5; its door (y 1.6–2.4) swings west over
  // x 0.6–1.4, where a stool stands on the loft.
  const doc = withCommands(loftWallDoc(),
    { type: "addOpening", opId: "ld", wall: LOFT_WALL, kind: "swing", offset: 1.5, width: 0.8 },
    place("st", "stool", { x: 1, y: 2.2 }, { deck: LOFT }));
  const swing = { table: "openings", id: "ld/d0" };

  it("its blocked swing shows at the loft, with the piece that blocks it, and not at the floor", () => {
    const atTheLoft = shownWarnings(doc, atLoft(doc));
    expect(atTheLoft.map((w) => w.zone)).toEqual([swing]);
    expect(atTheLoft[0]?.blockers).toEqual([expect.objectContaining({ kind: "piece", placement: "st/p0" })]);
    expect(shownWarnings(doc, floorView(doc, "s0"))).toEqual([]);
  });

  it("the ring drawn is the swing, on the loft's side of the wall", () => {
    expect(warningsLayer(doc, atLoft(doc)).length).toBeGreaterThan(0);
    expect(warningsLayer(doc, floorView(doc, "s0"))).toEqual([]);
    expect(swingZone(doc, "ld/d0")?.every((p) => p.x <= 1.4 + 1e-9 && p.x >= 0.6 - 1e-9)).toBe(true);
  });
});

describe("shownWarnings", () => {
  it("leaves out a piece the level doesn't show", () => {
    // A sofa against the bottom wall, its front zone running into it: a warning at the floor, gone at the loft under which the sofa stands.
    const doc = lofted(place("s", "sofa", { x: 4.5, y: 1 }));
    expect(shownWarnings(doc, floorView(doc, "s0")).map((w) => w.zone)).toContainEqual(front("s/p0"));
    expect(shownWarnings(doc, atLoft(doc))).toEqual([]);
  });

  it("a door's swing goes with its door", () => {
    // The door is under the loft's level; the wardrobe in its swing rises past it and still shows.
    const base = lofted();
    const doc = withCommands(base,
      { type: "addOpening", opId: "o", wall: wallBetween(base, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 3.6 },
      ...wardrobe(1.4), // y 0.8–1.4: 0.1 into the swing
    );
    const swing = { table: "openings", id: "o/d0" };
    expect(shownWarnings(doc, floorView(doc, "s0")).map((w) => w.zone)).toContainEqual(swing);
    expect(shownWarnings(doc, atLoft(doc)).map((w) => w.zone)).not.toContainEqual(swing);
    expect(shownWarnings(doc, atLoft(doc)).flatMap((w) => w.blockers)).not.toContainEqual(expect.objectContaining({ placement: "w/p0" }));
  });

  it("one entry per zone, however many blockers", () => {
    const doc = lofted(...wardrobe(), ...box("a", { x: 3.7, y: 3.2 }), ...box("b", { x: 4.3, y: 3.2 }));
    const shown = shownWarnings(doc, floorView(doc, "s0"));
    expect(shown.map((w) => w.zone)).toEqual([front("w/p0")]);
    expect(shown[0]?.blockers.map((b) => (b.kind === "piece" ? b.placement : b.kind))).toEqual(["a/p0", "b/p0"]);
  });

  it("no entry for a zone with no ring", () => {
    const doc = lofted(...wardrobe(), ...box("a", { x: 4, y: 3.2 }));
    expect(shownWarnings(doc, floorView(doc, "s0"))).toHaveLength(1);
    rings.gone = true;
    const other = withCommands(doc, ...box("b", { x: 3.6, y: 3.2 })); // a new document: the memo keeps the last call
    expect(shownWarnings(other, floorView(other, "s0"))).toEqual([]);
    expect(warningsLayer(other, floorView(other, "s0"))).toEqual([]);
  });

  it("a swing blocked by a hidden piece and a shown chair names only the chair", () => {
    const { doc, door } = swingWithHiddenBox(place("c", "chair", { x: 3.65, y: 0.7 }));
    const swing = shownWarnings(doc, floorView(doc, "s0")).find((w) => w.zone.id === door);
    expect(swing?.blockers).toEqual([{ kind: "piece", placement: "c/p0", object: "c/o0", name: "Chair" }]);
    // The level that shows the box and hides the chair names the box, where the door is cut too.
    const low = viewAt("s0", levelOf(doc, "low/k0"));
    expect(shownWarnings(doc, low).find((w) => w.zone.id === door)?.blockers).toEqual([expect.objectContaining({ placement: "hid/p0" })]);
  });

  it("a zone blocked only by a hidden piece has no entry", () => {
    const { doc, door } = swingWithHiddenBox();
    expect(shownWarnings(doc, floorView(doc, "s0")).map((w) => w.zone.id)).not.toContain(door);
  });

  it("a use zone goes with its own piece: a shown wardrobe keeps its warning and names the chair under the loft", () => {
    // As the plan draws today (levels-layers.test.ts, "the wardrobe's stays"): only a swing goes with what blocks it.
    const doc = lofted(...wardrobe(), place("c", "chair", { x: 4, y: 3.2 }));
    expect(shownWarnings(doc, atLoft(doc)).find((w) => w.zone.id === "w/p0")?.blockers).toEqual([{ kind: "piece", placement: "c/p0", object: "c/o0", name: "Chair" }]);
  });

  it("a wall blocks at every level its zone shows", () => {
    // The wardrobe faces the bottom wall from y 0.4, its front zone running into it.
    const doc = lofted(...wardrobe(1));
    const wall = [{ kind: "wall" }];
    expect(shownWarnings(doc, floorView(doc, "s0")).find((w) => w.zone.id === "w/p0")?.blockers).toEqual(wall);
    expect(shownWarnings(doc, atLoft(doc)).find((w) => w.zone.id === "w/p0")?.blockers).toEqual(wall);
  });

  it("no layout, no warnings", () => {
    const doc = lofted(place("s", "sofa", { x: 4.5, y: 1 }));
    expect(shownWarnings(doc, floorView(doc, null))).toEqual([]);
  });

  it("the layer draws one polygon per entry, then their outlines", () => {
    const doc = lofted(...wardrobe(), ...box("a", { x: 3.7, y: 3.2 }), ...box("b", { x: 4.3, y: 3.2 }));
    const view = floorView(doc, "s0");
    const shown = shownWarnings(doc, view);
    expect(shown.map((w) => w.blockers.length)).toEqual([2]);
    expect(warningsLayer(doc, view).filter((p) => p.kind === "polygon")).toEqual(shown.map((w) => ({ kind: "polygon", points: w.ring, holes: [], color: COLORS.warning })));
    const { doc: withDoor, door } = swingWithHiddenBox(place("c", "chair", { x: 3.65, y: 0.7 }));
    expect(shownWarnings(withDoor, floorView(withDoor, "s0")).find((w) => w.zone.id === door)?.ring).toBe(swingZone(withDoor, door));
  });
});
