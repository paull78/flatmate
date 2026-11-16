import { describe, expect, it } from "vitest";
import { PAPER_NAMES, SHEET_SCALES } from "@fm/domain";
import { fitScale, scaleFits } from "../src/export/fit";
import { columnMm, drawingArea, orientationFor, PAPERS, STANDARD_SCALES } from "../src/export/paper";

// Paper and scale (export.05, .14; AC-08, AC-09). Sizes are the plan's framed bounds in metres. The drawing area is
// the paper inside a 10 mm margin, left of the title block column (60 mm, 75 mm on A3; sheet.07, .08): A4 landscape
// 217 × 190 mm, A4 portrait 130 × 277 mm, A3 landscape 325 × 277 mm.

describe("paper and scale", () => {
  it("knows A4, A3 and US Letter in millimetres", () => {
    expect(PAPERS.A4).toMatchObject({ w: 210, h: 297 });
    expect(PAPERS.A3).toMatchObject({ w: 297, h: 420 });
    expect(PAPERS.Letter).toMatchObject({ w: 215.9, h: 279.4 });
  });

  it("knows A2 and A1, which take the 75 mm column", () => {
    expect(PAPERS.A2).toMatchObject({ w: 420, h: 594 });
    expect(PAPERS.A1).toMatchObject({ w: 594, h: 841 });
    expect([columnMm("A2"), columnMm("A1")]).toEqual([75, 75]);
  });

  it("the papers and scales are the domain's, in the spec's order", () => {
    expect(Object.keys(PAPERS).sort()).toEqual([...PAPER_NAMES].sort());
    expect([...PAPER_NAMES]).toEqual(["A4", "A3", "A2", "A1", "Letter"]);
    expect(STANDARD_SCALES).toBe(SHEET_SCALES);
  });

  it("the drawing area is the paper inside the margin, left of the column", () => {
    expect(drawingArea("A4", "landscape")).toEqual({ x: 10, y: 10, w: 217, h: 190 });
    expect(drawingArea("A4", "portrait")).toEqual({ x: 10, y: 10, w: 130, h: 277 });
  });

  it("orientation fits the plan: a wide plan is landscape, a tall one portrait", () => {
    expect(orientationFor({ w: 10, h: 4 }, "A4")).toBe("landscape");
    expect(orientationFor({ w: 4, h: 10 }, "A4")).toBe("portrait");
  });

  it("fitScale picks the largest standard scale that fits", () => {
    expect(fitScale({ w: 7, h: 5 }, "A4")).toBe(50); // 1:25 would be 280 mm wide on 217
    expect(fitScale({ w: 7, h: 5 }, "A3")).toBe(25); // 1:20 would be 350 mm wide on 325
    expect(fitScale({ w: 4, h: 3 }, "A4")).toBe(20);
  });

  it("fitScale is null when the plan fits at none of them", () => {
    expect(fitScale({ w: 70, h: 50 }, "A4")).toBeNull();
    expect(fitScale({ w: 70, h: 50 }, "A3")).toBeNull();
  });

  it("scaleFits refuses a fixed scale the plan does not fit, in either orientation", () => {
    expect(scaleFits({ w: 13, h: 9 }, "A4", 50)).toBe(false);
    expect(scaleFits({ w: 13, h: 9 }, "A4", 100)).toBe(true);
  });
});
