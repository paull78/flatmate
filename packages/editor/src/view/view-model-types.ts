import type { DeckPreset, EntityRef, MotifId, OpeningKind, SheetKind } from "@fm/domain";
import type { CardOrder } from "../ports/events";
import type { Point } from "@fm/protocol";
import type { ExportPage } from "../ports/effects";
import type { DocumentStatus, SnapKind, SnapStep, ToolName } from "../types";
import type { FloorTile, PaletteGroup } from "./palette";
import type { Primitive } from "./scene-types";
import type { View3dFrame } from "../view3d/types";

// What the panels show, not how (spec: editor).
/** A project card's plan: the shell turns it into an image with @fm/export. */
export type CardPicture = { primitives: readonly Primitive[]; frame: { min: Point; max: Point; zoom: number } };
/** One card on the project list (cycle cards). `unseen`: its drawing hasn't been asked for; `empty`: nothing is drawn. */
export type ProjectCard = { id: string; name: string; colour: string; status: "unseen" | "loading" | "ready" | "empty" | "failed"; picture: CardPicture | null; canTurn: boolean; view3d: View3dFrame | null; layouts: CardLayouts | null };
/** The pill on a card with more than one layout: the one shown, and where it stands among them. */
export type CardLayouts = { name: string; index: number; count: number };
/**
 * The 3D panel's surroundings menu (surroundings.06, .15): the drawing's value ("" is None), the five choices with None
 * first, and whether an edit can go now; it can't while one waits for its answer, which is why the dim comes late.
 */
export type SurroundingsMenu = { value: string; options: readonly { value: string; label: string }[]; canEdit: boolean };
/** An opening kind as the kind picker offers it (openkinds.07): its name and its group's name. */
export type OpeningChoice = { kind: OpeningKind; label: string; group: string };

export type Field = {
  id: string;
  label: string;
  section: string; // the titled Properties section it sits in; fields come in section order (ux-polish item 6)
  value: string;
  unit: string | null;
  readOnly: boolean;
  options?: { value: string; label: string; disabled?: boolean; group?: string }[]; // a choice (an object's configuration); absent for text fields; `group` heads a run of options in the kind picker
  kindPicker?: boolean; // an opening's kind: the floating bar's pop-up with icons in groups (openkinds.07); absent elsewhere
  select?: boolean; // a drop-down choice: an object's size preset; absent for segmented choices and text fields
  toggle?: boolean; // a checkbox whose value is "true" or "false" (a door's glazing); absent for text fields
  step?: number; // an editable number's stepper increment, in its unit; absent for text and read-only fields
  placeholder?: string; // what a blank means (a date of issue prints today's); absent for fields where a blank is just blank
  multiline?: boolean; // a text that may hold line breaks (the project notes, sheet.05); absent for one-line fields
  link?: string; // a row that selects this hole, and lights it up while hovered (riser.20)
  action?: boolean; // a button that sends setField with an empty value, its value what it would set (a stair's Fit run)
  hint?: boolean; // a read-only sentence the full width of the panel, saying how to fill the field above it (a section's Depth)
  check?: "ok" | "warning"; // a read-only check whose value is the whole sentence, shown as a tick or a warning (stairs.15)
  sheet?: string; // the sheet its Edit opens (a report's first line, AC-14)
  // A finish's summary row (inherit step 04): its swatch's colour and motif (null for None) and whether its fields show;
  // the row's value is the summary text. Absent for every other field.
  // `fixed`: a side's inherited finish, shown and never opened (inherit step 05).
  finish?: { colour: string | null; motif: string | null; open: boolean; fixed?: true };
  inFinish?: string; // the summary row's id this field sits under, shown only while that row is open (inherit step 04)
  colour?: true; // a colour typed as hex beside the browser's colour picker (a finish's Custom row); absent for every other field
};

/** A fix chip in the hint line (stairdraw.13): what chipHover and chipClick send, its words, and an aside ("1.9 m"). */
export type CommandChip = { id: string; label: string; detail?: string };

/** A row of the warnings list (clarity.04): its words, and the piece or door a click selects, never a blocker (clarity.23). */
export type WarningRow = { key: string; text: string; ref: EntityRef };

/** One sheet in the view: what the list and the page's header show. */
export type SheetRow = {
  id: string;
  number: number | null; // its first page's, among the pages In PDF; none when unticked
  kind: SheetKind;
  section: string | null; // the letter a section sheet draws
  title: string;
  scale: number | null; // the N of 1:N, its own or the general one; a report has none
  ownScale: boolean;
  partOfPlan: boolean;
  inPdf: boolean;
  drawing: { layout: string; deck: string | null } | null; // its first; a level by its first deck, none on the floor. A report has none
  panes: readonly { layout: string; deck: string | null; title: string; on: boolean; locked: boolean }[]; // a compare or section sheet's checks; locked would leave it under its least or over 4
  split: "auto" | "stacked" | "sideBySide";
  finishes: boolean;
  marks: boolean; // whether its plans draw the section marks (section.60)
  text: string; // a report's, what the box shows: this viewer's draft while there is one (sheetset.14)
  textNote: string | null; // said at the box: the text is over the limit
  textHeld: boolean; // the box was left and the text isn't saved: offers another try
  size: "small" | "normal" | "large"; // a report's
  centred: boolean;
  scales: readonly { scale: number | null; label: string; nofit: boolean }[]; // the scale grid; null is General, and nofit its neutral dot (sheetset.17)
  shortcuts: { centre: boolean; fit: number | null; paper: string | null } | null; // under a page showing part of the plan: "Centre it", or "Fit the whole plan (1:N)" and "Use A2"
  pageCount: number; // how many `pages()` holds, known with nothing drawn: a report's off-screen pages hold their place by it
  pages(): readonly ExportPage[]; // built when called, and kept per document: the ViewModel runs on every event, so it never builds them
};

export type SheetsView = {
  projectName: string;
  paper: string;
  papers: readonly { value: string; label: string }[];
  scale: string; // the general scale; "" is Fit
  scales: readonly { value: string; label: string }[];
  north: number | null; // whole degrees clockwise from up; null prints no arrow (AC-10)
  accent: string; // what prints, as "#rrggbb" (AC-13)
  accents: readonly { value: string; label: string }[]; // the swatches; anything else is a custom colour
  page: { widthMm: number; heightMm: number }; // the set's one page size, known before any page is built
  status: string;
  note: string | null; // the title block had to drop the rooms table (sheetset.21)
  warning: string | null; // names the PDF can't show (export.16)
  canSave: boolean;
  saveReason: string | null;
  finishes: "with" | "without"; // PNG and SVG of the plan only (finishes.10)
  readOnly: boolean;
  sheets: readonly SheetRow[];
  selected: string | null; // this viewer's, or the first sheet (sheetset.13)
  missing: readonly { layout: string; deck: string | null; title: string }[]; // what an automatic list would print and no sheet shows: "Night has no sheet · Add" (AC-02)
  missingSections: readonly { section: string; label: string }[]; // sections no sheet draws: "A–A has no sheet · Add", on an automatic list too
  canCompare: boolean; // two layouts to put side by side
  sections: readonly { id: string; label: string }[]; // what a section sheet can draw; none, and it isn't offered
  layouts: readonly { id: string; name: string }[]; // the panel's Layout
  levels: readonly { deck: string | null; label: string }[]; // the panel's Level: the floor and every loft
};

/** The right-click list (AC-06): where it opened on screen, and its rows in plain names. */
export type UnderPointerView = { at: Point; rows: readonly { key: string; ref: EntityRef; label: string; selected: boolean }[] };
/** This viewer's section under the plan (spec "The strip"). `page` is in CSS pixels at the frame's size, built when called, and the same object until the document, section, layout or size changes. */
export type SectionStrip = { section: string; label: string; layout: string; letters: readonly { section: string; label: string }[]; page(size: { w: number; h: number }): ExportPage };

/** The dock under the plan (section.45): shares of the stage, what's in it, and which frame is where. */
export type FramesView = { height: number; larger: boolean; sectionShare: number; sectionFirst: boolean; docked: boolean; side: boolean };

export type ViewModel = {
  activeTool: ToolName;
  commandBar: { prompt: string; value: string; unit: "m" | null; chips: readonly CommandChip[] }; // chips follow the prompt
  typing: boolean; // a typed value field is open (the Wall tool's length, a helper's value, the Scale distance): tidy.14
  properties: { kind: "none" } | { kind: "group"; count: number; walls?: number; duplicate?: string } /* walls: how many of the group are walls, absent for furniture only; duplicate: why Duplicate is off (straight.24) */ | { kind: "wall" | "joint" | "zone" | "object" | "opening" | "dimension" | "deck" | "hole" | "column" | "section" | "area"; fields: Field[]; breakApart?: true; split?: true };
  cursor: "default" | "crosshair" | "move" | "pointer" | "grab" | "grabbing" | "ew-resize" | "ns-resize" | "nesw-resize" | "nwse-resize";
  snap: { kind: Exclude<SnapKind, "none">; at: Point } | null;
  presence: { clientId: string; name: string; color: string; at: Point | null }[];
  project: { name: string; status: DocumentStatus; dirty: boolean; canEdit: boolean } | null;
  projectList: { items: ProjectCard[]; loading: boolean; error: string | null; order: CardOrder } | null; // only when no document is open
  toast: string | null;
  underPointer: UnderPointerView | null; // the right-click list (AC-06)
  canUndo: boolean;
  canRedo: boolean;
  wallThickness: string; // the Wall tool's thickness in metres, two decimals (shown in the floating bar)
  states: { id: string; name: string; active: boolean }[]; // the state switcher, in order (spec: layouts); empty without a document
  warnings: { rows: readonly WarningRow[]; blink: number }; // the count by the layout tabs and its list, one row per mark on the plan; blink: changes when the count should blink
  objectKind: string; // the kind or set the Object tool places (the palette's highlight)
  // The hint line's size picker (furnish.05): while the Object tool is armed with a kind that has presets, its presets
  // in catalogue order (d is the first configuration's depth) and the current one's label; null otherwise.
  sizePicker: { kind: string; current: string; options: readonly { label: string; w: number; d: number }[] } | null;
  // The hint line's typed size (sizing.06, .15): the armed width, first-configuration depth and height as shown, or a
  // field's text that didn't read, listed in `bad`; height null for a kind that can't be lowered (no field); the whole
  // null where no size can be typed (no Object tool, a set, a stair kind).
  sizeFields: { kind: string; width: string; depth: string; height: string | null; bad: readonly ("width" | "depth" | "height")[] } | null;
  openingKind: OpeningKind; // the kind the Opening tool places (shown in the floating bar while it is active)
  openingKinds: readonly OpeningChoice[]; // the Opening tool's kinds, in order (the domain's table), each with its group's name
  deckPreset: DeckPreset; // the preset the Deck tool adds (shown in the floating bar while it is active)
  deckPresets: readonly { preset: DeckPreset; label: string }[]; // the Deck tool's presets, in order (the domain's table), then Hole
  // The Column tool's size, two decimals, and its presets with a short label ("30") (shown in the floating bar while it
  // is active, pillars.12).
  columnSize: { width: string; depth: string };
  columnSizes: readonly { width: string; depth: string; label: string }[];
  palette: readonly PaletteGroup[]; // the object palette's groups and cards, in order
  toolHelp: { tool: ToolName; label: string; key: string; hint: string }; // Properties' empty state: the active tool
  shortcuts: readonly { label: string; key: string }[]; // Properties' empty state: every tool, undo and delete
  tools: readonly { tool: ToolName; label: string; key: string; disabled?: boolean }[]; // the floating bar's tools, in order (the tool table)
  gridStep: number; // metres between grid lines at this zoom (the canvas corner chip)
  cut: string | null; // the plan's cut, "Cut +1.20", beside the grid step; null without a drawing (heights.15)
  // The level strip (levels.10): one row per level, highest first, its height ("+2.15", "0.00") and name ("Loft, Bunk")
  // as two columns; `deck` is what a click sends (setViewedLevel). Null with only the floor level or no drawing.
  levels: { rows: readonly { deck: string | null; height: string; name: string; viewed: boolean }[] } | null;
  snapStep: SnapStep; // the floating bar's chosen snap step (direct.14)
  snapSteps: readonly { step: SnapStep; label: string }[]; // its choices, in order; fixed steps labelled in cm, no unit
  projectFields: Field[] | null; // the Project section: with nothing selected, the title block fields (sheet.04)
  ceiling: Field[] | null; // the Ceiling section: with nothing selected, the drawing's ceiling (heights.11)
  outside: Field[] | null; // the Outside walls section: with nothing selected, the house's outside walls default (inherit.03)
  trailer: Field[] | null; // the Trailer section: with nothing selected and Surroundings On wheels (trailer.03)
  frames: FramesView;
  sectionMarks: boolean | null; // this viewer's switch for the marks on screen; null with no section to hide
  // outside: the switch is Outside under a flat ceiling (inherit step 07): on, it hides no wall and draws no roof.
  view3d: { open: boolean; size: "corner" | "split"; yaw: number; tilt: number; roof: boolean | null; outside: boolean; layout: string; surroundings: SurroundingsMenu } | null; // roof: the Roof switch, null with no roof to show (roofs.13) // the 3D panel's header, or its chip when closed; null without a drawing
  sectionStrip: SectionStrip | null; // null while closed
  // The Underlay section (import.06): with nothing selected, whether a picture is there, whether shared edits are
  // possible, and this viewer's fade and show/hide; null otherwise. Never the picture itself.
  underlay: { present: boolean; canEdit: boolean; fade: number; visible: boolean } | null;
  logo: { present: boolean; canEdit: boolean } | null; // beside the Project fields; never its bytes, as React gets every view
  // Properties' Rooms section with nothing selected (export.10): labelled rooms and the total; null otherwise.
  // A row's detail is its grey second line: the size of a rectangle, the floor's motif, both or none (finishes.11).
  rooms: { rows: readonly { labelId: string; name: string; detail: string | null; area: string; free: string | null; part?: true }[]; total: string | null } | null; // part: a named area under its room (areas.12)
  // The palette's Floors group (finishes.08, .09): this viewer's Finishes switch, a tile per motif in the domain's order,
  // and the tile armed in the Zone tool's Floor mode (finishes.19), null outside it.
  floors: { on: boolean; tiles: readonly FloorTile[]; armed: MotifId | null };
  // The floating bar's Export button; null with no drawing open. `reason` says why it is off.
  export: { available: boolean; reason: string | null } | null;
  sheetsView: SheetsView | null; // the full-screen view Export opens (sheetset.13)
};
