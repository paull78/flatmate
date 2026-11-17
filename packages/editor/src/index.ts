// Public API of @fm/editor. Shells import only from here, and change state only through `update`: the document,
// history and camera helpers are internal. Named exports only, so a new module export is not public by accident.
export { brokenApart } from "./break-apart";
export { placeNote } from "./link-note";
export { groupCentre, turnedPlaces } from "./tools/turn";
export { FURNITURE_SETS, furnitureSet, isFurnitureSet, setBox, setHeight, setPieces, setPoses } from "./furniture-sets";
export {
  NO_MODS, type Mods, type ProjectInfo, type RemotePresence, type Size, type SnapKind, type SnapResult, type SnapStep, type ToolName,
} from "./types";
export { screenToWorld, worldToScreen, type Camera } from "./camera";
export type { Host } from "./ports/host";
export type { Effect, ExportContent, ExportPage, ImageHandle, PageClip, PageImage, WorkspaceOp } from "./ports/effects";
export type { Event, PointerInput, ServerEvent, UiAction, UnderlayImport, WorkspaceEvent } from "./ports/events";
export { clientMessageFor, serverMessageEvent, type ServerEffect } from "./ports/wire";
export type { Align, Color, Dash, Font, FontStyle, Layer, LayerName, Primitive, Scene, SceneUnderlay, Width } from "./view/scene-types";
export { buildViewModel, steppedValue, type Field, type ViewModel, type WarningRow } from "./view/view-model";
export type { OpeningChoice } from "./view/view-model-types";
export { CARD_COLOURS } from "./view/cards";
export type { CardLayouts, CardPicture, ProjectCard, SectionStrip, SheetRow, SheetsView } from "./view/view-model-types";
export type { CardOrder } from "./ports/events";
export type { PaletteCard, PaletteGroup } from "./view/palette";
export { buildScene } from "./view/scene";
export { stairCheckLabel, stairCheckText } from "./view/stair-text";
export { toWinAnsi, unsupportedChars } from "./export/charset";
export { REPORT_MARK, reportFirstLine } from "./export/report-text";
export { framedBy, sheetFacts } from "./export/sheet";
export { helveticaWidth } from "./export/helvetica";
export { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, pictureBounds, pictureLayers, planPicture, type PlanPicture, type PlanStyle } from "./view/picture";
export { floorView, type PlanView } from "./view/plan-view";
export {
  LOOK_FADE, LOOK_LONG_SIDE, LOOK_RULER, lookPicture, type LookBackdrop, type LookFrame, type LookPicture,
} from "./view/look";
export { COLOR_PATTERN, COLORS, colorChannels } from "./view/colors";
export { furnitureSymbol } from "./view/furniture"; // the symbol tests, the export package's included
export { FLOOR_TILES, PALETTE_KINDS, floorTileLook, tileLook } from "./view/palette";
export { normalise, searchPalette, type CatalogueEntry, type MatchRange, type PaletteResult } from "./view/palette-search";
export { CHROME_FONT, FONT_FAMILY, HELPER_FONT, INTER_FAMILY, TAG_SIZE, fontMetrics, textWidth, type TextStyle } from "./view/fonts";
// Types only: they describe what `EditorState` holds.
export type {
  CommitInput, DocStep, DocumentStatus, LocalDocument, Notice, OpenDocument, SharedDocument,
} from "./document/types";
export type { HistoryState, UndoEntry, UndoRequest } from "./history/history";
export type { SnapAxis, SnapCandidate } from "./snapping/policies";
export { landsOn as pieceLandsOn } from "./snapping/piece"; // the landing a click asks for, for Claude too (principle 8)
export type {
  DragTarget, MoveAttempt, SelectToolState, ToolState, WallPreview, WallToolState, ZoneToolState,
} from "./tools/types";
export { initialState, type EditorState, type InitOptions, type Step } from "./state";
export { update } from "./update";
export { helperLabelAt } from "./view/helper";
export { formatArea } from "./view/tags";
export { MAX_WALL_THICKNESS, MIN_WALL_THICKNESS, OBJECT_KINDS, SIZE_LIMITS, isOpeningKind, shown } from "@fm/domain"; // bounds for the thickness and column size inputs; the editor validates; isOpeningKind picks the kinds' icons; shown is the one number format
export type { DeckPreset, OpeningKind } from "@fm/domain"; // what pickOpeningKind, pickDeckPreset and the ViewModel carry
// Read-only queries on the open document, the snapshot constructor, and the notice texts hosts and tests match on.
export { hasPendingEdit, sessionOf, visibleDoc } from "./document/open-document";
export { sharedFromSnapshot, type SnapshotEvent } from "./document/shared-document";
export { REMOTE_REDO, REMOTE_UNDO } from "./history/history";
export { CHAIN_ENDED, CONNECTION_LOST, GESTURE_CANCELLED } from "./gestures";
export { CANT_OPEN, LEAVE_BLOCKED, NAME_REQUIRED, OFFLINE_LIST, PROJECT_DELETED } from "./session";
export { UNDERLAY_REFUSALS } from "./underlay"; // the import refusal toasts, for the web adapter's tests
export { flipPoses, type Flip, type FlipPose } from "./view/flip-poses";
export { view3dItems } from "./view3d/items";
export type { Angles3d, Bounds3, DeckItem, FloorItem, Item3d, PieceItem, Point3, Ring, View3d, View3dFrame, WallCap, WallItem } from "./view3d/types";
export { camera3d, DEFAULT_ANGLES, shellBounds, TILT_MAX, TILT_MIN } from "./view3d/camera3d";
export { newell } from "./view3d/prism";
export { hiddenWalls } from "./view3d/hidden";
export { capFaces, faces3d, type Face3d } from "./view3d/faces";
export { openingFaces } from "./view3d/opening-faces";
export { lookScene3d, type LookScene3d } from "./view3d/look3d";
export { SURROUNDINGS } from "./view3d/surroundings";
export { sceneFaces } from "./view3d/scene-faces";
export { wallSeams } from "./view3d/wall-seams";
export { STYLE_3D, finishShades, type Style3d } from "./view3d/style";
export { sectionBounds, sectionPicture, type SectionPicture } from "./view3d/section-picture";
export { lookSection } from "./view/look-section";
