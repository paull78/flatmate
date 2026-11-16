import { describe, expect, it } from "vitest";
import { framedBy } from "@fm/editor";
import { backingShift, dragDelta, dragTo, frameBoxes, paperDrag, pressAt } from "../src/panels/page-drag";
import { pageCssSize } from "../src/panels/sheet-canvas";

// A framing drag's arithmetic (sheetset.17; AC-05): pure, as web tests have no DOM (layout-states.38).

const at = (x: number, y: number) => ({ x, y });

describe("press, move and release", () => {
  it("a press under 4 px is a click, not a drag", () => {
    const press = pressAt(at(100, 100));
    expect(dragTo(press, at(103, 100)).dragging).toBe(false);
    expect(dragTo(press, at(102, 102)).dragging).toBe(false); // 2.8 px
    expect(dragDelta(dragTo(press, at(103, 100)))).toEqual({ x: 0, y: 0 }); // nothing shifts, and nothing commits
    expect(dragTo(press, at(104, 100)).dragging).toBe(true);
    expect(dragTo(press, at(100, 96)).dragging).toBe(true);
    expect(dragTo(press, at(103, 103)).dragging).toBe(true); // 4.2 px
  });

  it("once it's a drag it stays one, back at the start too", () => {
    const moved = dragTo(pressAt(at(10, 10)), at(40, 10));
    expect(dragDelta(moved)).toEqual({ x: 30, y: 0 });
    const back = dragTo(moved, at(11, 10));
    expect(back.dragging).toBe(true);
    expect(dragDelta(back)).toEqual({ x: 1, y: 0 });
  });
});

describe("pixels to the plan's movement", () => {
  const page = { widthMm: 420, heightMm: 297 };

  it.each([0.5, 0.75, 1, 1.25, 1.5, 2, 0.93])("metres from pixels at zoom %f", (zoom) => {
    const pxPerMm = pageCssSize(page, zoom).w / page.widthMm;
    const mm = paperDrag({ x: 100 * pxPerMm, y: -40 * pxPerMm }, pxPerMm); // 100 mm right and 40 mm up on paper, in this zoom's pixels
    expect(mm.dxMm).toBeCloseTo(100, 6);
    expect(mm.dyMm).toBeCloseTo(40, 6);
    const at20 = framedBy({ cx: 0, cy: 0 }, { x: mm.dxMm, y: mm.dyMm }, 20);
    expect(at20.cx).toBeCloseTo(-2, 3);
    expect(at20.cy).toBeCloseTo(-0.8, 3);
    const at100 = framedBy({ cx: 0, cy: 0 }, { x: mm.dxMm, y: mm.dyMm }, 100);
    expect(at100.cx).toBeCloseTo(-10, 3);
    expect(at100.cy).toBeCloseTo(-4, 3);
  });

  it("a screen's y runs down and a page's up", () => {
    expect(paperDrag({ x: 0, y: 20 }, 2).dyMm).toBe(-10);
  });
});

describe("drawing it live", () => {
  it("the shift is in the canvas's own pixels, at the screen's ratio", () => {
    expect(backingShift({ x: 10, y: -5 }, 1680, 840)).toEqual({ x: 20, y: -10 });
    expect(backingShift({ x: 10, y: -5 }, 840, 840)).toEqual({ x: 10, y: -5 });
  });

  it("a page's frame on screen, measured from its top left, its y flipped", () => {
    const page = { widthMm: 100, heightMm: 50, primitives: [], clips: [{ rect: { x: 10, y: 5, w: 60, h: 40 }, from: 0, to: 0 }] };
    expect(frameBoxes(page, { w: 200, h: 100 })).toEqual([{ left: 20, top: 10, width: 120, height: 80 }]);
  });

  it("a page with no clip has no frame to drag: a blank page, or a report", () => {
    expect(frameBoxes({ widthMm: 100, heightMm: 50, primitives: [] }, { w: 200, h: 100 })).toEqual([]);
  });
});
