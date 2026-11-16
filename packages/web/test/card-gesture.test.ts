import { describe, expect, it } from "vitest";
import { CLICK_SLOP_PX, hoversIn3d, moved, press, release } from "../src/panels/card-gesture";

// A card's press: under 4 px it's a click that opens the project; from 4 px it's a drag that turns the home (AC-08).

describe("a card's press", () => {
  it("moving without a press does nothing", () => {
    expect(moved(null, 50, 50)).toEqual({ gesture: null, delta: null });
    expect(release(null)).toBeNull();
  });

  it("is a click under the slop", () => {
    const g = moved(press(10, 10), 10 + CLICK_SLOP_PX - 1, 10);
    expect(g.delta).toBeNull();
    expect(release(g.gesture)).toBe("click");
  });

  it("is a drag from the slop", () => {
    const g = moved(press(10, 10), 10 + CLICK_SLOP_PX, 10);
    expect(g.delta).toEqual({ dx: CLICK_SLOP_PX, dy: 0 });
    expect(release(g.gesture)).toBe("drag");
  });

  it("measures the slop in any direction", () => {
    expect(release(moved(press(0, 0), 3, 3).gesture)).toBe("drag"); // 4.24 px
    expect(release(moved(press(0, 0), 2, 2).gesture)).toBe("click"); // 2.83 px
  });

  it("stays a drag after coming back to where it started", () => {
    const out = moved(press(0, 0), 10, 0);
    const back = moved(out.gesture, 0, 0);
    expect(back.delta).toEqual({ dx: -10, dy: 0 });
    expect(release(back.gesture)).toBe("drag");
  });

  it("gives each move's own delta, and the first includes what the slop held back", () => {
    const a = moved(press(0, 0), 2, 0);
    expect(a.delta).toBeNull();
    const b = moved(a.gesture, 6, 1);
    expect(b.delta).toEqual({ dx: 6, dy: 1 });
    const c = moved(b.gesture, 7, 1);
    expect(c.delta).toEqual({ dx: 1, dy: 0 });
  });
});

describe("who hovers into 3D (AC-11)", () => {
  const mouse = { pointerType: "mouse", canTurn: true, showing3d: false, pressed: false };

  it("a mouse on a card that can turn", () => {
    expect(hoversIn3d(mouse)).toBe(true);
  });

  it("not touch or a pen", () => {
    expect(hoversIn3d({ ...mouse, pointerType: "touch" })).toBe(false);
    expect(hoversIn3d({ ...mouse, pointerType: "pen" })).toBe(false);
  });

  it("not a card that can't turn: no walls, or a browser without WebGL2", () => {
    expect(hoversIn3d({ ...mouse, canTurn: false })).toBe(false);
  });

  it("not again once it shows, nor while pressed", () => {
    expect(hoversIn3d({ ...mouse, showing3d: true })).toBe(false);
    expect(hoversIn3d({ ...mouse, pressed: true })).toBe(false);
  });

  it("a touch's tap is still a click", () => {
    expect(release(moved(press(0, 0), 1, 1).gesture)).toBe("click");
  });
});
