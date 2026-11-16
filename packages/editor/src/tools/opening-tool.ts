import { execute, hitCandidates, newOpeningId, openingDefaults, suggestOpening, wallOpenableAt, type Command, type Document, type Opening } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { viewedLevelOn, type EditorState, type Step } from "../state";
import { refuse } from "../toast";
import { reasonOf } from "../toast-text";
import { HIT_TOLERANCE_PX } from "./hit-test";
import { PREVIEW_OP, type OpeningPreview, type OpeningToolState } from "./types";

/**
 * The Opening tool (spec: openings): hovering a wall previews the armed kind at the pointer's projection, red where it
 * would not fit; a click adds it, as suggestOpening places it. The kind stays armed; a refused click toasts why. It works
 * at every level, on the walls the level reaches, with heights from the level (sills.06, `openingDefaults`).
 */
export function openingPointer(state: EditorState, tool: OpeningToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  switch (e.type) {
    case "pointerMove":
    case "pointerUp":
      return { state: withPreview(state, tool), effects: [] };
    case "pointerDown": {
      const s = suggestion(state, visibleDoc(state.document), pointer.world);
      if (!s) return { state, effects: [] };
      if (s.refused !== null) return refuse(state, s.refused, host);
      const out = runCommand(state, addCommand(s.opening, host.newId()), host);
      return { state: withPreview(out.state, tool), effects: out.effects };
    }
    default:
      return assertNever(e.type);
  }
}

/** The preview at the pointer, on the visible document: drawn as an overlay, so the document layers stay as they are. */
function withPreview(state: EditorState, tool: OpeningToolState): EditorState {
  const doc = state.document ? visibleDoc(state.document) : null;
  const s = doc && state.pointer ? suggestion(state, doc, state.pointer.world) : null;
  let preview: OpeningPreview | null = null;
  if (doc && s) preview = { opening: s.opening, ok: s.refused === null && execute(doc, addCommand(s.opening, PREVIEW_OP)).ok, refused: s.refused };
  return { ...state, tool: { name: "opening", state: { ...tool, preview } }, snap: null, hover: null, hoverHandle: null };
}

/** Why a red preview is refused (clarity.03). A preview keeps no error: worked out only when the rest fires. */
export function openingReason(state: EditorState, preview: OpeningPreview): string | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  return preview.refused ?? (doc && reasonOf(doc, addCommand(preview.opening, PREVIEW_OP)));
}

function addCommand({ wall, kind, offset, width, side, hinge, sill, head }: Opening, opId: string): Command {
  return { type: "addOpening", opId, wall, kind, offset, width, side, hinge, sill, head };
}

/**
 * The armed kind's opening on the nearest wall under the point that the viewed level reaches (`wallOpenableAt`), with the
 * level's heights, and why the level can't place it (`refused`); null off every such wall.
 */
function suggestion(state: EditorState, doc: Document, world: Point): { opening: Opening; refused: string | null } | null {
  const level = viewedLevelOn(state, doc);
  const wall = hitCandidates(doc, world, HIT_TOLERANCE_PX / state.camera.zoom).find((r) => r.table === "walls" && wallOpenableAt(doc, r.id, level))?.id;
  const s = wall === undefined ? null : suggestOpening(doc, wall, world, state.openingKind);
  const heights = wall === undefined || !s ? null : openingDefaults(doc, wall, state.openingKind, level.height, { from: s.offset, to: s.offset + s.width });
  if (wall === undefined || !s || !heights) return null;
  const opening: Opening = { id: newOpeningId(PREVIEW_OP), wall, kind: state.openingKind, glazed: false, ...s };
  return "refused" in heights ? { opening, refused: heights.refused } : { opening: { ...opening, ...heights }, refused: null };
}
