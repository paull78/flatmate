import type { Box } from "@fm/domain";
import type { Point } from "@fm/protocol";

// What to draw, in world coordinates, in ordered layers (spec: editor).
export type Color = string;
export type Width = { px: number } | { m: number }; // screen-constant hairlines vs. world-scaled
export type Align = "left" | "center" | "right";
/** The two fonts text is drawn and measured in (render.15): Inter on screen and in look, Helvetica on paper. */
export type Font = "inter" | "helvetica";
/** A face of paper's Helvetica (sheetset.05): absent is regular. Only sheet pages set it, and `encode.ts` skips text, so no GPU atlas sees it. */
export type FontStyle = "bold" | "oblique";
/** A dash is one on/off pair in drawing units (render.05): every backend draws exactly this. */
export type Dash = readonly [on: number, off: number];

export type Primitive =
  | { kind: "segment"; a: Point; b: Point; width: Width; color: Color; cap: "butt" | "round"; dash?: Dash }
  | { kind: "polygon"; points: readonly Point[]; holes: readonly (readonly Point[])[]; color: Color } // readonly: zone fills pass cached domain rings; holes are cut out (even-odd), `[]` when none
  | { kind: "arc"; center: Point; radius: number; from: number; to: number; width: Width; color: Color }
  | { kind: "disc"; center: Point; radius: Width; color: Color }
  | { kind: "text"; text: string; at: Point; size: number; color: Color; align: Align; rotation: number; font: Font; style?: FontStyle }; // size in px; drawn in `font`, measured by its table (render.15)

export type LayerName = "grid" | "ghosts" | "finishes" | "zoneFills" | "deckFloors" | "decks" | "objects" | "overheads" | "warnings" | "walls" | "openings" | "deckLabels" | "tags" | "dimensions" | "marks" | "annotations" | "overlays" | "presence";
/** Read-only: an unchanged layer is the same array from one Scene to the next (spec: editor). */
export type Layer = { name: LayerName; primitives: readonly Primitive[] };
/**
 * The plan underlay (import.11, .17): the picture as base64 JPEG, stretched over `rect` (plan metres, y up), drawn
 * beneath the grid at alpha 1 − fade. Not a Primitive or a layer, so exports never see it. `pictureId` keys a decoded
 * picture cache.
 */
export type SceneUnderlay = { pictureId: string; data: string; rect: Box; fade: number };
// layers: always every name, in LAYER_ORDER. underlay: null with no picture, or while this viewer hides it.
export type Scene = { layers: Layer[]; underlay: SceneUnderlay | null };

/** The layers built fresh on every event; the document layers come from memoized builders (spec: editor). */
export type Layers = Record<Exclude<LayerName, "walls" | "ghosts" | "finishes" | "openings" | "zoneFills" | "deckFloors" | "decks" | "overheads" | "deckLabels" | "tags" | "dimensions" | "marks" | "objects" | "warnings">, Primitive[]>;
