import { isValidId, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import type { ToolName } from "../types";

export const PREVIEW_OP = "preview"; // preview walls get IDs "preview/…"; never committed

export type WallPreview = { from: Point; to: Point } & ({ ok: true; doc: Document } | { ok: false });

// Spec §5.5. Fields not listed in a transition carry over unchanged.
export type WallToolState =
  | { kind: "idle" }
  // dragFrom: the raw world point of the press that started the chain, until its release (one drag = one wall).
  | { kind: "drawing"; origin: Point; chainStart: Point; value: string; preview: WallPreview | null; dragFrom: Point | null }
  | { kind: "paused"; origin: Point; chainStart: Point; segment: string }; // segment = commit ID (shared documents)

export type DragTarget = { kind: "joint"; jointId: string } | { kind: "wall"; wallId: string };

export type Moves = { jointId: string; to: Point }[];

// moves = what this attempt tried; release commits exactly these. doc = the preview drawn: the attempt's
// result when ok, else the last valid preview (or baseDoc).
export type MoveAttempt = { ok: boolean; doc: Document; cursor: Point; moves: Moves };

// Spec §5.6 and §5.7.
export type SelectToolState =
  | { kind: "idle" }
  | { kind: "pressing"; pressWorld: Point; target: DragTarget | null }
  | { kind: "moving"; target: DragTarget; pressWorld: Point; baseDoc: Document; attempt: MoveAttempt }
  | { kind: "editingHelper"; wallId: string; value: string }; // entered in phase 5

export type ZoneToolState = { kind: "idle"; hoverFaceKey: string | null }; // behaviour in phase 5

export type ToolState =
  | { name: "select"; state: SelectToolState }
  | { name: "wall"; state: WallToolState }
  | { name: "zone"; state: ZoneToolState };

export function idleTool(name: ToolName): ToolState {
  switch (name) {
    case "select":
      return { name: "select", state: { kind: "idle" } };
    case "wall":
      return { name: "wall", state: { kind: "idle" } };
    case "zone":
      return { name: "zone", state: { kind: "idle", hoverFaceKey: null } };
    default:
      return assertNever(name);
  }
}

/** The joints a drag moves: the joint itself, or both ends of a wall. */
export function draggedJoints(doc: Document, target: DragTarget): string[] {
  switch (target.kind) {
    case "joint":
      return [target.jointId];
    case "wall": {
      const w = isValidId(target.wallId) ? doc.walls[target.wallId] : undefined;
      return w ? [w.a, w.b] : [];
    }
    default:
      return assertNever(target);
  }
}
