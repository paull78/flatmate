import type { EntityKey, Point } from "@fm/protocol";

export type Mods = { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
export const NO_MODS: Readonly<Mods> = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false });

export type Size = { width: number; height: number };
export type ToolName = "select" | "wall" | "zone";
export type SnapKind = "endpoint" | "midpoint" | "perpendicular" | "onWall" | "angle" | "aligned" | "grid" | "none";
/**
 * `guides`: the points guide lines are drawn from. Aligned: the joints it lines up with (x first, then y). Angle: the
 * origin, then the joint on a tie. Perpendicular: the origin (it turns the right-angle mark).
 */
export type SnapResult = { point: Point; kind: SnapKind; guides?: readonly Point[] };
export type ProjectInfo = { id: string; name: string };
export type RemotePresence = { clientId: string; name: string; color: string; cursor: Point | null; selection: EntityKey[] };
