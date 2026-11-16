import { describe, expect, it } from "vitest";
import { ceilingHeight, placementRange, wallRange, type Command, type Document } from "@fm/domain";
import type { Field, ViewModel } from "../src/view/view-model-types";
import { LOFT_ROOM_LOFT, loftRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Heights in Properties (heights.07, .25, .39, AC-20, AC-19, AC-08): an object's Height section, a wall's Top, the
// Ceiling section with nothing selected; refusals toast the domain's texts.

const fields = (vm: ViewModel): Field[] => ("fields" in vm.properties ? vm.properties.fields : []);
const field = (shell: FakeShell, id: string): Field | undefined => fields(shell.view()).find((f) => f.id === id);
const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } });
const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });

/** The 6 × 4 room with `cmds`, one piece selected by a click at `at`. */
function selected(doc: Document, at: { x: number; y: number }): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(at);
  return shell;
}

/** `selected`, viewing the loft l/k0 first: its pieces are selected at its level (shown.02). */
function selectedAtLoft(doc: Document, at: { x: number; y: number }): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setViewedLevel", deck: "l/k0" });
  shell.click(at);
  return shell;
}

describe("an object's Height section (AC-20)", () => {
  it("shows height, elevation, the At ceiling switch and the top with its gap to the ceiling", () => {
    const shell = selected(withCommands(roomDoc(), place("c", "wallCabinet", 3, 3.9)), { x: 3, y: 3.7 });
    const height = fields(shell.view()).filter((f) => f.section === "Height").map((f) => [f.id, f.label, f.value, f.readOnly]);
    expect(height).toEqual([
      ["height.standard", "Height", "0.75", false],
      ["elevation.standard", "Elevation", "1.40", false],
      ["atCeiling.standard", "At ceiling", "false", false],
      ["top", "Top", "2.15 · 0.35 to ceiling", true],
    ]);
    set(shell, "elevation.standard", "1.5");
    expect(field(shell, "top")?.value).toBe("2.25 · 0.25 to ceiling");
    set(shell, "height.standard", "0.6");
    expect(placementRange(shell.doc(), "c/p0")).toEqual({ bottom: 1.5, top: 2.1 });
  });

  it("the At ceiling switch writes \"ceiling\" and shows the resolved elevation read-only; off keeps the place", () => {
    const shell = selected(withCommands(roomDoc(), place("c", "wallCabinet", 3, 3.9)), { x: 3, y: 3.7 });
    set(shell, "atCeiling.standard", "true");
    expect(field(shell, "elevation.standard")).toMatchObject({ value: "1.75", readOnly: true });
    expect(field(shell, "atCeiling.standard")?.value).toBe("true");
    expect(field(shell, "top")?.value).toBe("2.50 · 0.00 to ceiling");
    set(shell, "atCeiling.standard", "false");
    expect(field(shell, "elevation.standard")).toMatchObject({ value: "1.75", readOnly: false });
    expect(placementRange(shell.doc(), "c/p0")).toEqual({ bottom: 1.75, top: 2.5 });
  });

  it("a lift bed shows height, elevation and the switch per configuration, Up at the ceiling", () => {
    const shell = selected(withCommands(roomDoc(), place("l", "liftBed", 3, 3.9)), { x: 3, y: 2.5 });
    const height = fields(shell.view()).filter((f) => f.section === "Height").map((f) => [f.id, f.label, f.value]);
    expect(height).toEqual([
      ["height.up", "Height (Up)", "0.35"],
      ["elevation.up", "Elevation (Up)", "2.15"],
      ["atCeiling.up", "At ceiling (Up)", "true"],
      ["height.down", "Height (Down)", "0.35"],
      ["elevation.down", "Elevation (Down)", "0.20"],
      ["atCeiling.down", "At ceiling (Down)", "false"],
      ["top", "Top", "2.50 · 0.00 to ceiling"],
    ]);
    set(shell, "elevation.down", "0.3");
    expect(shell.doc().objects["l/o0"]?.z).toEqual({ up: "ceiling", down: 0.3 });
  });

  it("a height goes down to 0.01 m; under it the toast names the height's range (catalog.22)", () => {
    const shell = selected(withCommands(roomDoc(), place("c", "wallCabinet", 3, 3.9)), { x: 3, y: 3.7 });
    set(shell, "height.standard", "0.01");
    expect(shell.doc().objects["c/o0"]?.h).toEqual({ standard: 0.01 });
    const before = shell.doc();
    set(shell, "height.standard", "0.005");
    expect(shell.view().toast).toBe("Height must be between 0.01 and 10 m");
    expect(shell.doc()).toBe(before);
  });

  it("a height into a loft bed is refused with the domain's text, the same text MCP replies (AC-08)", () => {
    const shell = selected(withCommands(roomDoc(), place("l", "loftBed", 3, 3.9), place("d", "desk", 3, 3.9)), { x: 3, y: 3.6 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "d/p0" }]);
    const before = shell.doc();
    set(shell, "elevation.standard", "0.75");
    expect(shell.view().toast).toBe("Desk (0.75–1.50) and Loft bed (1.45–1.80) overlap in Layout");
    expect(shell.doc()).toBe(before);
    set(shell, "height.standard", "abc");
    expect(shell.view().toast).toBe("Can't read abc");
  });
});

describe("an object's Height section on a deck (decks.16)", () => {
  it("Elevation is measured from the deck's top: At ceiling on shows it so, and off keeps the piece where it was", () => {
    // A platform (0.45) flush with the top wall, x 2–4, y 2.5–3.9, and a desk standing on it (no Stands on yet).
    const base = withCommands(roomDoc(), place("d", "desk", 3, 3.9));
    const desk = base.placements["d/p0"];
    if (!desk) throw new Error("no desk");
    const onDeck = { ...base, placements: { ...base.placements, [desk.id]: { ...desk, deck: "k/k0" } } };
    const shell = selected(withCommands(onDeck, { type: "addDeck", opId: "k", preset: "platform", at: { x: 3, y: 3.2 } }), { x: 3, y: 3.6 });
    expect(placementRange(shell.doc(), "d/p0")).toEqual({ bottom: 0.45, top: 0.45 + 0.75 });
    expect(field(shell, "elevation.standard")?.value).toBe("0.00");
    set(shell, "atCeiling.standard", "true");
    expect(field(shell, "elevation.standard")).toMatchObject({ value: "1.30", readOnly: true }); // 2.50 − 0.75 − 0.45
    set(shell, "atCeiling.standard", "false");
    expect(shell.view().toast).toBeNull();
    expect(shell.doc().objects["d/o0"]?.z).toEqual({ standard: 1.3 });
    expect(placementRange(shell.doc(), "d/p0")).toEqual({ bottom: 0.45 + 1.3, top: 0.45 + 1.3 + 0.75 });
  });
});

describe("Elevation and Top on a deck (spec \"The Deck tool and editing\", decks.16; AC-11)", () => {
  // The 6 × 4 room under a 2.70 ceiling, a loft (l/k0, top 2.15) over its left end, x 0.1–2.1, y 0.1–3.9, and on it a
  // mattress (m/p0) 1.40 × 2.00, 0.35 high, x 0.4–1.8, y 1.9–3.9: 2.15–2.50, selected at the loft's level (shown.02).
  const onLoft = (): FakeShell =>
    selectedAtLoft(
      withCommands(
        roomDoc(),
        { type: "setCeiling", height: 2.7 },
        { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 2 }, w: 2, d: 3.8 },
        { type: "placeObject", deck: null, opId: "m", state: "s0", object: { kind: "bed", size: { w: 1.4, d: 2 } }, at: { x: 1.1, y: 3.9 } },
        { type: "setObjectSize", objectId: "m/o0", w: 1.4, d: { standard: 2 }, h: { standard: 0.35 } },
        { type: "movePlacement", placementId: "m/p0", at: { x: 1.1, y: 3.9 }, rotation: 0, deck: "l/k0" },
      ),
      { x: 1.1, y: 2.9 },
    );

  it("› Elevation of a bed on the loft reads 0.00 m above Loft", () => {
    const shell = onLoft();
    expect(field(shell, "elevation.standard")).toMatchObject({ value: "0.00", unit: "m above Loft", readOnly: false });
    // On the floor the unit is plain metres; the loft no longer offers it, so it is selected again at the floor.
    shell.ui({ type: "setField", fieldId: "standsOn", value: "floor" });
    shell.ui({ type: "setViewedLevel", deck: null });
    shell.click({ x: 1.1, y: 2.9 });
    expect(field(shell, "elevation.standard")).toMatchObject({ value: "0.00", unit: "m" });
  });

  it("› typing 0.10 raises it to 2.25–2.60", () => {
    const shell = onLoft();
    set(shell, "elevation.standard", "0.10");
    expect(shell.view().toast).toBeNull();
    expect(shell.doc().objects["m/o0"]?.z).toEqual({ standard: 0.1 });
    const r = placementRange(shell.doc(), "m/p0");
    expect([r?.bottom.toFixed(2), r?.top.toFixed(2)]).toEqual(["2.25", "2.60"]);
    expect(field(shell, "elevation.standard")?.value).toBe("0.10");
  });

  it("› Top stays absolute", () => {
    const shell = onLoft();
    expect(field(shell, "top")?.value).toBe("2.50 · 0.20 to ceiling");
  });

  it("› switching At ceiling off on a lift bed on a platform keeps its bottom where it was", () => {
    // A platform (p/k0, 0.45) x 2–4, y 1.7–3.9, flush with the top wall; a lift bed (1.70 × 2.10) up against the 2.50
    // ceiling by Day, 2.15–2.50, standing on it: shown 1.70 above the platform.
    const base = withCommands(
      roomDoc(),
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2.8 }, w: 2, d: 2.2 },
      { type: "placeObject", deck: "p/k0", opId: "lb", state: "s0", object: { kind: "liftBed" }, at: { x: 3, y: 3.9 }, config: "up" },
    );
    const shell = selected(base, { x: 3, y: 2.85 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "lb/p0" }]);
    expect(placementRange(shell.doc(), "lb/p0")).toEqual({ bottom: 2.15, top: 2.5 });
    expect(field(shell, "elevation.up")).toMatchObject({ value: "1.70", unit: "m above Platform", readOnly: true });
    set(shell, "atCeiling.up", "false");
    expect(shell.view().toast).toBeNull();
    expect(shell.doc().objects["lb/o0"]?.z).toMatchObject({ up: 1.7 });
    const r = placementRange(shell.doc(), "lb/p0");
    expect([r?.bottom.toFixed(2), r?.top.toFixed(2)]).toEqual(["2.15", "2.50"]);
  });
});

describe("a wall's Top (heights.10, AC-19)", () => {
  /** The room with its bottom wall selected. */
  const bottomWall = (doc: Document = roomDoc()): FakeShell => selected(doc, { x: 3, y: 0 });

  it("switches between To ceiling and a height; switching it off keeps the wall's height", () => {
    const shell = bottomWall();
    const wallId = shell.state.selection[0]?.id ?? "";
    expect([field(shell, "toCeiling"), field(shell, "top")]).toMatchObject([{ value: "true", readOnly: false }, { value: "2.50", readOnly: true }]);
    set(shell, "toCeiling", "false");
    expect(shell.view().toast).toBeNull();
    expect(wallRange(shell.doc(), wallId)).toEqual({ bottom: 0, top: 2.5 });
    expect([field(shell, "toCeiling"), field(shell, "top")]).toMatchObject([{ value: "false" }, { value: "2.50", readOnly: false }]);
    set(shell, "top", "0.9");
    expect(wallRange(shell.doc(), wallId)?.top).toBe(0.9);
    set(shell, "top", "2.6");
    expect(shell.view().toast).toBe("A wall can't be taller than the 2.50 m ceiling");
    set(shell, "toCeiling", "true");
    expect(wallRange(shell.doc(), wallId)?.top).toBe(2.5);
  });

  it("a wall with a door switched off To ceiling keeps its height and its door; only lowering it under the door's head and 0.10 m is refused (sills.02)", () => {
    const doc = roomDoc();
    const shell0 = bottomWall(doc);
    const wallId = shell0.state.selection[0]?.id ?? "";
    const shell = bottomWall(withCommands(doc, { type: "addOpening", opId: "door", wall: wallId, kind: "swing", offset: 1 }));
    shell.click({ x: 4.5, y: 0 }); // the wall beside the door
    set(shell, "toCeiling", "false");
    expect(shell.view().toast).toBeNull();
    expect(wallRange(shell.doc(), wallId)?.top).toBe(2.5);
    set(shell, "top", "2.19");
    expect(shell.view().toast).toBe("A door's head must be at least 0.10 m under its wall's top, at 2.19 m");
    expect(wallRange(shell.doc(), wallId)?.top).toBe(2.5);
    set(shell, "top", "2.2");
    expect(wallRange(shell.doc(), wallId)?.top).toBe(2.2);
  });
});

describe("a wall's Base (spec \"Properties\", pillars.14)", () => {
  it("a floor wall's Base is Floor, read-only", () => {
    expect(field(selected(roomDoc(), { x: 3, y: 0 }), "base")).toMatchObject({ label: "Base", value: "Floor", readOnly: true });
  });

  it("a knee wall on the loft: Base Loft, read-only; Top is its height from the loft, 0.90; To ceiling off keeps it", () => {
    // The Wall tool draws on a deck in a later step: the knee wall (2.15–3.05) is written as a row.
    const doc = loftRoomDoc();
    const knee: Document = {
      ...doc,
      joints: { ...doc.joints, Ka: { id: "Ka", x: 1.6, y: 2 }, Kb: { id: "Kb", x: 1.6, y: 3.5 } },
      walls: { ...doc.walls, K: { id: "K", a: "Ka", b: "Kb", thickness: 0.1, top: "ceiling", base: LOFT_ROOM_LOFT, column: false } },
    };
    const shell = selected(knee, { x: 1.6, y: 2.7 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: "K" }]);
    expect(field(shell, "base")).toMatchObject({ value: "Loft", readOnly: true });
    expect([field(shell, "toCeiling"), field(shell, "top")]).toMatchObject([{ value: "true" }, { value: "0.90", readOnly: true }]);
    set(shell, "toCeiling", "false");
    expect(shell.view().toast).toBeNull();
    expect(shell.doc().walls.K?.top).toBe(0.9);
    expect(wallRange(shell.doc(), "K")).toEqual({ bottom: 2.15, top: expect.closeTo(3.05, 9) });
    set(shell, "top", "0.5");
    expect(wallRange(shell.doc(), "K")?.top).toBeCloseTo(2.65, 9);
    expect(field(shell, "top")?.value).toBe("0.50");
  });
});

describe("openings on half walls (AC-19)", () => {
  it("adding a window to a half wall toasts the domain's text", () => {
    const doc = roomDoc();
    const shell = selected(doc, { x: 3, y: 0 });
    const wallId = shell.state.selection[0]?.id ?? "";
    set(shell, "toCeiling", "false"); // keeps 2.50: a window still fits
    shell.send({ type: "command", command: { type: "addOpening", opId: "win", wall: wallId, kind: "window", offset: 1 } });
    expect(shell.view().toast).toBeNull();
    shell.send({ type: "command", command: { type: "removeOpening", openingId: "win/d0" } });
    set(shell, "top", "1.1");
    shell.send({ type: "command", command: { type: "addOpening", opId: "win2", wall: wallId, kind: "window", offset: 1 } });
    expect(shell.view().toast).toBe("An opening must be at least 0.30 m tall"); // a window 0.90 to 1.00 on a 1.10 wall
  });
});

describe("the Ceiling section (heights.11, AC-04)", () => {
  it("shows with nothing selected and sets 2.20 (the roof's fields: roof-properties.test.ts)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const ceiling = shell.view().ceiling ?? [];
    expect(ceiling.map((f) => [f.id, f.value])).toEqual([["ceiling.preset", "custom"], ["ceiling.shape", "flat"], ["ceiling.height", "2.50"]]);
    set(shell, "ceiling.height", "2.2");
    expect(ceilingHeight(shell.doc())).toBe(2.2);
    expect(shell.view().ceiling?.find((f) => f.id === "ceiling.height")?.value).toBe("2.20");
    set(shell, "ceiling.height", "0.5");
    expect(shell.view().toast).toBe("The ceiling must be between 1.00 and 10 m");
    shell.click({ x: 3, y: 0 });
    expect(shell.view().ceiling).toBeNull();
  });

  it("lowering the ceiling under a door's head and 0.10 m toasts the openings text, and 2.20 is accepted (decks.57, sills.02)", () => {
    const doc = roomDoc();
    const wallId = selected(doc, { x: 3, y: 0 }).state.selection[0]?.id ?? "";
    const shell = FakeShell.withDocument(withCommands(doc, { type: "addOpening", opId: "door", wall: wallId, kind: "swing", offset: 1 }));
    set(shell, "ceiling.height", "2.19");
    expect(shell.view().toast).toBe("A door's head must be at least 0.10 m under its wall's top, at 2.19 m");
    expect(ceilingHeight(shell.doc())).toBe(2.5);
    set(shell, "ceiling.height", "2.2");
    expect(ceilingHeight(shell.doc())).toBe(2.2);
  });
});
