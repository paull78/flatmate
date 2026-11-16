import { describe, expect, it } from "vitest";
import type { Primitive } from "@fm/editor";
import { toSvg } from "../src/svg";
import { toPdf } from "../src/pdf";
import { readPdf } from "./pdf-reader";

// One dash pair (render.05, AC-05): SVG and PDF draw the on/off pair a segment gives, in drawing units.

const seg = (dash: readonly [number, number]): Primitive => ({ kind: "segment", a: { x: 1, y: 1 }, b: { x: 5, y: 1 }, width: { px: 0.25 }, color: "#1a1a1a", cap: "butt", dash });
const MM = 72 / 25.4;
const n = (v: number): string => String(Math.round(v * 1e4) / 1e4);

describe("a dash is one pair (AC-05)", () => {
  it("svg writes it as stroke-dasharray", () => {
    const frame = { min: { x: 0, y: 0 }, max: { x: 6, y: 4 }, zoom: 10 };
    expect(toSvg([seg([6, 4])], frame)).toContain('stroke-dasharray="6 4"');
    expect(toSvg([seg([1.2, 0.8])], frame)).toContain('stroke-dasharray="1.2 0.8"');
  });

  it("pdf writes it as a d operator in points", () => {
    for (const [on, off] of [[6, 4], [1.2, 0.8]] as const) {
      const content = readPdf(toPdf([{ widthMm: 210, heightMm: 297, primitives: [seg([on, off])] }])).pages[0]?.content ?? "";
      expect(content).toContain(`[${n(on * MM)} ${n(off * MM)}] 0 d`);
    }
  });

  it("a longer pattern no longer type-checks", () => {
    // @ts-expect-error -- a dash is one on/off pair
    const bad: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt", dash: [4, 2, 1] };
    expect(bad.kind).toBe("segment");
  });
});

describe("one colour parser in the writers (render.12)", () => {
  const bad = (color: string): Primitive => ({ kind: "segment", a: { x: 1, y: 1 }, b: { x: 5, y: 1 }, width: { px: 0.25 }, color, cap: "butt" });
  it("svg writes what colorChannels reads: a colour outside the rule is magenta", () => {
    const frame = { min: { x: 0, y: 0 }, max: { x: 6, y: 4 }, zoom: 10, background: null };
    expect(toSvg([bad("#FF8000")], frame)).toContain('stroke="#ff00ff"');
    expect(toSvg([bad("#ff800080")], frame)).toContain('stroke="#ff8000" stroke-opacity="0.502"');
  });

  it("pdf too", () => {
    const content = readPdf(toPdf([{ widthMm: 210, heightMm: 297, primitives: [bad("#FF8000")] }])).pages[0]?.content ?? "";
    expect(content).toContain("1 0 1 RG");
  });
});
