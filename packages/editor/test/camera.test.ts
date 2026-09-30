import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, panBy, screenToWorld, worldToScreen, zoomAt, type Camera } from "../src/camera";

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
