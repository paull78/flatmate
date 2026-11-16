// Opening kinds (spec: openings, openkinds): one row per kind, and every per-kind fact is a column of it (arch-review
// R-01, openkinds.14, .15). Only the plan's symbols and the 3D faces switch on the kind, for geometry; every other
// reader reads a column. Re-exported by kinds.ts.

/** The kinds in the order the UI offers them, grouped (doors, windows, doorways); the first is the Opening tool's default. */
export const OPENING_KIND_IDS = ["swing", "double", "sliding", "pocket", "folding", "slidingGlass", "window", "casement", "twoLeaf", "passage", "curtain"] as const;
export type OpeningKind = (typeof OPENING_KIND_IDS)[number];

/** The picker's groups, in their order (openkinds.07). */
export const OPENING_GROUPS = ["doors", "windows", "doorways"] as const;
export type OpeningGroup = (typeof OPENING_GROUPS)[number];
/** Each group's name in the picker. */
export const OPENING_GROUP_LABELS: Readonly<Record<OpeningGroup, string>> = { doors: "Doors", windows: "Windows", doorways: "Doorways" };

/**
 * A kind's clearance in front of it on its opening side, a warning like a use zone (spec: openings): a square as deep as
 * the width, two half-width squares (one rectangle, openkinds.17), a shallow strip, or none.
 */
export type OpeningClearance = "square" | "twoSquares" | "strip" | "none";

type OpeningKindInfo = {
  label: string; // the kind's name in the UI and in width refusals
  noun: string; // in domain messages and refusal toasts: "Door e/d0 overlaps…", "a door"
  group: OpeningGroup; // the picker's group
  sideLabel: string | null; // Properties' label for the opening side, or null: the field is hidden (the value is kept)
  hingeLabel: string | null; // Properties' label for the hinge end, or null: hidden and kept
  glass: "never" | "glazed" | "always"; // "glazed": by the stored flag, which Properties then shows
  clearance: OpeningClearance;
  fromFloor: boolean; // starts at the floor: a door's height range, and the room's floor through its span
  tool: "add_door" | "add_window"; // which MCP tool adds it
  framed: boolean; // draws frames at the detailed level
  hingeAt: "near" | "far"; // the click's hinge default: the wall end nearer the pointer, or the other one (openkinds.10)
  pocket: boolean; // reaches one width past its hinge end inside the wall (openkinds.16)
  walkThrough: boolean; // people walk through it: on an outside wall on wheels it gets steps (trailer.06)
  dressings: boolean; // takes a sheer curtain and a shutter box on its room side (hangings.04)
  width: { min: number; max: number; default: number }; // metres
};

/** One row per kind: every per-kind fact lives here (arch-review R-01). */
export const OPENING_KINDS: Readonly<Record<OpeningKind, OpeningKindInfo>> = {
  swing: { label: "Swing door", noun: "Door", group: "doors", sideLabel: "Side", hingeLabel: "Hinge", glass: "glazed", clearance: "square", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 2, default: 0.8 } },
  double: { label: "Double door", noun: "Door", group: "doors", sideLabel: "Side", hingeLabel: null, glass: "glazed", clearance: "twoSquares", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.8, max: 2.4, default: 1.2 } },
  sliding: { label: "Sliding door", noun: "Door", group: "doors", sideLabel: "Side", hingeLabel: "Parks at", glass: "glazed", clearance: "none", fromFloor: true, tool: "add_door", framed: true, hingeAt: "far", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 2, default: 0.8 } },
  pocket: { label: "Pocket door", noun: "Door", group: "doors", sideLabel: null, hingeLabel: "Pocket at", glass: "never", clearance: "none", fromFloor: true, tool: "add_door", framed: true, hingeAt: "far", pocket: true, walkThrough: true, dressings: false, width: { min: 0.5, max: 1.2, default: 0.8 } },
  folding: { label: "Folding door", noun: "Door", group: "doors", sideLabel: "Side", hingeLabel: "Stacks at", glass: "never", clearance: "strip", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 3, default: 0.9 } },
  slidingGlass: { label: "Sliding glass door", noun: "Door", group: "doors", sideLabel: null, hingeLabel: null, glass: "always", clearance: "none", fromFloor: true, tool: "add_door", framed: true, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 1, max: 4, default: 2.4 } },
  window: { label: "Fixed window", noun: "Window", group: "windows", sideLabel: null, hingeLabel: null, glass: "always", clearance: "none", fromFloor: false, tool: "add_window", framed: true, hingeAt: "near", pocket: false, walkThrough: false, dressings: true, width: { min: 0.3, max: 3, default: 1 } },
  casement: { label: "Casement window", noun: "Window", group: "windows", sideLabel: "Side", hingeLabel: "Hinge", glass: "always", clearance: "none", fromFloor: false, tool: "add_window", framed: true, hingeAt: "near", pocket: false, walkThrough: false, dressings: true, width: { min: 0.3, max: 1.2, default: 0.6 } },
  twoLeaf: { label: "Two-leaf window", noun: "Window", group: "windows", sideLabel: "Side", hingeLabel: null, glass: "always", clearance: "none", fromFloor: false, tool: "add_window", framed: true, hingeAt: "near", pocket: false, walkThrough: false, dressings: true, width: { min: 0.6, max: 2.4, default: 1.2 } },
  passage: { label: "Open passage", noun: "Opening", group: "doorways", sideLabel: null, hingeLabel: null, glass: "never", clearance: "none", fromFloor: true, tool: "add_door", framed: false, hingeAt: "near", pocket: false, walkThrough: true, dressings: false, width: { min: 0.5, max: 3, default: 0.9 } },
  curtain: { label: "Curtain", noun: "Opening", group: "doorways", sideLabel: "Hangs on", hingeLabel: null, glass: "never", clearance: "none", fromFloor: true, tool: "add_door", framed: false, hingeAt: "near", pocket: false, walkThrough: false, dressings: false, width: { min: 0.5, max: 3, default: 0.8 } },
};

export const DEFAULT_OPENING_KIND: OpeningKind = "swing";

/** A window's sheer curtain: hanging to the glass (sill to head) or to the floor (hangings.04). */
export type Sheer = "glass" | "floor";
export const SHEERS: readonly Sheer[] = ["glass", "floor"];
export const isSheer = (v: unknown): v is Sheer => SHEERS.some((s) => s === v);

export function isOpeningKind(v: unknown): v is OpeningKind {
  return OPENING_KIND_IDS.some((k) => k === v);
}

/** Whether an opening shows glass (the 3D view's panes, sections): its kind's `glass`, by the stored flag where it's `glazed`. */
export function hasGlass(o: { kind: OpeningKind; glazed: boolean }): boolean {
  const glass = OPENING_KINDS[o.kind].glass;
  return glass === "always" || (glass === "glazed" && o.glazed);
}

/** A window's shutter box on its room-side face right above its head, the window's width (hangings.04), metres. */
export const SHUTTER_BOX = { height: 0.25, depth: 0.12 } as const;
/** A sheer curtain's rail above the head (or at the box's top) and its distance off the face (or the box's front). */
export const SHEER = { rail: 0.05, off: 0.06 } as const;

/** "A door takes no sheer curtain or shutter box": only a kind with `dressings` takes them (hangings.04). */
export const dressingRefusal = (kind: OpeningKind): string =>
  `${OPENING_KINDS[kind].noun === "Opening" ? "An" : "A"} ${OPENING_KINDS[kind].noun.toLowerCase()} takes no sheer curtain or shutter box`;
