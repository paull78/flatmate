import { emptyDocument, execute, rectangleRoom, relationAt, wallRange, type Command, type Document } from "@fm/domain";
import { floorView } from "../src/view/plan-view";
import { CANVAS_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import { ghostsLayer, wallsLayer } from "../src/view/walls-layer";

// Seeded random floors for the floor oracle (cleanup.04, .14): a 6 × 4 shell with one to four inner walls, which split
// one another and meet the shell at T-joints (+ joints where two cross), some lowered to a half wall, under a 2.50 or
// 2.20 ceiling. Refused commands are skipped, so every drawing is valid.

/** A small seeded generator (mulberry32), as look.test.ts uses. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPS = [0.6, 0.9, 1, 1.1, 1.2, 1.5, 2.03];

/** The drawing for one seed. */
export function randomFloor(seed: number): Document {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] ?? (xs[0] as T);
  const step = (lo: number, hi: number): number => Math.round((lo + r() * (hi - lo)) * 10) / 10;
  let doc = emptyDocument();
  const run = (cmd: Command): void => {
    const next = execute(doc, cmd);
    if (next.ok) doc = next.value.doc;
  };
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 6, 4)) run(cmd);
  run({ type: "setCeiling", height: pick([2.5, 2.5, 2.2]) });
  const inner = 1 + Math.floor(r() * 4);
  for (let i = 0; i < inner; i++) {
    const vertical = r() < 0.5;
    const at = vertical ? step(0.5, 5.5) : step(0.5, 3.5);
    const span = vertical ? 4 : 6;
    const from = r() < 0.7 ? 0 : step(0.5, span / 2);
    const to = r() < 0.7 ? span : step(span / 2 + 0.3, span - 0.5);
    run({ type: "addWall", opId: `w${i}`, from: { at: vertical ? { x: at, y: from } : { x: from, y: at } }, to: { at: vertical ? { x: at, y: to } : { x: to, y: at } } });
  }
  for (const id of Object.keys(doc.walls).sort()) {
    if (r() < 0.35) run({ type: "setWallTop", wallId: id, top: pick(TOPS) });
  }
  return doc;
}

/**
 * Whether one wall reaching the cut takes a joint (mitres.01): an L of a filled and an unfilled wall, not in line, or a
 * T of a filled wall and two unfilled ones in line, of equal thickness. Written from the spec, so the oracle's hashes
 * catch a fill the walls layer draws anywhere else.
 */
export function hasTakenJoint(doc: Document): boolean {
  const level = floorView(doc, null).level;
  const below = (id: string): boolean => {
    const range = wallRange(doc, id);
    const relation = range && relationAt(range, level);
    return relation === "below" || relation === "under";
  };
  const direction = (id: string, joint: string): { x: number; y: number } | null => {
    const w = doc.walls[id];
    const [from, to] = w ? (w.a === joint ? [doc.joints[w.a], doc.joints[w.b]] : [doc.joints[w.b], doc.joints[w.a]]) : [];
    return from && to ? { x: to.x - from.x, y: to.y - from.y } : null;
  };
  const inLine = (a: string, b: string, joint: string): boolean => {
    const [p, q] = [direction(a, joint), direction(b, joint)];
    return p !== null && q !== null && Math.abs(p.x * q.y - p.y * q.x) < 1e-9;
  };
  const walls = Object.values(doc.walls);
  return Object.keys(doc.joints).some((joint) => {
    const at = walls.filter((v) => v.a === joint || v.b === joint);
    const unfilled = at.filter((v) => below(v.id));
    if (at.length - unfilled.length !== 1) return false;
    const [one, two] = unfilled;
    const full = at.find((v) => !below(v.id));
    if (!one || !full) return false;
    if (at.length === 2) return !inLine(one.id, full.id, joint);
    return at.length === 3 && two !== undefined && one.thickness === two.thickness && inLine(one.id, two.id, joint);
  });
}

/**
 * Whether the drawing has a wall below the floor's cut at a joint of three or more walls with two or more filled
 * walls: the one case cleanup.04 changes, left out of the oracle.
 */
export function hasBelowCutShare(doc: Document): boolean {
  const level = floorView(doc, null).level;
  const below = (id: string): boolean => {
    const range = wallRange(doc, id);
    const relation = range && relationAt(range, level);
    return relation === "below" || relation === "under";
  };
  const walls = Object.values(doc.walls);
  return walls.some(
    (w) =>
      below(w.id) &&
      [w.a, w.b].some((joint) => {
        const at = walls.filter((v) => v.a === joint || v.b === joint);
        return at.length >= 3 && at.filter((v) => !below(v.id)).length >= 2;
      }),
  );
}

/** FNV-1a over the floor's walls and ghosts layers, on the canvas and on paper. */
/** The canvas wall's colour when the hashes were stored: they freeze the geometry, and the colour is free to change (smalls.10). */
const FROZEN_WALL = "#1d1d1f";

export function floorHash(doc: Document): string {
  const level = floorView(doc, null).level;
  const text = JSON.stringify([{ ...CANVAS_STYLE, wall: FROZEN_WALL }, PRESENTATION_STYLE].map((style) => [wallsLayer(doc, level, style, "", null, "", null), ghostsLayer(doc, level, style, "", null, "", null)]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
