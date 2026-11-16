import { isFloor, isValidId } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { NO_CARD_VIEWS, cardNextLayout, cardSeen, withCardDrawing, withCardHover, withCardOrbit } from "./card-state";
import { hasPendingEdit, onEvent, sessionOf } from "./document/open-document";
import { sharedFromSnapshot, snapshotParses, type SnapshotEvent } from "./document/shared-document";
import { emptyHistory } from "./history/history";
import { applyNotices } from "./notices";
import type { Effect } from "./ports/effects";
import type { ServerEvent, UiAction, WorkspaceEvent } from "./ports/events";
import type { Host } from "./ports/host";
import { activeStateId, viewedLevel, type EditorState, type Step } from "./state";
import { showToast } from "./toast";
import { idleTool } from "./tools/types";

// Project list, opening, connection, identity and presence (spec: collaboration).
// Document rules stay in open-document; this module only routes events to it.

type WorkspaceUiAction = Extract<UiAction, { type: "createProject" | "openProject" | "showProjectList" | "deleteProject" | "cardSeen" | "cardHover" | "cardOrbit" | "cardNextLayout" | "setCardOrder" }>;

export const OFFLINE_LIST = "Offline: reconnecting…";
export const LEAVE_BLOCKED = "Waiting for server: try again when the edit is saved";
export const NAME_REQUIRED = "Type a project name";
export const PROJECT_DELETED = "This project was deleted";
export const CANT_OPEN = "This project can't be opened";

type PresenceEvent = Extract<ServerEvent, { type: "presence" }>;
type OpenFailedEvent = Extract<ServerEvent, { type: "openFailed" }>;

export function onWorkspaceEvent(state: EditorState, event: WorkspaceEvent, host: Host): Step {
  switch (event.type) {
    case "projects":
      return { state: { ...state, workspace: { ...state.workspace, projects: event.items, loading: false, error: null } }, effects: [] };
    case "created": {
      const listed = { ...state, workspace: { ...state.workspace, projects: [...state.workspace.projects, event.meta] } };
      // Creating a project opens it, unless the user opened something else meanwhile (a late reply must not
      // replace that open or close a drawing with an outstanding edit).
      if (state.document !== null || state.workspace.opening !== null) return { state: listed, effects: [] };
      return openProject(listed, event.meta.id, host);
    }
    case "drawing":
      return { state: withCardDrawing(state, event), effects: [] };
    case "failed": {
      // Never touches `opening`: an error is not tied to an open, and a late one must not cancel a newer open.
      const failed = { ...state, workspace: { ...state.workspace, loading: false, error: event.message } };
      return failed.document ? showToast(failed, event.message, host) : { state: failed, effects: [] };
    }
    default:
      return assertNever(event);
  }
}

export function onServerEvent(state: EditorState, event: ServerEvent, host: Host): Step {
  switch (event.type) {
    case "welcome":
      return { state: { ...state, me: { ...state.me, color: event.color } }, effects: [] };
    case "presence":
      return { state: withPresence(state, event), effects: [] };
    case "presenceLeft": {
      if (!isCurrent(state, event) || !isValidId(event.clientId)) return { state, effects: [] };
      const presence = Object.fromEntries(Object.entries(state.presence).filter(([id]) => id !== event.clientId));
      return { state: { ...state, presence }, effects: [] };
    }
    case "connection":
      return onConnection(state, event.state, host);
    case "snapshot":
      if (!snapshotParses(event)) return snapshotRefused(state, event, host);
      return state.document ? documentEvent(state, event, host) : openFromSnapshot(state, event);
    case "openFailed":
      return openFailed(state, event, host);
    case "projectDeleted":
      return isCurrent(state, event) ? projectGone(state, host) : { state, effects: [] };
    case "changes":
    case "ack":
    case "rejected":
      return documentEvent(state, event, host);
    default:
      return assertNever(event);
  }
}

export function onWorkspaceUi(state: EditorState, action: WorkspaceUiAction, host: Host): Step {
  if (state.mode === "local") return { state, effects: [] }; // one unsaved drawing and no project list (spec: collaboration)
  switch (action.type) {
    case "createProject": {
      const name = action.name.trim();
      if (name === "") return showToast(state, NAME_REQUIRED, host);
      return { state, effects: [{ type: "workspace", op: { type: "create", requestId: host.newId(), name } }] };
    }
    case "openProject":
      return leaveRefused(state, host) ?? openProject(state, action.id, host);
    case "showProjectList":
      return leaveRefused(state, host) ?? showList(state, host);
    case "cardSeen":
      return cardSeen(state, action.id, host);
    case "cardHover":
      return { state: withCardHover(state, action.id), effects: [] };
    case "cardOrbit":
      return { state: withCardOrbit(state, action.dx, action.dy, action.width), effects: [] };
    case "cardNextLayout":
      return cardNextLayout(state, action.id, host);
    case "setCardOrder":
      return { state: { ...state, workspace: { ...state.workspace, order: action.order } }, effects: [] };
    case "deleteProject": {
      // Only from the list: no drawing open, no open in progress; the reply is the new list (spec: collaboration).
      if (state.document !== null || state.workspace.opening !== null || !isValidId(action.id)) return { state, effects: [] };
      return {
        state: { ...state, workspace: { ...state.workspace, loading: true, error: null } },
        effects: [{ type: "workspace", op: { type: "delete", requestId: host.newId(), projectId: action.id } }],
      };
    }
    default:
      return assertNever(action);
  }
}

/**
 * Presence after a pointer move or a change of active state or level, only while a shared document is connected
 * (spec: collaboration, layouts, levels.11). The adapter throttles it.
 */
export function pointerPresence(state: EditorState): Effect[] {
  const session = state.document ? sessionOf(state.document) : null;
  if (!session || !session.connected) return [];
  return [{
    type: "presence", projectId: session.projectId, generation: session.generation,
    cursor: state.pointer?.world ?? null, selection: state.selection, state: activeStateId(state), level: presenceLevel(state),
  }];
}

/**
 * Tells the others when this user's active state or level changed during a step (spec: layouts, levels.11): picking a state,
 * adding one, or a deletion (local or remote) moving them to the first state; viewing another level, or the viewed
 * deck leaving the levels. Opening a drawing is not a change.
 */
export function presenceOnStateChange(before: EditorState, r: Step): Step {
  const from = activeStateId(before);
  const to = activeStateId(r.state);
  if (from === null || to === null || r.effects.some((e) => e.type === "presence")) return r;
  if (from === to && presenceLevel(before) === presenceLevel(r.state)) return r;
  return { state: r.state, effects: [...r.effects, ...pointerPresence(r.state)] };
}

/** The level presence names: the viewed deck while it is a level, else null for the floor. */
function presenceLevel(state: EditorState): string | null {
  const level = viewedLevel(state);
  return level === null || isFloor(level) ? null : state.viewedDeck;
}

/** Events for the open document go through open-document; its notices reach history and tools. */
function documentEvent(state: EditorState, event: ServerEvent, host: Host): Step {
  const d = state.document;
  if (!d) return { state, effects: [] };
  const step = onEvent(d, event, host);
  if (step.doc === d && step.effects.length === 0 && step.notices.length === 0) return { state, effects: [] };
  const after = applyNotices({ ...state, document: step.doc }, step.notices, host);
  return { state: after.state, effects: [...step.effects, ...after.effects] };
}

/** A new connection is a new server session: presence is not replayed (spec: collaboration). */
function onConnection(state: EditorState, connection: "open" | "closed", host: Host): Step {
  const cleared: EditorState = { ...state, presence: {} };
  if (state.document) return documentEvent(cleared, { type: "connection", state: connection }, host);
  if (connection === "closed") {
    return { state: { ...cleared, workspace: { ...cleared.workspace, loading: false, error: OFFLINE_LIST } }, effects: [] };
  }
  const effects: Effect[] = [{ type: "workspace", op: { type: "list", requestId: host.newId() } }];
  let workspace = { ...cleared.workspace, loading: true, error: null, ...NO_CARD_VIEWS };
  const opening = cleared.workspace.opening;
  if (opening) {
    const generation = host.newId(); // the new session knows nothing of the old open
    workspace = { ...workspace, opening: { projectId: opening.projectId, generation } };
    effects.push({ type: "workspace", op: { type: "open", projectId: opening.projectId, generation } });
  }
  return { state: { ...cleared, workspace }, effects };
}

/** Whether a reply answers the open in progress: same project and generation (spec: collaboration). */
function answersOpening(state: EditorState, e: { projectId: string; generation: string }): boolean {
  const opening = state.workspace.opening;
  return opening !== null && opening.projectId === e.projectId && opening.generation === e.generation;
}

/** The first snapshot for the generation being opened creates the shared document (spec: collaboration, P7). */
function openFromSnapshot(state: EditorState, e: SnapshotEvent): Step {
  if (!answersOpening(state, e)) return { state, effects: [] };
  return {
    state: {
      ...closeDocument(state),
      document: sharedFromSnapshot(e),
      workspace: { ...state.workspace, loading: false, error: null, opening: null },
    },
    effects: [],
  };
}

/**
 * The server could not open the project this generation asked for; a reply to any other open is stale (spec: collaboration).
 * No drawing is open while `opening` is set (opening closed it), so the message goes to the list, not a toast.
 * Failing the open drawing's own reopen (after a reconnect or resync, spec: collaboration) means it was deleted meanwhile.
 */
function openFailed(state: EditorState, e: OpenFailedEvent, host: Host): Step {
  if (isCurrent(state, e)) return projectGone(state, host);
  if (!answersOpening(state, e)) return { state, effects: [] };
  return { state: { ...state, workspace: { ...state.workspace, loading: false, error: e.message, opening: null } }, effects: [] };
}

/** The open project was deleted: back to the list without waiting for an outstanding edit, which is dropped (spec: collaboration). */
function projectGone(state: EditorState, host: Host): Step {
  return backToList(state, PROJECT_DELETED, host);
}

function backToList(state: EditorState, reason: string, host: Host): Step {
  const listed = showList(state, host);
  const toast = showToast(listed.state, reason, host);
  return { state: toast.state, effects: [...listed.effects, ...toast.effects] };
}

/**
 * A snapshot today's code can't read: the file came from outside the app, or from other code, since the server validates what
 * it saves. Treated like a failed open, in the browser and in MCP alike; a reply to any other open is stale.
 */
function snapshotRefused(state: EditorState, e: SnapshotEvent, host: Host): Step {
  if (isCurrent(state, e)) return backToList(state, CANT_OPEN, host);
  if (!answersOpening(state, e)) return { state, effects: [] };
  return { state: { ...state, workspace: { ...state.workspace, loading: false, error: CANT_OPEN, opening: null } }, effects: [] };
}

/** Switching waits for the outstanding submission to settle (spec: collaboration); it is refused, never queued. */
function leaveRefused(state: EditorState, host: Host): Step | null {
  return state.document && hasPendingEdit(state.document) ? showToast(state, LEAVE_BLOCKED, host) : null;
}

function openProject(state: EditorState, projectId: string, host: Host): Step {
  const generation = host.newId();
  const closed = closeDocument(state);
  return {
    state: { ...closed, workspace: { ...closed.workspace, loading: true, error: null, opening: { projectId, generation }, hover: null, cardFlip: null } },
    effects: [{ type: "workspace", op: { type: "open", projectId, generation } }],
  };
}

function showList(state: EditorState, host: Host): Step {
  const closed = closeDocument(state);
  return {
    state: { ...closed, workspace: { ...closed.workspace, loading: true, error: null, opening: null, ...NO_CARD_VIEWS } },
    effects: [{ type: "workspace", op: { type: "list", requestId: host.newId() } }],
  };
}

/**
 * Opening or leaving a drawing clears gestures, selection, presence and history (spec: collaboration), and goes back to the
 * floor level; a reconnect's reload keeps the drawing open, so it keeps the level.
 */
function closeDocument(state: EditorState): EditorState {
  return {
    ...state,
    document: null,
    exportOpen: false, // the next drawing opens on its plan
    selectedSheet: null,
    reportDrafts: {},
    viewedDeck: null,
    tool: idleTool(state.tool.name),
    selection: [],
    hover: null,
    hoverHandle: null,
    snap: null,
    plate: null,
    undo: emptyHistory,
    presence: {},
  };
}

function isCurrent(state: EditorState, e: { projectId: string; generation: string }): boolean {
  const session = state.document ? sessionOf(state.document) : null;
  return session !== null && session.projectId === e.projectId && session.generation === e.generation;
}

function withPresence(state: EditorState, e: PresenceEvent): EditorState {
  // clientId becomes a record key: an Object.prototype member name would be read as an inherited member.
  if (!isCurrent(state, e) || !isValidId(e.clientId) || e.clientId === state.me.clientId) return state;
  return {
    ...state,
    presence: {
      ...state.presence,
      [e.clientId]: { clientId: e.clientId, name: e.name, color: e.color, cursor: e.cursor, selection: e.selection, state: e.state, level: e.level },
    },
  };
}
