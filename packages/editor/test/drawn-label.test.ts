import { describe, expect, it } from "vitest";
import { footprintQuad } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { worldToScreen } from "../src/camera";
import type { ObjectGhost } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { nichesDoc, roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// While a footprint is drawn (sizing step 09; spec "While a footprint is drawn", sizing.07, .12, .16, .21, .31): one
// size label at the pointer, a thick front bar, and the hint "Release to place · R to turn". roomDoc is 6 × 4 (inner
// faces x 0.1–5.9, y 0.1–3.9); zoom 80.

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const labels = (shell: FakeShell) => overlays(shell).flatMap((p) => (p.kind === "text" && p.text.startsWith("W ") ? [p] : []));

/** Arms `kind` and drags from `a` towards `b`, holding the button at `b`. */
function drawing(kind: string, a: Point, b: Point, doc = roomDoc()): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind });
  shell.moveTo(a);
  shell.down(a);
  shell.moveTo({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  shell.moveTo(b);
  return shell;
}

/** The segments at least `px` wide on screen in the overlays. */
const thick = (shell: FakeShell, px: number) => overlays(shell).filter((p) => p.kind === "segment" && "px" in p.width && p.width.px >= px);

describe("drawing a footprint shows its size and its front (sizing step 09)", () => {
  it("a wardrobe drawn 1.20 × 0.60 shows one label `W 1.20 × D 0.60 m`, above and right of the pointer", () => {
    const shell = drawing("wardrobe", { x: 2, y: 2 }, { x: 3.2, y: 1.4 });
    expect(ghost(shell)).toMatchObject({ w: 1.2, d: 0.6, fits: true, drawn: true });
    const [label, ...more] = labels(shell);
    expect(more).toEqual([]);
    expect(label?.text).toBe("W 1.20 × D 0.60 m");
    expect(label?.color).toBe(COLORS.text);
    const at = label ? worldToScreen(shell.state.camera, label.at) : null;
    const pointer = shell.state.pointer?.screen;
    if (!at || !pointer) throw new Error("no label");
    expect(at.x).toBeGreaterThan(pointer.x);
    expect(at.y).toBeLessThan(pointer.y);
  });

  it("AC-06: a drawn ghost across a wall shows its label in the invalid colour", () => {
    const shell = drawing("wardrobe", { x: 0.5, y: 1 }, { x: -0.5, y: 1.6 });
    expect(ghost(shell)?.fits).toBe(false);
    expect(labels(shell)[0]?.color).toBe(COLORS.invalid);
  });

  it("the width is the back's length: the bed alcove (0.90 wide, 2.00 deep, head at the closed end) reads `W 0.90 × D 2.00 m`", () => {
    const shell = drawing("bed", { x: 3.13, y: 0.13 }, { x: 3.98, y: 2.07 }, nichesDoc());
    expect(labels(shell)[0]?.text).toBe("W 0.90 × D 2.00 m");
  });

  it("AC-08: with 100 × 60 armed, the fields stay 1.00 and 0.60 while a 0.87 × 0.43 piece is drawn; the next click places 1.00 × 0.60", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.ui({ type: "pickPreset", kind: "wardrobe", preset: "100 × 60" });
    shell.moveTo({ x: 2, y: 2 });
    shell.down({ x: 2, y: 2 });
    shell.moveTo({ x: 2.4, y: 1.8 });
    shell.moveTo({ x: 2.87, y: 1.57 });
    expect(shell.view().sizeFields).toMatchObject({ width: "1.00", depth: "0.60" });
    expect(labels(shell)[0]?.text).toBe("W 0.87 × D 0.43 m");
    shell.up({ x: 2.87, y: 1.57 });
    shell.click({ x: 4.5, y: 2 });
    const sizes = Object.values(shell.doc().objects).map((o) => [o.w["standard"], o.d["standard"]]);
    expect(sizes).toEqual([[0.87, 0.43], [1, 0.6]]);
  });

  it("a click (no drag past 4 px) shows no label and no bar", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 3, y: 2 });
    expect(ghost(shell)?.drawn).toBeUndefined();
    expect(labels(shell)).toEqual([]);
    expect(thick(shell, 5)).toEqual([]);
  });

  it("a set dragged past 4 px: no label, no bar, the set's prompt", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickSet", set: "bedAndNightstands" });
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3.5, y: 2.5 });
    expect(labels(shell)).toEqual([]);
    expect(thick(shell, 5)).toEqual([]);
    expect(shell.view().commandBar.prompt).toBe("Click inside a room to place the set, R to turn it");
  });

  it("the drawn wardrobe has a 6 px bar on its front edge, inside the footprint; a drawn plant has none", () => {
    const shell = drawing("wardrobe", { x: 2, y: 2 }, { x: 3.2, y: 1.4 });
    const g = ghost(shell);
    if (!g) throw new Error("no ghost");
    const bars = thick(shell, 5.9);
    expect(bars.length).toBeGreaterThan(0);
    const quad = footprintQuad(g.at, g.w, g.d, g.rotation);
    const [minX, maxX] = [Math.min(...quad.map((p) => p.x)), Math.max(...quad.map((p) => p.x))];
    const [minY, maxY] = [Math.min(...quad.map((p) => p.y)), Math.max(...quad.map((p) => p.y))];
    for (const b of bars) {
      if (b.kind !== "segment") continue;
      for (const p of [b.a, b.b]) {
        expect(p.x).toBeGreaterThanOrEqual(minX - 1e-9);
        expect(p.x).toBeLessThanOrEqual(maxX + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(minY - 1e-9);
        expect(p.y).toBeLessThanOrEqual(maxY + 1e-9);
      }
    }
    const plant = drawing("plant", { x: 2, y: 2 }, { x: 2.6, y: 1.4 });
    expect(thick(plant, 5)).toEqual([]);
  });

  it("the label keeps its pixel size and offset at zoom 20 and 200", () => {
    const sizes: number[] = [];
    for (const zoom of [20, 200]) {
      const shell = FakeShell.withDocument(roomDoc());
      shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
      shell.ui({ type: "pickKind", kind: "wardrobe" });
      shell.moveTo({ x: 2, y: 2 });
      shell.down({ x: 2, y: 2 });
      shell.moveTo({ x: 2.6, y: 1.7 });
      shell.moveTo({ x: 3.2, y: 1.4 });
      const label = labels(shell)[0];
      const pointer = shell.state.pointer?.screen;
      if (!label || !pointer) throw new Error("no label");
      const at = worldToScreen(shell.state.camera, label.at);
      sizes.push(label.size);
      expect(at.y - pointer.y).toBeCloseTo(-18, 6);
    }
    expect(sizes[0]).toBe(sizes[1]);
  });

  it("the prompt reads `Release to place · R to turn` while drawing, and today's before and after", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 2, y: 2 });
    expect(shell.view().commandBar.prompt).toBe("Click inside a room to place, or drag to draw its footprint");
    shell.down({ x: 2, y: 2 });
    shell.moveTo({ x: 2.6, y: 1.7 });
    shell.moveTo({ x: 3.2, y: 1.4 });
    expect(shell.view().commandBar.prompt).toBe("Release to place · R to turn");
    shell.up({ x: 3.2, y: 1.4 });
    expect(shell.view().commandBar.prompt).toBe("Click inside a room to place, or drag to draw its footprint");
  });

  it("with a typed height armed, the drawing label carries it, and no second label sits by the ghost", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.ui({ type: "setArmedSize", kind: "wardrobe", height: "1.4" });
    shell.moveTo({ x: 2, y: 2 });
    shell.down({ x: 2, y: 2 });
    shell.moveTo({ x: 2.6, y: 1.7 });
    shell.moveTo({ x: 3.2, y: 1.4 });
    expect(labels(shell)[0]?.text).toBe("W 1.20 × D 0.60 × H 1.40 m");
    const presenceTexts = (shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? []).filter((p) => p.kind === "text");
    expect(presenceTexts).toEqual([]);
  });
});
