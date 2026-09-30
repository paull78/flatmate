import { distance, faceAt, hitCandidates, zones, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState } from "../state";
import { tagAt } from "../view/tags";
import { draggedJoints } from "./types";

export const DRAG_THRESHOLD_PX = 4; // spec §5.7
export const HIT_TOLERANCE_PX = 6;
export const HANDLE_HIT_PX = 8;

export type Hit = { ref: EntityRef; handle: boolean };

/**
 * Handles of the selected wall win, then joints, walls, zone tags and labelled floors (spec §5.6).
 * The Select tool checks the helper dimension before calling this (Task 5.7).
 */
export function hitTest(state: EditorState, world: Point, host: Host): Hit | null {
  if (!state.document) return null;
  const doc = visibleDoc(state.document);
  const handle = handleHit(state, doc, world);
  if (handle) return handle;
  const first = hitCandidates(doc, world, HIT_TOLERANCE_PX / state.camera.zoom)[0];
  if (first) return { ref: first, handle: false };
  const label = tagAt(doc, world, state.camera, host) ?? labelAtFloor(doc, world);
  return label ? { ref: { table: "zoneLabels", id: label }, handle: false } : null;
}

/** The label of the labelled room under the point; null on a boundary, outside, or in an unlabelled room. */
export function labelAtFloor(doc: Document, world: Point): string | null {
  const face = faceAt(doc, world);
  if (!face) return null;
  return zones(doc).find((z) => z.face.key === face.key)?.labelIds[0] ?? null;
}

/** The nearest handle in range; endpoint `a` wins an exact tie. */
function handleHit(state: EditorState, doc: Document, world: Point): Hit | null {
  const selected = state.selection[0];
  if (!selected || selected.table !== "walls") return null;
  let best: { id: string; d: number } | null = null;
  for (const id of draggedJoints(doc, { kind: "wall", wallId: selected.id })) {
    const j = doc.joints[id];
    const d = j ? distance(j, world) : Infinity;
    if (d <= HANDLE_HIT_PX / state.camera.zoom && (!best || d < best.d)) best = { id, d };
  }
  return best ? { ref: { table: "joints", id: best.id }, handle: true } : null;
}
