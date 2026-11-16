import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { DrawingSummary } from "../src/drawing";
import { SCHEMAS } from "../src/schemas";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// A stair's handrail in Claude's tools (AC-13, guards.28): get_drawing lists it, add_stair takes it or picks it from the
// deck, set_stair sets it. A 7 × 2.5 room under a 3.20 ceiling with a loft over x 0.1 to 3.6, top 2.15; a stair's back goes
// on its right edge at (3.6, 1.25).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string; objects?: string[]; deck?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function studio(): Promise<{ tools: DrawingTools; loft: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = withListings(createTools(claude));
  summary(await tools.createProject({ name: "Studio" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 2.5 }));
  summary(await tools.setCeiling({ height: 3.2 }));
  const loft = summary(await tools.addDeck({ preset: "loft", centre: { x: 1.85, y: 1.25 }, width: 3.5, depth: 2.3 })).result.deck ?? "";
  return { tools, loft };
}
const AT = { x: 3.6, y: 1.25 };
const stairOf = (s: DrawingSummary, id: string) => s.objects.find((o) => o.id === id)?.stair;
/** A flight's rails (edges.06): one value when both sides agree, else both. */
const railOf = (s: DrawingSummary, id: string): unknown => {
  const st = stairOf(s, id);
  const sides = st?.handrails;
  return sides === undefined ? st?.handrail : sides.left === sides.right ? sides.left : sides;
};

describe("a stair's handrail through MCP (AC-13)", () => {
  it("get_drawing lists it; add_stair picks it from the deck it reaches", async () => {
    const first = await studio();
    const railing = summary(await first.tools.addStair({ layout: "s0", kind: "storageStair", deck: first.loft, at: AT }));
    expect(railOf(railing, railing.result.object ?? "")).toBe("railing");
    const { tools, loft } = await studio();
    summary(await tools.setDeck({ deck: loft, guard: "glass" }));
    const glass = summary(await tools.addStair({ layout: "s0", kind: "storageStair", deck: loft, at: AT }));
    expect(railOf(glass, glass.result.object ?? "")).toBe("glass");
  });

  it("add_stair takes one given, over the deck's", async () => {
    const { tools, loft } = await studio();
    summary(await tools.setDeck({ deck: loft, guard: "glass" }));
    const s = summary(await tools.addStair({ layout: "s0", kind: "storageStair", deck: loft, at: AT, handrail: "railing" }));
    expect(railOf(s, s.result.object ?? "")).toBe("railing");
  });

  it("set_stair sets it on its own, and keeps it when the deck's guard changes", async () => {
    const { tools, loft } = await studio();
    const placed = summary(await tools.addStair({ layout: "s0", kind: "storageStair", deck: loft, at: AT }));
    const id = placed.result.object ?? "";
    expect(railOf(summary(await tools.setStair({ object: id, handrail: "glass" })), id)).toBe("glass");
    expect(railOf(summary(await tools.setDeck({ deck: loft, guard: "none" })), id)).toBe("glass");
  });

  it("a rung ladder lists none, and set_stair refuses one on it", async () => {
    const { tools, loft } = await studio();
    const placed = summary(await tools.addStair({ layout: "s0", kind: "rungLadder", deck: loft, at: AT }));
    const id = placed.result.object ?? "";
    expect(stairOf(placed, id)).toBeDefined();
    expect(Object.keys(stairOf(placed, id) ?? {})).not.toContain("handrail");
    expect(Object.keys(stairOf(placed, id) ?? {})).not.toContain("handrails");
    expect((await tools.setStair({ object: id, handrail: "glass" })).isError).toBe(true);
  });

  it("a handrail no choice offers is refused by the schemas' words", () => {
    expect(z.object(SCHEMAS.set_stair).safeParse({ object: "o", handrail: "wood" }).success).toBe(false);
    expect(z.object(SCHEMAS.set_stair).safeParse({ object: "o", handrailLeft: "none", handrailRight: "glass" }).success).toBe(true);
    expect(z.object(SCHEMAS.set_stair).safeParse({ object: "o", handrail: "glass" }).success).toBe(true);
    expect(z.object(SCHEMAS.add_stair).safeParse({ state: "s0", kind: "stair", deck: "d", at: AT, handrail: "wood" }).success).toBe(false);
  });
});

// A flight's rails per side through Claude's tools (edges.06, AC-12): get_drawing lists left and right, set_stair sets each.
describe("a flight's sides through MCP", () => {
  it("get_drawing lists a flight's left and right; set_stair sets one side; a spiral lists one", async () => {
    const { tools, loft } = await studio();
    const placed = summary(await tools.addStair({ layout: "s0", kind: "storageStair", deck: loft, at: AT }));
    const id = placed.result.object ?? "";
    expect(stairOf(placed, id)?.handrails).toEqual({ left: "railing", right: "railing" });
    expect(Object.keys(stairOf(placed, id) ?? {})).not.toContain("handrail");
    const right = summary(await tools.setStair({ object: id, handrailRight: "none" }));
    expect(stairOf(right, id)?.handrails).toEqual({ left: "railing", right: "none" });
    const left = summary(await tools.setStair({ object: id, handrailLeft: "glass" }));
    expect(stairOf(left, id)?.handrails).toEqual({ left: "glass", right: "none" });
  });

  it("a side on a spiral is refused with the domain's reason; its one handrail takes None", async () => {
    const { tools, loft } = await studio();
    const placed = summary(await tools.addStair({ layout: "s0", kind: "spiralStair", deck: loft, at: AT }));
    const id = placed.result.object ?? "";
    expect(stairOf(placed, id)?.handrail).toBe("railing");
    const refused = await tools.setStair({ object: id, handrailLeft: "none" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("A spiral stair has one handrail");
    expect(stairOf(summary(await tools.setStair({ object: id, handrail: "none" })), id)?.handrail).toBe("none");
  });
});
