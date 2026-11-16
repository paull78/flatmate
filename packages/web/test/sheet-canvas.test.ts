import { describe, expect, it } from "vitest";
import { DESK_PADDING, canZoom, fitZoom, nextZoom, pageBackingSize, pageCssSize, zoomLabel } from "../src/panels/sheet-canvas";

// The screen zoom and a page's sizes (sheetset.15): the mockup's proportions, and a bitmap that stays bounded.

describe("the screen zoom", () => {
  it("steps by a quarter between a half and double", () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(2, 1)).toBe(2);
    expect(nextZoom(0.5, -1)).toBe(0.5);
    expect([canZoom(2, 1), canZoom(2, -1), canZoom(0.5, -1), canZoom(1, 1)]).toEqual([false, true, false, true]);
  });

  it("reads as a percentage", () => {
    expect(zoomLabel(1.25)).toBe("125%");
    expect(zoomLabel(0.943)).toBe("94%");
  });

  it("from a fitted zoom, the steps go to the next one along, so 100% stays offered", () => {
    expect(nextZoom(0.943, 1)).toBe(1);
    expect(nextZoom(0.943, -1)).toBe(0.75);
    expect(nextZoom(1.04, 1)).toBe(1.25);
    expect(nextZoom(1.04, -1)).toBe(1);
  });
});

describe("the zoom a sheet opens at", () => {
  const A4 = { widthMm: 297, heightMm: 210 };
  const A3 = { widthMm: 420, heightMm: 297 };
  const A1 = { widthMm: 841, heightMm: 594 };

  it("fills the desk's width on every paper, inside its padding", () => {
    for (const page of [A4, A3, { widthMm: 594, heightMm: 420 }, A1]) {
      expect(pageCssSize(page, fitZoom(page.widthMm, 832)).w).toBe(832 - 2 * DESK_PADDING);
    }
  });

  it("A3 at a 1440 window, whose desk is 832 wide, stops scrolling sideways", () => {
    expect(pageCssSize(A3, 1).w).toBeGreaterThan(832 - 2 * DESK_PADDING); // 100% is why it opens fitted
    expect(fitZoom(A3.widthMm, 832)).toBeCloseTo(792 / 840);
  });

  it("stays within the zoom's ends, on a very narrow or a very wide desk", () => {
    expect(fitZoom(A3.widthMm, 100)).toBe(0.5);
    expect(fitZoom(A4.widthMm, 4000)).toBe(2);
  });
});

describe("a page on screen", () => {
  it("A4 and A3 are at 2 px a millimetre, as on the mockup", () => {
    expect(pageCssSize({ widthMm: 297, heightMm: 210 }, 1)).toEqual({ w: 594, h: 420 });
    expect(pageCssSize({ widthMm: 420, heightMm: 297 }, 1)).toEqual({ w: 840, h: 594 });
  });

  it("A2 and A1 start smaller, by the mockup's factors", () => {
    expect(pageCssSize({ widthMm: 594, heightMm: 420 }, 1)).toEqual({ w: 713, h: 504 });
    expect(pageCssSize({ widthMm: 841, heightMm: 594 }, 1)).toEqual({ w: 757, h: 535 });
  });

  it("zoom scales it", () => {
    expect(pageCssSize({ widthMm: 297, heightMm: 210 }, 0.5)).toEqual({ w: 297, h: 210 });
    expect(pageCssSize({ widthMm: 297, heightMm: 210 }, 2)).toEqual({ w: 1188, h: 840 });
  });
});

describe("a page's bitmap", () => {
  it("is sharp at the screen's ratio", () => {
    expect(pageBackingSize({ w: 594, h: 420 }, 2)).toEqual({ w: 1188, h: 840 });
    expect(pageBackingSize({ w: 594, h: 420 }, 1)).toEqual({ w: 594, h: 420 });
  });

  it("stops at 4096 on its long side, in proportion", () => {
    const size = pageBackingSize({ w: 1514, h: 1070 }, 3);
    expect(size.w).toBe(4096);
    expect(size.h).toBe(Math.round((1070 * 4096) / 1514));
  });
});
