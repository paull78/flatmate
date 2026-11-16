import { describe, expect, it } from "vitest";
import { fixturePieceBoxes, index } from "./fixture-pictures";
import { changedOutsideMask } from "./refreeze";

// The refreeze check (studio.06, .12): a refrozen picture may change only near the faces a step meant to change.

const SIZE = 9;
const grey = (): Uint8Array => new Uint8Array(SIZE * SIZE * 4).fill(200);
const at = (x: number, y: number): number => 4 * (y * SIZE + x);
const paint = (px: Uint8Array, x: number, y: number, v: number): Uint8Array => {
  px.set([v, v, v, 255], at(x, y));
  return px;
};
const maskAt = (...cells: [number, number][]): Uint8Array => {
  const m = new Uint8Array(SIZE * SIZE);
  for (const [x, y] of cells) m[y * SIZE + x] = 1;
  return m;
};

describe("changedOutsideMask", () => {
  it("no change, nothing reported", () => {
    expect(changedOutsideMask(grey(), grey(), maskAt(), SIZE)).toEqual([]);
  });

  it("a change inside the mask is allowed", () => {
    expect(changedOutsideMask(grey(), paint(grey(), 4, 4, 0), maskAt([4, 4]), SIZE)).toEqual([]);
  });

  it("a change 2 px from the mask is allowed, 3 px is reported", () => {
    expect(changedOutsideMask(grey(), paint(grey(), 6, 4, 0), maskAt([4, 4]), SIZE)).toEqual([]);
    expect(changedOutsideMask(grey(), paint(grey(), 7, 4, 0), maskAt([4, 4]), SIZE)).toEqual([{ x: 7, y: 4 }]);
  });

  it("a change under the tolerance (8 per channel) is ignored", () => {
    expect(changedOutsideMask(grey(), paint(grey(), 7, 4, 192), maskAt(), SIZE)).toEqual([]);
    expect(changedOutsideMask(grey(), paint(grey(), 7, 4, 191), maskAt(), SIZE)).toEqual([{ x: 7, y: 4 }]);
  });
});

describe("the pieces mask", () => {
  const picture = index.pictures.find((p) => p.drawing === "kinds");
  if (!picture) throw new Error("no kinds sheet");

  it("is the boxes of the pieces of the kinds asked for: a box covers the old look and the new parts, wherever they show", () => {
    const owners = (kinds: readonly string[]) => new Set(fixturePieceBoxes(picture, kinds).map((f) => f.owner));
    expect(owners(["shelf"]).size).toBe(1);
    expect(owners(["shelf", "tvUnit"]).size).toBe(2);
    expect(owners(["noSuchKind"]).size).toBe(0);
    expect(fixturePieceBoxes(picture, ["shelf"])).toHaveLength(5); // one box, whatever its parts: four sides and a top
  });
});
