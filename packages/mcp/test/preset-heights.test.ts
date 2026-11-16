import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { DrawingSummary } from "../src/drawing";
import { SCHEMAS } from "../src/schemas";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Presets with heights in Claude's tools (catalog.07, .22, step 11): place_object and set_size take the washing
// machine's presets with their heights; set_size's height goes down to 0.01 m, width and depth keep 0.02.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}
const parse = <K extends keyof typeof SCHEMAS>(tool: K, input: unknown) => z.object(SCHEMAS[tool]).safeParse(input);

/** Claude on a project with a 4 × 5 room at (0, 0): inner faces at x 0.1 and 3.9, y 0.1 and 4.9. */
async function room(): Promise<DrawingTools> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Laundry" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  return tools;
}

describe("presets with heights (catalog.07)", () => {
  it("place_object washingMachine Washer-dryer gives h 1.70 in get_drawing; set_size Washer brings it to 0.85", async () => {
    const tools = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "washingMachine", centre: { x: 2, y: 4.6 }, preset: "Washer-dryer" }));
    const id = placed.result.object ?? "";
    const drawing = summary(await tools.getDrawing());
    expect(drawing.objects.find((o) => o.id === id)?.sizes).toEqual({ standard: { width: 0.6, depth: 0.6, height: 1.7, elevation: 0 } });
    const washer = summary(await tools.setSize({ object: id, preset: "Washer" }));
    expect(washer.objects.find((o) => o.id === id)?.sizes.standard).toEqual({ width: 0.6, depth: 0.6, height: 0.85, elevation: 0 });
  });

  it("a preset without a height keeps the piece's height", async () => {
    const tools = await room();
    const bed = summary(await tools.placeObject({ layout: "s0", kind: "bed", centre: { x: 2, y: 3.8 } })).result.object ?? "";
    summary(await tools.setSize({ object: bed, height: 0.6 }));
    const single = summary(await tools.setSize({ object: bed, preset: "Single" }));
    expect(single.objects.find((o) => o.id === bed)?.sizes.standard).toEqual({ width: 1, depth: 2.1, height: 0.6, elevation: 0 });
  });

  it("the preset enum and its description list the washer presets with their heights", () => {
    expect(parse("place_object", { layout: "s0", kind: "washingMachine", centre: { x: 1, y: 1 }, preset: "Washer-dryer" }).success).toBe(true);
    expect(SCHEMAS.place_object.preset.unwrap().description ?? "").toContain("washingMachine: Washer 60 × 60 h 85, Washer-dryer 60 × 60 h 170");
  });
});

describe("heights from 0.01 m (catalog.22)", () => {
  it("set_size {height: 0.01} is accepted on any piece; the schema refuses 0.005, and a 0.01 width or depth", async () => {
    const tools = await room();
    for (const kind of ["chair", "bed", "wardrobe"] as const) {
      const id = summary(await tools.placeObject({ layout: "s0", kind, centre: { x: 2, y: 2.5 } })).result.object ?? "";
      const thin = summary(await tools.setSize({ object: id, height: 0.01 }));
      expect(thin.objects.find((o) => o.id === id)?.sizes.standard?.height, kind).toBe(0.01);
      summary(await tools.delete({ ids: [id], layout: "s0" }));
    }
    expect(parse("set_size", { object: "o", height: 0.01 }).success).toBe(true);
    expect(parse("set_size", { object: "o", height: 0.005 }).success).toBe(false);
    expect(parse("set_size", { object: "o", width: 0.01, depth: 1 }).success).toBe(false);
    expect(parse("set_size", { object: "o", width: 1, depth: 0.01 }).success).toBe(false);
    expect(SCHEMAS.set_size.height.description).toBe("Height in metres, 0.01 to 10");
  });
});
