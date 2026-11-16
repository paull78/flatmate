import { describe, expect, it } from "vitest";
import { toPage } from "../src/export/to-page";
import type { Primitive } from "../src/view/scene-types";

describe("toPage", () => {
  it("toPage moves a polygon's holes with its points", () => {
    const square: Primitive = {
      kind: "polygon",
      points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
      holes: [[{ x: 0.5, y: 0.5 }, { x: 0.5, y: 1.5 }, { x: 1.5, y: 1.5 }, { x: 1.5, y: 0.5 }]],
      color: "#000000",
    };
    const page = toPage(square, 10, 5, 7);
    if (page.kind !== "polygon") throw new Error("not a polygon");
    expect(page.points).toEqual([{ x: 5, y: 7 }, { x: 25, y: 7 }, { x: 25, y: 27 }, { x: 5, y: 27 }]);
    expect(page.holes).toEqual([[{ x: 10, y: 12 }, { x: 10, y: 22 }, { x: 20, y: 22 }, { x: 20, y: 12 }]]);
  });
});
