import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_SHEET_TEXT, SCALE_REFUSAL, SURROUNDINGS_VALUES, sheetDrawings, sheetSetNorth, sheetsOf, surroundingsOf } from "@fm/domain";
import type { DrawingSummary } from "../src/drawing";
import { createMcpServer } from "../src/server";
import { NO_DRAWING, type EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Claude's sheets (sheetset; AC-15), through the real tools on the real server app, a second client watching. The list
// comes from the domain's sheetsOf; what prints (numbers, scales, the part-of-plan note) from the editor's sheetFacts.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Listed = DrawingSummary & { result?: { sheet?: string } };
function summary(r: Reply): Listed {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}
function refused(r: Reply): string {
  expect(r.isError, r.text).toBe(true);
  return r.text;
}

/** Alice watches Claude's room of 5 × 4 m, with the layouts Layout and Night. */
async function setup(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession; claude: EditorSession; day: string; night: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 5, depth: 4 }));
  const states = summary(await tools.addLayout({ name: "Night" })).layouts;
  return { server, tools, alice, claude, day: states[0]?.id ?? "", night: states[1]?.id ?? "" };
}

const sheetOf = (s: Listed, id: string) => {
  const found = s.sheets?.find((x) => x.id === id);
  if (!found) throw new Error(`no sheet ${id}`);
  return found;
};
const LONG = "# A long report\n\n" + "The plan fits a whole home into seven metres. ".repeat(420);

describe("a Section sheet someone else made", () => {
  async function withSectionSheet() {
    const all = await setup();
    const { alice, day } = all;
    expect((await alice.edit({ type: "addSection", a: { x: 1, y: 1 }, b: { x: 4, y: 1 }, side: 1 })).ok).toBe(true);
    expect((await alice.edit({ type: "addSheet", opId: "s", after: null, kind: "section", section: "A", drawings: [{ layout: day, deck: null }], title: "Section A–A" })).ok).toBe(true);
    await expect.poll(() => all.claude.drawing()?.sections["A"]?.id).toBe("A");
    await expect.poll(() => sheetsOf(all.claude.drawing() ?? fail()).some((s) => s.id === SECTION)).toBe(true);
    return all;
  }
  const SECTION = "s/t0";
  function fail(): never {
    throw new Error("no drawing");
  }

  it("get_drawing lists its section and layouts, and no finishes", async () => {
    const { tools, day } = await withSectionSheet();
    const line = sheetOf(summary(await tools.getDrawing()), SECTION);
    expect(line).toMatchObject({ kind: "section", section: "A", split: "auto", drawings: [{ layout: day }], framing: [0, 0] });
    expect(line.finishes).toBeUndefined();
    const plan = sheetOf(summary(await tools.getDrawing()), "auto/0");
    expect(plan.section).toBeUndefined();
    expect(plan.split).toBeUndefined();
    expect(plan.finishes).toBe(true);
    expect(plan.marks).toBe(true);
    expect(line.marks).toBeUndefined();
    await tools.setSheet({ sheet: "auto/0", marks: false });
    expect(sheetOf(summary(await tools.getDrawing()), "auto/0").marks).toBe(false);
  });

  it("set_sheet's section takes a title still naming the old one with it, and leaves any other title, as the panel does", async () => {
    const { tools, alice, claude } = await withSectionSheet();
    expect((await alice.edit({ type: "addSection", a: { x: 1, y: 2 }, b: { x: 4, y: 2 }, side: 1 })).ok).toBe(true);
    await expect.poll(() => claude.drawing()?.sections["B"]?.id).toBe("B");
    await tools.setSheet({ sheet: SECTION, title: "Section A–A" });
    await tools.setSheet({ sheet: SECTION, section: "B" });
    expect(sheetOf(summary(await tools.getDrawing()), SECTION).title).toBe("Section B–B");
    await tools.setSheet({ sheet: SECTION, title: "Through the loft" });
    await tools.setSheet({ sheet: SECTION, section: "A" });
    expect(sheetOf(summary(await tools.getDrawing()), SECTION).title).toBe("Through the loft");
    await tools.setSheet({ sheet: SECTION, title: "Section A–A" });
    await tools.setSheet({ sheet: SECTION, section: "B", title: "Named by Claude" });
    expect(sheetOf(summary(await tools.getDrawing()), SECTION).title).toBe("Named by Claude");
  });

  it("set_sheet takes its scale, framing, split and layouts", async () => {
    const { tools, day, night } = await withSectionSheet();
    const line = sheetOf(summary(await tools.setSheet({ sheet: SECTION, scale: 50, framing: { x: 1, y: 0 }, split: "stacked", drawings: [{ layout: day }, { layout: night }] })), SECTION);
    expect(line).toMatchObject({ scale: 50, framing: [1, 0], split: "stacked", section: "A", drawings: [{ layout: day }, { layout: night }] });
  });

  it("set_sheet refuses what it doesn't print", async () => {
    const { tools } = await withSectionSheet();
    expect(refused(await tools.setSheet({ sheet: SECTION, finishes: false }))).toBe("A section sheet has no floor finishes or section marks");
    expect(refused(await tools.setSheet({ sheet: SECTION, marks: false }))).toBe("A section sheet has no floor finishes or section marks");
    expect(refused(await tools.setSheet({ sheet: SECTION, text: "Words" }))).toBe("Only a report has text and a body size");
    expect(refused(await tools.setSheet({ sheet: "auto/0", split: "stacked" }))).toBe("Only a compare or section sheet has a split");
  });

  it("set_sheet refuses a level on it, with the domain's reason", async () => {
    const { tools, day } = await withSectionSheet();
    const deck = summary(await tools.addDeck({ centre: { x: 2.5, y: 2 }, width: 1, depth: 1 })).decks?.[0]?.id ?? "";
    expect(refused(await tools.setSheet({ sheet: SECTION, drawings: [{ layout: day, deck }] }))).toBe("A section sheet draws layouts, not levels");
  });

  it("delete takes the section and its sheet", async () => {
    const { tools } = await withSectionSheet();
    const after = summary(await tools.delete({ ids: ["A"] }));
    expect(after.sheets?.map((s) => s.id)).toEqual(["auto/0", "auto/1"]);
  });
});

describe("listing sheets", () => {
  it("get_drawing lists automatic sheets with numbers, and stored ones in order", async () => {
    const { tools, day, night } = await setup();
    const automatic = summary(await tools.getDrawing());
    expect(automatic.sheetsAutomatic).toBe(true);
    expect(automatic.sheets?.map((s) => [s.id, s.kind, s.title, s.number])).toEqual([["auto/0", "plan", "Layout", 1], ["auto/1", "plan", "Night", 2]]);
    expect(automatic.sheets?.[1]).toMatchObject({ inPdf: true, pages: 1, ownScale: false, partOfPlan: false, framing: [0, 0], finishes: true, marks: true, drawings: [{ layout: night }] });
    expect(automatic.sheets?.[0]?.drawings).toEqual([{ layout: day }]);
    expect(automatic.sheets?.[0]?.scale).toEqual(expect.any(Number));

    summary(await tools.moveSheet({ sheet: "auto/1", index: 0 }));
    const stored = summary(await tools.getDrawing());
    expect(stored.sheetsAutomatic).toBeUndefined();
    expect(stored.sheets?.map((s) => [s.id, s.title, s.number])).toEqual([["auto/1", "Night", 1], ["auto/0", "Layout", 2]]);
  });

  it("an id read from the automatic list still names that sheet after the first edit", async () => {
    const { tools } = await setup();
    summary(await tools.setSheet({ sheet: "auto/1", title: "Night plan" }));
    const s = summary(await tools.setSheet({ sheet: "auto/0", title: "Day plan" }));
    expect(s.sheets?.map((x) => [x.id, x.title])).toEqual([["auto/0", "Day plan"], ["auto/1", "Night plan"]]);
  });

  it("with no project open, the sheet tools say so", async () => {
    const server = new TestServer();
    const { session } = server.join("Claude");
    sessions.push(session);
    const tools = withListings(createTools(session));
    expect(refused(await tools.addSheet({ kind: "report", title: "R" }))).toBe(NO_DRAWING);
    expect(refused(await tools.setSheet({ sheet: "auto/0", title: "T" }))).toBe(NO_DRAWING);
    expect(refused(await tools.readReport({ sheet: "auto/0" }))).toBe(NO_DRAWING);
  });
});

describe("add_sheet", () => {
  it("add_sheet for each kind; a report takes text", async () => {
    const { tools, day, night } = await setup();
    const plan = summary(await tools.addSheet({ kind: "plan", title: "Detail", drawings: [{ layout: night }], scale: 50 }));
    expect(plan.result?.sheet).toMatch(/\/t0$/);
    expect(plan.result?.sheet).not.toMatch(/^auto/); // the first edit puts every row: the result names the new one
    expect(sheetOf(plan, plan.result?.sheet ?? "")).toMatchObject({ kind: "plan", title: "Detail", scale: 50, ownScale: true, drawings: [{ layout: night }] });

    const compare = summary(await tools.addSheet({ kind: "compare", title: "Both", drawings: [{ layout: day }, { layout: night }], split: "stacked", scale: 100 }));
    expect(sheetOf(compare, compare.result?.sheet ?? "")).toMatchObject({ kind: "compare", split: "stacked", drawings: [{ layout: day }, { layout: night }] });

    const cover = summary(await tools.addSheet({ kind: "cover", title: "Front", drawings: [{ layout: day }], after: "auto/0" }));
    expect(cover.sheets?.[1]?.id).toBe(cover.result?.sheet);

    const report = summary(await tools.addSheet({ kind: "report", title: "Project report", text: "# Studio\n\nWords.", size: "large" }));
    expect(sheetOf(report, report.result?.sheet ?? "")).toMatchObject({ kind: "report", scale: null, report: { length: 16, firstLine: "Studio", size: "large" } });
    expect(sheetOf(report, report.result?.sheet ?? "").drawings).toBeUndefined();
  });

  it("each kind's count, and a wrong layout, deck or place, is refused in words and changes nothing", async () => {
    const { tools, day, alice } = await setup();
    expect(refused(await tools.addSheet({ kind: "compare", title: "One", drawings: [{ layout: day }] }))).toBe("A compare sheet holds 2 to 4 drawings");
    expect(refused(await tools.addSheet({ kind: "plan", title: "None" }))).toBe("A plan sheet holds one drawing");
    expect(refused(await tools.addSheet({ kind: "report", title: "R", drawings: [{ layout: day }] }))).toBe("A report holds no drawing");
    expect(refused(await tools.addSheet({ kind: "plan", title: "P", drawings: [{ layout: "nope" }] }))).toBe("No layout has the id nope");
    expect(refused(await tools.addSheet({ kind: "plan", title: "P", drawings: [{ layout: day, deck: "nope" }] }))).toBe("No deck has the id nope");
    expect(refused(await tools.addSheet({ kind: "report", title: "R", after: "nope" }))).toBe("No sheet has the id nope");
    const doc = alice.drawing();
    expect(doc && sheetsOf(doc).map((s) => s.id)).toEqual(["auto/0", "auto/1"]);
  });

  it("what a kind doesn't print is refused, as it would be lost without a word", async () => {
    const { tools, day } = await setup();
    expect(refused(await tools.addSheet({ kind: "plan", title: "P", drawings: [{ layout: day }], text: "Lost" }))).toContain("report");
    expect(refused(await tools.setSheet({ sheet: "auto/0", text: "Lost" }))).toContain("report");
    expect(refused(await tools.setSheet({ sheet: "auto/0", size: "large" }))).toContain("report");
    expect(refused(await tools.setSheet({ sheet: "auto/0", split: "stacked" }))).toContain("compare");
    const report = summary(await tools.addSheet({ kind: "report", title: "R" })).result?.sheet ?? "";
    expect(refused(await tools.setSheet({ sheet: report, scale: 50 }))).toContain("A report");
    expect(refused(await tools.setSheet({ sheet: report, framing: { x: 1, y: 0 } }))).toContain("A report");
    expect(refused(await tools.setSheet({ sheet: report, finishes: false }))).toContain("A report");
  });
});

describe("set_sheet", () => {
  it("set_sheet a scale, framing, drawings, In PDF, title, text", async () => {
    const { tools, night } = await setup();
    const scaled = summary(await tools.setSheet({ sheet: "auto/0", scale: 50 }));
    expect(sheetOf(scaled, "auto/0")).toMatchObject({ scale: 50, ownScale: true });
    const general = summary(await tools.setSheet({ sheet: "auto/0", scale: "general" }));
    expect(sheetOf(general, "auto/0").ownScale).toBe(false);

    const framed = summary(await tools.setSheet({ sheet: "auto/0", framing: { x: 500, y: -1.25 } }));
    expect(sheetOf(framed, "auto/0")).toMatchObject({ framing: [500, -1.25], partOfPlan: true });
    const centred = summary(await tools.setSheet({ sheet: "auto/0", framing: { x: 0, y: 0 } }));
    expect(sheetOf(centred, "auto/0")).toMatchObject({ framing: [0, 0], partOfPlan: false });

    const drawn = summary(await tools.setSheet({ sheet: "auto/0", drawings: [{ layout: night }], title: "Night again" }));
    expect(sheetOf(drawn, "auto/0")).toMatchObject({ title: "Night again", drawings: [{ layout: night }] });

    const off = summary(await tools.setSheet({ sheet: "auto/0", inPdf: false }));
    expect(sheetOf(off, "auto/0")).toMatchObject({ inPdf: false, number: null });
    expect(sheetOf(off, "auto/1").number).toBe(1);

    const report = summary(await tools.addSheet({ kind: "report", title: "R", text: "Old" })).result?.sheet ?? "";
    expect(sheetOf(summary(await tools.setSheet({ sheet: report, text: "New\r\nwords", size: "small" })), report).report).toEqual({ length: 10, firstLine: "New", size: "small" });
    expect(JSON.parse((await tools.readReport({ sheet: report })).text)).toEqual({ sheet: report, title: "R", length: 10, text: "New\r\nwords" });
  });

  it("a scale outside the list is refused in the domain's words", async () => {
    const { tools, alice } = await setup();
    expect(refused(await tools.setSheet({ sheet: "auto/0", scale: 33 }))).toBe(SCALE_REFUSAL);
    const doc = alice.drawing();
    expect(doc && sheetsOf(doc)[0]?.scale).toBeNull();
  });

  it("over 20,000 characters is refused", async () => {
    const { tools } = await setup();
    const report = summary(await tools.addSheet({ kind: "report", title: "R" })).result?.sheet ?? "";
    expect(refused(await tools.setSheet({ sheet: report, text: "x".repeat(MAX_SHEET_TEXT + 1) }))).toBe("A report's text can be at most 20,000 characters");
    expect(refused(await tools.addSheet({ kind: "report", title: "S", text: "x".repeat(MAX_SHEET_TEXT + 1) }))).toBe("A report's text can be at most 20,000 characters");
    expect(sheetOf(summary(await tools.setSheet({ sheet: report, text: "x".repeat(MAX_SHEET_TEXT) })), report).report?.length).toBe(MAX_SHEET_TEXT);
  });

  it("an unknown sheet is named", async () => {
    const { tools } = await setup();
    expect(refused(await tools.setSheet({ sheet: "nope", title: "T" }))).toBe("No sheet has the id nope");
  });
});

describe("move_sheet and delete_sheet", () => {
  it("move_sheet and delete_sheet", async () => {
    const { tools, alice } = await setup();
    const added = summary(await tools.addSheet({ kind: "report", title: "R" })).result?.sheet ?? "";
    const moved = summary(await tools.moveSheet({ sheet: added, index: 0 }));
    expect(moved.sheets?.map((s) => [s.id, s.number])).toEqual([[added, 1], ["auto/0", 2], ["auto/1", 3]]);
    expect(refused(await tools.moveSheet({ sheet: added, index: 3 }))).toBe("That place isn't in the list");
    expect(refused(await tools.moveSheet({ sheet: "nope", index: 0 }))).toBe("No sheet has the id nope");

    const left = summary(await tools.deleteSheet({ sheet: "auto/0" }));
    expect(left.sheets?.map((s) => s.id)).toEqual([added, "auto/1"]);
    summary(await tools.deleteSheet({ sheet: added }));
    expect(refused(await tools.deleteSheet({ sheet: "auto/1" }))).toBe("A project keeps at least one sheet");
    expect(refused(await tools.deleteSheet({ sheet: "nope" }))).toBe("No sheet has the id nope");
    const doc = alice.drawing();
    expect(doc && sheetsOf(doc).map((s) => s.id)).toEqual(["auto/1"]);
  });
});

describe("a report's text", () => {
  it("an edit's reply doesn't repeat a long report; get_drawing gives its length and first line; read_report gives it all", async () => {
    const { tools } = await setup();
    expect(LONG.length).toBeLessThanOrEqual(MAX_SHEET_TEXT);
    const r = await tools.addSheet({ kind: "report", title: "R", text: LONG });
    const id = summary(r).result?.sheet ?? "";
    expect(r.text).not.toContain("seven metres. The plan");
    const next = await tools.setSheet({ sheet: "auto/0", title: "Another edit" });
    expect(next.text).not.toContain("seven metres");
    expect(next.text.length).toBeLessThan(LONG.length / 2);
    const read = await tools.getDrawing();
    expect(read.text).not.toContain("seven metres");
    expect(sheetOf(summary(read), id).report).toEqual({ length: LONG.length, firstLine: "A long report", size: "normal" });
    expect(sheetOf(summary(read), id).pages).toBeGreaterThan(1);
    expect(JSON.parse((await tools.readReport({ sheet: id })).text).text).toBe(LONG);
  });

  it("a first line with no break in it stays short in the reply too", async () => {
    const { tools } = await setup();
    const text = "word ".repeat(3000);
    const r = await tools.addSheet({ kind: "report", title: "R", text });
    const line = sheetOf(summary(r), summary(r).result?.sheet ?? "").report?.firstLine ?? "";
    expect(line.length).toBeLessThanOrEqual(81);
    expect(line.endsWith("…")).toBe(true);
    expect(r.text.length).toBeLessThan(text.length / 2);
    const emoji = await tools.setSheet({ sheet: summary(r).result?.sheet ?? "", text: "🏠".repeat(200) });
    expect(summary(emoji).sheets?.at(-1)?.report?.firstLine).toBe(`${"🏠".repeat(80)}…`);
  });

  it("read_report names what it can't read", async () => {
    const { tools } = await setup();
    expect(refused(await tools.readReport({ sheet: "nope" }))).toBe("No sheet has the id nope");
    expect(refused(await tools.readReport({ sheet: "auto/0" }))).toBe("Layout (auto/0) is a plan sheet, not a report");
  });

  it("a report's pages move the numbers after it", async () => {
    const { tools } = await setup();
    const first = summary(await tools.addSheet({ kind: "report", title: "R", text: LONG, after: "auto/0" }));
    const report = sheetOf(first, first.result?.sheet ?? "");
    expect(report.number).toBe(2);
    expect(sheetOf(first, "auto/1").number).toBe(2 + report.pages);
  });
});

describe("the set's settings", () => {
  it("north and studio fields through set_project_field, with an invalid value refused", async () => {
    const { tools, alice } = await setup();
    expect(summary(await tools.setProjectField({ key: "north", value: "45" })).fields).toEqual({ north: "45" });
    await expect.poll(() => { const d = alice.drawing(); return d && sheetSetNorth(d); }).toBe(45);
    expect(refused(await tools.setProjectField({ key: "north", value: "400" }))).toBe("North must be a whole number of degrees from 0 to 359");
    expect(summary(await tools.setProjectField({ key: "north", value: "" })).fields).toEqual({});

    const studio = [["studioName", "Studio Rossi"], ["studioAddress", "Via Roma 1"], ["studioContact", "rossi@example.com"], ["issueDate", "3 Nov 2026"], ["paper", "A3"], ["generalScale", "50"], ["accent", "#7c3aed"]] as const;
    for (const [key, value] of studio) summary(await tools.setProjectField({ key, value }));
    const s = summary(await tools.getDrawing());
    expect(s.fields).toEqual(Object.fromEntries(studio));
    expect(s.sheets?.[0]?.scale).toBe(50);
    expect(refused(await tools.setProjectField({ key: "paper", value: "B5" }))).toBe("Paper must be A4, A3, A2, A1 or Letter");
    expect(refused(await tools.setProjectField({ key: "generalScale", value: "33" }))).toBe(SCALE_REFUSAL);
    expect(refused(await tools.setProjectField({ key: "accent", value: "red" }))).toBe("Accent must be a colour like #b3261e");
    expect(refused(await tools.setProjectField({ key: "studioName", value: "x".repeat(81) }))).toBe("Studio name is longer than 80 characters");
  });

  it("set_project_field then get_drawing lists surroundings (AC-05)", async () => {
    const { tools, alice } = await setup();
    expect(summary(await tools.setProjectField({ key: "surroundings", value: "wheels" })).fields).toEqual({ surroundings: "wheels" });
    expect(summary(await tools.getDrawing()).fields).toEqual({ surroundings: "wheels" });
    await expect.poll(() => { const d = alice.drawing(); return d && surroundingsOf(d); }).toBe("wheels");
    expect(refused(await tools.setProjectField({ key: "surroundings", value: "none" }))).toBe("Surroundings must be interior, outside, wheels or grid; empty means None");
  });

  it("None lists nothing (AC-05)", async () => {
    const { tools } = await setup();
    expect(summary(await tools.setProjectField({ key: "surroundings", value: "" })).fields).toEqual({});
    summary(await tools.setProjectField({ key: "surroundings", value: "grid" }));
    expect(summary(await tools.setProjectField({ key: "surroundings", value: "" })).fields).toEqual({});
    expect(summary(await tools.getDrawing()).fields).toEqual({});
  });
});

describe("through the server", () => {
  it("a change reaches a browser client", async () => {
    const { server, tools, alice, claude, night } = await setup();
    const id = summary(await tools.addSheet({ kind: "report", title: "Project report", text: "# Studio\n\nWords." })).result?.sheet ?? "";
    summary(await tools.setSheet({ sheet: "auto/1", scale: 50 }));
    summary(await tools.moveSheet({ sheet: id, index: 0 }));
    summary(await tools.deleteSheet({ sheet: "auto/0" }));
    summary(await tools.setProjectField({ key: "north", value: "30" }));
    await server.settle();
    const doc = alice.drawing();
    if (!doc) throw new Error("Alice has no drawing");
    expect(sheetsOf(doc).map((s) => [s.id, s.kind, s.title, s.scale])).toEqual([[id, "report", "Project report", null], ["auto/1", "plan", "Night", 50]]);
    expect(sheetsOf(doc)[0]?.text).toBe("# Studio\n\nWords.");
    expect(sheetDrawings(sheetsOf(doc)[1] ?? sheetsOf(doc)[0]!)).toEqual([{ layout: night, deck: null }]);
    expect(sheetSetNorth(doc)).toBe(30);
    expect(doc).toEqual(claude.drawing());
  });

  it("a person's edit first, then Claude's on the same sheet: both land, and the clients converge", async () => {
    const { server, tools, alice, claude } = await setup();
    summary(await tools.setSheet({ sheet: "auto/0", title: "First" })); // rows now
    await server.settle();
    expect((await alice.edit({ type: "setSheet", sheetId: "auto/0", title: "Alice's" })).ok).toBe(true);
    await server.settle();
    expect(summary(await tools.setSheet({ sheet: "auto/0", scale: 200 })).sheets?.[0]).toMatchObject({ title: "Alice's", scale: 200, ownScale: true });
    await server.settle();
    expect(alice.drawing()).toEqual(claude.drawing());
  });

  it("a clash with a person's edit reads like any edit's, nothing changes, and the clients converge", async () => {
    const server = new TestServer();
    const claude = server.join("Claude");
    const alice = server.join("Alice").session;
    sessions.push(claude.session, alice);
    const tools = withListings(createTools(claude.session));
    const created = summary(await tools.createProject({ name: "Studio" }));
    expect((await alice.openProject(created.project.id)).ok).toBe(true);
    summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 5, depth: 4 }));
    summary(await tools.setSheet({ sheet: "auto/0", title: "First" }));
    await server.settle();
    claude.link.hold(); // Claude does not see Alice's edit before its own
    expect((await alice.edit({ type: "setSheet", sheetId: "auto/0", title: "Alice's" })).ok).toBe(true);
    const reply = tools.setSheet({ sheet: "auto/0", title: "Claude's" });
    await server.settle();
    claude.link.release();
    expect(refused(await reply)).toBe("Someone else changed this first");
    await server.settle();
    expect(alice.drawing()).toEqual(claude.session.drawing());
    const doc = alice.drawing();
    expect(doc && sheetsOf(doc)[0]?.title).toBe("Alice's");
  });
});

describe("over the MCP protocol", () => {
  async function connected() {
    const server = new TestServer();
    const { session } = server.join("Claude");
    sessions.push(session);
    const mcp = createMcpServer(withListings(createTools(session)));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
    await client.callTool({ name: "create_project", arguments: { name: "P" } });
    await client.callTool({ name: "draw_room", arguments: { corner: { x: 0, y: 0 }, width: 5, depth: 4 } });
    return client;
  }
  const textOf = (r: Awaited<ReturnType<Client["callTool"]>>): string => {
    const first: unknown = Array.isArray(r.content) ? r.content[0] : undefined;
    return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
  };

  it("the schemas let a wrong scale and a long text reach the domain's refusal", async () => {
    const client = await connected();
    const scale = await client.callTool({ name: "set_sheet", arguments: { sheet: "auto/0", scale: 33 } });
    expect([scale.isError, textOf(scale)]).toEqual([true, SCALE_REFUSAL]);
    const add = await client.callTool({ name: "add_sheet", arguments: { kind: "report", title: "R", text: "x".repeat(MAX_SHEET_TEXT + 1) } });
    expect([add.isError, textOf(add)]).toEqual([true, "A report's text can be at most 20,000 characters"]);
    const north = await client.callTool({ name: "set_project_field", arguments: { key: "north", value: "400" } });
    expect([north.isError, textOf(north)]).toEqual([true, "North must be a whole number of degrees from 0 to 359"]);
    await client.close();
  });

  it("each tool works over the protocol, with its annotations", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    const hints = (name: string) => tools.find((t) => t.name === name)?.annotations;
    expect(hints("add_sheet")).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: false });
    expect(hints("set_sheet")).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: true });
    expect(hints("move_sheet")).toMatchObject({ idempotentHint: true, destructiveHint: true });
    expect(hints("delete_sheet")).toMatchObject({ idempotentHint: true, destructiveHint: true });
    expect(hints("read_report")).toMatchObject({ readOnlyHint: true });
    const added = await client.callTool({ name: "add_sheet", arguments: { kind: "report", title: "R", text: "# T" } });
    expect(added.isError).toBe(false);
    const id: string = JSON.parse(textOf(added)).result.sheet;
    expect((await client.callTool({ name: "set_sheet", arguments: { sheet: id, framing: undefined, title: "S" } })).isError).toBe(false);
    expect(JSON.parse(textOf(await client.callTool({ name: "read_report", arguments: { sheet: id } }))).text).toBe("# T");
    expect((await client.callTool({ name: "move_sheet", arguments: { sheet: id, index: 0 } })).isError).toBe(false);
    expect((await client.callTool({ name: "delete_sheet", arguments: { sheet: id } })).isError).toBe(false);
    await client.close();
  });

  it("descriptions say how sheets are named, what framing measures, and what set_project_field now carries", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    const description = (name: string): string => tools.find((t) => t.name === name)?.description ?? "";
    for (const part of ["sheets", "first line", "read_report"]) expect(description("get_drawing"), part).toContain(part);
    expect(client.getInstructions()).toContain("PDF sheets, report: add_sheet.");
    for (const part of ["auto/", "first edit"]) expect(description("add_sheet"), part).toContain(part);
    for (const part of ["metres", "20,000", "1:50"]) expect(description("set_sheet"), part).toContain(part);
    for (const part of ["north", "clockwise", "paper", "generalScale", "accent", "issueDate", "studioName", "client, address, revision"]) expect(description("set_project_field"), part).toContain(part);
    await client.close();
  });

  it("set_project_field's description names surroundings and its values (AC-05)", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    const text = tools.find((t) => t.name === "set_project_field")?.description ?? "";
    expect(text).toContain("surroundings (");
    for (const { value } of SURROUNDINGS_VALUES) expect(text, value).toContain(value);
    expect(text).toContain("empty: None");
    await client.close();
  });
});
