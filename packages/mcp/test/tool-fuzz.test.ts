import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { validateDocument } from "@fm/domain";
import { createMcpServer } from "../src/server";
import { CONNECTION_DROPPED, NO_ANSWER, type EditorSession } from "../src/session";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";
import { mulberry32 } from "./pictures";

// Garbage in through the real MCP client (PhotoCraft's panic_hunt, for Flatmate): random tools with arguments built from
// each tool's input schema, mixed with junk values and the drawing's real ids. Every call must come back as a reply
// (an answer or a refusal), never a throw or a wait that times out; the drawing stays valid after each call, the session
// keeps accepting a plain edit, and a second editor on the same project ends with the same drawing.

const SEED = 20261022;
const EPISODES = 6;
/** Calls per episode; each episode starts on a freshly seeded project, since random deletes wear the drawing down. */
const STEPS = 100;
/** A call taking longer than this hangs: the session's own timeout (2 s in the harness) answers well before it. */
const HANG_MS = 5000;
/** Every this many calls, a plain edit must still go through. */
const PROBE_EVERY = 25;
/** Edits that must each go through at least once, so the fuzz reaches the edit paths and not only the refusals. */
const MIN_ACCEPTED_TOOLS = 20;
/**
 * A reply that reads like a JavaScript failure: the SDK turns a handler's exception into a tool error with its message,
 * so a crash would otherwise pass for a refusal.
 */
const LOOKS_LIKE_A_CRASH = /TypeError|RangeError|ReferenceError|SyntaxError|Cannot read propert|is not a function|is not iterable|\bundefined\b|\bNaN\b|\[object Object\]/;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

type CallResult = Awaited<ReturnType<Client["callTool"]>>;
type Tool = { name: string; inputSchema: unknown };

function field(o: unknown, key: string): unknown {
  return typeof o === "object" && o !== null && Object.hasOwn(o, key) ? Object.getOwnPropertyDescriptor(o, key)?.value : undefined;
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function textOf(r: CallResult): string {
  const content: unknown[] = Array.isArray(r.content) ? r.content : [];
  const text = content.map((c) => field(c, "text")).find((t) => typeof t === "string");
  return typeof text === "string" ? text : "";
}

/** The ids the drawing holds now by table, and the open project's. */
type Ids = Record<string, string[]>;

function idsOf(session: EditorSession): Ids {
  const doc = session.drawing();
  const keys = (t: Record<string, unknown> | undefined): string[] => Object.keys(t ?? {});
  return {
    joints: keys(doc?.joints), walls: keys(doc?.walls), labels: keys(doc?.zoneLabels), objects: keys(doc?.objects),
    openings: keys(doc?.openings), dimensions: keys(doc?.dimensions), decks: keys(doc?.decks), states: keys(doc?.states), sections: keys(doc?.sections),
    project: session.project() ? [session.project()?.id ?? ""] : [],
  };
}

/** The table a string field names an id of, by the field's name; a field not listed takes any id. */
const TABLE_OF: Record<string, string> = {
  layout: "states", from: "states", object: "objects", opening: "openings", wall: "walls", column: "walls", joint: "joints", deck: "decks", on: "decks", label: "labels", id: "project", section: "sections",
};

function generator(seed: number) {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
  const atoms: unknown[] = [
    null, 0, -0, -1, 1, 1e308, -1e308, 5e-324, 0.0004, 10001, -10001, 2.15, "", " ", "x".repeat(3000), "s0", "\u0000", "🛏‍",
    "__proto__", "constructor", "../../etc", true, false, [], {}, [1, 2], { x: 1 }, { x: "1", y: "2" }, { x: 1e308, y: -1e308 },
    { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }, { min: { x: 5, y: 5 }, max: { x: 0, y: 0 } }, "ceiling", "floor", "default",
  ];
  const atom = (): unknown => pick(atoms);

  /**
   * One call's arguments for a tool's input schema. A clean call (`junk` 0) is what the schema asks for: required
   * fields always, numbers in the 6 × 4 m room where they can, ids of the table the field names, so edits get accepted
   * and refused by the domain. A dirty call swaps values for junk, drops required fields and mixes up ids.
   */
  function argsFor(schema: unknown, ids: Ids): Record<string, unknown> {
    const junk = rand() < 0.4 ? 0 : 0.15;
    const every = Object.values(ids).flat();

    function valueFor(s: unknown, key: string, depth: number): unknown {
      if (rand() < junk || depth > 4) return atom();
      const anyOf = field(s, "anyOf");
      if (Array.isArray(anyOf) && anyOf.length > 0) return valueFor(pick(anyOf), key, depth);
      const choices = field(s, "enum");
      if (Array.isArray(choices) && choices.length > 0) return pick(choices);
      switch (field(s, "type")) {
        case "number":
        case "integer": {
          const min = num(field(s, "minimum")) ?? num(field(s, "exclusiveMinimum")) ?? -1e4;
          const max = num(field(s, "maximum")) ?? num(field(s, "exclusiveMaximum")) ?? 1e4;
          const near = Math.max(min, Math.min(max, -1 + rand() * 9));
          const v = junk === 0 || rand() < 0.75 ? near : min + rand() * (max - min);
          return field(s, "type") === "integer" ? Math.round(v) : v;
        }
        case "string": {
          const table = Object.hasOwn(TABLE_OF, key) ? ids[TABLE_OF[key] ?? ""] ?? [] : every;
          const pool = junk === 0 ? table : rand() < 0.5 ? table : every;
          return rand() < 0.85 && pool.length > 0 ? pick(pool) : pick(["Kitchen", "x".repeat(300), "s0", "🛏", " padded "]);
        }
        case "boolean":
          return rand() < 0.5;
        case "array": {
          const max = Math.min(num(field(s, "maxItems")) ?? 6, 8);
          const n = junk > 0 && rand() < 0.05 ? 60 : Math.floor(rand() * (max + 1));
          return Array.from({ length: n }, () => valueFor(field(s, "items"), key, depth + 1));
        }
        case "object":
          return objectFor(s, depth + 1);
        default:
          return atom();
      }
    }

    function objectFor(s: unknown, depth: number): Record<string, unknown> {
      const props = field(s, "properties");
      const required = field(s, "required");
      const out: Record<string, unknown> = {};
      for (const key of typeof props === "object" && props !== null ? Object.keys(props) : []) {
        const isRequired = Array.isArray(required) && required.includes(key);
        if (rand() < (isRequired ? (junk === 0 ? 1 : 0.95) : 0.5)) out[key] = valueFor(field(props, key), key, depth);
      }
      // An own key, as JSON.parse makes it: assigning `__proto__` would set the object's prototype instead.
      const extra = pick(["extra", "__proto__", "constructor"]) ?? "extra";
      if (junk > 0 && rand() < 0.1) Object.defineProperty(out, extra, { value: atom(), enumerable: true, writable: true, configurable: true });
      return out;
    }

    return objectFor(schema, 0);
  }

  return { pick, argsFor };
}

/** The MCP server of Claude's session and a second editor (Bob), both on the real server app. */
async function setup(): Promise<{ client: Client; session: EditorSession; bob: EditorSession; server: TestServer }> {
  const server = new TestServer();
  const session = server.join("Claude").session;
  const bob = server.join("Bob").session;
  const mcp = createMcpServer(createTools(session));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fuzz", version: "0.0.0" });
  await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
    session.close();
    bob.close();
  });
  return { client, session, bob, server };
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hang = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} did not answer in ${HANG_MS} ms: ${JSON.stringify(args).slice(0, 300)}`)), HANG_MS);
  });
  try {
    return await Promise.race([client.callTool({ name, arguments: args }), hang]);
  } finally {
    clearTimeout(timer);
  }
}

describe("tool fuzz: garbage arguments through the MCP client", () => {
  it(`${EPISODES} × ${STEPS} random calls each end in a reply, and the drawing stays valid and convergent`, async () => {
    const { client, session, bob, server } = await setup();
    const ok = async (name: string, args: Record<string, unknown>): Promise<void> => {
      const r = await call(client, name, args);
      expect(r.isError, `${name}: ${textOf(r)}`).toBeFalsy();
    };
    /** A small furnished drawing with two layouts, so real ids are there to be mixed into the junk; Bob opens it. */
    async function seed(episode: number): Promise<string> {
      await ok("create_project", { name: `Fuzz ${episode}` });
      await ok("draw_room", { corner: { x: 0, y: 0 }, width: 6, depth: 4 });
      await ok("add_wall", { a: { x: 3, y: 0 }, b: { x: 3, y: 4 } });
      await ok("label_room", { point: { x: 1, y: 1 }, name: "Living" });
      await ok("place_object", { layout: "s0", kind: "desk", centre: { x: 1.5, y: 3.4 } });
      await ok("place_object", { layout: "s0", kind: "armchair", centre: { x: 1, y: 1 } });
      await ok("place_object", { layout: "s0", kind: "murphyBed", centre: { x: 4.5, y: 0.6 } });
      await ok("copy_layout", { from: "s0", name: "Night" });
      const wall = Object.keys(session.drawing()?.walls ?? {})[0] ?? "";
      await ok("add_door", { wall, offset: 0.5 });
      await ok("add_deck", { preset: "loft", centre: { x: 4.5, y: 2.9 }, width: 2, depth: 1.6 });
      const project = session.project()?.id ?? "";
      expect((await bob.openProject(project)).ok).toBe(true);
      return project;
    }

    const { tools } = await client.listTools();
    const catalogue: Tool[] = tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
    const { pick, argsFor } = generator(SEED);
    const tally = { accepted: 0, schemaRefused: 0, refused: 0 };
    const acceptedTools = new Set<string>();

    for (let episode = 1; episode <= EPISODES; episode++) {
      const project = await seed(episode);
      for (let step = 1; step <= STEPS; step++) {
        const tool = pick(catalogue);
        if (tool === undefined) throw new Error("no tools");
        const args = argsFor(tool.inputSchema, idsOf(session));
        const where = `episode ${episode} step ${step}, ${tool.name} ${JSON.stringify(args).slice(0, 300)}`;
        const r = await call(client, tool.name, args);
        const text = textOf(r);
        expect(text, where).not.toBe("");
        expect(text, where).not.toBe(NO_ANSWER);
        expect(text, where).not.toBe(CONNECTION_DROPPED);
        if (!r.isError) {
          tally.accepted++;
          acceptedTools.add(tool.name);
        } else if (text.includes("Input validation error")) tally.schemaRefused++;
        else {
          tally.refused++;
          // Past the schema, a refusal is the tool's or the domain's own text (zod's messages may say "undefined").
          expect(text, where).not.toMatch(LOOKS_LIKE_A_CRASH);
        }

        const doc = session.drawing();
        const valid = doc === null ? null : validateDocument(doc);
        expect(valid === null || valid.ok ? [] : valid.error, where).toEqual([]);
        expect(server.fatal, where).toEqual([]);

        // list_projects, create_project and open_project move Claude off the drawing: go back to it.
        if (session.project()?.id !== project) await ok("open_project", { id: project });
        if (step % PROBE_EVERY === 0) await ok("set_project_field", { key: "client", value: `probe ${step}` });
      }
      await server.settle();
      expect(bob.drawing(), `episode ${episode}`).toEqual(session.drawing());
    }

    // Not vacuous: every outcome happened often, and most edits went through at least once.
    // Accepted edits: 90, not 100, since set_opening's random kinds, widths and heights are mostly refused (98 of 600 accepted, sills step 04).
    expect(tally.accepted, JSON.stringify(tally)).toBeGreaterThan(90);
    expect(tally.schemaRefused, JSON.stringify(tally)).toBeGreaterThan(100);
    expect(tally.refused, JSON.stringify(tally)).toBeGreaterThan(100);
    expect(acceptedTools.size, [...acceptedTools].join(", ")).toBeGreaterThanOrEqual(MIN_ACCEPTED_TOOLS);
  }, 120_000);
});
