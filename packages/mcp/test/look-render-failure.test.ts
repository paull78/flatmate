import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../src/session";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";
import { QUADRANTS, quadrantJpeg } from "./pictures";

// Its own file: the mock replaces the rasteriser for every test here, and look.test.ts keeps the real one.

const DATA = Buffer.from(quadrantJpeg(400, 300, QUADRANTS, 90)).toString("base64");
const MARKER = DATA.slice(1000, 1064);

vi.mock("../src/rasterise", () => ({
  svgToPng: () => {
    throw new Error(`resvg gave up on ${MARKER}`);
  },
}));

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

describe("look when the picture can't be drawn (AC-10)", () => {
  it("replies with fixed text, never the error or the SVG", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    const alice = server.join("Alice").session;
    sessions.push(claude, alice);
    const tools = createTools(claude);
    expect((await tools.createProject({ name: "Look" })).isError).toBe(false);
    expect((await alice.openProject(claude.project()?.id ?? "")).ok).toBe(true);
    const placed = await alice.edit({ type: "placeUnderlay", pictureId: "picture-1", data: DATA, width: 400, height: 300, at: { x: 0, y: 0 } });
    expect(placed.ok).toBe(true);
    await server.settle();
    expect(MARKER).toHaveLength(64);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await tools.look({});
    expect(r).toEqual({ text: "Could not draw the picture", isError: true });
    expect(JSON.stringify(r)).not.toContain(MARKER);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
