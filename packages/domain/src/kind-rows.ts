import type { ZoneDefault } from "./use-zone";
import type { StairRule } from "./stairs";
import type { Aggregate } from "./sets";
import type { ObjectOption } from "./options";
import type { Arms } from "./arms";

// The types and row helpers of the kinds table: a leaf, so every row module (kinds.ts, kinds-more.ts) builds its rows
// from here without importing a value from kinds.ts, whose OBJECT_KINDS is built at module evaluation.

/** A footprint's sides; at rotation 0 the front faces −y (smart.08). */
export const SIDE_IDS = ["front", "back", "left", "right"] as const;
export type Side = (typeof SIDE_IDS)[number];
/** Which sides of a placement have a use zone. */
export type Sides = { front: boolean; back: boolean; left: boolean; right: boolean };
/**
 * A named size: one width and one depth per configuration id (smart.11); `seats` on a preset named by its seat count
 * (library.11). `h` and `z`, when given, are each configuration's height and elevation (catalog.07), read through
 * `presetSize` (catalog.17).
 */
export type Preset = {
  id: string; label: string; w: number; d: Readonly<Record<string, number>>; seats?: number;
  h?: Readonly<Record<string, number>>; z?: Readonly<Record<string, OrCeiling>>;
};

/** A height or elevation that is "ceiling" resolves against the ceiling, in queries/vertical.ts only (heights.37). */
export type OrCeiling = number | "ceiling";
/** `h` and `z` are the configuration's default height and elevation (heights.09, .22). */
export type ObjectConfig = { id: string; label: string; w: number; d: number; zone: number | null; h: number; z: OrCeiling };
/** The shape a kind draws inside its footprint (furnish.12, .22): `ell` is the `L` of two arms (catalog.17). */
export type Outline = "rect" | "round" | "quarter" | "corner" | "ell" | "soft" | "pan";
/**
 * `sides` are a new placement's default use zones; a `seat` (its backrest's depth, or null for a piece that isn't a
 * seat: 0 for a stool, which has no backrest, pieces.09) never blocks a zone of a kind you sit at (`sitAt`,
 * smart.19). A `family` is Properties' "Opens into" grouping of built-in units; which kinds a piece may switch to is
 * `canSwitchKind` (furnish.17). `opensInto` names a built-in unit's member in Properties. `semanticClass` is the IFC
 * entity and predefined type, derived and never stored (furnish.19); `outline` the drawn shape (furnish.22). A
 * `retired` kind keeps its row for stored drawings, which still load, draw and edit it, but it has no palette tile and
 * neither MCP nor the Kind field offers it. `zoneDefaults` gives each side's zone when the placement stores none:
 * insets from the side's corners or a centred length, read through `zoneExtent` (furnish.20). Consumers read these
 * columns, never kind ids (arch-review.26). `stair` is a stair kind's rule (stairs.20), null for furniture.
 * `seatsUnder` lists the configurations a seat may tuck under (the tuck rule, seating.14, .16): set exactly for kinds
 * you sit at. `aggregate` is a set's table or desk and where its chairs go (seating.06, .15), null for other kinds.
 * `options` lists the options an object of the kind may have on (library.10, options.ts). `arms` is an `ell` kind's
 * default arms, which a new object copies (catalog.17); null for every other outline. `rug` is what the rug rule asks,
 * through `isRug` (catalog.15). `front` says whether the plan draws its heavier front line (catalog.54): a plant and a
 * rug have no side a person uses. `flue` says the 3D view draws a flue from the piece's top to the ceiling or a deck's
 * underside over it (pieces.04, .08): drawn only, never a solid. `well` is a wheel well's (trailer.07): in every layout as
 * a stair is, free to overlap walls, and coverable by a taller piece that encloses it. `beam` is a beam's (beams.02): in
 * every layout, its ends free to run into walls, its centre in a room, meeting pieces and decks by range.
 */
export type ObjectKind = {
  id: string;
  label: string;
  configs: readonly ObjectConfig[];
  sides: Sides;
  sitAt: boolean;
  seat: number | null;
  presets: readonly Preset[];
  family: Family | null;
  opensInto: string | null;
  semanticClass: string;
  outline: Outline;
  retired: boolean;
  zoneDefaults: Readonly<Record<Side, ZoneDefault>>;
  stair: StairRule | null;
  seatsUnder: readonly string[];
  aggregate: Aggregate | null;
  options: readonly ObjectOption[];
  arms: Arms | null;
  rug: boolean;
  front: boolean;
  flue: boolean;
  well: boolean;
  beam: boolean;
};
export type Family = "builtIn";

/** One worktop height for every kitchen module (spec, "Kinds and default heights"); the corner counter's too. */
export const WORKTOP_HEIGHT = 0.9;

/** One height for what you sit at: the tables and desks, and a built-in's open top, whose stored h is its cabinet's. */
export const SEATED_HEIGHT = 0.75;

/** One "Standard" configuration, on the floor unless given an elevation. */
export const one = (w: number, d: number, zone: number | null, h: number, z: OrCeiling = 0): readonly ObjectConfig[] => [{ id: "standard", label: "Standard", w, d, zone, h, z }];

export const NONE: Sides = { front: false, back: false, left: false, right: false };
export const FRONT: Sides = { ...NONE, front: true };
export const LEFT_RIGHT: Sides = { ...NONE, left: true, right: true };
export const ALL: Sides = { front: true, back: true, left: true, right: true };
export const FULL: ZoneDefault = { start: 0, end: 0 };
/** Every side's zone along its whole length. */
export const FULL_SIDES: Readonly<Record<Side, ZoneDefault>> = { front: FULL, back: FULL, left: FULL, right: FULL };

/**
 * A kind's columns with these default sides (a copy), a rectangle outline, full-side zones and none of the flags,
 * presets or family.
 */
export const plain = (sides: Sides): Pick<ObjectKind, "sides" | "sitAt" | "seat" | "presets" | "family" | "opensInto" | "outline" | "retired" | "zoneDefaults" | "stair" | "seatsUnder" | "aggregate" | "options" | "arms" | "rug" | "front" | "flue" | "well" | "beam"> => ({
  sides: { ...sides }, sitAt: false, seat: null, presets: [], family: null, opensInto: null, outline: "rect", retired: false, zoneDefaults: FULL_SIDES, stair: null, seatsUnder: [], aggregate: null, options: [], arms: null, rug: false, front: true, flue: false, well: false, beam: false,
});
