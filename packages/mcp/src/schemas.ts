import { SHUTTER_BOX, FALLS_LABELS, LOWER_HEIGHT, MAX_HIGH_SIDE, MAX_OVERHANG, MAX_PITCH, MIN_PITCH, ROOF_PRESETS, ROOF_SHAPES, DECK_PRESETS, GUARDS, GUARD_DROP, GUARD_HEIGHT, MAX_GUARD_HEIGHT, MIN_GUARD_HEIGHT, HANDRAILS, MOTIF_IDS, DECK_THICKNESS, DEFAULT_WALL_THICKNESS, HEAD_CLEAR, defaultOpeningHeights, SIZE_LIMITS, sizeRange, shown, familyKinds, isDeckPreset, kindConfigs, MAX_CEILING, MAX_DECK_TOP, MIN_AREA_SIZE, MIN_DECK_SIZE, MIN_DECK_TOP, MIN_CEILING, MIN_WALL_TOP, MAX_DIMENSION_OFFSET, MAX_SHEET_TEXT, MIN_SECTION_LENGTH, PROJECT_FIELDS, SET_FIELDS, SHEET_SCALES, SHEET_SIZES, SHEET_SLOTS, SHEET_SPLITS, MAX_OBJECT_SIZE, MAX_WALL_THICKNESS, MIN_HEIGHT, SHEET_KINDS, MIN_OBJECT_SIZE, MIN_WALL_THICKNESS, MIN_ZONE_SIZE, OBJECT_KINDS, OPENING_KINDS, OPENING_KIND_IDS, EDGE_TOLERANCE, PLAN_SIDES, type ObjectOption, type OpeningKind, type StairEdgeShape } from "@fm/domain";
import { PRESET_NAMES, presetNamesOf } from "./preset-names";
import { DEFAULT_ANGLES, FURNITURE_SETS, TILT_MAX, TILT_MIN } from "@fm/editor";
import { isWireId, MAX_NAME_CHARS } from "@fm/protocol";
import { z } from "zod";
import { MAX_LISTED_WALLS } from "./drawing";

const ROOF_PRESET_IDS = ["tinyShed", "tinyGable", "smallShed", "smallGable"] as const satisfies readonly (typeof ROOF_PRESETS)[number]["id"][];
/** The falls directions as Claude names them, the plan's words in lower case (roofs.05). */
export const FALLS_WORDS = ["lower", "upper", "left", "right"] as const;
export const FALLS_OF_WORD = { lower: "-y", upper: "+y", left: "-x", right: "+x" } as const satisfies Record<(typeof FALLS_WORDS)[number], keyof typeof FALLS_LABELS>;

const m = shown;
/** The kinds that take an option, by label, lower case: "a, b or c". */
const optionKinds = (option: ObjectOption): string => {
  const labels = OBJECT_KINDS.filter((k) => !k.retired && k.options.includes(option)).map((k) => k.label.toLowerCase());
  return labels.length < 2 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1) ?? ""}`;
};

// The MCP trust boundary (process lesson 29): every tool input is bounded in shape and size here. The SDK parses
// arguments with these shapes before a handler runs; unknown fields are dropped.

export const MAX_COORD = 10_000; // metres: a floor plan, not a map
export const MAX_SIZE = 1_000; // metres
export const MAX_DELETE = 50;
export const MAX_WALLS = 50;
export const MAX_OBJECTS_MOVED = 200; // pieces a move_walls call may carry
export const MAX_FIELD_VALUE = 1_000; // characters: a bound for the boundary; the domain checks each field's own limit

const coord = z.number().min(-MAX_COORD).max(MAX_COORD);
const point = z.object({ x: coord, y: coord }).describe("A point in metres; y points up");
const size = z.number().gt(0).max(MAX_SIZE);
const thickness = z.number().min(MIN_WALL_THICKNESS).max(MAX_WALL_THICKNESS).describe(`Wall thickness in metres, ${m(MIN_WALL_THICKNESS)} to ${m(MAX_WALL_THICKNESS)}; default ${m(DEFAULT_WALL_THICKNESS)}`);
const id = z.string().refine(isWireId, { message: "Not an id: use the ids get_drawing returns" });
const name = z.string().trim().min(1).max(MAX_NAME_CHARS);

// Layouts (spec: layouts): kinds and configurations are the domain's curated list. Rotation is any whole number
// of degrees (zod keeps it a safe integer); the domain normalises it to 0–359. A retired kind can't be placed
// (furnish.19), but stays in the configuration and preset enums, for stored pieces.
const placeable = OBJECT_KINDS.filter((k) => !k.retired);
const kind = z
  .enum(placeable.map((k) => k.id))
  .describe("Object kind; configurations with width × depth in metres, the first is the default: " +
    placeable.map((k) => `${k.id} = ${k.label} (${kindConfigs(k.id).map((c) => `${c.id} ${c.w}×${c.d}`).join(", ")})`).join("; "));
const config = z.enum([...new Set(OBJECT_KINDS.flatMap((k) => kindConfigs(k.id).map((c) => c.id)))]).describe("A configuration of the object's kind");
const objectSize = z.number().min(MIN_OBJECT_SIZE).max(MAX_OBJECT_SIZE);
const objectHeight = z.number().min(MIN_HEIGHT).max(MAX_OBJECT_SIZE); // lower than width and depth: a rug (catalog.22)
// Heights (heights.20, .37): "ceiling" is a word, the same on the wire and in storage; the domain checks the bounds
// against the ceiling, so its reason reaches Claude unchanged.
const elevation = z
  .union([z.number().min(0).max(MAX_OBJECT_SIZE), z.literal("ceiling")])
  .describe('Elevation of the bottom above the floor in metres, or "ceiling" to hang it against the ceiling (it follows the ceiling)');
const wallTop = z
  .union([z.number().min(MIN_WALL_TOP).max(MAX_CEILING), z.literal("ceiling")])
  .describe(
    `A wall's fixed height in metres above what it stands on (the floor, or its deck's top), from ${m(MIN_WALL_TOP)} up to ` +
      'the ceiling, or "ceiling" for a wall that follows the ceiling',
  );
// Size presets (smart.12, .42): every kind's names in one enum, as kinds are (sheet.32), named as preset-names.ts says
// (mcp step 06); a handler checks that the preset is one of the object's own kind.
const preset = z.enum(PRESET_NAMES).describe(
  `A standard size of the object's kind, by its name, or by its size when it has none ("${presetNamesOf("bathtub")[0] ?? ""}"); each is listed by ` +
    "name, width × depth in cm, other configurations' depths in brackets, then any height after h and elevation after at: " +
    OBJECT_KINDS.filter((k) => k.presets.length > 0).map((k) => `${k.id}: ${k.presets.map((p) => p.label).join(", ")}`).join("; "),
);
// A side's use zone (furnish.14, .20): on or off, the kind's default, or a depth and two insets along the side.
const inset = z.number().min(0).max(MAX_OBJECT_SIZE);
const zoneSide = (name: string) =>
  z
    .union([
      z.boolean(),
      z.literal("default"),
      z.object({ depth: z.number().min(MIN_ZONE_SIZE).max(MAX_OBJECT_SIZE).optional(), start: inset.optional(), end: inset.optional() }),
    ])
    .optional()
    .describe(
      `The ${name} side's use zone: true or false turns it on or off; { depth, start, end } turns it on with that depth ` +
        "and its two ends inset from the side's corners (front and back from the piece's left corner, left and right from " +
        "its back corner), in metres, numbers left out kept as they are; \"default\" turns it on at the kind's default; " +
        "default: as it is" +
        (name === "front" ? ". On an L piece's front zone (two strips, one before each arm's inner edge) start trims the left arm's strip from that arm's front end and end the back arm's strip from that arm's right end" : ""),
    );
// What a built-in unit opens into: the family's members (smart.21), read from the kinds table, never by kind id.
const into = z
  .enum(familyKinds("builtIn").flatMap((k) => (k.opensInto === null ? [] : [k.opensInto.toLowerCase()])))
  .describe("What the built-in unit opens into");
const rotation = z.number().int().describe("Whole degrees, counter-clockwise; at 0 the front faces −y");
const layout = id.describe("A layout id from get_drawing's layouts");
const object = id.describe("An object id from get_drawing's objects");
const centre = point.describe("The footprint's centre in metres; y points up");

// Openings (spec: openings): widths are the domain's ranges; whether an opening fits its wall is the domain's check (I12).
// The door and window kinds are the domain table's rows each tool adds (`tool`), in its order; the first is the default.
// One width bound per tool spans its kinds' ranges; the domain refuses a width outside the kind's own (openkinds.12).
const DOOR_KINDS = OPENING_KIND_IDS.filter((k) => OPENING_KINDS[k].tool === "add_door");
const WINDOW_KINDS = OPENING_KIND_IDS.filter((k) => OPENING_KINDS[k].tool === "add_window");
/** A window's dressing on its room side (hangings.04), add_window's and set_opening's. */
const dressing = {
  sheer: z.enum(["none", "glass", "floor"]).optional().describe("A window's sheer curtain: none, to the glass (sill to head) or to the floor"),
  shutterBox: z.boolean().optional().describe(`A window's roller-shutter box above its head on the room side; needs ${SHUTTER_BOX.height} m of wall above the head`),
};
const kindList = (kinds: readonly string[]): string => kinds.map((k, i) => (i === 0 ? `${k} (default)` : k)).join(" or ");
const widthsOf = (kinds: readonly OpeningKind[]) => ({ min: Math.min(...kinds.map((k) => OPENING_KINDS[k].width.min)), max: Math.max(...kinds.map((k) => OPENING_KINDS[k].width.max)) });
const door = widthsOf(DOOR_KINDS);
const win = widthsOf(WINDOW_KINDS);
const wall = id.describe("A wall id");
const offset = z.number().min(0).max(MAX_SIZE).describe("Metres along the wall from its joint a to the opening's end nearer a");
/** A new door's and window's heights on a tall wall (sills.01), from the domain's one owner. */
const NEW_DOOR = defaultOpeningHeights(true, Infinity);
const NEW_WINDOW = defaultOpeningHeights(false, Infinity);
const openingSill = z.number().min(0).max(MAX_SIZE).describe(`Metres from the wall's bottom (the floor, or its deck's top) to the window's underside; default ${m(NEW_WINDOW.sill)}`);
const openingHeight = z.number().positive().max(MAX_SIZE).describe(`The opening's own height in metres, from its sill (a door's from the wall's bottom); default to ${m(NEW_DOOR.head)} above the wall's bottom, or ${m(HEAD_CLEAR)} under a lower wall's top`);

// Dimensions (dims): the domain anchors each end; how short a dimension may be is the domain's check.
const dimensionEnd = point.describe("An end; a room's floor corner or a joint ties it to the walls");
const dimensionOffset = z
  .number()
  .min(-MAX_DIMENSION_OFFSET)
  .max(MAX_DIMENSION_OFFSET)
  .describe("Metres from the line from→to to the dimension line, positive on the left looking from from to to");

// The underlay (import.08, .13): look's region must have area, or its zoom would be infinite, so it is strict where
// get_drawing's allows a flat box. scale_underlay's distance is only bounded: the domain refuses one of 0 or less, so
// the reason reads the same through every client.
const lookRegion = z
  .object({ min: point, max: point })
  .refine((r) => r.min.x < r.max.x && r.min.y < r.max.y, { message: "min must be below max on both axes" });

// Project fields (sheet.06, .32): the key is the domain's list, as object kinds are, so a client sees the keys in the
// tool's schema and a wrong one stops here; the description adds labels and limits.
const ALL_FIELDS = [...PROJECT_FIELDS, ...SET_FIELDS];
const fieldKey = z.enum(ALL_FIELDS.map((f) => f.key)).describe(
  "The field: " + ALL_FIELDS.map((f) => `${f.key} (${f.label}, up to ${f.maxLength} characters${f.multiline ? ", line breaks allowed" : ""})`).join(", "),
);

// Sheets (sheetset; AC-15): the kinds, splits and sizes are the domain's lists. A scale and a text are only bounded here, so
// a wrong one reads in the domain's words, as a refused edit does; the text's bound stops a flood, not a long report.
const sheetId = id.describe("A sheet id from get_drawing's sheets");
const sheetFields = {
  inPdf: z.boolean().optional().describe("Whether it prints and takes a number; default true on a new sheet"),
  scale: z.union([z.number(), z.literal("general")]).optional().describe(`The N of its own scale of one to N, one of ${SHEET_SCALES.join(", ")}, or "general" to follow the set's generalScale (the default)`),
  split: z.enum(SHEET_SPLITS).optional().describe("A compare or section sheet's panes: auto (whichever lets the drawing be largest; the default), stacked or sideBySide"),
  framing: z.object({ x: coord, y: coord }).optional().describe("The point at the frame's centre, in metres from the centre of what's drawn on the floor (on a section sheet, of the section: along the cut and up), y up; both zero (the default) centres it"),
  finishes: z.boolean().optional().describe("Whether it draws floor finishes; default true"),
  marks: z.boolean().optional().describe("Whether its plans draw the section marks; default true"),
  drawings: z
    .array(z.object({ layout, deck: id.optional().describe("A loft's deck id from get_drawing's levels; left out for the floor") }))
    .max(16)
    .optional()
    .describe(`What it draws, each a layout at a level: one on a plan or a cover, two to ${SHEET_SLOTS.length} on a compare sheet, one to ${SHEET_SLOTS.length} floor layouts on a section sheet, none on a report`),
  text: z.string().max(5 * MAX_SHEET_TEXT).optional().describe(`A report's whole text, up to ${MAX_SHEET_TEXT.toLocaleString("en-US")} characters: # title, ## heading, **bold**, *italic*; a blank line starts a paragraph`),
  size: z.enum(SHEET_SIZES).optional().describe("A report's body size; default normal"),
  section: id.optional().describe("A section sheet's section, a letter from get_drawing's sections"),
};

// Decks (decks.08, .16): presets and limits are the domain's; whether a deck fits (I18) is the domain's check, whose
// refusal reaches Claude unchanged. `on` names the surface a piece stands on: the floor or a deck ID.
const deckPreset = z
  .enum(Object.keys(DECK_PRESETS).filter(isDeckPreset))
  .describe(
    "The deck's preset, default platform: " +
      Object.entries(DECK_PRESETS)
        .map(([id, p]) => `${id} = ${p.name} (top ${m(p.top)} m, ${p.solid ? "solid" : `hollow, a ${m(DECK_THICKNESS)} m slab`})`)
        .join("; "),
  );
const deck = id.describe("A deck id from get_drawing's decks");
const guardSide = z.object({
  kind: z.enum(GUARDS).optional().describe("railing, glass or none"),
  height: z.number().min(MIN_GUARD_HEIGHT).max(MAX_GUARD_HEIGHT).optional().describe(`Metres above the deck's top, ${m(MIN_GUARD_HEIGHT)} to ${m(MAX_GUARD_HEIGHT)} (default ${m(GUARD_HEIGHT)}); a wall closes a side only as tall; left out: kept`),
}).strict();
const deckSize = z.number().min(MIN_DECK_SIZE).max(MAX_SIZE);
const areaSize = z.number().min(MIN_AREA_SIZE).max(MAX_SIZE);
const deckFields = {
  name: name.optional().describe("The deck's name; default: the preset's, numbered when taken"),
  centre: point.describe("The deck's centre in metres; y points up"),
  width: deckSize.describe(`Width in metres along x before rotation, at least ${m(MIN_DECK_SIZE)}`),
  depth: deckSize.describe(`Depth in metres along y before rotation, at least ${m(MIN_DECK_SIZE)}`),
  rotation: z.number().int().optional().describe("Whole degrees, counter-clockwise; default 0"),
  top: z.number().min(MIN_DECK_TOP).max(MAX_DECK_TOP).optional().describe(`The deck's top above the floor in metres, ${m(MIN_DECK_TOP)} to ${MAX_DECK_TOP}`),
  solid: z.boolean().optional().describe(`true: filled from the floor to its top; false: hollow, a ${m(DECK_THICKNESS)} m slab under its top`),
  guard: z.enum(GUARDS).optional().describe(`What every side's open edges have: railing, glass or none (each side keeps its height). A new deck higher than ${m(GUARD_DROP)} m starts with a railing on all four sides, a lower one with none; a side keeps its guard when the top changes. Drawn only: it refuses nothing`),
  guards: z.object(Object.fromEntries(PLAN_SIDES.map((s) => [s, guardSide.optional()]))).strict().optional()
    .describe(`Per side, by where it faces on the plan now (upper is +y, right +x): kind and height; given over guard. A turned deck's names follow its new rotation`),
};
const on = z
  .union([z.literal("floor"), id])
  .optional()
  .describe('What the piece stands on: "floor" or a deck id; default: where it lands at the floor level (its surface now if it fits, else the floor, else a deck below the floor\'s cut under its centre; putting it on a loft needs on)');
// Stairs (stairs.10, stairdraw.08): the deck a stair reaches sets its height; links are explicit, so without it a new
// stair reaches nothing and a moved one keeps its link. The domain refuses it on furniture.
const reaches = deck
  .optional()
  .describe("Stairs only: the deck id the stair reaches; its height becomes that deck's top less what it stands on. Default: nothing (touching a deck's edge links nothing)");
const moveReaches = z
  .union([z.literal("nothing"), id])
  .optional()
  .describe('Stairs only: the deck id the stair now reaches (its height follows), or "nothing" to unlink it, keeping its height; default: what it reaches now');

// add_stair (stairdraw.16): stair kinds only, from the kinds table's stair column; the shape names the domain's
// StairEdgeShape. Which edges catch and what fits is the domain's to say.
const stairKinds = placeable.filter((k) => k.stair !== null);
const stairKind = z
  .enum(stairKinds.map((k) => k.id))
  .describe("A stair or ladder kind: " + stairKinds.map((k) => `${k.id} = ${k.label}`).join("; "));
// A stair's handrail (guards.28): a rung ladder has none, so it's ignored there by add_stair and refused by set_stair.
const handrail = z.enum(HANDRAILS);
const STAIR_SHAPES = ["straight", "l-left", "l-right"] as const satisfies readonly StairEdgeShape[];
const stairShape = z
  .enum(STAIR_SHAPES)
  .optional()
  .describe("straight (default), or an L turning left or right as seen from the floor facing the edge: l-left puts the lower flight on the left");

// Columns (pillars.15, .19): sizes are bounded only here, so a width or depth out of the column limits reaches the
// domain and comes back with its range; whether a column fits is the domain's check.
const { width: columnWidth, depth: columnDepth } = SIZE_LIMITS.column;
const columnFields = {
  centre: point.describe("The column's centre in metres; y points up"),
  width: size.describe(`Width in metres along its rotation, ${sizeRange(columnWidth)}`),
  depth: size.describe(`Depth in metres across it, ${sizeRange(columnDepth)}`),
  rotation: z.number().min(-360).max(360).describe("Degrees counter-clockwise from +x to its width"),
};
// A column's base and top (pillars.23, .48): `on` is its base, `top` a height from it; the domain checks the rest.
const columnOn = z
  .union([z.literal("floor"), deck])
  .optional()
  .describe('What it stands on: "floor" (default) or a deck id at or above the floor\'s cut (a loft); it then lies on that deck, from its top up');
const columnTop = z
  .union([z.literal("ceiling"), z.number().min(MIN_WALL_TOP).max(MAX_CEILING), deck])
  .optional()
  .describe(
    `"ceiling" (default), a height in metres above its base, at least ${m(MIN_WALL_TOP)}, or, for a free column on the floor only, ` +
      "a deck id at or above the floor's cut (a loft): it then reaches up to the deck's underside and lies within the deck on the plan",
  );

// A wall's base (pillars.08, .09, .58): `on` is sent as addWall's base; where its ends go and what it may hold is the
// domain's check.
const wallOn = z
  .union([z.literal("floor"), deck])
  .optional()
  .describe(
    'What it stands on: "floor" (default) or a deck id at or above the floor\'s cut (a loft). A wall on a deck (a partition ' +
      "or knee wall on a loft) lies inside the deck, from its top up to the ceiling (set_wall_top: a height above the deck); " +
      "an end that meets a wall on the floor stops flush against its face and doesn't split it; its doors and windows " +
      "measure from the deck's top, and it makes no room",
  );
const newWall = { a: point, b: point, thickness: thickness.optional(), on: wallOn };
// A finish's fields (finishes.17, .27): loose here, so a value out of range comes back as the domain's message naming
// the range rather than zod's.
const finishNumber = z.number().min(-MAX_SIZE).max(MAX_SIZE);

export const SCHEMAS = {
  create_project: { name: z.string().trim().min(1).max(MAX_NAME_CHARS) },
  open_project: { id: id.describe("A project id from list_projects") },
  get_drawing: {
    region: z
      .object({ min: point, max: point })
      .refine((r) => r.min.x <= r.max.x && r.min.y <= r.max.y, { message: "min must not exceed max" })
      .optional()
      .describe(`List only what touches this box; needed for drawings of more than ${MAX_LISTED_WALLS} walls`),
  },
  draw_room: {
    corner: point.describe("The room's lower-left corner (smallest x and y) on the walls' lines, in metres; y points up"),
    width: size.describe("The room's size along x in metres, between the walls' lines"),
    depth: size.describe("The room's size along y in metres, between the walls' lines"),
    thickness: thickness.optional(),
  },
  add_wall: newWall,
  add_walls: { walls: z.array(z.object(newWall)).min(1).max(MAX_WALLS).describe("Walls from a to b, drawn in this order") },
  set_wall_length: { wall: id.describe("A wall id"), length: size.describe("New length in metres; endpoint a stays") },
  set_wall_thickness: { wall: id.describe("A wall id"), thickness: thickness.describe(`New wall thickness in metres, ${m(MIN_WALL_THICKNESS)} to ${m(MAX_WALL_THICKNESS)}`) },
  set_wall_top: { wall: id.describe("A wall id"), top: wallTop },
  set_ceiling: {
    preset: z.enum(ROOF_PRESET_IDS).optional().describe(`A roof preset: ${ROOF_PRESETS.map((p) => `${p.id} (${p.label}, ${m(p.height)} m at ${p.pitch}°)`).join(", ")}; the other values change it`),
    shape: z.enum(ROOF_SHAPES).optional().describe("flat, or a shed or gable roof whose underside is the ceiling over the floor walls' outer box"),
    height: z.number().min(MIN_CEILING).max(MAX_CEILING).optional().describe(`The flat ceiling's height, or a roof's low side (a shed's low wall, a gable's eaves) at the walls' outer face, in metres, ${m(MIN_CEILING)} to ${MAX_CEILING}`),
    pitch: z.number().min(MIN_PITCH).max(MAX_PITCH).optional().describe(`The roof's pitch in degrees, ${MIN_PITCH} to ${MAX_PITCH}; the high side follows. Not with highSide`),
    highSide: z.number().max(MAX_HIGH_SIDE).optional().describe("A shed's high wall or a gable's ridge in metres; the pitch is solved for the current width. Not with pitch"),
    falls: z.enum(FALLS_WORDS).optional().describe("The side of the plan the roof falls toward: a shed's low side; a gable falls toward it and its opposite"),
    overhang: z.number().min(0).max(MAX_OVERHANG).optional().describe(`How far the roof reaches past the walls in metres, ${m(0)} to ${m(MAX_OVERHANG)}; drawn only`),
  },
  move_joint: { joint: id.describe("A joint id"), to: point },
  straighten_wall: { wall: id.describe("A wall id: any piece of the side to straighten") },
  split_wall: {
    wall: id.describe("A wall id"),
    offset: z.number().min(0).max(MAX_SIZE).describe("Where to split, in metres along the wall's room-side face from the face's start (the clear distance a dimension there shows)"),
  },
  move_walls: {
    walls: z.array(id.describe("A wall id")).min(1).max(500).describe("The walls to move: every end of each moves by the same amount"),
    by: point.describe("How far to move them, in metres; y points up"),
    objects: z.array(object).min(1).max(MAX_OBJECTS_MOVED).optional().describe("Pieces moved with the walls by the same amount, as one edit, all or none; needs layout"),
    layout: layout.optional().describe("The layout the objects are in; a piece the same in every layout moves in every layout"),
  },
  label_room: { point: point.describe("A point inside the room"), name },
  rename: { id: id.describe("A room label id (get_drawing's rooms), a layout id (layouts) or a piece's object id (objects)"), name },
  set_finish: {
    label: id.optional().describe("A room label id from get_drawing's rooms: the room's floor"),
    deck: id.optional().describe("A deck id from get_drawing's decks: the deck's floor"),
    wall: id.optional().describe("A wall id from get_drawing's walls: one side of it, with side"),
    side: z.enum(["left", "right"]).optional().describe("With wall: the side, looking from joint a to joint b"),
    wallsOf: id.optional().describe("A room label id: the room's walls default, shown by every side facing it that isn't custom"),
    roof: z.literal(true).optional().describe("The roof's covering (a shed or gable ceiling)"),
    outside: z.literal(true).optional().describe("The house's outside walls: every wall side facing outside that isn't custom"),
    reset: z.literal(true).optional().describe("With wall and side, no motif: return a custom side to the default it faces (none for a wall on a loft)"),
    lower: z.boolean().optional().describe("With wall, wallsOf or outside: the lower band (tiles to a height) instead of the finish"),
    height: finishNumber.optional().describe(`With lower: the band's top above the wall's bottom, metres; default kept, or ${shown(LOWER_HEIGHT.default)}`),
    motif: z.enum([...MOTIF_IDS, "none"]).optional().describe('The motif, or "none" to remove the finish (or the band); not with reset'),
    colour: z.string().max(MAX_NAME_CHARS).optional().describe("The base colour as #rrggbb; default: kept, or the motif's"),
    strength: finishNumber.optional().describe("How strongly the pattern's lines show over the base colour, a whole percent"),
    size: finishNumber.optional().describe("Metres in whole millimetres, within the motif's range (see the description)"),
    angle: finishNumber.optional().describe("The pattern's turn in whole degrees counter-clockwise, under a half turn"),
  },
  add_sheet: {
    kind: z.enum(SHEET_KINDS).describe(SHEET_KINDS.join(", ")),
    title: name.describe("Its title, printed on the page and in the cover's index"),
    after: sheetId.optional().describe("The sheet it follows; default: the end of the list"),
    ...sheetFields,
  },
  set_sheet: { sheet: sheetId, title: name.optional().describe("Its title, printed on the page and in the cover's index"), ...sheetFields },
  delete_sheet: { sheet: sheetId },
  move_sheet: { sheet: sheetId, index: z.number().int().describe("Its place in the list once moved, counted from zero") },
  read_report: { sheet: sheetId.describe("A report's sheet id from get_drawing's sheets") },
  set_project_field: { key: fieldKey, value: z.string().max(MAX_FIELD_VALUE).describe('The new value; "" clears the field') },
  delete: {
    ids: z.array(id).min(1).max(MAX_DELETE).describe("Wall, column, joint, room label, opening, dimension, deck, hole, named area, piece (object), section (its letter) or layout ids"),
    layout: layout.optional().describe("The layout a piece leaves; needed when ids holds a piece"),
  },
  add_deck: { preset: deckPreset.optional(), ...deckFields },
  set_deck: {
    deck,
    name: deckFields.name.describe("The deck's new name"),
    centre: deckFields.centre.optional().describe("The deck's new centre; default: where it is"),
    width: deckFields.width.optional(),
    depth: deckFields.depth.optional(),
    rotation: deckFields.rotation.describe("Whole degrees, counter-clockwise"),
    top: deckFields.top,
    solid: deckFields.solid,
    guard: deckFields.guard,
    guards: deckFields.guards,
  },
  add_hole: {
    deck,
    centre: point.describe("The hole's centre in metres, in plan coordinates; y points up"),
    width: deckSize.describe(`Width in metres along the deck's width (its x before rotation), at least ${m(MIN_DECK_SIZE)}`),
    depth: deckSize.describe(`Depth in metres along the deck's depth, at least ${m(MIN_DECK_SIZE)}`),
    guard: guardSide.optional().describe(`What all its sides have; default: a railing at ${m(GUARD_HEIGHT)} on a deck above ${m(GUARD_DROP)} m, else none`),
  },
  set_hole: {
    hole: id.describe("A hole id from get_drawing's decks[].holes"),
    centre: point.optional().describe("The new centre in plan coordinates; default: where it is"),
    width: deckSize.optional().describe("The new width along the deck's width; default: as it is"),
    depth: deckSize.optional().describe("The new depth along the deck's depth; default: as it is"),
    guard: guardSide.optional().describe("What all its sides have; what's left out is kept"),
  },
  add_area: {
    name: name.optional().describe("The area's name, as on its tag; default: the first free \"Area N\""),
    centre: point.describe("The area's centre in metres, in plan coordinates; y points up. It must lie in a room"),
    width: areaSize.describe(`Width in metres along x, at least ${m(MIN_AREA_SIZE)}`),
    depth: areaSize.describe(`Depth in metres along y, at least ${m(MIN_AREA_SIZE)}`),
  },
  set_area: {
    area: id.describe("A named area's id from get_drawing's rooms[].areas"),
    name: name.optional().describe("The new name; default: as it is"),
    centre: point.optional().describe("The new centre in plan coordinates, in a room; default: where it is"),
    width: areaSize.optional().describe("The new width along x; default: as it is"),
    depth: areaSize.optional().describe("The new depth along y; default: as it is"),
  },
  add_column: { ...columnFields, rotation: columnFields.rotation.optional().describe("Degrees counter-clockwise from +x to its width; default 0"), on: columnOn, top: columnTop },
  set_column: {
    column: id.describe("A column id from get_drawing's columns"),
    centre: columnFields.centre.optional(),
    width: columnFields.width.optional(),
    depth: columnFields.depth.optional(),
    rotation: columnFields.rotation.optional(),
    top: columnTop.describe(`The new top: "ceiling", a height in metres above its base (at least ${m(MIN_WALL_TOP)}), or, for a free column on the floor, a deck id (up to its underside); default: as it is`),
  },
  place_object: {
    layout,
    kind,
    centre,
    rotation: rotation.optional(),
    name: name.optional(),
    preset: preset.optional(),
    on,
    reaches,
    everyLayout: z.boolean().optional().describe(
      "false places it in this layout only, an exception; true in every layout or not at all, refused naming a layout where it doesn't fit; default: every layout where it fits, else this one with result.note",
    ),
    width: objectSize.optional().describe(
      `The new piece's width in metres, ${m(MIN_OBJECT_SIZE)} to ${MAX_OBJECT_SIZE}, in place of its kind's or preset's, shared by all its configurations; pass depth with it. A stair kind is refused`,
    ),
    depth: objectSize.optional().describe(
      `The new piece's depth in metres, ${m(MIN_OBJECT_SIZE)} to ${MAX_OBJECT_SIZE}, its first configuration's (a Murphy bed's closed depth); pass width with it. Its height and elevation stay its preset's or kind's`,
    ),
    height: objectHeight.optional().describe(
      `The new piece's height in metres, ${m(MIN_HEIGHT)} to ${MAX_OBJECT_SIZE}, in place of its kind's or preset's; its elevation stays. The tool never lowers a piece by itself: ` +
        "one too tall for what's over it is refused, with the ranges, until you pass this. A kind with two configurations, an elevation against the ceiling or a stair is refused",
    ),
  },
  move_object: {
    layout,
    object: object.optional().describe("An object id from get_drawing's objects; or objects for a group"),
    objects: z.array(object).min(1).max(50).optional().describe("A group: object ids moved and turned together as one edit, all or none; with centre and turn only"),
    turn: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe(
      "Groups only: degrees counter-clockwise the group turns about its box's centre, each piece with it; default 0",
    ),
    centre: centre.optional().describe("The new centre (a group's: its bounding box's); default: where it is"), rotation: rotation.optional(), on, reaches: moveReaches,
    everyLayout: z.boolean().optional().describe("true makes the piece the same in every layout at this layout's place (after any move), false an exception each layout places on its own (before any move)"),
  },
  add_stair: {
    layout,
    kind: stairKind,
    deck: deck.describe("The deck the stair goes up to, a deck id from get_drawing's decks"),
    at: point.describe(`Where the middle of the stair's back goes: a point on one of the deck's edges, within ${EDGE_TOLERANCE * 100} cm`),
    shape: stairShape,
    handrail: handrail.optional().describe("What its handrails are, railing, glass or none, on both sides of every flight; default: glass if the deck's side or hole its top arrives on is glass, else railing. A rung ladder has none. Drawn only: it refuses nothing"),
  },
  set_configuration: { layout, object, config },
  set_stair: {
    object: id.describe("A stair's object id from get_drawing's objects"),
    riser: z.number().nullable().optional().describe("The target riser in metres (a rung ladder's spacing): the riser count is the rise over it, rounded up, and the run stays. null clears it, back to the kind's largest riser"),
    going: z.number().optional().describe("The going in metres: the run becomes the treads times this, its back edge staying. A spiral stair has none"),
    handrail: handrail.optional().describe("A spiral's handrail, or both sides of a flight: railing, glass or none; it stays when the deck it reaches changes. A rung ladder has none"),
    handrailLeft: handrail.optional().describe("A flight's left handrail as you walk up; an L's other flight takes it too. A spiral has one handrail"),
    handrailRight: handrail.optional().describe("A flight's right handrail as you walk up; an L's other flight takes it too"),
    hooks: z.boolean().optional().describe("A rung ladder only: true hangs it by two hooks over the edge it reaches (drawn only), false leans it with a handhold"),
    leftEntry: z.boolean().optional().describe("A winder stair only: true enters its turning treads from the left side of its front square, false from the right; its left and right use zones swap with it"),
  },
  // Either a preset, or a width and a depth: zod raw shapes can't say "one of", so the handler refuses other mixes.
  set_size: {
    object,
    preset: preset.optional(),
    config: config.optional().describe("The configuration whose depth, height or elevation to set; needed when the kind has two"),
    width: objectSize.optional().describe(`Width in metres, ${m(MIN_OBJECT_SIZE)} to ${MAX_OBJECT_SIZE}, shared by all the object's configurations; a spiral stair's diameter, its depth kept equal`),
    depth: objectSize.optional().describe(`Depth in metres, ${m(MIN_OBJECT_SIZE)} to ${MAX_OBJECT_SIZE}`),
    height: objectHeight.optional().describe(`Height in metres, ${m(MIN_HEIGHT)} to ${MAX_OBJECT_SIZE}`),
    elevation: elevation.optional(),
    backArm: objectSize.optional().describe("An L piece's arm depth: back runs along the width, left along the depth"),
    leftArm: objectSize.optional().describe("An L piece's arm depth: back runs along the width, left along the depth"),
  },
  set_zones: { layout, object, front: zoneSide("front"), back: zoneSide("back"), left: zoneSide("left"), right: zoneSide("right") },
  set_opens_into: { object, into },
  set_desk: { object: id.describe("A desk's or a desk with chair's object id from get_drawing's objects"), computer: z.boolean().describe("true puts a computer on it, false takes it off") },
  place_set: {
    set: z.string().describe(`The set: ${FURNITURE_SETS.map((s) => `${s.id} (${s.label})`).join(", ")}`),
    layout,
    centre: centre.describe("Where the centre of the set's overall box goes"),
    rotation: rotation.optional(),
  },
  break_apart: { object: id.describe("The object id from get_drawing's objects of a table or desk with chairs") },
  set_chairs: { object: id.describe(`The object id from get_drawing's objects of a ${optionKinds("roundChairs")}`), round: z.boolean().describe("true gives its chairs round seats and backs, false square ones") },
  add_section: {
    a: point.describe("One end of the line, a point in metres; y points up"),
    b: point.describe(`The line's other end, at least ${m(MIN_SECTION_LENGTH)} m from a`),
    side: z.enum(["left", "right"]).describe("The side it looks to, going from a to b"),
    depth: z.number().min(-MAX_SIZE).max(MAX_SIZE).optional().describe("How many metres past the line it sees; zero: only the cut; default: the whole drawing"),
  },
  add_door: {
    wall,
    offset,
    width: z.number().min(door.min).max(door.max).optional().describe(`Width in metres, ${door.min} to ${door.max} by kind; default the kind's`),
    kind: z.enum(DOOR_KINDS).optional().describe(kindList(DOOR_KINDS)),
    side: z.enum(["left", "right"]).optional().describe("The side it opens to or hangs on, looking from joint a to joint b; default left"),
    hinge: z.enum(["a", "b"]).optional().describe("The end nearer joint a or b where it is hinged, parks, has its pocket or stacks; default a"),
    glazed: z.boolean().optional().describe("A door with glass; default false"),
    height: openingHeight.optional(),
  },
  add_window: {
    wall,
    offset,
    width: z.number().min(win.min).max(win.max).optional().describe(`Width in metres, ${win.min} to ${win.max} by kind; default the kind's`),
    kind: z.enum(WINDOW_KINDS).optional().describe(kindList(WINDOW_KINDS)),
    side: z.enum(["left", "right"]).optional().describe("The side a casement or two-leaf window opens to, looking from joint a to joint b; default left"),
    hinge: z.enum(["a", "b"]).optional().describe("The end nearer joint a or b where a casement is hinged; default a"),
    sill: openingSill.optional(),
    height: openingHeight.optional(),
    ...dressing,
  },
  set_opening: {
    opening: id.describe("The opening id from get_drawing's walls"),
    offset: offset.optional().describe("Metres along the wall from its joint a to the opening's end nearer a: it moves along its wall"),
    kind: z.enum(OPENING_KIND_IDS).optional().describe("Its new kind; a window becoming a door keeps its head and starts at the wall's bottom"),
    width: z.number().min(win.min < door.min ? win.min : door.min).max(win.max > door.max ? win.max : door.max).optional().describe("Width in metres, in its kind's range, from the same end nearer joint a; a new kind without a width keeps its centre"),
    side: z.enum(["left", "right"]).optional().describe("The side it opens to or hangs on, looking from joint a to joint b"),
    hinge: z.enum(["a", "b"]).optional().describe("The end nearer joint a or b where it is hinged, parks, has its pocket or stacks"),
    glazed: z.boolean().optional().describe("A door with glass"),
    sill: openingSill.optional(),
    height: openingHeight.optional(),
    ...dressing,
  },
  add_layout: { name },
  copy_layout: { from: layout.describe("The layout id to copy"), name },
  add_dimension: { from: dimensionEnd, to: dimensionEnd, offset: dimensionOffset },
  look: {
    region: lookRegion.optional().describe("The box to show (plan view only); default: the whole underlay with a small margin, else the drawing"),
    view: z.enum(["plan", "3d", "section"]).optional().describe("plan (default): the plan and its rulers; 3d: the furniture and walls in 3D, from a corner; section: one section, named by section"),
    yaw: z.number().optional().describe(`3D only: the camera's side in degrees, counter-clockwise from +x (east) to it, any value; default ${DEFAULT_ANGLES.yaw}, the south-west`),
    tilt: z.number().optional().describe(`3D only: degrees the camera looks down, ${TILT_MIN} to ${TILT_MAX} (straight down); default ${DEFAULT_ANGLES.tilt}`),
    layout: layout.optional().describe("The layout whose pieces it shows, on the plan, in 3D or in a section; default the first"),
    section: id.optional().describe("Section view only, and needed there: a letter from get_drawing's sections"),
    roof: z.boolean().optional().describe("3D only: true shows every wall from outside, with a shed or gable roof over the house (under a flat ceiling, no roof: its outside walls); default false, open to see inside"),
  },
  scale_underlay: {
    a: point.describe("One end of a printed dimension, in plan metres read off look's rulers; it stays where it is"),
    b: point.describe("The dimension's other end, in plan metres"),
    distance: z.number().min(-MAX_SIZE).max(MAX_SIZE).describe("The real distance from a to b in metres, as printed on the plan"),
  },
};
