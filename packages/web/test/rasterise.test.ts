import { describe, expect, it } from "vitest";
import type { ExportPage } from "@fm/editor";
import { pixelPage } from "../src/adapters/rasterise";

// The PNG rasteriser's geometry (export.18, AC-06): a page in millimetres becomes pixels at `size`; the Canvas2D
// renderer then draws it with a camera of one pixel per unit.

const page: ExportPage = {
  widthMm: 72,
  heightMm: 52,
  primitives: [
    { kind: "segment", a: { x: 0, y: 0 }, b: { x: 72, y: 0 }, width: { px: 0.25 }, color: "#1a1a1a", cap: "butt" },
    { kind: "text", text: "Kitchen", at: { x: 36, y: 26 }, size: 2.5, color: "#1a1a1a", align: "center", rotation: 0, font: "inter" },
    { kind: "arc", center: { x: 10, y: 10 }, radius: 5, from: 0, to: 1, width: { px: 0.18 }, color: "#000000" },
  ],
};

describe("pixelPage", () => {
  it("scales positions, widths, text sizes and radii by the pixels per millimetre", () => {
    const { primitives, camera } = pixelPage(page, { w: 3000, h: 2167 });
    const k = 3000 / 72;
    const [seg, text, arc] = primitives;
    if (seg?.kind !== "segment" || text?.kind !== "text" || arc?.kind !== "arc") throw new Error("kinds");
    expect(seg.b.x).toBeCloseTo(3000, 6);
    expect("px" in seg.width ? seg.width.px : 0).toBeCloseTo(0.25 * k, 6);
    expect(text.size).toBeCloseTo(2.5 * k, 6);
    expect(arc.radius).toBeCloseTo(5 * k, 6);
    expect(camera).toEqual({ center: { x: 1500, y: 1083.5 }, zoom: 1, viewport: { width: 3000, height: 2167 }, dpr: 1 });
  });

  it("scales a polygon's holes", () => {
    const withHole: ExportPage = {
      ...page,
      primitives: [...page.primitives, { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 52 }], holes: [[{ x: 36, y: 26 }, { x: 40, y: 26 }, { x: 36, y: 30 }]], color: "#000000" }],
    };
    const poly = pixelPage(withHole, { w: 3000, h: 2167 }).primitives[3];
    if (poly?.kind !== "polygon") throw new Error("kinds");
    const q = poly.holes[0]?.[0];
    expect(q?.x).toBeCloseTo(1500, 6);
    expect(q?.y).toBeCloseTo((26 * 3000) / 72, 6); // 1083.33…
  });
});


describe("pixelPage dashes (render.05)", () => {
  it("scales both halves of a dash pair", () => {
    const dashed: ExportPage = { widthMm: 72, heightMm: 52, primitives: [{ kind: "segment", a: { x: 0, y: 0 }, b: { x: 72, y: 0 }, width: { px: 0.25 }, color: "#1a1a1a", cap: "butt", dash: [2, 1.2] }] };
    const [seg] = pixelPage(dashed, { w: 3000, h: 2167 }).primitives;
    if (seg?.kind !== "segment") throw new Error("kind");
    const k = 3000 / 72;
    expect(seg.dash?.[0]).toBeCloseTo(2 * k, 6);
    expect(seg.dash?.[1]).toBeCloseTo(1.2 * k, 6);
  });
});
