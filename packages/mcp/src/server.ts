import {
  MAX_SHEET_TEXT, DECK_PRESETS, DECK_THICKNESS, OVERHANG, PLATFORM_TOP, EDGE_TOLERANCE, shown, DEFAULT_CEILING, DEFAULT_WALL_THICKNESS, kindConfigs, MAX_DECK_TOP, MAX_WALL_THICKNESS, MIN_AREA_SIZE, MIN_DECK_SIZE, MIN_DECK_TOP,
  HEAD_CLEAR, MIN_EDGE, MIN_SECTION_LENGTH, MIN_WALL_THICKNESS, MOTIF_IDS, MOTIFS, motifsFor, OBJECT_KINDS, PLAN_CUT, PROVISIONAL_METRES_PER_PIXEL, SEAT_BACK, SIZE_LIMITS,
  PAPER_NAMES, SCALE_REFUSAL, SHEET_SCALES, SHEET_SLOTS, SURROUNDINGS_VALUES, TRAILER_AXLES, TRAILER_HITCHES, sizeDigits, type MotifId,
} from "@fm/domain";
import { MAX_LISTED_WALLS } from "./drawing";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError, type CallToolResult, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MAX_WALLS, SCHEMAS } from "./schemas";
import type { DrawingTools, LookReply, Reply } from "./tool-types";

// The MCP surface: tool names, descriptions and input schemas. Behaviour lives in tools.ts (and its groups) and session.ts.

/** The stair kinds an L can be made of, from the kinds table: "stair, openStair and storageStair". */
const TURNING_KINDS = ((ids: string[]) => `${ids.slice(0, -1).join(", ")} and ${ids.at(-1) ?? ""}`)(
  OBJECT_KINDS.filter((k) => !k.retired && k.stair?.turns === true).map((k) => k.id),
);

export const TOOL_NAMES = [
  "list_projects", "create_project", "open_project", "get_drawing", "draw_room", "add_wall", "add_walls",
  "set_wall_length", "set_wall_thickness", "set_wall_top", "set_ceiling", "move_joint", "move_walls", "split_wall", "straighten_wall", "label_room", "rename", "set_finish", "set_project_field", "delete",
  "add_deck", "set_deck", "add_hole", "set_hole", "add_area", "set_area", "add_column", "set_column", "place_object", "move_object", "set_stair", "place_set", "break_apart", "add_stair", "set_configuration", "set_size", "set_zones", "set_opens_into", "set_desk", "set_chairs", "add_layout", "copy_layout",
  "add_door", "add_window", "set_opening", "add_dimension", "add_section", "look", "scale_underlay",
  "add_sheet", "set_sheet", "delete_sheet", "move_sheet", "read_report",
] as const;
type ToolName = (typeof TOOL_NAMES)[number];

/**
 * What a tool does to the drawing, for its annotations: read reads only; open changes which drawing is open (stored
 * drawings stay); add creates rows; set overwrites values (the same call again changes nothing); rescale overwrites
 * relative to the current value, so a second call changes it again (scaleUnderlay multiplies the scale).
 */
type Effect = "read" | "open" | "add" | "set" | "rescale";
const EFFECTS: Record<ToolName, Effect> = {
  get_drawing: "read", look: "read", read_report: "read",
  list_projects: "open", open_project: "open",
  create_project: "add", draw_room: "add", add_wall: "add", add_walls: "add", add_deck: "add", add_hole: "add", add_area: "add", add_column: "add", place_object: "add", add_stair: "add", add_layout: "add",
  copy_layout: "add", add_door: "add", add_window: "add", add_dimension: "add", add_section: "add", label_room: "add", add_sheet: "add",
  set_wall_length: "set", set_wall_thickness: "set", set_wall_top: "set", set_ceiling: "set", move_joint: "set", rename: "set", move_walls: "rescale", split_wall: "add", straighten_wall: "set", set_finish: "set",
  set_project_field: "set", delete: "set", set_deck: "set", set_hole: "set", set_area: "set", set_column: "set", move_object: "set", set_configuration: "set", set_size: "set", set_zones: "set",
  set_opens_into: "set", set_opening: "set", set_stair: "set", set_desk: "set", set_chairs: "set", break_apart: "set", place_set: "add", set_sheet: "set", delete_sheet: "set", move_sheet: "set",
  scale_underlay: "rescale",
};
/** Every tool works only on the Flatmate server's drawings, so none is open-world. */
const HINTS: Record<Effect, ToolAnnotations> = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  open: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  add: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  set: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  rescale: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
};
const EFFECT_OF = new Map<string, Effect>(Object.entries(EFFECTS));

/** A tool's annotations: a title from its name ("get_drawing" → "Get drawing") and the hints of its effect. */
function annotationsOf(name: string): ToolAnnotations {
  const words = name.replaceAll("_", " ");
  const effect = EFFECT_OF.get(name);
  return { title: words.charAt(0).toUpperCase() + words.slice(1), ...(effect === undefined ? {} : HINTS[effect]) };
}

/** The open drawing as a resource: get_drawing's reply without a region, for a client to attach as context. */
export const DRAWING_URI = "flatmate://drawing";

const { platform, loft } = DECK_PRESETS;
const { width: columnWidth, depth: columnDepth } = SIZE_LIMITS.column;
const m = shown;
/** What a finish's size measures, per motif (the spec's motifs table); the ranges come from MOTIFS (finishes.20). */
const SIZE_MEANS: Record<MotifId, string> = {
  planks: "plank width", widePlanks: "plank width", herringbone: "plank width", squareTiles: "tile side", largeTiles: "short side",
  mosaic: "tile side", cementTiles: "tile side", plain: "no pattern, size", brick: "course", subwayTiles: "tile height",
  boardAndBatten: "batten width", shingles: "course", standingSeam: "seam spacing", corrugated: "rib spacing", roofTiles: "tile side",
};
/** "planks: plank width 0.10–0.40 (default 0.20); …; plain: no pattern, size 0", for set_finish's description. */
const MOTIF_SIZES = MOTIF_IDS.map((id) => {
  const { min, max, default: d } = MOTIFS[id].size;
  const digits = sizeDigits(id);
  return max === 0 ? `${id}: ${SIZE_MEANS[id]} ${max}` : `${id}: ${SIZE_MEANS[id]} ${m(min, digits)}–${m(max, digits)} (default ${m(d, digits)})`;
}).join("; ");
/** A kind's first configuration's range in height, "0.00–0.75", for the instructions' example (it can't drift). */
function rangeOf(kind: string): string {
  const c = kindConfigs(kind)[0];
  const bottom = c && typeof c.z === "number" ? c.z : 0;
  return `${m(bottom)}–${m(bottom + (c?.h ?? 0))}`;
}

const INSTRUCTIONS =
  "Flatmate is a collaborative 2.5D floor-plan editor. Coordinates are metres with y pointing up; walls are " +
  `${m(DEFAULT_WALL_THICKNESS)} m ` +
  "thick unless get_drawing lists another thickness, and joined at shared joints. Open or create a project first, then read it with get_drawing (large drawings: " +
  "pass a region). Each edit is " +
  "checked like a person's: walls can't cross or overlap, and one edit is saved at a time. A failed edit returns " +
  "the reason; nothing changes. PDF sheets, report: add_sheet. Vertical sections: add_section. " +
  "A group of walls standing inside a room (a stair core) cuts a hole in it: the room's area leaves it out, and " +
  "get_drawing lists it under the room's holes. A column (add_column) takes its area off its room too. " +
  "Layouts share walls and rooms; a piece is the same in each unless made an exception (move_object). Name a layout by its id from get_drawing's layouts. An object's position is its " +
  "footprint's centre; at rotation 0 its front faces −y. An object must lie inside one room, off the walls, and not " +
  "overlap another object in the same layout (a rug may), but a chair may tuck under a desk or table (open, if it folds) on the " +
  `same surface, all but its back ${m(SEAT_BACK)} m; free floor counts the overlap once. ` +
  "An object's width is shared by all its configurations; place_object and set_size take a preset, a standard size " +
  "of the kind (default: the kind's), or an exact width and depth. Use zones are the free floor a piece needs on a side, " +
  "set per layout with set_zones; " +
  "get_drawing lists, per layout, every blocked use zone and door swing with what blocks it (a piece or a " +
  "wall): warnings, not refusals. A built-in unit opens into a table, a " +
  "desk or a bed (set_opens_into) and opens and closes with set_configuration. " +
  "Doors and windows sit on a wall, shared by every layout: an opening's offset is metres along the wall from its " +
  "joint a; it must lie within the wall, clear of other openings. " +
  "Heights: every wall, piece and the ceiling has a vertical range above the floor (0.00). Walls go to the ceiling " +
  `unless set_wall_top makes a half wall; set_ceiling sets it, flat (${m(DEFAULT_CEILING)} m by default) or a shed or gable roof; each piece has a ` +
  "height and an elevation per configuration (set_size; \"ceiling\" hangs it from the ceiling). " +
  "Two things collide only if they overlap on the plan and " +
  `in height: touching is fine, so a desk (${rangeOf("desk")}) fits under a loft bed (${rangeOf("loftBed")}); a top above the ` +
  "ceiling is refused; refusals give the ranges. A piece still lies inside one room, even above a half wall, and " +
  `openings keep ${m(HEAD_CLEAR)} m of wall above them and may stack. ` +
  `The plan is drawn as a horizontal cut at ${m(PLAN_CUT)} m, or half the ceiling under a low one (get_drawing's cut): walls ` +
  "ending below it draw as a thin outline, pieces wholly above it as a dashed outline with no symbol. " +
  "Decks: a raised rectangle shared by every layout, given by its centre, width, depth, rotation and " +
  `top (add_deck, set_deck). A solid deck fills from the floor to its top; a hollow one is a ${m(DECK_THICKNESS)} m slab ` +
  `under its top with room below. Presets: ${platform.name} (top ${m(platform.top)}, solid) and ${loft.name} (top ` +
  `${m(loft.top)}, hollow). Each piece stands on the floor or on one deck (get_drawing's on); its ` +
  "elevation is measured from the top of what it stands on, except \"ceiling\", which stays against the ceiling. A " +
  `piece on a deck lies inside it, or overhangs a deck up to ${m(PLATFORM_TOP)} high by ${m(OVERHANG)}, centre on it; a piece over a deck it doesn't stand on lies wholly below its underside. ` +
  // Claude Code keeps only the first 4096 characters, so the text ends here: the deck limits, dimension lines, the
  // title block and the tracing loop live in their tools' descriptions (cleanup.03; server.test.ts checks).
  "Levels: people view one level at a time, the floor or a loft (a deck top at or above the floor's cut), each " +
  "drawn as its own cut; get_drawing's levels lists them, the floor first. You work at the floor: look draws the " +
  "floor level, and without on, place_object and move_object follow the floor level's landing rule: a piece keeps " +
  "its current surface if it fits there (a loft included), else lands on the floor or on a deck below the floor's " +
  "cut (a platform), never on a loft, even where the floor under it is taken (the edit is then refused); to put a " +
  "piece on a loft, pass on with its deck id. " +
  "Tracing a plan picture (the underlay): follow the steps in look's description.";

function result(r: Reply): CallToolResult {
  return { content: [{ type: "text", text: r.text }], isError: r.isError };
}

/**
 * look's picture as plain content, the image then its caption. No outputSchema or structuredContent: Claude Code
 * turns image results that carry them into text (import.08, issue 31208).
 */
function lookResult(r: LookReply): CallToolResult {
  if (!("png" in r)) return result(r);
  return {
    content: [
      { type: "image", data: Buffer.from(r.png).toString("base64"), mimeType: "image/png" },
      { type: "text", text: r.text },
    ],
    isError: false,
  };
}

export function createMcpServer(tools: DrawingTools): McpServer {
  const server = new McpServer({ name: "flatmate", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  /** registerTool with the tool's annotations added. */
  const tool: typeof server.registerTool = (name, config, cb) => server.registerTool(name, { ...config, annotations: annotationsOf(name) }, cb);
  server.registerResource(
    "drawing",
    DRAWING_URI,
    { title: "Open drawing", description: "The open drawing as get_drawing returns it without a region.", mimeType: "application/json" },
    async (uri) => {
      const r = await tools.getDrawing();
      if (r.isError) throw new McpError(ErrorCode.InvalidRequest, r.text);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: r.text }] };
    },
  );
  tool(
    "list_projects",
    { description: "List the projects on the server. Leaves the open drawing, like the project list in the web app." },
    async () => result(await tools.listProjects()),
  );
  tool(
    "create_project",
    { description: "Create a project and open it. Returns the (empty) drawing.", inputSchema: SCHEMAS.create_project },
    async (args) => result(await tools.createProject(args)),
  );
  tool(
    "open_project",
    { description: "Open a project by id and return its drawing.", inputSchema: SCHEMAS.open_project },
    async (args) => result(await tools.openProject(args)),
  );
  tool(
    "get_drawing",
    {
      description:
        "The open drawing: layouts (id, name, in order), walls (ids, joint ids, endpoints, lengths, on: the deck " +
        "a wall stands on, left out for the floor; top: a wall's height above what it stands on, " +
        "as set_wall_top takes it, left out for a wall up to the ceiling; angle: degrees off the nearest axis, only for a wall up to a degree off; and their " +
        "doors and windows by offset), joints, rooms " +
        "(labels with their floor finish or null; clear areas in m² net of holes, outlines, floor outlines, holes, free " +
        "floor per layout where furnished), unplaced " +
        "labels, decks (id, name, centre, width, depth, rotation, corners, top, solid, guards, range { bottom, top } in metres), " +
        "columns (id, centre, width, depth, rotation, range, inLineOf: the walls of its line or null, " +
        "on and top: the decks it stands on and reaches, left out when none; " +
        "not under walls or joints), " +
        "levels (the floor, then each deck top at or above its cut: height, name, deck ids, cut), " +
        "objects (kind, name, size per configuration, and its placement: centre, rotation, configuration, what it stands " +
        "on (on: \"floor\" or a deck id) and " +
        "use-zone sides and each side's zone (depth, two insets, the kind's default unless set); placements per " +
        "layout instead, null where absent, when it differs; a stair adds stair { line: the decks it starts at and reaches, risers × riser, going, run; warnings; handrail(s) }), per layout the blocked clearances (each use zone or door swing a piece " +
        "or a wall overlaps, with ids: \"Wardrobe (o2) front zone\" by \"Bed (o3)\"), dimensions (ends, offset, length; " +
        "left out when none), sections (id: letter, a, b, side, depth (null: whole); left out when none) and " +
        "fields by key (title block and set; north too), with counts, sheets (add_sheet; a report's first line, read_report its text) and the underlay (to trace): " +
        `{ bounds { min, max } in metres, metresPerPixel, scaled }, or null. A drawing of more than ${MAX_LISTED_WALLS} walls is an ` +
        "overview (counts, layouts, bounds of the walls, underlay, levels) with sheets, sections; pass a region " +
        "{ min, max } to list only what touches that box.",
      inputSchema: SCHEMAS.get_drawing,
    },
    async (args) => result(await tools.getDrawing(args)),
  );
  tool(
    "draw_room",
    {
      description:
        "Draw a free-standing rectangular room: four walls from `corner`, its lower-left corner, `width` along x and `depth` along y. A side on " +
        "an existing wall is refused (walls can't overlap); to extend a room, use add_wall for the new sides.",
      inputSchema: SCHEMAS.draw_room,
    },
    async (args) => result(await tools.drawRoom(args)),
  );
  tool(
    "add_wall",
    {
      description:
        "Add a straight wall from a to b. An end on a joint connects to it; an end on a wall splits it (T-junction). " +
        "A wall crossing another wall is refused. With on set to a loft's deck id, the wall stands on the loft (a " +
        "partition or knee wall): inside the deck, up to the ceiling or set_wall_top's height above the deck; it joins " +
        "only walls on that deck, ends flush against a wall on the floor it meets, holds doors and windows measured from the deck's top and makes no room.",
      inputSchema: SCHEMAS.add_wall,
    },
    async (args) => result(await tools.addWall(args)),
  );
  tool(
    "add_walls",
    {
      description:
        `Add up to ${MAX_WALLS} straight walls in one call, in order, for bigger layouts such as a maze. Each wall follows ` +
        "add_wall's rules: walls sharing an endpoint connect at one joint, an end on a wall splits it (T-junction), " +
        "crossings are refused, and on stands a wall on a deck. The whole list is checked first: if any wall is refused, nothing is drawn and the " +
        "reply names that wall.",
      inputSchema: SCHEMAS.add_walls,
    },
    async (args) => result(await tools.addWalls(args)),
  );
  tool(
    "set_wall_length",
    { description: "Set a wall's length; its joint a stays, joint b moves along the wall and connected walls follow.", inputSchema: SCHEMAS.set_wall_length },
    async (args) => result(await tools.setWallLength(args)),
  );
  tool(
    "set_wall_thickness",
    { description: `Set a wall's thickness (${m(MIN_WALL_THICKNESS)} to ${m(MAX_WALL_THICKNESS)} m); it stays centred on its line and the rooms beside it update.`, inputSchema: SCHEMAS.set_wall_thickness },
    async (args) => result(await tools.setWallThickness(args)),
  );
  tool(
    "set_wall_top",
    {
      description: `Make a wall a half wall of this height above what it stands on (the floor, or its deck's top), or "ceiling" for a full wall again; a half wall on the floor still bounds rooms, and keeps ${m(HEAD_CLEAR)} m above its doors' and windows' heads.`,
      inputSchema: SCHEMAS.set_wall_top,
    },
    async (args) => result(await tools.setWallTop(args)),
  );
  tool(
    "set_ceiling",
    { description: `Set the drawing's ceiling: flat at a height, or a shed or gable roof whose underside is the ceiling over the floor walls' outer box, from a preset or its low side, pitch (or high side), the side it falls toward and its overhang; what isn't given stays. Full walls rise to it and pieces hung at it follow it. Refused when a wall would be taller than it, a piece wouldn't fit under it, or a wall that follows it would keep less than ${m(HEAD_CLEAR)} m above a door's or window's head.`, inputSchema: SCHEMAS.set_ceiling },
    async (args) => result(await tools.setCeiling(args)),
  );
  tool(
    "move_joint",
    {
      description:
        "Move a joint (a wall end or corner) to a point; its walls follow. Where it lands within a millimetre of another joint it merges into it, and on a wall's body it splits that wall and joins it, " +
        "so a loose end dropped on a corner connects. Refused when a wall would collapse or two walls would run between the same joints.",
      inputSchema: SCHEMAS.move_joint,
    },
    async (args) => result(await tools.moveJoint(args)),
  );
  tool(
    "move_walls",
    {
      description:
        "Move walls by a distance: every end of the walls given moves by the same amount, and the walls joined to them stretch. A column in their line moves with them, whole. " +
        "It moves exactly the walls given: to move a side that is in pieces, give every piece. Doors and windows stay on their walls; one a stretch would push off its wall refuses the move. " +
        "Pass objects with their layout to move pieces along, so a part of the plan shifts whole (to shorten a room in the middle: the walls beyond it and the pieces there); a piece left in a moved wall's way refuses the move, naming it and its layout. Decks, free columns and named areas stay where they are.",
      inputSchema: SCHEMAS.move_walls,
    },
    async (args) => result(await tools.moveWalls(args)),
  );
  tool(
    "straighten_wall",
    {
      description:
        "Straighten a side: the wall given and the walls going on from it nearly in line are put exactly on one horizontal or vertical line (every joint along the side takes the same y, or x), so a slant of millimetres goes (get_drawing lists such a wall's angle). " +
        "The line most of the side already holds is kept, or the other when a piece is in the way. Refused for a side that is already straight, or more than a degree off both axes.",
      inputSchema: SCHEMAS.straighten_wall,
    },
    async (args) => result(await tools.straightenWall(args)),
  );
  tool(
    "split_wall",
    {
      description:
        `Split a wall in two at a distance along its room-side face from the face's start: both pieces keep the wall's thickness, height and finishes, and its doors and windows stay where they are. ` +
        `Refused inside a door or window, or where a piece would be shorter than ${m(MIN_EDGE)} m. The pieces are two walls: give each its own finish, or move the joint between them along the wall.`,
      inputSchema: SCHEMAS.split_wall,
    },
    async (args) => result(await tools.splitWall(args)),
  );
  tool(
    "label_room",
    { description: "Name the closed room containing the point. A room holds one label.", inputSchema: SCHEMAS.label_room },
    async (args) => result(await tools.labelRoom(args)),
  );
  tool(
    "rename",
    {
      description:
        "Rename a room label, a layout or a piece (its object, in every layout), by id. A deck, a named area and a sheet " +
        "keep their names in set_deck, set_area and set_sheet.",
      inputSchema: SCHEMAS.rename,
    },
    async (args) => result(await tools.rename(args)),
  );
  tool(
    "set_finish",
    {
      description:
        "Set or remove a finish (a motif, base colour, strength, size and angle) on one target: label (a room's floor; " +
        "label_room first), deck (its floor), wallsOf (a room label: its walls' default), outside (the house's outside " +
        "walls' default), wall with side (one side: it becomes custom, starting from what it shows; reset, with no motif, " +
        "returns it to the default it faces; a wall on a loft takes no default: custom or nothing), or roof (a shed or gable's covering). With wall, wallsOf or outside, lower " +
        `sets the band up to height instead. Floors take ${motifsFor("floor").join(", ")}; walls ${motifsFor("wall").join(", ")}; ` +
        `the roof ${motifsFor("roof").join(", ")}. get_drawing lists the defaults and custom sides. "none" removes the part ` +
        "named; a custom side keeps a finish. A new motif keeps the colour and direction and takes its own size and " +
        "strength; the same motif keeps omitted fields. " +
        `What size measures, in metres: ${MOTIF_SIZES}. Angle: lines along x at ${MOTIFS.planks.angle}; herringbone's ` +
        `default ${MOTIFS.herringbone.angle} runs its zigzag along x. A value out of range is refused with the range.`,
      inputSchema: SCHEMAS.set_finish,
    },
    async (args) => result(await tools.setFinish(args)),
  );
  tool(
    "set_project_field",
    {
      description:
        "Set one of the drawing's title block fields (client, address, revision…), printed on its PDF sheet " +
        "(get_drawing lists the set ones under fields). An empty value clears it. The same goes for the sheet set's settings: " +
        "north (whole degrees clockwise from up on the plan, an arrow on every sheet with a plan; empty: no arrow), " +
        `paper (${PAPER_NAMES.join(", ")}; empty: ${PAPER_NAMES[0]}), generalScale (the N of a scale of one to N, one of ${SHEET_SCALES.join(", ")}; empty: fit the drawing to the paper), ` +
        "accent (a colour as #rrggbb in lower case), issueDate (prints as typed; empty: today's) and the studio's letterhead, studioName, studioAddress and studioContact. " +
        `Also surroundings (what the 3D view shows around the house, one of ${SURROUNDINGS_VALUES.map((s) => s.value).join(", ")}; empty: None; printed on no sheet) ` +
        `and, on wheels, the trailer: trailerHitch (${TRAILER_HITCHES.join(" or ")}, the end of the walls' box's longer side the drawbar is on; empty: high), ` +
        `trailerAxles (${TRAILER_AXLES.join(" or ")}; empty: ${TRAILER_AXLES[0]}) and tongueBox (on; empty: none). A wrong value is refused with what it must be.`,
      inputSchema: SCHEMAS.set_project_field,
    },
    async (args) => result(await tools.setProjectField(args)),
  );
  tool(
    "delete",
    {
      description:
        "Delete walls (with their doors and windows), columns (one in a wall's line heals the wall), joints (a corner takes its walls; " +
        "a joint between two walls in line joins them into one, refused when they differ), room labels, openings, dimensions, decks, holes, named areas, sections (by letter, with their sheets) or pieces by id, as one edit. A piece needs layout. An exception (get_drawing's linked: false) leaves that layout only; " +
        "a piece the same in every layout is deleted from every layout, as on the canvas: to take it out of one, first make it an exception there (move_object everyLayout: false). " +
        "Deleting a wall that cut another stitches the pieces it leaves back into one wall when they are in line and alike. " +
        "A piece left in no layout is gone. A deck a piece stands on is refused: move the piece off, or delete it in " +
        "the same call when it stands there in that layout only. A layout id deletes a layout, on its own in the call, with the pieces only it held; the last one stays.",
      inputSchema: SCHEMAS.delete,
    },
    async (args) => result(await tools.delete(args)),
  );
  tool(
    "add_deck",
    {
      description:
        "Add a deck (a raised platform or loft, shared by every layout) centred at `centre`, width along x and depth " +
        `along y before rotation, from a preset: platform (the default; top ${m(platform.top)}, solid) or loft (top ` +
        `${m(loft.top)}, hollow, a ${m(DECK_THICKNESS)} m slab); name, top, solid, guard and rotation override the preset's. It ` +
        "is refused unless it lies over the building, crosses no wall taller than its underside, overlaps no other " +
        `deck (touching is fine), stays under the ceiling, and measures at least ${m(MIN_DECK_SIZE)} m a side with a top ` +
        `from ${m(MIN_DECK_TOP)} to ${MAX_DECK_TOP} m. The reply's result gives the deck id.`,
      inputSchema: SCHEMAS.add_deck,
    },
    async (args) => result(await tools.addDeck(args)),
  );
  tool(
    "set_deck",
    {
      description:
        "Change a deck's name, centre, width, depth, rotation, top, solid flag or guard; what is left out stays, and " +
        "add_deck's limits apply. A new centre alone moves it and carries the pieces standing on it, in every layout, " +
        "and its holes. A turn turns its holes with it. A new size, even with a new centre in the same call, is a " +
        "resize: its pieces stay where they are on the plan, and so do its holes. A new top raises or lowers its pieces with it. A move, a resize or a new top is refused if a piece no longer " +
        "fits. A deck can't be " +
        "turned or deleted while a piece stands on it, nor moved, turned, resized or deleted while a column stands on " +
        "it or reaches up to it (the reason names the column); a new top moves those columns' ends with it.",
      inputSchema: SCHEMAS.set_deck,
    },
    async (args) => result(await tools.setDeck(args)),
  );
  tool(
    "add_hole",
    {
      description:
        "Cut a rectangular hole through a deck, as a stairwell: centred at `centre` in plan coordinates, `width` and " +
        "`depth` along the deck's own width and depth (it turns with the deck). It lies inside the deck and may reach its " +
        `edge (a notch), at least ${m(MIN_DECK_SIZE)} m a side, overlapping no other hole of the deck (touching is fine). ` +
        "Nothing stands on the deck over a hole, and a piece, wall or column below whose part inside the deck lies in a " +
        "hole may rise through it, whatever its height: a ship's ladder up to a loft stands in its hole. A stair caught on " +
        "a hole's side (add_stair) hangs into the hole. Moving or turning the deck carries its holes; a resize leaves them " +
        "where they are on the plan and is refused if one would lie outside; deleting the deck deletes its holes. The reply's result gives the hole id; get_drawing lists it " +
        "under its deck's holes, with the slab's area.",
      inputSchema: SCHEMAS.add_hole,
    },
    async (args) => result(await tools.addHole(args)),
  );
  tool(
    "set_hole",
    {
      description: "Move or resize a hole: a new centre (plan coordinates), width or depth; what is left out stays, and add_hole's rules apply. Remove it with delete.",
      inputSchema: SCHEMAS.set_hole,
    },
    async (args) => result(await tools.setHole(args)),
  );
  tool(
    "add_area",
    {
      description:
        "Name part of a room without a wall, as small-home plans do: \"Kitchen\" and \"Living\" in one open room, a " +
        "\"Laundry\" nook. A named area is a rectangle square to the page, centred at `centre` (which must lie in a room), " +
        `at least ${m(MIN_AREA_SIZE)} m a side; it may touch another area but not overlap it. It is a label only: its tag ` +
        "shows its name over its area, its rectangle cut to its room's clear floor; nothing else reads it, and the room " +
        "keeps its own label. Walls are never refused for it: one that moves through it cuts its area. The reply's result " +
        "gives its id; get_drawing lists it under its room's areas. Change it with set_area, remove it with delete.",
      inputSchema: SCHEMAS.add_area,
    },
    async (args) => result(await tools.addArea(args)),
  );
  tool(
    "set_area",
    {
      description: "Rename, move or resize a named area: a new name, centre (in a room) or size; what is left out stays, and add_area's rules apply.",
      inputSchema: SCHEMAS.set_area,
    },
    async (args) => result(await tools.setArea(args)),
  );
  tool(
    "add_column",
    {
      description:
        "Add a column (a structural pillar): a rectangle in plan centred at `centre`, `width` along its rotation " +
        `(${m(columnWidth.min)} to ${m(columnWidth.max)} m) and \`depth\` across it (${m(columnDepth.min)} to ${m(columnDepth.max)} m). ` +
        "With its centre on a wall standing on the same base (within half the wall's thickness of its centreline) it goes in that wall's line, " +
        "splitting it: centred on the centreline and turned to the wall (rotation is ignored), at least as deep as the " +
        `wall, and it takes its base and top; at least ${MIN_EDGE * 100} cm of wall stays on each side and it can't cover a door or window. ` +
        "Elsewhere it stands free, turned `rotation` degrees counter-clockwise (default 0): on the floor inside a room, " +
        "its body clear of every wall (touching one is refused), or with `on` a loft's deck id on that deck. It reaches up " +
        "to the ceiling, or to `top`: a height above its base, or, for a free column on the floor, a loft's deck id (up " +
        "to its underside; the post under a loft). A loft a column stands on or reaches up to can't be moved, turned, " +
        "resized or deleted (the reason names the column); raising or lowering it moves the column's ends with it. " +
        "Its area leaves its room's, and " +
        "pieces can't overlap it. The reply's result gives the column id; get_drawing lists it under columns (inLineOf: " +
        "the two walls of its line), never under walls or joints. Change it with set_column and remove it with delete; " +
        "the wall tools refuse it and its joints.",
      inputSchema: SCHEMAS.add_column,
    },
    async (args) => result(await tools.addColumn(args)),
  );
  tool(
    "set_column",
    {
      description:
        "Move, resize or turn a column, or give it a new top: a new centre, width, depth, rotation or top; what is left out stays, and " +
        "add_column's rules apply. A column in a wall's line slides along its wall: a new centre is taken onto the " +
        "wall's centreline, a new width keeps the centre, and its rotation follows the wall (a different one is " +
        "refused, and so is a new top: it keeps its wall's); a free column moves and turns. A refusal gives the reason; nothing changes.",
      inputSchema: SCHEMAS.set_column,
    },
    async (args) => result(await tools.setColumn(args)),
  );
  tool(
    "place_object",
    {
      description:
        "Place a new object of a kind in a layout, centred at `centre`, in its first configuration, at the kind's " +
        "default size or a preset of the kind, its height `height` if given. It must fit: inside one room, off the walls, clear of the layout's other " +
        "objects (a rug overlaps any object, blocks no use zone or door swing and takes no free floor; a wheelWell may run under walls and stands on the floor only, never on a deck; a beam's ends may run into walls, its centre in a room, it may pass over a platform, and it stands in every layout). A piece whose elevation is \"ceiling\" (a beam, a cooker hood) hangs from what is over it: the ceiling, or a loft's underside. It stands on `on` (\"floor\" or a deck id), or without it where it lands at the floor level: the " +
        "floor if it fits there, else a deck below the floor's cut (a platform) under its centre; putting it on a loft needs `on`. " +
        "A piece too tall for what's over it is refused with the ranges: it never lowers by itself, so pass a lower `height`. " +
        "A stair stands in every layout and links to a deck only when `reaches` names it (touching a deck's edge " +
        "links nothing); its height follows that deck, its risers and going are derived (set_size sets its width and run, set_stair its riser, going and handrail; " +
        "its handrails start as glass when the deck's side or hole it arrives on is glass, else railing). " +
        "It goes into every layout where it fits, or into this one only, with the reply's result.note naming the layout it didn't fit in; " +
        "everyLayout false places it in this layout only, true in every layout or nowhere. " +
        "The reply's result gives the object id.",
      inputSchema: SCHEMAS.place_object,
    },
    async (args) => result(await tools.placeObject(args)),
  );
  tool(
    "move_object",
    {
      description:
        "Move or turn an object in one layout: `centre` is the new centre (default: where it is), `rotation` the new " +
        "angle (default: as it is); turning keeps the centre. `on` puts it on \"floor\" or a deck id; with only `on` it " +
        "stays where it is on the plan. Moved or turned without `on`, it stays on its surface if it fits there, else " +
        "lands on the floor, else on a deck below the floor's cut (a platform) under its centre; putting it on a loft needs `on`. " +
        "A stair keeps what it reaches wherever it goes; `reaches` links it to a deck id or, with \"nothing\", unlinks it " +
        "(its height stays). A piece the same in every layout moves in every layout, refused where it doesn't fit; an exception " +
        "(get_drawing's linked: false) moves in this layout only. everyLayout links or unlinks it. " +
        "A group: `objects` in place of `object` moves pieces of this layout as one edit, all or none, as a drag of a selection does: " +
        "`centre` is the new centre of their bounding box, `turn`, in quarter turns, turns the group about it, each piece with it; " +
        "each keeps its surface; rotation, on, reaches and everyLayout are for one piece.",
      inputSchema: SCHEMAS.move_object,
    },
    async (args) => result(await tools.moveObject(args)),
  );
  tool(
    "add_stair",
    {
      description:
        "Put a stair or ladder up to a deck's edge, as the Object tool's stair gesture does: `at` is where the middle " +
        `of the stair's back goes, a point on one of the deck's edges within ${EDGE_TOLERANCE * 100} cm. The stair stands on the floor with its ` +
        "back on the edge, facing away from the deck, and reaches the deck: its height is the deck's top, its width " +
        "the kind's, its run the kind's recommended run for that height (set_size changes them). An edge takes a " +
        "stair when the deck's top is above the floor, the edge is at least as long as the stair is wide, and it is " +
        "not flush against a wall. A spiral's landing is its way off and runs along the edge from `at`, so a spiral too near " +
        "that end of the edge moves along it until the landing's back is on the edge. `shape` l-left or l-right makes an L instead: the upper flight with its back on the " +
        "edge, at its foot a solid square landing as wide as the flight, halfway up (each flight takes half the " +
        "risers), and the lower flight turning off the landing's side down to the floor. Left and right are as seen " +
        "from the floor facing the edge: l-left puts the lower flight on the left. Only " + TURNING_KINDS + " turn: " +
        "any other kind doesn't turn and makes no L. Each flight of an L needs two risers, so a Platform preset deck " +
        "takes only a straight flight. Every part must fit like any piece, and stands in every layout. `handrail` " +
        `(railing, glass or none) is what every flight's handrails are, both sides; without it, none on a stair rising ${m(PLATFORM_TOP)} m or less, else glass if the side or hole it arrives on is glass, else railing, ` +
        "kept when the deck changes later (set_stair changes it). A " +
        "refusal gives the reason; nothing changes. The reply's result gives the flight's object id; for an L, " +
        "object is the upper flight, objects both flights (upper, lower) and deck the landing's deck id. " +
        "storageSteps are two or three deep steps with a drawer in each riser, for a platform; winderStair turns a quarter at its foot " +
        "through three winders, entered from its front square's right, or left by a wall (set_stair leftEntry).",
      inputSchema: SCHEMAS.add_stair,
    },
    async (args) => result(await tools.addStair(args)),
  );
  tool(
    "set_configuration",
    {
      description:
        "Set an object's configuration in one layout (e.g. a murphy bed folded or down); the back edge stays " +
        "where it is and the footprint grows or shrinks forward.",
      inputSchema: SCHEMAS.set_configuration,
    },
    async (args) => result(await tools.setConfiguration(args)),
  );
  tool(
    "set_size",
    {
      description:
        "Set an object's size in every layout, either from a preset of its kind (every configuration's width and " +
        "depth) or as a width, shared by all its configurations, and the depth, height or elevation of one configuration; " +
        "not both. Heights alone keep the width and depth. The back edge stays.",
      inputSchema: SCHEMAS.set_size,
    },
    async (args) => result(await tools.setSize(args)),
  );
  tool(
    "set_zones",
    {
      description:
        "Turn an object's use zones on or off by side in one layout, or set a side's depth and its two insets along " +
        "the side; sides left out stay as they are, and other layouts keep theirs. A use zone is the free floor the piece " +
        "needs on that side; get_drawing lists the sides and their zones.",
      inputSchema: SCHEMAS.set_zones,
    },
    async (args) => result(await tools.setZones(args)),
  );
  tool(
    "set_opens_into",
    {
      description:
        "Switch a built-in unit between opening into a table, a desk or a bed, in every layout; its sizes stay. " +
        "Open or close it with set_configuration.",
      inputSchema: SCHEMAS.set_opens_into,
    },
    async (args) => result(await tools.setOpensInto(args)),
  );
  tool(
    "set_stair",
    {
      description:
        "Set a stair's target riser, its going, its handrails (railing, glass or none: handrail for a spiral's one or both sides of a flight, handrailLeft and handrailRight for one side as you walk up; a rung ladder has none), a rung ladder's hooks, a winder stair's leftEntry, or several as one edit, in every layout. " +
        "Each side is shared by both flights of an L: given on either flight, it sets both; a riser or going sets only the flight named. A target riser sets the " +
        "riser count (the rise over it, rounded up) and keeps the run, so the going gives way; it stays what you asked " +
        "when the rise changes. A going keeps the riser and sets the run, its back edge staying; a run that no longer " +
        "fits is refused. get_drawing's stair line gives the result; the rules of thumb are warnings.",
      inputSchema: SCHEMAS.set_stair,
    },
    async (args) => result(await tools.setStair(args)),
  );
  tool(
    "set_desk",
    {
      description:
        "Turn \"With computer\" on or off for a desk or a desk with chair, in every layout: a monitor at the " +
        "back, a keyboard and a mouse drawn on its top, on the plan and in 3D. It never changes the piece's size or fit. " +
        "get_drawing lists options: [\"computer\"] on a desk that has one.",
      inputSchema: SCHEMAS.set_desk,
    },
    async (args) => result(await tools.setDesk(args)),
  );
  tool(
    "place_set",
    {
      description:
        "Place several pieces as one edit, all or none: bedAndNightstands (a bed with a nightstand each side, flush at the head) " +
        "or sofaAndRug (a sofa, a coffee table and a rug under it). They stand exactly as listed, turned together about the " +
        "overall box's centre, with no snapping. Each is then an independent piece, with nothing linking them. If one doesn't " +
        "fit, nothing is placed and the reason says which.",
      inputSchema: SCHEMAS.place_set,
    },
    async (args) => result(await tools.placeSet(args)),
  );
  tool(
    "break_apart",
    {
      description:
        "Split a table or desk with chairs into its table and loose chairs, in every layout, each exactly where the set " +
        "draws it and on the same surface, as one edit. The set's object goes, and each chair then moves alone; there's no " +
        "regrouping. Refused for any other piece.",
      inputSchema: SCHEMAS.break_apart,
    },
    async (args) => result(await tools.breakApart(args)),
  );
  tool(
    "set_chairs",
    {
      description:
        "Turn \"Round chairs\" on or off for a table or desk with chairs, or a loose chair, in every layout: its chairs draw a " +
        "rounded seat and a curved back, on the plan and in 3D. It never changes the piece's size or fit, and a change " +
        "of kind drops it. get_drawing lists options: [\"roundChairs\"] on a piece that has them.",
      inputSchema: SCHEMAS.set_chairs,
    },
    async (args) => result(await tools.setChairs(args)),
  );
  tool(
    "add_layout",
    { description: "Add an empty layout after the last one. The reply's result gives its id.", inputSchema: SCHEMAS.add_layout },
    async (args) => result(await tools.addLayout(args)),
  );
  tool(
    "copy_layout",
    {
      description: "Add a layout holding a copy of every object placement of layout `from`. The reply's result gives its id.",
      inputSchema: SCHEMAS.copy_layout,
    },
    async (args) => result(await tools.copyLayout(args)),
  );
  tool(
    "add_door",
    {
      description:
        "Add a door, an open passage or a curtain on a wall, from `offset` metres along it (measured from joint a) for " +
        "`width` metres, in its kind's width range. It opens to or hangs on `side` (left or right looking from joint a to " +
        "b); `hinge` is the end where it is hinged, a sliding door parks, a pocket door's pocket runs (one width of wall " +
        "past that end, checked like the door) or a folding door stacks. It must lie within the wall and not overlap " +
        "another opening at its height (openings may stack). The reply's result gives the door id.",
      inputSchema: SCHEMAS.add_door,
    },
    async (args) => result(await tools.addDoor(args)),
  );
  tool(
    "add_window",
    {
      description:
        "Add a window on a wall, from `offset` metres along it (measured from joint a) for `width` metres, in its kind's " +
        "width range. A casement opens to `side`, hinged at `hinge`; a two-leaf window opens to `side`. `sheer` hangs a sheer " +
        "curtain and `shutterBox` adds a roller-shutter box, on the room side. It must lie " +
        "within the wall and not overlap another opening at its height (a window may sit over a door). The reply's result gives the window id.",
      inputSchema: SCHEMAS.add_window,
    },
    async (args) => result(await tools.addWindow(args)),
  );
  tool(
    "set_opening",
    {
      description:
        "Change a door's, window's or doorway's kind, width, side, hinge, glazing, sill or height, or a window's sheer or shutter box; " +
        "what isn't given stays. A new sill keeps its height, a new height keeps its sill. Refused, changing nothing, " +
        "when it wouldn't fit its wall. It keeps its id.",
      inputSchema: SCHEMAS.set_opening,
    },
    async (args) => result(await tools.setOpening(args)),
  );
  tool(
    "add_dimension",
    {
      description:
        "Add a dimension line measuring from `from` to `to`, drawn `offset` metres to the side (positive on the left " +
        "looking from `from` to `to`); dimension lines are shared by every layout. An end given at a joint or at " +
        "a room's floor corner where two walls meet at an angle (from get_drawing) is tied to it and follows the walls; " +
        "any other end, a step between walls of different thickness included, stays where given. The reply's result " +
        "gives the dimension id.",
      inputSchema: SCHEMAS.add_dimension,
    },
    async (args) => result(await tools.addDimension(args)),
  );
  tool(
    "add_section",
    {
      description:
        `Add a section, a vertical cut along a straight line from a to b, at least ${m(MIN_SECTION_LENGTH)} m long, looking to \`side\` (left or right, going from a to b). ` +
        "It sees the whole drawing past the line, or only `depth` metres past it (zero: only the cut). It's shared by every layout and marked on the plan. The reply's " +
        "result gives its letter, the first free one from A to Z, which never changes; after Z it's refused. Nothing changes a section: delete it and add it again, which also " +
        "deletes its sheets and may give it another letter. Draw it with look (view \"section\"), print it with add_sheet (kind section).",
      inputSchema: SCHEMAS.add_section,
    },
    async (args) => result(await tools.addSection(args)),
  );
  tool(
    "look",
    {
      description:
        "A PNG of the plan: the underlay faded grey, the walls, doors, windows, decks with their labels (a deck above " +
        "the cut as a dashed outline), a layout's pieces (default the first), room names and dimension lines, metre rulers; plus a line with the region, metres per look pixel, y up, the layout, UNSCALED first while the " +
        "underlay is unscaled. Default region: the whole underlay with a small margin, else the drawing. Read " +
        "coordinates in plan metres off the rulers (y up); pass a region { min, max } to zoom in. UNSCALED means the " +
        `picture still sits at a provisional ${PROVISIONAL_METRES_PER_PIXEL * 100} cm per pixel, so the rulers don't give its real lengths yet: scale it ` +
        "with scale_underlay before tracing. With view \"3d\": the layout in 3D " +
        "from yaw and tilt (any angle; the default is the panel's first view): floors, walls, decks and every piece at its " +
        "height, in parts and material colours where its kind has them, else as a coloured box (walls facing the camera " +
        "hidden, the ceiling not drawn), to check heights; no region, no rulers. " +
        "With view \"section\": a section (its letter) in the layout; no region, no rulers. " +
        "Tracing a plan picture (the underlay): when get_drawing lists an underlay, draw the plan from it. 1) look at " +
        "the whole plan. 2) If look's caption starts with UNSCALED, find the longest dimension printed on the plan, look " +
        "at a small region (about 1 m across) around each of its two ends, read each end in metres off the rulers, and " +
        "call scale_underlay with the two points and the printed length. 3) Check a second printed dimension on the " +
        "rulers; if it is off by more than 2 %, stop and ask the user to set the scale with the Scale tool (Underlay " +
        "section in Properties). 4) Trace the outer shell with add_walls, at the thickness the picture shows; look after " +
        "each batch, look at regions to check, and fix with set_wall_length and move_joint. 5) Then the inner walls, " +
        "the doors (add_door), the windows (add_window) and the room names printed on the plan (label_room). Leave " +
        "furniture drawn on the plan out: layouts are the user's.",
      inputSchema: SCHEMAS.look,
    },
    async (args) => lookResult(await tools.look(args)),
  );
  tool(
    "scale_underlay",
    {
      description:
        "Sets the underlay's scale from two points in plan metres (read off look's rulers at the ends of a printed " +
        "dimension) and the real distance between them; a stays fixed, walls never move. Then check a second printed " +
        "dimension on the rulers: if it is off by more than 2 %, ask the user to set the scale with the Scale tool.",
      inputSchema: SCHEMAS.scale_underlay,
    },
    async (args) => result(await tools.scaleUnderlay(args)),
  );
  tool(
    "add_sheet",
    {
      description:
        `Add a sheet to the PDF: a plan (one drawing), a compare sheet (two to ${SHEET_SLOTS.length} drawings at one scale and one framing, in ` +
        "panes that share their edges), a cover (one drawing beside the project's title and an index of the sheets), " +
        `a section (\`section\`, a letter, for one to ${SHEET_SLOTS.length} layouts, split like a compare sheet) or ` +
        "a report (no drawing, `text` in columns, flowing onto as many numbered pages as it needs). It goes after `after`, or last. " +
        "get_drawing's sheets lists every sheet in order: id, kind, title, number (null when not In PDF), pages, scale (what it prints at; null on a report), " +
        "ownScale, partOfPlan (the frame leaves part of the plan out: a note, never an error), and drawings, framing, finishes, split, section, or for a report its length, first line and size. " +
        "A project starts with an automatic list, one plan per layout and per loft with pieces of its own, with ids auto/ and its place (sheetsAutomatic: true), so re-read " +
        "them if a layout or a loft changes. The first edit to the list stores every sheet under the id it has then, so an id read just before it stays good. " +
        "From then on the list is yours: a new layout gets no sheet by itself, and deleting a layout or a deck takes its sheets with it. " +
        "Refused like any edit. The reply's result gives the sheet's id.",
      inputSchema: SCHEMAS.add_sheet,
    },
    async (args) => result(await tools.addSheet(args)),
  );
  tool(
    "set_sheet",
    {
      description:
        `Change a sheet: what is left out stays. ${SCALE_REFUSAL}, so the sheet can be measured with a scale ruler. ` +
        "Framing is in metres, not on paper, so it survives a scale change; a compare sheet's panes share it. A sheet prints what its frame shows, however little. " +
        `A report's text replaces the whole text, up to ${MAX_SHEET_TEXT.toLocaleString("en-US")} characters: read_report it first. Someone typing in that report keeps their words, and leaving their box then overwrites yours, as the last writer wins, ` +
        "so read it again after they stop. What a kind doesn't print is refused (text on a plan, a scale on a report).",
      inputSchema: SCHEMAS.set_sheet,
    },
    async (args) => result(await tools.setSheet(args)),
  );
  tool(
    "delete_sheet",
    { description: "Delete a sheet from the PDF; a layout it drew stays. The last sheet can't be deleted.", inputSchema: SCHEMAS.delete_sheet },
    async (args) => result(await tools.deleteSheet(args)),
  );
  tool(
    "move_sheet",
    { description: "Move a sheet in the list, which is the PDF's order; the numbers follow.", inputSchema: SCHEMAS.move_sheet },
    async (args) => result(await tools.moveSheet(args)),
  );
  tool(
    "read_report",
    { description: "A report's whole text, as stored, with its marks and line breaks. get_drawing and every edit's reply give only its length and first line.", inputSchema: SCHEMAS.read_report },
    async (args) => result(await tools.readReport(args)),
  );
  return server;
}
