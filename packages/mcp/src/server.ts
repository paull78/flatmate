import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SCHEMAS } from "./schemas";
import type { DrawingTools, Reply } from "./tools";

// The MCP surface: tool names, descriptions and input schemas. Behaviour lives in tools.ts and session.ts.

export const TOOL_NAMES = [
  "list_projects", "create_project", "open_project", "get_drawing", "draw_room", "add_wall", "add_walls",
  "set_wall_length", "move_joint", "label_room", "rename_room", "delete",
] as const;

const INSTRUCTIONS =
  "Flatmate is a collaborative 2D floor-plan editor. Coordinates are metres with y pointing up; walls are 0.20 m " +
  "thick and joined at shared joints. Open or create a project first, then read it with get_drawing. Each edit is " +
  "checked like a person's edit: walls can't cross or overlap, and one edit is saved at a time. A failed edit returns " +
  "the reason; nothing changes.";

function result(r: Reply): CallToolResult {
  return { content: [{ type: "text", text: r.text }], isError: r.isError };
}

export function createMcpServer(tools: DrawingTools): McpServer {
  const server = new McpServer({ name: "flatmate", version: "0.0.0" }, { instructions: INSTRUCTIONS });
  server.registerTool(
    "list_projects",
    { description: "List the projects on the server. Leaves the open drawing, like the project list in the web app." },
    async () => result(await tools.listProjects()),
  );
  server.registerTool(
    "create_project",
    { description: "Create a project and open it. Returns the (empty) drawing.", inputSchema: SCHEMAS.create_project },
    async (args) => result(await tools.createProject(args)),
  );
  server.registerTool(
    "open_project",
    { description: "Open a project by id and return its drawing.", inputSchema: SCHEMAS.open_project },
    async (args) => result(await tools.openProject(args)),
  );
  server.registerTool(
    "get_drawing",
    { description: "The open drawing: walls (ids, joint ids, endpoints, lengths), joints, rooms (labels, clear areas in m², outlines) and unplaced labels." },
    async () => result(await tools.getDrawing()),
  );
  server.registerTool(
    "draw_room",
    {
      description:
        "Draw a free-standing rectangular room: four walls from corner (x, y), width along x, height along y. A side on " +
        "an existing wall is refused (walls can't overlap); to extend a room, use add_wall for the new sides.",
      inputSchema: SCHEMAS.draw_room,
    },
    async (args) => result(await tools.drawRoom(args)),
  );
  server.registerTool(
    "add_wall",
    {
      description:
        "Add a straight wall from a to b. An end on a joint connects to it; an end on a wall splits it (T-junction). " +
        "A wall crossing another wall is refused.",
      inputSchema: SCHEMAS.add_wall,
    },
    async (args) => result(await tools.addWall(args)),
  );
  server.registerTool(
    "add_walls",
    {
      description:
        "Add up to 50 straight walls in one call, in order, for bigger layouts such as a maze. Each wall follows " +
        "add_wall's rules: walls sharing an endpoint connect at one joint, an end on a wall splits it (T-junction), " +
        "and crossings are refused. The whole list is checked first: if any wall is refused, nothing is drawn and the " +
        "reply names that wall.",
      inputSchema: SCHEMAS.add_walls,
    },
    async (args) => result(await tools.addWalls(args)),
  );
  server.registerTool(
    "set_wall_length",
    { description: "Set a wall's length; its joint a stays, joint b moves along the wall and connected walls follow.", inputSchema: SCHEMAS.set_wall_length },
    async (args) => result(await tools.setWallLength(args)),
  );
  server.registerTool(
    "move_joint",
    { description: "Move a joint (a wall end or corner) to a point; its walls follow.", inputSchema: SCHEMAS.move_joint },
    async (args) => result(await tools.moveJoint(args)),
  );
  server.registerTool(
    "label_room",
    { description: "Name the closed room containing the point. A room holds one label.", inputSchema: SCHEMAS.label_room },
    async (args) => result(await tools.labelRoom(args)),
  );
  server.registerTool(
    "rename_room",
    { description: "Rename a room label (label ids are in get_drawing's rooms).", inputSchema: SCHEMAS.rename_room },
    async (args) => result(await tools.renameRoom(args)),
  );
  server.registerTool(
    "delete",
    { description: "Delete walls, joints (with their walls) or room labels by id, as one edit.", inputSchema: SCHEMAS.delete },
    async (args) => result(await tools.delete(args)),
  );
  return server;
}
