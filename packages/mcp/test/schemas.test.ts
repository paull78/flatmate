import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_COORD, MAX_DELETE, MAX_WALLS, SCHEMAS } from "../src/schemas";

const parse = <K extends keyof typeof SCHEMAS>(tool: K, input: unknown) => z.object(SCHEMAS[tool]).safeParse(input);

describe("tool input schemas (the MCP trust boundary, process lesson 29)", () => {
  it("accepts well-formed inputs, trims names and drops unknown fields", () => {
    expect(parse("draw_room", { x: 0, y: -2.5, width: 4, height: 3 }).success).toBe(true);
    expect(parse("label_room", { point: { x: 1, y: 1 }, name: "  Bathroom " }).data?.name).toBe("Bathroom");
    expect(parse("move_joint", { joint: "r-1/j0", to: { x: 1, y: 2, z: 9 }, extra: true }).data).toEqual({ joint: "r-1/j0", to: { x: 1, y: 2 } });
    const walls = [{ a: { x: 0, y: 0 }, b: { x: 3, y: 0, z: 1 }, thickness: 1 }, { a: { x: 3, y: 0 }, b: { x: 3, y: 3 } }];
    expect(parse("add_walls", { walls, extra: true }).data).toEqual({
      walls: [{ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } }, { a: { x: 3, y: 0 }, b: { x: 3, y: 3 } }],
    });
    const most = Array.from({ length: MAX_WALLS }, (_, i) => ({ a: { x: i, y: 0 }, b: { x: i, y: 1 } }));
    expect(parse("add_walls", { walls: most }).success).toBe(true);
  });

  it.each<[string, keyof typeof SCHEMAS, unknown]>([
    ["an infinite coordinate", "draw_room", { x: Infinity, y: 0, width: 1, height: 1 }],
    ["NaN", "add_wall", { a: { x: NaN, y: 0 }, b: { x: 1, y: 0 } }],
    ["a coordinate out of range", "move_joint", { joint: "j", to: { x: MAX_COORD + 1, y: 0 } }],
    ["a zero width", "draw_room", { x: 0, y: 0, width: 0, height: 3 }],
    ["a negative length", "set_wall_length", { wall: "w", length: -1 }],
    ["a number as a string", "set_wall_length", { wall: "w", length: "3" }],
    ["an id with a space", "set_wall_length", { wall: "has space", length: 3 }],
    ["an Object.prototype name", "rename_room", { label: "__proto__", name: "Kitchen" }],
    ["an empty name", "label_room", { point: { x: 0, y: 0 }, name: "   " }],
    ["a 201-character name", "create_project", { name: "x".repeat(201) }],
    ["no ids", "delete", { ids: [] }],
    ["too many ids", "delete", { ids: Array.from({ length: MAX_DELETE + 1 }, (_, i) => `w${i}`) }],
    ["a missing field", "add_wall", { a: { x: 0, y: 0 } }],
    ["no walls", "add_walls", { walls: [] }],
    ["too many walls", "add_walls", { walls: Array.from({ length: MAX_WALLS + 1 }, (_, i) => ({ a: { x: i, y: 0 }, b: { x: i, y: 1 } })) }],
    ["a wall with an infinite coordinate", "add_walls", { walls: [{ a: { x: 0, y: 0 }, b: { x: -Infinity, y: 1 } }] }],
    ["a wall with a coordinate out of range", "add_walls", { walls: [{ a: { x: 0, y: -MAX_COORD - 1 }, b: { x: 0, y: 1 } }] }],
    ["a wall without an end", "add_walls", { walls: [{ a: { x: 0, y: 0 } }] }],
  ])("refuses %s", (_name, tool, input) => {
    expect(parse(tool, input).success).toBe(false);
  });
});
