import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES, emptyDocument, execute, sheetsOf, unwrap, type Command, type Document, type Section } from "@fm/domain";
import { LOOK_LONG_SIDE, LOOK_STYLE, lookSection, type LookPicture } from "@fm/editor";
import { toSvg } from "@fm/export";
import type { Point } from "@fm/protocol";
import { summarize, type DrawingSummary } from "../src/drawing";
import { svgToPng } from "../src/rasterise";
import { createMcpServer } from "../src/server";
import type { EditorSession } from "../src/session";
import { createTools, type LookReply, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";
import { pngPixels, pngSize, rgb } from "./pictures";

// Claude's sections (AC-11), through the real tools on the real server app, a second client watching. The picture itself
// is the editor's (look-section.test.ts holds it to the strip); here it's what a tool draws and refuses.
//
//   (-1,2) a ─────────────────────── b (6,2)     through the 5 × 4 room's side walls,
//              x 0        x 5                    a wardrobe on the line in the first layout only

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Listed = DrawingSummary & { result?: { section?: string; sheet?: string } };
function summary(r: Reply): Listed {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}
function refused(r: LookReply): string {
  expect(r.isError, r.text).toBe(true);
  return r.text;
}

const P = (x: number, y: number): Point => ({ x, y });
const A = P(-1, 2);
const B = P(6, 2);

async function setup() {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 5, depth: 4 }));
  const states = summary(await tools.addLayout({ name: "Night" })).layouts;
  const [day, night] = [states[0]?.id ?? "", states[1]?.id ?? ""];
  const wardrobe = (JSON.parse((await tools.placeObject({ layout: day, kind: "wardrobe", centre: P(1.5, 2) })).text) as { result: { object: string } }).result.object;
  summary(await tools.moveObject({ layout: night, object: wardrobe, everyLayout: false })); // in the first layout only (review.07)
  summary(await tools.delete({ ids: [wardrobe], layout: night }));
  return { server, tools, alice, claude, day, night };
}

const row = (doc: Document | null, id: string): Section | undefined => doc?.sections[id];
const docOf = (s: EditorSession): Document => {
  const doc = s.drawing();
  if (!doc) throw new Error("no drawing");
  return doc;
};

describe("add_section", () => {
  it("makes the same row as the tool, answers with the letter", async () => {
    const { tools, alice, claude, server } = await setup();
    const reply = summary(await tools.addSection({ a: A, b: B, side: "left" }));
    expect(reply.result).toEqual({ section: "A" });
    expect(row(claude.drawing(), "A")).toEqual({ id: "A", a: A, b: B, side: 1, depth: null });
    // What the Section tool sends for the same line and side (tools/section-tool.ts).
    const tool: Command = { type: "addSection", a: P(-1, 1), b: P(6, 1), side: 1 };
    await server.settle();
    expect((await alice.edit(tool)).ok).toBe(true);
    await server.settle();
    expect(row(claude.drawing(), "B")).toEqual({ id: "B", a: P(-1, 1), b: P(6, 1), side: 1, depth: null });
    expect(row(alice.drawing(), "A")).toEqual(row(claude.drawing(), "A"));
  });

  it("right looks the other way, and a depth is kept, zero too", async () => {
    const { tools, claude } = await setup();
    expect(summary(await tools.addSection({ a: A, b: B, side: "right", depth: 2 })).result).toEqual({ section: "A" });
    expect(row(claude.drawing(), "A")).toMatchObject({ side: -1, depth: 2 });
    expect(summary(await tools.addSection({ a: A, b: P(6, 1), side: "left", depth: 0 })).result).toEqual({ section: "B" });
    expect(row(claude.drawing(), "B")).toMatchObject({ side: 1, depth: 0 });
  });

  it("moves Claude's cursor to the line's middle", async () => {
    const { tools, alice, server } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    await server.settle();
    expect(alice.collaborators().find((c) => c.name === "Claude")?.at).toEqual({ x: 2.5, y: 2 });
  });

  it("a short line, a negative depth and a 27th section are refused in the domain's words, and nothing is stored", async () => {
    const { tools, claude } = await setup();
    expect(refused(await tools.addSection({ a: P(0, 0), b: P(0.4, 0), side: "left" }))).toBe(MESSAGES.sectionLine);
    expect(refused(await tools.addSection({ a: A, b: B, side: "left", depth: -1 }))).toBe(MESSAGES.sectionDepth);
    expect(claude.drawing()?.sections).toEqual({});
    for (let i = 0; i < 26; i += 1) summary(await tools.addSection({ a: A, b: B, side: "left" }));
    expect(Object.keys(claude.drawing()?.sections ?? {})).toHaveLength(26);
    expect(refused(await tools.addSection({ a: A, b: B, side: "left" }))).toBe(MESSAGES.sectionsFull);
  });
});

describe("delete", () => {
  it("removes it, and the next section takes the first free letter", async () => {
    const { tools, alice, claude, server } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    summary(await tools.delete({ ids: ["A"] }));
    expect(Object.keys(claude.drawing()?.sections ?? {})).toEqual(["B"]);
    await server.settle();
    expect(Object.keys(alice.drawing()?.sections ?? {})).toEqual(["B"]);
    expect(summary(await tools.addSection({ a: A, b: B, side: "left" })).result).toEqual({ section: "A" });
  });

  it("delete and add again is a stated limit: its sheets go with it", async () => {
    const { tools, day, claude } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    summary(await tools.addSheet({ kind: "section", section: "A", title: "Section A–A", drawings: [{ layout: day }] }));
    expect(sheetsOf(docOf(claude)).filter((s) => s.kind === "section")).toHaveLength(1);
    summary(await tools.delete({ ids: ["A"] }));
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    expect(sheetsOf(docOf(claude)).filter((s) => s.kind === "section")).toHaveLength(0);
  });
});

describe("get_drawing lists it, in both summaries", () => {
  it("in the listing: letter, line, side and depth, whatever the region; left out when there are none", async () => {
    const { tools } = await setup();
    expect(summary(await tools.getDrawing()).sections).toBeUndefined();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    summary(await tools.addSection({ a: P(1.2345, 0), b: P(1.2345, 4), side: "right", depth: 1.5 }));
    const listed = [
      { id: "A", a: [-1, 2], b: [6, 2], side: "left", depth: null },
      { id: "B", a: [1.235, 0], b: [1.235, 4], side: "right", depth: 1.5 },
    ];
    expect(summary(await tools.getDrawing()).sections).toEqual(listed);
    expect(summary(await tools.getDrawing({ region: { min: P(90, 90), max: P(91, 91) } })).sections).toEqual(listed);
  });

  /** An n × n grid of 1 m rooms: 2n(n + 1) walls, past what a reply lists from n = 12 (sheetset.61). */
  function grid(n: number): Document {
    const doc: Document = emptyDocument();
    const j = (x: number, y: number): string => `j${x}_${y}`;
    for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) doc.joints[j(x, y)] = { id: j(x, y), x, y };
    for (let x = 0; x <= n; x++) {
      for (let y = 0; y <= n; y++) {
        if (x < n) doc.walls[`h${x}_${y}`] = { id: `h${x}_${y}`, a: j(x, y), b: j(x + 1, y), thickness: 0.2, top: "ceiling", base: "floor", column: false };
        if (y < n) doc.walls[`v${x}_${y}`] = { id: `v${x}_${y}`, a: j(x, y), b: j(x, y + 1), thickness: 0.2, top: "ceiling", base: "floor", column: false };
      }
    }
    return doc;
  }
  const project = { id: "p", name: "Big", status: "saved" };

  it("in the overview too; left out when there are none", () => {
    const big = unwrap(execute(grid(12), { type: "addSection", a: A, b: B, side: 1 })).doc;
    const overview = summarize(project, big);
    expect(overview).toMatchObject({ hint: expect.stringContaining("Too large to list") });
    expect(overview.sections).toEqual([{ id: "A", a: [-1, 2], b: [6, 2], side: "left", depth: null }]);
    const none = summarize(project, grid(12));
    expect(none).toMatchObject({ hint: expect.stringContaining("Too large to list") });
    expect(none.sections).toBeUndefined();
  });
});

describe("look at a section", () => {
  function image(r: LookReply): { width: number; height: number; pixels: Uint8Array } {
    if (!("png" in r)) throw new Error(`look refused: ${r.text}`);
    expect(r.isError).toBe(false);
    return pngPixels(r.png);
  }
  function picture(doc: Document, letter: string, layout: string): LookPicture {
    const p = lookSection(doc, letter, layout);
    if ("refused" in p) throw new Error(p.refused);
    return p;
  }
  /** The colour at x metres along the picture and z up, in the frame the editor gave. */
  function at(img: ReturnType<typeof image>, p: LookPicture, x: number, z: number): [number, number, number] {
    const { min, max } = p.frame;
    const px = Math.floor(((x - min.x) * img.width) / (max.x - min.x));
    const py = Math.floor(((max.y - z) * img.height) / (max.y - min.y));
    const i = (py * img.width + px) * 4;
    return [img.pixels[i] ?? -1, img.pixels[i + 1] ?? -1, img.pixels[i + 2] ?? -1];
  }
  const near = (p: readonly number[], hex: string): boolean => rgb(hex).every((v, i) => Math.abs(v - (p[i] ?? 0)) <= 10);
  const { cut, furniture } = LOOK_STYLE.section;
  const WHITE = "#ffffff";

  it("draws a section for a named layout, with the same primitives as the strip", async () => {
    const { tools, claude, day, night } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    const doc = docOf(claude);
    for (const layout of [day, night]) {
      const r = await tools.look({ view: "section", section: "A", layout: layout });
      const p = picture(doc, "A", layout);
      if (!("png" in r)) throw new Error(r.text);
      expect(r.text).toBe(p.caption);
      expect(Buffer.from(r.png).equals(Buffer.from(svgToPng(toSvg(p.primitives, p.frame), LOOK_LONG_SIDE)))).toBe(true);
    }
    const [dayLook, nightLook] = [await tools.look({ view: "section", section: "A", layout: day }), await tools.look({ view: "section", section: "A", layout: night })];
    const [d, n] = [image(dayLook), image(nightLook)];
    const p = picture(doc, "A", day);
    const e = 2 * (p.frame.max.x - p.frame.min.x) / d.width; // two pixels in from an edge: past the room, on the background
    expect(near(at(d, p, p.frame.min.x + e, p.frame.max.y - e), WHITE), "the corner").toBe(true);
    expect(pngSize("png" in dayLook ? dayLook.png : new Uint8Array()).width).toBe(LOOK_LONG_SIDE);
    // The wardrobe is on the line at x 1.5, so 2.5 along it from a, 0.40 up: grey in the first layout only.
    expect(near(at(d, p, 2.5, 0.4), furniture), String(at(d, p, 2.5, 0.4))).toBe(true);
    expect(near(at(n, p, 2.5, 0.4), WHITE), String(at(n, p, 2.5, 0.4))).toBe(true);
    // The walls at x 0 and 5 are cut in both; the floor's and the ceiling's bands lie outside the heights.
    for (const img of [d, n]) {
      for (const [x, z] of [[1, 1.2], [6, 1.2], [3, -0.05], [3, 2.55]] as const) expect(near(at(img, p, x, z), cut), `${x}, ${z}`).toBe(true);
    }
  });

  it("the state defaults to the first; right mirrors the picture", async () => {
    const { tools, claude, day } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    summary(await tools.addSection({ a: A, b: B, side: "right" }));
    const doc = docOf(claude);
    const left = image(await tools.look({ view: "section", section: "A" }));
    expect(near(at(left, picture(doc, "A", day), 2.5, 0.4), furniture)).toBe(true);
    const right = image(await tools.look({ view: "section", section: "B" }));
    // From b, the wardrobe is 4.5 along. Its 2.5 along from that end is empty room.
    const mirrored = picture(doc, "B", day);
    expect(near(at(right, mirrored, 4.5, 0.4), furniture)).toBe(true);
    expect(near(at(right, mirrored, 2.5, 0.4), WHITE)).toBe(true);
  });

  it("refuses a section with a region or yaw, an unknown letter, a bad layout", async () => {
    const { tools, day } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    const base = { view: "section", section: "A" } as const;
    const region = { min: P(0, 0), max: P(1, 1) };
    expect(await tools.look({ ...base, region })).toEqual({ text: "A region applies to the plan view only", isError: true });
    expect(await tools.look({ ...base, yaw: 45 })).toEqual({ text: "A yaw and a tilt apply to the 3D view only", isError: true });
    expect(await tools.look({ ...base, tilt: 45 })).toEqual({ text: "A yaw and a tilt apply to the 3D view only", isError: true });
    expect(await tools.look({ view: "section" })).toEqual({ text: "Pass section: a letter from get_drawing's sections", isError: true });
    expect(await tools.look({ view: "section", section: "Q", layout: day })).toEqual({ text: "No section has the id Q", isError: true });
    expect(await tools.look({ ...base, layout: "nope" })).toEqual({ text: "No layout has the id nope", isError: true });
  });

  it("a letter belongs to the section view: the plan and 3D refuse it, and the plan takes a layout", async () => {
    const { tools, day } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    expect(await tools.look({ section: "A" })).toEqual({ text: 'A section applies to view "section" only', isError: true });
    expect(await tools.look({ view: "3d", section: "A" })).toEqual({ text: 'A section applies to view "section" only', isError: true });
    expect((await tools.look({ layout: day })).isError).toBe(false); // the plan draws a layout's pieces (mcp.03)
  });

  it("the plan view still takes a region, and marks a section", async () => {
    const { tools } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    expect("png" in (await tools.look({}))).toBe(true);
    expect("png" in (await tools.look({ region: { min: P(0, 0), max: P(1, 1) } }))).toBe(true);
  });
});

describe("a Section sheet", () => {
  it("add_sheet makes one with its section, and set_sheet changes which", async () => {
    const { tools, alice, day, night, server } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    summary(await tools.addSection({ a: A, b: P(6, 1), side: "left" }));
    const added = summary(await tools.addSheet({ kind: "section", section: "A", title: "Cut", drawings: [{ layout: day }, { layout: night }] }));
    const id = added.result?.sheet ?? "";
    expect(added.sheets.find((s) => s.id === id)).toMatchObject({ kind: "section", section: "A", title: "Cut", drawings: [{ layout: day }, { layout: night }] });
    const changed = summary(await tools.setSheet({ sheet: id, section: "B" }));
    expect(changed.sheets.find((s) => s.id === id)).toMatchObject({ kind: "section", section: "B", title: "Cut" });
    await server.settle();
    expect(sheetsOf(docOf(alice)).find((s) => s.id === id)?.section).toBe("B");
  });

  it("names an unknown letter before the domain, and the domain refuses the rest", async () => {
    const { tools, day } = await setup();
    summary(await tools.addSection({ a: A, b: B, side: "left" }));
    expect(refused(await tools.addSheet({ kind: "section", section: "Q", title: "S", drawings: [{ layout: day }] }))).toBe("No section has the id Q");
    expect(refused(await tools.addSheet({ kind: "section", title: "S", drawings: [{ layout: day }] }))).toBe("A section sheet names a section");
    expect(refused(await tools.addSheet({ kind: "section", section: "A", title: "S" }))).toBe("A section sheet holds 1 to 4 layouts");
    expect(refused(await tools.addSheet({ kind: "plan", section: "A", title: "S", drawings: [{ layout: day }] }))).toBe("Only a section sheet names a section");
    const id = summary(await tools.addSheet({ kind: "section", section: "A", title: "S", drawings: [{ layout: day }] })).result?.sheet ?? "";
    expect(refused(await tools.setSheet({ sheet: id, section: "Q" }))).toBe("No section has the id Q");
    expect(refused(await tools.setSheet({ sheet: "auto/0", section: "A" }))).toBe("Only a section sheet names a section");
  });
});

describe("over the protocol", () => {
  async function connected() {
    const { claude } = await setup();
    const mcp = createMcpServer(withListings(createTools(claude)));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
    return { client, close: async () => { await client.close(); await mcp.close(); } };
  }
  const textOf = (r: Awaited<ReturnType<Client["callTool"]>>): string => {
    const first: unknown = Array.isArray(r.content) ? r.content[0] : undefined;
    return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
  };

  it("add_section takes a line and a side, and adds a row each call", async () => {
    const { client, close } = await connected();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "add_section");
    expect(tool?.inputSchema.required).toEqual(["a", "b", "side"]);
    expect(tool?.annotations).toMatchObject({ title: "Add section", readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    const wrong = await client.callTool({ name: "add_section", arguments: { a: A, b: B, side: 1 } });
    expect(wrong.isError).toBe(true);
    expect(textOf(wrong)).toContain("side");
    await close();
  });

  it("a letter gets through look's and add_sheet's schemas, and look answers with an image", async () => {
    const { client, close } = await connected();
    expect((await client.callTool({ name: "add_section", arguments: { a: A, b: B, side: "left" } })).isError).toBe(false);
    const r = await client.callTool({ name: "look", arguments: { view: "section", section: "A" } });
    expect(Array.isArray(r.content) ? r.content[0] : null).toMatchObject({ type: "image", mimeType: "image/png" });
    const sheet = await client.callTool({ name: "add_sheet", arguments: { kind: "section", section: "A", title: "Cut", drawings: [{ layout: "s0" }] } });
    expect(sheet.isError, textOf(sheet)).toBe(false);
    await close();
  });

  it("the texts say what's new: every budget's own test holds them to their caps", async () => {
    const { client, close } = await connected();
    const { tools } = await client.listTools();
    const description = (name: string): string => tools.find((t) => t.name === name)?.description ?? "";
    expect(client.getInstructions()).toContain("add_section");
    expect(description("get_drawing")).toContain("sections (");
    expect(description("look")).toContain('view "section"');
    expect(description("delete")).toContain("sections");
    expect(description("add_sheet")).toContain("section");
    for (const part of ["delete", "first free", "`depth`"]) expect(description("add_section"), part).toContain(part);
    await close();
  });
});
