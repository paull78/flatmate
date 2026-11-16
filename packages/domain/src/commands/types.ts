import type { Point, Result } from "@fm/protocol";
import type { Arms } from "../arms";
import type { DomainError } from "../errors";
import type { Finish } from "../finishes";
import type { ObjectSizes, OpeningKind, OrCeiling, Side, Sides } from "../kinds";
import type { DeckGuardField, Document, EntityRef, Guard, GuardPatch, HandrailKind, Opening, Section, Sheet, SheetDrawing, SheetKind, WallSide, WallTop } from "../model";
import type { ObjectOption, ObjectOptions } from "../options";
import type { DeckPreset } from "../presets";
import type { StairRequest } from "../queries/stair-edge";

type OpeningSide = Opening["side"];
type Sheer = NonNullable<Opening["sheer"]>;
type OpeningHinge = Opening["hinge"];
import type { DomainPatch } from "../patch";
import type { ZoneExtent } from "../use-zone";
import type { Falls, RoofShape } from "../roof-shapes";

export type ResizeSide = "left" | "right" | "front" | "back";

export type JointRef = { existing: string } | { at: Point };

/** One piece of a placePieces: its own object, with a place in each layout it stands in. Sizes default to the kind's. */
export type NewPiece = {
  kind: string;
  name?: string;
  size?: ObjectSizes;
  options?: ObjectOptions;
  placements: readonly { state: string; at: Point; rotation: number; config?: string; deck: string | null }[];
};

export type Command =
  // A wall on `base` ("floor", the default, or a deck ID) up to `top` ("ceiling", the default, or a height from the
  // base); a deck as top is refused (pillars.09, .23).
  | { type: "addWall"; opId: string; from: JointRef; to: JointRef; thickness?: number; base?: string; top?: WallTop }
  | { type: "moveJoints"; moves: { jointId: string; to: Point }[] }
  // Every joint of these walls moves by `by`; in-line columns go rigidly (straight.12, .22).
  // `placements`: pieces of one layout moved by the same `by`, in the same patch (a group drag, straight.09).
  | { type: "moveWalls"; walls: readonly string[]; by: Point; placements?: readonly string[] }
  // A wall cut in two at `offset` metres along its room-side face from the face's start (straight step 12): the new
  // joint is `${opId}/j0`, the fragment `${opId}/w1`.
  | { type: "splitWall"; opId: string; wallId: string; offset: number }
  // The nearly straight, nearly square side `wallId` is part of, put exactly on one axis line (straight.43).
  | { type: "straightenWalls"; wallId: string }
  // A joint moved to `to` and connected to what it lands on: a joint (merged into), a wall's body (split, the fragment
  // `${opId}/w1`), or nothing (a plain move) (straight.18).
  | { type: "connectJoint"; opId: string; jointId: string; to: Point }
  | { type: "setWallLength"; wallId: string; length: number; keep: "a" | "b" }
  | { type: "setWallThickness"; wallId: string; thickness: number }
  // A wall's top: a half wall's height in metres, or "ceiling" for a full wall (heights.10).
  | { type: "setWallTop"; wallId: string; top: OrCeiling }
  // The flat ceiling's height (heights.11).
  | { type: "setCeiling"; height?: number; shape?: RoofShape; pitch?: number; highSide?: number; falls?: Falls; overhang?: number }
  // Decks (spec "The deck"): fields given override the preset's; `at` is the deck's centre.
  | { type: "addDeck"; opId: string; preset: DeckPreset; at: Point; w?: number; d?: number; rotation?: number; top?: number; solid?: boolean; name?: string; guard?: Guard } & DeckGuardPatches
  | { type: "setDeck"; deckId: string; name?: string; at?: Point; w?: number; d?: number; rotation?: number; top?: number; solid?: boolean; guard?: Guard } & DeckGuardPatches
  // A hole through a deck (stairwell.14): its centre in plan coordinates, its sides along the deck's axes.
  | { type: "addDeckHole"; opId: string; deck: string; at: Point; w: number; d: number; guard?: GuardPatch }
  | { type: "setDeckHole"; holeId: string; at?: Point; w?: number; d?: number; guard?: GuardPatch }
  // Columns (pillars.01, .18): a column row from its centre, width (along `rotation`, degrees counter-clockwise), depth;
  // a free one stands on `base` ("floor" or a deck ID) up to `top` ("ceiling", a height from the base or a deck ID).
  | { type: "placeColumn"; opId: string; at: Point; width: number; depth: number; rotation?: number; base?: string; top?: WallTop }
  // Fields not given keep the column's values (columnOf).
  | { type: "setColumn"; wallId: string; at?: Point; width?: number; depth?: number; rotation?: number; top?: WallTop }
  // A label comes with its finish or null, so finishing an unlabelled room is one command (finishes.01).
  | { type: "labelZone"; id: string; at: Point; name: string; finish: Finish | null }
  | { type: "renameZone"; id: string; name: string }
  // A label's finish, or null to remove it (finishes.14); shared by every layout, like the name.
  | { type: "setFinish"; id: string; finish: Finish | null }
  | { type: "setDeckFinish"; deckId: string; finish: Finish | null }
  | { type: "setWallFinish"; wallId: string; side: WallSide; part: "finish" | "lower"; finish: Finish | null; height?: number }
  | { type: "setRoomWallFinishes"; labelId: string; part: "finish" | "lower"; finish: Finish | null; height?: number }
  // A whole custom side at once, finish and band (inherit.04: Customize, one undo step); its finish never null (inherit.02).
  | { type: "setWallSide"; wallId: string; side: WallSide; finish: Finish; lower: Finish | null; height?: number }
  // Returns a custom side to its room's or the house's default (inherit.04).
  | { type: "resetWallSide"; wallId: string; side: WallSide }
  // The house's outside walls default, one part at a time, on the ceiling row (inherit.07).
  | { type: "setOutsideFinish"; part: "finish" | "lower"; finish: Finish | null; height?: number }
  | { type: "setRoofCovering"; finish: Finish | null }
  | { type: "deleteEntities"; ids: EntityRef[] }
  // Layout states (spec: layouts)
  // `deck` is the surface the piece stands on (a deck's ID, or null for the floor); commands only set it (decks.11).
  | { type: "placeObject"; opId: string; state: string; object: { kind: string; name?: string; preset?: string; size?: { w: number; d: number; h?: number } } | { existing: string }; at: Point; rotation?: number; config?: string; deck: string | null; reaches?: string | null; linked?: boolean }
  // `linked` (review.06, .11): absent links a new piece when it fits in every layout, else places it in its own layout
  // only; true refuses rather than fall back; false never links. A kind in every layout ignores it.
  // An absent `deck` keeps the surface.
  | { type: "movePlacement"; placementId: string; at: Point; rotation: number; deck?: string | null; reaches?: string | null }
  // A stair's deck reached, or null (stairs.10); its height follows the deck.
  | { type: "setStairReaches"; objectId: string; deck: string | null }
  // A stair's target riser (null clears it), keeping the run; its going, keeping the riser and setting the run (riser.02);
  // its handrail, on a kind with rails (guards.28).
  | { type: "setStair"; objectId: string; riser?: number | null; going?: number; handrail?: HandrailKind; handrailLeft?: HandrailKind; handrailRight?: HandrailKind; hooks?: boolean; leftEntry?: boolean }
  // A stair hung off a deck's edge at `at` (stairdraw.18, .20): its parts from stairOnEdge, placed in every layout, each
  // with `handrail`, or the one the deck gives (guards.28).
  | ({ type: "placeStair"; opId: string; handrail?: HandrailKind } & StairRequest)
  | { type: "movePlacements"; moves: { placementId: string; at: Point; rotation: number }[] }
  | { type: "duplicatePlacements"; opId: string; copies: { placementId: string; at: Point; rotation: number }[] }
  // New pieces and at most one object taken away, in one patch, all or none (seated.10). A set broken apart, or several pieces placed as one.
  | { type: "placePieces"; opId: string; remove?: string; pieces: readonly NewPiece[] }
  | { type: "setConfiguration"; placementId: string; config: string }
  // The width of every configuration and the depth, height and elevation of each configuration given (smart.05,
  // .16, heights.09); an `L` piece's final arms with them, so one command shapes it (catalog.18).
  | { type: "setObjectSize"; objectId: string; w: number; d: Readonly<Record<string, number>>; h?: Readonly<Record<string, number>>; z?: Readonly<Record<string, OrCeiling>>; arms?: Arms }
  // Switches an object to another kind with the same configuration ids, keeping its sizes and name (furnish.17).
  | { type: "setObjectKind"; objectId: string; kind: string }
  // Turns one of the object's options on or off, in every layout (library.10); its kind must list it.
  | { type: "setOption"; objectId: string; option: ObjectOption; on: boolean }
  // One side grip's resize: `size` is the new width of every configuration (left, right) or the new depth of the
  // shown configuration (front, back).
  | { type: "resizePlacement"; placementId: string; side: ResizeSide; size: number }
  | { type: "renameObject"; objectId: string; name: string }
  // The sides with a use zone of one placement, in its layout only (smart.08, .16).
  | { type: "setZoneSides"; placementId: string; sides: Sides }
  // One side's use zone of one placement, in its layout only: a depth and two insets, or null for the kind's
  // default (furnish.14, .20).
  | { type: "setZoneExtent"; placementId: string; side: Side; extent: ZoneExtent | null }
  | { type: "removePlacement"; placementId: string }
  // A piece linked across layouts or not (review.07): on copies this placement's pose and surface to every layout.
  | { type: "setLinked"; placementId: string; on: boolean }
  | { type: "addState"; opId: string; name: string }
  | { type: "copyState"; opId: string; from: string; name: string }
  | { type: "renameState"; stateId: string; name: string }
  | { type: "deleteState"; stateId: string }
  // Openings (spec: openings)
  // A window's dressing (hangings.04): `sheer` "none" and `shutterBox` false remove them.
  | { type: "addOpening"; opId: string; wall: string; kind: OpeningKind; offset: number; width?: number; side?: OpeningSide; hinge?: OpeningHinge; glazed?: boolean; sill?: number; head?: number; sheer?: Sheer | "none"; shutterBox?: boolean }
  | { type: "moveOpening"; openingId: string; offset: number }
  | { type: "setOpening"; openingId: string; kind?: OpeningKind; width?: number; side?: OpeningSide; hinge?: OpeningHinge; glazed?: boolean; sill?: number; head?: number; sheer?: Sheer | "none"; shutterBox?: boolean }
  | { type: "removeOpening"; openingId: string }
  // Project fields (sheet.02): a key from PROJECT_FIELDS; "" clears the field.
  | { type: "setProjectField"; key: string; value: string }
  // Placed dimensions (dims): points in metres; the domain anchors each end.
  | { type: "addDimension"; opId: string; a: Point; b: Point; offset: number }
  | { type: "setDimensionOffset"; id: string; offset: number }
  // The plan underlay (import.13, .16): placed at the provisional scale, scaled about a plan point `a`, removed.
  | { type: "placeUnderlay"; pictureId: string; data: string; width: number; height: number; at: Point }
  | { type: "scaleUnderlay"; a: Point; b: Point; distance: number }
  | { type: "removeUnderlay" }
  // The studio's logo (sheetset.21): placed or replaced as one put, removed.
  | { type: "setLogo"; data: string; width: number; height: number }
  | { type: "removeLogo" }
  // Sheets (sheetset.02): each writes the automatic list first if it is still automatic. `after` is the sheet to follow,
  // or null for the end; drawings are a list here and flat in the row (library.17).
  | ({ type: "addSheet"; opId: string; after: string | null; first?: boolean; kind: SheetKind; drawings: readonly SheetDrawing[] } & Partial<Omit<SheetFields, "kind" | "drawings">>)
  | ({ type: "setSheet"; sheetId: string } & Partial<SheetFields>)
  | { type: "deleteSheet"; sheetId: string }
  // `index` is its place in the list once moved.
  | { type: "moveSheet"; sheetId: string; index: number }
  // All and None: every sheet ticked or cleared, in one step.
  | { type: "setSheetsInPdf"; on: boolean }
  // Sections (section.09): the letter is the first free one, read back from the patch; `depth` defaults to whole (null).
  | { type: "addSection"; a: Point; b: Point; side: Section["side"]; depth?: number | null }
  | { type: "setSection"; sectionId: string; a?: Point; b?: Point; side?: Section["side"]; depth?: number | null }
  // Named areas (areas.05): `${opId}/a0`, numbered "Area N" when the name is missing or blank; the centre in a room.
  | { type: "addArea"; opId: string; at: Point; w: number; d: number; name?: string }
  | { type: "setArea"; areaId: string; name?: string; at?: Point; w?: number; d?: number };

/** A sheet row's fields a command can set; `order` goes by addSheet's `after` and moveSheet. */
export type SheetFields = Omit<Sheet, "id" | "order" | "drawings"> & { drawings: readonly SheetDrawing[] };

export type CommandOf<T extends Command["type"]> = Extract<Command, { type: T }>;
export type CommandResult = Result<{ doc: Document; patch: DomainPatch }, DomainError>;

/** A deck command's per-side guard changes (edges.01): `guard` sets every side's kind, a side's field its kind or height. */
export type DeckGuardPatches = { [F in DeckGuardField]?: GuardPatch };
