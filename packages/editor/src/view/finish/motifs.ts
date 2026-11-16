import type { MotifId } from "@fm/domain";
import type { Point } from "@fm/protocol";

// How each motif draws (finishes.07): one cell of its pattern, in units of the finish's size, repeated over the plane
// from (0,0) by two vectors. The domain owns the rules (names, ranges, defaults); this table only draws.

/** Lines along the pattern's own x or y axis: a line's key is its family and its offset, a whole number (finishes.18). */
export type LineFamily = "x" | "y";

/** One joint of a cell, `a` before `b` along its family's axis; `shade` multiplies the base colour (finishes.05). */
export type MotifLine = { family: LineFamily; a: Point; b: Point; shade: number };

/** A filled shape of a cell, convex and counter-clockwise, with its shade; it may stick out of the cell. */
export type MotifShape = { points: readonly Point[]; shade: number };

export type MotifDrawing = {
  /** The cell at i·repeat[0] + j·repeat[1], every coordinate a whole number of sizes. */
  repeat: readonly [Point, Point];
  /** The finest gap between parallel lines, as a fraction of the size (finishes.16). */
  spacing: number;
  lines: readonly MotifLine[];
  shapes: readonly MotifShape[];
};

/** Lines are 0.60 of the base colour per channel unless a drawing says otherwise. */
const LINE_SHADE = 0.6;

const P = (x: number, y: number): Point => ({ x, y });
const along = (family: LineFamily, a: Point, b: Point): MotifLine => ({ family, a, b, shade: LINE_SHADE });

/**
 * A plank or tile [0,length]×[0,1] in rows along x, row k shifted by k · shift. Each cell draws its bottom and left
 * edges only: every joint of a tiling by rectangles is some tile's bottom or left edge, so each is drawn once.
 */
function rows(length: number, shift: number): MotifDrawing {
  return {
    repeat: [P(length, 0), P(shift, 1)],
    spacing: 1,
    lines: [along("x", P(0, 0), P(length, 0)), along("y", P(0, 0), P(0, 1))],
    shapes: [],
  };
}

/**
 * The classic herringbone of 1 × 5 planks at right angles: the cell at i·(1,1) + m·(5,−5) holds an across plank
 * [0,5]×[0,1] and an upright one [5,6]×[−4,1] whose side meets the across plank's end, so the planks climb in a
 * zigzag along the diagonal. Bottom and left edges of both planks, as in `rows`. At 0° the planks run along x and y.
 */
const HERRINGBONE: MotifDrawing = {
  repeat: [P(1, 1), P(5, -5)],
  spacing: 1,
  lines: [along("x", P(0, 0), P(5, 0)), along("y", P(0, 0), P(0, 1)), along("x", P(5, -4), P(6, -4)), along("y", P(5, -4), P(5, 1))],
  shapes: [],
};

/** A diamond (counter-clockwise) centred on (cx, cy) with half-diagonal r. */
const diamond = (cx: number, cy: number, r: number, shade: number): MotifShape => ({
  points: [P(cx, cy - r), P(cx + r, cy), P(cx, cy + r), P(cx - r, cy)],
  shade,
});

/**
 * Cement tiles, the classic octagon and dot: the square grid, a lighter diamond in each tile (corners inset to
 * 0.15–0.85) and a darker diamond across each grid corner in the joints' shade, so the joints run unseen through it.
 * The corner diamond is drawn once per cell at its origin, so the four tiles meeting there share it.
 */
const CEMENT_TILES: MotifDrawing = { ...rows(1, 0), shapes: [diamond(0.5, 0.5, 0.35, 0.75), diamond(0, 0, 0.25, LINE_SHADE)] };

/** A rectangle [x0,x1]×[y0,y1], counter-clockwise. */
const rect = (x0: number, y0: number, x1: number, y1: number, shade: number): MotifShape => ({ points: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], shade });

/** Lines along x one unit apart, each `run` units long: seams, ribs (surfaces.06). */
const STRIPES = (run: number): MotifDrawing => ({ repeat: [P(run, 0), P(0, 1)], spacing: 1, lines: [along("x", P(0, 0), P(run, 0))], shapes: [] });

/** Board and batten: a batten 1 unit wide every 8, as two lines along x (vertical at its default angle of 90). */
const BOARD_AND_BATTEN: MotifDrawing = {
  repeat: [P(8, 0), P(0, 8)],
  spacing: 1,
  lines: [along("x", P(0, 0), P(8, 0)), along("x", P(0, 1), P(8, 1))],
  shapes: [rect(0, 0, 8, 1, 0.85)],
};

/** Corrugated sheet: a rib line every unit and the trough's shaded half between, in long cells (fewer shapes). */
const CORRUGATED: MotifDrawing = { ...STRIPES(16), shapes: [rect(0, 0.5, 16, 1, 0.85)] };

/** Roof tiles (coppi): square tiles in straight columns, each with its curve's shaded half. */
const ROOF_TILES: MotifDrawing = { ...rows(1, 0), shapes: [rect(0.5, 0, 1, 1, 0.82)] };

export const MOTIF_DRAWINGS: Readonly<Record<MotifId, MotifDrawing>> = {
  planks: rows(6, 2), // planks 6 widths long, each row shifted by a third
  widePlanks: rows(8, 4), // 8 widths long, shifted by half
  herringbone: HERRINGBONE,
  squareTiles: rows(1, 0),
  largeTiles: rows(2, 1), // 1 × 2 with the long side along x, shifted by half
  mosaic: rows(1, 0),
  cementTiles: CEMENT_TILES,
  plain: { repeat: [P(1, 0), P(0, 1)], spacing: 1, lines: [], shapes: [] },
  brick: rows(4, 2), // a brick 4 courses long, running bond
  subwayTiles: rows(2, 1), // 1 × 2, running bond
  boardAndBatten: BOARD_AND_BATTEN,
  shingles: rows(2, 1), // a shingle 2 courses wide, staggered by half
  standingSeam: STRIPES(16),
  corrugated: CORRUGATED,
  roofTiles: ROOF_TILES,
};
