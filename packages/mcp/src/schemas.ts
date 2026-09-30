import { MAX_NAME_LENGTH } from "@fm/domain";
import { isWireId, MAX_NAME_CHARS } from "@fm/protocol";
import { z } from "zod";

// The MCP trust boundary (process lesson 29): every tool input is bounded in shape and size here. The SDK parses
// arguments with these shapes before a handler runs; unknown fields are dropped.

export const MAX_COORD = 10_000; // metres: a floor plan, not a map
export const MAX_SIZE = 1_000; // metres
export const MAX_DELETE = 50;
export const MAX_WALLS = 50;

const coord = z.number().min(-MAX_COORD).max(MAX_COORD);
const point = z.object({ x: coord, y: coord }).describe("A point in metres; y points up");
const size = z.number().gt(0).max(MAX_SIZE);
const id = z.string().refine(isWireId, { message: "Not an id: use the ids get_drawing returns" });

export const SCHEMAS = {
  create_project: { name: z.string().trim().min(1).max(MAX_NAME_CHARS) },
  open_project: { id: id.describe("A project id from list_projects") },
  draw_room: { x: coord, y: coord, width: size, height: size },
  add_wall: { a: point, b: point },
  add_walls: { walls: z.array(z.object({ a: point, b: point })).min(1).max(MAX_WALLS).describe("Walls from a to b, drawn in this order") },
  set_wall_length: { wall: id.describe("A wall id"), length: size.describe("New length in metres; endpoint a stays") },
  move_joint: { joint: id.describe("A joint id"), to: point },
  label_room: { point: point.describe("A point inside the room"), name: z.string().trim().min(1).max(MAX_NAME_LENGTH) },
  rename_room: { label: id.describe("A room label id"), name: z.string().trim().min(1).max(MAX_NAME_LENGTH) },
  delete: { ids: z.array(id).min(1).max(MAX_DELETE).describe("Wall, joint or room label ids") },
};
