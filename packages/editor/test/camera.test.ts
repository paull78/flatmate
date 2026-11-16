import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, boxInView, frameBox, panBy, screenToWorld, worldToScreen, zoomAt, type Camera } from "../src/camera";

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };

describe("camera", () => {
  it("maps the viewport centre to the camera centre", () => {
    expect(screenToWorld(camera, { x: 600, y: 400 })).toEqual({ x: 3, y: 2 });
  });

  it("points world y up and screen y down", () => {
    expect(worldToScreen(camera, { x: 3, y: 3 })).toEqual({ x: 600, y: 320 });
    expect(screenToWorld(camera, { x: 680, y: 400 })).toEqual({ x: 4, y: 2 });
  });

  it("round-trips a world point exactly at integer scale", () => {
    const p = { x: 6, y: 0 };
    expect(screenToWorld(camera, worldToScreen(camera, p))).toEqual(p);
  });

  it("round-trips world points at a non-trivial zoom", () => {
    const odd: Camera = { center: { x: 0.1, y: 0.2 }, zoom: 80 * Math.E, viewport: { width: 1200, height: 800 }, dpr: 1 };
    for (const p of [
      { x: 3.3, y: -4.7 },
      { x: 0.1, y: 0 },
      { x: -12.25, y: 7.125 },
    ]) {
      const back = screenToWorld(odd, worldToScreen(odd, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it("zooms around the cursor", () => {
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(camera, screen);
    const zoomed = zoomAt(camera, screen, 2);
    expect(zoomed.zoom).toBe(160);
    const after = screenToWorld(zoomed, screen);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("clamps zoom to [5, 2000] px per metre", () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 1000).zoom).toBe(2000);
    expect(zoomAt(camera, { x: 0, y: 0 }, 0.0001).zoom).toBe(5);
  });

  it("keeps the point under the cursor when the zoom is clamped", () => {
    const screen = { x: 300, y: 200 };
    const before = screenToWorld(camera, screen);
    for (const factor of [1000, 0.0001]) {
      const after = screenToWorld(zoomAt(camera, screen, factor), screen);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it("ignores a zoom factor that is not a finite positive number", () => {
    const screen = { x: 300, y: 200 };
    for (const factor of [NaN, 0, -1, Infinity]) {
      expect(zoomAt(camera, screen, factor)).toBe(camera);
    }
  });

  it("pans with the pointer", () => {
    // Dragging right and up by 80 px at 80 px/m shows what was 1 m to the left and 1 m below.
    expect(panBy(camera, 80, -80).center).toEqual({ x: 2, y: 1 });
  });
});

describe("frameBox and boxInView (furnish.07)", () => {
  // The view spans x −4.5…10.5, y −3…7.
  const c: Camera = { center: { x: 3, y: 2 }, zoom: 80, viewport: { width: 1200, height: 800 }, dpr: 2 };
  const box = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

  it("frames a box taller than the view on its height", () => {
    const framed = frameBox(c, box(-4.5, -8, 15.5, 7), 48);
    expect(framed.zoom).toBeCloseTo(704 / 15, 9); // (800 − 96) / 15; on the width it would be 55.2
    expect(framed.center.x).toBeCloseTo(5.5, 9);
    expect(framed.center.y).toBeCloseTo(-0.5, 9);
    expect(framed.viewport).toEqual(c.viewport);
    expect(framed.dpr).toBe(2);
    expect(worldToScreen(framed, { x: -4.5, y: 7 }).y).toBeCloseTo(48, 9);
    expect(worldToScreen(framed, { x: 15.5, y: -8 }).y).toBeCloseTo(752, 9);
  });

  it("frames a wide box on its width", () => {
    const framed = frameBox(c, box(0, 0, 20, 2), 48);
    expect(framed.zoom).toBeCloseTo(1104 / 20, 9);
    expect(framed.center.x).toBeCloseTo(10, 9);
    expect(framed.center.y).toBeCloseTo(1, 9);
  });

  it("clamps to MIN_ZOOM and MAX_ZOOM", () => {
    const huge = frameBox(c, box(0, 0, 1000, 1), 48);
    expect(huge.zoom).toBe(MIN_ZOOM);
    expect(huge.center).toEqual({ x: 500, y: 0.5 });
    const tiny = frameBox(c, box(0, 0, 0.01, 0.01), 48);
    expect(tiny.zoom).toBe(MAX_ZOOM);
    expect(tiny.center).toEqual({ x: 0.005, y: 0.005 });
  });

  it("returns the camera unchanged for an empty viewport", () => {
    const empty: Camera = { ...c, viewport: { width: 0, height: 0 } };
    expect(frameBox(empty, box(0, 0, 20, 2), 48)).toBe(empty);
    const flat: Camera = { ...c, viewport: { width: 0, height: 800 } };
    expect(frameBox(flat, box(0, 0, 20, 2), 48)).toBe(flat);
  });

  it("a viewport no bigger than the margins never gives a negative zoom or NaN", () => {
    const small: Camera = { ...c, viewport: { width: 60, height: 60 } };
    expect(frameBox(small, box(0, 0, 20, 2), 48).zoom).toBe(MIN_ZOOM);
    const tight: Camera = { ...c, viewport: { width: 96, height: 96 } }; // no room left: 0 / 0 without the 1 px floor
    expect(frameBox(tight, box(1, 1, 1, 1), 48).zoom).toBe(MAX_ZOOM);
  });

  it("boxInView: true inside the view, with 0.5 px of slack", () => {
    expect(boxInView(c, box(-4.5, -3, 10.5, 7))).toBe(true);
    expect(boxInView(c, box(-4.5, -3, 10.51, 7))).toBe(false); // 0.8 px over
    expect(boxInView(c, box(-4.5, -3, 10.5059, 7))).toBe(true); // 0.47 px over
    expect(boxInView(c, box(-4.51, -3, 10.5, 7))).toBe(false); // over the left edge
    expect(boxInView(c, box(-4.5, -3, 10.5, 7.01))).toBe(false); // over the top edge
    expect(boxInView(c, box(-4.5, -3.01, 10.5, 7))).toBe(false); // over the bottom edge
  });
});
