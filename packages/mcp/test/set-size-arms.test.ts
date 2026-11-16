import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// set_size takes an L piece's arms (catalog.09, .18): backArm and leftArm alone, or with width and depth in the same
// size command, so a shrink with a thinner arm is one edit; not with a preset, and not on a piece without arms.
// A 4 × 5 room with a 1.60 × 1.20 corner desk, arms 0.60, in its top-left corner: x 0.2–1.8, y 3.7–4.9.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function withDesk(): Promise<{ tools: DrawingTools; desk: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Corner" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const placed = summary(await tools.placeObject({ layout: "s0", kind: "cornerDesk", centre: { x: 1, y: 4.3 } }));
  return { tools, desk: placed.result.object ?? "" };
}

const listed = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id);

describe("set_size with arms", () => {
  it("backArm alone sets the back arm, leftArm alone the left one, and get_drawing shows them", async () => {
    const { tools, desk } = await withDesk();
    expect(listed(summary(await tools.setSize({ object: desk, backArm: 0.5 })), desk)).toMatchObject({ arms: { back: 0.5, left: 0.6 } });
    summary(await tools.setSize({ object: desk, leftArm: 0.45 }));
    expect(listed(summary(await tools.getDrawing()), desk)).toMatchObject({ sizes: { standard: { width: 1.6, depth: 1.2 } }, arms: { back: 0.5, left: 0.45 } });
  });

  it("width, depth and arms go in one size command: depth 0.65 with a 0.40 back arm applies both; the depth alone is refused with the arm rule", async () => {
    const { tools, desk } = await withDesk();
    const alone = await tools.setSize({ object: desk, width: 1.6, depth: 0.65 });
    expect(alone.isError).toBe(true);
    expect(alone.text).toContain("An arm must be 0.10 m or more");
    const both = summary(await tools.setSize({ object: desk, width: 1.6, depth: 0.65, backArm: 0.4 }));
    expect(listed(both, desk)).toMatchObject({ sizes: { standard: { width: 1.6, depth: 0.65 } }, arms: { back: 0.4, left: 0.6 } });
  });

  it("refuses arms with a preset", async () => {
    const { tools, desk } = await withDesk();
    const r = await tools.setSize({ object: desk, preset: "140 × 140", backArm: 0.5 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("not both");
  });

  it("refuses arms on a desk", async () => {
    const { tools } = await withDesk();
    const desk = summary(await tools.placeObject({ layout: "s0", kind: "desk", centre: { x: 3, y: 1 } })).result.object ?? "";
    const r = await tools.setSize({ object: desk, backArm: 0.3 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Only a corner piece has arms");
  });
});
