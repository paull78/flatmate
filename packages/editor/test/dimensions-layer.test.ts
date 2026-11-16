import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { dimensionLayout } from "../src/view/dimension-layout";
import { dimensionsLayer } from "../src/view/dimensions-layer";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { studioDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The dimensions picture layer (dims.19; AC-12): every stored dimension in a plan style, shared by all layouts.

const doc = (): Document =>
  withCommands(studioDoc(), { type: "addDimension", opId: "m1", a: { x: 0.5, y: 1 }, b: { x: 3.5, y: 1 }, offset: 0.5 });

const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const texts = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "text" ? [p] : []));
const colors = (ps: readonly Primitive[]): Set<string> => new Set(ps.map((p) => p.color));

describe("the dimensions layer (dims.19)", () => {
  it("canvas look: a line, two extensions and two ticks in px widths, and the value", () => {
    const ps = dimensionsLayer(doc(), CANVAS_STYLE, 80, "", null);
    expect(segments(ps)).toHaveLength(5);
    expect(texts(ps)).toHaveLength(1);
    expect(segments(ps).map((s) => s.width)).toEqual([{ px: 1 }, { px: 1 }, { px: 1 }, { px: 1.5 }, { px: 1.5 }]);
    expect(texts(ps)[0]).toMatchObject({ text: "3.00", size: 11, align: "center" });
    expect([...colors(ps)]).toEqual([COLORS.text]);
    expect([...colors(dimensionsLayer(doc(), CANVAS_STYLE, 80, "m1/m0", null))]).toEqual([COLORS.wallSelected]);
  });

  it("carries the layout through: line, extensions, ticks in order, and the text's place and turn (AC-08 on canvas)", () => {
    const a = { x: 0.5, y: 1 };
    const b = { x: 0.5, y: 4 };
    const vertical = withCommands(studioDoc(), { type: "addDimension", opId: "m1", a, b, offset: 0.5 });
    const ps = dimensionsLayer(vertical, CANVAS_STYLE, 80, "", null);
    const l = dimensionLayout(a, b, 0.5, CANVAS_STYLE, 80);
    expect(l).not.toBeNull();
    if (!l) return;
    expect(segments(ps).map((s) => [s.a, s.b])).toEqual([l.line, ...l.extensions, ...l.ticks]);
    expect(texts(ps)[0]).toMatchObject({ at: l.text.at, rotation: l.text.rotation });
    expect(texts(ps)[0]?.rotation).toBe(Math.PI / 2);
  });

  it("paper look: the accent, thin widths and 2.5 mm text", () => {
    const ps = dimensionsLayer(doc(), PRESENTATION_STYLE, 20, "", null);
    expect([...colors(ps)]).toEqual(["#b3261e"]);
    expect(new Set(segments(ps).map((s) => JSON.stringify(s.width)))).toEqual(new Set([JSON.stringify({ px: 0.18 }), JSON.stringify({ px: 0.35 })]));
    expect(texts(ps).map((t) => t.size)).toEqual([2.5]);
  });

  it("draft: the tool's preview is drawn last, in the selected colour", () => {
    const row = dimensionsLayer(doc(), CANVAS_STYLE, 80, "", null);
    const ps = dimensionsLayer(doc(), CANVAS_STYLE, 80, "", { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, offset: 0 });
    expect(ps.slice(0, row.length)).toEqual(row);
    const draft = ps.slice(row.length);
    expect(texts(draft).map((t) => t.text)).toEqual(["1.00"]);
    expect([...colors(draft)]).toEqual([CANVAS_STYLE.dim.selected]);
  });

  it("reuse: the same arguments return the same array", () => {
    const d = doc();
    expect(dimensionsLayer(d, CANVAS_STYLE, 80, "", null)).toBe(dimensionsLayer(d, CANVAS_STYLE, 80, "", null));
  });

  it("a row whose anchor joint is missing is skipped", () => {
    const d = doc();
    const lost = { id: "lost", a: { joint: "gone", tx: 0, ty: 0 }, b: { x: 1, y: 1 }, offset: 0 };
    const ps = dimensionsLayer({ ...d, dimensions: { ...d.dimensions, lost } }, CANVAS_STYLE, 80, "", null);
    expect(texts(ps).map((t) => t.text)).toEqual(["3.00"]);
  });

  it("the canvas shows a stored dimension in every layout (AC-12)", () => {
    const shell = FakeShell.withDocument(doc());
    const layerTexts = () => texts(shell.scene().layers.find((l) => l.name === "dimensions")?.primitives ?? []).map((t) => t.text);
    expect(layerTexts()).toEqual(["3.00"]);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.send({ type: "frame", now: 600 });
    expect(layerTexts()).toEqual(["3.00"]);
  });
});
