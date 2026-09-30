# M1 tasks

> Part of the [M1 plan](README.md). Read its Decisions, Waves and the shared-file rules first. Commands run from the repo root; run one test file with `pnpm --filter @fm/<pkg> test <file>` (no `--`). Every task ends with `pnpm check` green and one commit. The code below was run in a scratch copy of the repo at `1607c0d` and again at `bc7e47d`; where the real code has moved on, the code wins (adapt minimally and report it).

---

## Task M1.1: The editor's `command` event (wave 1, core, Review A) — size S

**Files:** `packages/editor/src/ports/events.ts`, `packages/editor/src/update.ts`, `packages/editor/src/index.ts`, `packages/editor/test/fake-shell.ts`, `packages/editor/test/ports.test.ts`, `packages/editor/test/index.test.ts`, create `packages/editor/test/command-event.test.ts`

Spec §12, §5.1–§5.2, §7.4. A shell without pointer input sends a domain `Command` as one event; the editor runs it exactly like a tool commit (`runCommand` in `src/commit.ts`: blocking via `canCommit`, `execute`, `commit`, history, notices, toasts). The event does not touch tools: the shells that send it have no pointer gestures.

- [x] **Step 1: Write the failing test** `packages/editor/test/command-event.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES, type Command } from "@fm/domain";
import { update } from "../src/update";
import { jointAt, pointOf, roomDoc, serverState } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { pending, shared } from "./shared-builders";

// Spec §12: a shell without pointer input (the MCP server) sends domain commands as one event, and they take the
// tools' commit path: blocking, execute, commit, history, notices and toasts.

const wall: Command = { type: "addWall", opId: "mcp1", from: { at: { x: 0, y: 0 } }, to: { at: { x: 2, y: 0 } } };

function sharedShell(d = shared()): FakeShell {
  const host = new FakeHost();
  return new FakeShell({ ...serverState(host), document: d }, host);
}

describe("the command event (spec §12)", () => {
  it("commits to a local document with a usable history entry, then renders", () => {
    const s = FakeShell.local();
    const effects = s.send({ type: "command", command: wall });
    expect(Object.keys(s.doc().walls)).toEqual(["mcp1/w0"]);
    expect(s.state.undo.past.map((e) => e.status)).toEqual(["usable"]);
    expect(effects.at(-1)?.type).toBe("render");
    s.ui({ type: "undo" });
    expect(Object.keys(s.doc().walls)).toEqual([]);
  });

  it("shows a domain error as a toast and changes nothing", () => {
    const s = FakeShell.withDocument(roomDoc());
    const before = s.doc();
    const crossing: Command = { type: "addWall", opId: "x", from: { at: { x: 3, y: -1 } }, to: { at: { x: 3, y: 1 } } };
    const effects = s.send({ type: "command", command: crossing });
    expect(s.doc()).toBe(before);
    expect(s.view().toast).toBe(MESSAGES.crossing);
    expect(effects.map((e) => e.type)).toEqual(["startTimer", "render"]);
    expect(s.state.undo.past).toEqual([]);
  });

  it("submits one changeset to a shared document and waits for the server", () => {
    const s = sharedShell();
    const corner = jointAt(s.doc(), { x: 6, y: 4 });
    s.send({ type: "command", command: { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4.5 } }] } });
    const submits = s.effectsOf("submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]?.changeset.id).toBe("id1"); // the commit ID comes from the host, as for a tool
    expect(pointOf(s.doc(), corner)).toEqual({ x: 6, y: 4.5 }); // optimistic
    expect(s.view().project?.status).toBe("waiting for server");
    expect(s.state.undo.past.map((e) => e.status)).toEqual(["pending"]);
  });

  it("is refused while an edit is outstanding: toast, no second submit, no queue", () => {
    const s = sharedShell(pending());
    const before = s.doc();
    s.send({ type: "command", command: { type: "renameZone", id: "nope", name: "Kitchen" } });
    expect(s.effectsOf("submit")).toEqual([]);
    expect(s.doc()).toBe(before);
    expect(s.view().toast).toBe("Waiting for server");
  });

  it("does nothing without an open document, and nothing for a command that changes nothing", () => {
    const host = new FakeHost();
    const r = update(serverState(host), { type: "command", command: wall }, host);
    expect(r.effects.map((e) => e.type)).toEqual(["render"]);
    const s = FakeShell.withDocument(roomDoc());
    const corner = jointAt(s.doc(), { x: 6, y: 4 });
    const effects = s.send({ type: "command", command: { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4 } }] } });
    expect(effects.map((e) => e.type)).toEqual(["render"]);
    expect(s.state.undo.past).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test command-event`
Expected: all five tests FAIL with `Unexpected: {"type":"command",…}` (the `assertNever` in `update.ts`'s `step`). `pnpm --filter @fm/editor typecheck` is red too: `"command"` is not an `Event` type.

- [x] **Step 3: Add the event** in `packages/editor/src/ports/events.ts`

Add the import at the top and the variant at the end of `Event`:

```ts
import type { Command } from "@fm/domain";
import type { Point, ProjectMeta, ServerMessage } from "@fm/protocol";
```

```ts
  | { type: "viewportResized"; size: Size; devicePixelRatio: number }
  | { type: "command"; command: Command }; // a domain command from a shell without pointer input (MCP, spec §12)
```

- [x] **Step 4: Route it** in `packages/editor/src/update.ts`

```ts
import { runCommand } from "./commit";
```

and in `step`, before `default`:

```ts
    case "command": {
      const out = runCommand(state, event.command, host);
      return { state: out.state, effects: out.effects };
    }
```

- [x] **Step 5: Run the test green**

Run: `pnpm --filter @fm/editor test command-event`
Expected: 5 passed.

- [x] **Step 6: Pin the variant** in `packages/editor/test/ports.test.ts` (its `label` switch has no `default`, so the typecheck fails until the case exists)

In `label`, after the `viewportResized` case:

```ts
    case "command":
      return `command ${e.command.type}`;
```

In "covers every event variant", append to `events`:

```ts
      { type: "command", command: { type: "renameZone", id: "L1", name: "Kitchen" } },
```

and to the expected labels:

```ts
      "workspace failed", "save w1", "server connection", "resize 800", "command renameZone",
```

- [x] **Step 7: One commit path for tests** in `packages/editor/test/fake-shell.ts` (P-M2)

Remove `import { runCommand } from "../src/commit";` and replace `command`:

```ts
  /** Sends a domain command event: the tools' commit path (execute → commit → history → notices), as the MCP shell does. */
  command(cmd: Command): Effect[] {
    return this.send({ type: "command", command: cmd });
  }
```

(The old method pushed the step's effects without a render; the new one also records the render effect. In the scratch run no existing editor or sync test depended on that.)

- [x] **Step 8: Export the read-only `visibleDoc`** (P-M1) in `packages/editor/src/index.ts`

```ts
export { hasPendingEdit, sessionOf, visibleDoc } from "./document/open-document";
```

In `packages/editor/test/index.test.ts`, extend the query list and the no-write-path list:

```ts
    for (const name of ["sharedFromSnapshot", "hasPendingEdit", "sessionOf", "visibleDoc"] as const) {
```

```ts
    for (const name of ["commit", "onEvent", "createLocalDocument", "emptyHistory", "zoomAt", "panBy", "runCommand"]) {
```

- [x] **Step 9: Verify**

Run: `pnpm --filter @fm/editor test` → 5 more than before (371 = 366 + 5 at `bc7e47d`). `pnpm --filter @fm/sync-tests test` → 14 passed. `pnpm check` → green.

- [x] **Step 10: Commit**

```bash
git add packages/editor
git commit -m "editor: a command event runs a domain command through the tools' commit path (M1)"
```

---

## Task M1.2: `@fm/mcp` package scaffold and rules (wave 1) — size S

**Files:** create `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/src/node-host.ts`, `packages/mcp/test/node-host.test.ts`; modify `package.json` (root), `pnpm-lock.yaml` (generated), `.dependency-cruiser.cjs`, `eslint.config.js`

All of M1's dependencies go in here, so the lockfile changes once (README, shared files).

- [x] **Step 1: Package files**

`packages/mcp/package.json`:

```json
{
  "name": "@fm/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.31.0",
    "@fm/domain": "workspace:*",
    "@fm/editor": "workspace:*",
    "@fm/protocol": "workspace:*",
    "ws": "^8.22.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@fm/server": "workspace:*",
    "@types/node": "^26.6.3",
    "@types/ws": "^8.18.2",
    "tsx": "^4.23.15"
  }
}
```

`packages/mcp/tsconfig.json` (a Node shell: Node typings, not the cores' `types: []`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

Run: `pnpm install`
Expected: `pnpm-lock.yaml` gains the `packages/mcp` importer; `packages/mcp/node_modules/@modelcontextprotocol/sdk/package.json` has `"version": "1.31.0"`.

- [x] **Step 2: Write the failing test** `packages/mcp/test/node-host.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isWireId } from "@fm/protocol";
import { createNodeHost } from "../src/node-host";

describe("createNodeHost", () => {
  it("hands out distinct IDs the protocol accepts", () => {
    const host = createNodeHost();
    const ids = [host.newId(), host.newId(), host.newId()];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(isWireId(id)).toBe(true);
  });

  it("has a clock that does not go backwards and a fixed-width text estimate", () => {
    const host = createNodeHost();
    const t = host.now();
    expect(host.now()).toBeGreaterThanOrEqual(t);
    expect(host.textMetrics("abcd", { family: "sans-serif", size: 10 })).toEqual({ width: 24, ascent: 8, descent: 2 });
  });
});
```

Run: `pnpm --filter @fm/mcp test node-host`
Expected: FAIL, `Failed to resolve import "../src/node-host"`.

- [x] **Step 3: Implement** `packages/mcp/src/node-host.ts`

```ts
import { randomUUID } from "node:crypto";
import type { FontSpec, Host } from "@fm/editor";

/**
 * The editor's synchronous queries in Node (spec §5.2). This shell draws nothing, so text is measured with a
 * fixed-width estimate (0.6 × size per character, as in the fake shell); it only affects label hit-testing.
 */
export function createNodeHost(): Host {
  return {
    textMetrics: (text: string, font: FontSpec) => ({
      width: 0.6 * font.size * text.length,
      ascent: 0.8 * font.size,
      descent: 0.2 * font.size,
    }),
    now: () => performance.now(),
    newId: () => randomUUID(),
  };
}
```

Run: `pnpm --filter @fm/mcp test node-host` → 2 passed.

- [x] **Step 4: Root script** in `package.json` (P-M9: `--silent`, or pnpm's banner corrupts the JSON-RPC stream on stdout)

```json
    "e2e": "pnpm --filter @fm/web e2e",
    "mcp": "pnpm --silent --filter @fm/mcp start"
```

- [x] **Step 5: Rules**

`.dependency-cruiser.cjs`: insert before the `cores-no-node-builtins` rule:

```js
    {
      name: "mcp-imports-cores-only",
      comment: "packages/mcp is a shell (spec §12): it uses protocol, domain and editor through their entries, never the server, web or test harnesses.",
      severity: "error",
      from: { path: "^packages/mcp/src/" },
      to: { path: "^packages/(server|web|sync-tests)/|^packages/editor/test/" },
    },
    {
      name: "mcp-tests-use-server-entry-only",
      comment: "MCP tests run the real server app through @fm/server's entry, like sync-tests; never the web shell.",
      severity: "error",
      from: { path: "^packages/mcp/test/" },
      to: { path: "^packages/(web|sync-tests)/" },
    },
    {
      name: "nothing-imports-mcp",
      comment: "The MCP server is an outer shell: no other package depends on it.",
      severity: "error",
      from: { pathNot: "^packages/mcp/" },
      to: { path: "^packages/mcp/" },
    },
```

(`only-through-package-index` already keeps MCP tests on `@fm/server`'s entry.)

`eslint.config.js`: insert before the block that configures `@typescript-eslint/no-unused-vars`:

```js
  {
    // The MCP server speaks JSON-RPC on stdout: logging goes to stderr (console.error / console.warn) only.
    files: ["packages/mcp/src/**/*.ts"],
    rules: { "no-console": ["error", { allow: ["error", "warn"] }] },
  },
```

- [x] **Step 6: Probe every rule once (lesson 21), then delete the probes**

```bash
echo 'import "@fm/server";' > packages/mcp/src/probe1.ts
echo 'import "@fm/editor/testing";' > packages/mcp/src/probe2.ts
echo 'import "../../mcp/src/node-host";' > packages/editor/src/probe3.ts
echo 'import "../../server/src/app/queue";' > packages/mcp/test/probe4.ts
echo 'console.log("x");' > packages/mcp/src/probe5.ts
pnpm depcruise; pnpm lint
rm packages/mcp/src/probe1.ts packages/mcp/src/probe2.ts packages/editor/src/probe3.ts packages/mcp/test/probe4.ts packages/mcp/src/probe5.ts
```

Expected: depcruise reports `mcp-imports-cores-only` (probe1, probe2), `nothing-imports-mcp` and `only-through-package-index` (probe3), `only-through-package-index` (probe4); lint reports `no-console` (probe5). After deleting the probes both are green.

- [x] **Step 7: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp package.json pnpm-lock.yaml .dependency-cruiser.cjs eslint.config.js
git commit -m "mcp: @fm/mcp package, Node host, dependency and logging rules (M1)"
```

---

## Task M1.3: Drawing summary (wave 2) — size S

**Files:** create `packages/mcp/src/drawing.ts`, `packages/mcp/test/drawing.test.ts`

What `get_drawing` and every successful edit return: compact JSON in metres (areas in m², the clear floor area from `zones`). Coordinates are rounded to millimetres, areas to hundredths. `ProjectSummary` is structural so this file does not depend on `session.ts` (same wave).

- [x] **Step 1: Write the failing test** `packages/mcp/test/drawing.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import { summarize } from "../src/drawing";

const project = { id: "p1", name: "Apartment", status: "saved" } as const;

function run(doc: Document, cmds: Command[]): Document {
  return cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

describe("summarize", () => {
  it("lists walls with joint ids, endpoints and lengths, and one room with its clear area", () => {
    const doc = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const s = summarize(project, doc);
    expect(s.project).toEqual(project);
    expect(s.units).toBe("m");
    expect(s.walls.map((w) => [w.id, w.from, w.to, w.length])).toEqual([
      ["r-1/w0", [0, 0], [4, 0], 4],
      ["r-2/w0", [4, 0], [4, 3], 3],
      ["r-3/w0", [4, 3], [0, 3], 4],
      ["r-4/w0", [0, 3], [0, 0], 3],
    ]);
    expect(s.joints).toHaveLength(4);
    expect(s.rooms).toHaveLength(1);
    expect(s.rooms[0]).toMatchObject({ labels: [], area: 10.64 }); // (4 − 0.2) × (3 − 0.2)
    expect(s.rooms[0]?.outline).toHaveLength(4);
    expect(s.unplacedLabels).toEqual([]);
  });

  it("names rooms by their labels and lists labels outside every room", () => {
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const doc = run(room, [{ type: "labelZone", id: "L1", at: { x: 2, y: 1.5 }, name: "Bathroom" }]);
    const withOrphan: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, L2: { id: "L2", at: { x: 9, y: 9 }, name: "Lost" } } };
    const s = summarize(project, withOrphan);
    expect(s.rooms[0]?.labels).toEqual([{ id: "L1", name: "Bathroom" }]);
    expect(s.unplacedLabels).toEqual([{ id: "L2", name: "Lost", at: [9, 9] }]);
  });

  it("rounds coordinates to millimetres and areas to hundredths", () => {
    const doc = run(emptyDocument(), [{ type: "addWall", opId: "w", from: { at: { x: 0.12345, y: 0 } }, to: { at: { x: 1, y: 0 } } }]);
    const s = summarize(project, doc);
    expect(s.walls[0]).toMatchObject({ from: [0.123, 0], length: 0.877 });
  });
});
```

Run: `pnpm --filter @fm/mcp test drawing` → FAIL, `Failed to resolve import "../src/drawing"`.

- [x] **Step 2: Implement** `packages/mcp/src/drawing.ts`

```ts
import { orphanLabelIds, sortedIds, zones, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";

// What get_drawing and every successful edit return: a compact JSON summary in metres (areas in m²).

type XY = [number, number];
export type ProjectSummary = { id: string; name: string; status: string };
export type DrawingSummary = {
  project: ProjectSummary;
  units: "m";
  walls: { id: string; a: string; b: string; from: XY; to: XY; length: number }[];
  joints: { id: string; at: XY }[];
  rooms: { labels: { id: string; name: string }[]; area: number | null; note?: string; outline: XY[] }[];
  unplacedLabels: { id: string; name: string; at: XY }[];
};

const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const xy = (p: Readonly<Point>): XY => [round(p.x, 3), round(p.y, 3)];

export function summarize(project: ProjectSummary, doc: Document): DrawingSummary {
  const walls: DrawingSummary["walls"] = [];
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const a = w ? doc.joints[w.a] : undefined;
    const b = w ? doc.joints[w.b] : undefined;
    if (!w || !a || !b) continue; // a valid document has none
    walls.push({ id, a: w.a, b: w.b, from: xy(a), to: xy(b), length: round(Math.hypot(b.x - a.x, b.y - a.y), 3) });
  }
  const joints = sortedIds(doc.joints).flatMap((id) => {
    const j = doc.joints[id];
    return j ? [{ id, at: xy(j) }] : [];
  });
  const labelOf = (id: string): { id: string; name: string } => ({ id, name: doc.zoneLabels[id]?.name ?? "" });
  const rooms = zones(doc).map((z) => ({
    labels: z.labelIds.map(labelOf),
    area: z.area === null ? null : round(z.area, 2),
    ...(z.unavailable === null ? {} : { note: z.unavailable }),
    outline: z.face.ring.map(xy),
  }));
  const unplacedLabels = orphanLabelIds(doc).flatMap((id) => {
    const l = doc.zoneLabels[id];
    return l ? [{ id, name: l.name, at: xy(l.at) }] : [];
  });
  return { project, units: "m", walls, joints, rooms, unplacedLabels };
}
```

Run: `pnpm --filter @fm/mcp test drawing` → 3 passed.

- [x] **Step 3: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp/src/drawing.ts packages/mcp/test/drawing.test.ts
git commit -m "mcp: drawing summary in metres with walls, joints, rooms and areas (M1)"
```

---

## Task M1.4: Tool input schemas, the trust boundary (wave 2, Review B) — size S

**Files:** create `packages/mcp/src/schemas.ts`, `packages/mcp/test/schemas.test.ts`

P-M7, process lesson 29. The SDK builds `z.object(shape)` from each entry and parses arguments before a handler runs; `z.object` drops unknown keys. zod 4's `z.number()` already refuses `NaN` and `±Infinity`.

- [x] **Step 1: Write the failing test** `packages/mcp/test/schemas.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_COORD, MAX_DELETE, SCHEMAS } from "../src/schemas";

const parse = <K extends keyof typeof SCHEMAS>(tool: K, input: unknown) => z.object(SCHEMAS[tool]).safeParse(input);

describe("tool input schemas (the MCP trust boundary, process lesson 29)", () => {
  it("accepts well-formed inputs, trims names and drops unknown fields", () => {
    expect(parse("draw_room", { x: 0, y: -2.5, width: 4, height: 3 }).success).toBe(true);
    expect(parse("label_room", { point: { x: 1, y: 1 }, name: "  Bathroom " }).data?.name).toBe("Bathroom");
    expect(parse("move_joint", { joint: "r-1/j0", to: { x: 1, y: 2, z: 9 }, extra: true }).data).toEqual({ joint: "r-1/j0", to: { x: 1, y: 2 } });
  });

  it.each<[string, keyof typeof SCHEMAS, unknown]>([
    ["an infinite coordinate", "draw_room", { x: Infinity, y: 0, width: 1, height: 1 }],
    ["NaN", "add_wall", { a: { x: NaN, y: 0 }, b: { x: 1, y: 0 } }],
    ["a coordinate out of range", "move_joint", { joint: "j", to: { x: MAX_COORD + 1, y: 0 } }],
    ["a zero width", "draw_room", { x: 0, y: 0, width: 0, height: 3 }],
    ["a negative length", "set_wall_length", { wall: "w", length: -1 }],
    ["a number as a string", "set_wall_length", { wall: "w", length: "3" }],
    ["an id with a space", "set_wall_length", { wall: "has space", length: 3 }],
    ["an Object.prototype name", "rename_room", { label: "__proto__", name: "Kitchen" }],
    ["an empty name", "label_room", { point: { x: 0, y: 0 }, name: "   " }],
    ["a 201-character name", "create_project", { name: "x".repeat(201) }],
    ["no ids", "delete", { ids: [] }],
    ["too many ids", "delete", { ids: Array.from({ length: MAX_DELETE + 1 }, (_, i) => `w${i}`) }],
    ["a missing field", "add_wall", { a: { x: 0, y: 0 } }],
  ])("refuses %s", (_name, tool, input) => {
    expect(parse(tool, input).success).toBe(false);
  });
});
```

Run: `pnpm --filter @fm/mcp test schemas` → FAIL, `Failed to resolve import "../src/schemas"`.

- [x] **Step 2: Implement** `packages/mcp/src/schemas.ts`

```ts
import { MAX_NAME_LENGTH } from "@fm/domain";
import { isWireId, MAX_NAME_CHARS } from "@fm/protocol";
import { z } from "zod";

// The MCP trust boundary (process lesson 29): every tool input is bounded in shape and size here. The SDK parses
// arguments with these shapes before a handler runs; unknown fields are dropped.

export const MAX_COORD = 10_000; // metres: a floor plan, not a map
export const MAX_SIZE = 1_000; // metres
export const MAX_DELETE = 50;

const coord = z.number().min(-MAX_COORD).max(MAX_COORD);
const point = z.object({ x: coord, y: coord }).describe("A point in metres; y points up");
const size = z.number().gt(0).max(MAX_SIZE);
const id = z.string().refine(isWireId, { message: "Not an id: use the ids get_drawing returns" });

export const SCHEMAS = {
  create_project: { name: z.string().trim().min(1).max(MAX_NAME_CHARS) },
  open_project: { id: id.describe("A project id from list_projects") },
  draw_room: { x: coord, y: coord, width: size, height: size },
  add_wall: { a: point, b: point },
  set_wall_length: { wall: id.describe("A wall id"), length: size.describe("New length in metres; endpoint a stays") },
  move_joint: { joint: id.describe("A joint id"), to: point },
  label_room: { point: point.describe("A point inside the room"), name: z.string().trim().min(1).max(MAX_NAME_LENGTH) },
  rename_room: { label: id.describe("A room label id"), name: z.string().trim().min(1).max(MAX_NAME_LENGTH) },
  delete: { ids: z.array(id).min(1).max(MAX_DELETE).describe("Wall, joint or room label ids") },
};
```

Run: `pnpm --filter @fm/mcp test schemas` → 14 passed.

- [x] **Step 3: Mutation check (lesson 25)** — remove `.refine(isWireId, …)` from `id`; the "id with a space" and "Object.prototype name" cases go red; restore.

- [x] **Step 4: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp/src/schemas.ts packages/mcp/test/schemas.test.ts
git commit -m "mcp: bounded zod input schemas for every tool (M1)"
```

---

## Task M1.5: The editor session (wave 2, Review B) — size L

**Files:** create `packages/mcp/src/session.ts`, `packages/mcp/test/harness.ts`, `packages/mcp/test/session.test.ts`

Spec §5.1, §7.2.1, §7.4, §7.7; P-M4, P-M5, P-M6. The session owns one `EditorState`, changes it only with `update`, sends server effects through a link (`clientMessageFor`) and turns server messages into events (`serverMessageEvent`). Each operation dispatches one event and waits for the editor to report the outcome. The test harness is the real server app in memory, like sync-tests' `Net`, behind an asynchronous link that round-trips JSON through the protocol parser.

- [x] **Step 1: Write the harness** `packages/mcp/test/harness.ts`

```ts
import { parseServerMessage, type ClientMessage, type ServerMessage } from "@fm/protocol";
import { createInMemoryRepository, createServerApp, domainValidator, type ServerApp, type Session } from "@fm/server";
import { createNodeHost } from "../src/node-host";
import { EditorSession, type LinkHandlers, type ServerLink } from "../src/session";

/**
 * An in-memory connection to the real server app. Messages go through JSON and the protocol parser in both directions
 * and arrive asynchronously, like a socket. `hold()` keeps server messages back until `release()` (latency).
 */
export class MemoryLink implements ServerLink {
  private session: Session | null;
  private holding = false;
  private held: ServerMessage[] = [];
  private readonly handlers: LinkHandlers;

  constructor(app: ServerApp, handlers: LinkHandlers) {
    this.handlers = handlers;
    this.session = app.connect({ send: (m) => this.arrive(m), close: () => this.drop() });
    queueMicrotask(() => {
      if (this.session !== null) handlers.open();
    });
  }

  send(msg: ClientMessage): void {
    this.session?.receive(JSON.stringify(msg));
  }

  close(): void {
    this.drop();
  }

  hold(): void {
    this.holding = true;
  }

  release(): void {
    this.holding = false;
    for (const m of this.held.splice(0)) this.handlers.message(m);
  }

  /** The connection drops: held and queued messages are lost. */
  drop(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.held = [];
    session.close();
    this.handlers.close();
  }

  private arrive(m: ServerMessage): void {
    const parsed = parseServerMessage(JSON.stringify(m));
    if (!parsed.ok) throw new Error(`server sent an unparsable message: ${parsed.error}`);
    queueMicrotask(() => {
      if (this.session === null) return;
      if (this.holding) this.held.push(parsed.value);
      else this.handlers.message(parsed.value);
    });
  }
}

/** The real server app (in-memory repository, domain validator) and the sessions connected to it. */
export class TestServer {
  readonly app: ServerApp;
  readonly fatal: unknown[] = [];

  constructor() {
    this.app = createServerApp({ repository: createInMemoryRepository(), validator: domainValidator, onFatal: (e) => void this.fatal.push(e) });
  }

  /** A headless editor session named `name`, as the MCP server runs it, over a memory link. */
  join(name: string, timeoutMs = 2000): { session: EditorSession; link: MemoryLink } {
    const links: MemoryLink[] = [];
    const session = new EditorSession({
      clientId: name.toLowerCase(),
      name,
      host: createNodeHost(),
      timeoutMs,
      connect: (handlers) => {
        const link = new MemoryLink(this.app, handlers);
        links.push(link);
        return link;
      },
    });
    const link = links[0];
    if (link === undefined) throw new Error("connect was not called");
    return { session, link };
  }

  /** Lets the server finish queued work and every link deliver. */
  async settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await this.app.idle();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
```

- [x] **Step 2: Write the failing test** `packages/mcp/test/session.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES, rectangleRoom, type Command } from "@fm/domain";
import { CONNECTION_DROPPED, NO_ANSWER, NO_DRAWING, type EditorSession } from "../src/session";
import { TestServer } from "./harness";

const wall = (opId: string, from: { x: number; y: number }, to: { x: number; y: number }): Command =>
  ({ type: "addWall", opId, from: { at: from }, to: { at: to } });

function wallCount(s: EditorSession): number {
  return Object.keys(s.drawing()?.walls ?? {}).length;
}

function cornerId(s: EditorSession, x: number, y: number): string {
  const j = Object.values(s.drawing()?.joints ?? {}).find((p) => p.x === x && p.y === y);
  if (!j) throw new Error(`no joint at ${x},${y}`);
  return j.id;
}

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function join(server: TestServer, name: string, timeoutMs?: number) {
  const r = server.join(name, timeoutMs);
  sessions.push(r.session);
  return r;
}

describe("EditorSession against the real server app (spec §12)", () => {
  it("lists, creates and opens projects; listing leaves the drawing", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    expect(await session.listProjects()).toEqual({ ok: true, value: [] });
    const created = await session.createProject("Apartment");
    expect(created).toMatchObject({ ok: true, value: { name: "Apartment", status: "saved" } });
    expect(session.drawing()).toEqual({ joints: {}, walls: {}, zoneLabels: {} });
    const listed = await session.listProjects();
    expect(listed.ok && listed.value.map((p) => p.name)).toEqual(["Apartment"]);
    expect(session.drawing()).toBeNull();
    const id = created.ok ? created.value.id : "";
    expect(await session.openProject(id)).toMatchObject({ ok: true, value: { id, name: "Apartment" } });
  });

  it("refuses an edit with no project open", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    expect(await session.edit(wall("w", { x: 0, y: 0 }, { x: 1, y: 0 }))).toEqual({ ok: false, error: NO_DRAWING });
  });

  it("reports an unknown project with the server's openFailed message", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    expect(await session.openProject("no-such-project")).toEqual({ ok: false, error: "Unknown project" });
  });

  it("resolves an accepted edit after the server's ack; another client sees it", async () => {
    const server = new TestServer();
    const claude = join(server, "Claude").session;
    const alice = join(server, "Alice").session;
    const created = await claude.createProject("Apartment");
    if (!created.ok) throw new Error(created.error);
    expect((await alice.openProject(created.value.id)).ok).toBe(true);
    expect(await claude.edit(wall("w", { x: 0, y: 0 }, { x: 4, y: 0 }))).toEqual({ ok: true, value: null });
    expect(claude.project()?.status).toBe("saved");
    await server.settle();
    expect(wallCount(alice)).toBe(1);
  });

  it("returns the editor's refusal text and submits nothing", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    await session.createProject("Apartment");
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 3, "room")) expect((await session.edit(cmd)).ok).toBe(true);
    const r = await session.edit(wall("x", { x: 2, y: -1 }, { x: 2, y: 1 }));
    expect(r).toEqual({ ok: false, error: MESSAGES.crossing });
    expect(wallCount(session)).toBe(4);
  });

  it("returns the server's rejection text when another client changed the joint first", async () => {
    const server = new TestServer();
    const claude = join(server, "Claude");
    const alice = join(server, "Alice").session;
    const created = await claude.session.createProject("Apartment");
    if (!created.ok) throw new Error(created.error);
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 3, "room")) await claude.session.edit(cmd);
    await alice.openProject(created.value.id);
    const corner = cornerId(claude.session, 4, 3);
    claude.link.hold(); // Claude does not see Alice's move before its own
    expect((await alice.edit({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 4, y: 3.5 } }] })).ok).toBe(true);
    const pending = claude.session.edit({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 4.5, y: 3 } }] });
    await server.settle();
    claude.link.release();
    expect(await pending).toEqual({ ok: false, error: "Someone else changed this first" });
  });

  it("runs parallel calls one at a time, each after the previous settled", async () => {
    const server = new TestServer();
    const { session } = join(server, "Claude");
    await session.createProject("Apartment");
    const results = await Promise.all(rectangleRoom({ x: 0, y: 0 }, 4, 3, "room").map((cmd) => session.edit(cmd)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(wallCount(session)).toBe(4);
  });

  it("returns CONNECTION_DROPPED when the connection drops before the answer", async () => {
    const server = new TestServer();
    const { session, link } = join(server, "Claude");
    await session.createProject("Apartment");
    link.hold();
    const pending = session.edit(wall("w", { x: 0, y: 0 }, { x: 4, y: 0 }));
    await server.settle();
    link.drop();
    expect(await pending).toEqual({ ok: false, error: CONNECTION_DROPPED });
  });

  it("returns NO_ANSWER when the server does not answer in time", async () => {
    const server = new TestServer();
    const { session, link } = join(server, "Claude", 100);
    await session.createProject("Apartment");
    link.hold();
    expect(await session.edit(wall("w", { x: 0, y: 0 }, { x: 4, y: 0 }))).toEqual({ ok: false, error: NO_ANSWER });
  });
});
```

Run: `pnpm --filter @fm/mcp test session` → FAIL, `Failed to resolve import "../src/session"`.

- [x] **Step 3: Implement** `packages/mcp/src/session.ts`

```ts
import type { Command, Document } from "@fm/domain";
import {
  buildViewModel, clientMessageFor, hasPendingEdit, initialState, serverMessageEvent, update, visibleDoc,
  type DocumentStatus, type EditorState, type Effect, type Event, type Host, type ServerEffect,
} from "@fm/editor";
import { err, ok, type ClientMessage, type ProjectMeta, type Result, type ServerMessage } from "@fm/protocol";

// The MCP shell's editor session (spec §12): one headless editor connected to the collaboration server as a
// normal client. State changes only through `update`; server effects go to the link, server messages come back as
// events. Each operation waits for the outcome the editor reports, so a tool call returns a settled result.

/** Handlers are never called synchronously from `connect`. */
export type LinkHandlers = { open(): void; message(msg: ServerMessage): void; close(): void };
/** `send` drops messages while the link is closed, like a closed socket; the editor resyncs after reconnecting. */
export type ServerLink = { send(msg: ClientMessage): void; close(): void };
export type Connect = (handlers: LinkHandlers) => ServerLink;

export type SessionOptions = { clientId: string; name: string; host: Host; connect: Connect; timeoutMs?: number };
export type OpenProject = { id: string; name: string; status: DocumentStatus };

export const DEFAULT_TIMEOUT_MS = 10_000;
export const NOT_CONNECTED = "Not connected to the Flatmate server: start it with `pnpm dev:server`";
export const NO_DRAWING = "No project is open: call open_project or create_project first";
export const CONNECTION_DROPPED =
  "The connection to the server dropped before it answered. A submitted edit settles after reconnecting; call get_drawing to check";
export const NO_ANSWER = "The server did not answer in time. A submitted edit settles when it does; call get_drawing to check";

const VIEWPORT = { width: 1200, height: 800 };

type Probe<T> = (msg: ServerMessage | null) => T | null;
type SubmitEffect = Extract<Effect, { type: "submit" }>;

function isServerEffect(e: Effect): e is ServerEffect {
  return e.type === "workspace" || e.type === "submit" || e.type === "presence";
}

function isSubmit(e: Effect): e is SubmitEffect {
  return e.type === "submit";
}

export class EditorSession {
  private state: EditorState;
  private readonly host: Host;
  private readonly clientId: string;
  private readonly name: string;
  private readonly timeoutMs: number;
  private readonly link: ServerLink;
  private connected = false;
  private readonly waiters = new Set<(msg: ServerMessage | null) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: SessionOptions) {
    this.host = opts.host;
    this.clientId = opts.clientId;
    this.name = opts.name;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.state = initialState({ mode: "server", me: { clientId: opts.clientId, name: opts.name }, viewport: VIEWPORT, dpr: 1 }, opts.host);
    this.link = opts.connect({
      open: () => this.onOpen(),
      message: (msg) => this.dispatch(serverMessageEvent(msg), msg),
      close: () => this.onClose(),
    });
  }

  newId(): string {
    return this.host.newId();
  }

  /** The drawing as the editor shows it (confirmed plus any pending edit), or null with no project open. */
  drawing(): Document | null {
    return this.state.document ? visibleDoc(this.state.document) : null;
  }

  project(): OpenProject | null {
    const d = this.state.document;
    const view = buildViewModel(this.state, this.host).project;
    return d && view ? { id: d.project.id, name: d.project.name, status: view.status } : null;
  }

  /** Goes to the project list, like the web app's project list button: leaves the open drawing. */
  listProjects(): Promise<Result<ProjectMeta[], string>> {
    return this.serial(async () => {
      if (!(await this.ready())) return err(NOT_CONNECTED);
      const refused = this.toastOf(() => this.dispatch({ type: "ui", action: { type: "showProjectList" } }, null));
      if (refused !== null) return err(refused);
      return this.waitFor<Result<ProjectMeta[], string>>(() => {
        const w = this.state.workspace;
        if (w.loading) return this.connected ? null : err(NOT_CONNECTED);
        return w.error !== null ? err(w.error) : ok(w.projects);
      }, err(NO_ANSWER));
    });
  }

  /** Creates a project and opens it. */
  createProject(name: string): Promise<Result<OpenProject, string>> {
    return this.serial(async () => {
      if (!(await this.ready())) return err(NOT_CONNECTED);
      let effects: Effect[] = [];
      const refused = this.toastOf(() => {
        effects = this.dispatch({ type: "ui", action: { type: "createProject", name } }, null);
      });
      if (refused !== null) return err(refused);
      const requestId = effects.flatMap((e) => (e.type === "workspace" && e.op.type === "create" ? [e.op.requestId] : []))[0];
      if (requestId === undefined) return err("The editor did not ask the server to create the project");
      const created = await this.waitFor<Result<ProjectMeta, string>>((msg) => {
        if (msg?.type === "projectCreated" && msg.requestId === requestId) return ok(msg.meta);
        if (msg?.type === "error" && msg.requestId === requestId) return err(msg.message);
        return this.connected ? null : err(CONNECTION_DROPPED);
      }, err(NO_ANSWER));
      return created.ok ? this.openNow(created.value.id) : created;
    });
  }

  openProject(projectId: string): Promise<Result<OpenProject, string>> {
    return this.serial(async () => {
      if (!(await this.ready())) return err(NOT_CONNECTED);
      return this.openNow(projectId);
    });
  }

  /**
   * One domain command through the editor's commit path. Resolves when the outcome is known: accepted by the
   * server (or nothing to change), refused by the editor (the toast text), or rejected by the server (the toast
   * text); or when the connection drops or the server does not answer in time.
   */
  edit(command: Command): Promise<Result<null, string>> {
    return this.serial(async () => {
      if (this.state.document === null) return err(NO_DRAWING);
      let effects: Effect[] = [];
      const refused = this.toastOf(() => {
        effects = this.dispatch({ type: "command", command }, null);
      });
      const submit = effects.find(isSubmit);
      if (submit === undefined) return refused === null ? ok(null) : err(refused);
      const id = submit.changeset.id;
      return this.waitFor<Result<null, string>>((msg) => {
        const d = this.state.document;
        if (d !== null && hasPendingEdit(d)) return this.connected ? null : err(CONNECTION_DROPPED);
        if (msg?.type === "rejected" && msg.changesetId === id) return err(this.state.toast?.text ?? "The server rejected the edit");
        return ok(null);
      }, err(NO_ANSWER));
    });
  }

  close(): void {
    this.link.close();
  }

  private onOpen(): void {
    this.connected = true;
    this.link.send({ type: "hello", clientId: this.clientId, name: this.name });
    this.dispatch({ type: "serverEvent", event: { type: "connection", state: "open" } }, null);
  }

  private onClose(): void {
    this.connected = false;
    this.dispatch({ type: "serverEvent", event: { type: "connection", state: "closed" } }, null);
  }

  /** The only place the session changes editor state (spec §5.1). */
  private dispatch(event: Event, cause: ServerMessage | null): Effect[] {
    const r = update(this.state, event, this.host);
    this.state = r.state;
    for (const e of r.effects) if (isServerEffect(e)) this.link.send(clientMessageFor(e));
    for (const w of [...this.waiters]) w(cause);
    return r.effects;
  }

  /** Runs `act`; returns the text of a toast it raised (a refusal or an error), or null. */
  private toastOf(act: () => void): string | null {
    const before = this.state.toast;
    act();
    const after = this.state.toast;
    return after !== null && after !== before ? after.text : null;
  }

  private async openNow(projectId: string): Promise<Result<OpenProject, string>> {
    const current = this.project();
    if (current !== null && current.id === projectId && this.state.workspace.opening === null) return ok(current); // open and live
    if (this.state.workspace.opening?.projectId !== projectId) {
      const refused = this.toastOf(() => this.dispatch({ type: "ui", action: { type: "openProject", id: projectId } }, null));
      if (refused !== null) return err(refused);
    }
    const generation = this.state.workspace.opening?.generation;
    if (generation === undefined) return err("The editor did not start opening the project");
    return this.waitFor<Result<OpenProject, string>>((msg) => {
      const project = this.project();
      if (project !== null && project.id === projectId && this.state.workspace.opening === null) return ok(project);
      if (msg?.type === "openFailed" && msg.generation === generation) return err(msg.message);
      return this.connected ? null : err(CONNECTION_DROPPED);
    }, err(NO_ANSWER));
  }

  /** Waits for the connection: at startup the socket may still be opening. */
  private ready(): Promise<boolean> {
    return this.waitFor<boolean>(() => (this.connected ? true : null), false);
  }

  /** Resolves with the first non-null probe result, checked now and after every dispatch; `onTimeout` after the timeout. */
  private waitFor<T>(probe: Probe<T>, onTimeout: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const finish = (value: T): void => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(value);
      };
      const check = (msg: ServerMessage | null): void => {
        const value = probe(msg);
        if (value !== null) finish(value);
      };
      const timer = setTimeout(() => finish(onTimeout), this.timeoutMs);
      this.waiters.add(check);
      check(null);
    });
  }

  /** Tool calls run one at a time, in arrival order: each sees the settled outcome of the one before. */
  private serial<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
```

Notes for the implementer and Review B:

- Reads of `EditorState` (`toast`, `workspace`, `document.project`) are reads, as in sync-tests; every change goes through `dispatch` → `update`.
- A local refusal is a toast raised by the dispatch itself (`toastOf` compares the toast object; `showToast` always makes a new one). With no submit and no new toast, the command changed nothing: `ok`.
- A `rejected` message counts only once the editor has cleared the edit (`hasPendingEdit` false), so a stale-generation rejection the editor ignored cannot settle the wait.

Run: `pnpm --filter @fm/mcp test session` → 9 passed.

- [x] **Step 4: Mutation checks (lesson 25), each restored after** — (a) in `edit`, return `ok(null)` for any settled edit (drop the `rejected` line): the rejection test goes red; (b) in `serial`, return `op()` directly: the parallel-calls test goes red (the second wall is refused with "Waiting for server").

- [x] **Step 5: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp/src/session.ts packages/mcp/test/harness.ts packages/mcp/test/session.test.ts
git commit -m "mcp: editor session that drives the headless editor against the server and waits for outcomes (M1)"
```

---

## Task M1.6: Tool handlers (wave 3, Review B) — size M

**Files:** create `packages/mcp/src/tools.ts`, `packages/mcp/test/tools.test.ts`

U4, P-M3. Each handler takes validated input (M1.4) and returns `{ text, isError }`: the drawing summary on success, the reason otherwise. `draw_room` checks its four `addWall` commands together with `execute` before submitting any; the IDs come from the session's host (UUIDs), and `rectangleRoom`'s prefix is a fresh ID so it is never already used.

- [x] **Step 1: Write the failing test** `packages/mcp/test/tools.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import type { DrawingSummary } from "../src/drawing";
import { NO_DRAWING, type EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

function summary(r: Reply): DrawingSummary {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function setup(): Promise<{ server: TestServer; tools: DrawingTools; alice: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = createTools(claude);
  const created = summary(await tools.createProject({ name: "Apartment" }));
  expect((await alice.openProject(created.project.id)).ok).toBe(true);
  return { server, tools, alice };
}

describe("tool handlers against the real server app (spec §12)", () => {
  it("needs an open project before reading or editing", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = createTools(claude);
    expect(await tools.getDrawing()).toEqual({ text: NO_DRAWING, isError: true });
    expect(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 })).toEqual({ text: NO_DRAWING, isError: true });
    expect(JSON.parse((await tools.listProjects()).text)).toEqual({ projects: [] });
  });

  it("create_project opens an empty drawing; list_projects lists it", async () => {
    const { tools } = await setup();
    const s = summary(await tools.getDrawing());
    expect(s).toMatchObject({ project: { name: "Apartment", status: "saved" }, walls: [], rooms: [] });
    expect(JSON.parse((await tools.listProjects()).text).projects.map((p: { name: string }) => p.name)).toEqual(["Apartment"]);
  });

  it("draw_room draws four walls as four accepted edits; another client sees the room", async () => {
    const { server, tools, alice } = await setup();
    const s = summary(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }));
    expect(s.walls).toHaveLength(4);
    expect(s.rooms.map((r) => r.area)).toEqual([10.64]);
    await server.settle();
    expect(Object.keys(alice.drawing()?.walls ?? {})).toHaveLength(4);
  });

  it("draw_room against an existing wall submits nothing and says why", async () => {
    const { tools } = await setup();
    await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 });
    const r = await tools.drawRoom({ x: 4, y: 0, width: 2, height: 3 });
    expect(r).toEqual({ text: `${MESSAGES.overlap}: nothing was drawn`, isError: true });
    expect(summary(await tools.getDrawing()).walls).toHaveLength(4);
  });

  it("add_wall splits the room; label_room and rename_room name the new room", async () => {
    const { tools } = await setup();
    await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 });
    const split = summary(await tools.addWall({ a: { x: 2.5, y: 0 }, b: { x: 2.5, y: 3 } }));
    expect(split.rooms).toHaveLength(2);
    const labelled = summary(await tools.labelRoom({ point: { x: 3.25, y: 1.5 }, name: "Bathroom" }));
    const label = labelled.rooms.flatMap((r) => r.labels).find((l) => l.name === "Bathroom");
    expect(label).toBeDefined();
    const renamed = summary(await tools.renameRoom({ label: label?.id ?? "", name: "Bath" }));
    expect(renamed.rooms.flatMap((r) => r.labels.map((l) => l.name))).toEqual(["Bath"]);
  });

  it("set_wall_length keeps endpoint a; move_joint returns the refusal text for a crossing", async () => {
    const { tools } = await setup();
    const room = summary(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }));
    const right = room.walls.find((w) => w.from[0] === 4 && w.to[0] === 4);
    if (!right) throw new Error("no right wall");
    const resized = summary(await tools.setWallLength({ wall: right.id, length: 2.5 }));
    const after = resized.walls.find((w) => w.id === right.id);
    expect(after?.from).toEqual(right.from);
    expect(after?.length).toBe(2.5);
    const corner = resized.joints.find((j) => j.id === right.b);
    const r = await tools.moveJoint({ joint: corner?.id ?? "", to: { x: -1, y: 1.5 } });
    expect(r).toEqual({ text: MESSAGES.crossing, isError: true });
  });

  it("delete removes walls by id and refuses an unknown id", async () => {
    const { tools } = await setup();
    const room = summary(await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 }));
    const first = room.walls[0]?.id ?? "";
    expect(await tools.delete({ ids: ["nope"] })).toEqual({ text: "No wall, joint or room label has the id nope", isError: true });
    const s = summary(await tools.delete({ ids: [first] }));
    expect(s.walls.map((w) => w.id)).not.toContain(first);
    expect(s.rooms).toEqual([]);
  });
});
```

Run: `pnpm --filter @fm/mcp test tools` → FAIL, `Failed to resolve import "../src/tools"`.

- [x] **Step 2: Implement** `packages/mcp/src/tools.ts`

```ts
import { execute, rectangleRoom, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point, Result } from "@fm/protocol";
import { summarize } from "./drawing";
import { NO_DRAWING, type EditorSession, type OpenProject } from "./session";

// Tool handlers: validated inputs in (schemas.ts), a short text out. Every editing tool is one domain command through
// the session, except draw_room (four walls, checked together first).

export type Reply = { text: string; isError: boolean };

export type DrawingTools = {
  listProjects(): Promise<Reply>;
  createProject(args: { name: string }): Promise<Reply>;
  openProject(args: { id: string }): Promise<Reply>;
  getDrawing(): Promise<Reply>;
  drawRoom(args: { x: number; y: number; width: number; height: number }): Promise<Reply>;
  addWall(args: { a: Point; b: Point }): Promise<Reply>;
  setWallLength(args: { wall: string; length: number }): Promise<Reply>;
  moveJoint(args: { joint: string; to: Point }): Promise<Reply>;
  labelRoom(args: { point: Point; name: string }): Promise<Reply>;
  renameRoom(args: { label: string; name: string }): Promise<Reply>;
  delete(args: { ids: string[] }): Promise<Reply>;
};

const fail = (text: string): Reply => ({ text, isError: true });

/** The first domain error the commands would raise on `doc`, in order, or null. */
function firstError(doc: Document, commands: Command[]): string | null {
  let d = doc;
  for (const cmd of commands) {
    const r = execute(d, cmd);
    if (!r.ok) return r.error.message;
    d = r.value.doc;
  }
  return null;
}

function tableOf(doc: Document, id: string): EntityRef["table"] | null {
  if (Object.hasOwn(doc.walls, id)) return "walls";
  if (Object.hasOwn(doc.joints, id)) return "joints";
  if (Object.hasOwn(doc.zoneLabels, id)) return "zoneLabels";
  return null;
}

export function createTools(session: EditorSession): DrawingTools {
  function drawingReply(): Reply {
    const project = session.project();
    const doc = session.drawing();
    if (project === null || doc === null) return fail(NO_DRAWING);
    return { text: JSON.stringify(summarize(project, doc)), isError: false };
  }

  function opened(r: Result<OpenProject, string>): Reply {
    return r.ok ? drawingReply() : fail(r.error);
  }

  async function edit(command: Command): Promise<Reply> {
    const r = await session.edit(command);
    return r.ok ? drawingReply() : fail(r.error);
  }

  return {
    async listProjects() {
      const r = await session.listProjects();
      return r.ok ? { text: JSON.stringify({ projects: r.value }), isError: false } : fail(r.error);
    },
    async createProject({ name }) {
      return opened(await session.createProject(name));
    },
    async openProject({ id }) {
      return opened(await session.openProject(id));
    },
    async getDrawing() {
      return drawingReply();
    },
    async drawRoom({ x, y, width, height }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const walls = rectangleRoom({ x, y }, width, height, session.newId());
      const error = firstError(doc, walls);
      if (error !== null) return fail(`${error}: nothing was drawn`);
      for (const [i, wall] of walls.entries()) {
        const r = await session.edit(wall);
        if (!r.ok) return fail(i === 0 ? r.error : `${r.error} (after ${i} of 4 walls: the room is not closed)`);
      }
      return drawingReply();
    },
    async addWall({ a, b }) {
      return edit({ type: "addWall", opId: session.newId(), from: { at: a }, to: { at: b } });
    },
    async setWallLength({ wall, length }) {
      return edit({ type: "setWallLength", wallId: wall, length, keep: "a" });
    },
    async moveJoint({ joint, to }) {
      return edit({ type: "moveJoints", moves: [{ jointId: joint, to }] });
    },
    async labelRoom({ point, name }) {
      return edit({ type: "labelZone", id: session.newId(), at: point, name });
    },
    async renameRoom({ label, name }) {
      return edit({ type: "renameZone", id: label, name });
    },
    async delete({ ids }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const refs: EntityRef[] = [];
      for (const id of ids) {
        const table = tableOf(doc, id);
        if (table === null) return fail(`No wall, joint or room label has the id ${id}`);
        refs.push({ table, id });
      }
      return edit({ type: "deleteEntities", ids: refs });
    },
  };
}
```

Run: `pnpm --filter @fm/mcp test tools` → 7 passed.

- [x] **Step 3: Mutation check** — make `drawRoom` skip `firstError`: "draw_room against an existing wall" goes red (three walls are drawn before "Walls can't overlap"); restore.

- [x] **Step 4: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp/src/tools.ts packages/mcp/test/tools.test.ts
git commit -m "mcp: tool handlers for projects, drawing summary and domain edits (M1)"
```

**Review B** runs now, over the diffs of M1.4, M1.5 and M1.6.

---

## Task M1.7: The MCP server (wave 4) — size S

**Files:** create `packages/mcp/src/server.ts`, `packages/mcp/test/server.test.ts`

SDK 1.31.0 API, checked against `dist/esm/server/mcp.d.ts`: `new McpServer({ name, version }, { instructions })`; `registerTool(name, { description, inputSchema }, cb)` where `inputSchema` is a zod raw shape and `cb(args, extra)` returns a `CallToolResult`; a tool without `inputSchema` gets `cb(extra)`. Invalid arguments come back to the client as `isError: true` with `MCP error -32602: Input validation error: … at width` and the handler does not run. Tests connect an SDK `Client` over `InMemoryTransport.createLinkedPair()` (no stdio).

- [x] **Step 1: Write the failing test** `packages/mcp/test/server.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, TOOL_NAMES } from "../src/server";
import type { EditorSession } from "../src/session";
import { createTools } from "../src/tools";
import { TestServer } from "./harness";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** An MCP client connected in memory to the MCP server of a session on the real server app. */
async function connect(): Promise<{ client: Client; session: EditorSession }> {
  const session = new TestServer().join("Claude").session;
  const mcp = createMcpServer(createTools(session));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
    session.close();
  });
  return { client, session };
}

function textOf(r: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = Array.isArray(r.content) ? r.content : [];
  const first: unknown = content[0];
  return typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
}

describe("the MCP server (in memory, no stdio)", () => {
  it("lists the eleven tools with their input schemas", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const drawRoom = tools.find((t) => t.name === "draw_room");
    expect(Object.keys(drawRoom?.inputSchema.properties ?? {})).toEqual(["x", "y", "width", "height"]);
  });

  it("calls a tool end to end: create_project, then draw_room", async () => {
    const { client } = await connect();
    expect((await client.callTool({ name: "create_project", arguments: { name: "Apartment" } })).isError).toBe(false);
    const r = await client.callTool({ name: "draw_room", arguments: { x: 0, y: 0, width: 4, height: 3 } });
    expect(r.isError).toBe(false);
    expect(JSON.parse(textOf(r)).rooms[0].area).toBe(10.64);
  });

  it("refuses invalid input before the handler runs", async () => {
    const { client, session } = await connect();
    await client.callTool({ name: "create_project", arguments: { name: "Apartment" } });
    const r = await client.callTool({ name: "draw_room", arguments: { x: 0, y: 0, width: -4, height: 3 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("width");
    expect(Object.keys(session.drawing()?.walls ?? {})).toEqual([]);
  });
});
```

Run: `pnpm --filter @fm/mcp test server` → FAIL, `Failed to resolve import "../src/server"`.

- [x] **Step 2: Implement** `packages/mcp/src/server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SCHEMAS } from "./schemas";
import type { DrawingTools, Reply } from "./tools";

// The MCP surface: tool names, descriptions and input schemas. Behaviour lives in tools.ts and session.ts.

export const TOOL_NAMES = [
  "list_projects", "create_project", "open_project", "get_drawing", "draw_room", "add_wall", "set_wall_length",
  "move_joint", "label_room", "rename_room", "delete",
] as const;

const INSTRUCTIONS =
  "Flatmate is a collaborative 2D floor-plan editor. Coordinates are metres with y pointing up; walls are 0.20 m " +
  "thick and joined at shared joints. Open or create a project first, then read it with get_drawing. Each edit is " +
  "checked like a person's edit: walls can't cross or overlap, and one edit is saved at a time. A failed edit returns " +
  "the reason; nothing changes.";

function result(r: Reply): CallToolResult {
  return { content: [{ type: "text", text: r.text }], isError: r.isError };
}

export function createMcpServer(tools: DrawingTools): McpServer {
  const server = new McpServer({ name: "flatmate", version: "0.0.0" }, { instructions: INSTRUCTIONS });
  server.registerTool(
    "list_projects",
    { description: "List the projects on the server. Leaves the open drawing, like the project list in the web app." },
    async () => result(await tools.listProjects()),
  );
  server.registerTool(
    "create_project",
    { description: "Create a project and open it. Returns the (empty) drawing.", inputSchema: SCHEMAS.create_project },
    async (args) => result(await tools.createProject(args)),
  );
  server.registerTool(
    "open_project",
    { description: "Open a project by id and return its drawing.", inputSchema: SCHEMAS.open_project },
    async (args) => result(await tools.openProject(args)),
  );
  server.registerTool(
    "get_drawing",
    { description: "The open drawing: walls (ids, joint ids, endpoints, lengths), joints, rooms (labels, clear areas in m², outlines) and unplaced labels." },
    async () => result(await tools.getDrawing()),
  );
  server.registerTool(
    "draw_room",
    {
      description:
        "Draw a free-standing rectangular room: four walls from corner (x, y), width along x, height along y. A side on " +
        "an existing wall is refused (walls can't overlap); to extend a room, use add_wall for the new sides.",
      inputSchema: SCHEMAS.draw_room,
    },
    async (args) => result(await tools.drawRoom(args)),
  );
  server.registerTool(
    "add_wall",
    {
      description:
        "Add a straight wall from a to b. An end on a joint connects to it; an end on a wall splits it (T-junction). " +
        "A wall crossing another wall is refused.",
      inputSchema: SCHEMAS.add_wall,
    },
    async (args) => result(await tools.addWall(args)),
  );
  server.registerTool(
    "set_wall_length",
    { description: "Set a wall's length; its joint a stays, joint b moves along the wall and connected walls follow.", inputSchema: SCHEMAS.set_wall_length },
    async (args) => result(await tools.setWallLength(args)),
  );
  server.registerTool(
    "move_joint",
    { description: "Move a joint (a wall end or corner) to a point; its walls follow.", inputSchema: SCHEMAS.move_joint },
    async (args) => result(await tools.moveJoint(args)),
  );
  server.registerTool(
    "label_room",
    { description: "Name the closed room containing the point. A room holds one label.", inputSchema: SCHEMAS.label_room },
    async (args) => result(await tools.labelRoom(args)),
  );
  server.registerTool(
    "rename_room",
    { description: "Rename a room label (label ids are in get_drawing's rooms).", inputSchema: SCHEMAS.rename_room },
    async (args) => result(await tools.renameRoom(args)),
  );
  server.registerTool(
    "delete",
    { description: "Delete walls, joints (with their walls) or room labels by id, as one edit.", inputSchema: SCHEMAS.delete },
    async (args) => result(await tools.delete(args)),
  );
  return server;
}
```

Run: `pnpm --filter @fm/mcp test server` → 3 passed.

- [x] **Step 3: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp/src/server.ts packages/mcp/test/server.test.ts
git commit -m "mcp: MCP server with eleven tools and zod input schemas (M1)"
```

---

## Task M1.8: WebSocket link, entry point and stdio end-to-end test (wave 5) — size M

**Files:** create `packages/mcp/src/ws-link.ts`, `packages/mcp/src/main.ts`, `packages/mcp/test/stdio.e2e.test.ts`

P-M8, P-M9, P-M10. The link mirrors the web adapter (`packages/web/src/adapters/ws-server.ts`): it parses every frame with `parseServerMessage`, reports `open`/`close`, and reconnects with backoff; the editor reopens the project on `connection open`. `main.ts` is the composition root; it never writes to stdout.

- [x] **Step 1: Write the failing test** `packages/mcp/test/stdio.e2e.test.ts`

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The whole path as Claude Code runs it: the MCP server as a child process over stdio, connected to a real
// collaboration server process (packages/server/src/main.ts) on a random port with a temporary data directory.

const MCP_DIR = fileURLToPath(new URL("..", import.meta.url));
const SERVER_DIR = fileURLToPath(new URL("../../server", import.meta.url));

let server: ChildProcess | null = null;
let dataDir = "";
let url = "";

/** Starts the collaboration server on port 0 and reads the port it prints. */
function startServer(): Promise<string> {
  dataDir = mkdtempSync(join(tmpdir(), "fm-mcp-e2e-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: "0", DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server = child;
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const m = /listening on (ws:\/\/localhost:\d+)/.exec(out);
      if (m?.[1]) resolve(m[1]);
    });
    child.once("exit", (code) => reject(new Error(`server exited with ${code}: ${out}`)));
  });
}

beforeAll(async () => {
  url = await startServer();
}, 20_000);

afterAll(() => {
  server?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the MCP server over stdio against a real server process", () => {
  it("creates a project, draws a room and reads it back", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/main.ts"],
      cwd: MCP_DIR,
      env: { ...getDefaultEnvironment(), FM_SERVER_URL: url },
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(transport);
    try {
      expect((await client.callTool({ name: "create_project", arguments: { name: "E2E" } })).isError).toBe(false);
      expect((await client.callTool({ name: "draw_room", arguments: { x: 0, y: 0, width: 4, height: 3 } })).isError).toBe(false);
      const r = await client.callTool({ name: "get_drawing", arguments: {} });
      const content = Array.isArray(r.content) ? r.content : [];
      const first: unknown = content[0];
      const text = typeof first === "object" && first !== null && "text" in first && typeof first.text === "string" ? first.text : "";
      expect(JSON.parse(text)).toMatchObject({ project: { name: "E2E", status: "saved" }, rooms: [{ area: 10.64 }] });
    } finally {
      await client.close();
    }
  }, 30_000);
});
```

Run: `pnpm --filter @fm/mcp test stdio`
Expected: FAIL — the child cannot load `src/main.ts` (it does not exist), so `client.connect` rejects (`MCP error -32000: Connection closed`). The server's `tsx` resolves from the root `node_modules` (root devDependency); the MCP child's from `packages/mcp/node_modules` (M1.2).

- [x] **Step 2: Implement** `packages/mcp/src/ws-link.ts`

```ts
import WebSocket, { type RawData } from "ws";
import { parseServerMessage } from "@fm/protocol";
import type { Connect } from "./session";

// The WebSocket adapter (spec §5.2, §7.2): moves text frames, parses what arrives, reconnects with backoff. Like the
// web adapter, it knows nothing about projects: the editor reopens the project when told the connection is open.

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

export function wsConnect(url: string): Connect {
  return (handlers) => {
    let socket: WebSocket | null = null;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function open(): void {
      const ws = new WebSocket(url);
      socket = ws;
      ws.on("open", () => {
        failures = 0;
        handlers.open();
      });
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) return;
        const parsed = parseServerMessage(toText(data));
        if (!parsed.ok) {
          console.error(`[fm-mcp] ignored a server message: ${parsed.error}`);
          return;
        }
        handlers.message(parsed.value);
      });
      ws.on("error", () => undefined); // "close" follows
      ws.on("close", () => {
        socket = null;
        if (stopped) return;
        handlers.close();
        const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 8000;
        failures += 1;
        retry = setTimeout(() => {
          retry = null;
          open();
        }, delay);
      });
    }

    open();
    return {
      send(msg) {
        if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
      },
      close() {
        stopped = true;
        if (retry !== null) clearTimeout(retry);
        socket?.close();
        socket = null;
      },
    };
  };
}

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
```

- [x] **Step 3: Implement** `packages/mcp/src/main.ts`

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNodeHost } from "./node-host";
import { createMcpServer } from "./server";
import { EditorSession } from "./session";
import { createTools } from "./tools";
import { wsConnect } from "./ws-link";

// Composition root. stdout carries the MCP protocol: log to stderr only.

const url = process.env.FM_SERVER_URL ?? "ws://localhost:8787";
const name = process.env.FM_NAME ?? "Claude";

const host = createNodeHost();
const session = new EditorSession({ clientId: host.newId(), name, host, connect: wsConnect(url) });
const server = createMcpServer(createTools(session));

// The client closing stdin ends the session; the reconnect timer would otherwise keep the process alive.
process.stdin.on("end", () => {
  session.close();
  void server.close().finally(() => process.exit(0));
});

await server.connect(new StdioServerTransport());
console.error(`[fm-mcp] ready on stdio as "${name}"; collaboration server ${url}`);
```

Run: `pnpm --filter @fm/mcp test stdio` → 1 passed (about 1 s).

- [x] **Step 4: Check stdout by hand** (P-M9)

```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}'; sleep 1) | FM_SERVER_URL=ws://localhost:1 pnpm --silent mcp 2>/dev/null | head -c 120
```

Expected: stdout starts with `{"result":{"protocolVersion":"2025-06-18"` and nothing before it; the process exits after stdin closes.

- [x] **Step 5: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp/src/ws-link.ts packages/mcp/src/main.ts packages/mcp/test/stdio.e2e.test.ts
git commit -m "mcp: WebSocket link, stdio entry point and an end-to-end test against a real server (M1)"
```

---

## Task M1.9: A "Claude" cursor at the last edit (wave 5, optional) — size S

**Files:** modify `packages/mcp/src/session.ts`, replace `packages/mcp/src/tools.ts`, modify `packages/mcp/test/tools.test.ts`

U2, spec §7.6. After an accepted edit the session sends one `pointerMove` through `update` at the edit's place; the editor emits the `presence` effect as for a mouse move, and the browsers draw Claude's cursor there. No new message or effect. Skip this task if wave 5 runs late; nothing else depends on it.

- [x] **Step 1: Write the failing test** — append to `packages/mcp/test/tools.test.ts`

```ts

describe("presence (spec §7.6)", () => {
  it("shows Claude's cursor to the other client where the last edit happened", async () => {
    const { server, tools, alice } = await setup();
    await tools.drawRoom({ x: 0, y: 0, width: 4, height: 3 });
    await server.settle();
    const claude = alice.collaborators().find((c) => c.name === "Claude");
    expect(claude?.at?.x).toBeCloseTo(2);
    expect(claude?.at?.y).toBeCloseTo(1.5);
    await tools.moveJoint({ joint: summary(await tools.getDrawing()).joints[0]?.id ?? "", to: { x: -0.5, y: 0 } });
    await server.settle();
    expect(alice.collaborators().find((c) => c.name === "Claude")?.at?.x).toBeCloseTo(-0.5);
  });
});
```

Run: `pnpm --filter @fm/mcp test tools` → FAIL, `alice.collaborators is not a function` (typecheck red too).

- [x] **Step 2: Session** — in `packages/mcp/src/session.ts`, widen the imports:

```ts
import {
  buildViewModel, clientMessageFor, hasPendingEdit, initialState, NO_MODS, serverMessageEvent, update, visibleDoc,
  worldToScreen, type DocumentStatus, type EditorState, type Effect, type Event, type Host, type ServerEffect,
} from "@fm/editor";
import { err, ok, type ClientMessage, type Point, type ProjectMeta, type Result, type ServerMessage } from "@fm/protocol";
```

and add before `close()`:

```ts
  /** Moves this client's cursor to a world point, so other windows show it there (presence, spec §7.6). */
  pointAt(p: Point): void {
    if (this.state.document === null) return;
    this.dispatch({ type: "pointerMove", screen: worldToScreen(this.state.camera, p), mods: NO_MODS, button: 0 }, null);
  }

  /** The other clients in the open project and where their cursors are. */
  collaborators(): { name: string; at: Point | null }[] {
    return buildViewModel(this.state, this.host).presence.map((p) => ({ name: p.name, at: p.at }));
  }
```

- [x] **Step 3: Tools** — replace `packages/mcp/src/tools.ts` with:

```ts
import { execute, rectangleRoom, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point, Result } from "@fm/protocol";
import { summarize } from "./drawing";
import { NO_DRAWING, type EditorSession, type OpenProject } from "./session";

// Tool handlers: validated inputs in (schemas.ts), a short text out. Every editing tool is one domain command through
// the session, except draw_room (four walls, checked together first). After an accepted edit, Claude's cursor moves
// to where it happened (presence).

export type Reply = { text: string; isError: boolean };

export type DrawingTools = {
  listProjects(): Promise<Reply>;
  createProject(args: { name: string }): Promise<Reply>;
  openProject(args: { id: string }): Promise<Reply>;
  getDrawing(): Promise<Reply>;
  drawRoom(args: { x: number; y: number; width: number; height: number }): Promise<Reply>;
  addWall(args: { a: Point; b: Point }): Promise<Reply>;
  setWallLength(args: { wall: string; length: number }): Promise<Reply>;
  moveJoint(args: { joint: string; to: Point }): Promise<Reply>;
  labelRoom(args: { point: Point; name: string }): Promise<Reply>;
  renameRoom(args: { label: string; name: string }): Promise<Reply>;
  delete(args: { ids: string[] }): Promise<Reply>;
};

const fail = (text: string): Reply => ({ text, isError: true });

/** The first domain error the commands would raise on `doc`, in order, or null. */
function firstError(doc: Document, commands: Command[]): string | null {
  let d = doc;
  for (const cmd of commands) {
    const r = execute(d, cmd);
    if (!r.ok) return r.error.message;
    d = r.value.doc;
  }
  return null;
}

function tableOf(doc: Document, id: string): EntityRef["table"] | null {
  if (Object.hasOwn(doc.walls, id)) return "walls";
  if (Object.hasOwn(doc.joints, id)) return "joints";
  if (Object.hasOwn(doc.zoneLabels, id)) return "zoneLabels";
  return null;
}

export function createTools(session: EditorSession): DrawingTools {
  function drawingReply(): Reply {
    const project = session.project();
    const doc = session.drawing();
    if (project === null || doc === null) return fail(NO_DRAWING);
    return { text: JSON.stringify(summarize(project, doc)), isError: false };
  }

  function opened(r: Result<OpenProject, string>): Reply {
    return r.ok ? drawingReply() : fail(r.error);
  }

  /** One command; on success the cursor moves to `near` (where the edit happened) and the drawing comes back. */
  async function edit(command: Command, near: () => Point | null): Promise<Reply> {
    const r = await session.edit(command);
    if (!r.ok) return fail(r.error);
    const p = near();
    if (p !== null) session.pointAt(p);
    return drawingReply();
  }

  function jointPoint(id: string): Point | null {
    const j = session.drawing()?.joints[id];
    return j ? { x: j.x, y: j.y } : null;
  }

  return {
    async listProjects() {
      const r = await session.listProjects();
      return r.ok ? { text: JSON.stringify({ projects: r.value }), isError: false } : fail(r.error);
    },
    async createProject({ name }) {
      return opened(await session.createProject(name));
    },
    async openProject({ id }) {
      return opened(await session.openProject(id));
    },
    async getDrawing() {
      return drawingReply();
    },
    async drawRoom({ x, y, width, height }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const walls = rectangleRoom({ x, y }, width, height, session.newId());
      const error = firstError(doc, walls);
      if (error !== null) return fail(`${error}: nothing was drawn`);
      for (const [i, wall] of walls.entries()) {
        const r = await session.edit(wall);
        if (!r.ok) return fail(i === 0 ? r.error : `${r.error} (after ${i} of 4 walls: the room is not closed)`);
      }
      session.pointAt({ x: x + width / 2, y: y + height / 2 });
      return drawingReply();
    },
    async addWall({ a, b }) {
      return edit({ type: "addWall", opId: session.newId(), from: { at: a }, to: { at: b } }, () => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
    },
    async setWallLength({ wall, length }) {
      const w = session.drawing()?.walls[wall];
      return edit({ type: "setWallLength", wallId: wall, length, keep: "a" }, () => (w ? jointPoint(w.b) : null));
    },
    async moveJoint({ joint, to }) {
      return edit({ type: "moveJoints", moves: [{ jointId: joint, to }] }, () => to);
    },
    async labelRoom({ point, name }) {
      return edit({ type: "labelZone", id: session.newId(), at: point, name }, () => point);
    },
    async renameRoom({ label, name }) {
      const at = session.drawing()?.zoneLabels[label]?.at ?? null;
      return edit({ type: "renameZone", id: label, name }, () => at);
    },
    async delete({ ids }) {
      const doc = session.drawing();
      if (doc === null) return fail(NO_DRAWING);
      const refs: EntityRef[] = [];
      for (const id of ids) {
        const table = tableOf(doc, id);
        if (table === null) return fail(`No wall, joint or room label has the id ${id}`);
        refs.push({ table, id });
      }
      return edit({ type: "deleteEntities", ids: refs }, () => null);
    },
  };
}
```

(`walls[wall]` and `zoneLabels[label]` are safe lookups: both IDs passed `isWireId`, which refuses `Object.prototype` names.)

Run: `pnpm --filter @fm/mcp test tools` → 8 passed.

- [x] **Step 4: Verify and commit**

Run: `pnpm check` → green.

```bash
git add packages/mcp/src/session.ts packages/mcp/src/tools.ts packages/mcp/test/tools.test.ts
git commit -m "mcp: Claude's cursor follows its last edit (presence, M1)"
```

---

## Task M1.9b: `add_walls`, many walls in one call (wave 5b, after M1.9) — size S

Added 2026-09-29 at the user's request ("generate a sort of maze as a demo"): with `add_wall` a 30-wall maze is 30 model turns. Design: spec §12.2 (row `add_walls`), §12.3 (one turn), §12.5 (bullet `add_walls`, presence); `mcp.md`. It reuses `draw_room`'s path (`EditorSession.editAll`), so the session gains no new logic beyond naming the refused command.

**Files:** `packages/mcp/src/schemas.ts`, `src/session.ts` (only `firstError` / `EditAllError`: the index of the refused command), `src/tools.ts`, `src/server.ts`, and their tests `test/schemas.test.ts`, `test/session.test.ts` (only if `EditAllError` changes shape), `test/tools.test.ts`, `test/server.test.ts`.

- [x] **Step 1: Schema.** `add_walls: { walls: z.array(z.object({ a: point, b: point })).min(1).max(MAX_WALLS) }` with `MAX_WALLS = 50`, the same `point` schema as `add_wall`. Tests: 0 and 51 walls refused; a wall with a non-finite or out-of-range coordinate refused; extra fields dropped.
- [x] **Step 2: Refused index.** `EditAllError` gains `at: number`, the position of the command the pre-check refused (−1 when not a pre-check refusal); `firstError` returns it. `draw_room`'s replies stay as they are.
- [x] **Step 3: Handler.** `addWalls({ walls })` builds one `addWall` per wall (`session.newId()` per opId, `from: { at: a }, to: { at: b }`), calls `session.editAll`, and replies:
  - ok → `session.pointAt(middle of the last wall)`, then the drawing summary;
  - pre-check refusal → `Wall <at + 1> of <n>: <reason>: nothing was drawn`;
  - stopped part-way → `<reason> (after <done> of <n> walls)`; `done === 0` → the reason alone.
- [x] **Step 4: Tests against the real server app** (`tools.test.ts`, existing harness):
  1. a 3 × 3 m square plus two inner walls forming a small maze (T-junctions on the square) in one call → another client sees every wall; the summary's wall count matches;
  2. a list whose third wall crosses the first → refused, "Wall 3 of 3", nothing submitted (the other client sees no new wall);
  3. `add_walls` in parallel with a crossing `add_wall` (`Promise.all`) → never a partial list: either all walls and the single wall refused, or the single wall first and the list refused with nothing drawn;
  4. the "Claude" cursor ends at the last wall's middle.
- [x] **Step 5: Server.** Register `add_walls` with its description (mention mazes and that walls sharing an endpoint connect) and schema; `server.test.ts` lists 12 tools and refuses an empty `walls` before the handler runs.
- [x] **Step 6:** `pnpm check`; commit `mcp: add_walls draws many walls in one call (M1)`.

---

## Task M1.10: README, rehearsal, spec and design memory (wave 6) — size M

**Files:** `README.md`, `docs/reports/demo-rehearsal.md`, `docs/specs/flatmate-design.md` (§11 marker; §12 only if the code differs), `docs/design-memory/mcp.md`, `docs/design-memory/INDEX.md`, `docs/design-memory/architecture.md`, `docs/design-memory/implementation.md`

No code. If M1.9 was cut, drop the sentences about Claude's cursor below.

(revised after M1.9b, 2026-09-29: twelve tools with `add_walls` in the README list; the Limits sentence states that both §11 follow-ups are implemented and covers `add_walls`; row 10a is a maze drawn with `add_walls`, numbered next to S1's row, now 10b, with the bathroom prompt as its fallback; spec §11 item 1's "Done (gate M1)." waits for the gate; §12 aligned with the code in four places, listed in the sprint log.)

- [x] **Step 1: README** — insert after "## The five-minute demo" (before "## Architecture"):

````markdown
## Use with Claude

`packages/mcp` is an MCP server: Claude edits the drawing as a third collaborator, through the same editor core and the same server rules as the browser windows. Start the demo first (`pnpm demo`); the MCP server connects to `ws://localhost:8787` as "Claude".

Claude Code, from the repository root:

```bash
claude mcp add flatmate -- pnpm --silent --dir "$PWD" mcp
```

Claude Desktop (`claude_desktop_config.json`; use the absolute path of `pnpm` from `which pnpm` if Claude Desktop does not find it):

```json
{
  "mcpServers": {
    "flatmate": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/absolute/path/to/flatmate", "mcp"]
    }
  }
}
```

Tools: `list_projects`, `create_project`, `open_project`, `get_drawing`, `draw_room`, `add_wall`, `set_wall_length`, `move_joint`, `label_room`, `rename_room`, `delete`. Coordinates are metres with y up. Each edit waits for the server and returns the updated drawing, or the reason it was refused ("Walls can't cross", "Someone else changed this first"); Claude's cursor shows where it last edited. `FM_SERVER_URL` and `FM_NAME` override the server and the display name.
````

In "## Limits", replace "The spec's follow-up list (§11) is not implemented; its first item is a WebGL2 renderer behind the same `Renderer` port." with:

```markdown
From the spec's follow-up list (§11), item 1 (the MCP server above) is implemented; the WebGL2 renderer and the rest are not. `draw_room` sends its four walls as four edits: it checks them together first, so a room the rules refuse draws nothing, but another person's edit in between can stop it part-way.
```

(If S1 has already edited this paragraph, merge the two statements by hand; see the README's shared-file table.)

- [x] **Step 2: Rehearsal row** — in `docs/reports/demo-rehearsal.md`, add to the pre-flight list:

```markdown
- [ ] (step 10) `claude mcp add flatmate -- pnpm --silent --dir "$PWD" mcp` done once; a Claude Code session open in a terminal, `/mcp` shows `flatmate` connected
```

and a row after step 9 (before **Total**):

```markdown
| 10a | Claude Code: "Open the Apartment project in Flatmate. Add a 2 × 2 m bathroom outside the right wall: add walls from (6, 0) to (8, 0), (8, 0) to (8, 2) and (8, 2) to (6, 2), then label the room at (7, 1) Bathroom." | three walls appear one by one in both windows, then the "Bathroom" tag with 3.24 m²; a "Claude" cursor at the last edit | Claude reports a refusal: ask it to call `get_drawing` and retry against the current right wall; or skip to 10b | 0:40 | | |
```

(3.24 m² = 1.8 × 1.8, checked with the domain on the step-5 room. Claude's choice of tools is not guaranteed; the prompt names coordinates to keep the step predictable.)

- [x] **Step 3: Spec** (`docs/specs/flatmate-design.md`)

The design is already in the spec (commit `bbfd448`, before implementation): §12, plus the §2.3 row, the §2.4 tree and the §5.2 `command` event. Only two edits remain:

- §11 item 1: append ` Done (gate M1).`
- If the implementation differs from §12 in any way (a tool, a limit, a reply text, a constraint), change §12 to match and list the difference in the gate report. If M1.9 was cut, replace the §12.5 "Presence" bullet with `- **Presence:** not implemented (M1.9 cut); Claude has no cursor.`

- [x] **Step 4: Design memory** — `docs/design-memory/mcp.md` already exists (commit `bbfd448`, the design decisions). Update it:

- remove the line "Not implemented yet." and the words ", not built" from the MCP row in `INDEX.md`;
- add a row for each decision made or changed during implementation (from the sprint log), and move any superseded choice to **Don't** with the reason;
- if M1.9 was cut, change the presence row to say so.

Set "Last updated" in `INDEX.md` to the commit date, and extend its Architecture summary with "; `@fm/mcp` is a shell like the web app".

`architecture.md` Decisions, a new row:

```markdown
| `@fm/mcp` is an outer shell: it imports protocol, domain and editor through their entries, tests reach the server only through `@fm/server`'s entry, and nothing imports it (dependency-cruiser rules `mcp-imports-cores-only`, `mcp-tests-use-server-entry-only`, `nothing-imports-mcp`) (2026-09-29) | Same ring rules as the web shell | §2.4, §12 |
```

`implementation.md` Decisions, two rows:

```markdown
| `@modelcontextprotocol/sdk` pinned to 1.31.0 with zod 4; tools use `registerTool` with zod raw shapes; tests use `InMemoryTransport` and, end to end, `StdioClientTransport` against a spawned server (`node --import tsx src/main.ts`, `PORT=0`) (2026-09-29) | Latest SDK on the day; spawning is fast (about 1 s) and proves the stdout discipline | M1 plan P-M10 |
| `pnpm mcp` = `pnpm --silent --filter @fm/mcp start`; ESLint `no-console` (errors and warnings allowed) in `packages/mcp/src` (2026-09-29) | Without `--silent`, pnpm's banner on stdout breaks the MCP stream | M1 plan P-M9 |
```

Add every sprint-log finding from the M1 README that changed a decision.

- [x] **Step 5: Verify and commit**

Run: `pnpm check` → green (docs only).

```bash
git add README.md docs/reports/demo-rehearsal.md docs/specs/flatmate-design.md docs/design-memory
git commit -m "docs: Use with Claude, rehearsal step 10, spec and design memory for the MCP server (M1)"
```

---

## Task M1.11: Gate M1 — manual checks and report

**Files:** create `docs/reports/gate-m1-mcp.md` (from `docs/reports/TEMPLATE.md`); tick `README.md` (this plan) completion criteria and sprint log

- [x] **Step 1: `pnpm check`** — record test counts (at `bc7e47d` this was 839 = 794 + 5 editor + 40 MCP; 39 MCP tests without M1.9; other work landing since changes the base).

- [x] **Step 2: Manual check 1 (demo step 10)** (2026-09-30: the user drew their own maze and apartment, free-form) — `pnpm demo`; Alice and Bob windows on "Apartment" after steps 1–8 (or "Sample apartment"); `claude mcp add flatmate -- pnpm --silent --dir "$PWD" mcp`; in Claude Code run the 10a prompt (the maze; revised after M1.10: was the bathroom, now the fallback). Record: the seven walls appear in both windows, no new room and the apartment's areas unchanged, the "Claude" cursor at (10.5, 3), Claude's route description, and the time taken. Then ask for something the rules refuse ("move the top-right corner to (2, 2)") and record the reply text.

- [ ] **Step 3: Manual check 2 (restart)** — kill the server process (the restart loop brings it back); ask Claude for an edit during the gap (expect "Offline: editing resumes when the connection returns"), then after the restart (expect success). In the scratch run the MCP server reconnected and reopened the project by itself.

- [x] **Step 4: Report** `docs/reports/gate-m1-mcp.md` — outcome in demo terms, completion bullets, verification, issues (from the sprint log), plan and spec changes, memory updates, risks, demo status, and the answers needed for the README's gate questions.

- [x] **Step 5: Commit and stop**

```bash
git add docs/reports/gate-m1-mcp.md docs/plans/flatmate-mcp
git commit -m "gate m1: MCP server report, memory and plan updates"
```

Present the report summary to the user and wait for approval.
