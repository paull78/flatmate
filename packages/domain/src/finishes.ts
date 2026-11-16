import { isRecord } from "@fm/protocol";
import { shown } from "./format";
import type { Document } from "./model";
import type { Zone } from "./queries/zones";
import { hasExactKeys, isFiniteNumber } from "./shape";

// Floor finishes (finishes.20): the one owner of the motif rules, the check the label invariant uses, the
// motif-change rule, and which label's finish a room shows. How a motif draws is the editor's (finishes.07).

/** The motifs, in the order the palette and Properties offer them; MCP builds its enum from it. */
export const MOTIF_IDS = ["planks", "widePlanks", "herringbone", "squareTiles", "largeTiles", "mosaic", "cementTiles", "plain", "brick", "subwayTiles", "boardAndBatten", "shingles", "standingSeam", "corrugated", "roofTiles"] as const;
export type MotifId = (typeof MOTIF_IDS)[number];

/**
 * A room's floor finish, on its label (finishes.01, .14). `motif` is a string as stored, like an object's kind: I8
 * checks it names a motif (finishProblem). `colour` is "#rrggbb" in lower case; `strength` a whole percent; `size`
 * metres in whole millimetres (what it measures depends on the motif); `angle` whole degrees 0–179.
 */
export type Finish = { motif: string; colour: string; strength: number; size: number; angle: number };

/** What a finish covers (surfaces.03): a room's or a deck's floor, a wall's side, the roof. */
export const SURFACES = ["floor", "wall", "roof"] as const;
export type Surface = (typeof SURFACES)[number];

type MotifRules = {
  name: string; // in the palette, Properties and the rooms table
  surfaces: readonly Surface[]; // the surfaces it suits: pickers and Claude offer it only there (surfaces.03)
  size: { min: number; max: number; default: number }; // metres; plain has none (all 0)
  colour: string; // the default base colour
  strength: number; // the default strength, percent
  angle: number; // the default angle, degrees
};

const FLOOR: readonly Surface[] = ["floor"];
const FLOOR_WALL: readonly Surface[] = ["floor", "wall"];
const WALL: readonly Surface[] = ["wall"];
const WALL_ROOF: readonly Surface[] = ["wall", "roof"];
const ROOF: readonly Surface[] = ["roof"];

/** One row per motif (the spec's motifs table). */
export const MOTIFS: Readonly<Record<MotifId, MotifRules>> = {
  planks: { name: "Planks", surfaces: FLOOR_WALL, size: { min: 0.1, max: 0.4, default: 0.2 }, colour: "#c8a27a", strength: 45, angle: 0 },
  widePlanks: { name: "Wide planks", surfaces: FLOOR_WALL, size: { min: 0.2, max: 0.4, default: 0.3 }, colour: "#d8bc94", strength: 40, angle: 0 },
  herringbone: { name: "Herringbone", surfaces: FLOOR, size: { min: 0.05, max: 0.2, default: 0.09 }, colour: "#c8a27a", strength: 50, angle: 45 }, // the zigzag runs along x, as herringbone is usually laid (finishes.30),
  squareTiles: { name: "Square tiles", surfaces: FLOOR_WALL, size: { min: 0.1, max: 0.6, default: 0.3 }, colour: "#e8e4dc", strength: 55, angle: 0 },
  largeTiles: { name: "Large tiles", surfaces: FLOOR_WALL, size: { min: 0.3, max: 0.75, default: 0.6 }, colour: "#cfcbc4", strength: 45, angle: 0 },
  mosaic: { name: "Mosaic", surfaces: FLOOR_WALL, size: { min: 0.02, max: 0.05, default: 0.025 }, colour: "#a9c9d6", strength: 50, angle: 0 },
  cementTiles: { name: "Cement tiles", surfaces: FLOOR, size: { min: 0.15, max: 0.4, default: 0.2 }, colour: "#e3d9c6", strength: 70, angle: 0 },
  plain: { name: "Plain", surfaces: FLOOR_WALL, size: { min: 0, max: 0, default: 0 }, colour: "#e6e3dd", strength: 0, angle: 0 },
  // Walls and the roof (surfaces.06). Sizes are a whole unit of each drawing (finishes.18): a brick's and a subway tile's
  // course, a batten's width, a shingle's course, a seam's and a rib's spacing, a roof tile's side.
  brick: { name: "Brick", surfaces: WALL, size: { min: 0.05, max: 0.1, default: 0.065 }, colour: "#b5654a", strength: 50, angle: 0 },
  subwayTiles: { name: "Subway tiles", surfaces: WALL, size: { min: 0.05, max: 0.15, default: 0.075 }, colour: "#f1efea", strength: 40, angle: 0 },
  boardAndBatten: { name: "Board and batten", surfaces: WALL, size: { min: 0.03, max: 0.1, default: 0.05 }, colour: "#7d8a80", strength: 60, angle: 90 },
  shingles: { name: "Shingles", surfaces: WALL_ROOF, size: { min: 0.1, max: 0.25, default: 0.13 }, colour: "#8a6f55", strength: 55, angle: 0 },
  standingSeam: { name: "Standing seam", surfaces: WALL_ROOF, size: { min: 0.3, max: 0.6, default: 0.45 }, colour: "#4a4f54", strength: 60, angle: 90 },
  corrugated: { name: "Corrugated", surfaces: WALL_ROOF, size: { min: 0.05, max: 0.15, default: 0.076 }, colour: "#9aa1a6", strength: 40, angle: 90 },
  roofTiles: { name: "Roof tiles", surfaces: ROOF, size: { min: 0.15, max: 0.4, default: 0.25 }, colour: "#b4562f", strength: 55, angle: 0 },
};

export function isMotifId(v: unknown): v is MotifId {
  return MOTIF_IDS.some((m) => m === v);
}

/** Whether the motif suits the surface (surfaces.03). */
export function suits(motif: MotifId, surface: Surface): boolean {
  return MOTIFS[motif].surfaces.includes(surface);
}

/** The motifs that suit a surface, in the table's order: what its pickers and Claude offer. */
export function motifsFor(surface: Surface): MotifId[] {
  return MOTIF_IDS.filter((m) => suits(m, surface));
}

/** A new finish of the motif with all its defaults (the palette's Floor mode, finishes.19). */
export function motifDefaults(motif: MotifId): Finish {
  const m = MOTIFS[motif];
  return { motif, colour: m.colour, strength: m.strength, size: m.size.default, angle: m.angle };
}

/** Whole units of 1/per metre within float noise (0.07 * 100 is 7.000000000000001). */
const whole = (v: number, per: number): boolean => Math.abs(Math.round(v * per) - v * per) < 1e-9;
const wholeIn = (v: number, max: number): boolean => Number.isInteger(v) && v >= 0 && v <= max;

/** The decimals a motif's sizes show with: three where its sizes need millimetres (mosaic: "0.025"), else two. */
export function sizeDigits(motif: MotifId): number {
  const { min, max, default: d } = MOTIFS[motif].size;
  return [min, max, d].every((v) => whole(v, 100)) ? 2 : 3;
}

/** A finish field and the rule it breaks ("must be 0.10–0.40"): people read it with the field's name, Claude with its path. */
export type FinishIssue = { field: "motif" | "colour" | "strength" | "size" | "angle"; rule: string };

/**
 * The finish's first broken rule on its surface (finishes.17, surfaces.03), or null; the editor's toast builds on it,
 * not on a message (R-09).
 */
export function finishIssue(f: Finish, surface: Surface): FinishIssue | null {
  if (!isMotifId(f.motif)) return { field: "motif", rule: `must be one of ${MOTIF_IDS.join(", ")}` };
  if (!suits(f.motif, surface)) return { field: "motif", rule: `must be a ${surface} motif: ${motifsFor(surface).join(", ")}` };
  if (!/^#[0-9a-f]{6}$/.test(f.colour)) return { field: "colour", rule: "must be #rrggbb" };
  if (!wholeIn(f.strength, 100)) return { field: "strength", rule: "must be a whole percent 0–100" };
  const { min, max } = MOTIFS[f.motif].size;
  if (!isFiniteNumber(f.size) || !whole(f.size, 1000)) return { field: "size", rule: "must be whole millimetres" };
  const mm = Math.round(f.size * 1000);
  if (mm < Math.round(min * 1000) || mm > Math.round(max * 1000)) {
    const digits = sizeDigits(f.motif);
    return { field: "size", rule: max === 0 ? `must be 0 for ${f.motif}` : `must be ${shown(min, digits)}–${shown(max, digits)}` };
  }
  if (!wholeIn(f.angle, 179)) return { field: "angle", rule: "must be whole degrees 0–179" };
  return null;
}

/** The finish's first broken rule naming the field's path ("finish.size must be 0.10–0.40"), or null (I8, finishes.17). */
export function finishProblem(f: Finish, surface: Surface): string | null {
  const issue = finishIssue(f, surface);
  return issue ? `finish.${issue.field} ${issue.rule}` : null;
}

/**
 * A given colour as stored: "#" added to six bare hex digits, lower case (finishes.40, .48). The one place a given
 * colour is normalised; a stored row never is (I8 refuses upper case).
 */
export function givenColour(colour: string): string {
  return (/^[0-9a-f]{6}$/i.test(colour) ? `#${colour}` : colour).toLowerCase();
}

/**
 * The one motif-change rule for Properties and MCP (finishes.37): keep the colour and the direction the floor runs
 * (the angle's offset from the old motif's default, laid on the new one's) and take the new motif's size and strength;
 * from no finish, the motif's defaults. An unknown stored motif counts as default angle 0.
 */
export function withMotif(prev: Finish | null, motif: MotifId): Finish {
  const next = motifDefaults(motif);
  if (!prev) return next;
  const from = isMotifId(prev.motif) ? MOTIFS[prev.motif].angle : 0;
  return { ...next, colour: prev.colour, angle: mod180(prev.angle - from + next.angle) };
}

const mod180 = (deg: number): number => ((deg % 180) + 180) % 180;

/** Shape only (finishes.17): exactly the five keys, each a string or a finite number as typed, as a fresh object. */
export function parseFinish(v: unknown): Finish | null {
  if (!isRecord(v) || !hasExactKeys(v, ["motif", "colour", "strength", "size", "angle"])) return null;
  const { motif, colour, strength, size, angle } = v;
  if (typeof motif !== "string" || typeof colour !== "string") return null;
  return isFiniteNumber(strength) && isFiniteNumber(size) && isFiniteNumber(angle) ? { motif, colour, strength, size, angle } : null;
}

/** A label's or a deck's `finish`: null when missing or null (finishes.24), else the finish, or undefined when malformed. */
export function rowFinish(v: Record<string, unknown>): Finish | null | undefined {
  const raw = Object.hasOwn(v, "finish") ? v.finish : null;
  return raw === null ? null : parseFinish(raw) ?? undefined;
}

/** Whether two finishes are the same, field by field (null for none). */
export function sameFinish(a: Finish | null, b: Finish | null): boolean {
  if (!a || !b) return a === b;
  return a.motif === b.motif && a.colour === b.colour && a.strength === b.strength && a.size === b.size && a.angle === b.angle;
}

/** The room's first label by ID, in string order (finishes.15): the one whose name and finish it shows; null unlabelled. */
export function firstLabelId(zone: Zone): string | null {
  return zone.labelIds[0] ?? null; // zones() lists them sorted
}

/** The finish a room shows: its first label's (finishes.15); null without a label or a finish. */
export function roomFinish(doc: Document, zone: Zone): Finish | null {
  const first = firstLabelId(zone);
  return first === null ? null : (doc.zoneLabels[first]?.finish ?? null);
}

/** The Zone tool's name for a new label: the first "Room N" (N from 1) no label has, orphans included (finishes.49). */
export function nextRoomName(doc: Document): string {
  const taken = new Set(Object.values(doc.zoneLabels).map((l) => l.name));
  let n = 1;
  while (taken.has(`Room ${n}`)) n++;
  return `Room ${n}`;
}
