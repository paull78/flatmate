import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { dimensionLayout, dimensionValue, type DimensionLayout } from "../src/view/dimension-layout";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";

// The drafting look of a placed dimension (dims.09, dims.19; AC-08, AC-11): one pure layout from its points, offset,
// style and zoom, the same for A→B with o and B→A with −o.

const p = (x: number, y: number): Point => ({ x, y });

function layout(a: Point, b: Point, offset: number, zoom = 100, style = CANVAS_STYLE): DimensionLayout {
  const l = dimensionLayout(a, b, offset, style, zoom);
  if (!l) throw new Error("no layout");
  return l;
}

function near(actual: Point | undefined, expected: Point): void {
  if (!actual) throw new Error("no point");
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

function nearAll(actual: readonly Point[] | undefined, expected: Point[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => near(actual?.[i], e));
}

describe("dimensionLayout (dims.09, dims.19)", () => {
  it("lays out a horizontal dimension", () => {
    const l = layout(p(0, 0), p(3, 0), -0.5);
    nearAll(l.line, [p(0, -0.5), p(3, -0.5)]);
    expect(l.extensions).toHaveLength(2);
    nearAll(l.extensions[0], [p(0, -0.03), p(0, -0.56)]);
    nearAll(l.extensions[1], [p(3, -0.03), p(3, -0.56)]);
    expect(l.ticks).toHaveLength(2);
    nearAll(l.ticks[0], [p(-0.028284, -0.528284), p(0.028284, -0.471716)]);
    expect(l.text.value).toBe("3.00");
    near(l.text.at, p(1.5, -0.415));
    expect(l.text.rotation).toBeCloseTo(0, 9);
    // CANVAS_STYLE measures in Inter: "3.00" is (1265 + 590 + 2 × 1292) / 2048 em, 23.842 px at 11 px.
    nearAll(l.text.box, [p(1.3807886, -0.47), p(1.6192114, -0.47), p(1.6192114, -0.36), p(1.3807886, -0.36)]);
  });

  it("a diagonal is aligned with its points", () => {
    const l = layout(p(0.5, 0.25), p(2.9, 2.05), 0.4); // length 3
    nearAll(l.line, [p(0.26, 0.57), p(2.66, 2.37)]); // the wrong normal would put it at (0.74, −0.07)
    expect(l.text.rotation).toBeCloseTo(0.6435011088, 9);
    near(l.text.at, p(1.409, 1.538));
    nearAll(l.ticks[0], [p(0.254343, 0.530402), p(0.265657, 0.609598)]);
    nearAll(l.extensions[0], [p(0.482, 0.274), p(0.224, 0.618)]);
  });

  it("B→A with −offset gives the same layout (AC-08)", () => {
    expect(layout(p(2.9, 2.05), p(0.5, 0.25), -0.4)).toEqual(layout(p(0.5, 0.25), p(2.9, 2.05), 0.4));
    expect(layout(p(3, 0), p(0, 0), 0.5)).toEqual(layout(p(0, 0), p(3, 0), -0.5));
    expect(layout(p(0.3, 0), p(0, 0), -0, 80)).toEqual(layout(p(0, 0), p(0.3, 0), 0, 80));
    expect(layout(p(0.3, 0), p(0, 0), 0, 80)).toEqual(layout(p(0, 0), p(0.3, 0), 0, 80)); // no −0 leaks out
    expect(layout(p(0.3, 0), p(0, 0), -0.2, 80)).toEqual(layout(p(0, 0), p(0.3, 0), 0.2, 80));
  });

  it("a near-vertical reads from the right (AC-08)", () => {
    const cases: [Point, Point][] = [
      [p(0, 0), p(1e-12, 2)],
      [p(0, 0), p(-1e-12, 2)],
      [p(1e-12, 2), p(0, 0)],
      [p(-1e-12, 2), p(0, 0)],
    ];
    for (const [a, b] of cases) {
      const l = layout(a, b, 0);
      expect(l.text.rotation).toBe(Math.PI / 2);
      expect(l.text.at.x).toBeCloseTo(-0.085, 6);
    }
  });

  it("no text is upside down", () => {
    for (let k = 0; k < 360; k++) {
      const t = (k * Math.PI) / 180;
      const { rotation } = layout(p(0, 0), p(2 * Math.cos(t), 2 * Math.sin(t)), 0).text;
      expect(Math.cos(rotation) > 1e-9 || rotation === Math.PI / 2, `k = ${k}, rotation ${rotation}`).toBe(true);
    }
    const t = (91 * Math.PI) / 180;
    expect(layout(p(0, 0), p(2 * Math.cos(t), 2 * Math.sin(t)), 0).text.rotation).toBeCloseTo((-89 * Math.PI) / 180, 9);
  });

  it("short text overflows past the end it reads toward (AC-11)", () => {
    // At zoom 80 a 0.30 m line is 24 px, less than 23.842 + 6 (Inter "0.30" at 11 px): the text goes 0.3 + (3 + 11.921) / 80.
    near(layout(p(0, 0), p(0.3, 0), 0, 80).text.at, p(0.4865143, 0.10625));
    near(layout(p(0.3, 0), p(0, 0), 0, 80).text.at, p(0.4865143, 0.10625)); // past tick B would be x −0.1865143
    for (const [a, b] of [[p(0, 0), p(0, 0.3)], [p(0, 0.3), p(0, 0)]] as const) {
      const l = layout(a, b, 0, 80);
      near(l.text.at, p(-0.10625, 0.4865143));
      expect(l.text.rotation).toBe(Math.PI / 2);
    }
    near(layout(p(0, 0), p(0.4, 0), 0, 80).text.at, p(0.2, 0.10625)); // 32 px: centred
  });

  it("paper sizes: the fit rule works in drawing units", () => {
    // 1:100: "0.30" is 4.865 mm wide, and 4.865 + 2 > 3.
    near(layout(p(0, 0), p(0.3, 0), 0, 10, PRESENTATION_STYLE).text.at, p(0.64325, 0.225));
    near(layout(p(0, 0), p(0.3, 0), 0, 50, PRESENTATION_STYLE).text.at, p(0.15, 0.045));
  });

  it("extensions vanish within the gap", () => {
    expect(layout(p(0, 0), p(3, 0), 0.02).extensions).toEqual([]);
    expect(layout(p(0, 0), p(3, 0), 0.05).extensions).toHaveLength(2);
    expect(layout(p(0, 0), p(3, 0), 0.02, 200).extensions).toHaveLength(2); // 4 px
  });

  it("under 1 mm is null", () => {
    expect(dimensionLayout(p(0, 0), p(0.0009, 0), 0, CANVAS_STYLE, 100)).toBeNull();
    expect(dimensionLayout(p(0, 0), p(0.001, 0), 0, CANVAS_STYLE, 100)).not.toBeNull();
  });
});

describe("dimensionValue", () => {
  it("is metres with two decimals and no unit", () => {
    expect(dimensionValue(3)).toBe("3.00");
    expect(dimensionValue(2.999)).toBe("3.00");
  });
});
