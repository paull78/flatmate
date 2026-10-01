import { isValidId } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import { hasPendingEdit, onEvent, sessionOf } from "./document/open-document";
import { sharedFromSnapshot, type SnapshotEvent } from "./document/shared-document";
import { emptyHistory } from "./history/history";
import { applyNotices } from "./notices";
import type { Effect } from "./ports/effects";
import type { ServerEvent, UiAction, WorkspaceEvent } from "./ports/events";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";
import { showToast } from "./toast";
import { idleTool } from "./tools/types";

// Project list, opening, connection, identity and presence (spec §7.2.1, §7.6).
// Document rules stay in open-document; this module only routes events to it.

export type WorkspaceUiAction = Extract<UiAction, { type: "createProject" | "openProject" | "showProjectList" | "deleteProject" }>;

export const OFFLINE_LIST = "Offline: reconnecting…";
export const LEAVE_BLOCKED = "Waiting for server: try again when the edit is saved";
export const NAME_REQUIRED = "Type a project name";
export const PROJECT_DELETED = "This project was deleted";

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
  if (state.mode === "local") return { state, effects: [] }; // one unsaved drawing and no project list (§7.0)
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
    case "deleteProject": {
      // Only from the list: no drawing open, no open in progress; the reply is the new list (§7.2.1).
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

/** Presence after a pointer move, only while a shared document is connected (§7.6). The adapter throttles it. */
export function pointerPresence(state: EditorState): Effect[] {
  const session = state.document ? sessionOf(state.document) : null;
  if (!session || !session.connected) return [];
  return [{
    type: "presence", projectId: session.projectId, generation: session.generation,
    cursor: state.pointer?.world ?? null, selection: state.selection,
  }];
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

/** A new connection is a new server session: presence is not replayed (§7.2.1). */
function onConnection(state: EditorState, connection: "open" | "closed", host: Host): Step {
  const cleared: EditorState = { ...state, presence: {} };
  if (state.document) return documentEvent(cleared, { type: "connection", state: connection }, host);
  if (connection === "closed") {
    return { state: { ...cleared, workspace: { ...cleared.workspace, loading: false, error: OFFLINE_LIST } }, effects: [] };
  }
  const effects: Effect[] = [{ type: "workspace", op: { type: "list", requestId: host.newId() } }];
  let workspace = { ...cleared.workspace, loading: true, error: null };
  const opening = cleared.workspace.opening;
  if (opening) {
    const generation = host.newId(); // the new session knows nothing of the old open
    workspace = { ...workspace, opening: { projectId: opening.projectId, generation } };
    effects.push({ type: "workspace", op: { type: "open", projectId: opening.projectId, generation } });
  }
  return { state: { ...cleared, workspace }, effects };
}

/** Whether a reply answers the open in progress: same project and generation (§7.2.1). */
function answersOpening(state: EditorState, e: { projectId: string; generation: string }): boolean {
  const opening = state.workspace.opening;
  return opening !== null && opening.projectId === e.projectId && opening.generation === e.generation;
}

/** The first snapshot for the generation being opened creates the shared document (§7.0, P7). */
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
 * The server could not open the project this generation asked for; a reply to any other open is stale (§7.2.1).
 * No drawing is open while `opening` is set (opening closed it), so the message goes to the list, not a toast.
 * Failing the open drawing's own reopen (after a reconnect or resync, §7.7) means it was deleted meanwhile.
 */
function openFailed(state: EditorState, e: OpenFailedEvent, host: Host): Step {
  if (isCurrent(state, e)) return projectGone(state, host);
  if (!answersOpening(state, e)) return { state, effects: [] };
  return { state: { ...state, workspace: { ...state.workspace, loading: false, error: e.message, opening: null } }, effects: [] };
}

/** The open project was deleted: back to the list without waiting for an outstanding edit, which is dropped (§7.2.1). */
function projectGone(state: EditorState, host: Host): Step {
  const listed = showList(state, host);
  const toast = showToast(listed.state, PROJECT_DELETED, host);
  return { state: toast.state, effects: [...listed.effects, ...toast.effects] };
}

/** Switching waits for the outstanding submission to settle (§7.2.1); it is refused, never queued. */
function leaveRefused(state: EditorState, host: Host): Step | null {
  return state.document && hasPendingEdit(state.document) ? showToast(state, LEAVE_BLOCKED, host) : null;
}

function openProject(state: EditorState, projectId: string, host: Host): Step {
  const generation = host.newId();
  const closed = closeDocument(state);
  return {
    state: { ...closed, workspace: { ...closed.workspace, loading: true, error: null, opening: { projectId, generation } } },
    effects: [{ type: "workspace", op: { type: "open", projectId, generation } }],
  };
}

function showList(state: EditorState, host: Host): Step {
  const closed = closeDocument(state);
  return {
    state: { ...closed, workspace: { ...closed.workspace, loading: true, error: null, opening: null } },
    effects: [{ type: "workspace", op: { type: "list", requestId: host.newId() } }],
  };
}

/** Opening or leaving a drawing clears gestures, selection, presence and history (§7.0, §7.2.1). */
function closeDocument(state: EditorState): EditorState {
  return {
    ...state,
    document: null,
    tool: idleTool(state.tool.name),
    selection: [],
    hover: null,
    snap: null,
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
      [e.clientId]: { clientId: e.clientId, name: e.name, color: e.color, cursor: e.cursor, selection: e.selection },
    },
  };
}
