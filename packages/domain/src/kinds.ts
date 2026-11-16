import { assertNever } from "@fm/protocol";
import {
  BATHTUB_PRESETS, BED_PRESETS, BUILT_IN_DESK_PRESETS, BUILT_IN_TABLE_PRESETS, COFFEE_TABLE_PRESETS, CORNER_SHOWER_PRESETS, COUNTER_PRESETS, DESK_PRESETS, DESK_SET_PRESETS,
  DISHWASHER_PRESETS, DRAWERS_PRESETS, EXTENDING_TABLE_PRESETS, FRIDGE_PRESETS, HOB_UNIT_PRESETS, LIFT_BED_PRESETS, LOFT_BED_PRESETS, MATTRESS_PRESETS, MURPHY_BED_PRESETS, ROUND_TABLE_PRESETS,
  SHELF_PRESETS, SHOWER_TRAY_PRESETS, SINK_UNIT_PRESETS, SOFA_BED_PRESETS, SOFA_PRESETS, TOILET_PRESETS, TV_UNIT_PRESETS, WALL_CABINET_PRESETS, WARDROBE_PRESETS, WASHBASIN_PRESETS, WASHING_MACHINE_PRESETS,
} from "./presets";
import { MURPHY_MATTRESS_INSET, type ZoneDefault } from "./use-zone";
import { shownCm } from "./format";
import { STAIR_RULES, hasHandrails, type StairRule } from "./stairs";
import { CHAIR_SIZE, SEAT_BACK } from "./sets";
import { ALL, FRONT, FULL_SIDES, LEFT_RIGHT, NONE, SEATED_HEIGHT, SIDE_IDS, WORKTOP_HEIGHT, one, plain, type Family, type ObjectConfig, type ObjectKind, type OrCeiling, type Preset, type Side, type Sides } from "./kind-rows";
import { MORE_KINDS } from "./kinds-more";

export { SEAT_BACK }; // owned by sets.ts, which the presets read before this table exists
// The types and row helpers live in the leaf kind-rows.ts (shared with kinds-more.ts); re-exported so imports stay here.
export { SEATED_HEIGHT, SIDE_IDS, WORKTOP_HEIGHT };
export type { Family, ObjectConfig, ObjectKind, OrCeiling, Outline, Preset, Side, Sides } from "./kind-rows";

// The curated object kinds of layout states (spec: layouts, layout-states.04, .16, .23): a domain constant, not
// stored. Sizes are default footprints in metres (width along x, depth along y before rotation); `zone` is the
// depth of the use zone on every active side of the footprint, or null for none, and `zoneDefaults` how far along
// each side it runs (furnish.15, .20). The first configuration is the default.

export const MIN_OBJECT_SIZE = 0.02; // metres, width and depth: a frame or a mirror is 2 to 3 cm deep (hangings.03; a folded table is 0.15, layout-states.43)
export const MAX_OBJECT_SIZE = 10;
/** A piece's height goes lower than its width and depth: a rug is 0.01 thick (catalog.22). */
export const MIN_HEIGHT = 0.01;

/** A bed's side zones leave room for a nightstand at the head (furnish.15). */
const BED_HEAD_INSET = 0.45;
/** A bed's zones: the sides from the head inset (furnish.15). */
const BED_ZONES: Readonly<Record<Side, ZoneDefault>> = { ...FULL_SIDES, left: { start: BED_HEAD_INSET, end: 0 }, right: { start: BED_HEAD_INSET, end: 0 } };
/** A desk's front zone: room for a chair, centred (furnish.15). */
const DESK_ZONE_LENGTH = 0.7;
const DESK_ZONES: Readonly<Record<Side, ZoneDefault>> = { ...FULL_SIDES, front: { centred: DESK_ZONE_LENGTH } };
/**
 * A built-in unit (smart.02, .04): closed it is the cabinet against the wall, with no zone; open, the cabinet plus
 * what comes out. Every member has the configurations folded and down, so a switch keeps the sizes (smart.21).
 */
const builtIn = (closed: { w: number; d: number }, open: { d: number; zone: number }, h: number): Pick<ObjectKind, "configs" | "family"> => ({
  configs: [
    { id: "folded", label: "Closed", w: closed.w, d: closed.d, zone: null, h, z: 0 },
    { id: "down", label: "Open", w: closed.w, d: open.d, zone: open.zone, h, z: 0 },
  ],
  family: "builtIn",
});

const CORE_ROWS: readonly ObjectKind[] = [
  { id: "bed", label: "Bed", configs: one(1.7, 2.1, 0.6, 1), ...plain(LEFT_RIGHT), presets: BED_PRESETS, semanticClass: "IfcFurniture BED", zoneDefaults: BED_ZONES },
  // A mattress on the floor or a loft, 0.25 tall with no frame (cleanup.07): no zone on by default, but a zone depth so
  // set_zones can turn one on (cleanup.14).
  { id: "mattress", label: "Mattress", configs: one(1.6, 2, 0.6, 0.25), ...plain(NONE), presets: MATTRESS_PRESETS, semanticClass: "IfcFurniture BED" },
  // Heights (heights.22, .25): a bed that rises to the ceiling by Day (its zones only when down), and one on a loft.
  {
    id: "liftBed",
    label: "Lift bed",
    configs: [
      { id: "up", label: "Up", w: 1.7, d: 2.1, zone: null, h: 0.35, z: "ceiling" },
      { id: "down", label: "Down", w: 1.7, d: 2.1, zone: 0.6, h: 0.35, z: 0.2 },
    ],
    ...plain(LEFT_RIGHT),
    presets: LIFT_BED_PRESETS,
    semanticClass: "IfcFurniture BED",
    zoneDefaults: BED_ZONES,
  },
  { id: "loftBed", label: "Loft bed", configs: [{ id: "standard", label: "Standard", w: 1, d: 2.1, zone: null, h: 0.35, z: 1.45 }], ...plain(NONE), presets: LOFT_BED_PRESETS, semanticClass: "IfcFurniture BED" },
  { id: "builtInTable", label: "Built-in table", ...plain(FRONT), ...builtIn({ w: 1.2, d: 0.35 }, { d: 1.15, zone: 0.6 }, 1.6), sitAt: true, seatsUnder: ["down"], opensInto: "Table", presets: BUILT_IN_TABLE_PRESETS, semanticClass: "IfcFurniture TABLE" },
  { id: "builtInDesk", label: "Built-in desk", ...plain(FRONT), ...builtIn({ w: 1, d: 0.35 }, { d: 0.95, zone: 0.8 }, 1.4), sitAt: true, seatsUnder: ["down"], opensInto: "Desk", presets: BUILT_IN_DESK_PRESETS, semanticClass: "IfcFurniture DESK" },
  { id: "murphyBed", label: "Murphy bed", ...plain(FRONT), ...builtIn({ w: 1.6, d: 0.4 }, { d: 2.1, zone: 0.6 }, 2.24), opensInto: "Bed", presets: MURPHY_BED_PRESETS, semanticClass: "IfcFurniture BED", zoneDefaults: { ...FULL_SIDES, front: { start: MURPHY_MATTRESS_INSET, end: MURPHY_MATTRESS_INSET } } },
  {
    id: "sofaBed",
    label: "Sofa bed",
    configs: [
      { id: "sofa", label: "Sofa", w: 2.1, d: 0.9, zone: 0.5, h: 0.9, z: 0 },
      { id: "bed", label: "Bed", w: 2.1, d: 1.6, zone: 0.5, h: 0.9, z: 0 },
    ],
    ...plain(FRONT),
    presets: SOFA_BED_PRESETS,
    semanticClass: "IfcFurniture SOFA", // named after its first configuration
  },
  { id: "sofa", label: "Sofa", configs: one(2.1, 0.9, 0.5, 0.9), ...plain(FRONT), presets: SOFA_PRESETS, semanticClass: "IfcFurniture SOFA" },
  { id: "armchair", label: "Armchair", configs: one(0.8, 0.8, 0.5, 1), ...plain(FRONT), semanticClass: "IfcFurniture CHAIR" }, // not a seat: nothing is pulled up to it
  { id: "coffeeTable", label: "Coffee table", configs: one(1, 0.5, null, 0.45), ...plain(NONE), presets: COFFEE_TABLE_PRESETS, semanticClass: "IfcFurniture TABLE" },
  {
    id: "foldingTable",
    label: "Folding table",
    configs: [
      { id: "folded", label: "Folded", w: 1.2, d: 0.15, zone: null, h: SEATED_HEIGHT, z: 0 },
      { id: "open", label: "Open", w: 1.2, d: 0.8, zone: 0.6, h: SEATED_HEIGHT, z: 0 },
    ],
    ...plain(FRONT),
    sitAt: true,
    seatsUnder: ["open"],
    semanticClass: "IfcFurniture TABLE",
  },
  {
    id: "extendingTable",
    label: "Extending table",
    configs: [
      { id: "closed", label: "Closed", w: 0.8, d: 1.2, zone: 0.6, h: SEATED_HEIGHT, z: 0 },
      { id: "extended", label: "Extended", w: 0.8, d: 1.66, zone: 0.6, h: SEATED_HEIGHT, z: 0 },
    ],
    ...plain(LEFT_RIGHT), // diners sit along its length, in both states (smart.18)
    sitAt: true,
    seatsUnder: ["closed", "extended"],
    presets: EXTENDING_TABLE_PRESETS,
    semanticClass: "IfcFurniture TABLE",
  },
  { id: "roundTable", label: "Round table", configs: one(0.9, 0.9, 0.6, SEATED_HEIGHT), ...plain(ALL), sitAt: true, seatsUnder: ["standard"], presets: ROUND_TABLE_PRESETS, semanticClass: "IfcFurniture TABLE", outline: "round" },
  { id: "desk", label: "Desk", configs: one(1.2, 0.6, 0.8, SEATED_HEIGHT), ...plain(FRONT), sitAt: true, seatsUnder: ["standard"], presets: DESK_PRESETS, semanticClass: "IfcFurniture DESK", zoneDefaults: DESK_ZONES, options: ["computer"] },
  // An aggregate (seating.06, .07): a desk with its chair tucked, sized whole, 0.90 tall (a chair's back). The table sets are in kinds-more.ts.
  { id: "deskSet", label: "Desk with chair", configs: one(1.2, 0.7, 0.6, 0.9), ...plain(FRONT), presets: DESK_SET_PRESETS, semanticClass: "IfcFurniture DESK", zoneDefaults: DESK_ZONES, aggregate: { table: "desk", config: "standard", chairs: "front", reach: SEAT_BACK }, options: ["computer", "roundChairs"] },
  // Retired (furnish.19): replaced by single pieces; the rows stay so stored drawings open.
  { id: "kitchenBlock", label: "Kitchen block", configs: one(2.4, 0.6, 1, WORKTOP_HEIGHT), ...plain(FRONT), retired: true, semanticClass: "IfcFurniture USERDEFINED" },
  // Kitchen (furnish.11): modules side by side along a wall, each with a 1.00 m front zone; nothing stacks.
  { id: "hobUnit", label: "Hob unit", configs: one(0.6, 0.6, 1, WORKTOP_HEIGHT), ...plain(FRONT), presets: HOB_UNIT_PRESETS, semanticClass: "IfcElectricAppliance ELECTRICCOOKER" },
  { id: "sinkUnit", label: "Sink unit", configs: one(0.8, 0.6, 1, WORKTOP_HEIGHT), ...plain(FRONT), presets: SINK_UNIT_PRESETS, semanticClass: "IfcSanitaryTerminal SINK" },
  { id: "counter", label: "Counter", configs: one(0.6, 0.6, 1, WORKTOP_HEIGHT), ...plain(FRONT), presets: COUNTER_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  { id: "fridge", label: "Fridge", configs: one(0.6, 0.65, 1, 1.9), ...plain(FRONT), presets: FRIDGE_PRESETS, semanticClass: "IfcElectricAppliance FRIDGE_FREEZER" },
  { id: "dishwasher", label: "Dishwasher", configs: one(0.6, 0.6, 1, WORKTOP_HEIGHT), ...plain(FRONT), presets: DISHWASHER_PRESETS, semanticClass: "IfcElectricAppliance DISHWASHER" },
  { id: "ovenColumn", label: "Oven column", configs: one(0.6, 0.6, 1, 2.15), ...plain(FRONT), semanticClass: "IfcElectricAppliance ELECTRICCOOKER" },
  // Its top at 2.15, in line with the oven column (heights.22).
  { id: "wallCabinet", label: "Wall cabinet", configs: [{ id: "standard", label: "Standard", w: 0.6, d: 0.35, zone: null, h: 0.75, z: 1.4 }], ...plain(NONE), presets: WALL_CABINET_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  { id: "bathroomBlock", label: "Bathroom block", configs: one(1.8, 1.5, 0.6, 2), ...plain(FRONT), retired: true, semanticClass: "IfcFurniture USERDEFINED" },
  // Bathroom (furnish.13): one piece each; the bidet and the corner basin come in one size.
  { id: "toilet", label: "Toilet", configs: one(0.36, 0.54, 0.6, 0.42), ...plain(FRONT), presets: TOILET_PRESETS, semanticClass: "IfcSanitaryTerminal TOILETPAN", outline: "pan", front: false },
  { id: "bidet", label: "Bidet", configs: one(0.36, 0.54, 0.6, 0.42), ...plain(FRONT), semanticClass: "IfcSanitaryTerminal BIDET", outline: "pan", front: false },
  { id: "washbasin", label: "Washbasin", configs: one(0.6, 0.45, 0.7, 1.05), ...plain(FRONT), presets: WASHBASIN_PRESETS, semanticClass: "IfcSanitaryTerminal WASHHANDBASIN", outline: "soft", front: false },
  { id: "cornerBasin", label: "Corner basin", configs: one(0.45, 0.45, 0.6, 1.05), ...plain(FRONT), semanticClass: "IfcSanitaryTerminal WASHHANDBASIN", outline: "corner" },
  { id: "showerTray", label: "Shower tray", configs: one(0.8, 0.8, 0.7, 2), ...plain(FRONT), presets: SHOWER_TRAY_PRESETS, semanticClass: "IfcSanitaryTerminal SHOWER" },
  { id: "cornerShower", label: "Corner shower", configs: one(0.8, 0.8, 0.7, 2), ...plain(FRONT), presets: CORNER_SHOWER_PRESETS, semanticClass: "IfcSanitaryTerminal SHOWER", outline: "quarter" },
  { id: "bathtub", label: "Bathtub", configs: one(1.7, 0.7, 0.7, 0.75), ...plain(FRONT), presets: BATHTUB_PRESETS, semanticClass: "IfcSanitaryTerminal BATH" },
  { id: "washingMachine", label: "Washing machine", configs: one(0.6, 0.6, 0.7, 0.85), ...plain(FRONT), presets: WASHING_MACHINE_PRESETS, semanticClass: "IfcElectricAppliance WASHINGMACHINE" },
  { id: "wardrobe", label: "Wardrobe", configs: one(1.2, 0.6, 0.6, 2.05), ...plain(FRONT), presets: WARDROBE_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  { id: "drawers", label: "Chest of drawers", configs: one(1, 0.5, 0.9, 0.9), ...plain(FRONT), presets: DRAWERS_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  { id: "nightstand", label: "Nightstand", configs: one(0.45, 0.4, null, 0.6), ...plain(NONE), semanticClass: "IfcFurniture USERDEFINED", outline: "soft", front: false },
  { id: "chair", label: "Chair", configs: one(CHAIR_SIZE.w, CHAIR_SIZE.d, null, 0.9), ...plain(NONE), seat: SEAT_BACK, semanticClass: "IfcFurniture CHAIR", options: ["roundChairs"] },
  { id: "shelf", label: "Shelf", configs: one(0.8, 0.4, 0.4, 1.5), ...plain(FRONT), presets: SHELF_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  { id: "tvUnit", label: "TV unit", configs: one(1.2, 0.4, null, 1.2), ...plain(NONE), presets: TV_UNIT_PRESETS, semanticClass: "IfcAudioVisualAppliance DISPLAY" },
  // The custom box (heights.26): free width, depth, height and elevation; ids kept from the Block kinds.
  { id: "block", label: "Custom box", configs: one(0.6, 0.6, null, 1), ...plain(NONE), semanticClass: "IfcFurnishingElement USERDEFINED" },
  { id: "roundBlock", label: "Round box", configs: one(0.6, 0.6, null, 1), ...plain(NONE), semanticClass: "IfcFurnishingElement USERDEFINED", outline: "round" },
  { id: "cornerBlock", label: "Corner box", configs: one(0.6, 0.6, null, 1), ...plain(NONE), semanticClass: "IfcFurnishingElement USERDEFINED", outline: "corner" },
  // Stairs (stairs.01): sized by the box, the front edge the bottom step; the front zone is the floor at the foot.
  { id: "stair", label: "Stair", configs: one(0.9, 2.99, 0.9, 2.15), ...plain(FRONT), semanticClass: "IfcStair STRAIGHT_RUN_STAIR", stair: STAIR_RULES.solid },
  { id: "openStair", label: "Open stair", configs: one(0.9, 2.99, 0.9, 2.15), ...plain(FRONT), semanticClass: "IfcStair STRAIGHT_RUN_STAIR", stair: STAIR_RULES.open },
  { id: "storageStair", label: "Storage stair", configs: one(0.6, 1.99, 0.9, 2.15), ...plain(FRONT), semanticClass: "IfcStair STRAIGHT_RUN_STAIR", stair: STAIR_RULES.storage },
  { id: "shipsLadder", label: "Ship's ladder", configs: one(0.6, 1.1, 0.9, 2.15), ...plain(FRONT), semanticClass: "IfcStair STRAIGHT_RUN_STAIR", stair: STAIR_RULES.ship },
  { id: "alternatingTread", label: "Alternating tread", configs: one(0.6, 1.12, 0.9, 2.15), ...plain(FRONT), semanticClass: "IfcStair STRAIGHT_RUN_STAIR", stair: STAIR_RULES.alternating },
  { id: "rungLadder", label: "Rung ladder", configs: one(0.45, 0.58, 0.9, 2.15), ...plain(FRONT), semanticClass: "IfcStair LADDER", stair: STAIR_RULES.rungs, options: ["hooks"] },
  { id: "spiralStair", label: "Spiral stair", configs: one(1.6, 1.6, 0.9, 2.15), ...plain(FRONT), semanticClass: "IfcStair SPIRAL_STAIR", stair: STAIR_RULES.spiral },
];

/** Every kind: the core rows above, then kinds-more.ts's. */
export const OBJECT_KINDS: readonly ObjectKind[] = [...CORE_ROWS, ...MORE_KINDS];

/** The kind with this ID, or null; a plain search, so a name such as "constructor" finds nothing. */
export function kindOf(id: string): ObjectKind | null {
  return OBJECT_KINDS.find((k) => k.id === id) ?? null;
}

/** The rug rule's one question (catalog.15): whether `kind` is a rug; false for an unknown kind. */
export function isRug(kind: string): boolean {
  return kindOf(kind)?.rug === true;
}

/** Whether `kind` is a wheel well (trailer.07); false for an unknown kind. */
export function isWell(kind: string): boolean {
  return kindOf(kind)?.well === true;
}

/** Whether `kind` is a beam (beams.02); false for an unknown kind. */
export function isBeam(kind: string): boolean {
  return kindOf(kind)?.beam === true;
}

/** Whether a piece of `kind` stands in every layout state, its copies kept in step: a stair (stairs.18), a wheel well (trailer.12) or a beam (beams.04). */
export function inEveryLayout(kind: string): boolean {
  return stairRuleOf(kind) !== null || isWell(kind) || isBeam(kind);
}

/** Whether a piece of this kind is a seat: its row gives a backrest depth (pieces.09). */
export function isSeat(kind: string): boolean {
  return (kindOf(kind)?.seat ?? null) !== null;
}

/** Whether a seat may tuck under a piece of `kind` in `config` (seating.16); false for an unknown kind. */
export function seatsUnderAt(kind: string, config: string): boolean {
  return kindOf(kind)?.seatsUnder.includes(config) ?? false;
}

/** A family's name in Properties' Kind row. */
export const FAMILY_LABELS: Readonly<Record<Family, string>> = { builtIn: "Built-in unit" };

/** A family's members, in OBJECT_KINDS order (Properties offers them in this order). */
export function familyKinds(family: Family): readonly ObjectKind[] {
  return OBJECT_KINDS.filter((k) => k.family === family);
}

/**
 * Whether a piece of kind `from` may become `to` (furnish.17): same configuration ids in order, `to` not retired, not
 * the same kind, both stairs or both furniture (a stair is in every layout, furniture in one, stairs.18), and both `L`
 * kinds or neither (an `L` keeps its arms, which only `L` kinds have, catalog.28).
 */
export function kindsSwitchable(from: ObjectKind, to: ObjectKind): boolean {
  const sameIds = from.configs.length === to.configs.length && from.configs.every((c, i) => c.id === to.configs[i]?.id);
  const sameFamily = (from.stair === null) === (to.stair === null) && from.well === to.well && from.beam === to.beam && (from.outline === "ell") === (to.outline === "ell");
  // A set's size is its table's and its chairs' together (seated): a plain piece's size means something else.
  const noSets = from.aggregate === null && to.aggregate === null;
  return from.id !== to.id && !to.retired && sameIds && sameFamily && noSets;
}

/** A kind's stair rule, or null for furniture and unknown kinds. */
export function stairRuleOf(kind: string): StairRule | null {
  return kindOf(kind)?.stair ?? null;
}

/** Whether objects of this kind store a handrail setting (guards.28): stairs with rails, not a rung ladder or furniture. */
export function takesHandrail(kind: string): boolean {
  return railShape(kind) !== null;
}

/** How a kind's rails are stored (edges.06): a flight's by side, a spiral's as one; null for a rung ladder and furniture. */
export function railShape(kind: string): "flight" | "spiral" | null {
  const rule = stairRuleOf(kind);
  if (rule === null || !hasHandrails(rule)) return null;
  return rule.shape === "spiral" ? "spiral" : "flight";
}

/** `kindsSwitchable` by kind id; false for an unknown kind. */
export function canSwitchKind(from: string, to: string): boolean {
  const a = kindOf(from);
  const b = kindOf(to);
  return a !== null && b !== null && kindsSwitchable(a, b);
}

/** A kind's configurations in order (the first is the default), or none for an unknown kind. */
export function kindConfigs(kind: string): readonly ObjectConfig[] {
  return kindOf(kind)?.configs ?? [];
}

/**
 * The configurations an object can take: today its kind's (arch-review R-04). Every lookup from an object to its
 * configurations goes through here, so objects whose configurations are not the catalogue's change one place.
 */
export function configsOf(object: { kind: string }): readonly ObjectConfig[] {
  return kindConfigs(object.kind);
}

/**
 * The preset an object's sizes match (smart.17): the first of its kind's presets whose width, depth and, where the
 * preset gives them, height and elevation round to the same centimetre as the object's, in every configuration; null
 * for none ("Custom"). A missing size never matches. Sizes round as the fields show them (`shownCm`), so a half
 * centimetre never contradicts them.
 */
export function presetOf(object: { kind: string; w: Readonly<Record<string, number>>; d: Readonly<Record<string, number>>; h?: Readonly<Record<string, number>>; z?: Readonly<Record<string, OrCeiling>> }): Preset | null {
  const cm = (v: OrCeiling | undefined): number | "ceiling" => (v === undefined ? Number.NaN : v === "ceiling" ? v : shownCm(v));
  const same = (a: OrCeiling | undefined, b: OrCeiling | undefined): boolean => cm(a) === cm(b);
  const configs = configsOf(object);
  const matches = (p: Preset): boolean => configs.every((c) => {
    const hz = (p.h === undefined || same(object.h?.[c.id], p.h[c.id])) && (p.z === undefined || same(object.z?.[c.id], p.z[c.id]));
    return same(object.w[c.id], p.w) && same(object.d[c.id], p.d[c.id]) && hz;
  });
  return kindOf(object.kind)?.presets.find(matches) ?? null;
}

/** An object's four size maps, one value per configuration. */
export type ObjectSizes = { w: Record<string, number>; d: Record<string, number>; h: Record<string, number>; z: Record<string, OrCeiling> };

/**
 * A preset's full sizes (catalog.17): its width and depths, and its heights and elevations where it gives them; the
 * rest from `from` (a piece's own sizes, so a preset without a height keeps the piece's), else the kind's defaults.
 * Null for an unknown kind or preset. Everything outside this module reads a preset's `h` and `z` through it.
 */
export function presetSize(kind: string, presetId: string, from?: ObjectSizes): ObjectSizes | null {
  const preset = kindOf(kind)?.presets.find((p) => p.id === presetId);
  const base = from ?? defaultSize(kind);
  if (!preset || !base) return null;
  const out: ObjectSizes = { w: { ...base.w }, d: { ...base.d }, h: { ...base.h }, z: { ...base.z } };
  for (const c of kindConfigs(kind)) {
    out.w[c.id] = preset.w;
    out.d[c.id] = preset.d[c.id] ?? out.d[c.id] ?? c.d;
    out.h[c.id] = preset.h?.[c.id] ?? out.h[c.id] ?? c.h;
    out.z[c.id] = preset.z?.[c.id] ?? out.z[c.id] ?? c.z;
  }
  return out;
}

/** One configuration of an object, or null when the object can't take it. */
export function configOf(object: { kind: string }, configId: string): ObjectConfig | null {
  return configsOf(object).find((c) => c.id === configId) ?? null;
}

/** A new object's sizes, one width, depth, height and elevation per configuration, copied from the kind. */
export function defaultSize(kind: string): ObjectSizes | null {
  const k = kindOf(kind);
  if (!k) return null;
  const w: Record<string, number> = {};
  const d: Record<string, number> = {};
  const h: Record<string, number> = {};
  const z: Record<string, OrCeiling> = {};
  for (const c of kindConfigs(k.id)) {
    w[c.id] = c.w;
    d[c.id] = c.d;
    h[c.id] = c.h;
    z[c.id] = c.z;
  }
  return { w, d, h, z };
}

/** Whether `v` is a stored elevation: 0 to MAX_OBJECT_SIZE metres, or "ceiling" (heights.37). */
export function isElevation(v: unknown): v is OrCeiling {
  return v === "ceiling" || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_OBJECT_SIZE);
}

/** A new placement's use-zone sides, copied from the kind (smart.08), or null for an unknown kind. */
export function defaultSides(kind: string): Sides | null {
  const k = kindOf(kind);
  return k ? { ...k.sides } : null;
}

export const isSide = (v: unknown): v is Side => SIDE_IDS.some((s) => s === v);

/** A copy of `sides` with one side turned on or off. */
export function withSide(sides: Sides, side: Side, on: boolean): Sides {
  switch (side) {
    case "front": return { ...sides, front: on };
    case "back": return { ...sides, back: on };
    case "left": return { ...sides, left: on };
    case "right": return { ...sides, right: on };
    default: return assertNever(side);
  }
}

export function isObjectSize(v: number): boolean {
  return Number.isFinite(v) && v >= MIN_OBJECT_SIZE && v <= MAX_OBJECT_SIZE;
}

/** A piece's height: MIN_HEIGHT to MAX_OBJECT_SIZE metres (catalog.22). */
export function isObjectHeight(v: number): boolean {
  return Number.isFinite(v) && v >= MIN_HEIGHT && v <= MAX_OBJECT_SIZE;
}

// The opening kinds' table lives in its own module (catalog.25: this file is near its line limit); re-exported here.
export { DEFAULT_OPENING_KIND, OPENING_GROUPS, OPENING_GROUP_LABELS, OPENING_KINDS, OPENING_KIND_IDS, SHEER, SHEERS, SHUTTER_BOX, dressingRefusal, hasGlass, isOpeningKind, isSheer, type OpeningClearance, type OpeningGroup, type OpeningKind, type Sheer } from "./opening-kinds";
