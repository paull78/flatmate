import { describe, expect, it } from "vitest";
import { MOTIFS, MOTIF_IDS, finishIssue, motifDefaults, motifsFor, type MotifId } from "@fm/domain";
import { finishGeometry } from "../../../src/view/finish/geometry";

// The wall and roof motifs (surfaces step 06): their rows, surfaces and drawings. Sizes are whole units of each drawing,
// so a line's offset is a whole number (finishes.18): Brick and Subway tiles measure their course, Board and batten its
// batten's width, Roof tiles a tile's side.

const square = (side: number) => [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** The distinct y of the horizontal lines, sorted. */
const rowsOf = (motif: MotifId, side = 1, angle?: number) => {
  const g = finishGeometry(square(side), [], { ...motifDefaults(motif), angle: angle ?? motifDefaults(motif).angle });
  return [...new Set(g.lines.filter((l) => near(l.a.y, l.b.y)).map((l) => Math.round(l.a.y * 1e6) / 1e6))].sort((a, b) => a - b);
};
const columnsOf = (motif: MotifId, side = 1) => {
  const g = finishGeometry(square(side), [], motifDefaults(motif));
  return [...new Set(g.lines.filter((l) => near(l.a.x, l.b.x)).map((l) => Math.round(l.a.x * 1e6) / 1e6))].sort((a, b) => a - b);
};

describe("the wall and roof motifs (step 06)", () => {
  it("the seven new rows follow the floor's, with their surfaces", () => {
    expect(MOTIF_IDS.slice(8)).toEqual(["brick", "subwayTiles", "boardAndBatten", "shingles", "standingSeam", "corrugated", "roofTiles"]);
    expect(motifsFor("wall")).toEqual(["planks", "widePlanks", "squareTiles", "largeTiles", "mosaic", "plain", "brick", "subwayTiles", "boardAndBatten", "shingles", "standingSeam", "corrugated"]);
    expect(motifsFor("roof")).toEqual(["shingles", "standingSeam", "corrugated", "roofTiles"]);
    expect(motifsFor("floor")).not.toContain("brick");
  });

  it("every motif's defaults pass on the surfaces it suits and fail on the others", () => {
    for (const id of MOTIF_IDS) {
      for (const surface of ["floor", "wall", "roof"] as const) {
        const issue = finishIssue(motifDefaults(id), surface);
        expect(issue === null, `${id} on ${surface}`).toBe(MOTIFS[id].surfaces.includes(surface));
      }
    }
  });

  it("brick lays courses 0.065 apart from 0, joints staggered by half a brick (0.13)", () => {
    const rows = rowsOf("brick");
    expect(rows[0]).toBeCloseTo(0.065, 9); // a line on the room's edge is dropped, as on floors
    expect(rows[1]).toBeCloseTo(0.13, 9);
    const g = finishGeometry(square(1), [], motifDefaults("brick"));
    const jointsIn = (y0: number) => g.lines.filter((l) => near(l.a.x, l.b.x) && Math.min(l.a.y, l.b.y) >= y0 - 1e-9 && Math.max(l.a.y, l.b.y) <= y0 + 0.065 + 1e-9).map((l) => l.a.x).sort((a, b) => a - b);
    const [first, second] = [jointsIn(0), jointsIn(0.065)];
    expect(first.some((x) => near(x, 0.26))).toBe(true); // a brick 4 courses long
    expect(first.some((x) => near(x, 0.13))).toBe(false);
    expect(second.some((x) => near(x, 0.13))).toBe(true); // the next course shifted by half a brick
  });

  it("subway tiles lay rows 0.075 apart, tiles twice as long, staggered by half", () => {
    const rows = rowsOf("subwayTiles");
    expect(rows.slice(0, 2)).toEqual([0.075, 0.15]);
    expect(columnsOf("subwayTiles").some((x) => near(x, 0.15))).toBe(true);
  });

  it("standing seam at 0.45 runs lines 0.45 apart (horizontal at angle 0)", () => {
    expect(rowsOf("standingSeam", 2, 0)).toEqual([0.45, 0.9, 1.35, 1.8]);
    expect(rowsOf("standingSeam", 2)).toEqual([]); // vertical by default (angle 90)
  });

  it("board and batten draws a batten 0.05 wide every 0.40", () => {
    expect(rowsOf("boardAndBatten", 1, 0)).toEqual([0.05, 0.4, 0.45, 0.8, 0.85]);
  });

  it("shingles stagger every other course; roof tiles run in columns", () => {
    const g = finishGeometry(square(1), [], motifDefaults("shingles"));
    const jointsIn = (y0: number) => g.lines.filter((l) => near(l.a.x, l.b.x) && Math.min(l.a.y, l.b.y) >= y0 - 1e-9 && Math.max(l.a.y, l.b.y) <= y0 + 0.13 + 1e-9).map((l) => l.a.x);
    expect(jointsIn(0).some((x) => near(x, 0.26))).toBe(true);
    expect(jointsIn(0.13).some((x) => near(x, 0.13))).toBe(true);
    expect(columnsOf("roofTiles")).toEqual([0.25, 0.5, 0.75]);
  });

  it("corrugated draws its ribs 0.076 apart, with a shaded strip in each", () => {
    const g = finishGeometry(square(1), [], motifDefaults("corrugated"));
    expect(rowsOf("corrugated", 1, 0).slice(0, 2)).toEqual([0.076, 0.152]);
    expect(g.shapes.length).toBeGreaterThan(0);
    expect(g.spacing).toBeCloseTo(0.076, 9);
  });
});
