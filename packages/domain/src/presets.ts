import type { OrCeiling, Preset } from "./kinds";
import { SEATED_REACH, deskSetDepth, roundSetDiameter } from "./sets";

// The size presets (spec "Size presets", smart.11, .17): one short list per kind with standard sizes, in metres. The
// id is the name Claude passes (MCP `preset`); the label is the shown text, built from the numbers so it cannot drift.
// Each kind's default size is one of its presets. Beds include about 10 cm of frame.

/** A bed's frame beyond its mattress, in width and in depth (cleanup.07). */
const BED_FRAME = 0.1;

const cm = (v: number): number => Math.round(v * 100);

type Depth = readonly [config: string, d: number];

/**
 * A preset whose label is the id (left out when it is just the width in cm), the width and first depth in cm, and
 * a second state's depth in brackets after its label: "King 170 × 210", "120 × 35 (open 115)".
 */
function preset(id: string, w: number, first: Depth, second?: { label: string; depth: Depth }): Preset {
  const name = id === String(cm(w)) ? "" : `${id} `;
  const more = second ? ` (${second.label.toLowerCase()} ${cm(second.depth[1])})` : "";
  const d = second ? { [first[0]]: first[1], [second.depth[0]]: second.depth[1] } : { [first[0]]: first[1] };
  return { id, label: `${name}${cm(w)} × ${cm(first[1])}${more}`, w, d };
}

/** A preset named by its seat count, "3 seats", carrying the number (library.11). */
function seated(seats: number, w: number, first: Depth, second?: { label: string; depth: Depth }): Preset {
  return { ...preset(`${seats} seats`, w, first, second), seats };
}

const standard = (d: number): Depth => ["standard", d];
/** A built-in unit's closed and open depths (configurations folded and down, "Closed" and "Open"). */
const builtIn = (id: string, w: number, closed: number, open: number): Preset =>
  preset(id, w, ["folded", closed], { label: "Open", depth: ["down", open] });

export const BED_PRESETS: readonly Preset[] = [
  preset("Small single", 0.85, standard(1.95)),
  preset("Narrow single", 0.95, standard(2.05)),
  preset("Single", 1, standard(2.1)),
  preset("Small double", 1.3, standard(2.1)),
  preset("Double", 1.5, standard(2.1)),
  preset("King", 1.7, standard(2.1)),
  preset("Super king", 1.9, standard(2.1)),
  preset("US Queen", 1.62, standard(2.13)),
  preset("US King", 2.03, standard(2.13)),
];

/** The bed's widths and depths for the lift bed, the same depth up and down (heights.22). */
export const LIFT_BED_PRESETS: readonly Preset[] = BED_PRESETS.map((p) => {
  const d = p.d.standard ?? 2.1;
  return { ...p, d: { up: d, down: d } };
});
/** The bed's presets less the frame, rounded to the centimetre (1.7 − 0.1 is 1.5999…): a mattress's sizes (cleanup.07). */
export const MATTRESS_PRESETS: readonly Preset[] = BED_PRESETS.map((p) => {
  const less = (v: number): number => cm(v - BED_FRAME) / 100;
  return preset(p.id, less(p.w), standard(less(p.d.standard ?? 0)));
});
export const LOFT_BED_PRESETS: readonly Preset[] = [preset("Single", 1, standard(2.1)), preset("Double", 1.5, standard(2.1))];
/** Wall cabinets in the counter's narrower widths, 0.35 deep (heights.22). */
export const WALL_CABINET_PRESETS: readonly Preset[] = [0.4, 0.6, 0.8].map((w) => preset(String(cm(w)), w, standard(0.35)));

export const SOFA_PRESETS: readonly Preset[] = [
  seated(2, 1.5, standard(0.9)),
  seated(3, 2.1, standard(0.9)),
  seated(4, 2.8, standard(0.9)),
];

export const SOFA_BED_PRESETS: readonly Preset[] = [
  seated(2, 1.5, ["sofa", 0.9], { label: "Bed", depth: ["bed", 1.6] }),
  seated(3, 2.1, ["sofa", 0.9], { label: "Bed", depth: ["bed", 1.6] }),
];

export const WARDROBE_PRESETS: readonly Preset[] = [0.5, 1, 1.2, 1.5, 2, 2.5, 3].map((w) => preset(String(cm(w)), w, standard(0.6)));
export const DRAWERS_PRESETS: readonly Preset[] = [0.8, 1, 1.2].map((w) => preset(String(cm(w)), w, standard(0.5)));
export const DESK_PRESETS: readonly Preset[] = [1, 1.2, 1.4].map((w) => preset(String(cm(w)), w, standard(0.6)));

/** A one-configuration preset named by its size in cm, "160 × 120": the corner pieces', the coffee table's, the deeper baths' (catalog.05, .07). */
const preset2d = (w: number, d: number): Preset => ({ id: `${cm(w)} × ${cm(d)}`, label: `${cm(w)} × ${cm(d)}`, w, d: { standard: d } });
export const CORNER_DESK_PRESETS: readonly Preset[] = [preset2d(1.2, 1.2), preset2d(1.4, 1.4), preset2d(1.6, 1.2), preset2d(1.8, 1.4)];
export const CORNER_WARDROBE_PRESETS: readonly Preset[] = [preset2d(1.0, 1.0), preset2d(1.5, 1.0), preset2d(2.0, 1.5)];
export const CORNER_COUNTER_PRESETS: readonly Preset[] = [preset2d(1.8, 1.2), preset2d(2.4, 1.8), preset2d(3.0, 2.4)];
export const CORNER_SOFA_PRESETS: readonly Preset[] = [preset2d(2.2, 1.6), preset2d(2.6, 2.0), preset2d(3.0, 2.4)];

// The plant's diameters, width and depth equal, and the radiator's widths at one depth (catalog.08): no heights, so a
// pick leaves a piece's height alone (catalog.48, .50).
export const PLANT_PRESETS: readonly Preset[] = [0.3, 0.4, 0.6].map((w) => preset(String(cm(w)), w, standard(w)));
export const PALM_PRESETS: readonly Preset[] = [0.6, 0.9, 1.2].map((w) => preset(String(cm(w)), w, standard(w)));
export const FERN_PRESETS: readonly Preset[] = [0.4, 0.6, 0.8].map((w) => preset(String(cm(w)), w, standard(w)));
export const ROSETTE_PRESETS: readonly Preset[] = [0.3, 0.4, 0.5].map((w) => preset(String(cm(w)), w, standard(w)));
export const RADIATOR_PRESETS: readonly Preset[] = [0.4, 0.6, 0.8, 1, 1.2].map((w) => preset(String(cm(w)), w, standard(0.1)));
// The rugs' sizes (catalog.08), named by their width; no heights, so a rug stays 0.01 m thick.
const RUG_SIZES: readonly (readonly [w: number, d: number])[] = [[1.6, 1.2], [2, 1.4], [2.4, 1.7], [3, 2]];
export const RUG_PRESETS: readonly Preset[] = RUG_SIZES.map(([w, d]) => preset(String(cm(w)), w, standard(d)));
export const ROUND_RUG_PRESETS: readonly Preset[] = [1.2, 1.6, 2].map((w) => preset(String(cm(w)), w, standard(w)));

/**
 * `p` with a height, and an elevation when given, in every configuration it has a depth for (catalog.07), labelled
 * after its sizes: "Washer-dryer 60 × 60 h 170", "… at 150" (an elevation of 0 doesn't show).
 */
function withHeight(p: Preset, h: number, z?: OrCeiling): Preset {
  const configs = Object.keys(p.d);
  const at = z === undefined || z === 0 ? "" : ` at ${z === "ceiling" ? z : cm(z)}`;
  const each = <T>(v: T): Record<string, T> => Object.fromEntries(configs.map((c) => [c, v]));
  return { ...p, label: `${p.label} h ${cm(h)}${at}`, h: each(h), ...(z === undefined ? {} : { z: each(z) }) };
}

/** A stacked washer-dryer differs from the washer only by height (catalog.07). */
export const WASHING_MACHINE_PRESETS: readonly Preset[] = [
  withHeight(preset("Washer", 0.6, standard(0.6)), 0.85),
  withHeight(preset("Washer-dryer", 0.6, standard(0.6)), 1.7),
];

// Bathroom (furnish.13). The 80 × 120 tray is "Rectangular": ids are unique per kind, and "80" is the square tray.
export const WASHBASIN_PRESETS: readonly Preset[] = [preset("50", 0.5, standard(0.4)), preset("60", 0.6, standard(0.45)), preset("80", 0.8, standard(0.5))];
export const VANITY_PRESETS: readonly Preset[] = [0.6, 0.8, 1, 1.2, 1.4].map((w) => preset(String(cm(w)), w, standard(0.5)));
export const SHOWER_TRAY_PRESETS: readonly Preset[] = [
  ...[0.7, 0.8, 0.9].map((s) => preset(String(cm(s)), s, standard(s))),
  preset("Rectangular", 0.8, standard(1.2)),
];
export const CORNER_SHOWER_PRESETS: readonly Preset[] = [0.8, 0.9].map((s) => preset(String(cm(s)), s, standard(s)));
export const BATHTUB_PRESETS: readonly Preset[] = [...[1.5, 1.6, 1.7].map((w) => preset(String(cm(w)), w, standard(0.7))), preset2d(1.7, 0.75), preset2d(1.8, 0.8), preset2d(1.9, 0.9)];
export const TOILET_PRESETS: readonly Preset[] = [withHeight(preset("Wall-hung", 0.36, standard(0.54)), 0.42), withHeight(preset("Standard", 0.4, standard(0.65)), 0.9), withHeight(preset("Composting", 0.45, standard(0.6)), 0.9)];

// Kitchen modules and the living pieces (furnish.11): the width varies, the depth is the module's; a round table's
// diameter is both sizes.
export const SINK_UNIT_PRESETS: readonly Preset[] = [0.8, 1.2].map((w) => preset(String(cm(w)), w, standard(0.6)));
export const COUNTER_PRESETS: readonly Preset[] = [0.3, 0.45, 0.6, 0.9, 1.2].map((w) => preset(String(cm(w)), w, standard(0.6)));
export const DISHWASHER_PRESETS: readonly Preset[] = [0.45, 0.6].map((w) => preset(String(cm(w)), w, standard(0.6)));
export const ROUND_TABLE_PRESETS: readonly Preset[] = [0.8, 0.9, 1, 1.2, 1.4, 1.7].map((w) => preset(String(cm(w)), w, standard(w)));
export const TV_UNIT_PRESETS: readonly Preset[] = [1.2, 1.6, 1.8, 2].map((w) => preset(String(cm(w)), w, standard(0.4)));
export const COFFEE_TABLE_PRESETS: readonly Preset[] = [preset2d(0.9, 0.5), preset2d(1, 0.5), preset2d(1.1, 0.6), preset2d(1.2, 0.7)];
/** Named by their burners, which their width gives (the symbol's `hobBurners`, catalog.07). */
export const HOB_UNIT_PRESETS: readonly Preset[] = [preset("2 burners", 0.3, standard(0.6)), preset("4 burners", 0.6, standard(0.6)), preset("5 burners", 0.75, standard(0.6)), preset("6 burners", 0.9, standard(0.6))];
export const FRIDGE_PRESETS: readonly Preset[] = [
  withHeight(preset("Tall", 0.6, standard(0.65)), 1.9),
  withHeight(preset("70 cm", 0.7, standard(0.65)), 2),
  withHeight(preset("Under-counter", 0.6, standard(0.6)), 0.85),
  withHeight(preset("Compact", 0.48, standard(0.5)), 0.85),
  withHeight(preset("US French door", 0.91, standard(0.75)), 1.78),
  withHeight(preset("12 V", 0.45, standard(0.5)), 0.55),
];
/** Each gives its height and elevation, so a pick from Wall shelf never leaves a shelf hanging at 1.50 (catalog.07, .22). */
export const SHELF_PRESETS: readonly Preset[] = [
  withHeight(preset("Standard", 0.8, standard(0.4)), 1.5, 0),
  withHeight(preset("Bookcase", 0.8, standard(0.3)), 2, 0),
  withHeight(preset("Cube", 0.77, standard(0.39)), 0.77, 0),
  withHeight(preset("Wall shelf", 0.8, standard(0.25)), 0.3, 1.5),
];

export const EXTENDING_TABLE_PRESETS: readonly Preset[] = [
  seated(4, 0.8, ["closed", 1.2], { label: "Extended", depth: ["extended", 1.66] }),
  seated(6, 0.9, ["closed", 1.6], { label: "Extended", depth: ["extended", 2.06] }),
  seated(8, 0.9, ["closed", 1.6], { label: "Extended", depth: ["extended", 2.4] }),
  seated(10, 1, ["closed", 2], { label: "Extended", depth: ["extended", 3] }),
  seated(12, 1, ["closed", 2.4], { label: "Extended", depth: ["extended", 3.4] }),
];

// The aggregates (seating.07): sizes are the whole piece, chairs included. A round set is named by its table (Ø 0.90,
// 1.20, 1.50), its diameter the smallest whole centimetre that holds it; the desk set is the 1.20 × 0.60 desk.
const ceilCm = (v: number): number => Math.ceil(v * 100 - 1e-9) / 100;
const roundSet = (seats: number, table: number, reach: number): Preset => {
  const D = ceilCm(roundSetDiameter(table, reach));
  return seated(seats, D, standard(D));
};
// A dining set is named by its seats, its table 1.20 × 0.80, then 1.40, 2.00 and 2.60 × 0.90 with end chairs (library.06): the
// table plus SEATED_REACH on each side with chairs (seated.01); a 1.20 table has no end chairs.
export const SEATED_DINING_PRESETS: readonly Preset[] = [
  seated(4, 1.2, standard(2)),
  seated(6, 2.6, standard(2.1)),
  seated(8, 3.2, standard(2.1)),
  seated(10, 3.8, standard(2.1)),
];
export const SEATED_ROUND_PRESETS: readonly Preset[] = [roundSet(4, 0.9, SEATED_REACH), roundSet(6, 1.2, SEATED_REACH), roundSet(8, 1.5, SEATED_REACH)];
export const DESK_SET_PRESETS: readonly Preset[] = [preset("120", 1.2, standard(cm(deskSetDepth(0.6)) / 100))];

export const BUILT_IN_TABLE_PRESETS: readonly Preset[] = [builtIn("120", 1.2, 0.35, 1.15)];
export const BUILT_IN_DESK_PRESETS: readonly Preset[] = [builtIn("100", 1, 0.35, 0.95)];
export const MURPHY_BED_PRESETS: readonly Preset[] = [builtIn("Single", 1, 0.4, 2.1), builtIn("Double", 1.6, 0.4, 2.1)];

// Decks (spec "The deck", decks.12, .16): a hollow deck is a fixed DECK_THICKNESS thick; a solid one fills down to
// the floor. Each preset gives a new deck its name, top and solid flag.

export const DECK_THICKNESS = 0.12;
export const DECK_PRESETS = {
  platform: { name: "Platform", top: 0.45, solid: true },
  loft: { name: "Loft", top: 2.15, solid: false }, // underside 2.03, the US 6'8" standing height
} as const;
export type DeckPreset = keyof typeof DECK_PRESETS;
export const MIN_DECK_SIZE = 0.3; // metres, width and depth
export const MIN_DECK_TOP = 0.15;
export const MAX_DECK_TOP = 10;
export const DEFAULT_DECK_SIZE = { w: 2, d: 1.4 } as const;

/** Whether `v` names a deck preset (commands arrive as JSON from MCP and the editor). */
export function isDeckPreset(v: unknown): v is DeckPreset {
  return typeof v === "string" && Object.hasOwn(DECK_PRESETS, v);
}

// The pieces for small homes (spec pieces, pieces.02): a 24" range with a 30" one, a chimney hood hung from the ceiling
// and a slim one under a wall cabinet, and a tall pantry with a 2.40 m one.
export const RANGE_PRESETS: readonly Preset[] = [0.5, 0.6, 0.76].map((w) => preset(String(cm(w)), w, standard(0.6)));
export const COOKER_HOOD_PRESETS: readonly Preset[] = [
  withHeight(preset("Chimney", 0.6, standard(0.5)), 0.9, "ceiling"),
  withHeight(preset("Wide chimney", 0.9, standard(0.5)), 0.9, "ceiling"),
  withHeight(preset("Slim", 0.6, standard(0.48)), 0.15, 1.25),
];
// Every pantry preset gives its height, so the picker never leaves a stale one behind (preset-lists.test.ts).
export const TALL_PANTRY_PRESETS: readonly Preset[] = [...[0.6, 0.8, 1].map((w) => withHeight(preset(String(cm(w)), w, standard(0.6)), 2.1)), withHeight(preset("Tall", 0.8, standard(0.6)), 2.4)];
// Stools at counter and bar height; a bar table at bar and counter height and a wall ledge hung at 1.00 m (every
// preset gives its elevation, all or none); a storage bench and a deeper window seat; two storage chests (pieces.02, .06).
export const STOOL_PRESETS: readonly Preset[] = [withHeight(preset("Counter", 0.4, standard(0.4)), 0.65), withHeight(preset("Bar", 0.4, standard(0.4)), 0.75)];
export const BAR_TABLE_PRESETS: readonly Preset[] = [
  ...[1.2, 1.5].map((w) => withHeight(preset(String(cm(w)), w, standard(0.6)), 1.05, 0)),
  withHeight(preset("Counter height", 1.2, standard(0.6)), 0.9, 0),
  withHeight(preset("Wall ledge", 1.2, standard(0.3)), 0.05, 1),
];
export const BENCH_PRESETS: readonly Preset[] = [preset("Storage bench", 1.2, standard(0.45)), preset("Window seat", 1.2, standard(0.5))];
export const STORAGE_CHEST_PRESETS: readonly Preset[] = [preset("80", 0.8, standard(0.45)), preset("100", 1, standard(0.5))];
// The electric fireplace's widths; the wall unit's five services, each at its own height and elevation (pieces.02).
export const ELECTRIC_FIREPLACE_PRESETS: readonly Preset[] = [1, 1.2, 1.5].map((w) => preset(String(cm(w)), w, standard(0.2)));
export const WALL_UNIT_PRESETS: readonly Preset[] = [
  withHeight(preset("Mini-split head", 0.8, standard(0.2)), 0.28, 2),
  withHeight(preset("Water heater", 0.35, standard(0.2)), 0.55, 0.5),
  withHeight(preset("Electrical panel", 0.35, standard(0.1)), 0.5, 1.4),
  withHeight(preset("Wall heater", 0.5, standard(0.12)), 0.5, 0.3),
  withHeight(preset("Through-wall AC", 0.6, standard(0.25)), 0.4, 1),
];
// A wood stove on its hearth: a small one and a medium one, each with its height (pieces.02).
// A wheel well over one, two or three axles' tyres (trailer.11), 0.40 deep and 0.35 tall.
export const WHEEL_WELL_PRESETS: readonly Preset[] = [["Single", 0.9], ["Tandem", 1.8], ["Triple", 2.7]].map(([label, w]) => withHeight(preset(String(label), Number(w), standard(0.4)), 0.35));
/** Beams, all hung from the ceiling (beams.03): a beam, a heavy one, and a lighter, shorter collar tie. */
export const BEAM_PRESETS: readonly Preset[] = [
  withHeight(preset("Beam", 2.4, standard(0.15)), 0.2, "ceiling"),
  withHeight(preset("Heavy beam", 2.4, standard(0.2)), 0.3, "ceiling"),
  withHeight(preset("Collar tie", 1.8, standard(0.1)), 0.15, "ceiling"),
];
export const WOOD_STOVE_PRESETS: readonly Preset[] = [withHeight(preset("Small", 0.75, standard(0.75)), 0.65), withHeight(preset("Medium", 0.95, standard(0.95)), 0.75)];

// The hung pieces' and the coat stand's presets (hangings.02): common product sizes with the height a piece is usually
// hung at, each its width, depth (2 to 10 cm for a hung piece, hangings.03), height and elevation; the towel rail's.

/** A hung piece's preset: its id, width and depth, then its height and elevation above its surface. */
const hung = (id: string, w: number, d: number, h: number, z: number): Preset => withHeight(preset(id, w, standard(d)), h, z);

/** Frames and posters, centred about 1.5 m up (a frame's size, not the print's). */
export const PICTURE_PRESETS: readonly Preset[] = [
  hung("A4 frame", 0.25, 0.03, 0.33, 1.4),
  hung("A3 frame", 0.33, 0.03, 0.45, 1.35),
  hung("Poster", 0.53, 0.03, 0.73, 1.15),
  hung("Large poster", 0.73, 0.03, 1.03, 1),
  hung("Canvas", 0.6, 0.04, 0.6, 1.2),
];
export const MIRROR_PRESETS: readonly Preset[] = [
  hung("Small", 0.4, 0.03, 0.6, 1.3),
  hung("Bathroom", 0.6, 0.03, 0.8, 1.1),
  hung("Large", 0.8, 0.03, 1, 1),
  hung("Full length", 0.5, 0.03, 1.5, 0.3),
];
/** By its diameter: a round clock in a square box. */
export const CLOCK_PRESETS: readonly Preset[] = [hung("30", 0.3, 0.05, 0.3, 1.8), hung("40", 0.4, 0.05, 0.4, 1.75), hung("60", 0.6, 0.05, 0.6, 1.65)];
/** By the screen's diagonal in inches; the TV's bottom at 1.00 m. */
export const WALL_TV_PRESETS: readonly Preset[] = [
  hung('32"', 0.73, 0.06, 0.43, 1),
  hung('43"', 0.97, 0.06, 0.57, 1),
  hung('55"', 1.24, 0.06, 0.72, 1),
  hung('65"', 1.46, 0.06, 0.84, 1),
];
export const PEGBOARD_PRESETS: readonly Preset[] = [hung("60", 0.6, 0.1, 0.6, 1), hung("90", 0.9, 0.1, 0.6, 1), hung("120", 1.2, 0.1, 0.75, 1)];
export const COAT_HOOKS_PRESETS: readonly Preset[] = [0.6, 0.9, 1.2].map((w) => hung(String(Math.round(w * 100)), w, 0.08, 0.12, 1.6));
/** A coat stand on the floor, round: its base's diameter and its height. */
/** The glass cabinets' sizes (the user's request after hangings): one door at 40, two at 80, 30 deep, 2.02 tall. */
export const GLASS_CABINET_PRESETS: readonly Preset[] = [0.4, 0.8].map((w) => withHeight(preset(String(cm(w)), w, standard(0.3)), 2.02));
export const COAT_STAND_PRESETS: readonly Preset[] = [withHeight(preset("45", 0.45, standard(0.45)), 1.75), withHeight(preset("50", 0.5, standard(0.5)), 1.85)];
export const TOWEL_RAIL_PRESETS: readonly Preset[] = [hung("Small", 0.5, 0.1, 0.8, 0.15), hung("Medium", 0.5, 0.1, 1.2, 0.15), hung("Tall", 0.6, 0.1, 1.5, 0.15)];
