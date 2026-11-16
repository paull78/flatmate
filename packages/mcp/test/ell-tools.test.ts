import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type LookReply, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// The corner desk for Claude (catalog AC-03, AC-08): place_object places it, get_drawing lists its arms (an `L`
// object's only), and look draws it in 3D. A 4 × 5 room with the desk in its top-left corner.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

function png(r: LookReply): Uint8Array {
  if (!("png" in r)) throw new Error(`look refused: ${r.text}`);
  return r.png;
}

async function room(): Promise<DrawingTools> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Corner" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  return tools;
}

const listed = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id);

describe("the corner desk for Claude", () => {
  it("place_object places a corner desk at its default size, and get_drawing lists its arms; a plain desk has none", async () => {
    const tools = await room();
    const placed = summary(await tools.placeObject({ layout: "s0", kind: "cornerDesk", centre: { x: 1, y: 4.3 } }));
    const corner = placed.result.object ?? "";
    expect(listed(placed, corner)).toMatchObject({ kind: "cornerDesk", sizes: { standard: { width: 1.6, depth: 1.2, height: 0.75 } }, arms: { back: 0.6, left: 0.6 } });
    const desk = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 3, y: 1 } })).result.object ?? "";
    const drawing = summary(await tools.getDrawing());
    expect(listed(drawing, corner)).toMatchObject({ arms: { back: 0.6, left: 0.6 } });
    expect(listed(drawing, desk)).not.toHaveProperty("arms");
  });

  it("look draws the corner desk in 3D", async () => {
    const tools = await room();
    const empty = png(await tools.look({ view: "3d" }));
    summary(await tools.placeObject({ layout: "s0", kind: "cornerDesk", centre: { x: 1, y: 4.3 } }));
    const furnished = png(await tools.look({ view: "3d" }));
    expect(furnished.length).toBeGreaterThan(0);
    expect(Buffer.from(furnished).equals(Buffer.from(empty))).toBe(false);
  });
});
