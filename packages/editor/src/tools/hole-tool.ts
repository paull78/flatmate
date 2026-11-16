import { MESSAGES, deckFrame, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { switchTool, viewedLevelOn, type EditorState, type Step } from "../state";
import { reasonOf } from "../toast-text";
import { pressPointer } from "./deck-tool";
import { clickedHole, deckForHole, drawnHole, drawnHoleMark } from "./hole-draft";
import { PREVIEW_OP, type DeckToolState } from "./types";

/**
 * The Hole tool (smalls.12, stairwell.08): cuts a slab that exists, so it stays on the level in view. A drag cuts along
 * the axes of the deck under its press, a click 1.00 × 1.00 there: at an upper level only that level's decks, at the floor
 * any deck, a platform included. Its corners snap to the deck's sides and its holes' (hole-draft.ts), and say so.
 */
export function holePointer(state: EditorState, tool: DeckToolState, e: PointerInput, host: Host): Step {
  const tolerance = (ctrl: boolean): number => (ctrl ? 0 : state.snapSettings.tolerancePx / state.camera.zoom);
  const under = (doc: Document, p: Point) => deckForHole(doc, p, viewedLevelOn(state, doc));
  return pressPointer(state, tool, e, host, {
    wrap: withHole,
    drawn: (doc, a, b, opId, ctrl) => {
      const deck = under(doc, a);
      return deck && drawnHole(deck, a, b, tolerance(ctrl), opId);
    },
    clicked: (doc, press, world, opId) => {
      const deck = under(doc, press);
      return deck && clickedHole(deck, world, opId);
    },
    mark: (doc, a, b, ctrl) => {
      const deck = under(doc, a);
      return deck && drawnHoleMark(deck, a, b, tolerance(ctrl), PREVIEW_OP);
    },
  });
}

/** The hole being drawn, for the overlay: its ring, along its deck's axes as it will be cut, and whether it would be accepted. */
export function holeDraft(state: EditorState): { ring: Point[]; ok: boolean } | null {
  const tool = state.tool;
  if (tool.name !== "hole" || tool.state.kind !== "pressing" || tool.state.current === null || !state.document) return null;
  const { start, current, ok } = tool.state;
  const doc = visibleDoc(state.document);
  const deck = deckForHole(doc, start, viewedLevelOn(state, doc));
  if (deck === null) return { ring: [start, { x: current.x, y: start.y }, current, { x: start.x, y: current.y }], ok };
  const frame = deckFrame(deck);
  const [a, b] = [frame.toDeck(start), frame.toDeck(current)];
  return { ring: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map((p) => frame.toPlan(p)), ok };
}

/** Why the hole a drag draws is refused, in the toast's words; with no deck under its press, that; null when it isn't. */
export function holeReason(state: EditorState, start: Point, current: Point): string | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  if (!doc) return null;
  const deck = deckForHole(doc, start, viewedLevelOn(state, doc));
  return deck ? reasonOf(doc, drawnHole(deck, start, current, state.snapSettings.tolerancePx / state.camera.zoom, PREVIEW_OP)) : MESSAGES.holeNoDeck;
}

/** Esc drops a press; with none, it picks the Select tool. */
export function holeEscape(state: EditorState, tool: DeckToolState): EditorState {
  return tool.kind === "pressing" ? withHole({ ...state, snap: null }, { kind: "idle" }) : switchTool(state, "select");
}

function withHole(state: EditorState, tool: DeckToolState): EditorState {
  return { ...state, tool: { name: "hole", state: tool } };
}
