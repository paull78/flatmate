import { type Arms, type Command, type Document, type DomainError, type EntityRef, type MotifId, type Opening, type Range, type ResizeSide, type Side, type StairEdge, type StairEdgeShape, type StairLanding, type StairRequest } from "@fm/domain";
import { assertNever, type EntityKey, type Point } from "@fm/protocol";
import type { Arm } from "../snapping/arm-drag";
import type { Strip } from "../snapping/zone-drag";
import type { Guide } from "../snapping/guides";
import type { SplitTick } from "./split-gesture";
import type { ToolName } from "../types";

export const PREVIEW_OP = "preview"; // preview walls get IDs "preview/…"; never committed

export type WallPreview = { from: Point; to: Point } & ({ ok: true; doc: Document } | { ok: false });

// spec: wall-editing. Fields not listed in a transition carry over unchanged.
export type WallToolState =
  | { kind: "idle" }
  // dragFrom: the raw world point of the press that started the chain, until its release (one drag = one wall).
  | { kind: "drawing"; origin: Point; chainStart: Point; value: string; preview: WallPreview | null; dragFrom: Point | null }
  | { kind: "paused"; origin: Point; chainStart: Point; segment: string }; // segment = commit ID (shared documents)

export type DragTarget =
  | { kind: "joint"; jointId: string }
  // A wall drag's run (straight.02), or a group of walls and pieces (straight.09); across: the run's unit normal when it only moves across itself (straight.03)
  | { kind: "walls"; wallIds: readonly string[]; placementIds: readonly string[]; across: Point | null }
  | { kind: "placement"; placementId: string }
  | { kind: "placements"; placementIds: string[] } // a group of two or more pieces of the active layout (direct.08)
  | { kind: "opening"; openingId: string }
  | { kind: "resize"; placementId: string; side: ResizeSide } // a side grip of one selected piece (direct.04)
  | { kind: "rotate"; placementId: string } // the rotation grip of one selected piece (direct.05)
  | { kind: "armGrip"; placementId: string; arm: Arm } // an arm grip of one selected `L` piece (catalog.09)
  | { kind: "dimension"; dimensionId: string } // a placed dimension's line or text: its offset (dims.17)
  | { kind: "zoneDepth"; placementId: string; side: Side; strip?: Strip } // a use zone's depth handle (furnish.20); an `L` front's strip
  | { kind: "zoneEnd"; placementId: string; side: Side; end: "start" | "end"; strip?: Strip } // one of a use zone's end handles
  | { kind: "deck"; deckId: string } // a selected deck's body: moves it (decks.06)
  | { kind: "column"; wallId: string } // a selected free column's row: moves its centre (pillars.13)
  | { kind: "deckSide"; deckId: string; side: ResizeSide } // a selected deck's side grip: that side moves, the opposite stays
  | { kind: "hole"; holeId: string } // a selected hole's body, at the floor: moves it (stairwell.19)
  | { kind: "holeSide"; holeId: string; side: ResizeSide } // a selected hole's side grip
  | { kind: "area"; areaId: string } // a selected named area's tag or body: moves it (areas.29)
  | { kind: "areaSide"; areaId: string; side: ResizeSide } // a selected area's side grip
  | { kind: "sectionEnd"; sectionId: string; end: "a" | "b" } // a selected section's end grip: that end moves
  | { kind: "sectionFar"; sectionId: string }; // a selected section's far grip: its depth

export type Moves = { jointId: string; to: Point }[];
export type Places = { placementId: string; at: Point; rotation: number }[];

/**
 * What a drag tried (tools/drag.ts): joints' moves (a joint or wall drag), an object's place, a group's places, an
 * opening's offset, a side grip's new size, an arm grip's new arms, a placed dimension's offset, a zone handle's new
 * zone; or no floor for one piece at the viewed level.
 */
export type DragTry =
  | { kind: "none" } // nothing yet, or the target is gone
  | { kind: "moves"; moves: Moves }
  | { kind: "wallsMove"; by: Point } // a walls drag's delta: moveWalls (straight.22)
  | { kind: "place"; at: Point; rotation: number; deck: string | null } // deck: the surface it stands on there (decks.11)
  | { kind: "noFloor"; at: Point; rotation: number } // one piece at an upper level with no deck of it under its centre (levels.16): refused, never sent
  | { kind: "places"; places: Places }
  | { kind: "slide"; offset: number }
  | { kind: "resize"; side: ResizeSide; size: number }
  | { kind: "arms"; arm: Arm; objectId: string; w: number; arms: Arms } // an arm grip's new arms, with the width the size command carries (catalog.18)
  | { kind: "dimensionOffset"; offset: number }
  | { kind: "zoneExtent"; side: Side; extent: { depth: number; start: number; end: number } } // a zone handle's new zone
  | { kind: "deckMove"; at: Point } // a deck's new centre
  | { kind: "columnMove"; at: Point } // a column's new centre
  | { kind: "deckSize"; at: Point; w: number; d: number } // a deck side's new centre and size
  | { kind: "holeMove"; at: Point } // a hole's new centre
  | { kind: "holeSize"; at: Point; w: number; d: number } // a hole side's new centre and size
  | { kind: "areaMove"; at: Point } // a named area's new centre
  | { kind: "areaSize"; at: Point; w: number; d: number } // an area side's new centre and size
  | { kind: "sectionEnd"; at: Point } // a section end's new place
  | { kind: "sectionDepth"; depth: number }; // a section's new depth

// tried = what this attempt tried; release commits exactly that. doc = the preview drawn: the attempt's result when ok, else the last valid preview (or baseDoc). blocked =
// placements whose fit the attempt broke, drawn red (spec: layouts). dependencies = what the command reads and writes,
// from the domain's result (the zero move at drag start, then the last valid attempt): a remote write to any of them
// cancels the drag (spec: tools, arch-review R-06). guides = a drag's alignment guides on doc (AC-13), none while
// refused or with Ctrl; a nudge run's are drawn from its preview, none while refused (view/scene.ts), so its
// attempts keep none. The duplicate's ghost keeps its copies' guides on its preview, as a drag, none while refused or
// with Ctrl.
export type MoveAttempt = {
  ok: boolean;
  doc: Document;
  cursor: Point;
  tried: DragTry;
  blocked: string[];
  dependencies: EntityKey[];
  guides: readonly Guide[];
  refused?: { error: DomainError; cmd: Command }; // a drag's refusal, for the plate on a rest (clarity.07); noFloor has none
};

// spec: tools.
export type SelectToolState =
  | { kind: "idle" }
  // clickSelection: the selection a release without a drag sets (tools/press-selection.ts), null to keep it; chip: a
  // zone chip pressed (smart.24), whose click toggles that side; flip: a selected section's arrow pressed (section.54), whose click flips it
  | { kind: "pressing"; pressWorld: Point; target: DragTarget | null; clickSelection: EntityRef[] | null; chip?: { placementId: string; side: Side }; flip?: string }
  // turn: R presses × 90, mod 360, for a piece or a group (AC-01), as a ghost's (ghost.03).
  // value: a distance typed during a walls drag (straight.20); the preview moves to it as soon as it reads.
  | { kind: "moving"; target: DragTarget; pressWorld: Point; baseDoc: Document; attempt: MoveAttempt; turn: number; value?: string }
  // A box select from a floor, a tag or empty canvas (direct.07): corner is null until the pointer passes the drag
  // threshold; click is the room a release without a drag selects (null on empty canvas). It commits nothing.
  | { kind: "box"; pressWorld: Point; corner: Point | null; additive: boolean; click: EntityRef | null }
  // A run of arrow-key nudges (direct.09, direct.10, tools/nudge.ts): offset is the last valid one, in whole cm;
  // attempt.doc its preview, attempt.tried the last press's try (the refused one when not ok), attempt.cursor unused
  // (the first piece's centre); until is when the run commits.
  | { kind: "nudging"; target: DragTarget; baseDoc: Document; offset: Point; attempt: MoveAttempt; until: number }
  // The duplicate's ghost (ghost.01, duplicate.ts): copies of `sources` (sorted, the order the domain numbers the
  // copies) moved by `offset` in metres, the drag's furniture delta (a guide, the originals included, else the step;
  // for one piece flushed onto a wall, its footprint centre's move) from `centre` (the sources' footprint box centre at pick-up) to the cursor. attempt.tried: the copies' places
  // (`places`, one per source). attempt.doc: baseDoc with the copies under PREVIEW_OP while they fit. attempt.cursor:
  // the last pointer. Nothing is in the document. turn: R presses × 90, mod 360, 0 at pick-up (ghost.03); the rotation
  // shown can differ, since near a wall a single piece's contact turn replaces it (furnish.16) without using up the
  // presses. attempt.blocked: every placement the copies hit, the originals included.
  | { kind: "copying"; sources: string[]; centre: Point; baseDoc: Document; offset: Point; turn: number; attempt: MoveAttempt }
  // entered in phase 5; piece: the index in wallChain of the chain piece being typed into, absent for the total (ux-polish item 4)
  | { kind: "editingHelper"; wallId: string; piece?: number; value: string }
  // a selected hole's gap to its deck's edge on `side` being typed into (stairwell.36)
  | { kind: "editingGap"; holeId: string; side: ResizeSide; value: string }
  // The Split gesture (straight step 15): armed from Properties on `wallId`; tick: where a click would split (null with
  // the pointer off the wall); value: the typed distance from the room face's start.
  | { kind: "splitting"; wallId: string; tick: SplitTick | null; value: string };

// `motif` set is the Floor mode (finishes.19): a click lays that motif in a room or on a deck (deck-floors.02) instead
// of selecting it. `hoverDeck`: the deck the Floor mode's click would finish, tinted as a hovered room is.
// A press (areas.06): the Deck tool's, so a drag draws a named area; idle between presses.
export type ZoneToolState = DeckToolState & { hoverFaceKey: string | null; hoverDeck: string | null; motif: MotifId | null };

/**
 * The see-through object under the pointer: what a click would place (ux-polish item 1). `surface`: the deck it stands on
 * (null: the floor), where the landing rule lands it at the viewed level (decks.11, levels.08); `range`: its range in
 * height there, for the cut. `noFloor`: at an upper level none of its decks is under the centre (levels.16), so it is
 * red, drawn on the floor's range, and a click toasts "No floor at +2.15 here" and sends nothing; absent otherwise.
 */
export type ObjectGhost = {
  kind: string; config: string; w: number; d: number; at: Point; rotation: number; fits: boolean; surface: string | null; range: Range; noFloor?: true;
  h?: number; reaches?: string; // a stair on a caught edge (stairdraw.11): its rise and the deck it goes up to
  // and the shape it is drawn as (an L too low to turn is drawn straight, stairdraw.35); an L's upper flight has its
  // steps begin `base` above its surface, at the landing's top (stairs.49), and `l` holds the L's other parts
  shape?: StairEdgeShape; base?: number; l?: StairLGhost;
  left?: true; // a winder that will enter from the left, its side picked away from a wall (steps.39)
  refused?: DomainError; // why the commit's fit refuses a caught-edge stair, when it doesn't fit (the hint line's reason)
  // A new piece lowered to fit (clarity.06): its height, its default, and the deck that limits it (null: the ceiling)
  lowered?: { h: number; from: number; under: string | null };
  drawn?: true; // a footprint being drawn (sizing.07): its size label, front bar and R's turn key on it
  // A multi-piece set (seated.12): this ghost is its overall box, for walls and guides; these are the pieces it draws and places.
  set?: readonly { kind: string; config: string; w: number; d: number; at: Point; rotation: number }[];
};
/** An L's lower flight, reaching the landing, and the landing deck (stairdraw.34); both take the whole L's `fits`. */
export type StairLGhost = { lower: ObjectGhost; landing: StairLanding };
/**
 * The stair gesture (stairdraw.06, tools/stair-gesture.ts): an edge caught under the cursor, then the top fixed at
 * `at` on it by click 1 (or a press). Null when no edge is caught: the Object tool is then today's. `cursor`: the last
 * world point the pointer gave it, kept while the pointer is off the canvas, so the ghost stays frozen there and the
 * hint's fix chips can be reached (stairdraw.13, .43).
 */
export type StairGesture = { phase: "hover"; edge: StairEdge; cursor: Point } | { phase: "fixed"; edge: StairEdge; at: Point; cursor: Point };
/** A fix chip (stairdraw.13): what chipHover and chipClick name it by, its words, an aside ("1.99 m"), and the stair it places. */
export type StairFix = { id: string; label: string; detail?: string; request: StairRequest };
/**
 * A red stair's prompt ("Doesn't fit: 0.69 m short"), its fix chips and the edge their stairs go on (stairdraw.48):
 * live from the red ghost before click 1, pinned at click 1 (ObjectToolState.offer) so the swing on the way to the
 * hint line changes neither the chips nor the line's text, and the chips stay where the hand is heading.
 */
export type StairOffer = { prompt: string; chips: readonly StairFix[]; edge: StairEdge };
// A release places the ghost (spec: layouts); `rotation` is its start angle, 0 when a kind is armed, plus 90 for each R.
// pressing: the press being held (furnish.04); corner is null until the pointer passes 4 px, then the drawn
// footprint's other corner, raw (the ghost snaps it). `fixes`: the press fixed a stair's top (click 1, or a drag's press).
// preview: the stair of the fix chip being hovered (stairdraw.13), drawn in the ghost's place; null when none is.
// offer: the chips pinned at click 1 on a red straight flight, kept while the top is fixed; null otherwise (stairdraw.48).
export type ObjectToolState = {
  kind: "idle"; ghost: ObjectGhost | null; rotation: number; pressing: { pressWorld: Point; corner: Point | null; fixes?: true; turns?: number } | null; stair: StairGesture | null;
  preview: ObjectGhost | null; offer: StairOffer | null;
};

// The opening a click on the wall under the pointer would add (spec: openings), ok when it fits; null off every wall.
/** `refused`: why the level can't place it at all (a door on the shell seen from a loft, sills.06), else null. */
export type OpeningPreview = { opening: Opening; ok: boolean; refused: string | null };
export type OpeningToolState = { kind: "idle"; preview: OpeningPreview | null };

// Spec §Placing (dims.04): A, then B, then the offset; Esc steps back one stage.
export type DimensionToolState =
  | { kind: "idle" }
  | { kind: "second"; a: Point } // A placed; the rubber band runs to the snapped cursor
  | { kind: "offset"; a: Point; b: Point; offset: number }; // B placed; the offset follows the pointer

// The Deck tool (spec "The Deck tool and editing", decks.06): a press held, then dragged. pressWorld: the raw press, for
// the 4 px click rule; start: its corner, snapped (footprintCorner). current: the other corner, snapped, once the pointer
// has passed 4 px (null: still a click); ok: whether the drawn deck would be accepted, for the preview's colour.
export type DeckToolState = { kind: "idle" } | { kind: "pressing"; pressWorld: Point; start: Point; current: Point | null; ok: boolean };

/**
 * The Column tool (pillars.12, .19): the column a click would place, centred on the snapped pointer. `ring`: its body
 * as `placeColumn` on the visible document builds it, or the free rectangle when the command refuses (`ok` false,
 * drawn red); null off the canvas.
 */
export type ColumnGhost = { at: Point; ring: readonly Point[]; ok: boolean };
/** `pressed`: a press began in the tool, so its release places (a stray release places nothing). */
export type ColumnToolState = { kind: "idle" | "pressed"; ghost: ColumnGhost | null };

// The Scale tool (import.13): A, then B, then the real distance typed; Esc drops both points. Clicks don't snap.
export type ScaleToolState =
  | { kind: "idle" }
  | { kind: "second"; a: Point } // A placed; the rubber band runs to the raw cursor
  | { kind: "typing"; a: Point; b: Point; value: string }; // B placed; the distance in metres being typed

// The Section tool (spec "Drawing a section"): A, then B, then the side; Esc steps back one stage.
export type SectionToolState = { kind: "idle" } | { kind: "second"; a: Point } | { kind: "side"; a: Point; b: Point; side: 1 | -1 };

export type ToolState =
  | { name: "select"; state: SelectToolState }
  | { name: "wall"; state: WallToolState }
  | { name: "zone"; state: ZoneToolState }
  | { name: "object"; state: ObjectToolState }
  | { name: "opening"; state: OpeningToolState }
  | { name: "dimension"; state: DimensionToolState }
  | { name: "column"; state: ColumnToolState }
  | { name: "deck"; state: DeckToolState }
  | { name: "hole"; state: DeckToolState }
  | { name: "section"; state: SectionToolState }
  | { name: "scale"; state: ScaleToolState };

/** The Zone tool, idle; armed with `motif` in the Floor mode (finishes.19). */
export function zoneIdle(motif: MotifId | null): ToolState {
  return { name: "zone", state: { kind: "idle", hoverFaceKey: null, hoverDeck: null, motif } };
}

export function idleTool(name: ToolName): ToolState {
  switch (name) {
    case "select":
      return { name: "select", state: { kind: "idle" } };
    case "wall":
      return { name: "wall", state: { kind: "idle" } };
    case "zone":
      return zoneIdle(null);
    case "object":
      return { name: "object", state: { kind: "idle", ghost: null, rotation: 0, pressing: null, stair: null, preview: null, offer: null } };
    case "opening":
      return { name: "opening", state: { kind: "idle", preview: null } };
    case "dimension":
      return { name: "dimension", state: { kind: "idle" } };
    case "column":
      return { name: "column", state: { kind: "idle", ghost: null } };
    case "deck":
      return { name: "deck", state: { kind: "idle" } };
    case "hole":
      return { name: "hole", state: { kind: "idle" } };
    case "section":
      return { name: "section", state: { kind: "idle" } };
    case "scale":
      return { name: "scale", state: { kind: "idle" } };
    default:
      return assertNever(name);
  }
}
