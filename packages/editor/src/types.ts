import type { EntityKey, Point } from "@fm/protocol";

export type Mods = { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
export const NO_MODS: Readonly<Mods> = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false });

export type Size = { width: number; height: number };
export type ToolName = "select" | "wall" | "zone" | "object" | "opening" | "dimension" | "column" | "deck" | "section" | "hole" | "scale"; // scale: outside TOOLS (tool-table.ts)
// The snap step the person picks in the floating bar (direct.14): Auto follows the zoom's grid, the others are metres.
export type SnapStep = "auto" | 0.01 | 0.05 | 0.1 | 0.25 | 0.5;
export const SNAP_STEPS: readonly SnapStep[] = ["auto", 0.01, 0.05, 0.1, 0.25, 0.5];
/** The Column tool's size (pillars.12): width along its line, depth across, in metres; this viewer's, never stored. */
export type ColumnSize = { width: number; depth: number };
export const DEFAULT_COLUMN_SIZE: ColumnSize = { width: 0.3, depth: 0.3 };
/** The floating bar's presets, square (spec "The Column tool"). */
export const COLUMN_PRESETS: readonly ColumnSize[] = [0.2, 0.3, 0.4].map((s) => ({ width: s, depth: s }));
export type SnapKind = "endpoint" | "midpoint" | "perpendicular" | "onWall" | "angle" | "aligned" | "equal" | "grid" | "edge" | "none";
/**
 * `guides`: the points guide lines are drawn from. Aligned: the joints it lines up with (x first, then y). Angle: the
 * origin, then the joint on a tie. Perpendicular: the origin (it turns the right-angle mark).
 */
// `word`: what it landed on, drawn beside the marker (a hole's "Edge" or "Hole", AC-03).
export type SnapResult = { point: Point; kind: SnapKind; guides?: readonly Point[]; word?: string };
export type ProjectInfo = { id: string; name: string };
// `state`: the layout state the collaborator is looking at (spec: layouts), as they sent it; it may be unknown here.
export type RemotePresence = { clientId: string; name: string; color: string; cursor: Point | null; selection: EntityKey[]; state: string | null; level: string | null };

// A document's save state as the panels show it (document/types re-exports it).
export type DocumentStatus =
  | "not saved" | "unsaved changes" | "saving" | "saved" | "save failed" | "waiting for server" | "offline";
