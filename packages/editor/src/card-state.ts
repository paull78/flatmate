import { fromStored, orderedStates } from "@fm/domain";
import { FLIP_MS } from "./flip-clock";
import type { WorkspaceEvent } from "./ports/events";
import type { Host } from "./ports/host";
import type { CardDrawing, EditorState, Step } from "./state";
import { ORBIT_DEG_PER_PX, wrapped } from "./view3d-state";
import { DEFAULT_ANGLES, TILT_MAX, TILT_MIN } from "./view3d/camera3d";

// The project cards' per-viewer state (cycle cards): the fetched drawings, the hovered card's angles and each card's chosen layout.

/** What the list forgets each time it opens (cards.02): its drawings, so edits show, and how its cards were being looked at. */
export const NO_CARD_VIEWS = { cards: {}, hover: null, layouts: {}, cardFlip: null };

/** A card came into view: ask for its drawing, once per list opening (cards.02). */
export function cardSeen(state: EditorState, id: string, host: Host): Step {
  const w = state.workspace;
  if (state.document !== null || Object.hasOwn(w.cards, id) || !w.projects.some((p) => p.id === id)) return { state, effects: [] };
  const requestId = host.newId();
  return {
    state: { ...state, workspace: { ...w, cards: { ...w.cards, [id]: { status: "loading", requestId } } } },
    effects: [{ type: "workspace", op: { type: "read", requestId, projectId: id } }],
  };
}

/** An answer to the card's latest request; a drawing that doesn't read shows the card's bare ground, with no error line. */
export function withCardDrawing(state: EditorState, event: Extract<WorkspaceEvent, { type: "drawing" }>): EditorState {
  const w = state.workspace;
  const known = Object.hasOwn(w.cards, event.projectId) ? w.cards[event.projectId] : undefined;
  if (known?.status !== "loading" || known.requestId !== event.requestId) return state;
  const parsed = event.doc === null ? null : fromStored(event.doc);
  const card: CardDrawing = parsed?.ok === true ? { status: "ready", doc: parsed.value } : { status: "failed" };
  return { ...state, workspace: { ...w, cards: { ...w.cards, [event.projectId]: card } } };
}

/** The mouse came onto a card or left: a new card starts at the default angles, and the same card keeps its own. */
export function withCardHover(state: EditorState, id: string | null): EditorState {
  const w = state.workspace;
  if (id === w.hover?.id) return state;
  const hover = id === null ? null : { id, ...DEFAULT_ANGLES };
  return { ...state, workspace: { ...w, hover, cardFlip: null } };
}

/** A drag on the hovered card: right lowers the yaw, as the orbit does; one card width is a full turn (cards.01). */
export function withCardOrbit(state: EditorState, dx: number, dy: number, width: number): EditorState {
  const w = state.workspace;
  if (w.hover === null || !(width > 0)) return state;
  const yaw = wrapped(w.hover.yaw - (dx / width) * 360);
  const tilt = Math.min(TILT_MAX, Math.max(TILT_MIN, w.hover.tilt + ORBIT_DEG_PER_PX * dy));
  return { ...state, workspace: { ...w, hover: { ...w.hover, yaw, tilt } } };
}

/** The pill: the next layout, wrapping. The plan changes at once; the hovered card's 3D view glides, from the layout shown (cards.07). */
export function cardNextLayout(state: EditorState, id: string, host: Host): Step {
  const w = state.workspace;
  const drawing = Object.hasOwn(w.cards, id) ? w.cards[id] : undefined;
  if (drawing?.status !== "ready") return { state, effects: [] };
  const layouts = orderedStates(drawing.doc);
  const from = (Object.hasOwn(w.layouts, id) ? w.layouts[id] : undefined) ?? layouts[0]?.id;
  const to = layouts[(layouts.findIndex((l) => l.id === from) + 1) % layouts.length]?.id;
  if (layouts.length < 2 || from === undefined || to === undefined) return { state, effects: [] };
  const glides = w.hover?.id === id;
  const cardFlip = glides ? { id, from, to, startedAt: host.now(), t: 0 } : null;
  return {
    state: { ...state, workspace: { ...w, layouts: { ...w.layouts, [id]: to }, cardFlip } },
    effects: glides ? [{ type: "requestFrame" }] : [],
  };
}

/** A frame during a card's change of layout, on the editor's flip clock. */
export function onCardFrame(state: EditorState, now: number): Step {
  const w = state.workspace;
  if (w.cardFlip === null) return { state, effects: [] };
  const t = Math.min(1, Math.max(0, (now - w.cardFlip.startedAt) / FLIP_MS));
  if (t >= 1) return { state: { ...state, workspace: { ...w, cardFlip: null } }, effects: [] };
  return { state: { ...state, workspace: { ...w, cardFlip: { ...w.cardFlip, t } } }, effects: [{ type: "requestFrame" }] };
}

