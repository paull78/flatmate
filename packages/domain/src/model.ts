import type { EntityKey, Point } from "@fm/protocol";
import { OPENING_KINDS, type OpeningKind, type OrCeiling, type Sheer, type Sides } from "./kinds";
import type { ZoneExtents } from "./use-zone";
import type { Finish } from "./finishes";
import type { ObjectOptions } from "./options";
import type { Arms } from "./arms";
import type { Section } from "./section";
import type { Area } from "./area";
import type { Falls, RoofShape } from "./roof-shapes";

export { MIN_SECTION_LENGTH, SECTION_LETTERS, type Section } from "./section";
export { MIN_AREA_SIZE, type Area } from "./area";

export type SizeRange = { readonly min: number; readonly max: number };
/**
 * Size limits by role, in metres (pillars.04, .18): a wall's thickness, a column's width (its centreline's length) and
 * depth (its thickness). Validation and Properties read this table; a column row is never held to a wall's limits.
 */
export const SIZE_LIMITS = {
  wall: { thickness: { min: 0.05, max: 0.5 } },
  column: { width: { min: 0.1, max: 2 }, depth: { min: 0.1, max: 2 } },
} as const satisfies Record<string, Record<string, SizeRange>>;

// Wall thickness in metres, per wall since layout-states.27 (spec: domain); walls stay centre-aligned.
export const DEFAULT_WALL_THICKNESS = 0.2;
export const MIN_WALL_THICKNESS = SIZE_LIMITS.wall.thickness.min;
export const MAX_WALL_THICKNESS = SIZE_LIMITS.wall.thickness.max;
/** A wall row's base when it stands on the floor; otherwise its base is a deck's ID (pillars, spec "Data"). */
export const FLOOR_BASE = "floor";
export const EPS = 0.001; // 1 mm
export const MIN_EDGE = 0.01; // metres
export const MIN_FACE_AREA = 0.01; // m²
export const MIN_DIMENSION = 0.01; // metres; checked by addDimension only, so a corner move is never refused (dims.14)
export const MAX_DIMENSION_OFFSET = 1000; // metres (I15)
export const ANCHOR_TOLERANCE = EPS;

export type Joint = { id: string; x: number; y: number };
/**
 * A wall row's top: "ceiling" for a full wall, which follows the ceiling; a height in metres measured from its base
 * (heights.10, .37); or any other string, a deck's ID, for the deck's underside (a free column only, pillars.23). Deck IDs
 * are `<opId>/k0` and the shape parser refuses a deck row named "ceiling", so the two never mix.
 */
export type WallTop = OrCeiling | string;
/**
 * `base` is FLOOR_BASE or a deck's ID (its top). `queries/vertical.ts`' wallRange alone turns base and top into metres
 * (pillars.19). A row with `column` set is a column (pillars.01): its width is a→b's length, its depth its thickness, and
 * only the column commands change its geometry (pillars.18).
 */
export type Wall = { id: string; a: string; b: string; thickness: number; top: WallTop; base: string; column: boolean } & WallFinishFields;

/**
 * A wall's finishes as stored (surfaces.33): flat optional fields, since the wire takes only flat objects; read and
 * written through `sidesOf` and `withSides` (wall-sides.ts). A band's height is present exactly when its finish is.
 */
export type WallFinishFields = {
  finishLeft?: Finish; lowerLeft?: Finish; lowerLeftHeight?: number;
  finishRight?: Finish; lowerRight?: Finish; lowerRightHeight?: number;
};
/** The stored fields' names, in the order a row lists them. */
export const WALL_FINISH_KEYS = ["finishLeft", "lowerLeft", "lowerLeftHeight", "finishRight", "lowerRight", "lowerRightHeight"] as const;

/** A wall's side, seen from joint a toward joint b (surfaces.03, as for doors). */
export type WallSide = "left" | "right";
/** One side's finish and its lower band up to a height in metres from the side's bottom (surfaces.04). */
export type SideFinish = { finish: Finish | null; lower: { finish: Finish; height: number } | null };
/**
 * A wall's custom finishes as code reads them (surfaces.03, .33, inherit.01), from its stored fields through `sidesOf`:
 * a side null when it isn't custom and shows its room's or the house's (`sideFinishes`). A custom side has a finish.
 */
export type WallSides = { left: SideFinish | null; right: SideFinish | null };

/**
 * Whether a row stands on the floor (pillars.24): rooms, clearance warnings, nearest-obstacle distances and stair edges
 * count only these; fit and the deck rules count every row, by range.
 */
export function isFloorWall(w: Pick<Wall, "base">): boolean {
  return w.base === FLOOR_BASE;
}
/**
 * A room's label: its name and its floor finish, or null (finishes.01), and its walls' default finish and band
 * (inherit.01): the sides facing the room show them unless customised. A room shows its first label's (roomFinish).
 */
export type ZoneLabel = { id: string; at: Point; name: string; finish: Finish | null } & RoomWallFields;
/** A room's walls default as stored (inherit.01), flat like a wall's; read through `roomWallsOf` (wall-defaults.ts). */
export type RoomWallFields = { walls?: Finish; wallsLower?: Finish; wallsLowerHeight?: number };
/** The house's outside walls default as stored on the ceiling row (inherit.07); read through `outsideOf`. */
export type OutsideFields = { outside?: Finish; outsideLower?: Finish; outsideLowerHeight?: number };

// Layout states (spec: layouts). Only objects differ between states; walls, rooms and openings are shared.
export type LayoutState = { id: string; name: string; order: number };
/**
 * One object in every state. Sizes per configuration of its kind (kinds.ts), as flat maps (layout-states.39): width,
 * depth, height and elevation (heights.09); an elevation of "ceiling" hangs the piece against the ceiling (heights.25).
 * A stair kind's object, and only one, has `reaches`: the deck it reaches, or null (stairs.10); while it names a deck,
 * the height is that deck's top less the stair's surface (I19). It also has `startsAt`: the deck at whose edge its
 * steps begin, below its top, or null for its surface (stairs.49); its box and height are unchanged by it. A stair kind
 * with rails has its rails: a flight `handrails`, by side (edges.06), a spiral one `handrail` (guards.28). `options` holds the ones its kind lists that are on, each `true`,
 * the same in every layout; absent when none is on, never `{}` (library.10, options.ts). `linked` is true for a piece
 * that stands in every layout at one position, turn and surface, its configuration, sides and zones its own in each
 * (review.05); absent for an exception, placed per layout, as every stored row before it was (review.11). A kind in every
 * layout (a stair, a well, a beam) never has it.
 */
export type LayoutObject = { linked?: true; riser?: number; handrail?: HandrailKind; handrails?: FlightRails; id: string; kind: string; name: string; w: Record<string, number>; d: Record<string, number>; h: Record<string, number>; z: Record<string, OrCeiling>; reaches?: string | null; startsAt?: string | null; options?: ObjectOptions; arms?: Arms };
/**
 * An object's place in one state: `at` is the middle of the footprint's back edge (layout-states.49); rotation in
 * whole degrees, counter-clockwise about `at`; config is this state's configuration of the object; sides are the
 * sides with a use zone in this state (smart.08); zones are the stored use zones per side, null for the kind's default
 * (furnish.21); deck is the deck it stands on, null for the floor (decks.04).
 */
export type Placement = { id: string; object: string; state: string; at: Point; rotation: number; config: string; sides: Sides; zones: ZoneExtents; deck: string | null };
/**
 * A door or window on a wall, `offset` metres from joint `a` (spec: openings); `sill` and `head` are metres above the
 * wall's bottom (the floor, or its deck's top), a door's or doorway's sill 0 (sills.01).
 */
export type Opening = {
  id: string;
  wall: string;
  kind: OpeningKind;
  offset: number;
  width: number;
  side: "left" | "right";
  hinge: "a" | "b";
  glazed: boolean;
  sill: number;
  head: number;
  sheer?: Sheer; // a window's sheer curtain, absent when none (hangings.04)
  shutterBox?: true; // a window's roller-shutter box above its head, absent when none
};

/**
 * A placed dimension's end (dims.16): anchored to a joint, with the unit direction (tx, ty) from its centre to the face
 * corner the end was placed on ((0, 0) for the centre), or a free point. Flat, as wire entities must be (spec: collaboration).
 */
export type DimensionEnd = { joint: string; tx: number; ty: number } | { x: number; y: number };
/** A placed dimension, shared by every layout (dims.03); `offset` is metres from a→b to the dimension line. */
export type Dimension = { id: string; a: DimensionEnd; b: DimensionEnd; offset: number };

/** A title block field's value (sheet.02): the id is the field's key in PROJECT_FIELDS; an empty field has no row. */
export type ProjectField = { id: string; value: string };

/**
 * The plan underlay (import.16): one row under UNDERLAY_ID. `data` is the picture as base64 JPEG, `width` and `height`
 * its pixels; `at` is the plan point of its top-left corner, and pixel rows run toward −y (import.11). `scaled` is
 * false until a scale command sets `metresPerPixel` (import.13).
 */
export type Underlay = {
  id: string;
  pictureId: string;
  mime: string;
  data: string;
  width: number;
  height: number;
  at: Point;
  metresPerPixel: number;
  scaled: boolean;
};
export const UNDERLAY_ID = "underlay";

/**
 * The studio's logo (sheetset.21): one row under LOGO_ID, as the underlay's, and not a project field, as those enter
 * every MCP reply. `data` is the picture as base64 JPEG and keys its image cache; `width` and `height` are its pixels.
 */
export type Logo = { id: string; data: string; width: number; height: number };
export const LOGO_ID = "logo";

/**
 * A raised floor shared by every layout (decks.03, .12): a w × d rectangle about its centre `at` (not a back-edge anchor
 * like a placement's), turned by `rotation` whole degrees counter-clockwise, with its `top` in metres above the floor.
 * A solid deck fills down to the floor; a hollow one is a fixed-thickness slab under its top.
 */
export type Deck = {
  id: string; name: string; at: Point; w: number; d: number; rotation: number; top: number; solid: boolean; finish: Finish | null;
  guardFront: GuardValue; guardRight: GuardValue; guardBack: GuardValue; guardLeft: GuardValue;
};

/** What a guard can be (guards.02). */
export const GUARDS = ["railing", "glass", "none"] as const;
export type Guard = (typeof GUARDS)[number];
/** A deck higher than this starts with a guard: 30 inches, a default, never a compliance claim (guards.03). */
export const GUARD_DROP = 0.76;
export function isGuard(v: unknown): v is Guard {
  return GUARDS.some((g) => g === v);
}
/** The guard a deck with this top starts with. */
export function guardFor(top: number): Guard {
  return top > GUARD_DROP ? "railing" : "none";
}

/**
 * One side's or one hole's guard (edges.02): a kind and a height above the deck's top. A None guard keeps its height, so
 * switching it back restores it. A flat object of primitives, as the wire carries (library.17, edges.08).
 */
export type GuardValue = { kind: Guard; height: number };
/** A guard's default height above its deck, and its range: defaults, never compliance claims (guards.04, edges.02). */
export const GUARD_HEIGHT = 1;
export const MIN_GUARD_HEIGHT = 0.3;
export const MAX_GUARD_HEIGHT = 1.1;
export function isGuardHeight(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_GUARD_HEIGHT - 1e-9 && v <= MAX_GUARD_HEIGHT + 1e-9; // stored to the mm
}
/** What a command may change of a guard: its kind, its height, or both; the rest is kept. */
export type GuardPatch = { kind?: Guard; height?: number };
/** A guard value of this kind at the default height. */
export function guardValue(kind: Guard): GuardValue {
  return { kind, height: GUARD_HEIGHT };
}

/**
 * A deck's four sides in its own frame (edges.01): front faces −y at rotation 0, as a piece's front does, then
 * counter-clockwise right (+x), back (+y), left (−x). People see them by where they face on the plan (edges.05).
 */
export const DECK_SIDES = ["front", "right", "back", "left"] as const;
export type DeckSide = (typeof DECK_SIDES)[number];
const SIDE_FIELDS = { front: "guardFront", right: "guardRight", back: "guardBack", left: "guardLeft" } as const;
export type DeckGuardField = (typeof SIDE_FIELDS)[DeckSide];
/** The deck field that stores a side's guard. */
export function sideField(side: DeckSide): DeckGuardField {
  return SIDE_FIELDS[side];
}
/** All four sides' fields with the same guard, at the default height: a new deck's, or an older row's one guard. */
export function sameGuards(kind: Guard): Pick<Deck, DeckGuardField> {
  return { guardFront: guardValue(kind), guardRight: guardValue(kind), guardBack: guardValue(kind), guardLeft: guardValue(kind) };
}

/** What a stair's rails are (guards.28): chosen once and kept; None draws none (edges.06). */
export const HANDRAILS = ["railing", "glass", "none"] as const;
export type HandrailKind = (typeof HANDRAILS)[number];
export function isHandrailKind(v: unknown): v is HandrailKind {
  return HANDRAILS.some((h) => h === v);
}
/** A flight's rails by side, as you walk up (edges.06): each its own kind. A flat object of primitives, as the wire carries. */
export type FlightRails = { left: HandrailKind; right: HandrailKind };
export function sameRails(kind: HandrailKind): FlightRails {
  return { left: kind, right: kind };
}

/** The handrail a stair reaching a deck with `guard` starts with: Glass on a Glass deck, else Railing (None too); Railing reaching none (null). */
export function handrailFor(guard: Guard | null): HandrailKind {
  return guard === "glass" ? "glass" : "railing";
}

/**
 * A rectangular hole cut through a deck (stairwell.02, .14, .20): its centre `at` in plan coordinates and its sides
 * `w` and `d` along the deck's own axes, so it turns with its deck. Read through `deckViews`, never this table
 * (stairwell.15); "Hole" in the UI, `deckHoles` here, since a room's `Hole` is another thing.
 */
export type DeckHole = { id: string; deck: string; at: Point; w: number; d: number; guard: GuardValue }; // one guard for all its sides (edges.01)

/** The flat ceiling (heights.11, .28): at most one row, read only through queries/vertical.ts; no row reads as 2.50 m. */
/**
 * The one ceiling row (heights.28). `height` is the flat ceiling, or a slope's low side; a shed or gable adds its pitch in
 * degrees, the side it falls toward and its overhang (roofs.03, .08, .15). Rows saved before the roofs cycle have only
 * `height` and read as flat (roofs.20): read the roof through `roofOf`.
 */
export type Ceiling = {
  id: string;
  height: number;
  shape?: RoofShape;
  pitch?: number;
  falls?: Falls;
  overhang?: number;
  /** The roof's covering (surfaces step 11): kept while the ceiling is flat, drawn only under a shed or gable. */
  covering?: Finish;
} & OutsideFields; // the ceiling row is the house's one row: it also holds the outside walls' default (inherit.07)
// Here, not in ceiling.ts, because ceiling.ts reads queries/vertical.ts, which needs them (no import cycles).
export const CEILING_ID = "ceiling";
export const DEFAULT_CEILING = 2.5; // metres (heights.11)
export const PROVISIONAL_METRES_PER_PIXEL = 0.01;
export const UNDERLAY_MIME = "image/jpeg";

/** A sheet's scales, the N of 1:N (sheetset.09): a reader measures with a ruler of fixed ratios, so no free values. */
export const SHEET_SCALES = [20, 25, 50, 75, 100, 200] as const;
export const SCALE_REFUSAL = "Scale must be 1:20, 1:25, 1:50, 1:75, 1:100 or 1:200";
/** A set's papers (sheetset.03), in the order they're offered. Their sizes are the editor's: only paper needs them. */
export const PAPER_NAMES = ["A4", "A3", "A2", "A1", "Letter"] as const;
export type PaperName = (typeof PAPER_NAMES)[number];
export const MAX_SHEET_TEXT = 20000; // characters (spec "The report page")
export const SHEET_KINDS = ["plan", "compare", "cover", "report", "section"] as const;
export const SHEET_SPLITS = ["auto", "stacked", "sideBySide"] as const; // a compare sheet's panes (sheetset.12)
export const SHEET_SIZES = ["small", "normal", "large"] as const; // a report's body text
export type SheetKind = (typeof SHEET_KINDS)[number];
export type SheetSplit = (typeof SHEET_SPLITS)[number];
export type SheetSize = (typeof SHEET_SIZES)[number];
/** One drawing on a sheet: a layout at a deck's level, or at the floor (null). `levelOf` turns the deck into a level. */
export type SheetDrawing = { layout: string; deck: string | null };
/**
 * A sheet's 1 to 4 drawings, flat as the wire requires (library.17): layout `l<i>`, deck `d<i>`, in order with no gaps.
 * Read through `sheetDrawings`.
 */
export type SheetDrawings = { l0: string | null; d0: string | null; l1: string | null; d1: string | null; l2: string | null; d2: string | null; l3: string | null; d3: string | null };
/**
 * One page or, for a report, one flow of pages (sheetset.01, .11, .12). `scale` is the N of 1:N, or null to follow the
 * set's general scale; `cx`, `cy` the framing offset in metres from the drawing's centre, so it survives a scale change;
 * `text` and `size` a report's; `section` the letter a Section sheet draws, null on every other kind (section.10). Listed
 * through `sheetsOf` alone: no rows means the automatic list (sheetset.02).
 */
export type Sheet = { id: string; kind: SheetKind; order: number; inPdf: boolean; title: string; scale: number | null; split: SheetSplit; cx: number; cy: number; finishes: boolean; marks: boolean; drawings: SheetDrawings; text: string; size: SheetSize; section: string | null };

export const SHEET_SLOTS = [["l0", "d0"], ["l1", "d1"], ["l2", "d2"], ["l3", "d3"]] as const;

/** A sheet's drawings as a list, in order. */
export function sheetDrawings(sheet: Pick<Sheet, "drawings">): SheetDrawing[] {
  return SHEET_SLOTS.flatMap(([l, d]) => {
    const layout = sheet.drawings[l];
    return layout === null ? [] : [{ layout, deck: sheet.drawings[d] }];
  });
}

/** A list of at most SHEET_SLOTS' length as a row's flat drawings; any more are dropped, so callers check the count first. */
export function flatDrawings(list: readonly SheetDrawing[]): SheetDrawings {
  const out: SheetDrawings = { l0: null, d0: null, l1: null, d1: null, l2: null, d2: null, l3: null, d3: null };
  SHEET_SLOTS.forEach(([l, d], i) => {
    const drawing = list[i];
    if (drawing) {
      out[l] = drawing.layout;
      out[d] = drawing.deck;
    }
  });
  return out;
}

export function isOpeningWidth(kind: OpeningKind, width: number): boolean {
  const r = OPENING_KINDS[kind].width;
  return Number.isFinite(width) && width >= r.min && width <= r.max;
}

/** "Door" or "Window", for messages (the kind's noun). */
export function openingLabel(kind: OpeningKind): string {
  return OPENING_KINDS[kind].noun;
}

export type Document = {
  joints: Record<string, Joint>;
  walls: Record<string, Wall>;
  zoneLabels: Record<string, ZoneLabel>;
  decks: Record<string, Deck>;
  deckHoles: Record<string, DeckHole>;
  states: Record<string, LayoutState>;
  objects: Record<string, LayoutObject>;
  placements: Record<string, Placement>;
  openings: Record<string, Opening>;
  dimensions: Record<string, Dimension>;
  projectFields: Record<string, ProjectField>;
  underlays: Record<string, Underlay>;
  logos: Record<string, Logo>;
  ceilings: Record<string, Ceiling>;
  sheets: Record<string, Sheet>;
  sections: Record<string, Section>;
  areas: Record<string, Area>;
};

/** Every document starts with this state; the 2 → 3 migration adds the same one (layout-states.39). */
export const FIRST_STATE: LayoutState = { id: "s0", name: "Layout", order: 0 };
export type EntityRef = EntityKey;

export function isWallThickness(t: number): boolean {
  return Number.isFinite(t) && t >= MIN_WALL_THICKNESS && t <= MAX_WALL_THICKNESS;
}

/** Whether a size lies in a range, within `tol` (a column's turned joints are rounded to the millimetre). */
export function inSizeRange(v: number, range: SizeRange, tol = 0): boolean {
  return Number.isFinite(v) && v >= range.min - tol && v <= range.max + tol;
}

/** A copy of every table with the entities shared, for a change to write into (patches) or to hand out (storage). */
export function copyTables(doc: Document): Document {
  return {
    joints: { ...doc.joints },
    walls: { ...doc.walls },
    zoneLabels: { ...doc.zoneLabels },
    decks: { ...doc.decks },
    deckHoles: { ...doc.deckHoles },
    states: { ...doc.states },
    objects: { ...doc.objects },
    placements: { ...doc.placements },
    openings: { ...doc.openings },
    dimensions: { ...doc.dimensions },
    projectFields: { ...doc.projectFields },
    underlays: { ...doc.underlays },
    logos: { ...doc.logos },
    ceilings: { ...doc.ceilings },
    sheets: { ...doc.sheets },
    sections: { ...doc.sections },
    areas: { ...doc.areas },
  };
}

export function emptyDocument(): Document {
  return {
    joints: {},
    walls: {},
    zoneLabels: {},
    decks: {},
    deckHoles: {},
    states: { [FIRST_STATE.id]: { ...FIRST_STATE } },
    objects: {},
    placements: {},
    openings: {},
    dimensions: {},
    projectFields: {},
    underlays: {},
    logos: {},
    ceilings: {},
    sheets: {},
    sections: {},
    areas: {},
  };
}
