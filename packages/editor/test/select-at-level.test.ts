import { describe, expect, it } from "vitest";
import { type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { hitTest } from "../src/tools/hit-test";
import { handles } from "../src/view/handles";
import { zoneChips } from "../src/view/zone-chips";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// Selecting at a level (spec "Selecting at a level", levels.06, .19; AC-05). At an upper level only the level's decks
// and the pieces standing on them can be hit, hovered, box-selected or kept selected; at the floor nothing changes.

const LOFT = "loft/k0";
const PARTITION = "part/w0";
const MATTRESS = "bed/p0";
const place = (opId: string, kind: string, at: Point): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at });

/**
 * The studio of levels-layers.test.ts: the 5.8 × 3.8 shell (roomDoc, ceiling 2.50) split at x = 2.5 by a 2.03
 * partition with a door at y 2.6–3.4, under a Loft (top 2.15) at x 1.3–3.7, y 1.4–3.8; a sofa at x 3.55–5.65, y
 * 0.1–1.0, a 2.20 wardrobe at x 4.0–5.2, y 3.3–3.9, the room right of the partition labelled "Living" (tag at 4.5,
 * 2.2) and a dimension along the bottom (y −0.5). A 0.90 × 1.20 mattress, 0.30 high, at x 2.7–3.6, y 2.5–3.7: on the
 * loft, or on the floor under it with `onLoft` false.
 */
function studio(onLoft = true): Document {
  return withCommands(
    roomDoc(),
    { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
    { type: "setWallTop", wallId: PARTITION, top: 2.03 },
    { type: "addOpening", opId: "door", wall: PARTITION, kind: "swing", offset: 2.6 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 },
    place("sofa", "sofa", { x: 4.6, y: 1 }),
    place("ward", "wardrobe", { x: 4.6, y: 3.9 }),
    { type: "setObjectSize", objectId: "ward/o0", w: 1.2, d: { standard: 0.6 }, h: { standard: 2.2 } },
    { type: "labelZone", id: "L1", at: { x: 4.5, y: 2.2 }, name: "Living", finish: null },
    { type: "addDimension", opId: "dim", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 },
    { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed", size: { w: 0.9, d: 1.2 } }, at: { x: 3.15, y: 3.7 } },
    { type: "setObjectSize", objectId: "bed/o0", w: 0.9, d: { standard: 1.2 }, h: { standard: 0.3 } },
    ...(onLoft ? [{ type: "movePlacement", placementId: MATTRESS, at: { x: 3.15, y: 3.7 }, rotation: 0, deck: LOFT } satisfies Command] : []),
  );
}

const ON_MATTRESS = { x: 3.15, y: 3.1 };
const LOFT_TOP = { x: 1.8, y: 2 }; // left of the partition, under the loft
const PARTITION_UNDER_LOFT = { x: 2.5, y: 2 };
const DOOR_UNDER_LOFT = { x: 2.5, y: 3 };
const PARTITION_OUTSIDE = { x: 2.5, y: 0.7 };
const SHELL_WALL = { x: 0, y: 2 };
const SHELL_JOINT = { x: 0, y: 0 };
const WARDROBE = { x: 4.6, y: 3.6 };
const SOFA = { x: 4.6, y: 0.5 };
const DIMENSION = { x: 3, y: -0.5 };
const TAG = { x: 4.5, y: 2.2 };
const LIVING_FLOOR = { x: 5, y: 2.5 };

const deck = (id: string): EntityRef => ({ table: "decks", id });
const piece = (id: string): EntityRef => ({ table: "placements", id });
const atLoft = (shell: FakeShell): FakeShell => {
  shell.ui({ type: "setViewedLevel", deck: LOFT });
  return shell;
};
const clicked = (shell: FakeShell, at: Point): EntityRef[] => {
  shell.click(at);
  return shell.state.selection;
};

describe("selecting at the loft (AC-05)", () => {
  it("› a click on the mattress selects it; on the loft's empty top selects the loft", () => {
    const shell = atLoft(FakeShell.withDocument(studio()));
    expect(clicked(shell, ON_MATTRESS)).toEqual([piece(MATTRESS)]);
    expect(clicked(shell, LOFT_TOP)).toEqual([deck(LOFT)]);
  });

  it("› a click on the ghosted partition where it runs under the loft selects the loft; on the partition outside the loft, a shell wall, the wardrobe: nothing", () => {
    // The fixture changes the answer: at the floor these hit the partition, its door, the wall, the wardrobe.
    const floor = FakeShell.withDocument(studio());
    expect(hitTest(floor.state, PARTITION_UNDER_LOFT)?.ref).toEqual({ table: "walls", id: PARTITION });
    expect(hitTest(floor.state, DOOR_UNDER_LOFT)?.ref).toEqual({ table: "openings", id: "door/d0" });

    const shell = atLoft(FakeShell.withDocument(studio()));
    expect(clicked(shell, PARTITION_UNDER_LOFT)).toEqual([deck(LOFT)]);
    expect(clicked(shell, DOOR_UNDER_LOFT)).toEqual([deck(LOFT)]);
    for (const at of [PARTITION_OUTSIDE, SHELL_WALL, SHELL_JOINT, WARDROBE, SOFA, DIMENSION, TAG, LIVING_FLOOR]) {
      expect(hitTest(shell.state, at), JSON.stringify(at)).toBeNull();
      expect(clicked(shell, at), JSON.stringify(at)).toEqual([]);
    }
  });

  it("› hovering at the loft highlights only what the loft can select", () => {
    const floor = FakeShell.withDocument(studio());
    floor.moveTo(WARDROBE);
    expect(floor.state.hover).toEqual(piece("ward/p0"));

    const shell = atLoft(FakeShell.withDocument(studio()));
    shell.moveTo(PARTITION_UNDER_LOFT);
    expect(shell.state.hover).toEqual(deck(LOFT));
    for (const at of [PARTITION_OUTSIDE, SHELL_WALL, WARDROBE, SOFA, DIMENSION, TAG, LIVING_FLOOR]) {
      shell.moveTo(at);
      expect(shell.state.hover, JSON.stringify(at)).toBeNull();
    }
  });

  it("› a box over the whole plan selects only the loft's pieces", () => {
    // At the floor the floor's own pieces, not the loft's (shown.02).
    const floor = FakeShell.withDocument(studio());
    floor.drag({ x: -1, y: -1 }, { x: 7, y: 5 });
    expect(floor.state.selection.filter((r) => r.table === "placements")).toEqual([piece("sofa/p0"), piece("ward/p0")]); // with the walls inside the box (straight.09)

    const shell = atLoft(FakeShell.withDocument(studio()));
    shell.drag({ x: -1, y: -1 }, { x: 7, y: 5 });
    expect(shell.state.selection.filter((r) => r.table === "placements")).toEqual([piece(MATTRESS)]);
  });

  it("› on the edge where a 2.15 loft touches a 2.30 one, each level's click takes its own loft", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "addDeck", opId: "a", preset: "loft", at: { x: 2, y: 2 }, w: 2, d: 2 }, // x 1–3
      { type: "addDeck", opId: "b", preset: "loft", at: { x: 4, y: 2 }, w: 2, d: 2, top: 2.3 }, // x 3–5
    );
    const edge = { x: 3, y: 2 };
    const floor = FakeShell.withDocument(doc);
    expect(clicked(floor, edge)).toEqual([deck("b/k0")]); // the higher deck, as before
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setViewedLevel", deck: "a/k0" });
    expect(clicked(shell, edge)).toEqual([deck("a/k0")]);
    shell.ui({ type: "setViewedLevel", deck: "b/k0" });
    expect(clicked(shell, edge)).toEqual([deck("b/k0")]);
  });

  it("› at the floor, the same clicks select as before (wall, partition, wardrobe), except the loft's mattress: its click takes the loft", () => {
    const shell = FakeShell.withDocument(studio());
    expect(clicked(shell, SHELL_WALL)).toEqual([{ table: "walls", id: expect.any(String) }]);
    expect(clicked(shell, PARTITION_UNDER_LOFT)).toEqual([{ table: "walls", id: PARTITION }]);
    expect(clicked(shell, PARTITION_OUTSIDE)).toEqual([{ table: "walls", id: PARTITION }]);
    expect(clicked(shell, WARDROBE)).toEqual([piece("ward/p0")]);
    expect(clicked(shell, ON_MATTRESS)).toEqual([deck(LOFT)]);
    expect(clicked(shell, LOFT_TOP)).toEqual([deck(LOFT)]);
    expect(clicked(shell, DIMENSION)).toEqual([{ table: "dimensions", id: "dim/m0" }]);
  });
});

describe("pieces on other levels' decks at the loft (levels.40)", () => {
  /**
   * The studio with a Platform (top 0.45) at x 0.5–1.9, y 0.3–1.3 carrying a chair at x 0.975–1.425, y 0.575–1.025, and
   * a 2.30 loft touching the 2.15 one along x = 3.7 (x 3.7–5.2, y 1.4–3.2) carrying a 0.15 box at x 4.15–4.75, y 2.0–2.6.
   */
  function studioWithOthers(): Document {
    return withCommands(
      studio(),
      { type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.2, y: 0.8 }, w: 1.4, d: 1 },
      { type: "placeObject", deck: "plat/k0", opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 1.2, y: 1.025 } },
      { type: "addDeck", opId: "high", preset: "loft", at: { x: 4.45, y: 2.3 }, w: 1.5, d: 1.8, top: 2.3 },
      { type: "placeObject", deck: null, opId: "box", state: "s0", object: { kind: "block" }, at: { x: 4.45, y: 2.6 } },
      { type: "setObjectSize", objectId: "box/o0", w: 0.6, d: { standard: 0.6 }, h: { standard: 0.15 } },
      { type: "movePlacement", placementId: "box/p0", at: { x: 4.45, y: 2.6 }, rotation: 0, deck: "high/k0" },
    );
  }
  const CHAIR = { x: 1.2, y: 0.8 };
  const BOX = { x: 4.45, y: 2.3 };
  const CHAIR_BOX: [Point, Point] = [{ x: 0.3, y: 0.2 }, { x: 2.2, y: 1.35 }];
  const BOX_BOX: [Point, Point] = [{ x: 3.8, y: 1.5 }, { x: 5.1, y: 3.1 }];

  it("› at +2.15 a chair on the Platform and a piece on the touching 2.30 loft are neither clickable nor boxable, and are pruned on switching", () => {
    const doc = studioWithOthers();
    expect(doc.placements["chair/p0"]?.deck).toBe("plat/k0");
    expect(doc.placements["box/p0"]?.deck).toBe("high/k0");
    // The fixture changes the answer: each is clicked and boxed at its own level.
    const floor = FakeShell.withDocument(doc);
    expect(clicked(floor, CHAIR)).toEqual([piece("chair/p0")]);
    const high = FakeShell.withDocument(doc);
    high.ui({ type: "setViewedLevel", deck: "high/k0" });
    expect(clicked(high, BOX)).toEqual([piece("box/p0")]);
    high.drag(...BOX_BOX);
    expect(high.state.selection).toEqual([piece("box/p0")]);

    const shell = atLoft(FakeShell.withDocument(doc));
    for (const at of [CHAIR, BOX]) {
      expect(hitTest(shell.state, at), JSON.stringify(at)).toBeNull();
      expect(clicked(shell, at), JSON.stringify(at)).toEqual([]);
    }
    for (const box of [CHAIR_BOX, BOX_BOX]) {
      shell.drag(...box);
      expect(shell.state.selection, JSON.stringify(box)).toEqual([]);
    }

    // Selected at its own level, each is dropped on switching to +2.15.
    const fromFloor = FakeShell.withDocument(doc);
    expect(clicked(fromFloor, CHAIR)).toEqual([piece("chair/p0")]);
    atLoft(fromFloor);
    expect(fromFloor.state.selection).toEqual([]);
    expect(clicked(high, BOX)).toEqual([piece("box/p0")]);
    atLoft(high);
    expect(high.state.selection).toEqual([]);
    expect(high.state.hover).toBeNull();
  });
});

describe("the selection follows the level (AC-05)", () => {
  it("› with the sofa selected at the floor, switching to the loft empties the selection", () => {
    const shell = FakeShell.withDocument(studio());
    expect(clicked(shell, SOFA)).toEqual([piece("sofa/p0")]);
    expect(shell.state.hover).toEqual(piece("sofa/p0"));
    expect(handles(shell.state, shell.doc()).length).toBeGreaterThan(0);
    atLoft(shell);
    expect(shell.state.selection).toEqual([]);
    expect(shell.state.hover).toBeNull();
    // levels.31: no grips, zone handles or chips of a piece the loft hides.
    expect(handles(shell.state, shell.doc())).toEqual([]);
    expect(zoneChips(shell.state, shell.doc())).toEqual([]);
  });

  it("› with the mattress selected at the loft, Stands on: Floor drops it", () => {
    const shell = atLoft(FakeShell.withDocument(studio()));
    expect(clicked(shell, ON_MATTRESS)).toEqual([piece(MATTRESS)]);
    shell.ui({ type: "setField", fieldId: "standsOn", value: "floor" });
    expect(shell.doc().placements[MATTRESS]?.deck).toBeNull();
    expect(shell.state.selection).toEqual([]);
  });

  it("› Stands on: Loft at the floor drops the mattress; an undo at the loft that moves it back to the floor drops it", () => {
    const shell = FakeShell.withDocument(studio(false));
    expect(clicked(shell, ON_MATTRESS)).toEqual([piece(MATTRESS)]);
    shell.ui({ type: "setField", fieldId: "standsOn", value: LOFT });
    expect(shell.doc().placements[MATTRESS]?.deck).toBe(LOFT);
    expect(shell.state.selection).toEqual([]); // the floor no longer offers it (shown.02)
    atLoft(shell);
    expect(clicked(shell, ON_MATTRESS)).toEqual([piece(MATTRESS)]);
    shell.key("z", { meta: true });
    expect(shell.doc().placements[MATTRESS]?.deck).toBeNull();
    expect(shell.state.selection).toEqual([]);
  });

  it("› a collaborator's movePlacement off the loft drops it", () => {
    const r = FakeRemote.open(studio());
    atLoft(r.shell);
    expect(clicked(r.shell, ON_MATTRESS)).toEqual([piece(MATTRESS)]);
    r.remote({ type: "movePlacement", placementId: MATTRESS, at: { x: 3.15, y: 3.7 }, rotation: 0, deck: null });
    expect(r.shell.doc().placements[MATTRESS]?.deck).toBeNull();
    expect(r.shell.state.selection).toEqual([]);
  });
});
