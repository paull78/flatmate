import { describe, expect, it } from "vitest";
import { helveticaWidth } from "../src/export/helvetica";

describe("Helvetica widths", () => {
  it("measures by the AFM widths: H is 722, a space 278, per 1000 em", () => {
    expect(helveticaWidth("HH", 10)).toBeCloseTo(14.44, 9);
    expect(helveticaWidth(" ", 1000)).toBe(278);
  });
});
