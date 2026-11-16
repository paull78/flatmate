import { describe, expect, it } from "vitest";
import { keptOnStage } from "../src/panels/UnderPointerList";

describe("the list stays on the stage", () => {
  const menu = { width: 140, height: 100 };
  const stage = { width: 800, height: 600 };
  it("sits at the pointer when it fits", () => expect(keptOnStage({ x: 300, y: 200 }, menu, stage)).toEqual({ left: 300, top: 200 }));
  it("moves back in at the right and the bottom", () => expect(keptOnStage({ x: 790, y: 590 }, menu, stage)).toEqual({ left: 660, top: 500 }));
  it("a menu taller than the stage starts at its top", () => expect(keptOnStage({ x: 10, y: 50 }, { width: 140, height: 900 }, stage)).toEqual({ left: 10, top: 0 }));
});
