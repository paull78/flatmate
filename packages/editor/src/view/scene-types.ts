import type { Point } from "@fm/protocol";

// What to draw, in world coordinates, in ordered layers (spec §5.9).
export type Color = string;
export type Width = { px: number } | { m: number }; // screen-constant hairlines vs. world-scaled
export type Align = "left" | "center" | "right";

export type Primitive =
  | { kind: "segment"; a: Point; b: Point; width: Width; color: Color; cap: "butt" | "round"; dash?: number[] }
  | { kind: "polygon"; points: readonly Point[]; color: Color } // readonly: zone fills pass cached domain rings (revised in phase 2)
  | { kind: "arc"; center: Point; radius: number; from: number; to: number; width: Width; color: Color }
  | { kind: "disc"; center: Point; radius: Width; color: Color }
  | { kind: "text"; text: string; at: Point; size: number; color: Color; align: Align; rotation: number }; // size in px

export type LayerName = "grid" | "zoneFills" | "walls" | "annotations" | "overlays" | "presence";
export type Layer = { name: LayerName; primitives: Primitive[] };
export type Scene = { layers: Layer[] }; // always all six layers, in LAYER_ORDER
