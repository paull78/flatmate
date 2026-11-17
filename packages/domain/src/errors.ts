import { MAX_GOING, MAX_TARGET_RISER, MIN_GOING, MIN_TARGET_RISER } from "./stairs";
import { assertNever, type EntityKey } from "@fm/protocol";
import { MAX_OBJECT_SIZE, MIN_HEIGHT, MIN_OBJECT_SIZE } from "./kinds";
import { MAX_WALL_THICKNESS, MIN_AREA_SIZE, MIN_SECTION_LENGTH, MIN_WALL_THICKNESS, SIZE_LIMITS, type SizeRange } from "./model";
import { MAX_DECK_TOP, MIN_DECK_SIZE, MIN_DECK_TOP } from "./presets";
import { metres, shown } from "./format";
import { MIN_ARM } from "./arms";

export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8" | "I9" | "I10" | "I11" | "I12" | "I13" | "I14" | "I15" | "I16" | "I17" | "I18" | "I19" | "I20" | "I21" | "I22" | "I23" | "I24" | "I25" | "I26";
/** `plain`: the same refusal in plain words for people, where `message` names IDs for Claude (pillars.39, ux-polish.36). */
export type Violation = { invariant: InvariantId; message: string; entities: EntityKey[]; plain?: string };
type DomainErrorKind =
  | "notFound" | "invalidInput" | "overlap" | "crossing" | "tooShort" | "topology" | "invalid" | "notInRoom" | "format";
export type DomainError = { kind: DomainErrorKind; message: string; violations: Violation[] };

// User-facing toast texts (spec: warnings).
export const MESSAGES = {
  tooShort: "Wall too short",
  crossing: "Walls can't cross",
  overlap: "Walls can't overlap",
  jointsMerge: "Joints can't overlap",
  splitTooShort: "Intersection would create a wall shorter than 1 cm",
  splitShort: "Split would leave a wall shorter than 1 cm", // splitWall (straight step 12)
  notInRoom: "The point is in no room", // the Room tool never sends one (it does nothing outside a room); MCP reads this
  invalid: "Invalid drawing",
  removed: "This edit needs something that was just removed", // I9: a row naming one that is gone, after a race (decks.52)
  thickness: `Wall thickness must be between ${metres(MIN_WALL_THICKNESS)} and ${metres(MAX_WALL_THICKNESS)} m`,
  fit: "Furniture would not fit",
  objectSize: `Size must be between ${metres(MIN_OBJECT_SIZE)} and ${metres(MAX_OBJECT_SIZE)} m`,
  objectHeight: `Height must be between ${metres(MIN_HEIGHT)} and ${metres(MAX_OBJECT_SIZE)} m`, // catalog.22
  fixedHeight: "This kind can't be placed at another height", // placeObject's `h` (clarity.11)
  elevation: `Elevation must be 0 to ${metres(MAX_OBJECT_SIZE)} m, or the ceiling`,
  noArms: "Only a corner piece has arms",
  arms: `An arm must be ${metres(MIN_ARM)} m or more and ${metres(MIN_ARM)} m shallower than the side it runs across`, // an `L` piece's (catalog.12)
  opening: "Doors and windows must fit their wall",
  projectField: "Project fields must fit their limits",
  dimensionAnchor: "A dimension needs this corner",
  underlay: "The underlay picture can't be stored",
  logo: "The logo picture can't be stored",
  // Named areas (I26, areas.09): a refusal names the other area, as the one being edited overlaps it.
  areas: "Named areas can't overlap", // a server rejection carries no names
  areaSize: `A named area is at least ${metres(MIN_AREA_SIZE)} m a side`,
  areasOverlap: (a: string, b: string): string => `${a} and ${b} overlap`,
  overlapsArea: (other: string): string => `Overlaps ${other}`,
  areaOutsideRoom: "Draw an area inside a room",
  // Sections (I25, section.09).
  section: "This section can't be stored", // a server rejection carries no names
  sectionLine: `A section's line must be at least ${metres(MIN_SECTION_LENGTH)} m`,
  sectionDepth: "A section's depth can't be negative",
  sectionLetter: "A section's letter is one capital, A to Z",
  sectionsFull: "Every letter from A to Z has a section",
  heights: "Heights must fit under the ceiling",
  // Decks (I18, spec "The deck").
  deck: "A deck would not fit", // a server rejection carries no names
  deckSizes: `Deck sizes must be at least ${metres(MIN_DECK_SIZE)} m, tops ${metres(MIN_DECK_TOP)} to ${metres(MAX_DECK_TOP)} m`,
  deckOutside: (deck: string): string => `${deck} must lie over the building`,
  decksOverlap: (a: string, b: string): string => `${a} and ${b} overlap`,
  deckCarries: (deck: string, piece: string, state: string): string => `${deck} carries ${piece} in ${state}; move it off first`,
  outsideDeck: (piece: string, deck: string, state: string): string => `${piece} lies outside ${deck} in ${state}`,
  floorOnly: (piece: string, deck: string, state: string): string => `${piece} stands on the floor only, not on ${deck}, in ${state}`, // a wheel well (surroundings.md)
  overHole: (piece: string, deck: string, state: string): string => `${piece} stands over a hole in ${deck} in ${state}`,
  // Overhanging a platform (steps.06, .11): the centre, the reach and the room, in that order.
  winderDepth: "A winder stair is deeper than it is wide, by 0.05 m at least", // I19 (steps.09)
  deckCentre: (piece: string, deck: string, state: string): string => `${piece}'s centre is off ${deck} in ${state}`,
  deckReach: (piece: string, deck: string, state: string): string => `${piece} reaches more than 0.30 m past ${deck} in ${state}`,
  deckRoom: (piece: string, deck: string, state: string): string => `${piece} overhangs out of its room in ${state}`,
  // Holes in decks (I22, stairwell.04, .14).
  hole: "A hole would not fit", // a server rejection carries no names
  holeSizes: `A hole is at least ${metres(MIN_DECK_SIZE)} × ${metres(MIN_DECK_SIZE)} m`,
  holeOutside: (deck: string): string => `A hole in ${deck} lies inside it`,
  holesOverlap: (deck: string): string => `Two holes in ${deck} overlap`,
  holeNoDeck: "A hole is cut in a deck",
  // Columns (I20, pillars.04, .21).
  column: `A column stands free or in a wall's line, ${sizeRange(SIZE_LIMITS.column.width)} m wide and deep`,
  columnInRoom: "A column stands inside a room",
  columnHalves: "A column needs at least 1 cm of wall on each side",
  columnTurnsWithWall: "A column in a wall's line turns with its wall",
  columnTouches: (column: string, wall: string): string => `Column ${column} touches wall ${wall}`,
  columnTouchesPlain: "This column touches a wall",
  // The lock (pillars.18, .22): a wall command that would change a column, or a joint a column touches.
  columnLocked: (id: string): string => `Column ${id} can't be edited as a wall; edit its position, width and depth`,
  columnLockedPlain: "A column can't be edited as a wall; edit its position, width and depth",
  // Bases and tops (I21, pillars.05, .23).
  rows: "Walls and columns stand on the floor or on a loft, inside it",
  columnOnDeck: (deck: string): string => `A column on ${deck} stands inside ${deck}`,
  columnKeepsWall: "A column in a wall's line keeps its wall's base and top",
  oneBasePerJoint: "Walls meeting at a joint stand on one base",
  onlyColumnsReachDecks: "Only a free column on the floor reaches up to a deck",
  // The deck lock (pillars.23): a deck a row references keeps its place, size and turn.
  deckHolds: (row: string, deck: string, top: boolean): string => `${row} ${top ? "reaches up to" : "stands on"} ${deck}; move it first`,
  // Stairs (I19, stairs.10).
  onlyStairsReach: "Only a stair reaches a deck",
  onlyStairsStep: "Only a stair has a riser and a going",
  targetRiser: `A riser must be between ${metres(MIN_TARGET_RISER)} and ${metres(MAX_TARGET_RISER)}`,
  stairGoing: `A going must be between ${metres(MIN_GOING)} and ${metres(MAX_GOING)}`,
  spiralGoing: "A spiral stair has no run to set a going on",
  handrail: "Invalid handrail: railing, glass or none",
  spiralSides: "A spiral stair has one handrail",
  noHandrail: (kind: string): string => `${kind} has no handrail`,
} as const;

/**
 * Why there is no stair on a deck's edge at a point (stairdraw.20): the point isn't within 1 cm of an edge a stair can
 * go up to, the kind isn't a stair, the kind doesn't make an L (stairdraw.09), or the rise is too low for an L's two
 * flights of two risers each. The editor, MCP and the toast only word it, with the kind's label.
 */
export type StairEdgeRefusal = "notOnEdge" | "kindNotStair" | "doesNotTurn" | "tooLowToTurn";

export const STAIR_EDGE_MESSAGES: Readonly<Record<StairEdgeRefusal, (kindLabel: string) => string>> = {
  notOnEdge: () => "Not on an edge a stair can go up to",
  kindNotStair: () => "Only a stair or a ladder goes up to a deck",
  doesNotTurn: (kindLabel) => `${kindLabel} doesn't turn`,
  tooLowToTurn: () => "Too low for an L: each flight needs two risers",
};

/** A wall row in a refusal: "Column C1" or "Wall W1" for Claude, and "column" or "wall" for people's "A column …". */
export function rowWords(id: string, column: boolean): { name: string; kind: "column" | "wall" } {
  return column ? { name: `Column ${id}`, kind: "column" } : { name: `Wall ${id}`, kind: "wall" };
}

/** A size range in a message, as the column refusals show it: "0.10–2.00". */
export function sizeRange(range: SizeRange): string {
  return `${metres(range.min)}–${metres(range.max)}`;
}

export function domainError(kind: DomainErrorKind, message: string, violations: Violation[] = []): DomainError {
  return { kind, message, violations };
}

// The toast for a move or resize whose result breaks an invariant (spec: walls-rooms). A fit violation (I10, I11) names
// the object and the state, an opening violation (I12) the opening and a project field violation (I14) the field, so
// their own message is the toast (spec: layouts, openings; sheet.05).
export function topologyMessage(violations: Violation[]): string {
  const named = namedViolation(violations);
  if (named) return named.message;
  if (violations.some((v) => v.invariant === "I8" && v.plain === MESSAGES.arms)) return MESSAGES.arms; // a row check, worded (catalog.26)
  return invariantsMessage(new Set(violations.map((v) => v.invariant))) ?? MESSAGES.invalid;
}

/**
 * The violation a refusal is named after: the first fit, opening, project field, height, deck, stair, column or base
 * and top, hole, section or named area violation (I10, I11, I12, I14, I17, I18, I19, I20, I21, I22, I25, I26), or null.
 */
export function namedViolation(violations: readonly Violation[]): Violation | null {
  const named: readonly InvariantId[] = ["I10", "I11", "I12", "I14", "I17", "I18", "I19", "I20", "I21", "I22", "I25", "I26"];
  return violations.find((v) => named.includes(v.invariant)) ?? null;
}

/**
 * The toast for a set of broken invariants, or null when none has one.
 * Takes plain strings so the editor can map ids parsed from a server rejection ("I5: walls cross").
 */
export function invariantsMessage(ids: ReadonlySet<string>): string | null {
  if (ids.has("I4")) return MESSAGES.jointsMerge; // first: a joint on a joint also lies on both walls there (straight.18)
  if (ids.has("I5") || ids.has("I6") || ids.has("I7")) return MESSAGES.crossing;
  if (ids.has("I2")) return MESSAGES.tooShort;
  if (ids.has("I13")) return MESSAGES.thickness;
  if (ids.has("I10") || ids.has("I11")) return MESSAGES.fit; // a server rejection carries no names
  if (ids.has("I12")) return MESSAGES.opening;
  if (ids.has("I14")) return MESSAGES.projectField;
  if (ids.has("I15")) return MESSAGES.dimensionAnchor; // its violation names the dimension by ID, for MCP and logs (dims.29)
  if (ids.has("I16")) return MESSAGES.underlay;
  if (ids.has("I24")) return MESSAGES.logo;
  if (ids.has("I25")) return MESSAGES.section;
  if (ids.has("I26")) return MESSAGES.areas;
  if (ids.has("I17")) return MESSAGES.heights;
  if (ids.has("I18")) return MESSAGES.deck;
  if (ids.has("I20")) return MESSAGES.column;
  if (ids.has("I21")) return MESSAGES.rows;
  if (ids.has("I22")) return MESSAGES.hole;
  // Last: a named invariant explains more when both are broken. Commands refuse a sheet in its own words, so only a race
  // gets one this far: a layout or deck gone under it (sheetset.02).
  if (ids.has("I9") || ids.has("I23")) return MESSAGES.removed;
  return null;
}

/** A thing in a refusal: its name and its resolved range in metres. */
export type NamedRange = { name: string; bottom: number; top: number };
/**
 * A refusal in height (heights.14, .32): two pieces in one state; a piece and a wall (`halfWall` its top, null for a
 * full wall); a piece and the ceiling (`config` the configuration's label, only for kinds with two); a half wall and
 * the ceiling; a deck and a wall (`wallTop` the wall's top, full or not); a deck and the ceiling; a piece and a deck it
 * doesn't stand on, overlapping in height or above its underside (decks.11); a piece too tall for an open flight's
 * underside at its end nearest the bottom step (`stair` the flight's kind in lower case, stairs.11); a piece or a deck
 * and a column, named with its range (pillars.17's Try it step 2).
 */
type Collision =
  | { with: "piece"; a: NamedRange; b: NamedRange; state: string }
  | { with: "wall"; piece: NamedRange; halfWall: number | null; state: string }
  | { with: "column"; piece: NamedRange; column: NamedRange; state: string }
  | { with: "ceiling"; name: string; config: string | null; top: number; ceiling: number; state: string }
  | { with: "halfWallCeiling"; ceiling: number }
  | { with: "deckWall"; deck: NamedRange; wallTop: number }
  | { with: "deckColumn"; deck: NamedRange; column: NamedRange }
  | { with: "deckCeiling"; name: string; top: number; ceiling: number }
  | { with: "deck"; piece: NamedRange; deck: NamedRange; state: string }
  | { with: "aboveDeck"; piece: NamedRange; deck: string; state: string }
  | { with: "underside"; piece: NamedRange; stair: string; underside: number; state: string };

const ranged = (n: NamedRange): string => `${n.name} (${shown(n.bottom)}–${shown(n.top)})`;

/** The one formatter of the refusal texts in height: toasts and MCP replies read the same text (AC-08). */
export function collisionMessage(c: Collision): string {
  switch (c.with) {
    case "piece": return `${ranged(c.a)} and ${ranged(c.b)} overlap in ${c.state}`;
    case "wall": return `${ranged(c.piece)} overlaps ${c.halfWall === null ? "a wall" : `a ${shown(c.halfWall)} m wall`} in ${c.state}`;
    case "ceiling": return `${c.name}${c.config === null ? "" : ` (${c.config})`} reaches ${shown(c.top)} m in ${c.state}; the ceiling is ${shown(c.ceiling)} m`;
    case "column": return `${ranged(c.piece)} and ${ranged(c.column)} overlap in ${c.state}`;
    case "deckColumn": return `${ranged(c.deck)} and ${ranged(c.column)} overlap`;
    case "halfWallCeiling": return `A wall can't be taller than the ${shown(c.ceiling)} m ceiling`;
    case "deckWall": return `${ranged(c.deck)} overlaps a ${shown(c.wallTop)} m wall`;
    case "deckCeiling": return `${c.name} reaches ${shown(c.top)} m; the ceiling is ${shown(c.ceiling)} m`;
    case "deck": return `${ranged(c.piece)} and ${ranged(c.deck)} overlap in ${c.state}`;
    case "aboveDeck": return `${ranged(c.piece)} is above ${c.deck} in ${c.state}, which it doesn't stand on`;
    case "underside": return `${ranged(c.piece)} hits the ${c.stair}'s underside (${shown(c.underside)} at that end) in ${c.state}`;
    default: return assertNever(c);
  }
}

/** I13 for one wall (spec: domain): the same text from validateDocument and from the commands that refuse early. */
export function thicknessViolation(wallId: string, thickness: number): Violation {
  return {
    invariant: "I13",
    message: `Wall ${wallId} thickness ${thickness} m is outside ${metres(MIN_WALL_THICKNESS)} to ${metres(MAX_WALL_THICKNESS)} m`,
    entities: [{ table: "walls", id: wallId }],
  };
}
