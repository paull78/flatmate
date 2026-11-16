import { afterEach, describe, expect, it } from "vitest";
import { DECK_PRESETS, DECK_THICKNESS, DEFAULT_CEILING } from "@fm/domain";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Columns and decks in Claude's tools (spec "Vertical range" and "MCP", pillars.15, .23; AC-05, AC-17): add_column's
// `on` stands a column on a deck up to the ceiling or its top, its `top` takes a deck for a free floor column (up to the
// deck's underside), set_column takes `top`; get_drawing lists `on` and a deck `top`; a deck a column references moves
// its ends when raised and refuses a move or a delete naming the column.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { column?: string; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

const LOFT_TOP = DECK_PRESETS.loft.top; // 2.15
const round = (v: number): number => Math.round(v * 1000) / 1000;

/** A 4 × 5 room at (0, 0) with a hollow loft over its top, flush with three inner faces: x 0.1 to 3.9, y 2.8 to 4.9. */
async function loftRoom(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession; loft: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = withListings(createTools(claude));
  const created = summary(await tools.createProject({ name: "Studio" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 4, depth: 5 }));
  const s = summary(await tools.addDeck({ preset: "loft", centre: { x: 2, y: 3.85 }, width: 3.8, depth: 2.1 }));
  return { server, tools, alice, loft: s.result.deck ?? "" };
}

/** A 0.20 × 0.20 post under the loft (top: the loft) and one on it (on: the loft). */
async function posts(): Promise<Awaited<ReturnType<typeof loftRoom>> & { under: string; over: string; s: Edited }> {
  const r = await loftRoom();
  const under = summary(await r.tools.addColumn({ centre: { x: 1, y: 3.5 }, width: 0.2, depth: 0.2, top: r.loft })).result.column ?? "";
  const s = summary(await r.tools.addColumn({ centre: { x: 3, y: 4 }, width: 0.2, depth: 0.2, on: r.loft }));
  return { ...r, under, over: s.result.column ?? "", s };
}

const columnIn = (s: DrawingSummary, id: string) => s.columns?.find((c) => c.id === id);

describe("add_column with on and top", () => {
  it("a free column on the floor topped by the loft spans 0.00 to the loft's underside and lists top: the loft, no on", async () => {
    const { tools, loft } = await loftRoom();
    const s = summary(await tools.addColumn({ centre: { x: 1, y: 3.5 }, width: 0.2, depth: 0.2, top: loft }));
    const c = columnIn(s, s.result.column ?? "");
    expect(c?.range).toEqual({ bottom: 0, top: round(LOFT_TOP - DECK_THICKNESS) });
    expect(c?.top).toBe(loft);
    expect(c).not.toHaveProperty("on");
  });

  it("a column on the loft spans the loft's top to the ceiling and lists on: the loft, no deck top", async () => {
    const { tools, loft } = await loftRoom();
    const s = summary(await tools.addColumn({ centre: { x: 3, y: 4 }, width: 0.2, depth: 0.2, on: loft }));
    const c = columnIn(s, s.result.column ?? "");
    expect(c?.range).toEqual({ bottom: LOFT_TOP, top: DEFAULT_CEILING });
    expect(c?.on).toBe(loft);
    expect(c).not.toHaveProperty("top");
  });

  it("a column on the loft takes a height above its base; on: floor is the floor", async () => {
    const { tools, loft } = await loftRoom();
    const s = summary(await tools.addColumn({ centre: { x: 3, y: 4 }, width: 0.2, depth: 0.2, on: loft, top: 0.3 }));
    expect(columnIn(s, s.result.column ?? "")?.range).toEqual({ bottom: LOFT_TOP, top: round(LOFT_TOP + 0.3) });
    const f = summary(await tools.addColumn({ centre: { x: 1, y: 1 }, width: 0.2, depth: 0.2, on: "floor" }));
    const c = columnIn(f, f.result.column ?? "");
    expect(c?.range).toEqual({ bottom: 0, top: DEFAULT_CEILING });
    expect(c).not.toHaveProperty("on");
  });

  it("a column on the loft off the loft is refused with the domain's reason", async () => {
    const { tools, loft } = await loftRoom();
    const r = await tools.addColumn({ centre: { x: 2, y: 1 }, width: 0.2, depth: 0.2, on: loft });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("stands inside Loft");
  });

  it("an unknown deck as on or top is refused", async () => {
    const { tools } = await loftRoom();
    expect((await tools.addColumn({ centre: { x: 1, y: 3.5 }, width: 0.2, depth: 0.2, on: "nope" })).isError).toBe(true);
    expect((await tools.addColumn({ centre: { x: 1, y: 3.5 }, width: 0.2, depth: 0.2, top: "nope" })).isError).toBe(true);
  });
});

describe("set_column with top", () => {
  it("sets a height, the ceiling, and a deck again", async () => {
    const { tools, loft, under, over } = await posts();
    expect(columnIn(summary(await tools.setColumn({ column: over, top: 0.3 })), over)?.range).toEqual({ bottom: LOFT_TOP, top: round(LOFT_TOP + 0.3) });
    expect(columnIn(summary(await tools.setColumn({ column: over, top: "ceiling" })), over)?.range).toEqual({ bottom: LOFT_TOP, top: DEFAULT_CEILING });
    const low = columnIn(summary(await tools.setColumn({ column: under, top: 1 })), under);
    expect(low?.range).toEqual({ bottom: 0, top: 1 });
    expect(low).not.toHaveProperty("top");
    const back = columnIn(summary(await tools.setColumn({ column: under, top: loft })), under);
    expect(back?.range).toEqual({ bottom: 0, top: round(LOFT_TOP - DECK_THICKNESS) });
    expect(back?.top).toBe(loft);
  });
});

describe("the loft's references (AC-05 over MCP)", () => {
  it("raising the loft moves both posts", async () => {
    const { tools, loft, under, over } = await posts();
    const s = summary(await tools.setDeck({ deck: loft, top: 2.3 }));
    expect(columnIn(s, under)?.range).toEqual({ bottom: 0, top: round(2.3 - DECK_THICKNESS) });
    expect(columnIn(s, over)?.range).toEqual({ bottom: 2.3, top: DEFAULT_CEILING });
  });

  it("moving the loft is refused naming a column", async () => {
    const { tools, loft, under, over } = await posts();
    const r = await tools.setDeck({ deck: loft, centre: { x: 2.05, y: 3.85 } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Column .*(stands on|reaches up to) Loft; move it first/);
    expect([under, over].some((id) => r.text.includes(id))).toBe(true);
  });

  it("deleting the loft is refused naming a column", async () => {
    const { tools, loft, under, over } = await posts();
    const r = await tools.delete({ ids: [loft] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Column .*(stands on|reaches up to) Loft; move it first/);
    expect([under, over].some((id) => r.text.includes(id))).toBe(true);
    expect(summary(await tools.getDrawing()).counts.decks).toBe(1);
  });
});
