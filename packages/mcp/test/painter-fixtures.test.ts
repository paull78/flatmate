import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { surroundingsOf } from "@fm/domain";
import { hiddenWalls, LOOK_LONG_SIDE, STYLE_3D } from "@fm/editor";
import { drawing, FIXTURE_DIR, index, yawOf } from "./fixture-pictures";
import { pngPixels, rgb } from "./pictures";

// The frozen painter pictures (real3d step 01, real3d.13, AC-16): what raster3d is held to once the painter is gone.

describe("frozen painter fixtures", () => {
  it("cover the studio at every state and turn, the kinds sheet and three random drawings", () => {
    const studio = index.pictures.filter((p) => p.drawing === "studio");
    expect(studio.length).toBe(8);
    expect(new Set(index.pictures.map((p) => p.drawing))).toEqual(new Set(["studio", "kinds", "random1", "random2", "random3"]));
    // Frozen before the seed went on wheels (surroundings step 13): the fixture keeps None, so its pictures stay as frozen.
    expect(surroundingsOf(drawing("studio"))).toBeNull();
  });

  it("every picture exists, decodes to the look's size and is not blank", () => {
    const bg = rgb(STYLE_3D.background);
    for (const p of index.pictures) {
      const img = pngPixels(readFileSync(new URL(p.file, FIXTURE_DIR)));
      expect([img.width, img.height], p.file).toEqual([LOOK_LONG_SIDE, LOOK_LONG_SIDE]);
      let drawn = 0;
      for (let i = 0; i < img.pixels.length; i += 4) if (Math.abs((img.pixels[i] ?? 0) - bg[0]) + Math.abs((img.pixels[i + 1] ?? 0) - bg[1]) + Math.abs((img.pixels[i + 2] ?? 0) - bg[2]) > 12) drawn++;
      expect(drawn / (img.width * img.height), p.file).toBeGreaterThan(0.05);
    }
  });

  it("every drawing loads through fromStored, and its hidden walls at each turn match the index", () => {
    for (const p of index.pictures) expect([...hiddenWalls(drawing(p.drawing), yawOf(p.turn))].sort(), p.file).toEqual(p.hidden);
  });
});
