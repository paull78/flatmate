import type { Command, DeckPreset, EntityRef, MotifId, OpeningKind, SheetKind } from "@fm/domain";

/** A sheet's fields as a command sets them. */
export type SheetEdit = Omit<Extract<Command, { type: "setSheet" }>, "type" | "sheetId">;

/** How the project list is ordered: by name, or last edited first (cards.05). */
export type CardOrder = "name" | "recent";

/** The Deck tool's options: a deck preset, or Hole (stairwell.08). */
import type { Point, ProjectListing, ProjectMeta, ServerMessage, StoredDocument } from "@fm/protocol";
import type { Mods, Size, SnapStep, ToolName } from "../types";
import type { ImageHandle } from "./effects";

// What React panels send; tests send the same (spec: editor).
export type UiAction =
  | { type: "createProject"; name: string }
  | { type: "openProject"; id: string }
  | { type: "showProjectList" }
  | { type: "cardSeen"; id: string } // a project card came into view (cards.02)
  | { type: "cardHover"; id: string | null } // the mouse on a card, or off every card: its 3D view starts at the default angles
  | { type: "setCardOrder"; order: CardOrder } // the list's order: this viewer's, remembered by the shell (cards.05)
  | { type: "cardNextLayout"; id: string } // the card's pill: its next layout (cards.07)
  | { type: "cardOrbit"; dx: number; dy: number; width: number } // a drag on the hovered card, in pixels; width: the card's
  | { type: "deleteProject"; id: string }
  | { type: "pickTool"; tool: ToolName }
  | { type: "selectEntity"; ref: EntityRef } // a warnings row: picks Select, selects it if the viewed level can; the camera stays
  | { type: "setField"; fieldId: string; value: string }
  | { type: "setWallThickness"; value: string } // the Wall tool's thickness, as typed next to the toolbar
  | { type: "setColumnSize"; width?: string; depth?: string } // the Column tool's size: a preset sends both sides, a typed field one (pillars.12)
  | { type: "setSnapStep"; step: SnapStep } // the floating bar's snap step, for the session (direct.14)
  | { type: "setActiveState"; id: string } // local only: never an edit (spec: layouts)
  | { type: "pickUnderPointer"; ref: EntityRef } // a row of the right-click list (AC-06)
  | { type: "hoverUnderPointer"; ref: EntityRef | null } // the pointer on or off that row
  | { type: "closeUnderPointer" }
  | { type: "selectHole"; id: string } // a hole's row in Properties (riser.20)
  | { type: "hoverHole"; id: string | null } // the pointer on or off that row
  | { type: "setViewedLevel"; deck: string | null } // the level strip: a level's lowest deck ID, null for the floor; never an edit (levels.09)
  | { type: "pickKind"; kind: string } // the palette: arms a kind and picks the Object tool
  | { type: "pickPreset"; kind: string; preset: string } // the size picker: a preset label, for the session (furnish.05)
  | { type: "setArmedSize"; kind: string; width?: string; depth?: string; height?: string } // the hint line's typed size, as typed (sizing.06, .15)
  // The hint line's fix chips (stairdraw.13), by the id the command bar gives them: one hovered (null when none is), one clicked
  | { type: "chipHover"; id: string | null }
  | { type: "chipClick"; id: string }
  | { type: "pickOpeningKind"; kind: OpeningKind } // arms an opening kind and picks the Opening tool (spec: openings)
  | { type: "pickDeckPreset"; preset: DeckPreset } // the Deck tool's Platform | Loft: sets it and picks the Deck tool (decks.06, stairwell.08)
  | { type: "pickMotif"; motif: MotifId } // a Floors tile: picks the Zone tool armed with the motif, the Floor mode (finishes.19)
  | { type: "setFinishesOn"; on: boolean } // this viewer's Finishes switch: never an edit, never sent, not saved (finishes.09)
  | { type: "toggleFinish"; id: string } // opens a finish's summary row in Properties, or closes it (inherit step 04)
  | { type: "addState" } // a copy of the active state, made active
  | { type: "renameState"; id: string; name: string }
  | { type: "deleteState"; id: string }
  | { type: "openExport" }
  | { type: "closeExport" }
  | { type: "setExport"; field: "finishes"; value: string } // this viewer's choice for PNG and SVG of the plan (export.19; finishes.10)
  | { type: "download"; format: "pdf" | "png" | "svg" } // the sheets view's Save PDF, and PNG and SVG of the plan (export.18)
  // The set's, stored and undone like any edit; "" clears it (sheetset.21). The 3D panel's surroundings menu sends it too,
  // as it works with something selected (surroundings.15).
  | { type: "setSheetSetting"; key: "paper" | "generalScale" | "north" | "accent" | "surroundings"; value: string }
  // The sheet list (sheetset.13, .14): selecting is this viewer's, and the rest are one undoable command each.
  | { type: "selectSheet"; id: string }
  | { type: "addSheet"; kind: SheetKind }
  | { type: "addMissingSheet"; layout: string; deck: string | null } // "Night has no sheet · Add"
  | { type: "addMissingSection"; section: string } // "A–A has no sheet · Add"
  | { type: "duplicateSheet"; id: string }
  | { type: "deleteSheet"; id: string }
  | { type: "moveSheet"; id: string; index: number } // its place in the list once moved
  | { type: "tickSheet"; id: string; on: boolean } // In PDF
  | { type: "tickAllSheets"; on: boolean } // All and None
  // The right panel and the framing drag (sheetset.15, .17): one undoable command each.
  | { type: "setSheet"; id: string; fields: SheetEdit }
  | { type: "renameSheet"; id: string; title: string }
  | { type: "setSheetDrawing"; id: string; layout: string; deck: string | null } // Layout and Level: a title naming its drawing follows it
  | { type: "setSheetSection"; id: string; section: string } // a section sheet's Section: a title naming it follows it
  | { type: "toggleSheetPane"; id: string; layout: string; deck: string | null } // a compare or section sheet's check: a title naming its panes follows them
  | { type: "frameSheet"; id: string; dxMm: number; dyMm: number } // a drag let go: how far the plan moved on paper, y up; the scale makes it metres
  | { type: "typeReport"; id: string; text: string } // the report's box changed: this viewer's draft, with no command
  | { type: "leaveReport"; id: string } // the box was left: its draft becomes one undo step
  | { type: "openSheet"; id: string } // Edit in Properties: the sheets view, on that sheet (AC-14)
  | { type: "undo" }
  | { type: "redo" }
  | { type: "deleteSelection" } // Properties' Delete for a furniture group (direct.08)
  | { type: "pickSet"; set: string } // a Sets card: the Object tool places the set's pieces (seated.12)
  | { type: "breakApart" } // Properties' Break apart: the selected set becomes separate pieces (seated.02)
  | { type: "split" } // Properties' Split on a wall: arms the Split gesture (straight step 15)
  | { type: "duplicate" } // Properties' Duplicate (one piece or a group): picks up the ghost over the original (ghost.03)
  // The plan underlay (import.06, .15): a picture the shell decoded, or why it could not; Remove; this viewer's fade
  // (0 = full strength, 1 = invisible) and show/hide, which are never edits.
  | { type: "importUnderlay"; result: UnderlayImport }
  | { type: "removeUnderlay" }
  | { type: "setUnderlayFade"; fade: number }
  | { type: "toggleUnderlay" }
  // The studio's logo (sheetset.21): read by the same importer, smaller; Remove.
  | { type: "importLogo"; result: UnderlayImport }
  | { type: "removeLogo" }
  // The 3D view's panel (heights.18, .19): show or hide, corner or split, a quarter turn; never edits.
  | { type: "toggle3d" }
  | { type: "toggleRoof3d" } // this viewer's Roof switch in the 3D panel (roofs.13)
  | { type: "set3dSize"; size: "corner" | "split" }
  | { type: "turn3d"; by: 1 | -1 }
  /** A drag in the 3D panel, in pixels since the last one (real3d.04): the editor turns it into degrees. */
  | { type: "orbit3d"; dx: number; dy: number }
  | { type: "reset3d" }
  // The strip under the plan (spec "The strip"): its letters and its close button; never edits.
  | { type: "showSection"; section: string }
  | { type: "closeSection" }
  | { type: "setSectionMarks"; on: boolean } // this viewer's switch for the marks on screen (section.59)
  // The dock under the plan (section.45): its size and the frames' places; never edits.
  | { type: "setDockHeight"; height: number }
  | { type: "resetDockHeight" }
  | { type: "toggleLargerDock" }
  | { type: "setDockShare"; sectionShare: number }
  | { type: "swapFrames" };

/** What the shell's import adapter hands over: the re-encoded JPEG as base64 with its pixel size, or a refusal (import.15). */
export type UnderlayImport =
  | { ok: true; data: string; width: number; height: number }
  | { ok: false; reason: "unsupported" | "unreadable" | "tooLarge" };

export type WorkspaceEvent =
  | { type: "projects"; requestId: string; items: ProjectListing[] }
  | { type: "created"; requestId: string; meta: ProjectMeta }
  | { type: "drawing"; requestId: string; projectId: string; doc: StoredDocument | null } // a project card's (cards.02)
  | { type: "failed"; requestId: string | null; message: string };

export type ServerEvent =
  | Extract<ServerMessage, { type: "welcome" | "snapshot" | "openFailed" | "projectDeleted" | "changes" | "ack" | "rejected" | "presence" | "presenceLeft" }>
  | { type: "connection"; state: "open" | "closed" };

export type Event =
  | { type: "pointerDown" | "pointerMove" | "pointerUp"; screen: Point; mods: Mods; button: 0 | 1 | 2 }
  | { type: "pointerLeave" } // the pointer left the canvas: hover previews go (ux-polish.17)
  | { type: "pointAt"; world: Point } // a shell with no pointer (MCP) moves its cursor: presence only, no hover or tool (cleanup step 10)
  | { type: "wheel"; screen: Point; deltaX: number; deltaY: number; mods: Mods }
  | { type: "key"; key: string; mods: Mods } // KeyboardEvent.key, except digits and "." taken from the physical key code (spec: tools)
  | { type: "ui"; action: UiAction }
  | { type: "timerFired"; timerId: string }
  | { type: "frame"; now: number } // an animation frame the editor asked for (requestFrame), on the Host's clock
  | { type: "workspaceEvent"; event: WorkspaceEvent }
  | { type: "saveResult"; writeId: string; ok: boolean; error?: string } // X1: ignored
  | { type: "serverEvent"; event: ServerEvent }
  | { type: "viewportResized"; size: Size; devicePixelRatio: number }
  | { type: "command"; command: Command } // a domain command from a shell without pointer input (MCP, spec: mcp)
  | { type: "rasterised"; requestId: string; image: ImageHandle }; // the answer to a rasterise effect (export.18)

export type PointerInput = Extract<Event, { type: "pointerDown" | "pointerMove" | "pointerUp" }>;
