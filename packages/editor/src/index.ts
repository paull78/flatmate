// Public API of @fm/editor. Shells import only from here, and change state only through `update`: the document,
// history and camera helpers are internal. Named exports only, so a new module export is not public by accident.
export {
  NO_MODS, type Mods, type ProjectInfo, type RemotePresence, type Size, type SnapKind, type SnapResult, type ToolName,
} from "./types";
export { screenToWorld, worldToScreen, type Camera } from "./camera";
export type { FontSpec, Host } from "./ports/host";
export type { Effect, WorkspaceOp } from "./ports/effects";
export type { Event, PointerInput, ServerEvent, UiAction, WorkspaceEvent } from "./ports/events";
export { clientMessageFor, serverMessageEvent, type ServerEffect } from "./ports/wire";
export type { Align, Color, Layer, LayerName, Primitive, Scene, Width } from "./view/scene-types";
export { buildViewModel, type Field, type ViewModel } from "./view/view-model";
export { buildScene } from "./view/scene";
export { COLORS } from "./view/colors";
export { HELPER_FONT, TAG_FONT, UI_FONT } from "./view/fonts";
// Types only: they describe what `EditorState` holds.
export type {
  CommitInput, DocStep, DocumentStatus, LocalDocument, Notice, OpenDocument, SharedDocument,
} from "./document/types";
export type { HistoryState, UndoEntry, UndoRequest } from "./history/history";
export type { SnapAxis, SnapCandidate } from "./snapping/policies";
export type {
  DragTarget, MoveAttempt, SelectToolState, ToolState, WallPreview, WallToolState, ZoneToolState,
} from "./tools/types";
export { initialState, type EditorState, type InitOptions, type Step } from "./state";
export { update } from "./update";
export { helperLabelAt } from "./view/helper";
export { formatArea } from "./view/tags";
// Read-only queries on the open document, the snapshot constructor, and the notice texts hosts and tests match on.
export { hasPendingEdit, sessionOf, visibleDoc } from "./document/open-document";
export { sharedFromSnapshot, type SnapshotEvent } from "./document/shared-document";
export { REMOTE_REDO, REMOTE_UNDO } from "./history/history";
export { CHAIN_ENDED, CONNECTION_LOST, GESTURE_CANCELLED } from "./gestures";
export { LEAVE_BLOCKED, NAME_REQUIRED, OFFLINE_LIST } from "./session";
