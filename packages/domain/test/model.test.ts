import { describe, expect, it } from "vitest";
import { invariantsMessage, topologyMessage } from "../src/errors";
import { EPS, MIN_EDGE, WALL_THICKNESS, emptyDocument } from "../src/model";

describe("model", () => {
  it("starts empty", () => {
    expect(emptyDocument()).toEqual({ joints: {}, walls: {}, zoneLabels: {} });
  });

  it("fixes thickness and tolerances (spec §3.2–3.3)", () => {
    expect(WALL_THICKNESS).toBe(0.2);
    expect(EPS).toBe(0.001);
    expect(MIN_EDGE).toBe(0.01);
  });

  it("names topology failures with toast texts", () => {
    const v = (invariant: "I2" | "I4" | "I5") => ({ invariant, message: "", entities: [] });
    expect(topologyMessage([v("I5")])).toBe("Walls can't cross");
    expect(topologyMessage([v("I2")])).toBe("Wall too short");
    expect(topologyMessage([v("I4")])).toBe("Joints can't overlap");
    expect(topologyMessage([v("I2"), v("I5")])).toBe("Walls can't cross");
  });

  it("maps invariant ids to toast texts, or null when none has one", () => {
    expect(invariantsMessage(new Set(["I5"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I6"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I7"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I2"]))).toBe("Wall too short");
    expect(invariantsMessage(new Set(["I4"]))).toBe("Joints can't overlap");
    expect(invariantsMessage(new Set(["I2", "I7"]))).toBe("Walls can't cross");
    expect(invariantsMessage(new Set(["I1", "I3", "I8", "I9"]))).toBeNull();
    expect(invariantsMessage(new Set())).toBeNull();
  });
});
