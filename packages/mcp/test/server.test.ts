import { afterEach, describe, expect, it } from "vitest";
import { MOTIF_IDS, OBJECT_KINDS } from "@fm/domain";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, DRAWING_URI, TOOL_NAMES } from "../src/server";
import { NO_DRAWING, type EditorSession } from "../src/session";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** Claude Code cuts a server's instructions after this many characters (levels.54). */
const CLAUDE_CODE_INSTRUCTIONS = 4096;
/**
 * Claude Code's cap on one tool's description: 2.1.296 raised it from 2,048 to 4,096; 2,048 keeps older versions whole
 * (cleanup.10).
 */
const CLAUDE_CODE_TOOL_DESCRIPTION = 2048;

/** An MCP client connected in memory to the MCP server of a session on the real server app. */
async function connect(): Promise<{ client: Client; session: EditorSession }> {
  const session = new TestServer().join("Claude").session;
  const mcp = createMcpServer(createTools(session));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
    session.close();
  });
  return { client, session };
}

/** The content items of one type, in order. */
function contentOf(r: Awaited<ReturnType<Client["callTool"]>>, type: string): Record<string, unknown>[] {
  const content: unknown[] = Array.isArray(r.content) ? r.content : [];
  return content.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && "type" in c && c.type === type);
}

function textOf(r: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = Array.isArray(r.content) ? r.content : [];
  const first: unknown = content[0];
  return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
}

describe("the MCP server (in memory, no stdio)", () => {
  it("lists the fifty-four tools with their input schemas", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toHaveLength(54);
    const look = tools.find((t) => t.name === "look");
    expect(look?.inputSchema.required).toBeUndefined();
    expect(Object.keys(look?.inputSchema.properties ?? {})).toEqual(["region", "view", "yaw", "tilt", "layout", "section", "roof"]);
    expect(look?.outputSchema).toBeUndefined();
    expect(tools.find((t) => t.name === "scale_underlay")?.inputSchema.required).toEqual(["a", "b", "distance"]);
    // set_desk (seating.12): its text lives in its description, not the instructions (seating.31).
    expect(tools.find((t) => t.name === "set_desk")?.inputSchema.required).toEqual(["object", "computer"]);
    expect(tools.find((t) => t.name === "set_desk")?.description).toContain("monitor");
    expect(tools.find((t) => t.name === "set_desk")?.annotations).toMatchObject({ idempotentHint: true, readOnlyHint: false });
    // set_chairs (library.10): likewise, its text only in its description.
    expect(tools.find((t) => t.name === "set_chairs")?.inputSchema.required).toEqual(["object", "round"]);
    expect(tools.find((t) => t.name === "set_chairs")?.description).toContain("Round chairs");
    expect(tools.find((t) => t.name === "set_chairs")?.annotations).toMatchObject({ idempotentHint: true, readOnlyHint: false });
    expect(tools.find((t) => t.name === "add_dimension")?.inputSchema.required).toEqual(["from", "to", "offset"]);
    expect(tools.find((t) => t.name === "add_door")?.inputSchema.required).toEqual(["wall", "offset"]);
    expect(Object.keys(tools.find((t) => t.name === "add_door")?.inputSchema.properties ?? {})).toEqual(["wall", "offset", "width", "kind", "side", "hinge", "glazed", "height"]);
    expect(Object.keys(tools.find((t) => t.name === "add_window")?.inputSchema.properties ?? {})).toEqual(["wall", "offset", "width", "kind", "side", "hinge", "sill", "height", "sheer", "shutterBox"]);
    expect(Object.keys(tools.find((t) => t.name === "set_opening")?.inputSchema.properties ?? {})).toEqual(["opening", "offset", "kind", "width", "side", "hinge", "glazed", "sill", "height", "sheer", "shutterBox"]);
    expect(tools.find((t) => t.name === "add_walls")?.inputSchema.required).toEqual(["walls"]);
    const drawRoom = tools.find((t) => t.name === "draw_room");
    expect(Object.keys(drawRoom?.inputSchema.properties ?? {})).toEqual(["corner", "width", "depth", "thickness"]);
    expect(tools.find((t) => t.name === "set_wall_thickness")?.inputSchema.required).toEqual(["wall", "thickness"]);
  });

  it("set_finish takes a label or a deck (deck-floors.03), a motif or none, and optional fields; its description gives each motif's size and range and the motif-change rule (finishes.14, .37)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "set_finish");
    expect(tool?.inputSchema.required).toBeUndefined(); // motif is optional: reset takes none (inherit step 03)
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["label", "deck", "wall", "side", "wallsOf", "roof", "outside", "reset", "lower", "height", "motif", "colour", "strength", "size", "angle"]); // walls and the roof (surfaces step 14), outside and reset (inherit step 03)
    expect(tool?.inputSchema.properties?.["motif"]).toMatchObject({ enum: [...MOTIF_IDS, "none"] });
    const text = tool?.description ?? "";
    for (const part of [
      "planks: plank width 0.10–0.40 (default 0.20)", "mosaic: tile side 0.020–0.050 (default 0.025)", "largeTiles: short side 0.30–0.75 (default 0.60)",
      "keeps the colour and direction and takes its own size and strength", "reset", "outside", "wallsOf",
      "the same motif keeps omitted fields", "label_room", '"none"',
    ]) expect(text, part).toContain(part);
    for (const motif of MOTIF_IDS) expect(text, motif).toContain(`${motif}:`);
    expect(tool?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
  });

  it("the six tools are registered with bounded schemas", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const schema = (name: string) => tools.find((t) => t.name === name)?.inputSchema;
    expect(schema("place_object")?.required).toEqual(["layout", "kind", "centre"]);
    expect(schema("move_object")?.required).toEqual(["layout"]); // object, or objects for a group (mcp-fixes.02)
    expect(schema("set_configuration")?.required).toEqual(["layout", "object", "config"]);
    expect(schema("set_size")?.required).toEqual(["object"]);
    expect(schema("add_layout")?.required).toEqual(["name"]);
    expect(schema("copy_layout")?.required).toEqual(["from", "name"]);
    expect(schema("place_object")?.properties?.["kind"]).toMatchObject({ enum: expect.arrayContaining(["murphyBed", "builtInTable", "builtInDesk"]) });
    expect(JSON.stringify(schema("set_configuration")?.properties?.["config"])).toContain("folded");
    const width = JSON.stringify(schema("set_size")?.properties?.["width"]);
    expect(width).toContain("0.02");
    expect(width).toContain("10");
    expect(tools.find((t) => t.name === "set_size")?.description).toContain("shared by all its configurations");
    expect(Object.keys(schema("set_size")?.properties ?? {})).toEqual(["object", "preset", "config", "width", "depth", "height", "elevation", "backArm", "leftArm"]);
    expect(JSON.stringify(schema("set_size")?.properties?.["backArm"])).toContain("An L piece's arm depth");
  });

  it("set_zones, set_opens_into and the preset are in the schemas; the instructions and get_drawing speak of blocked zones (AC-10)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const schema = (name: string) => tools.find((t) => t.name === name)?.inputSchema;
    expect(schema("set_zones")?.required).toEqual(["layout", "object"]);
    expect(schema("set_opens_into")?.required).toEqual(["object", "into"]);
    expect(Object.keys(schema("place_object")?.properties ?? {})).toContain("preset");
    expect(schema("place_object")?.properties?.["preset"]).toMatchObject({ enum: expect.arrayContaining(["US Queen", "King", "2 seats"]) });
    expect(JSON.stringify(schema("place_object"))).toContain("US Queen");
    expect(schema("set_size")?.properties?.["preset"]).toMatchObject({ enum: expect.arrayContaining(["King"]) });
    expect(schema("set_opens_into")?.properties?.["into"]).toMatchObject({ enum: ["table", "desk", "bed"] });
    expect(client.getInstructions()).toContain("set_zones");
    expect(client.getInstructions()).toContain("blocked");
    expect(tools.find((t) => t.name === "get_drawing")?.description).toContain("blocked");
    // set_zones takes a side's depth and insets (furnish.14, .20); get_drawing lists them.
    const left = JSON.stringify(schema("set_zones")?.properties?.["left"]);
    for (const word of ['"depth"', '"start"', '"end"', '"default"']) expect(left).toContain(word);
    expect(tools.find((t) => t.name === "get_drawing")?.description).toContain("insets");
    // On an `L` front, start and end trim the strips from their far ends (catalog.13, .40): said on the front side only.
    const front = JSON.stringify(schema("set_zones")?.properties?.["front"]);
    expect(front).toContain("start trims the left arm's strip from that arm's front end and end the back arm's strip from that arm's right end");
    expect(left).not.toContain("strip");
  });

  it("columns: add_column and set_column take a centre, size and rotation; the instructions point to them and no longer draw a column as four walls (pillars.15)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name);
    expect(tool("add_column")?.inputSchema.required).toEqual(["centre", "width", "depth"]);
    expect(Object.keys(tool("add_column")?.inputSchema.properties ?? {})).toEqual(["centre", "width", "depth", "rotation", "on", "top"]);
    expect(tool("set_column")?.inputSchema.required).toEqual(["column"]);
    expect(Object.keys(tool("set_column")?.inputSchema.properties ?? {})).toEqual(["column", "centre", "width", "depth", "rotation", "top"]);
    for (const part of ["0.10 to 2.00", "inside a room", "clear of every wall"]) expect(tool("add_column")?.description, part).toContain(part);
    // In a wall's line (pillars.42, .43; AC-17): a centre on a wall puts it in the wall's line; set_column slides it; delete heals.
    for (const part of ["centreline", "in that wall's line", "splitting it", "at least as deep as the wall", "takes its base and top"]) {
      expect(tool("add_column")?.description, part).toContain(part);
    }
    for (const part of ["slides along its wall", "rotation follows the wall"]) expect(tool("set_column")?.description, part).toContain(part);
    // Base and top (pillars.23, .48; AC-05): on a loft, up to a loft's underside, and the loft's lock.
    for (const part of ["`on`", "`top`", "underside", "names the column"]) expect(tool("add_column")?.description, part).toContain(part);
    expect(tool("set_column")?.description).toContain("new top");
    expect(tool("set_deck")?.description).toContain("names the column");
    expect(tool("get_drawing")?.description).toContain("on and top: the decks it stands on and reaches");
    expect(tool("delete")?.description).toContain("columns");
    expect(tool("delete")?.description).toContain("heals");
    // Every kind of id delete takes (mcp step 11, AC-16): holes, named areas and layouts too.
    for (const part of ["holes", "named areas", "a layout"]) expect(tool("delete")?.description, part).toContain(part);
    expect(client.getInstructions() ?? "").toMatch(/^Flatmate is a collaborative 2\.5D floor-plan editor/);
    expect(tool("get_drawing")?.description).toContain("columns (id, centre, width, depth, rotation, range");
    const text = client.getInstructions() ?? "";
    expect(text.length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTIONS);
    expect(text).not.toContain("four walls");
    expect(text).toContain("add_column");
  });

  it("the instructions say a piece may overhang a low deck by 0.30, its centre on it, within the cap (steps.10, AC-11)", async () => {
    const { client } = await connect();
    const text = client.getInstructions() ?? "";
    expect(text.length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTIONS);
    const sentence = text.slice(text.indexOf("piece on a deck lies inside it"), text.indexOf("a piece over a deck it doesn't stand on"));
    for (const part of ["overhangs", "0.76", "0.30", "centre on it"]) expect(sentence, part).toContain(part);
  });

  it("the instructions say a chair may tuck under a desk or table but for its back 0.10 m, and free floor counts the overlap once (seating AC-05, AC-06)", async () => {
    const { client } = await connect();
    const text = client.getInstructions() ?? "";
    expect(text.length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTIONS);
    const sentence = text.slice(text.indexOf("not overlap another object in the same layout"), text.indexOf("An object's width"));
    for (const part of ["chair", "tuck under a desk or table", "open", "same surface", "back 0.10 m", "free floor counts the overlap once"]) {
      expect(sentence, part).toContain(part);
    }
  });

  it("the instructions say a group of walls inside a room cuts a hole, and get_drawing names holes", async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toContain("cuts a hole in it");
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "get_drawing")?.description).toContain("holes");
  });

  it("delete, place_object and move_object say what a shared piece and a group do (mcp-fixes AC-11, AC-14)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const description = (name: string): string => tools.find((t) => t.name === name)?.description ?? "";
    for (const part of ["deleted from every layout", "everyLayout: false"]) expect(description("delete"), part).toContain(part);
    expect(description("place_object")).toContain("everyLayout");
    for (const part of ["objects", "turn", "all or none"]) expect(description("move_object"), part).toContain(part);
    for (const name of ["delete", "place_object", "move_object"]) expect(description(name).length, name).toBeLessThanOrEqual(CLAUDE_CODE_TOOL_DESCRIPTION);
    expect(tools).toHaveLength(54);
  });

  it("place_object and move_object take reaches and say links are explicit; get_drawing lists the stair line (AC-12, AC-15)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const place = tools.find((t) => t.name === "place_object");
    expect(Object.keys(place?.inputSchema.properties ?? {})).toContain("reaches");
    expect(place?.inputSchema.required).not.toContain("reaches");
    expect(place?.description).toContain("links to a deck only when `reaches` names it (touching a deck's edge links nothing)");
    const move = tools.find((t) => t.name === "move_object");
    expect(Object.keys(move?.inputSchema.properties ?? {})).toContain("reaches");
    expect(move?.inputSchema.required).not.toContain("reaches");
    expect(move?.description).toContain('with "nothing", unlinks it');
    expect(tools.find((t) => t.name === "get_drawing")?.description).toContain("risers × riser, going, run; warnings");
  });

  it("add_stair takes state, kind (stair kinds only), deck, at and shape; its description holds the stair sentence (stairdraw.16, AC-15)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const add = tools.find((t) => t.name === "add_stair");
    expect(Object.keys(add?.inputSchema.properties ?? {})).toEqual(["layout", "kind", "deck", "at", "shape", "handrail"]);
    expect(add?.inputSchema.required).toEqual(["layout", "kind", "deck", "at"]);
    const stairs = OBJECT_KINDS.filter((k) => k.stair !== null && !k.retired).map((k) => k.id);
    expect(stairs.length).toBeGreaterThan(1);
    expect(add?.inputSchema.properties?.["kind"]).toMatchObject({ enum: stairs });
    expect(add?.inputSchema.properties?.["shape"]).toMatchObject({ enum: ["straight", "l-left", "l-right"] });
    for (const part of ["middle of the stair's back", "within 1 cm", "floor", "every layout", "result gives"]) {
      expect(add?.description, part).toContain(part);
    }
    // The L (step 07): left and right, the landing, both refusals and the three ids.
    for (const part of ["l-left puts the lower flight on the left", "solid square landing", "half the risers", "Only stair, openStair and storageStair turn", "doesn't turn", "two risers", "objects both flights", "deck the landing"]) {
      expect(add?.description, part).toContain(part);
    }
    expect(add?.description).not.toContain("for now");
    // The stair sentence stays out of the instructions (levels.54).
    expect(client.getInstructions()).not.toContain("add_stair");
  });

  it("the instructions, set_wall_top and set_ceiling give the fit rule: 0.10 m of wall above an opening, which may stack (sills.02)", async () => {
    const { client } = await connect();
    const text = client.getInstructions() ?? "";
    expect(text).toContain("openings keep 0.10 m of wall above them and may stack");
    expect(text).not.toContain("2.00 m tall");
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "set_wall_top")?.description).toContain("keeps 0.10 m above its doors' and windows' heads");
    expect(tools.find((t) => t.name === "set_ceiling")?.description).toContain("less than 0.10 m above a door's or window's head");
  });

  it("instructions mention decks after heights; the deck tools, on, delete, get_drawing and look describe decks (decks.08)", async () => {
    const { client } = await connect();
    const text = client.getInstructions() ?? "";
    const decks = text.indexOf("Decks:");
    expect(decks).toBeGreaterThan(text.indexOf("Heights:"));
    expect(decks).toBeLessThan(text.indexOf("Levels:"));
    const paragraph = text.slice(decks, text.indexOf("Levels:"));
    for (const part of ["solid", "hollow", "0.12", "Platform", "0.45", "Loft", "2.15", "elevation", "on"]) {
      expect(paragraph, part).toContain(part);
    }
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name);
    // The deck limits and the move/resize rules live in the deck tools' descriptions (cleanup.03).
    for (const part of ["over the building", "ceiling", "0.30"]) expect(tool("add_deck")?.description, part).toContain(part);
    for (const part of ["carries", "resize", "turned or deleted"]) expect(tool("set_deck")?.description, part).toContain(part);
    expect(tool("add_deck")?.inputSchema.required).toEqual(["centre", "width", "depth"]);
    expect(Object.keys(tool("add_deck")?.inputSchema.properties ?? {})).toEqual(["preset", "name", "centre", "width", "depth", "rotation", "top", "solid", "guard", "guards"]);
    expect(tool("set_deck")?.inputSchema.required).toEqual(["deck"]);
    expect(Object.keys(tool("set_deck")?.inputSchema.properties ?? {})).toEqual(["deck", "name", "centre", "width", "depth", "rotation", "top", "solid", "guard", "guards"]);
    expect(tool("set_deck")?.description).toContain("resize");
    for (const name of ["place_object", "move_object"]) expect(Object.keys(tool(name)?.inputSchema.properties ?? {}), name).toContain("on");
    expect(tool("delete")?.description).toContain("decks");
    expect(tool("get_drawing")?.description).toContain("decks");
    expect(tool("look")?.description).toContain("floors, walls, decks");
    expect(tool("look")?.description).toContain("decks with their labels (a deck above the cut as a dashed outline)"); // the plan picture too (cleanup.09)
  });

  it("the instructions fit Claude Code's cut and end with the Levels paragraph and the tracing pointer (AC-01)", async () => {
    const { client } = await connect();
    const text = client.getInstructions() ?? "";
    expect(text.length).toBeLessThanOrEqual(CLAUDE_CODE_INSTRUCTIONS);
    expect(text.indexOf("Levels:")).toBeGreaterThan(text.indexOf("Decks:"));
    expect(text.endsWith("pass on with its deck id. Tracing a plan picture (the underlay): follow the steps in look's description.")).toBe(true);
    for (const gone of ["Dimension lines", "title block", "1) look", "A deck is refused unless"]) expect(text, gone).not.toContain(gone);
  });

  it("every tool description fits Claude Code's cap (AC-01)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) expect((t.description ?? "").length, t.name).toBeLessThanOrEqual(CLAUDE_CODE_TOOL_DESCRIPTION);
  });

  it("each paragraph past the old cut lives in its tool's description (AC-02)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const description = (name: string): string => tools.find((t) => t.name === name)?.description ?? "";
    const text = client.getInstructions() ?? "";
    // Every fact moved out of the instructions, one phrase each (the M1 mutation review found single phrases too few).
    const moved: [string, string][] = [
      ["add_deck", "crosses no wall taller than its underside"],
      ["add_deck", "overlaps no other deck (touching is fine)"],
      ["set_deck", "its pieces stay where they are on the plan"],
      ["set_deck", "add_deck's limits apply"],
      ["set_deck", "A move, a resize or a new top is refused if a piece no longer fits"],
      ["set_deck", "can't be turned or deleted while a piece stands on it"],
      ["add_dimension", "a step between walls of different thickness included, stays where given"],
      ["add_dimension", "dimension lines are shared by every layout"],
      ["set_project_field", "client, address, revision"],
      ["look", "If look's caption starts with UNSCALED"],
      ["look", "look after each batch, look at regions to check, and fix with set_wall_length and move_joint"],
    ];
    for (const [name, sentence] of moved) {
      expect(description(name), name).toContain(sentence);
      expect(text, name).not.toContain(sentence);
    }
  });

  it("look's description gives Claude the tracing loop, and the instructions point to it", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const text = tools.find((t) => t.name === "look")?.description ?? "";
    expect(client.getInstructions()).toContain("Tracing a plan picture (the underlay): follow the steps in look's description.");
    for (const part of ["scale_underlay", "2 %", "Scale tool", "furniture"]) expect(text, part).toContain(part);
    // Scale, then trace, then openings.
    expect(text.indexOf("scale_underlay")).toBeLessThan(text.indexOf("add_walls"));
    expect(text.indexOf("add_walls")).toBeLessThan(text.indexOf("add_door"));
  });

  it("look, scale_underlay and get_drawing describe their part of the loop", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const description = (name: string): string => tools.find((t) => t.name === name)?.description ?? "";
    for (const part of ["UNSCALED", "rulers", "1 cm per pixel", "y up", "region { min, max }"]) expect(description("look"), part).toContain(part);
    for (const part of ["printed", "metres", "2 %", "Scale tool"]) expect(description("scale_underlay"), part).toContain(part);
    expect(description("get_drawing")).toContain("underlay");
  });

  it("every tool carries a title and all four hints; only get_drawing, look and read_report are read-only", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const t of tools) {
      const a = t.annotations ?? {};
      expect(Object.keys(a).sort(), t.name).toEqual(["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint", "title"]);
      expect(a.openWorldHint, t.name).toBe(false);
    }
    const hint = (name: string) => tools.find((t) => t.name === name)?.annotations;
    expect(tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort()).toEqual(["get_drawing", "look", "read_report"]);
    expect(hint("get_drawing")?.title).toBe("Get drawing");
    expect(hint("set_opens_into")?.title).toBe("Set opens into");
    // list_projects closes the drawing (spec: mcp): not read-only, but nothing stored changes.
    expect(hint("list_projects")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(hint("delete")).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(hint("set_ceiling")).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(hint("add_wall")).toMatchObject({ destructiveHint: false, idempotentHint: false });
    expect(hint("create_project")).toMatchObject({ destructiveHint: false, idempotentHint: false });
    // add_stair creates a stair each call, like place_object.
    expect(hint("add_stair")).toMatchObject({ title: "Add stair", readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    // scaleUnderlay multiplies the current scale, so the same call twice scales twice.
    expect(hint("scale_underlay")).toMatchObject({ destructiveHint: true, idempotentHint: false });
  });

  it("lists the open drawing as a resource that reads like get_drawing", async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources).toEqual([expect.objectContaining({ uri: DRAWING_URI, name: "drawing", mimeType: "application/json" })]);
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } });
    const drawing = textOf(await client.callTool({ name: "get_drawing", arguments: {} }));
    const { contents } = await client.readResource({ uri: DRAWING_URI });
    expect(contents).toEqual([{ uri: DRAWING_URI, mimeType: "application/json", text: drawing }]);
    expect(JSON.parse(drawing).rooms[0].area).toBe(10.64);
  });

  it("reading the drawing resource with no project open fails with get_drawing's reason", async () => {
    const { client } = await connect();
    await expect(client.readResource({ uri: DRAWING_URI })).rejects.toThrow(NO_DRAWING);
  });

  it("refuses place_object with an unknown kind before the handler runs", async () => {
    const { client, session } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const r = await client.callTool({ name: "place_object", arguments: { layout: "s0", kind: "piano", centre: { x: 1, y: 1 } } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Input validation error");
    expect(session.drawing()?.objects).toEqual({});
  });

  it("calls a tool end to end: create_project, then draw_room", async () => {
    const { client } = await connect();
    expect((await client.callTool({ name: "create_project", arguments: { name: "Apartment" } })).isError).toBe(false);
    const r = await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } });
    expect(r.isError).toBe(false);
    expect(JSON.parse(textOf(r)).changed.created.walls).toHaveLength(4); // and four joints (mcp-fixes.03)
    const listing = await client.callTool({ name: "get_drawing", arguments: {} });
    expect(JSON.parse(textOf(listing)).rooms[0].area).toBe(10.64);
  });

  it("refuses invalid input before the handler runs", async () => {
    const { client, session } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const r = await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: -4, depth: 3 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("width");
    expect(Object.keys(session.drawing()?.walls ?? {})).toEqual([]);
  });

  it("refuses add_walls with no walls before the handler runs", async () => {
    const { client, session } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const r = await client.callTool({ name: "add_walls", arguments: { walls: [] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("walls");
    expect(textOf(r)).toContain("Input validation error");
    expect(Object.keys(session.drawing()?.walls ?? {})).toEqual([]);
  });

  it("look over the client returns an image item then a text item, with no structuredContent", async () => {
    const { client } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 4, depth: 3 } });
    const r = await client.callTool({ name: "look", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toBeUndefined();
    const content: unknown[] = Array.isArray(r.content) ? r.content : [];
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(content[1]).toMatchObject({ type: "text" });
    const [image] = contentOf(r, "image");
    expect([...Buffer.from(String(image?.["data"]), "base64").subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const [caption] = contentOf(r, "text");
    expect(String(caption?.["text"])).toMatch(/^region x .* m per look pixel · y up$/);
  });

  it("look refused over the client is text only", async () => {
    const { client } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const r = await client.callTool({ name: "look", arguments: {} });
    expect(r.isError).toBe(true);
    expect(contentOf(r, "image")).toEqual([]);
    expect(textOf(r)).toContain("Nothing to look at");
  });

  it("scale_underlay with distance 0 over the client gives the domain's reason, not \"Input validation error\"", async () => {
    const { client, session } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const placed = await session.edit({ type: "placeUnderlay", pictureId: "p-1", data: "/9j/AAAA", width: 40, height: 30, at: { x: 0, y: 3 } });
    expect(placed.ok).toBe(true);
    const r = await client.callTool({ name: "scale_underlay", arguments: { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, distance: 0 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("Distance must be more than 0");
    expect(session.drawing()?.underlays["underlay"]?.scaled).toBe(false);
  });
});
