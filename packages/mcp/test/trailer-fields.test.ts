import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// The trailer's settings over MCP (trailer.03; AC-02): set_project_field takes them, get_drawing lists them.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});
const parsed = (r: Reply): DrawingSummary => {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
};

describe("set_project_field for the trailer", () => {
  it("takes the hitch, the axles and the tongue box, lists them under fields, and refuses a wrong value with its reason", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = withListings(createTools(claude));
    parsed(await tools.createProject({ name: "Tiny" }));
    parsed(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 2.5 }));
    parsed(await tools.setProjectField({ key: "surroundings", value: "wheels" }));
    parsed(await tools.setProjectField({ key: "trailerHitch", value: "low" }));
    parsed(await tools.setProjectField({ key: "tongueBox", value: "on" }));
    const d = parsed(await tools.setProjectField({ key: "trailerAxles", value: "3" }));
    expect(d.fields).toMatchObject({ surroundings: "wheels", trailerHitch: "low", trailerAxles: "3", tongueBox: "on" });
    const refused = await tools.setProjectField({ key: "trailerAxles", value: "4" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Axles must be 2 or 3; empty means 2");
  });
});
