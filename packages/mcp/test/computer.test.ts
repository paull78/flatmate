import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// set_desk (AC-09, seating.12): Claude turns "With computer" on or off for a desk or a desk with chair by its object
// id, in every layout; get_drawing lists `options: ["computer"]` on an object that has it and nothing otherwise
// (library.10). Another kind is refused with the domain's reason. A 4 × 5 room with a desk against its top wall and a chair in the middle.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function room(): Promise<{ tools: DrawingTools; alice: EditorSession; desk: string; chair: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const desk = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 2, y: 4.6 } })).result.object ?? "";
  const chair = summary(await tools.placeObject({ layout: "s0", kind: "chair", centre: { x: 2, y: 2 } })).result.object ?? "";
  return { tools, alice, desk, chair };
}

const listed = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id);

describe("set_desk (AC-09)", () => {
  it("set_desk unchanged for Claude: it turns the computer on and get_drawing lists it in options", async () => {
    const { tools, alice, desk } = await room();
    expect(listed(summary(await tools.getDrawing()), desk)).not.toHaveProperty("options");
    const on = summary(await tools.setDesk({ object: desk, computer: true }));
    expect(on.result).toEqual({ object: desk });
    expect(listed(on, desk)).toMatchObject({ options: ["computer"] });
    expect(listed(summary(await tools.getDrawing()), desk)).toMatchObject({ options: ["computer"] });
    expect(listed(on, desk)).not.toHaveProperty("computer"); // the seating cycle's key is gone
    await expect.poll(() => alice.drawing()?.objects[desk]?.options).toEqual({ computer: true }); // the other client sees it
    const off = summary(await tools.setDesk({ object: desk, computer: false }));
    expect(listed(off, desk)).not.toHaveProperty("options");
  });

  it("set_desk on a chair is refused with the domain's reason", async () => {
    const { tools, chair } = await room();
    const r = await tools.setDesk({ object: chair, computer: true });
    expect(r).toEqual({ isError: true, text: "Only a desk takes a computer" });
  });

  it("set_desk on an unknown object names the id", async () => {
    const { tools } = await room();
    const r = await tools.setDesk({ object: "nope", computer: true });
    expect(r).toEqual({ isError: true, text: "No object has the id nope" });
  });
});
