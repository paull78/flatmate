import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// The roof for Claude (roofs.14; AC-01, AC-11): set_ceiling with a preset, with the stored values or with a high side,
// never a pitch and a high side together; get_drawing lists the roof. A 6.00 × 2.55 m outer box.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function summary(r: Reply): DrawingSummary {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function house(): Promise<DrawingTools> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Roof" }));
  summary(await tools.drawRoom({ corner: { x: 0.1, y: 0.1 }, width: 5.8, depth: 2.35 }));
  return tools;
}

describe("set_ceiling with a roof", () => {
  it("a preset sets a tiny house shed, and get_drawing lists it (AC-01)", async () => {
    const tools = await house();
    const s = summary(await tools.setCeiling({ preset: "tinyShed" }));
    expect(s.ceiling).toBe(2.75);
    expect(s.roof).toEqual({ shape: "shed", falls: "lower", lowSide: 2.75, pitch: 10, highSide: 3.2, overhang: 0.3 });
  });

  it("takes the shape, direction, low side and a high side, and solves the pitch", async () => {
    const tools = await house();
    const s = summary(await tools.setCeiling({ shape: "gable", falls: "left", height: 2.3, highSide: 3.4 }));
    expect(s.roof).toMatchObject({ shape: "gable", falls: "left", lowSide: 2.3, highSide: 3.4 });
    expect(s.roof?.pitch).toBeCloseTo(20.1, 1); // falling left and right: the ridge along y, over half the 6.00 m
  });

  it("refuses a pitch and a high side together, plainly", async () => {
    const tools = await house();
    const r = await tools.setCeiling({ shape: "shed", pitch: 12, highSide: 3.4 });
    expect(r).toMatchObject({ isError: true, text: "Give the pitch or the high side, not both" });
  });

  it("a flat drawing lists no roof", async () => {
    const tools = await house();
    const s = summary(await tools.setCeiling({ height: 2.4 }));
    expect([s.ceiling, s.roof]).toEqual([2.4, undefined]);
  });
});
