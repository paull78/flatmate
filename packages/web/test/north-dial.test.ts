import { describe, expect, it } from "vitest";
import { angleFromPoint, arrowedAngle, typedNorth } from "../src/panels/north-dial";

// The north dial's arithmetic (sheetset.15; AC-10): pure, as web tests have no DOM (layout-states.38). The drag itself is in e2e/sheets.spec.ts.

describe("an angle from a point, in 5° steps", () => {
  it("reads clockwise from up, on a screen whose y goes down", () => {
    expect(angleFromPoint(0, -10)).toBe(0);
    expect(angleFromPoint(10, 0)).toBe(90);
    expect(angleFromPoint(0, 10)).toBe(180);
    expect(angleFromPoint(-10, 0)).toBe(270);
    expect(angleFromPoint(10, -10)).toBe(45);
    expect(angleFromPoint(-10, 10)).toBe(225);
  });

  it("rounds to the nearest 5°, and just left of up is 0, never 360", () => {
    expect(angleFromPoint(Math.sin((12 * Math.PI) / 180), -Math.cos((12 * Math.PI) / 180))).toBe(10);
    expect(angleFromPoint(Math.sin((13 * Math.PI) / 180), -Math.cos((13 * Math.PI) / 180))).toBe(15);
    expect(angleFromPoint(-0.01, -10)).toBe(0);
    expect(angleFromPoint(Math.sin((-3 * Math.PI) / 180), -Math.cos((-3 * Math.PI) / 180))).toBe(355);
  });
});

describe("arrows by 1°, Shift 15°", () => {
  it("right and up turn clockwise, left and down back", () => {
    expect(arrowedAngle(45, "ArrowRight", false)).toBe(46);
    expect(arrowedAngle(45, "ArrowUp", false)).toBe(46);
    expect(arrowedAngle(45, "ArrowLeft", false)).toBe(44);
    expect(arrowedAngle(45, "ArrowDown", false)).toBe(44);
  });

  it("Shift goes by 15°", () => {
    expect(arrowedAngle(45, "ArrowRight", true)).toBe(60);
    expect(arrowedAngle(45, "ArrowLeft", true)).toBe(30);
  });

  it("wraps round", () => {
    expect(arrowedAngle(359, "ArrowRight", false)).toBe(0);
    expect(arrowedAngle(0, "ArrowLeft", false)).toBe(359);
    expect(arrowedAngle(350, "ArrowUp", true)).toBe(5);
    expect(arrowedAngle(10, "ArrowDown", true)).toBe(355);
  });

  it("from no arrow, starts at up", () => {
    expect(arrowedAngle(null, "ArrowRight", false)).toBe(1);
    expect(arrowedAngle(null, "ArrowLeft", true)).toBe(345);
  });

  it("leaves other keys alone", () => {
    expect(arrowedAngle(45, "Enter", false)).toBeNull();
    expect(arrowedAngle(45, "z", false)).toBeNull();
  });
});

describe("a typed angle", () => {
  it("blank is nothing to send: only the switch clears", () => {
    expect(typedNorth("")).toBeNull();
    expect(typedNorth("   ")).toBeNull();
  });

  it("drops what the number box lets through, so 045 is 45", () => {
    expect(typedNorth(" 45 ")).toBe("45");
    expect(typedNorth("045")).toBe("45");
    expect(typedNorth("000")).toBe("0");
  });

  it("anything else goes as typed, for the domain to refuse with its reason", () => {
    expect(typedNorth("360")).toBe("360");
    expect(typedNorth("1.5")).toBe("1.5");
    expect(typedNorth("-5")).toBe("-5");
  });
});
