import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, footprints, kindOf } from "@fm/domain";
import { armedPreset, pickPreset } from "../src/tools/armed-size";
import type { ObjectGhost } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { clearRoomDoc, roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The size picker while placing (furnish.05, AC-07): the armed kind's presets in the hint line; the pick sizes the
// ghost, its fit and the click, per kind for the session, never sent, saved or undone. roomDoc's inner faces are
// x 0.1 / 5.9, y 0.1 / 3.9; NARROW's x 0.1 / 1.3, y 0.1 / 2.7. Zoom 80: the tolerance is 0.125 m.

const NARROW = clearRoomDoc(1.2, 2.6, "nb");

const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const polygons = (shell: FakeShell, color: string) => overlays(shell).flatMap((p) => (p.kind === "polygon" && p.color === color ? [p.points] : []));
const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const objects = (shell: FakeShell) => Object.values(shell.doc().objects);
const placements = (shell: FakeShell) => Object.values(shell.doc().placements);
const picker = (shell: FakeShell) => shell.view().sizePicker;
const pick = (shell: FakeShell, kind: string, preset: string) => shell.ui({ type: "pickPreset", kind, preset });

describe("the size picker (furnish.05)", () => {
  it("the picker lists the armed kind's presets and starts on the default", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "bed" });
    expect(picker(shell)?.kind).toBe("bed");
    expect(picker(shell)?.current).toBe("King 170 × 210"); // the default size, not presets[0] ("Small single")
    const options = picker(shell)?.options ?? [];
    expect(options.map((o) => o.label)).toEqual(kindOf("bed")?.presets.map((p) => p.label));
    expect(options).toContainEqual({ label: "Single 100 × 210", w: 1, d: 2.1 });
    expect(options).toContainEqual({ label: "US Queen 162 × 213", w: 1.62, d: 2.13 });

    shell.ui({ type: "pickKind", kind: "wardrobe" });
    expect(picker(shell)?.current).toBe("120 × 60");
    shell.ui({ type: "pickKind", kind: "chair" }); // no presets
    expect(picker(shell)).toBeNull();
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.ui({ type: "pickTool", tool: "select" });
    expect(shell.state.objectKind).toBe("bed");
    expect(picker(shell)).toBeNull();
  });

  it("the fridge's picker lists six presets, starts on Tall, and Under-counter places 0.85 tall; the shelf's Wall shelf places at 1.50 (AC-06)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "fridge" });
    expect(picker(shell)?.current).toBe("Tall 60 × 65 h 190");
    expect(picker(shell)?.options.map((o) => o.label)).toEqual([
      "Tall 60 × 65 h 190", "70 cm 70 × 65 h 200", "Under-counter 60 × 60 h 85", "Compact 48 × 50 h 85", "US French door 91 × 75 h 178", "12 V 45 × 50 h 55",
    ]);
    pick(shell, "fridge", "Under-counter 60 × 60 h 85");
    shell.click({ x: 1.5, y: 2 });
    expect(objects(shell)[0]).toMatchObject({ w: { standard: 0.6 }, d: { standard: 0.6 }, h: { standard: 0.85 }, z: { standard: 0 } });
    shell.ui({ type: "pickKind", kind: "shelf" });
    expect(picker(shell)?.current).toBe("Standard 80 × 40 h 150");
    pick(shell, "shelf", "Wall shelf 80 × 25 h 30 at 150");
    shell.click({ x: 4, y: 2 });
    expect(objects(shell)[1]).toMatchObject({ w: { standard: 0.8 }, d: { standard: 0.25 }, h: { standard: 0.3 }, z: { standard: 1.5 } });
  });

  it("AC-07: Single sizes the ghost and the placed bed", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "bed" });
    pick(shell, "bed", "Single 100 × 210");
    shell.moveTo({ x: 3, y: 2 });
    expect(ghost(shell)).toMatchObject({ w: 1, d: 2.1, rotation: 0, fits: true });
    const [poly, ...more] = polygons(shell, COLORS.ghostFill);
    expect(more).toEqual([]);
    if (!poly) throw new Error("no ghost polygon");
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(2.5, 6); // the default would give 2.15–3.85
    expect(Math.max(...xs)).toBeCloseTo(3.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(0.95, 6);
    expect(Math.max(...ys)).toBeCloseTo(3.05, 6);

    shell.click({ x: 3, y: 2 });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 1 }, d: { standard: 2.1 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 3, y: 3.05 }, rotation: 0 })]);
  });

  it("AC-07: re-arming a kind shows its pick again, per kind, for the session", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "bed" });
    pick(shell, "bed", "Single 100 × 210");
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    expect(picker(shell)?.current).toBe("120 × 60");
    pick(shell, "wardrobe", "100 × 60");
    shell.ui({ type: "pickTool", tool: "select" });
    shell.ui({ type: "pickKind", kind: "bed" });
    expect(picker(shell)?.current).toBe("Single 100 × 210");

    shell.click({ x: 3, y: 2 });
    shell.ui({ type: "undo" });
    expect(objects(shell)).toEqual([]);
    expect(picker(shell)?.current).toBe("Single 100 × 210");
    expect(shell.state.armed).toEqual({ bed: { preset: "Single 100 × 210" }, wardrobe: { preset: "100 × 60" } });

    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 3, y: 2 });
    expect(ghost(shell)?.w).toBe(1);
    expect(ghost(shell)?.d).toBe(0.6);
  });

  it("a picked Single fits the 1.20 × 2.60 room where the default bed is red", () => {
    const shell = FakeShell.withDocument(NARROW);
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.moveTo({ x: 0.7, y: 1.4 });
    expect(ghost(shell)?.fits).toBe(false); // 1.70 is wider than 1.20
    expect(polygons(shell, COLORS.invalidFill)).toHaveLength(1);
    shell.click({ x: 0.7, y: 1.4 });
    expect(placements(shell)).toEqual([]);
    expect(shell.view().toast).toMatch(/overlaps a wall/);

    pick(shell, "bed", "Single 100 × 210");
    shell.moveTo({ x: 0.7, y: 1.4 });
    // Side gaps of 0.10 m are inside the tolerance, but the turned bed doesn't fit, so it keeps rotation 0 (furnish.16).
    expect(ghost(shell)).toMatchObject({ fits: true, w: 1, rotation: 0 });
    const shown = ghost(shell);
    shell.click({ x: 0.7, y: 1.4 });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 1 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: shown?.at, rotation: shown?.rotation })]);
  });

  it("the click places the pick made while the ghost was up", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.moveTo({ x: 3, y: 2 });
    expect(ghost(shell)?.w).toBe(1.7);
    pick(shell, "bed", "Double 150 × 210");
    shell.down({ x: 3, y: 2 }); // no move in between: the press recomputes the ghost
    shell.up({ x: 3, y: 2 });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 1.5 } })]);
  });

  it("a two-configuration kind takes the preset's depth in each configuration", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "murphyBed" });
    expect(picker(shell)?.current).toBe("Double 160 × 40 (open 210)");
    expect(picker(shell)?.options).toContainEqual({ label: "Single 100 × 40 (open 210)", w: 1, d: 0.4 });
    pick(shell, "murphyBed", "Single 100 × 40 (open 210)");
    shell.moveTo({ x: 3, y: 2 });
    expect(ghost(shell)).toMatchObject({ config: "folded", w: 1, d: 0.4 });
    shell.click({ x: 3, y: 2 });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { folded: 1, down: 1 }, d: { folded: 0.4, down: 2.1 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ config: "folded" })]);
  });

  it("a pick is local: no edit, no undo, nothing sent", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "bed" });
    const before = shell.state.document;
    const effects = shell.send({ type: "ui", action: { type: "pickPreset", kind: "bed", preset: "Super king 190 × 210" } });
    expect(effects.map((e) => e.type)).toEqual(["render"]);
    expect(shell.state.document).toBe(before);
    expect(shell.view().canUndo).toBe(false);
    expect(picker(shell)?.current).toBe("Super king 190 × 210");
  });

  it("pickPreset ignores an unknown label, a kind without presets and an unknown kind", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const s = shell.state;
    expect(pickPreset(s, "bed", "Super king 999 × 1")).toBe(s);
    expect(pickPreset(s, "bed", "Super king")).toBe(s); // an id, not a label
    expect(pickPreset(s, "chair", "Chair")).toBe(s);
    expect(pickPreset(s, "nope", "Single 100 × 210")).toBe(s);
    expect(pickPreset(s, "constructor", "x")).toBe(s);
    pick(shell, "__proto__", "Single 100 × 210");
    expect(shell.state.armed).toEqual({});
    expect(Object.keys(shell.state.armed)).toEqual([]);
  });

  it("a preset pick is kept per kind and survives arming another kind (sizing step 01)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    pick(shell, "wardrobe", "100 × 60");
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    expect(armedPreset(shell.state)?.label).toBe("100 × 60");
    expect(shell.state.armed["wardrobe"]).toEqual({ preset: "100 × 60" });
  });

  it("preset labels are unique within each kind", () => {
    // A pick is looked up by label; the domain's presets test checks only ids.
    for (const k of OBJECT_KINDS) expect(new Set(k.presets.map((p) => p.label)).size, k.id).toBe(k.presets.length);
  });
});

describe("Small single in a 0.95 m room (AC-17)", () => {
  // Inner faces x 0.1 / 1.05, y 0.1 / 2.5 (0.95 × 2.40). A 0.85 m bed has 0.05 m each side, inside the 0.125 m
  // tolerance of both side walls: the flip the user hit (furnish.16).
  const SINGLE_ROOM = clearRoomDoc(0.95, 2.4, "sb");

  it("the bed's picker lists Small single and Narrow single first", () => {
    const shell = FakeShell.withDocument(SINGLE_ROOM);
    shell.ui({ type: "pickKind", kind: "bed" });
    expect(picker(shell)?.options.slice(0, 2)).toEqual([{ label: "Small single 85 × 195", w: 0.85, d: 1.95 }, { label: "Narrow single 95 × 205", w: 0.95, d: 2.05 }]);
  });

  it("with Small single picked, a click in the middle places it at rotation 0", () => {
    const shell = FakeShell.withDocument(SINGLE_ROOM);
    shell.ui({ type: "pickKind", kind: "bed" });
    pick(shell, "bed", "Small single 85 × 195");
    for (const x of [0.55, 0.58, 0.6]) {
      for (const y of [1.3, 1.45]) {
        shell.moveTo({ x, y });
        expect(ghost(shell), `${x}, ${y}`).toMatchObject({ rotation: 0, fits: true, w: 0.85, d: 1.95 });
        if (y === 1.45) expect(Math.abs((ghost(shell)?.at.y ?? NaN) - 2.5), `${x}, ${y}`).toBeLessThan(1e-3); // 0.075 from the head wall: flush
      }
    }
    shell.click({ x: 0.58, y: 1.3 });
    expect(objects(shell)).toEqual([expect.objectContaining({ kind: "bed", w: { standard: 0.85 }, d: { standard: 1.95 } })]);
    const [p, ...more] = placements(shell);
    expect(more).toEqual([]);
    expect(p?.rotation).toBe(0);
    const quad = p ? footprints(shell.doc()).get(p.id) ?? [] : [];
    expect(quad).toHaveLength(4);
    for (const c of quad) {
      expect(c.x).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(c.x).toBeLessThanOrEqual(1.05 + 1e-9);
    }
  });

  it("with Single picked the same click places nothing", () => {
    const shell = FakeShell.withDocument(SINGLE_ROOM);
    shell.ui({ type: "pickKind", kind: "bed" });
    pick(shell, "bed", "Single 100 × 210");
    shell.click({ x: 0.58, y: 1.3 });
    expect(Object.keys(shell.doc().objects)).toEqual([]);
    expect(ghost(shell)?.fits).toBe(false);
  });
});

// Presets with heights (catalog.07, step 11): the washing machine's two presets differ only by height, which the pick
// sets on the ghost, the click and a drawn piece (presetSize).
describe("a preset's height (catalog.07)", () => {
  const height = (shell: FakeShell): number | undefined => {
    const g = ghost(shell);
    return g ? Math.round((g.range.top - g.range.bottom) * 100) / 100 : undefined;
  };

  it("picking Washer-dryer makes the ghost's height 1.70, and the click places it so", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "washingMachine" });
    expect(picker(shell)?.current).toBe("Washer 60 × 60 h 85");
    shell.moveTo({ x: 3, y: 2 });
    expect(height(shell)).toBe(0.85);
    pick(shell, "washingMachine", "Washer-dryer 60 × 60 h 170");
    shell.moveTo({ x: 3, y: 2.01 });
    expect(ghost(shell)).toMatchObject({ w: 0.6, d: 0.6 });
    expect(height(shell)).toBe(1.7);
    shell.click({ x: 3, y: 2 });
    expect(objects(shell)).toEqual([expect.objectContaining({ h: { standard: 1.7 } })]);
  });

  it("a piece drawn with Washer-dryer picked is 1.70 tall too", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "washingMachine" });
    pick(shell, "washingMachine", "Washer-dryer 60 × 60 h 170");
    shell.drag({ x: 2, y: 2 }, { x: 2.7, y: 2.65 });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 0.7 }, d: { standard: 0.65 }, h: { standard: 1.7 } })]);
  });
});
