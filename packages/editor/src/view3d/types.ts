import type { Arms, GuardRun, Handrail, ObjectOptions, OpeningKind, SpiralRails } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Plane, WallSides } from "@fm/domain";

// The 3D view's scene as items, not faces (heights.05): plain data a native shell or a finer renderer can draw on its
// own. Every switch over `Item3d` ends in assertNever, so a new variant (decks, decks.07) is a compile error until handled.

/** A ring on the plan, in metres. */
export type Ring = readonly Point[];

/**
 * A placed piece in the viewed state: its drawn shape (`ring`, shapefit.01), pose and vertical range, resolved by the
 * domain (heights.27). `objectKind` and `config` let a finer renderer pick a model for the box. `base`, on a stair
 * that starts at a deck's edge, is that deck's top, where its steps begin above `bottom` (stairs.49). `options`: the
 * object's options that are on (library.10: a desk's computer), absent when none. `arms`: an `L` piece's arms (`armsOf`,
 * catalog.17), absent for other kinds. `handrails`: a flight's (`flightHandrails`, AC-11), absent when it has none.
 * `spiralRails`: a spiral's (AC-12), absent for other kinds.
 */
export type PieceItem = {
  item: "piece";
  placement: string;
  object: string;
  objectKind: string;
  config: string;
  ring: Ring;
  centre: Point;
  rotation: number;
  w: number;
  d: number;
  bottom: number;
  top: number;
  base?: number;
  riser?: number; // a stair's target riser, read by its treads (riser.01)
  options?: ObjectOptions;
  arms?: Arms;
  handrails?: readonly Handrail[];
  spiralRails?: SpiralRails;
  flueTop?: number; // a stove's flue's top: the ceiling, or a deck's underside over it (pieces.08)
  selected: boolean;
};
/** Where a stair piece's steps begin: its `base`, else its bottom. */
export const stepsFrom = (item: PieceItem): number => item.base ?? item.bottom;
/**
 * A door or window in a wall (heights.69): its span on the wall's centre line in a → b order, the wall's thickness, and
 * its range from the domain's `openingRange` (fixed heights until openings store a sill and a head). `glass` for a
 * window, which a section draws in its own ink. `kind`, `glazed`, the domain's `hinge`, on the wall's face on the
 * opening side, and the plan's `parked` box say what stands in it (`opening-faces.ts`).
 */
/** `floor`: a door's span floor (thresholds.01), its room's finish colour and pattern; null for a window or a plain floor. */
export type Opening3d = { start: Point; end: Point; thickness: number; bottom: number; top: number; glass: boolean; floor: DeckFloor | null; kind: OpeningKind; glazed: boolean; hinge: Point; parked: readonly Point[]; dressing?: Dressing3d };
/**
 * A window's dressing (hangings.04), heights absolute: the shutter box's plan quad, and the sheer's line on the plan
 * (`out` its room side), each absent when the window has none.
 */
export type Dressing3d = { box?: { quad: Ring; bottom: number; top: number }; curtain?: { a: Point; b: Point; out: Point; bottom: number; top: number } };
/**
 * A joint cap (studio.05, .10): the share of a joint that a shorter wall's outline holds, carried from that wall's top
 * (`bottom`) up to the top of the wall that owns the cap, so the taller walls show no notch above the shorter one.
 */
export type WallCap = { ring: Ring; bottom: number };
/**
 * A wall body from the floor to its top; `full` when it reaches the ceiling (heights.10); its doors and windows; the
 * joint caps it carries, drawn and hidden with it.
 */
/** `planes`: the ceiling's planes when the wall rises to a sloped ceiling (roofs.16), its faces cut under them; else null. */
/**
 * A wall: its outline and range, openings, caps and the roof planes it is clipped under; `left`, the unit normal of its
 * left side seen from joint a, and `sides`, its finishes with the Finishes switch on, else null (surfaces step 03).
 */
export type WallItem = { item: "wall"; wall: string; outline: Ring; bottom: number; top: number; full: boolean; openings: readonly Opening3d[]; caps: readonly WallCap[]; planes: readonly Plane[] | null; left: Point; sides: WallSides | null };
/** A joint of a floor's pattern on the plan, in its own colour (finishes.12). */
export type FloorLine = { a: Point; b: Point; color: string };
/** A filled shape of a floor's pattern on the plan (cement tiles' centres and corners), in its own colour (shown.04). */
export type FloorShape = { ring: Ring; holes: readonly Ring[]; color: string };
/**
 * A room's floor at 0.00, its holes cut out; with finishes on, its finish's colour (null: the plain floor) and the
 * pattern's lines and shapes when they are wide enough apart to draw in 3D.
 */
export type FloorItem = { item: "floor"; room: string; ring: Ring; holes: readonly Ring[]; color: string | null; lines: readonly FloorLine[]; shapes: readonly FloorShape[] };

/** A deck (decks.07): its ring and absolute range, a box from `bottom` to `top`; hollow decks start at their underside. */
/** A deck's slab (stairwell.09): its rectangle, its holes and its boundary edges (slab on the left), from bottom to top. */
/** A finished deck's top (deck-floors.02): its colour, and the pattern's lines and shapes when they draw in 3D. */
export type DeckFloor = { color: string; lines: readonly FloorLine[]; shapes: readonly FloorShape[] };
export type DeckItem = { item: "deck"; deck: string; fills: readonly { ring: Ring; holes: readonly Ring[] }[]; edges: readonly { a: Point; b: Point }[]; bottom: number; top: number; selected: boolean; finish: DeckFloor | null };

/** One stretch of a deck's guard (`guardRuns`), `key` telling it from the deck's others. */
export type GuardItem = { item: "guard"; key: string; kind: GuardRun["kind"]; a: Point; b: Point; bottom: number; top: number };

export type Item3d = PieceItem | WallItem | FloorItem | DeckItem | GuardItem;

/** A point in metres, z up from the floor. */
export type Point3 = { x: number; y: number; z: number };
/** One flat face in metres, its holes, its colour, and the item it belongs to (`itemKey`). */
/**
 * A flat face wound from outside (real3d.09); `owner` is its item's key (itemKey), which tests read and a 3D pick could.
 * `lines` draw with its edges, over it or the faces round it (a floor's joints; Grid's lines, carried by the ground's
 * middle disc out to the plate's rim, surroundings.16); `outline: false` leaves out its outline edges but not its
 * `lines` (a floor pattern's shapes, shown.12; the ground's faces).
 */
export type Face3d = { points: readonly Point3[]; holes: readonly (readonly Point3[])[]; color: string; owner: string; lines?: readonly Line3d[]; outline?: false };
/**
 * A segment drawn with a face's edges, in its own colour, over that face or the faces round it: a floor's pattern
 * joint (finishes.12), or one of Grid's lines over the ground's rings (surroundings.16).
 */
export type Line3d = { a: Point3; b: Point3; color: string };
/** The camera's angles in degrees (real3d.03): yaw, the direction from the drawing to the camera counter-clockwise from +x; tilt, how far it looks down. */
export type Angles3d = { yaw: number; tilt: number };
/**
 * The box the camera frames: the walls' plan bounds, from `bottom` (absent: the floor, 0) up to `top` (the ceiling).
 * `pull` (absent: 1) scales the picture about the box's centre, so the surroundings' ground fits round the house; with it the
 * depth range covers the frame's whole sphere (surroundings.04, .14). Both stay absent with no surroundings, and then
 * the camera and its depth range are exactly as before.
 */
export type Bounds3 = { min: Point; max: Point; top: number; bottom?: number; pull?: number };
/**
 * A 3D scene (real3d.11): the items, the box the camera frames, and the walls hidden at the camera's yaw; `ground`, the
 * surroundings' faces round the house (`groundFaces`), and `background`, the colour they fade into and the picture is
 * cleared to; both absent with none, and then the palette's background (STYLE_3D) clears it. `trailer`: the faces under
 * a house on wheels (`trailerFaces`), drawn with the house's; absent otherwise.
 */
export type View3d = { items: readonly Item3d[]; bounds: Bounds3; hidden: ReadonlySet<string>; ground?: readonly Face3d[]; background?: string; trailer?: readonly Face3d[]; roof?: readonly Face3d[] };
/**
 * What the shell's 3D panel draws: the scene, the camera's angles and the panel's size (heights.18). The scene keeps
 * its identity while only the angles change, so a renderer builds its triangles once per scene (real3d.11).
 */
export type View3dFrame = { scene: View3d; angles: Angles3d; size: "corner" | "split" };
