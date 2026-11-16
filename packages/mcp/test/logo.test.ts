import { afterEach, describe, expect, it } from "vitest";
import { LOGO_ID } from "@fm/domain";
import { summarize } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// The studio's logo never reaches Claude (sheetset.21): a person chooses it, and its bytes would flood every reply, which
// is why it's a row and not a project field.

const BYTES = `/9j/${"logoBytes".repeat(2000)}`;

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function clean(r: Reply): Reply {
  expect(r.isError, r.text).toBe(false);
  expect(r.text).not.toContain("logoBytes");
  return r;
}

async function setup() {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = createTools(claude);
  const created: { project: { id: string } } = JSON.parse(clean(await tools.createProject({ name: "Studio" })).text);
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  clean(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 5, depth: 4 }));
  expect((await alice.edit({ type: "setLogo", data: BYTES, width: 600, height: 200 })).ok).toBe(true);
  expect(claude.drawing()?.logos[LOGO_ID]?.data).toBe(BYTES);
  return { tools, claude };
}

describe("a logo in the document", () => {
  it("get_drawing, plain and in a region, doesn't carry its bytes", async () => {
    const { tools, claude } = await setup();
    const project = claude.project();
    const doc = claude.drawing();
    if (!project || !doc) throw new Error("no drawing");
    expect(JSON.stringify(summarize(project, doc))).not.toContain("logoBytes");
    expect(JSON.stringify(summarize(project, doc, { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } }))).not.toContain("logoBytes");
    clean(await tools.getDrawing({}));
    clean(await tools.getDrawing({ region: { min: { x: 0, y: 0 }, max: { x: 2, y: 2 } } }));
  });

  it("every kind of reply stays clean: an edit, a field, a sheet, a list, a report", async () => {
    const { tools } = await setup();
    clean(await tools.setProjectField({ key: "client", value: "Rossi" }));
    clean(await tools.addWall({ a: { x: 1, y: 1 }, b: { x: 3, y: 1 } }));
    const added: { result: { sheet: string } } = JSON.parse(clean(await tools.addSheet({ kind: "report", title: "Report", text: "Words" })).text);
    clean(await tools.readReport({ sheet: added.result.sheet }));
    clean(await tools.listProjects());
  });

  it("no tool's edit disturbs it", async () => {
    const { tools, claude } = await setup();
    clean(await tools.addLayout({ name: "Night" }));
    expect(claude.drawing()?.logos[LOGO_ID]?.data).toBe(BYTES);
  });
});
