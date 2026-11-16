import { MIN_HEIGHT, heightsOf, lowerable, placementFit } from "@fm/domain";
import { visibleDoc } from "../document/open-document";
import { activeStateId, type EditorState } from "../state";
import { armedSize } from "./armed-size";

// What a red click ghost's plate advises (sizing.09, .15, .21 a): a drag for a plan reason, a lower height for a
// height reason, worked out from the fit as data, never from the refusal's words.

/** The plate's second line for each advice. */
export const ADVICE = { draw: "Drag to draw it to size", height: "Type a lower height" } as const satisfies Record<string, string>;

/**
 * The advice for the Object tool's red click ghost: none where it fits, has no floor, is a set's, a stair's at a caught
 * edge, or a drawn footprint. Otherwise the ghost's own place is tried again at the lowest height (its elevation the
 * armed one's): if that fits, height was the reason, and the advice is a lower height for a kind that may be lowered
 * (none for others); if not, the plan was, and the advice is a drag.
 */
export function ghostAdvice(state: EditorState): keyof typeof ADVICE | null {
  const tool = state.tool.name === "object" ? state.tool.state : null;
  const ghost = tool?.ghost;
  if (!tool || !ghost || ghost.fits || ghost.noFloor || state.objectSet !== null || tool.stair !== null || tool.pressing?.corner) return null;
  const doc = state.document ? visibleDoc(state.document) : null;
  const layout = activeStateId(state);
  const size = armedSize(state);
  const heights = size ? heightsOf(size, ghost.config) : null;
  if (!doc || layout === null || !heights) return null;
  const { kind, config, at, rotation, w, d, surface } = ghost;
  const low = placementFit(doc, { kind, state: layout, at, rotation, config, w, d, surface, h: MIN_HEIGHT, z: heights.z });
  if (!low.fits) return "draw";
  return lowerable(kind) ? "height" : null;
}
