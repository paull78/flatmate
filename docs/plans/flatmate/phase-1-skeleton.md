# Phase 1: Skeleton and protocol basics

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** A pnpm workspace with `@fm/protocol`, `@fm/domain` and `@fm/editor` packages. Tests, typecheck, lint and dependency rules all run from one `pnpm check`. The ring boundaries of spec §2.4 fail the build when broken. `@fm/protocol` holds the shared result, patch and version helpers that every later phase uses.

**Spec:** §2.4 (packages and allowed imports), §4.0–4.1 (patches, version map, tombstones, expectations), §7.2 (receipt fingerprints need canonical JSON), §9 tooling line, §10 step 1.

**Prerequisites:** Node 22 (`node -v` → `v22.x`), pnpm 10.20 (`pnpm -v` → `10.20.0`), a clean working tree.

**Design memory to read first:**
- `architecture.md`. The boundaries are enforced by dependency-cruiser plus per-package `tsconfig` `lib`. Its Don'ts that matter here: no `@fm/domain` import from `server/src/app`; the domain has no outbound ports.
- `implementation.md`. Planning decisions P1 (source imports, no build step) and P2 (a separate typecheck program for tests).
- `process.md`: how the user works; commit only as the plan says.

**Verified in a scratch workspace on 2026-09-27.** Every file below was run with these resolved versions: typescript 6.0.3, vitest 5.0.2 (pulls vite 8.3.1 as a peer), eslint 10.11.0, @eslint/js 10.0.1, typescript-eslint 8.70.1, dependency-cruiser 18.4.0, tsx 4.23.15. **`typescript` must be pinned to `~6.0`.** `typescript@latest` is 7.0.x (the native port), and typescript-eslint 8.70 declares the peer range `typescript >=4.8.4 <6.1.0`.

---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `package.json` | Root scripts (`test`, `typecheck`, `lint`, `depcruise`, `check`, `e2e`), pinned pnpm, dev tools |
| Create | `pnpm-workspace.yaml` | Workspace = `packages/*`; allow esbuild's install script |
| Create | `.gitignore`, `.nvmrc` | Ignore build/test output and server data; Node 22 |
| Create | `tsconfig.base.json` | Strict settings shared by every package; `lib: ["ES2022"]`, `types: []` |
| Create | `eslint.config.js` | typescript-eslint recommended; no type or non-null assertions in core sources |
| Create | `.dependency-cruiser.cjs` | Ring rules of spec §2.4, no Node built-ins or third-party packages in cores |
| Create | `packages/protocol/{package.json,tsconfig.json,tsconfig.test.json}` | Package manifest; `src` program and test program |
| Create | `packages/protocol/src/util.ts` | `Point`, `Result`, `ok`, `err`, `unwrap`, `assertNever`, `isRecord`, `deepEqual` |
| Create | `packages/protocol/src/patch.ts` | Tables, keys, `Patch`, `Changeset`, stored document, version map helpers, `canonicalJson` |
| Create | `packages/protocol/src/index.ts` | Public exports |
| Test | `packages/protocol/test/util.test.ts`, `packages/protocol/test/patch.test.ts` | Unit tests |
| Create | `packages/domain/{package.json,tsconfig.json,tsconfig.test.json,src/index.ts}` | Skeleton; re-exports the result helpers for scripts |
| Test | `packages/domain/test/smoke.test.ts` | Proves `@fm/protocol` resolves from domain |
| Create | `packages/editor/{package.json,tsconfig.json,tsconfig.test.json,src/index.ts}` | Skeleton, filled in phase 3 |
| Test | `packages/editor/test/smoke.test.ts` | Proves `@fm/domain` resolves from editor |

`packages/web` (phase 4), `packages/server` (phase 6) and `packages/sync-tests` (phase 7) come later. The dependency rules written here already cover them.

---

## Tasks

### Task 1.1: Root workspace

**Files:** `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.nvmrc`, `tsconfig.base.json`

- [x] **Step 1: Write `package.json`**

```json
{
  "name": "flatmate",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.20.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "eslint .",
    "depcruise": "depcruise packages --config .dependency-cruiser.cjs",
    "check": "pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test",
    "e2e": "pnpm --filter @fm/web e2e"
  }
}
```

`pnpm -r` skips the workspace root, so the root `test` script does not call itself. The `e2e` script targets `@fm/web`, which phase 4 creates.

- [x] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
onlyBuiltDependencies:
  - esbuild
```

pnpm 10 blocks dependency install scripts unless they are allowed. esbuild (used by Vite, Vitest and tsx) needs its install script.

- [x] **Step 3: Write `.gitignore` and `.nvmrc`**

`.gitignore`:

```gitignore
node_modules/
dist/
test-results/
playwright-report/
data/
*.tmp
```

`.nvmrc`:

```
22
```

- [x] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`lib: ["ES2022"]` removes the DOM, and `types: []` stops automatic `@types/*` inclusion, so there are no Node globals. The server (phase 6) and web (phase 4) packages widen these in their own tsconfigs.

- [x] **Step 5: Install the dev tools**

Run: `pnpm add -Dw typescript@~6.0 vitest eslint typescript-eslint @eslint/js dependency-cruiser tsx`

Expected: the output ends with a `devDependencies:` list and `Done`. It resolves typescript 6.0.x, and pnpm may note "7.0.x is available"; ignore that.

- [x] **Step 6: Check the compiler version**

Run: `pnpm exec tsc --version`
Expected: `Version 6.0.x`

- [x] **Step 7: Record versions in the sprint log**

Run: `pnpm ls -D --depth 0`. Copy the resolved versions into this file's `## Sprint log`, one row. If typescript-eslint's peer range has moved (`pnpm view typescript-eslint peerDependencies`), note it there as well.

- [x] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .gitignore .nvmrc tsconfig.base.json docs/plans/flatmate/phase-1-skeleton.md
git commit -m "build: pnpm workspace, strict TypeScript base config and dev tools"
```

`pnpm check` cannot run yet: there are no packages and no lint or dependency-cruiser configs. It first runs in Task 1.7 (revised: said 1.4, but lint and depcruise configs arrive in 1.5 and 1.6).

---

### Task 1.2: `@fm/protocol` package and result helpers

**Files:** `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/tsconfig.test.json`, `packages/protocol/src/util.ts`, `packages/protocol/src/index.ts`, `packages/protocol/test/util.test.ts`

- [x] **Step 1: Write the package files**

`packages/protocol/package.json`:

```json
{
  "name": "@fm/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.test.json"
  },
  "dependencies": {}
}
```

`packages/protocol/tsconfig.json` (the `src` program, P2):

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/protocol/tsconfig.test.json` (the test program):

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

**Why two programs (P2).** The `src` program never imports Vitest, so no typings arrive through it. Core tests also stay free of Node APIs, and `types: []` still applies to the test program. In the scratch check the test program had no Node globals either, because `@types/node` is not installed. Phase 6 installs `@types/node` for the server. After that, Vitest's own typings may bring Node globals into core *test* programs, but never into core `src` programs. Task 1.7 proves the `src` side.

Run: `pnpm install`
Expected: `Done`.

- [x] **Step 2: Write the failing test** `packages/protocol/test/util.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { assertNever, deepEqual, err, isRecord, ok, unwrap, type Result } from "../src/util";

describe("Result", () => {
  it("ok and err build the two branches", () => {
    const good: Result<number, string> = ok(3);
    const bad: Result<number, string> = err("nope");
    expect(good).toEqual({ ok: true, value: 3 });
    expect(bad).toEqual({ ok: false, error: "nope" });
  });

  it("unwrap returns the value or throws with the serialized error", () => {
    expect(unwrap(ok("x"))).toBe("x");
    expect(() => unwrap(err({ kind: "tooShort" }))).toThrow('{"kind":"tooShort"}');
  });
});

describe("assertNever", () => {
  it("throws when reached at runtime", () => {
    type Shape = { kind: "a" } | { kind: "b" };
    const describeShape = (s: Shape): string => {
      switch (s.kind) {
        case "a":
          return "A";
        case "b":
          return "B";
        default:
          return assertNever(s);
      }
    };
    expect(describeShape({ kind: "b" })).toBe("B");
    expect(() => assertNever(JSON.parse('"surprise"') as never)).toThrow('Unexpected: "surprise"');
  });
});

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("deepEqual", () => {
  it("compares nested JSON values structurally", () => {
    expect(deepEqual({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("detects differences in values, keys, lengths and kinds", () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});
```

The `as never` in this test is allowed: the no-assertion lint rule covers core `src` only. The cast is the only way to reach `assertNever` at runtime.

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/protocol test util`
Expected: FAIL, `Error: Cannot find module '../src/util' imported from …/packages/protocol/test/util.test.ts`

Note: pass the file pattern directly (`test util`). `test -- util` hands a literal `--` to Vitest, which then runs every file.

- [x] **Step 4: Implement** `packages/protocol/src/util.ts`

```ts
export type Point = { x: number; y: number };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** Throws on an error result. For scripts and tests only: core code handles both branches. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(JSON.stringify(r.error));
}

/** Call in the `default` branch of a switch so a new union member fails to compile. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected: ${JSON.stringify(x)}`);
}

/** A plain JSON object (not an array, not null). A type guard, so callers need no casts. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural equality for plain JSON values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}
```

`packages/protocol/src/index.ts`:

```ts
export * from "./util";
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/protocol test util`
Expected: PASS, `Tests  6 passed (6)`

- [x] **Step 6: Typecheck**

Run: `pnpm --filter @fm/protocol typecheck`
Expected: exit code 0, no output from `tsc`.

- [x] **Step 7: Commit**

```bash
git add packages/protocol pnpm-lock.yaml
git commit -m "protocol: Result, assertNever, isRecord and deepEqual"
```

---

### Task 1.3: Patches, versions and canonical JSON

**Files:** `packages/protocol/src/patch.ts`, `packages/protocol/src/index.ts`, `packages/protocol/test/patch.test.ts`

These helpers are the generic, table-level half of spec §4.1. The server applies patches with them without knowing about walls (spec §7.1), and clients use the same functions for their confirmed copy.

- [x] **Step 1: Write the failing test** `packages/protocol/test/patch.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  applyStoredPatch,
  buildExpectations,
  canonicalJson,
  emptyStored,
  emptyVersions,
  failedExpectations,
  isTableName,
  keyOf,
  patchWrites,
  stampVersions,
  uniqueKeys,
  type Patch,
} from "../src/patch";

const j1 = { id: "j1", x: 0, y: 0 };
const j2 = { id: "j2", x: 6, y: 0 };
const w1 = { id: "w1", a: "j1", b: "j2" };

describe("keys", () => {
  it("keyOf joins table and id", () => {
    expect(keyOf({ table: "walls", id: "w1" })).toBe("walls/w1");
  });

  it("isTableName accepts the three tables only", () => {
    expect(isTableName("joints")).toBe(true);
    expect(isTableName("zoneLabels")).toBe(true);
    expect(isTableName("dimensions")).toBe(false);
    expect(isTableName(3)).toBe(false);
  });

  it("uniqueKeys keeps the first occurrence, in order, as bare keys", () => {
    const keys = uniqueKeys([
      { table: "walls", id: "w1" },
      { table: "joints", id: "j1" },
      { table: "walls", id: "w1" },
    ]);
    expect(keys).toEqual([
      { table: "walls", id: "w1" },
      { table: "joints", id: "j1" },
    ]);
  });

  it("patchWrites lists puts then deletes without duplicates", () => {
    const p: Patch = {
      puts: [{ table: "joints", entity: j1 }, { table: "joints", entity: j1 }],
      deletes: [{ table: "walls", id: "w9" }],
    };
    expect(patchWrites(p)).toEqual([
      { table: "joints", id: "j1" },
      { table: "walls", id: "w9" },
    ]);
  });
});

describe("applyStoredPatch", () => {
  it("applies puts and deletes without mutating the input", () => {
    const before = applyStoredPatch(emptyStored(), {
      puts: [{ table: "joints", entity: j1 }, { table: "joints", entity: j2 }, { table: "walls", entity: w1 }],
      deletes: [],
    });
    const snapshot = JSON.stringify(before);

    const after = applyStoredPatch(before, {
      puts: [{ table: "joints", entity: { id: "j2", x: 6, y: 1 } }],
      deletes: [{ table: "walls", id: "w1" }],
    });

    expect(after.joints["j2"]).toEqual({ id: "j2", x: 6, y: 1 });
    expect(after.walls["w1"]).toBeUndefined();
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("versions", () => {
  it("stampVersions stamps puts and keeps deleted IDs as tombstones", () => {
    const v1 = stampVersions(emptyVersions(), { puts: [{ table: "walls", entity: w1 }], deletes: [] }, "c1");
    const v2 = stampVersions(v1, { puts: [], deletes: [{ table: "walls", id: "w1" }] }, "c2");
    expect(v1.walls["w1"]).toBe("c1");
    expect(v2.walls["w1"]).toBe("c2");
    expect(v1.walls["w1"]).toBe("c1");
  });

  it("buildExpectations gives null for never-existed IDs and dedupes keys", () => {
    const v = stampVersions(emptyVersions(), { puts: [{ table: "joints", entity: j1 }], deletes: [] }, "c1");
    expect(
      buildExpectations(v, [
        { table: "joints", id: "j1" },
        { table: "joints", id: "j7" },
        { table: "joints", id: "j1" },
      ]),
    ).toEqual([
      { table: "joints", id: "j1", lastCs: "c1" },
      { table: "joints", id: "j7", lastCs: null },
    ]);
  });

  it("failedExpectations lists keys whose version moved", () => {
    const v = stampVersions(emptyVersions(), { puts: [{ table: "joints", entity: j1 }], deletes: [] }, "c2");
    expect(
      failedExpectations(v, [
        { table: "joints", id: "j1", lastCs: "c1" },
        { table: "joints", id: "j5", lastCs: null },
      ]),
    ).toEqual([{ table: "joints", id: "j1" }]);
    expect(failedExpectations(v, [{ table: "joints", id: "j1", lastCs: "c2" }])).toEqual([]);
  });

  it("a delete-recreate-delete sequence never returns to an old version (no ABA)", () => {
    let v = emptyVersions();
    v = stampVersions(v, { puts: [], deletes: [{ table: "walls", id: "w1" }] }, "d1");
    v = stampVersions(v, { puts: [{ table: "walls", entity: w1 }], deletes: [] }, "r1");
    v = stampVersions(v, { puts: [], deletes: [{ table: "walls", id: "w1" }] }, "d2");
    expect(failedExpectations(v, [{ table: "walls", id: "w1", lastCs: "d1" }])).toEqual([{ table: "walls", id: "w1" }]);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every level and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });

  it("gives equal strings for equal values built in different key orders", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("drops undefined object fields like JSON.stringify", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
```

The ABA test is the table-level half of the acceptance scenario "Delete, recreate, delete again: an expectation for the first deletion fails against the second tombstone" (spec §9).

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/protocol test patch`
Expected: FAIL, `Error: Cannot find module '../src/patch' imported from …/packages/protocol/test/patch.test.ts`

- [x] **Step 3: Implement** `packages/protocol/src/patch.ts`

```ts
import { isRecord } from "./util";

export type TableName = "joints" | "walls" | "zoneLabels";

export const TABLE_NAMES: readonly TableName[] = ["joints", "walls", "zoneLabels"];

export function isTableName(v: unknown): v is TableName {
  return v === "joints" || v === "walls" || v === "zoneLabels";
}

export type EntityKey = { table: TableName; id: string };
export type EntityValue = { id: string } & Record<string, unknown>;
export type Patch = { puts: { table: TableName; entity: EntityValue }[]; deletes: EntityKey[] };
export type Expectation = EntityKey & { lastCs: string | null };
export type Changeset = { id: string; patch: Patch; expect: Expectation[] };
export type StoredDocument = Record<TableName, Record<string, EntityValue>>;
/** id → id of the last changeset that wrote the entity. Deleted IDs stay (tombstones); absent = never existed. */
export type VersionMap = Record<TableName, Record<string, string>>;

export function keyOf(k: EntityKey): string {
  return `${k.table}/${k.id}`;
}

/** Removes duplicate keys; the first occurrence wins and order is kept. Returns bare `{ table, id }` keys. */
export function uniqueKeys(keys: EntityKey[]): EntityKey[] {
  const seen = new Set<string>();
  const out: EntityKey[] = [];
  for (const k of keys) {
    const s = keyOf(k);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ table: k.table, id: k.id });
  }
  return out;
}

/** Every entity the patch writes: puts, then deletes, without duplicates. */
export function patchWrites(p: Patch): EntityKey[] {
  return uniqueKeys([...p.puts.map((put) => ({ table: put.table, id: put.entity.id })), ...p.deletes]);
}

export function emptyStored(): StoredDocument {
  return { joints: {}, walls: {}, zoneLabels: {} };
}

export function emptyVersions(): VersionMap {
  return { joints: {}, walls: {}, zoneLabels: {} };
}

/** Pure: returns a new document. Puts and deletes never overlap in a valid changeset, so their order is irrelevant. */
export function applyStoredPatch(doc: StoredDocument, p: Patch): StoredDocument {
  const next: StoredDocument = { joints: { ...doc.joints }, walls: { ...doc.walls }, zoneLabels: { ...doc.zoneLabels } };
  for (const d of p.deletes) delete next[d.table][d.id];
  for (const put of p.puts) next[put.table][put.entity.id] = put.entity;
  return next;
}

/** Stamps every written entity, deleted ones included (tombstones), with the changeset ID. */
export function stampVersions(v: VersionMap, p: Patch, changesetId: string): VersionMap {
  const next: VersionMap = { joints: { ...v.joints }, walls: { ...v.walls }, zoneLabels: { ...v.zoneLabels } };
  for (const k of patchWrites(p)) next[k.table][k.id] = changesetId;
  return next;
}

export function buildExpectations(v: VersionMap, keys: EntityKey[]): Expectation[] {
  return uniqueKeys(keys).map((k) => ({ table: k.table, id: k.id, lastCs: v[k.table][k.id] ?? null }));
}

/** Keys whose current version differs from the expectation. An empty list means every expectation holds. */
export function failedExpectations(v: VersionMap, expect: Expectation[]): EntityKey[] {
  return expect
    .filter((e) => (v[e.table][e.id] ?? null) !== e.lastCs)
    .map((e) => ({ table: e.table, id: e.id }));
}

/** JSON with object keys sorted at every level, so equal values give equal strings (receipt fingerprints). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
```

Replace `packages/protocol/src/index.ts` with:

```ts
export * from "./util";
export * from "./patch";
```

- [x] **Step 4: Run the package tests**

Run: `pnpm --filter @fm/protocol test`
Expected: PASS, `Test Files  2 passed (2)`, `Tests  18 passed (18)`

- [x] **Step 5: Typecheck**

Run: `pnpm --filter @fm/protocol typecheck`
Expected: exit code 0.

- [x] **Step 6: Commit**

```bash
git add packages/protocol
git commit -m "protocol: patches, version map with tombstones, expectations and canonical JSON"
```

---

### Task 1.4: `@fm/domain` and `@fm/editor` skeletons

**Files:** `packages/domain/{package.json,tsconfig.json,tsconfig.test.json,src/index.ts,test/smoke.test.ts}`, `packages/editor/{package.json,tsconfig.json,tsconfig.test.json,src/index.ts,test/smoke.test.ts}`

- [x] **Step 1: Write the domain package files**

`packages/domain/package.json`:

```json
{
  "name": "@fm/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.test.json"
  },
  "dependencies": { "@fm/protocol": "workspace:*" }
}
```

`packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/domain/tsconfig.test.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [x] **Step 2: Write the domain smoke test** `packages/domain/test/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ok, unwrap } from "../src/index";

describe("@fm/domain smoke", () => {
  it("resolves @fm/protocol through the workspace", () => {
    expect(unwrap(ok(42))).toBe(42);
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm install && pnpm --filter @fm/domain test`
Expected: FAIL, `Error: Cannot find module '../src/index' imported from …/packages/domain/test/smoke.test.ts`

- [x] **Step 4: Implement** `packages/domain/src/index.ts`

```ts
// Replaced in phase 2. These re-exports stay: scripts call `unwrap(execute(doc, cmd))` with @fm/domain alone.
export { ok, err, unwrap, assertNever } from "@fm/protocol";
export type { Point, Result } from "@fm/protocol";
```

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/domain test`
Expected: PASS, `Tests  1 passed (1)`

- [x] **Step 6: Write the editor package files**

`packages/editor/package.json`:

```json
{
  "name": "@fm/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.test.json"
  },
  "dependencies": { "@fm/domain": "workspace:*", "@fm/protocol": "workspace:*" }
}
```

`packages/editor/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/editor/tsconfig.test.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/editor/src/index.ts`:

```ts
// Filled in phase 3.
export {};
```

- [x] **Step 7: Write the editor smoke test** `packages/editor/test/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ok, unwrap } from "@fm/domain";

describe("@fm/editor smoke", () => {
  it("resolves @fm/domain through the workspace", () => {
    expect(unwrap(ok("editor"))).toBe("editor");
  });
});
```

- [x] **Step 8: Run all tests and typechecks**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: `packages/protocol test: Tests 18 passed (18)`, `packages/domain test: Tests 1 passed (1)`, `packages/editor test: Tests 1 passed (1)`; each `typecheck` line ends with `Done`.

`vitest` and `tsc` resolve from the workspace root's `node_modules/.bin`, because `pnpm run` adds the root's binaries to `PATH`. The packages need no dev dependencies of their own.

- [x] **Step 9: Commit**

```bash
git add packages/domain packages/editor pnpm-lock.yaml
git commit -m "build: domain and editor package skeletons with workspace smoke tests"
```

---

### Task 1.5: ESLint (no assertions in core sources)

**Files:** `eslint.config.js`

- [x] **Step 1: Write `eslint.config.js`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Core packages (spec §2.4, AGENTS.md): no type assertions and no non-null assertions.
// `as const` is not a type assertion for this rule and stays allowed.
const CORE_SOURCES = ["packages/{protocol,domain,editor}/src/**/*.ts", "packages/server/src/app/**/*.ts"];

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/test-results/**", "**/playwright-report/**", "data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS config files such as .dependency-cruiser.cjs
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable", require: "readonly" } },
  },
  {
    files: CORE_SOURCES,
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
];
```

- [x] **Step 2: Run lint on the clean tree**

Run: `pnpm lint`
Expected: exit code 0, no problems reported.

- [x] **Step 3: Negative check: the rule rejects assertions in core sources**

Create a temporary file `packages/domain/src/cast.ts`:

```ts
const raw: unknown = 1;
export const n = raw as number;
export const m = [1][0]!;
export const tables = ["joints", "walls"] as const;
```

Run: `pnpm lint`
Expected: FAIL with exactly two errors:

```
packages/domain/src/cast.ts
  2:18  error  Do not use any type assertions  @typescript-eslint/consistent-type-assertions
  3:18  error  Forbidden non-null assertion    @typescript-eslint/no-non-null-assertion
```

Line 4 (`as const`) is not reported.

- [x] **Step 4: Remove the temporary file and lint again**

Run: `rm packages/domain/src/cast.ts && pnpm lint`
Expected: exit code 0.

- [x] **Step 5: Commit**

```bash
git add eslint.config.js
git commit -m "build: ESLint forbids type and non-null assertions in core sources"
```

---

### Task 1.6: dependency-cruiser ring rules

**Files:** `.dependency-cruiser.cjs`

- [x] **Step 1: Write `.dependency-cruiser.cjs`**

```js
// Ring rules from spec §2.4: dependencies point inward only.
//   web ──► editor ──► domain ──► protocol;  server/app ──► protocol;  only the domain-validator adapter imports domain.
// Workspace packages resolve through node_modules symlinks to their real paths (packages/<name>/src/...),
// so the rules match on real paths.
const CORES = "^packages/(protocol|domain|editor)/src/";

module.exports = {
  forbidden: [
    {
      name: "no-unresolvable",
      comment: "A dependency that cannot be resolved would silently escape every rule below.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "protocol-is-innermost",
      severity: "error",
      from: { path: "^packages/protocol/src/" },
      to: { path: "^packages/(domain|editor|web|server|sync-tests)/" },
    },
    {
      name: "domain-imports-protocol-only",
      severity: "error",
      from: { path: "^packages/domain/src/" },
      to: { path: "^packages/(editor|web|server|sync-tests)/" },
    },
    {
      name: "editor-imports-domain-and-protocol-only",
      severity: "error",
      from: { path: "^packages/editor/src/" },
      to: { path: "^packages/(web|server|sync-tests)/" },
    },
    {
      name: "server-app-imports-protocol-only",
      severity: "error",
      from: { path: "^packages/server/src/app/" },
      to: { path: "^packages/(domain|editor|web|sync-tests)/" },
    },
    {
      name: "only-domain-validator-imports-domain",
      severity: "error",
      from: { path: "^packages/server/src/", pathNot: "^packages/server/src/adapters/domain-validator\\.ts$" },
      to: { path: "^packages/domain/" },
    },
    {
      name: "server-never-imports-editor-or-web",
      severity: "error",
      from: { path: "^packages/server/" },
      to: { path: "^packages/(editor|web|sync-tests)/" },
    },
    {
      name: "web-never-imports-server",
      severity: "error",
      from: { path: "^packages/web/" },
      to: { path: "^packages/(server|sync-tests)/" },
    },
    {
      name: "cores-no-node-builtins",
      severity: "error",
      from: { path: CORES },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "cores-no-third-party-packages",
      comment: "protocol, domain and editor sources depend on nothing outside the workspace (no React, ws, …).",
      severity: "error",
      from: { path: CORES },
      to: { path: "node_modules" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
```

(revised after G1, 2026-09-28: the config also has an `only-through-package-index` rule, so another package is used only through its `src/index.ts` or `@fm/editor/testing`. The planted checks below import `index.ts` files, so their expected output is unchanged. See the phase 2 sprint log.)

`tsPreCompilationDeps: true` counts type-only imports too, which layering needs. `cores-no-third-party-packages` also covers React and `ws`: after symlink resolution every npm package's real path contains `node_modules`, while workspace packages resolve to `packages/…`.

- [x] **Step 2: Run it on the clean tree and check resolution**

Run: `pnpm depcruise`
Expected: `✔ no dependency violations found (10 modules, 13 dependencies cruised)`

Run: `pnpm exec depcruise packages --config .dependency-cruiser.cjs --output-type text | grep "domain/src/index.ts →"`
Expected: `packages/domain/src/index.ts → packages/protocol/src/index.ts`, a real path and not `node_modules/@fm/protocol`. This confirms the path rules can match.

- [x] **Step 3: Negative checks on the core rings**

Create two temporary files.

`packages/domain/src/forbidden.ts`:

```ts
export * from "../../editor/src/index";
import { readFileSync } from "node:fs";
export const read = readFileSync;
```

`packages/editor/src/forbidden.ts`:

```ts
import { describe } from "vitest";
export const d = describe;
```

Run: `pnpm depcruise`
Expected: FAIL with these three errors (order may vary):

```
error domain-imports-protocol-only: packages/domain/src/forbidden.ts → packages/editor/src/index.ts
error cores-no-node-builtins: packages/domain/src/forbidden.ts → fs
error cores-no-third-party-packages: packages/editor/src/forbidden.ts → node_modules/.pnpm/vitest@…/node_modules/vitest/dist/index.js
```

A bare `import … from "@fm/editor"` inside domain fails differently, as `no-unresolvable`. `@fm/editor` is not a domain dependency, and pnpm's strict layout does not link it. That is the right outcome too.

(revised: the completion criteria claim an unresolvable-import check, but no step ran it.) Before Step 5, replace `packages/domain/src/forbidden.ts` with `export * from "@fm/editor";`, remove the other two temporary files, and run `pnpm depcruise`. Expected: exactly one error, `error no-unresolvable: packages/domain/src/forbidden.ts → @fm/editor`. Then continue with Step 5, removing whichever temporary files are left.

- [x] **Step 4: Negative check on the server rule**

Create a temporary file `packages/server/src/app/forbidden.ts`:

```ts
export * from "../../../domain/src/index";
```

Run: `pnpm depcruise`
Expected: FAIL with the domain and editor errors above, plus:

```
error server-app-imports-protocol-only: packages/server/src/app/forbidden.ts → packages/domain/src/index.ts
error only-domain-validator-imports-domain: packages/server/src/app/forbidden.ts → packages/domain/src/index.ts
```

- [x] **Step 5: Remove the temporary files and rerun**

Run: `rm packages/domain/src/forbidden.ts packages/editor/src/forbidden.ts && rm -r packages/server && pnpm depcruise`
Expected: `✔ no dependency violations found (10 modules, 13 dependencies cruised)`

- [x] **Step 6: Commit**

```bash
git add .dependency-cruiser.cjs
git commit -m "build: dependency-cruiser enforces the ring rules of spec §2.4"
```

---

### Task 1.7: Full check and the core-typings proof

**Files:** none changed; a temporary file only.

- [x] **Step 1: Run the full check**

Run: `pnpm check`
Expected: typecheck `Done` for protocol, domain and editor; lint exits 0; `✔ no dependency violations found`; tests `18 + 1 + 1 = 20` passed.

- [x] **Step 2: Prove core sources see no Node globals (P2)**

Create a temporary file `packages/domain/src/leak.ts`:

```ts
export const env = process.env["NODE_ENV"];
```

Run: `pnpm --filter @fm/domain typecheck`
Expected: FAIL, `src/leak.ts(1,20): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? …`

Run: `rm packages/domain/src/leak.ts && pnpm --filter @fm/domain typecheck`
Expected: exit code 0.

Add the TS2591 output line to the sprint log. The gate report quotes it.

- [x] **Step 3: Tick this phase's completion criteria, fill the sprint log, commit the plan file**

```bash
git add docs/plans/flatmate/phase-1-skeleton.md
git commit -m "plan: phase 1 steps ticked and sprint log"
```

---

## Completion criteria

- [x] `pnpm install` works from a clean clone with Node 22 and pnpm 10.20.0 (`packageManager` pinned), with no ignored-build-script warning for esbuild.
- [x] `typescript` is pinned to `~6.0`; `pnpm exec tsc --version` prints `Version 6.0.x`.
- [x] `pnpm check` passes: two typecheck programs per package for protocol, domain and editor; lint clean; no dependency violations; 20 tests pass.
- [x] `@fm/protocol` exports everything in the README contract for `util.ts` and `patch.ts` (messages come in phase 6), plus `isRecord`.
- [x] Protocol tests cover `applyStoredPatch` purity, tombstones in `stampVersions`, `null` expectations for never-existed IDs, `failedExpectations`, the delete-recreate-delete sequence (spec §9: "Delete, recreate, delete again …"), `canonicalJson` key order (spec §7.2: receipt fingerprints), `uniqueKeys` and `patchWrites`.
- [x] Lint rejects `as` and `!` in core sources and allows `as const` (negative check run in Task 1.5).
- [x] dependency-cruiser rejects domain → editor, a Node built-in in a core package, a third-party package in a core package, server/app → domain, and unresolvable imports (negative checks run in Task 1.6).
- [x] Core `src` typecheck fails on `process` (P2 proof run in Task 1.7).
- [x] The sprint log lists the resolved tool versions and any warnings.

## Gate 1

Follow the [gate protocol](README.md#gate-protocol). The report is `docs/reports/gate-1-skeleton.md`.

Extra verification commands for the report:

```bash
pnpm exec tsc --version
pnpm ls -D --depth 0
pnpm check
```

No demo step works yet. Mark every row of the report's demo table "not started".

The report must answer:

1. **Tool versions.** What resolved, and did `pnpm install` print peer warnings? Has typescript-eslint's `typescript` peer range moved so that the `~6.0` pin can change? Leave the pin alone in this phase.
2. **Typings isolation (P2).** Quote the TS2591 line from Task 1.7. Phase 6 will install `@types/node` for the server, so that phase must rerun Task 1.7 Step 2 to confirm core `src` still rejects `process`. Record that as a risk for G6.
3. **Resolution.** Does dependency-cruiser resolve `@fm/*` to real `packages/…` paths (Task 1.6 Step 2)? Did any rule need a different path pattern than planned?
4. **Commands later phases rely on.** Confirm that `pnpm --filter <pkg> test <pattern>` runs one file and that `test -- <pattern>` runs every file. The README's working rules already use the form without `--` (corrected while planning); confirm it (revised at review).
5. **Vite version.** Vitest pulled in Vite as a peer (8.x in the scratch check). Phase 4 must add the same Vite major to `@fm/web`; note the version here.
6. **Anything slower or harder than planned**, and whether this phase's steps were the right size.

## Contract extensions

- `@fm/protocol` `util.ts` also exports `isRecord(v: unknown): v is Record<string, unknown>`, a type guard used by `deepEqual` and `canonicalJson`. Phase 2's shape parsers and phase 6's message parsers can use it without casts.
- `@fm/domain`'s `index.ts` re-exports `ok`, `err`, `unwrap`, `assertNever` and the types `Point` and `Result` from `@fm/protocol`. Phase 2 must keep these when it rewrites the index, so scripts can do `unwrap(execute(doc, cmd))` with `@fm/domain` alone (spec §3.1).
- Tooling: `typescript` is pinned to `~6.0` (typescript-eslint peer range).
- Command form: to run one test file use `pnpm --filter @fm/<pkg> test <pattern>`, not `test -- <pattern>`.

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-27 | 1.1 | versions | Resolved: typescript 6.0.3 (7.0.2 available), vitest 5.0.2 (vite 8.3.1 as peer), eslint 10.11.0, @eslint/js 10.0.1, typescript-eslint 8.70.1, dependency-cruiser 18.4.0, tsx 4.23.15, esbuild 0.28.2 (postinstall ran). typescript-eslint peer range unchanged: `typescript >=4.8.4 <6.1.0`. No peer warnings. | Nothing; matches the scratch check. `~6.0` pin stays. | none needed (already in implementation.md) |
| 2026-09-27 | 1.6 | plan change | Completion criteria list "unresolvable imports" among the depcruise negative checks, but no step ran one. All planned checks matched exactly (3 core errors, then 5 with the server app file; 10 modules / 13 dependencies clean). | Ran the check (`export * from "@fm/editor"` in domain → one `no-unresolvable` error) and added it to Task 1.6 as a revised step. | none needed: a plan-text gap, no design decision |
| 2026-09-27 | 1.7 | result | `pnpm check` passes: 3 × 2 typecheck programs, lint clean, 10 modules / 13 dependencies, tests 18 + 1 + 1 = 20. P2 proof: `src/leak.ts(1,20): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? …`; clean after removal. A fresh clone of the branch installs (esbuild postinstall runs, no warnings) and passes `pnpm check`. | Nothing. | none needed |
| 2026-09-27 | 1.1 | plan change | Task 1.1 said `pnpm check` first runs in Task 1.4; it can only run once lint (1.5) and depcruise (1.6) configs exist. | Corrected the sentence to Task 1.7, marked revised. | none needed: plan text |
