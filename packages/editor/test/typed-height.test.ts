import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, footprintQuad, lowerable, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { REST_TIMER } from "../src/plate";
import type { ObjectGhost } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A typed height while a kind is armed (sizing step 06; spec "Height while placing", sizing.15, .16, .20). roomDoc is
// 6 × 4 (inner faces x 0.1–5.9, y 0.1–3.9) under a 2.50 ceiling; a hollow deck over x 0.1–3.1, the whole depth.

const UNDER: Point = { x: 1.5, y: 2 };
const CLEAR: Point = { x: 4.5, y: 2 };
/** A hollow deck over the room's left half, its top at `top` (its underside 0.12 lower). */
const hollow = (top: number): Command => ({ type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.6, y: 2 }, w: 3, d: 3.8, top, solid: false });
const lofted = (underside: number): Document => withCommands(roomDoc(), hollow(underside + 0.12));

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const fields = (shell: FakeShell) => shell.view().sizeFields;
const heights = (shell: FakeShell, kind: string) => Object.values(shell.doc().objects).filter((o) => o.kind === kind).map((o) => o.h["standard"]);
const typeHeight = (shell: FakeShell, kind: string, height: string) => shell.ui({ type: "setArmedSize", kind, height });

function armed(doc: Document, kind: string): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind });
  return shell;
}

describe("the Height field (sizing step 06)", () => {
  it("AC-03 / AC-16: the field exists exactly for the kinds that may be lowered; none for a stair kind or a set", () => {
    for (const k of OBJECT_KINDS.filter((x) => !x.retired && x.stair === null)) {
      const shell = armed(roomDoc(), k.id);
      expect(fields(shell)?.height === null, k.id).toBe(!lowerable(k.id));
    }
    expect(fields(armed(roomDoc(), "chair"))?.height).toBe("0.90");
    expect(fields(armed(roomDoc(), "wardrobe"))?.height).toBe("2.05");
    for (const k of ["murphyBed", "sofaBed", "liftBed", "foldingTable"]) expect(fields(armed(roomDoc(), k))?.height, k).toBeNull();
    expect(fields(armed(roomDoc(), "stair"))).toBeNull();
    const set = FakeShell.withDocument(roomDoc());
    set.ui({ type: "pickSet", set: "bedAndNightstands" });
    expect(fields(set)).toBeNull();
  });

  it("AC-17: under a 2.03 underside the field keeps 2.05; a click there places 2.03, one in the open room 2.05", () => {
    const shell = armed(lofted(2.03), "wardrobe");
    shell.moveTo(UNDER);
    expect(fields(shell)?.height).toBe("2.05");
    expect(ghost(shell)?.lowered).toMatchObject({ h: 2.03, from: 2.05 });
    shell.click(UNDER);
    shell.moveTo(CLEAR);
    expect(fields(shell)?.height).toBe("2.05");
    shell.click(CLEAR);
    expect(heights(shell, "wardrobe")).toEqual([2.03, 2.05]);
  });

  it("AC-18: under a 1.40 underside the ghost is red; typed 1.40 it fits; it is remembered; a preset pick resets it", () => {
    const shell = armed(lofted(1.4), "wardrobe");
    shell.moveTo(UNDER);
    expect(ghost(shell)?.fits).toBe(false);
    typeHeight(shell, "wardrobe", "1.40");
    expect(ghost(shell)).toMatchObject({ fits: true });
    expect(shell.view().sizePicker?.current).toBe("Custom");
    shell.click(UNDER);
    shell.moveTo(CLEAR);
    shell.click(CLEAR);
    expect(heights(shell, "wardrobe")).toEqual([1.4, 1.4]);
    shell.ui({ type: "pickPreset", kind: "wardrobe", preset: "100 × 60" });
    expect(fields(shell)?.height).toBe("2.05");
  });

  it("AC-19: typed 1.90 is shortened to 1.80 under a 1.80 underside, and red under 1.40 (below 3/4 of 1.90)", () => {
    const at180 = armed(lofted(1.8), "wardrobe");
    typeHeight(at180, "wardrobe", "1.9");
    at180.moveTo(UNDER);
    expect(ghost(at180)).toMatchObject({ fits: true, lowered: { h: 1.8, from: 1.9 } });
    at180.click(UNDER);
    expect(heights(at180, "wardrobe")).toEqual([1.8]);
    const at140 = armed(lofted(1.4), "wardrobe");
    typeHeight(at140, "wardrobe", "1.9");
    at140.moveTo(UNDER);
    expect(ghost(at140)?.fits).toBe(false);
  });

  it("a typed height keeps the preset's elevation: a Wall cabinet at 1.40 with Height 0.40 spans 1.40–1.80", () => {
    const shell = armed(roomDoc(), "wallCabinet");
    typeHeight(shell, "wallCabinet", "0.4");
    shell.moveTo(CLEAR);
    expect(ghost(shell)?.range.bottom).toBeCloseTo(1.4, 6);
    expect(ghost(shell)?.range.top).toBeCloseTo(1.8, 6); // 1.4 + 0.4 in floats
    shell.click(CLEAR);
    expect(Object.values(shell.doc().objects)).toEqual([expect.objectContaining({ h: { standard: 0.4 }, z: { standard: 1.4 } })]);
  });

  it("a drawn footprint keeps a typed height", () => {
    const shell = armed(roomDoc(), "wardrobe");
    typeHeight(shell, "wardrobe", "1.4");
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3.5, y: 2.3 });
    shell.moveTo({ x: 4, y: 2.6 });
    shell.up({ x: 4, y: 2.6 });
    expect(heights(shell, "wardrobe")).toEqual([1.4]);
  });

  it.each(["0", "0.005", "12", "abc"])("a height of %j stays red and keeps the last good height", (text) => {
    const shell = armed(roomDoc(), "wardrobe");
    typeHeight(shell, "wardrobe", "1.5");
    typeHeight(shell, "wardrobe", text);
    expect(fields(shell)).toMatchObject({ height: text, bad: ["height"] });
    shell.moveTo(CLEAR);
    expect(ghost(shell)?.range.top).toBe(1.5);
  });

  it("a tall pantry typed to 2.40 becomes the Tall preset, not Custom", () => {
    const shell = armed(roomDoc(), "tallPantry");
    typeHeight(shell, "tallPantry", "2.4");
    expect(shell.view().sizePicker?.current).toBe("Tall 80 × 60 h 240");
    expect(shell.state.armed["tallPantry"]).toEqual({ preset: "Tall 80 × 60 h 240" });
  });

  it("a height on a kind with no Height field changes nothing", () => {
    const shell = armed(roomDoc(), "murphyBed");
    const before = shell.state;
    typeHeight(shell, "murphyBed", "1.5");
    expect(shell.state.armed).toBe(before.armed);
    expect(fields(shell)?.bad).toEqual([]);
  });
});

describe("the note plate names the armed height (sizing step 07, sizing.17)", () => {
  const presence = (shell: FakeShell) => shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
  const plateText = (shell: FakeShell): string | null => {
    for (const p of presence(shell)) if (p.kind === "text") return p.text;
    return null;
  };
  const plateLine = (shell: FakeShell): unknown => presence(shell).find((p) => p.kind === "segment")?.color ?? null;

  it("AC-17: a preset's height shortened under a loft reads `default`, as before", () => {
    const shell = armed(lofted(2.03), "wardrobe");
    shell.moveTo(UNDER);
    expect(plateText(shell)).toBe("H 2.03 m · default 2.05 · under Loft");
  });

  it("AC-18: a typed 1.40 carries a small `H 1.40 m` in the open room: amber words, no box, no rest; a preset pick removes it", () => {
    const shell = armed(roomDoc(), "wardrobe");
    typeHeight(shell, "wardrobe", "1.4");
    shell.moveTo(CLEAR);
    expect(plateText(shell)).toBe("H 1.40 m");
    expect(presence(shell).map((p) => p.kind)).toEqual(["polygon", "text"]); // a white backing just round the words, no border (sizing.30)
    const [back, label] = presence(shell);
    expect(back?.kind === "polygon" && back.color).toBe(COLORS.field);
    expect(label?.kind === "text" && [label.color, label.size]).toEqual([COLORS.warningLine, 11]);
    if (back?.kind !== "polygon" || label?.kind !== "text") throw new Error("no label");
    const zoom = shell.state.camera.zoom;
    const height = (Math.max(...back.points.map((p) => p.y)) - Math.min(...back.points.map((p) => p.y))) * zoom;
    expect(height).toBeCloseTo(11 + 2 * 3, 6); // the words' size and 3 px each side
    shell.ui({ type: "pickPreset", kind: "wardrobe", preset: "100 × 60" });
    shell.moveTo({ x: 4.6, y: 2 });
    expect(plateText(shell)).toBeNull();
  });

  it("the typed label sits just right of the ghost, outside it, at its mid-height; left of it near the view's right edge", () => {
    const shell = armed(roomDoc(), "wardrobe");
    typeHeight(shell, "wardrobe", "1.4");
    shell.moveTo(CLEAR);
    const g = ghost(shell);
    const label = presence(shell).find((p) => p.kind === "text");
    if (!g || label?.kind !== "text") throw new Error("no label");
    const xs = footprintQuad(g.at, g.w, g.d, g.rotation).map((p) => p.x);
    const ys = footprintQuad(g.at, g.w, g.d, g.rotation).map((p) => p.y);
    expect(label.align).toBe("left");
    expect(label.at.x).toBeGreaterThan(Math.max(...xs));
    expect(label.at.y).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 6);
    shell.state = { ...shell.state, camera: { ...shell.state.camera, viewport: { width: 400, height: 800 }, center: { x: 3, y: 2 } } }; // the view ends at x 5.5
    shell.moveTo({ x: 5, y: 2 }); // the ghost's right side lies past the view's edge
    const near = presence(shell).find((p) => p.kind === "text");
    const g2 = ghost(shell);
    if (!g2 || near?.kind !== "text") throw new Error("no label");
    expect(near.align).toBe("right");
    expect(near.at.x).toBeLessThan(Math.min(...footprintQuad(g2.at, g2.w, g2.d, g2.rotation).map((p) => p.x)));
  });

  it("AC-19: typed 1.90 shortened under 1.80 reads `H 1.80 m · typed 1.90 · under Loft`", () => {
    const shell = armed(lofted(1.8), "wardrobe");
    typeHeight(shell, "wardrobe", "1.9");
    shell.moveTo(UNDER);
    expect(plateText(shell)).toBe("H 1.80 m · typed 1.90 · under Loft");
  });

  it.each(["2.05", "2.049"])("a typed height of %s, the preset's to the centimetre, shows no plate", (h) => {
    const shell = armed(roomDoc(), "wardrobe");
    typeHeight(shell, "wardrobe", h);
    shell.moveTo(CLEAR);
    expect(plateText(shell)).toBeNull();
  });

  it("a tall pantry typed to 2.40 is its Tall preset and shows no plate", () => {
    const shell = armed(roomDoc(), "tallPantry");
    typeHeight(shell, "tallPantry", "2.4");
    shell.moveTo(CLEAR);
    expect(plateText(shell)).toBeNull();
  });

  it("a red ghost with a typed height shows the note before the rest, and the red reason alone after it", () => {
    const shell = armed(roomDoc(), "wardrobe");
    typeHeight(shell, "wardrobe", "1.4");
    shell.moveTo({ x: 0.2, y: 2 }); // across the left wall
    expect(ghost(shell)?.fits).toBe(false);
    expect(plateText(shell)).toBe("H 1.40 m");
    shell.fireTimer(REST_TIMER);
    expect(plateLine(shell)).toBe(COLORS.invalid);
    expect(plateText(shell)).not.toContain("typed");
  });

  it("a drawn ghost with a typed height carries it in its drawing label, not beside the ghost (sizing.31)", () => {
    const shell = armed(roomDoc(), "wardrobe");
    typeHeight(shell, "wardrobe", "1.4");
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3.5, y: 2.3 });
    shell.moveTo({ x: 4, y: 2.6 });
    expect(plateText(shell)).toBeNull();
    const overlayTexts = (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));
    expect(overlayTexts).toContain("W 1.00 × D 0.60 × H 1.40 m");
  });

  it("with a set armed after a typed height, no note", () => {
    const shell = armed(roomDoc(), "bed");
    typeHeight(shell, "bed", "0.6");
    shell.ui({ type: "pickSet", set: "bedAndNightstands" });
    shell.moveTo(CLEAR);
    expect(plateText(shell)).toBeNull();
  });
});
