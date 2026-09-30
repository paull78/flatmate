# Phase 7: Shared documents and collaboration

> Part of the [Flatmate plan](README.md). Read the README's working rules, gate protocol and shared contracts first.

**Goal:** Two browser windows open the same server project and edit it together. Each edit is shown at once, submitted as one changeset and settled by the server. Only one edit is outstanding at a time and nothing is queued. Wall chains pause until their segment settles. Remote changes cancel or rerun gestures and invalidate history. Undo is all-or-nothing through the server, presence shows live cursors, and the client recovers from disconnects, sequence gaps and server crashes through snapshots and same-ID resends. Demo steps 1–8 run against the real server.

**Spec:** §5.5 (pause and resume), §5.7 (remote changes during a gesture), §7.0 (`OpenDocument`, notices), §7.2 and §7.2.1 (client side of the protocol and sessions), §7.4 (shared document), §7.5 (shared undo), §7.6 (presence), §7.7 (disconnect), §8 (sync errors), §9 (sync row, §9.1, acceptance scenarios), §10 step 6 (client half).

**Prerequisites:** Gates 3, 4, 5 and 6 approved. `@fm/protocol` exports the phase 6 parsers and `utf8Length`. `@fm/server` has `createServerApp`, `createInMemoryRepository` (in `src/app/testing.ts`) and `domainValidator`. `@fm/editor` has the phase 3 extension points: the `session.ts` stubs, `toolNotice` in `notices.ts`, the drawPresence comment in `view/scene.ts` and `drawingAt` in `tools/wall-tool.ts`. The web shell has the phase 4 effect runner with a `ServerEffectSink`.

**Design memory to read first:**

- `collaboration.md`. Don'ts that matter here:
  - no second collaborative edit and no replay of blocked input;
  - no held acks;
  - never apply remote changes the server did not validate;
  - never reapply values from an `ack`;
  - never cancel a submitted change locally;
  - a connection close is never a rejection.
- `open-documents.md`. Only `open-document.ts` switches on document kind. The reducers are pure, with no `await`, sockets or timers inside.
- `undo-history.md`:
  - invalidation is by write overlap, not by value;
  - any remote topology change invalidates everything;
  - snapshots clear both stacks;
  - history does not survive a reconnect.
- `editor-interaction.md`:
  - a paused chain keeps `chainStart`;
  - never end a resumed chain because its preview is invalid;
  - cancel, never recompute, a gesture whose dependency changed remotely.
- `architecture.md`. The WebSocket adapter only translates messages and owns backoff; behaviour stays in the editor.

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/editor/src/document/types.ts` | `SharedDocument`; `OpenDocument = LocalDocument \| SharedDocument` |
| Create | `packages/editor/src/document/shared-document.ts` | Pure reducer for the §7.4 table: create, commit, server events, visible cache |
| Replace | `packages/editor/src/document/open-document.ts` | The one kind switch, now with `shared` cases, `hasPendingEdit`, `sessionOf` |
| Create | `packages/editor/src/ports/wire.ts` | Server message → editor event, and effect → client message: one mapping for every shell |
| Replace | `packages/editor/src/session.ts` | Project list, opening, connection, identity, presence (§7.2.1, §7.6) |
| Create | `packages/editor/src/gestures.ts` | Resume or end a paused chain; cancel or rerun gestures on remote changes, snapshots and disconnects |
| Replace | `packages/editor/src/notices.ts` | `toolNotice` delegates to `gestures.ts` |
| Modify | `packages/editor/src/history/history.ts` | `hasEntry` |
| Modify | `packages/editor/src/tools/wall-tool.ts` | `placePoint`: a same-step rejection leaves the tool unchanged |
| Modify | `packages/editor/src/tools/select-tool.ts` | `rerunMove` |
| Modify | `packages/editor/src/view/scene.ts` | `drawPresence` |
| Modify | `packages/editor/src/index.ts` | Export the shared document, wire mappings and session queries |
| Modify | `packages/editor/package.json` | `exports["./testing"]` → `test/testing.ts` (for `@fm/sync-tests`) |
| Modify | `packages/editor/test/fake-shell.ts` | `FakeHost(prefix)`, `FakeShell.command(cmd)` |
| Create | `packages/editor/test/shared-builders.ts` | `shared()`, `pending()`, `checkConsistent`, event builders |
| Create | `packages/editor/test/fake-remote.ts` | A scripted server for editor-only tests: the test decides when each submission settles |
| Create | `packages/editor/test/testing.ts` | Harness entry point re-exported as `@fm/editor/testing` |
| Test | `packages/editor/test/shared-document.test.ts`, `shared-scenarios.test.ts`, `wire.test.ts`, `session.test.ts`, `shared-tools.test.ts`, `remote-gestures.test.ts`, `shared-undo.test.ts`, `presence.test.ts`, `testing.test.ts` | Reducer tables, §9.1 scenarios, session, tools and undo against a delayed server |
| Modify | `packages/server/package.json`, create `packages/server/src/index.ts` | Package entry for `@fm/sync-tests` |
| Create | `packages/sync-tests/{package.json,tsconfig.json}`, `test/net.ts`, `test/*.test.ts` | Two headless editors against the real server app and domain validator |
| Create | `packages/web/src/adapters/ws-server.ts` | WebSocket adapter: hello, message mapping, reconnect backoff, presence throttle, effect sink |
| Modify | `packages/web/src/identity.ts` | `serverUrlFrom` (`?server=` or `VITE_SERVER_URL`) |
| Create | `packages/web/src/panels/ProjectList.tsx` | Project list screen (create, open) |
| Replace | `packages/web/src/app.tsx`, `packages/web/src/main.tsx` | Project list overlay, Projects button, server mode |
| Modify | `packages/web/src/styles.css` | Project list and Projects button styles |
| Replace | `packages/web/playwright.config.ts` | Also starts a server on port 8788 with a fresh data directory |
| Modify | `packages/web/e2e/support/canvas.ts` (phase 5) | Append shared-mode helpers: `dragFromTo`, `typeLengthAndWait`, `drawDemoRoom` |
| Create | `packages/web/e2e/collaboration.spec.ts` | Two-window Playwright test |
| Test | `packages/web/test/ws-server.test.ts`, `project-list.test.tsx`, `identity.test.ts` (extended) | Adapter and panel tests |

---

## Tests carried over from phase 3

Phase 3 reviews found rules that only a `SharedDocument` can exercise (with `OpenDocument = LocalDocument`, `canCommit` is always true and a local document ignores patch shape and dependencies). Add one test for each in the task that fits, and log them in the sprint log. (revised: lean mode, 2026-09-29) Items marked *cut* are skipped; the others cover sending, undo or convergence:

- `commit` on a blocked shared document throws (the `canCommit` guard in `open-document.ts`) (phase 3 wave 3).
- *cut* `runCommand` and `runHistory` while offline show the offline message (`blockedMessage`) and submit nothing; the waiting case is already covered by "waits for the ordinary pending edit" and the blocking scenarios (wave 5).
- A submitted changeset carries `patchOnly` of the command's patch (no `before`, no `dependencies` fields) and the command's semantic dependencies (wave 5).
- *cut* `canUndo` and `canRedo` in the ViewModel are false while the document cannot accept edits, even with usable entries: disconnect after an accepted edit (wave 5).
- `finishCommit` keeps the document's effects (a shared commit's `submit`): drop `step.effects` and a send scenario must fail (wave 5 code review).
- An ordinary edit during a pending undo request (already added to Task 7.7).
- *cut* Presence follows the camera: while connected, a wheel with the pointer on the canvas sends one presence with the cursor's new world point, and a middle-drag pan sends one when it ends (`followCamera`, phase 3 wave 6).
- `Cmd+Z` on a `paused` wall chain while the segment is pending shows "Waiting for server" and keeps the chain `paused` (a refused undo keeps the gesture; phase 3 wave 6). `undoRedo` tells an applied request from a refused one by a new document object, so `sharedCommit` must always return a new `SharedDocument`: a submitted undo mid-chain drops the chain.

## Tasks

### Task 7.1: `SharedDocument`: creation, visible document and commits

A `SharedDocument` mirrors the server in `confirmed` and holds at most one outstanding changeset, `inFlight`. `visible` is a cache of `confirmed ⊕ inFlight`. It includes the edit only while the edit's expectations hold against the confirmed versions and the result validates (spec §7.4). An own `changes` message therefore removes the overlay by itself: it stamps the entities with the edit's ID, so the edit's expectations stop holding. No extra flag is needed.

This task adds the type, creation, `commit` and the `open-document` cases. `sharedOnEvent` is a stub until Task 7.2.

**Files:** Modify `packages/editor/src/document/types.ts`. Create `packages/editor/src/document/shared-document.ts`, `packages/editor/test/shared-builders.ts`, `packages/editor/test/shared-document.test.ts`. Replace `packages/editor/src/document/open-document.ts`.

- [x] **Step 1: Write the test builders** `packages/editor/test/shared-builders.ts`

```ts
import { execute, toStored, unwrap, validateDocument, type Command, type Document } from "@fm/domain";
import {
  TABLE_NAMES, buildExpectations, deepEqual, emptyVersions, patchWrites, uniqueKeys,
  type Changeset, type Point, type RejectReason, type VersionMap,
} from "@fm/protocol";
import { computeVisible, sharedCommit, withVisible } from "../src/document/shared-document";
import type { CommitInput, SharedDocument } from "../src/document/types";
import type { ServerEvent } from "../src/ports/events";
import { jointAt, roomDoc } from "./builders";

export const PROJECT = { id: "p1", name: "Apartment" };

/** Every entity of `doc` last written by changeset `lastCs`. */
export function versionsFor(doc: Document, lastCs: string): VersionMap {
  const v = emptyVersions();
  for (const id of Object.keys(doc.joints)) v.joints[id] = lastCs;
  for (const id of Object.keys(doc.walls)) v.walls[id] = lastCs;
  for (const id of Object.keys(doc.zoneLabels)) v.zoneLabels[id] = lastCs;
  return v;
}

/** A state the app could reach (spec §9.1): builders run this, and so do scenario folds after every step. */
export function checkConsistent(d: SharedDocument): void {
  if (!deepEqual(d.visible, computeVisible(d))) throw new Error("visible is stale");
  if (!validateDocument(d.confirmed.doc).ok) throw new Error("the confirmed document is invalid");
  for (const table of TABLE_NAMES) {
    for (const id of Object.keys(d.confirmed.doc[table])) {
      if (d.confirmed.versions[table][id] === undefined) throw new Error(`${table}/${id} has no version`);
    }
  }
}

/** A shared document built directly (spec §9.1 "test builders"); defaults: the demo room, seq 42, connected, generation g1. */
export function shared(opts: {
  doc?: Document; versions?: VersionMap; seq?: number; inFlight?: Changeset | null;
  connection?: SharedDocument["connection"]; generation?: string;
} = {}): SharedDocument {
  const doc = opts.doc ?? roomDoc();
  const d = withVisible({
    kind: "shared",
    project: PROJECT,
    generation: opts.generation ?? "g1",
    confirmed: { doc, versions: opts.versions ?? versionsFor(doc, "c0"), seq: opts.seq ?? 42 },
    inFlight: opts.inFlight ?? null,
    connection: opts.connection ?? "connected",
    visible: doc,
  });
  checkConsistent(d);
  return d;
}

/** The commit input a drag of the room's top-right corner to `to` produces. */
export function moveInput(d: SharedDocument, to: Point, id: string): CommitInput {
  const corner = jointAt(d.visible, { x: 6, y: 4 });
  const r = unwrap(execute(d.visible, { type: "moveJoints", moves: [{ jointId: corner, to }] }));
  return { id, patch: { puts: r.patch.puts, deletes: r.patch.deletes }, dependencies: r.patch.dependencies };
}

/** `d` with one outstanding edit: the corner moved to `to` as changeset `id`. */
export function pending(d: SharedDocument = shared(), to: Point = { x: 6, y: 4.6 }, id = "c1"): SharedDocument {
  const next = sharedCommit(d, moveInput(d, to, id)).doc;
  checkConsistent(next);
  return next;
}

export function inFlightOf(d: SharedDocument): Changeset {
  if (!d.inFlight) throw new Error("nothing in flight");
  return d.inFlight;
}

/** A changeset built the way a client builds one: execute on `doc`, expectations from `versions`. */
export function changesetFor(doc: Document, versions: VersionMap, cmd: Command, id: string): Changeset {
  const r = unwrap(execute(doc, cmd));
  const keys = uniqueKeys([...patchWrites(r.patch), ...r.patch.dependencies]);
  return { id, patch: { puts: r.patch.puts, deletes: r.patch.deletes }, expect: buildExpectations(versions, keys) };
}

type Ev<T extends ServerEvent["type"]> = Extract<ServerEvent, { type: T }>;

/** Server events addressed to `d` (its project and, by default, its generation). */
export const ev = {
  changes(d: SharedDocument, changeset: Changeset, seq: number, clientId = "bob", generation = d.generation): Ev<"changes"> {
    return { type: "changes", projectId: PROJECT.id, generation, seq, changeset, clientId };
  },
  ack(d: SharedDocument, changesetId: string, seq: number, generation = d.generation): Ev<"ack"> {
    return { type: "ack", projectId: PROJECT.id, generation, changesetId, seq };
  },
  rejected(d: SharedDocument, changesetId: string, reason: RejectReason, generation = d.generation): Ev<"rejected"> {
    return { type: "rejected", projectId: PROJECT.id, generation, changesetId, reason };
  },
  snapshot(d: SharedDocument, over: { doc?: Document; versions?: VersionMap; seq?: number; generation?: string } = {}): Ev<"snapshot"> {
    return {
      type: "snapshot",
      projectId: PROJECT.id,
      generation: over.generation ?? d.generation,
      meta: PROJECT,
      doc: toStored(over.doc ?? d.confirmed.doc),
      versions: over.versions ?? d.confirmed.versions,
      seq: over.seq ?? d.confirmed.seq,
    };
  },
};
```

- [x] **Step 2: Write the failing test** `packages/editor/test/shared-document.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { toStored } from "@fm/domain";
import { createLocalDocument } from "../src/document/local-document";
import { canCommit, commit, hasPendingEdit, isDirty, sessionOf, status, visibleDoc } from "../src/document/open-document";
import { sharedCanCommit, sharedCommit, sharedFromSnapshot, sharedStatus } from "../src/document/shared-document";
import { jointAt, pointOf, roomDoc } from "./builders";
import { PROJECT, checkConsistent, moveInput, pending, shared, versionsFor } from "./shared-builders";

describe("SharedDocument: creation and commits (spec §7.0, §7.4)", () => {
  it("opens from a snapshot: connected, editable, visible = the snapshot's document", () => {
    const doc = roomDoc();
    const d = sharedFromSnapshot({
      type: "snapshot", projectId: PROJECT.id, generation: "g1", meta: PROJECT,
      doc: toStored(doc), versions: versionsFor(doc, "c0"), seq: 7,
    });
    expect(d).toMatchObject({ kind: "shared", project: PROJECT, generation: "g1", inFlight: null, connection: "connected" });
    expect(d.visible).toEqual(doc);
    expect(d.confirmed.seq).toBe(7);
    expect(sharedCanCommit(d)).toBe(true);
    expect(sharedStatus(d)).toBe("saved");
    checkConsistent(d);
  });

  it("a commit sets inFlight, shows the edit at once and submits it with expectations from the confirmed versions", () => {
    const d = shared();
    const corner = jointAt(d.visible, { x: 6, y: 4 });
    const r = sharedCommit(d, moveInput(d, { x: 6, y: 4.6 }, "c1"));
    expect(r.notices).toEqual([]);
    const submit = r.effects[0];
    if (r.effects.length !== 1 || submit?.type !== "submit") throw new Error("expected exactly one submit effect");
    expect(submit).toMatchObject({ projectId: "p1", generation: "g1", changeset: { id: "c1" } });
    // the moved joint and its two incident walls, each at the confirmed version
    expect(submit.changeset.expect).toHaveLength(3);
    expect(submit.changeset.expect).toContainEqual({ table: "joints", id: corner, lastCs: "c0" });
    expect(submit.changeset.expect.every((e) => e.lastCs === "c0")).toBe(true);
    expect(r.doc.inFlight).toEqual(submit.changeset);
    expect(pointOf(r.doc.visible, corner)).toEqual({ x: 6, y: 4.6 });
    expect(pointOf(r.doc.confirmed.doc, corner)).toEqual({ x: 6, y: 4 });
    expect(sharedCanCommit(r.doc)).toBe(false);
    expect(sharedStatus(r.doc)).toBe("waiting for server");
    checkConsistent(r.doc);
  });

  it("a commit whose message would exceed 1 MB is refused locally with the server's reason", () => {
    const d = shared();
    const name = "x".repeat(1_000_001);
    const r = sharedCommit(d, {
      id: "c9",
      patch: { puts: [{ table: "zoneLabels", entity: { id: "l1", at: { x: 1, y: 1 }, name } }], deletes: [] },
      dependencies: [],
    });
    expect(r.doc).toBe(d);
    expect(r.effects).toEqual([]);
    expect(r.notices).toEqual([{ type: "rejected", id: "c9", reason: { kind: "tooLarge" } }]);
  });
});

describe("open-document with a shared document", () => {
  it("answers every query through the one kind switch", () => {
    const ready = shared();
    const waiting = pending();
    const syncing = shared({ connection: "syncing" });
    const offline = { ...pending(), connection: "offline" as const };
    const row = (d: typeof ready) => [canCommit(d), status(d), isDirty(d), hasPendingEdit(d)];
    expect(row(ready)).toEqual([true, "saved", false, false]);
    expect(row(waiting)).toEqual([false, "waiting for server", true, true]);
    expect(row(syncing)).toEqual([false, "waiting for server", false, false]);
    expect(row(offline)).toEqual([false, "offline", true, true]);
    expect(visibleDoc(waiting)).toBe(waiting.visible);
  });

  it("refuses a commit while the document cannot accept edits", () => {
    const d = pending();
    expect(() => commit(d, moveInput(d, { x: 6, y: 5 }, "c2"))).toThrow("cannot accept edits");
  });

  it("exposes the session a shared document belongs to, and none for a local one", () => {
    expect(sessionOf(shared())).toEqual({ projectId: "p1", generation: "g1", connected: true });
    expect(sessionOf(shared({ connection: "syncing" }))?.connected).toBe(false);
    expect(sessionOf(createLocalDocument({ id: "local", name: "Untitled" }, "open1"))).toBeNull();
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/editor test shared-document`
Expected: FAIL, `Cannot find module '../src/document/shared-document'`.

- [x] **Step 4: Widen the document types.** Replace `packages/editor/src/document/types.ts` with:

```ts
import type { Document } from "@fm/domain";
import type { Changeset, EntityKey, Patch, RejectReason, VersionMap } from "@fm/protocol";
import type { Effect } from "../ports/effects";
import type { ProjectInfo } from "../types";

// Spec §7.0. Tools, gestures, history and the ViewModel react to notices.
export type Notice =
  | { type: "accepted"; id: string }
  | { type: "rejected"; id: string; reason: RejectReason }
  | { type: "remoteChange"; writes: EntityKey[]; topology: boolean }
  | { type: "resynced" }
  | { type: "offline" };

export type CommitInput = { id: string; patch: Patch; dependencies: EntityKey[] };

export type DocumentStatus =
  | "not saved" | "unsaved changes" | "saving" | "saved" | "save failed" | "waiting for server" | "offline";

export type DocStep<D> = { doc: D; effects: Effect[]; notices: Notice[] };

export type LocalDocument = {
  kind: "local";
  project: ProjectInfo;
  openId: string; // fresh per open
  doc: Document; // the truth
  revision: number; // +1 on every commit, undo and redo
  saving: { kind: "none" }; // X1 adds { kind: "file", … }
};

// Spec §7.4: the server is the truth; `confirmed` mirrors it and one edit at most is outstanding.
export type SharedDocument = {
  kind: "shared";
  project: ProjectInfo;
  generation: string; // §7.2.1: fresh for every open, reconnect and resync
  confirmed: { doc: Document; versions: VersionMap; seq: number };
  inFlight: Changeset | null; // no local queue
  connection: "connected" | "syncing" | "offline";
  visible: Document; // cache: confirmed ⊕ inFlight while its expectations hold and the result validates
};

export type OpenDocument = LocalDocument | SharedDocument;
```

- [x] **Step 5: Implement** `packages/editor/src/document/shared-document.ts`

```ts
import { applyPatch, fromStored, validateDocument, type Document } from "@fm/domain";
import {
  MAX_MESSAGE_BYTES, buildExpectations, failedExpectations, patchWrites, uniqueKeys, utf8Length, type Changeset,
} from "@fm/protocol";
import type { Effect } from "../ports/effects";
import type { ServerEvent } from "../ports/events";
import type { Host } from "../ports/host";
import type { CommitInput, DocStep, DocumentStatus, SharedDocument } from "./types";

// Spec §7.4 as a pure reducer: network and timers are effects out and events in (§9.1).

export type SnapshotEvent = Extract<ServerEvent, { type: "snapshot" }>;
type Step = DocStep<SharedDocument>;

function same(d: SharedDocument): Step {
  return { doc: d, effects: [], notices: [] };
}

/** The first snapshot for the generation being opened creates the document (spec §7.0). */
export function sharedFromSnapshot(e: SnapshotEvent): SharedDocument {
  const doc = parseSnapshot(e);
  return withVisible({
    kind: "shared",
    project: { id: e.meta.id, name: e.meta.name },
    generation: e.generation,
    confirmed: { doc, versions: e.versions, seq: e.seq },
    inFlight: null,
    connection: "connected",
    visible: doc,
  });
}

/** visible = confirmed ⊕ inFlight, only while its expectations hold and the result validates (spec §7.4). */
export function computeVisible(d: SharedDocument): Document {
  const cs = d.inFlight;
  if (!cs || failedExpectations(d.confirmed.versions, cs.expect).length > 0) return d.confirmed.doc;
  const applied = applyPatch(d.confirmed.doc, cs.patch);
  return applied.ok && validateDocument(applied.value).ok ? applied.value : d.confirmed.doc;
}

export function withVisible(d: SharedDocument): SharedDocument {
  return { ...d, visible: computeVisible(d) };
}

/** Connected, synchronized and nothing outstanding (spec §7.4). */
export function sharedCanCommit(d: SharedDocument): boolean {
  return d.connection === "connected" && d.inFlight === null;
}

export function sharedStatus(d: SharedDocument): DocumentStatus {
  if (d.connection === "offline") return "offline";
  return d.connection === "syncing" || d.inFlight !== null ? "waiting for server" : "saved";
}

/**
 * One outstanding edit (spec §7.4): expectations from the confirmed versions, which equal the visible ones
 * because nothing is pending, for every write and semantic dependency. A submission too large to send is
 * refused here with the rejection the server would give (§7.2); above the socket's frame limit the server
 * would close the connection, and the same-ID resend after reconnecting would repeat that forever.
 */
export function sharedCommit(d: SharedDocument, input: CommitInput): Step {
  const keys = uniqueKeys([...patchWrites(input.patch), ...input.dependencies]);
  const changeset: Changeset = { id: input.id, patch: input.patch, expect: buildExpectations(d.confirmed.versions, keys) };
  const submit = submitEffect(d, changeset);
  if (utf8Length(JSON.stringify(submit)) > MAX_MESSAGE_BYTES) {
    return { doc: d, effects: [], notices: [{ type: "rejected", id: input.id, reason: { kind: "tooLarge" } }] };
  }
  return { doc: withVisible({ ...d, inFlight: changeset }), effects: [submit], notices: [] };
}

/** Server events: Task 7.2 replaces this stub. */
export function sharedOnEvent(d: SharedDocument, _event: ServerEvent, _host: Host): Step {
  return same(d);
}

function submitEffect(d: SharedDocument, changeset: Changeset): Effect {
  return { type: "submit", projectId: d.project.id, generation: d.generation, changeset };
}

function parseSnapshot(e: SnapshotEvent): Document {
  const parsed = fromStored(e.doc);
  // The server validated every accepted changeset, so a malformed snapshot is a bug: fail fast (spec §8).
  if (!parsed.ok) throw new Error(`Malformed snapshot for ${e.projectId}: ${parsed.error.message}`);
  return parsed.value;
}
```

- [x] **Step 6: Replace** `packages/editor/src/document/open-document.ts`

```ts
import type { Document } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import type { ServerEvent } from "../ports/events";
import type { Host } from "../ports/host";
import { localCommit } from "./local-document";
import { sharedCanCommit, sharedCommit, sharedOnEvent, sharedStatus } from "./shared-document";
import type { CommitInput, DocStep, DocumentStatus, OpenDocument } from "./types";

// The only module that switches on document kind (spec §7.0).

export function visibleDoc(d: OpenDocument): Document {
  switch (d.kind) {
    case "local":
      return d.doc;
    case "shared":
      return d.visible;
    default:
      return assertNever(d);
  }
}

export function canCommit(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return true;
    case "shared":
      return sharedCanCommit(d);
    default:
      return assertNever(d);
  }
}

/** Callers check canCommit first; committing while blocked is a programming error. */
export function commit(d: OpenDocument, input: CommitInput): DocStep<OpenDocument> {
  if (!canCommit(d)) throw new Error("commit while the document cannot accept edits");
  switch (d.kind) {
    case "local":
      return localCommit(d, input);
    case "shared":
      return sharedCommit(d, input);
    default:
      return assertNever(d);
  }
}

export function onEvent(d: OpenDocument, event: ServerEvent, host: Host): DocStep<OpenDocument> {
  switch (d.kind) {
    case "local":
      return { doc: d, effects: [], notices: [] }; // a local document never talks to the server
    case "shared":
      return sharedOnEvent(d, event, host);
    default:
      return assertNever(d);
  }
}

export function status(d: OpenDocument): DocumentStatus {
  switch (d.kind) {
    case "local":
      return "not saved"; // saving: none; X1 adds the file statuses
    case "shared":
      return sharedStatus(d);
    default:
      return assertNever(d);
  }
}

/** Work that closing the tab would lose: local commits, or a submission whose outcome is unknown (§7.7). */
export function isDirty(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return d.revision > 0;
    case "shared":
      return d.inFlight !== null;
    default:
      return assertNever(d);
  }
}

/** An edit whose outcome is still unknown; leaving the drawing waits for it (§7.2.1). */
export function hasPendingEdit(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return false;
    case "shared":
      return d.inFlight !== null;
    default:
      return assertNever(d);
  }
}

/** The server session a document belongs to (presence, stale-event checks); null for local documents. */
export function sessionOf(d: OpenDocument): { projectId: string; generation: string; connected: boolean } | null {
  switch (d.kind) {
    case "local":
      return null;
    case "shared":
      return { projectId: d.project.id, generation: d.generation, connected: d.connection === "connected" };
    default:
      return assertNever(d);
  }
}
```

- [x] **Step 7: Run it and see it pass**

Run: `pnpm --filter @fm/editor test shared-document document`
Expected: PASS: `shared-document.test.ts` (6 tests) and the phase 3 `document.test.ts` (4 tests) unchanged.

- [x] **Step 8: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: SharedDocument type, visible cache and one-outstanding-edit commits"
```

---

### Task 7.2: `SharedDocument`: server events (spec §7.4 table)

Every row of the §7.4 table becomes one transition, tested from a built state. Events from another project or an older generation are ignored (§7.2.1). A gap, a changeset that does not apply, and an ack ahead of `confirmed.seq` all request a snapshot under a new generation, unless one is already pending. The same-ID resend after the snapshot settles the edit. Nothing about an early ack is stored.

**Files:** Modify `packages/editor/src/document/shared-document.ts`, `packages/editor/test/shared-document.test.ts`.

- [x] **Step 1: Append the failing tests** to `packages/editor/test/shared-document.test.ts`. Merge these imports into the existing import lines:

```ts
import { execute, unwrap } from "@fm/domain";
import type { RejectReason } from "@fm/protocol";
import { sharedOnEvent } from "../src/document/shared-document";
import { FakeHost } from "./fake-shell";
import { changesetFor, ev, inFlightOf } from "./shared-builders";
```

Then append:

```ts
describe("SharedDocument: server events (spec §7.4 table)", () => {
  const host = () => new FakeHost();
  const cornerOf = (d: ReturnType<typeof shared>) => jointAt(d.confirmed.doc, { x: 6, y: 4 });
  const originOf = (d: ReturnType<typeof shared>) => jointAt(d.confirmed.doc, { x: 0, y: 0 });

  /** Bob's move of the room's (0,0) joint, built on d's confirmed versions. */
  function bobMovesOrigin(d: ReturnType<typeof shared>, id = "b1") {
    return changesetFor(d.confirmed.doc, d.confirmed.versions, { type: "moveJoints", moves: [{ jointId: originOf(d), to: { x: -0.4, y: 0 } }] }, id);
  }

  it("own consecutive changes: applied to confirmed, overlay gone, still in flight until ack, no notice", () => {
    const d = pending();
    const r = sharedOnEvent(d, ev.changes(d, inFlightOf(d), 43, "tab1"), host());
    expect([r.effects, r.notices]).toEqual([[], []]);
    expect(r.doc.confirmed.seq).toBe(43);
    expect(pointOf(r.doc.confirmed.doc, cornerOf(d))).toEqual({ x: 6, y: 4.6 });
    expect(r.doc.confirmed.versions.joints[cornerOf(d)]).toBe("c1");
    expect(r.doc.visible).toBe(r.doc.confirmed.doc);
    expect(r.doc.inFlight?.id).toBe("c1");
    expect(sharedCanCommit(r.doc)).toBe(false);
    checkConsistent(r.doc);
  });

  it("matching ack at or below confirmed seq: settles, accepted, editable again; values are not reapplied", () => {
    const d = pending();
    const echoed = sharedOnEvent(d, ev.changes(d, inFlightOf(d), 43, "tab1"), host()).doc;
    const r = sharedOnEvent(echoed, ev.ack(echoed, "c1", 43), host());
    expect(r.notices).toEqual([{ type: "accepted", id: "c1" }]);
    expect(r.doc.inFlight).toBeNull();
    expect(r.doc.confirmed).toBe(echoed.confirmed);
    expect(sharedCanCommit(r.doc)).toBe(true);
    expect(sharedStatus(r.doc)).toBe("saved");
  });

  it("remote consecutive changes: applied, remoteChange with the writes; a move is not a topology change", () => {
    const d = shared();
    const r = sharedOnEvent(d, ev.changes(d, bobMovesOrigin(d), 43), host());
    expect(r.notices).toEqual([{ type: "remoteChange", writes: [{ table: "joints", id: originOf(d) }], topology: false }]);
    expect(pointOf(r.doc.visible, originOf(d))).toEqual({ x: -0.4, y: 0 });
    expect(r.doc.confirmed.versions.joints[originOf(d)]).toBe("b1");
    checkConsistent(r.doc);
  });

  it("a remote addWall is a topology change", () => {
    const d = shared();
    const cs = changesetFor(d.confirmed.doc, d.confirmed.versions, { type: "addWall", opId: "bob", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } }, "b1");
    const r = sharedOnEvent(d, ev.changes(d, cs, 43), host());
    const notice = r.notices[0];
    expect(notice?.type === "remoteChange" && notice.topology).toBe(true);
    expect(notice?.type === "remoteChange" && notice.writes).toContainEqual({ table: "walls", id: "bob/w0" });
  });

  it("a remote change that breaks the overlay's expectations hides the edit but keeps it in flight", () => {
    const d = pending();
    const bob = changesetFor(d.confirmed.doc, d.confirmed.versions, { type: "moveJoints", moves: [{ jointId: cornerOf(d), to: { x: 6, y: 5 } }] }, "b1");
    const r = sharedOnEvent(d, ev.changes(d, bob, 43), host());
    expect(pointOf(r.doc.visible, cornerOf(d))).toEqual({ x: 6, y: 5 });
    expect(r.doc.visible).toBe(r.doc.confirmed.doc);
    expect(r.doc.inFlight?.id).toBe("c1");
    expect(r.notices.map((n) => n.type)).toEqual(["remoteChange"]);
  });

  it("duplicate changes are ignored", () => {
    const d = shared({ seq: 42 });
    expect(sharedOnEvent(d, ev.changes(d, bobMovesOrigin(d), 42), host()).doc).toBe(d);
  });

  it("a sequence gap requests a snapshot under a new generation and blocks editing", () => {
    const d = shared();
    const r = sharedOnEvent(d, ev.changes(d, bobMovesOrigin(d), 44), host());
    expect(r.doc).toMatchObject({ connection: "syncing", generation: "id1" });
    expect(r.doc.confirmed).toBe(d.confirmed);
    expect(r.effects).toEqual([{ type: "workspace", op: { type: "open", projectId: "p1", generation: "id1" } }]);
    expect(r.notices).toEqual([]);
    expect(sharedCanCommit(r.doc)).toBe(false);
  });

  it("a matching ack ahead of confirmed seq is ignored and requests one snapshot; the edit stays in flight", () => {
    const d = pending();
    const r1 = sharedOnEvent(d, ev.ack(d, "c1", 43), host());
    expect(r1.doc).toMatchObject({ connection: "syncing", generation: "id1" });
    expect(r1.doc.inFlight?.id).toBe("c1");
    expect(r1.notices).toEqual([]);
    expect(r1.effects).toEqual([{ type: "workspace", op: { type: "open", projectId: "p1", generation: "id1" } }]);
    const r2 = sharedOnEvent(r1.doc, ev.ack(r1.doc, "c1", 43), host());
    expect(r2.doc).toBe(r1.doc);
    expect(r2.effects).toEqual([]);
  });

  it("unrelated acks and rejections change nothing", () => {
    const d = pending();
    const conflict: RejectReason = { kind: "conflict", entities: [] };
    expect(sharedOnEvent(d, ev.ack(d, "c9", 42), host()).doc).toBe(d);
    expect(sharedOnEvent(d, ev.rejected(d, "c9", conflict), host()).doc).toBe(d);
    const idle = shared();
    expect(sharedOnEvent(idle, ev.ack(idle, "c1", 42), host()).doc).toBe(idle);
  });

  it("a matching rejection clears inFlight, removes the overlay and reports the reason", () => {
    const d = pending();
    const reason: RejectReason = { kind: "conflict", entities: [{ table: "joints", id: cornerOf(d) }] };
    const r = sharedOnEvent(d, ev.rejected(d, "c1", reason), host());
    expect(r.doc.inFlight).toBeNull();
    expect(r.doc.visible).toBe(r.doc.confirmed.doc);
    expect(r.notices).toEqual([{ type: "rejected", id: "c1", reason }]);
    expect(sharedCanCommit(r.doc)).toBe(true);
  });

  it("ignores events from an older generation or another project", () => {
    const d = pending();
    expect(sharedOnEvent(d, ev.ack(d, "c1", 42, "g0"), host()).doc).toBe(d);
    expect(sharedOnEvent(d, { ...ev.ack(d, "c1", 42), projectId: "p2" }, host()).doc).toBe(d);
    expect(sharedOnEvent(d, ev.snapshot(d, { generation: "g0" }), host()).doc).toBe(d);
  });

  it("a disconnect keeps the outstanding edit, blocks editing and cancels gestures once", () => {
    const d = pending();
    const r = sharedOnEvent(d, { type: "connection", state: "closed" }, host());
    expect(r.doc.connection).toBe("offline");
    expect(r.doc.inFlight?.id).toBe("c1");
    expect(r.notices).toEqual([{ type: "offline" }]);
    expect(sharedStatus(r.doc)).toBe("offline");
    expect(sharedOnEvent(r.doc, { type: "connection", state: "closed" }, host()).notices).toEqual([]);
  });

  it("a reconnect reopens the project under a new generation", () => {
    const offline = sharedOnEvent(pending(), { type: "connection", state: "closed" }, host()).doc;
    const r = sharedOnEvent(offline, { type: "connection", state: "open" }, host());
    expect(r.doc).toMatchObject({ connection: "syncing", generation: "id1" });
    expect(r.effects).toEqual([{ type: "workspace", op: { type: "open", projectId: "p1", generation: "id1" } }]);
  });

  it("a snapshot with an outstanding edit replaces confirmed, resyncs and resends it with the same ID", () => {
    const d = pending();
    const syncing = { ...d, connection: "syncing" as const, generation: "g2" };
    const r = sharedOnEvent(syncing, ev.snapshot(syncing, { seq: 50 }), host());
    expect(r.doc.confirmed.seq).toBe(50);
    expect(r.doc.connection).toBe("connected");
    expect(r.notices).toEqual([{ type: "resynced" }]);
    expect(r.effects).toEqual([{ type: "submit", projectId: "p1", generation: "g2", changeset: inFlightOf(d) }]);
    expect(pointOf(r.doc.visible, cornerOf(d))).toEqual({ x: 6, y: 4.6 }); // its expectations still hold: overlay shown
    expect(sharedCanCommit(r.doc)).toBe(false);
    checkConsistent(r.doc);
  });

  it("a snapshot without an outstanding edit makes the document editable", () => {
    const syncing = shared({ connection: "syncing" });
    const moved = unwrap(execute(syncing.confirmed.doc, { type: "moveJoints", moves: [{ jointId: originOf(syncing), to: { x: -0.4, y: 0 } }] })).doc;
    const r = sharedOnEvent(syncing, ev.snapshot(syncing, { doc: moved, seq: 60 }), host());
    expect(r.effects).toEqual([]);
    expect(r.notices).toEqual([{ type: "resynced" }]);
    expect(r.doc.visible).toEqual(moved);
    expect(sharedCanCommit(r.doc)).toBe(true);
  });

  it("identity, failed-open and presence events do not touch the document", () => {
    const d = shared();
    expect(sharedOnEvent(d, { type: "welcome", clientId: "tab1", color: "#e5484d" }, host()).doc).toBe(d);
    expect(sharedOnEvent(d, { type: "openFailed", projectId: "p1", generation: "g1", message: "Unknown project" }, host()).doc).toBe(d);
    expect(sharedOnEvent(d, { type: "presenceLeft", projectId: "p1", generation: "g1", clientId: "bob" }, host()).doc).toBe(d);
  });
});
```

In the "snapshot without an outstanding edit" row, `versionsFor(d.confirmed.doc, "c0")` still covers every entity, because a move keeps the IDs.

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test shared-document`
Expected: FAIL. The stub ignores every event; the first failure is `expected 42 to be 43` in "own consecutive changes".

- [x] **Step 3: Implement the events.** In `packages/editor/src/document/shared-document.ts`, replace the two import lines from `@fm/domain` and `@fm/protocol` with:

```ts
import { applyPatch, changesTopology, fromStored, validateDocument, type Document } from "@fm/domain";
import {
  MAX_MESSAGE_BYTES, assertNever, buildExpectations, failedExpectations, patchWrites, stampVersions, uniqueKeys, utf8Length,
  type Changeset,
} from "@fm/protocol";
```

add below `type Step = DocStep<SharedDocument>;`:

```ts
type ProjectEvent = Extract<ServerEvent, { type: "snapshot" | "changes" | "ack" | "rejected" }>;
```

and replace the stub `sharedOnEvent` with:

```ts
export function sharedOnEvent(d: SharedDocument, e: ServerEvent, host: Host): Step {
  switch (e.type) {
    case "connection":
      return e.state === "open" ? requestSnapshot(d, host) : disconnected(d);
    case "welcome":
    case "openFailed":
    case "presence":
    case "presenceLeft":
      return same(d); // identity, failed opens and presence belong to the session (session.ts)
    case "snapshot":
    case "changes":
    case "ack":
    case "rejected":
      // Events of an older open, connection or resync are ignored (spec §7.2.1).
      return e.projectId === d.project.id && e.generation === d.generation ? projectEvent(d, e, host) : same(d);
    default:
      return assertNever(e);
  }
}

function projectEvent(d: SharedDocument, e: ProjectEvent, host: Host): Step {
  switch (e.type) {
    case "snapshot":
      return onSnapshot(d, e);
    case "changes":
      return onChanges(d, e, host);
    case "ack":
      return onAck(d, e, host);
    case "rejected":
      return onRejected(d, e);
    default:
      return assertNever(e);
  }
}

/** Replace confirmed; resend the outstanding edit with the same ID. If the snapshot contains it, the receipt acks it (§7.4). */
function onSnapshot(d: SharedDocument, e: SnapshotEvent): Step {
  const next = withVisible({
    ...d,
    project: { id: e.meta.id, name: e.meta.name },
    confirmed: { doc: parseSnapshot(e), versions: e.versions, seq: e.seq },
    connection: "connected",
  });
  return { doc: next, effects: next.inFlight ? [submitEffect(next, next.inFlight)] : [], notices: [{ type: "resynced" }] };
}

function onChanges(d: SharedDocument, e: Extract<ServerEvent, { type: "changes" }>, host: Host): Step {
  if (e.seq <= d.confirmed.seq) return same(d); // duplicate
  if (e.seq !== d.confirmed.seq + 1) return resync(d, host); // a gap: changes were missed
  const patch = e.changeset.patch;
  const applied = applyPatch(d.confirmed.doc, patch);
  if (!applied.ok) return resync(d, host); // the mirror disagrees with the server: start again from a snapshot
  const next = withVisible({
    ...d,
    confirmed: { doc: applied.value, versions: stampVersions(d.confirmed.versions, patch, e.changeset.id), seq: e.seq },
  });
  if (d.inFlight?.id === e.changeset.id) return same(next); // own change: tracked until its ack
  return {
    doc: next,
    effects: [],
    notices: [{ type: "remoteChange", writes: patchWrites(patch), topology: changesTopology(d.confirmed.doc, patch) }],
  };
}

function onAck(d: SharedDocument, e: Extract<ServerEvent, { type: "ack" }>, host: Host): Step {
  if (d.inFlight?.id !== e.changesetId) return same(d); // unrelated: never settles another submission
  // Ahead of confirmed.seq: changes were missed. The same-ID resend after the snapshot gets the ack again (§7.4).
  if (e.seq > d.confirmed.seq) return resync(d, host);
  return { doc: withVisible({ ...d, inFlight: null }), effects: [], notices: [{ type: "accepted", id: e.changesetId }] };
}

function onRejected(d: SharedDocument, e: Extract<ServerEvent, { type: "rejected" }>): Step {
  if (d.inFlight?.id !== e.changesetId) return same(d);
  return { doc: withVisible({ ...d, inFlight: null }), effects: [], notices: [{ type: "rejected", id: e.changesetId, reason: e.reason }] };
}

/** Ask for a snapshot unless one is already pending (gap, early ack, unappliable change). */
function resync(d: SharedDocument, host: Host): Step {
  return d.connection === "syncing" ? same(d) : requestSnapshot(d, host);
}

/** Reopen under a new generation; older events are then ignored (§7.2.1). */
function requestSnapshot(d: SharedDocument, host: Host): Step {
  const generation = host.newId();
  return {
    doc: { ...d, generation, connection: "syncing" },
    effects: [{ type: "workspace", op: { type: "open", projectId: d.project.id, generation } }],
    notices: [],
  };
}

/** Keep the outstanding edit unresolved; block edits; gestures cancel once (§7.7). */
function disconnected(d: SharedDocument): Step {
  if (d.connection === "offline") return same(d);
  return { doc: { ...d, connection: "offline" }, effects: [], notices: [{ type: "offline" }] };
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test shared-document`
Expected: PASS (22 tests).

- [x] **Step 5: Record the decisions in design memory.** The `tooLarge` guard was drafted into `collaboration.md` while planning; replace that draft row with the rows below (today's date), adjusted to what was implemented, so no duplicate remains. Rows for the Decisions table of `docs/design-memory/collaboration.md`:

```markdown
| `SharedDocument` is one pure reducer (`document/shared-document.ts`). `visible` is a cache recomputed on every change; an own `changes` drops the overlay because its stamped versions break the edit's expectations, so no extra flag exists. A gap, an unappliable change and an ack ahead of `confirmed.seq` request one snapshot (new generation) unless already syncing (<date>) | Every §7.4 row is one tested transition | §7.4, §9.1 |
| A submission whose message would exceed `MAX_MESSAGE_BYTES` is refused locally with the `rejected{tooLarge}` notice the server would send (<date>) | Above the server's socket frame limit the connection closes, and the same-ID resend after every reconnect would loop | §7.2, §7.4 |
```

Add a sprint-log row (kind: decision).

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor docs/design-memory/collaboration.md docs/plans/flatmate/phase-7-collaboration.md
git commit -m "editor: SharedDocument reducer for changes, acks, rejections, gaps, disconnects and snapshots"
```

---

### Task 7.3: Event-sequence scenarios (spec §9.1)

Scenarios fold short event lists through the reducer and run `checkConsistent` after every step. They use code from Task 7.2, so they should pass at once. A failure is a real bug: fix it in Task 7.2's code and log it.

**Files:** Create `packages/editor/test/shared-scenarios.test.ts`.

- [x] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { applyPatch, unwrap } from "@fm/domain";
import { stampVersions } from "@fm/protocol";
import { sharedOnEvent } from "../src/document/shared-document";
import type { Notice, SharedDocument } from "../src/document/types";
import type { Effect } from "../src/ports/effects";
import type { ServerEvent } from "../src/ports/events";
import { jointAt, pointOf } from "./builders";
import { FakeHost } from "./fake-shell";
import { changesetFor, checkConsistent, ev, inFlightOf, pending } from "./shared-builders";

type StepFn = (d: SharedDocument) => ServerEvent;

/** Folds events through the reducer, checking consistency after every step. */
function run(start: SharedDocument, steps: StepFn[]) {
  const host = new FakeHost();
  let d = start;
  const notices: Notice[] = [];
  const effects: Effect[] = [];
  for (const make of steps) {
    const r = sharedOnEvent(d, make(d), host);
    checkConsistent(r.doc);
    d = r.doc;
    notices.push(...r.notices);
    effects.push(...r.effects);
  }
  return { d, notices, effects };
}

const closed: StepFn = () => ({ type: "connection", state: "closed" });
const opened: StepFn = () => ({ type: "connection", state: "open" });

/** The server's state once it accepted `start`'s outstanding edit as seq 43. */
function serverWith(start: SharedDocument) {
  const cs = inFlightOf(start);
  return {
    doc: unwrap(applyPatch(start.confirmed.doc, cs.patch)),
    versions: stampVersions(start.confirmed.versions, cs.patch, cs.id),
    seq: 43,
  };
}

describe("shared document scenarios (spec §9.1)", () => {
  it("snapshot already contains my edit: the resend is acked from the receipt; settled once, applied once", () => {
    const start = pending();
    const server = serverWith(start);
    const { d, notices, effects } = run(start, [
      closed,
      opened,
      (d) => ev.snapshot(d, server),
      (d) => ev.ack(d, "c1", 43),
      (d) => ev.ack(d, "c1", 43), // a duplicate ack settles nothing twice
    ]);
    expect(d.inFlight).toBeNull();
    expect(d.visible).toEqual(server.doc);
    expect(d.confirmed.seq).toBe(43);
    expect(notices.map((n) => n.type)).toEqual(["offline", "resynced", "accepted"]);
    expect(effects.filter((e) => e.type === "submit")).toHaveLength(1); // the resend, same ID
  });

  it("own changes arrive but the ack is lost with the connection: reconnect, snapshot, resend, ack", () => {
    const start = pending();
    const server = serverWith(start);
    const { d, notices } = run(start, [
      (d) => ev.changes(d, inFlightOf(start), 43, "tab1"),
      closed,
      opened,
      (d) => ev.snapshot(d, server),
      (d) => ev.ack(d, "c1", 43),
    ]);
    expect(d.inFlight).toBeNull();
    expect(d.confirmed.seq).toBe(43);
    expect(notices.map((n) => n.type)).toEqual(["offline", "resynced", "accepted"]);
  });

  it("an early ack, then the snapshot, then the resend's ack", () => {
    const start = pending();
    const server = serverWith(start);
    const { d, notices, effects } = run(start, [
      (d) => ev.ack(d, "c1", 43), // ahead: ignored, snapshot requested
      (d) => ev.snapshot(d, server),
      (d) => ev.ack(d, "c1", 43),
    ]);
    expect(d.inFlight).toBeNull();
    expect(notices.map((n) => n.type)).toEqual(["resynced", "accepted"]);
    expect(effects.map((e) => e.type)).toEqual(["workspace", "submit"]);
  });

  it("a remote change to the same joint, then the rejection: visible equals confirmed", () => {
    const start = pending();
    const corner = jointAt(start.confirmed.doc, { x: 6, y: 4 });
    const bob = changesetFor(start.confirmed.doc, start.confirmed.versions, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 5 } }] }, "b1");
    const { d, notices } = run(start, [
      (d) => ev.changes(d, bob, 43),
      (d) => ev.rejected(d, "c1", { kind: "conflict", entities: [{ table: "joints", id: corner }] }),
    ]);
    expect(d.visible).toBe(d.confirmed.doc);
    expect(pointOf(d.visible, corner)).toEqual({ x: 6, y: 5 });
    expect(notices.map((n) => n.type)).toEqual(["remoteChange", "rejected"]);
  });

  it("a response from the previous generation is ignored after a resync", () => {
    const start = pending();
    const { d, notices } = run(start, [closed, opened, () => ev.ack(start, "c1", 42, start.generation)]);
    expect(d.inFlight?.id).toBe("c1");
    expect(d.connection).toBe("syncing");
    expect(notices.map((n) => n.type)).toEqual(["offline"]);
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/editor test shared-scenarios`
Expected: PASS (5 tests).

- [x] **Step 3: Check and commit**

```bash
pnpm check
git add packages/editor/test/shared-scenarios.test.ts
git commit -m "editor: shared document event-sequence scenarios (§9.1)"
```

---

### Task 7.4: One wire mapping for every shell

The web adapter and the sync-test harness must translate the protocol the same way:

- `projects`, `projectCreated` and `error` become workspace events; every other server message becomes a server event, including `openFailed`, which the session matches against the open in progress like a snapshot;
- `workspace`, `submit` and `presence` effects become client messages.

The mapping is pure, so it lives once in `@fm/editor/src/ports/wire.ts` next to the ports it translates.

**Files:** Create `packages/editor/src/ports/wire.ts`, `packages/editor/test/wire.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/wire.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@fm/protocol";
import { clientMessageFor, serverMessageEvent } from "../src/ports/wire";

const changeset = { id: "c1", patch: { puts: [], deletes: [{ table: "joints" as const, id: "j1" }] }, expect: [{ table: "joints" as const, id: "j1", lastCs: "c0" }] };

describe("wire mappings (one translation for every shell)", () => {
  it("turns workspace replies into workspace events", () => {
    const meta = { id: "p1", name: "Apartment" };
    expect(serverMessageEvent({ type: "projects", requestId: "r1", items: [meta] })).toEqual({
      type: "workspaceEvent", event: { type: "projects", requestId: "r1", items: [meta] },
    });
    expect(serverMessageEvent({ type: "projectCreated", requestId: "r2", meta })).toEqual({
      type: "workspaceEvent", event: { type: "created", requestId: "r2", meta },
    });
    expect(serverMessageEvent({ type: "error", requestId: null, message: "Message is not JSON" })).toEqual({
      type: "workspaceEvent", event: { type: "failed", requestId: null, message: "Message is not JSON" },
    });
  });

  it("passes identity, project and presence messages through as server events", () => {
    const messages: ServerMessage[] = [
      { type: "welcome", clientId: "tab1", color: "#e5484d" },
      { type: "openFailed", projectId: "p1", generation: "g1", message: "Unknown project" },
      { type: "ack", projectId: "p1", generation: "g1", changesetId: "c1", seq: 3 },
      { type: "presenceLeft", projectId: "p1", generation: "g1", clientId: "bob" },
    ];
    for (const m of messages) expect(serverMessageEvent(m)).toEqual({ type: "serverEvent", event: m });
  });

  it("turns effects into client messages", () => {
    expect(clientMessageFor({ type: "workspace", op: { type: "list", requestId: "r1" } })).toEqual({ type: "listProjects", requestId: "r1" });
    expect(clientMessageFor({ type: "workspace", op: { type: "create", requestId: "r2", name: "Apartment" } })).toEqual({
      type: "createProject", requestId: "r2", name: "Apartment",
    });
    expect(clientMessageFor({ type: "workspace", op: { type: "open", projectId: "p1", generation: "g1" } })).toEqual({
      type: "openProject", projectId: "p1", generation: "g1",
    });
    expect(clientMessageFor({ type: "submit", projectId: "p1", generation: "g1", changeset })).toEqual({
      type: "submit", projectId: "p1", generation: "g1", changeset,
    });
    expect(clientMessageFor({ type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1, y: 2 }, selection: [] })).toEqual({
      type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1, y: 2 }, selection: [],
    });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test wire`
Expected: FAIL, `Cannot find module '../src/ports/wire'`.

- [x] **Step 3: Implement** `packages/editor/src/ports/wire.ts`

```ts
import { assertNever, type ClientMessage, type ServerMessage } from "@fm/protocol";
import type { Effect } from "./effects";
import type { Event } from "./events";

// Shells translate the protocol with these two functions (web adapter, sync tests). Pure, so they live in the core.

export type ServerEffect = Extract<Effect, { type: "workspace" | "submit" | "presence" }>;

export function serverMessageEvent(msg: ServerMessage): Event {
  switch (msg.type) {
    case "projects":
      return { type: "workspaceEvent", event: { type: "projects", requestId: msg.requestId, items: msg.items } };
    case "projectCreated":
      return { type: "workspaceEvent", event: { type: "created", requestId: msg.requestId, meta: msg.meta } };
    case "error":
      return { type: "workspaceEvent", event: { type: "failed", requestId: msg.requestId, message: msg.message } };
    case "welcome":
    case "snapshot":
    case "openFailed":
    case "changes":
    case "ack":
    case "rejected":
    case "presence":
    case "presenceLeft":
      return { type: "serverEvent", event: msg };
    default:
      return assertNever(msg);
  }
}

export function clientMessageFor(effect: ServerEffect): ClientMessage {
  switch (effect.type) {
    case "workspace": {
      const op = effect.op;
      switch (op.type) {
        case "list":
          return { type: "listProjects", requestId: op.requestId };
        case "create":
          return { type: "createProject", requestId: op.requestId, name: op.name };
        case "open":
          return { type: "openProject", projectId: op.projectId, generation: op.generation };
        default:
          return assertNever(op);
      }
    }
    case "submit":
      return { type: "submit", projectId: effect.projectId, generation: effect.generation, changeset: effect.changeset };
    case "presence":
      return { type: "presence", projectId: effect.projectId, generation: effect.generation, cursor: effect.cursor, selection: effect.selection };
    default:
      return assertNever(effect);
  }
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test wire`
Expected: PASS (3 tests).

- [x] **Step 5: Record it in design memory.** Add to `docs/design-memory/architecture.md` Decisions, with today's date:

```markdown
| The protocol ↔ port translation (server message → editor event, effect → client message) lives once in `@fm/editor/src/ports/wire.ts`; the WebSocket adapter and the sync-test harness both use it (<date>) | Two shells must not drift; the mapping is pure | §5.2, §7.2 |
```

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/editor docs/design-memory/architecture.md docs/plans/flatmate/phase-7-collaboration.md
git commit -m "editor: one wire mapping between protocol messages and editor ports"
```

---
### Task 7.5: Session: project list, opening, connection and presence (and the FakeRemote harness)

`session.ts` replaces the phase 3 stubs. It holds the rules around a document, never the document rules themselves:

- **Connection open.** With no document, the session refreshes the project list and repeats a pending open under a new generation. With a document open, the document reopens itself (Task 7.2).
- **Opening.** Creating a project opens it at once. The first snapshot for `workspace.opening` creates the `SharedDocument`; any other snapshot is ignored (P7). An `openFailed` is matched the same way: for `workspace.opening` it ends the open and shows its message in the list; for any other project or generation it is ignored, so a late failure cannot cancel a newer open. A workspace `failed` (from `error`) shows its message but never touches `workspace.opening` (revised 2026-09-28).
- **Leaving.** Leaving the drawing, for another project or for the list, is refused with a toast while an edit is outstanding. Switching waits for settlement (§7.2.1) and is not queued.
- **Identity and presence.** `welcome` sets the colour. Presence is kept for the current project and generation only, is cleared on every connection change and every open (it is not replayed, §7.2.1), and is sent on pointer moves while connected.

`FakeRemote` is the harness for editor-only tests. It keeps the server's copy of the drawing and answers only when the test asks, so the pending paths of every tool are testable.

**Files:** Replace `packages/editor/src/session.ts`. Create `packages/editor/test/fake-remote.ts`, `packages/editor/test/session.test.ts`.

- [x] **Step 1: Write the harness** `packages/editor/test/fake-remote.ts`

```ts
import { applyPatch, emptyDocument, execute, toStored, type Command, type Document } from "@fm/domain";
import {
  buildExpectations, patchWrites, stampVersions, uniqueKeys, unwrap, type Changeset, type RejectReason, type VersionMap,
} from "@fm/protocol";
import type { ServerEvent } from "../src/ports/events";
import { serverState } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { PROJECT, versionsFor } from "./shared-builders";

/**
 * A scripted server for editor-only tests. It keeps the server's copy of the drawing (doc, versions, seq)
 * and sends nothing until the test says so, so every pending path can be driven step by step.
 * It does not validate or check expectations: the tests decide the outcome (the real server is in @fm/sync-tests).
 */
export class FakeRemote {
  readonly shell: FakeShell;
  doc: Document;
  versions: VersionMap;
  seq = 0;
  private bobEdits = 0;

  private constructor(shell: FakeShell, doc: Document) {
    this.shell = shell;
    this.doc = doc;
    this.versions = versionsFor(doc, "c0");
  }

  /** A server-mode editor with `doc` open as project p1 "Apartment": connected, seq 0, every entity at version c0. */
  static open(doc: Document = emptyDocument()): FakeRemote {
    const host = new FakeHost();
    const remote = new FakeRemote(new FakeShell(serverState(host), host), doc);
    remote.event({ type: "connection", state: "open" });
    remote.shell.ui({ type: "openProject", id: PROJECT.id });
    remote.snapshot();
    return remote;
  }

  event(e: ServerEvent): void {
    this.shell.send({ type: "serverEvent", event: e });
  }

  /** The generation of the editor's latest open or resync request. */
  generation(): string {
    const opens = this.shell.effectsOf("workspace").flatMap((e) => (e.op.type === "open" ? [e.op.generation] : []));
    const last = opens[opens.length - 1];
    if (last === undefined) throw new Error("the editor has not asked to open the project");
    return last;
  }

  /** The server's full state for the latest generation. */
  snapshot(): void {
    this.event({
      type: "snapshot", projectId: PROJECT.id, generation: this.generation(), meta: PROJECT,
      doc: toStored(this.doc), versions: this.versions, seq: this.seq,
    });
  }

  submits(): Changeset[] {
    return this.shell.effectsOf("submit").map((e) => e.changeset);
  }

  last(): Changeset {
    const all = this.submits();
    const cs = all[all.length - 1];
    if (!cs) throw new Error("nothing was submitted");
    return cs;
  }

  /** Accept a submission: apply it, broadcast it back to its sender, then acknowledge it (spec §7.2). */
  accept(cs: Changeset = this.last()): void {
    this.apply(cs);
    this.event({ type: "changes", projectId: PROJECT.id, generation: this.generation(), seq: this.seq, changeset: cs, clientId: this.shell.state.me.clientId });
    this.event({ type: "ack", projectId: PROJECT.id, generation: this.generation(), changesetId: cs.id, seq: this.seq });
  }

  reject(cs: Changeset = this.last(), reason: RejectReason = { kind: "conflict", entities: [] }): void {
    this.event({ type: "rejected", projectId: PROJECT.id, generation: this.generation(), changesetId: cs.id, reason });
  }

  /** Bob's edit: executed on the server's copy, accepted and broadcast to the editor. */
  remote(cmd: Command): Changeset {
    const r = unwrap(execute(this.doc, cmd));
    this.bobEdits += 1;
    const keys = uniqueKeys([...patchWrites(r.patch), ...r.patch.dependencies]);
    const cs: Changeset = {
      id: `bob${this.bobEdits}`,
      patch: { puts: r.patch.puts, deletes: r.patch.deletes },
      expect: buildExpectations(this.versions, keys),
    };
    this.apply(cs);
    this.event({ type: "changes", projectId: PROJECT.id, generation: this.generation(), seq: this.seq, changeset: cs, clientId: "bob" });
    return cs;
  }

  disconnect(): void {
    this.event({ type: "connection", state: "closed" });
  }

  /** The connection returns: the editor reopens with a new generation and the server answers with a snapshot. */
  reconnect(): void {
    this.event({ type: "connection", state: "open" });
    this.snapshot();
  }

  private apply(cs: Changeset): void {
    this.doc = unwrap(applyPatch(this.doc, cs.patch));
    this.versions = stampVersions(this.versions, cs.patch, cs.id);
    this.seq += 1;
  }
}
```

- [x] **Step 2: Write the failing test** `packages/editor/test/session.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { toStored } from "@fm/domain";
import type { ServerEvent, WorkspaceEvent } from "../src/ports/events";
import { LEAVE_BLOCKED, NAME_REQUIRED, OFFLINE_LIST } from "../src/session";
import { jointAt, pointOf, roomDoc, serverState } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeHost, FakeShell } from "./fake-shell";
import { PROJECT, versionsFor } from "./shared-builders";

function serverShell(): FakeShell {
  const host = new FakeHost();
  return new FakeShell(serverState(host), host);
}

const server = (shell: FakeShell, event: ServerEvent): void => void shell.send({ type: "serverEvent", event });
const workspace = (shell: FakeShell, event: WorkspaceEvent): void => void shell.send({ type: "workspaceEvent", event });

function lastOpen(shell: FakeShell): { type: "open"; projectId: string; generation: string } {
  const opens = shell.effectsOf("workspace").flatMap((e) => (e.op.type === "open" ? [e.op] : []));
  const last = opens[opens.length - 1];
  if (!last) throw new Error("no open effect");
  return last;
}

function snapshotFor(open: { projectId: string; generation: string }, name = "Apartment"): ServerEvent {
  const doc = roomDoc();
  return {
    type: "snapshot", projectId: open.projectId, generation: open.generation, meta: { id: open.projectId, name },
    doc: toStored(doc), versions: versionsFor(doc, "c0"), seq: 0,
  };
}

function openFailedFor(open: { projectId: string; generation: string }): ServerEvent {
  return { type: "openFailed", projectId: open.projectId, generation: open.generation, message: "Unknown project" };
}

function presenceOf(r: FakeRemote, clientId: string, generation = r.generation()): ServerEvent {
  return { type: "presence", projectId: "p1", generation, clientId, name: clientId === "bob" ? "Bob" : clientId, color: "#30a46c", cursor: { x: 1, y: 2 }, selection: [] };
}

describe("session: project list and opening (spec §7.2.1)", () => {
  it("asks for the project list when the connection opens", () => {
    const shell = serverShell();
    expect(shell.view().projectList).toEqual({ items: [], loading: true, error: null });
    server(shell, { type: "connection", state: "open" });
    expect(shell.effectsOf("workspace")).toEqual([{ type: "workspace", op: { type: "list", requestId: "id1" } }]);
  });

  it("shows the projects the server lists", () => {
    const shell = serverShell();
    workspace(shell, { type: "projects", requestId: "id1", items: [PROJECT] });
    expect(shell.view().projectList).toEqual({ items: [PROJECT], loading: false, error: null });
    expect(shell.view().project).toBeNull();
  });

  it("creates a project by name and opens it as soon as it is created", () => {
    const shell = serverShell();
    shell.ui({ type: "createProject", name: "  Apartment " });
    expect(shell.effectsOf("workspace")).toEqual([{ type: "workspace", op: { type: "create", requestId: "id1", name: "Apartment" } }]);
    workspace(shell, { type: "created", requestId: "id1", meta: PROJECT });
    expect(lastOpen(shell)).toEqual({ type: "open", projectId: "p1", generation: "id2" });
    expect(shell.state.workspace.opening).toEqual({ projectId: "p1", generation: "id2" });
    expect(shell.view().projectList).toEqual({ items: [PROJECT], loading: true, error: null });
  });

  it("refuses an empty project name", () => {
    const shell = serverShell();
    shell.ui({ type: "createProject", name: "   " });
    expect(shell.effectsOf("workspace")).toEqual([]);
    expect(shell.view().toast).toBe(NAME_REQUIRED);
  });

  it("opens the drawing when the snapshot for its generation arrives", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    server(shell, snapshotFor(lastOpen(shell)));
    expect(shell.state.document?.kind).toBe("shared");
    expect(shell.view().projectList).toBeNull();
    expect(shell.view().project).toEqual({ name: "Apartment", status: "saved", dirty: false, canEdit: true });
    expect(shell.state.workspace.opening).toBeNull();
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
  });

  it("ignores a snapshot that does not answer the current open", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    const first = lastOpen(shell);
    shell.ui({ type: "openProject", id: "p2" });
    server(shell, snapshotFor(first));
    expect(shell.state.document).toBeNull();
    server(shell, snapshotFor(lastOpen(shell), "Kitchen"));
    expect(shell.view().project?.name).toBe("Kitchen");
  });

  it("shows a failed open in the list", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "missing" });
    server(shell, openFailedFor(lastOpen(shell)));
    expect(shell.view().projectList).toEqual({ items: [], loading: false, error: "Unknown project" });
    expect(shell.state.workspace.opening).toBeNull();
  });

  it("ignores a failed open that does not answer the current open", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "missing" });
    const first = lastOpen(shell);
    shell.ui({ type: "openProject", id: "p2" });
    const second = lastOpen(shell);
    server(shell, openFailedFor(first));
    expect(shell.state.workspace.opening).toEqual({ projectId: "p2", generation: second.generation });
    expect(shell.view().projectList?.error).toBeNull();
    server(shell, snapshotFor(second, "Kitchen"));
    expect(shell.view().project?.name).toBe("Kitchen");
  });

  it("keeps a pending open when an unrelated error arrives", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    const open = lastOpen(shell);
    workspace(shell, { type: "failed", requestId: null, message: "Message is not JSON" });
    expect(shell.view().projectList?.error).toBe("Message is not JSON");
    expect(shell.state.workspace.opening).toEqual({ projectId: "p1", generation: open.generation });
    server(shell, snapshotFor(open));
    expect(shell.view().project?.name).toBe("Apartment");
  });

  it("has no project list in local mode", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "showProjectList" });
    shell.ui({ type: "createProject", name: "Apartment" });
    expect(shell.state.document?.kind).toBe("local");
    expect(shell.effectsOf("workspace")).toEqual([]);
  });
});

describe("session: an open shared drawing", () => {
  it("FakeRemote: a drag is shown at once and saved when the server accepts it", () => {
    const r = FakeRemote.open(roomDoc());
    const corner = jointAt(r.shell.doc(), { x: 6, y: 4 });
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(r.shell.view().project?.status).toBe("waiting for server");
    r.accept();
    expect(r.shell.view().project?.status).toBe("saved");
    expect(r.shell.state.undo.past.map((e) => e.status)).toEqual(["usable"]);
  });

  it("does not leave the drawing while an edit is outstanding; leaving clears its history", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    r.shell.ui({ type: "showProjectList" });
    expect(r.shell.view().toast).toBe(LEAVE_BLOCKED);
    r.shell.ui({ type: "openProject", id: "p2" });
    expect(r.shell.state.document?.kind).toBe("shared");
    r.accept();
    r.shell.ui({ type: "showProjectList" });
    expect(r.shell.state.document).toBeNull();
    expect(r.shell.state.undo).toEqual({ past: [], future: [], pending: null });
    expect(r.shell.effectsOf("workspace").at(-1)?.op.type).toBe("list");
  });

  it("takes its colour from the server's welcome", () => {
    const shell = serverShell();
    server(shell, { type: "welcome", clientId: "tab1", color: "#0090ff" });
    expect(shell.state.me.color).toBe("#0090ff");
  });

  it("tracks the other clients' cursors for the open project only", () => {
    const r = FakeRemote.open(roomDoc());
    r.event(presenceOf(r, "bob"));
    r.event(presenceOf(r, "tab1")); // my own echo
    r.event(presenceOf(r, "carol", "an-older-open"));
    expect(r.shell.view().presence).toEqual([{ clientId: "bob", name: "Bob", color: "#30a46c", at: { x: 1, y: 2 } }]);
    r.event({ type: "presenceLeft", projectId: "p1", generation: r.generation(), clientId: "bob" });
    expect(r.shell.view().presence).toEqual([]);
  });

  it("sends presence on pointer moves while connected, and never in local mode", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.moveTo({ x: 1, y: 1 });
    expect(r.shell.effectsOf("presence").at(-1)).toEqual({
      type: "presence", projectId: "p1", generation: r.generation(), cursor: { x: 1, y: 1 }, selection: [],
    });
    const sent = r.shell.effectsOf("presence").length;
    r.disconnect();
    r.shell.moveTo({ x: 2, y: 2 });
    expect(r.shell.effectsOf("presence")).toHaveLength(sent);
    const local = FakeShell.local();
    local.moveTo({ x: 1, y: 1 });
    expect(local.effectsOf("presence")).toEqual([]);
  });
});

describe("session: connection changes", () => {
  it("shows the list as offline; on reconnect it refreshes the list and repeats a pending open", () => {
    const shell = serverShell();
    shell.ui({ type: "openProject", id: "p1" });
    const before = lastOpen(shell);
    server(shell, { type: "connection", state: "closed" });
    expect(shell.view().projectList?.error).toBe(OFFLINE_LIST);
    server(shell, { type: "connection", state: "open" });
    const after = lastOpen(shell);
    expect(after.projectId).toBe("p1");
    expect(after.generation).not.toBe(before.generation);
    expect(shell.state.workspace.opening).toEqual({ projectId: "p1", generation: after.generation });
    expect(shell.effectsOf("workspace").some((e) => e.op.type === "list")).toBe(true);
    expect(shell.view().projectList?.error).toBeNull();
  });

  it("reopens an open drawing after a reconnect and forgets the others' cursors", () => {
    const r = FakeRemote.open(roomDoc());
    r.event(presenceOf(r, "bob"));
    const generation = r.generation();
    r.disconnect();
    expect(r.shell.view().project?.status).toBe("offline");
    expect(r.shell.view().presence).toEqual([]);
    r.event({ type: "connection", state: "open" });
    expect(r.generation()).not.toBe(generation);
    expect(r.shell.view().project?.status).toBe("waiting for server");
    r.snapshot();
    expect(r.shell.view().project?.status).toBe("saved");
  });
});
```

- [x] **Step 3: Run it and see it fail**

Run: `pnpm --filter @fm/editor test session`
Expected: FAIL. The phase 3 stubs ignore everything; the first failure is `expected [] to deeply equal [ { type: 'workspace', … } ]`.

- [x] **Step 4: Replace** `packages/editor/src/session.ts`

```ts
import { assertNever } from "@fm/protocol";
import { hasPendingEdit, onEvent, sessionOf } from "./document/open-document";
import { sharedFromSnapshot, type SnapshotEvent } from "./document/shared-document";
import { emptyHistory } from "./history/history";
import { applyNotices } from "./notices";
import type { Effect } from "./ports/effects";
import type { ServerEvent, UiAction, WorkspaceEvent } from "./ports/events";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";
import { showToast } from "./toast";
import { idleTool } from "./tools/types";

// Project list, opening, connection, identity and presence (spec §7.2.1, §7.6).
// Document rules stay in open-document; this module only routes events to it.

export type WorkspaceUiAction = Extract<UiAction, { type: "createProject" | "openProject" | "showProjectList" }>;

export const OFFLINE_LIST = "Offline: reconnecting…";
export const LEAVE_BLOCKED = "Waiting for server: try again when the edit is saved";
export const NAME_REQUIRED = "Type a project name";

type PresenceEvent = Extract<ServerEvent, { type: "presence" }>;
type OpenFailedEvent = Extract<ServerEvent, { type: "openFailed" }>;

export function onWorkspaceEvent(state: EditorState, event: WorkspaceEvent, host: Host): Step {
  switch (event.type) {
    case "projects":
      return { state: { ...state, workspace: { ...state.workspace, projects: event.items, loading: false, error: null } }, effects: [] };
    case "created": {
      const listed = { ...state, workspace: { ...state.workspace, projects: [...state.workspace.projects, event.meta] } };
      return openProject(listed, event.meta.id, host); // creating a project opens it
    }
    case "failed": {
      // Never touches `opening`: an error is not tied to an open, and a late one must not cancel a newer open.
      const failed = { ...state, workspace: { ...state.workspace, loading: false, error: event.message } };
      return failed.document ? showToast(failed, event.message, host) : { state: failed, effects: [] };
    }
    default:
      return assertNever(event);
  }
}

export function onServerEvent(state: EditorState, event: ServerEvent, host: Host): Step {
  switch (event.type) {
    case "welcome":
      return { state: { ...state, me: { ...state.me, color: event.color } }, effects: [] };
    case "presence":
      return { state: withPresence(state, event), effects: [] };
    case "presenceLeft": {
      if (!isCurrent(state, event)) return { state, effects: [] };
      const { [event.clientId]: _left, ...rest } = state.presence;
      return { state: { ...state, presence: rest }, effects: [] };
    }
    case "connection":
      return onConnection(state, event.state, host);
    case "snapshot":
      return state.document ? documentEvent(state, event, host) : openFromSnapshot(state, event);
    case "openFailed":
      return openFailed(state, event);
    case "changes":
    case "ack":
    case "rejected":
      return documentEvent(state, event, host);
    default:
      return assertNever(event);
  }
}

export function onWorkspaceUi(state: EditorState, action: WorkspaceUiAction, host: Host): Step {
  if (state.mode === "local") return { state, effects: [] }; // one unsaved drawing and no project list (§7.0)
  switch (action.type) {
    case "createProject": {
      const name = action.name.trim();
      if (name === "") return showToast(state, NAME_REQUIRED, host);
      return { state, effects: [{ type: "workspace", op: { type: "create", requestId: host.newId(), name } }] };
    }
    case "openProject":
      return leaveRefused(state, host) ?? openProject(state, action.id, host);
    case "showProjectList":
      return leaveRefused(state, host) ?? showList(state, host);
    default:
      return assertNever(action);
  }
}

/** Presence after a pointer move, only while a shared document is connected (§7.6). The adapter throttles it. */
export function pointerPresence(state: EditorState): Effect[] {
  const session = state.document ? sessionOf(state.document) : null;
  if (!session || !session.connected) return [];
  return [{
    type: "presence", projectId: session.projectId, generation: session.generation,
    cursor: state.pointer?.world ?? null, selection: state.selection,
  }];
}

/** Events for the open document go through open-document; its notices reach history and tools. */
function documentEvent(state: EditorState, event: ServerEvent, host: Host): Step {
  const d = state.document;
  if (!d) return { state, effects: [] };
  const step = onEvent(d, event, host);
  if (step.doc === d && step.effects.length === 0 && step.notices.length === 0) return { state, effects: [] };
  const after = applyNotices({ ...state, document: step.doc }, step.notices, host);
  return { state: after.state, effects: [...step.effects, ...after.effects] };
}

/** A new connection is a new server session: presence is not replayed (§7.2.1). */
function onConnection(state: EditorState, connection: "open" | "closed", host: Host): Step {
  const cleared: EditorState = { ...state, presence: {} };
  if (state.document) return documentEvent(cleared, { type: "connection", state: connection }, host);
  if (connection === "closed") {
    return { state: { ...cleared, workspace: { ...cleared.workspace, loading: false, error: OFFLINE_LIST } }, effects: [] };
  }
  const effects: Effect[] = [{ type: "workspace", op: { type: "list", requestId: host.newId() } }];
  let workspace = { ...cleared.workspace, loading: true, error: null };
  const opening = cleared.workspace.opening;
  if (opening) {
    const generation = host.newId(); // the new session knows nothing of the old open
    workspace = { ...workspace, opening: { projectId: opening.projectId, generation } };
    effects.push({ type: "workspace", op: { type: "open", projectId: opening.projectId, generation } });
  }
  return { state: { ...cleared, workspace }, effects };
}

/** Whether a reply answers the open in progress: same project and generation (§7.2.1). */
function answersOpening(state: EditorState, e: { projectId: string; generation: string }): boolean {
  const opening = state.workspace.opening;
  return opening !== null && opening.projectId === e.projectId && opening.generation === e.generation;
}

/** The first snapshot for the generation being opened creates the shared document (§7.0, P7). */
function openFromSnapshot(state: EditorState, e: SnapshotEvent): Step {
  if (!answersOpening(state, e)) return { state, effects: [] };
  return {
    state: {
      ...closeDocument(state),
      document: sharedFromSnapshot(e),
      workspace: { ...state.workspace, loading: false, error: null, opening: null },
    },
    effects: [],
  };
}

/**
 * The server could not open the project this generation asked for; a reply to any other open is stale (§7.2.1).
 * No drawing is open while `opening` is set (opening closed it), so the message goes to the list, not a toast.
 */
function openFailed(state: EditorState, e: OpenFailedEvent): Step {
  if (!answersOpening(state, e)) return { state, effects: [] };
  return { state: { ...state, workspace: { ...state.workspace, loading: false, error: e.message, opening: null } }, effects: [] };
}

/** Switching waits for the outstanding submission to settle (§7.2.1); it is refused, never queued. */
function leaveRefused(state: EditorState, host: Host): Step | null {
  return state.document && hasPendingEdit(state.document) ? showToast(state, LEAVE_BLOCKED, host) : null;
}

function openProject(state: EditorState, projectId: string, host: Host): Step {
  const generation = host.newId();
  const closed = closeDocument(state);
  return {
    state: { ...closed, workspace: { ...closed.workspace, loading: true, error: null, opening: { projectId, generation } } },
    effects: [{ type: "workspace", op: { type: "open", projectId, generation } }],
  };
}

function showList(state: EditorState, host: Host): Step {
  const closed = closeDocument(state);
  return {
    state: { ...closed, workspace: { ...closed.workspace, loading: true, error: null, opening: null } },
    effects: [{ type: "workspace", op: { type: "list", requestId: host.newId() } }],
  };
}

/** Opening or leaving a drawing clears gestures, selection, presence and history (§7.0, §7.2.1). */
function closeDocument(state: EditorState): EditorState {
  return {
    ...state,
    document: null,
    tool: idleTool(state.tool.name),
    selection: [],
    hover: null,
    snap: null,
    undo: emptyHistory,
    presence: {},
  };
}

function isCurrent(state: EditorState, e: { projectId: string; generation: string }): boolean {
  const session = state.document ? sessionOf(state.document) : null;
  return session !== null && session.projectId === e.projectId && session.generation === e.generation;
}

function withPresence(state: EditorState, e: PresenceEvent): EditorState {
  if (!isCurrent(state, e) || e.clientId === state.me.clientId) return state;
  return {
    ...state,
    presence: {
      ...state.presence,
      [e.clientId]: { clientId: e.clientId, name: e.name, color: e.color, cursor: e.cursor, selection: e.selection },
    },
  };
}
```

`_left` is the removed entry; the `_` prefix keeps ESLint's unused-variable rule quiet (phase 3 Task 3.2).

- [x] **Step 5: Run it and see it pass**

Run: `pnpm --filter @fm/editor test session`
Expected: PASS (17 tests). Then run the whole editor suite to confirm the phase 3 and 5 tests still pass: `pnpm --filter @fm/editor test`.

- [x] **Step 6: Record the decisions in design memory.** Add to the Decisions table of `docs/design-memory/open-documents.md`, with today's date:

```markdown
| Session rules (`session.ts`): creating a project opens it; a snapshot or `openFailed` counts only if it matches `workspace.opening`, and a workspace `failed` never touches it; with no drawing open, a reconnect refreshes the list and repeats a pending open under a new generation; opening or leaving clears gestures, selection, presence and history; leaving while an edit is outstanding is refused with a toast, not queued; presence is cleared on every connection change (<date>) | §7.2.1 says switching waits for settlement; a refusal is the simplest waiting that never replays input | §7.2.1, §7.6 |
| A shared document is dirty while an edit is outstanding (its outcome would be lost on close) (<date>) | The before-close warning then covers the one case where closing loses tracking (§7.7) | §7.0, §7.7 |
```

Add a sprint-log row.

- [x] **Step 7: Check and commit**

```bash
pnpm check
git add packages/editor docs/design-memory/open-documents.md docs/plans/flatmate/phase-7-collaboration.md
git commit -m "editor: session for the project list, opening, connection and presence; FakeRemote test harness"
```

---

### Task 7.6: Tools react to notices (pause and resume, remote changes, snapshots, disconnects)

`gestures.ts` holds every tool reaction to a document notice; `notices.ts` only routes to it. The rules:

- **`accepted` for the paused segment** runs the resume rule (§5.5). First the anchor is checked: a joint must still be at the origin. Then the preview is recomputed at the current cursor. An invalid preview is drawn red and does not end the chain.
- **`rejected` for the paused segment** ends the chain; the rejection toast explains why.
- **`remoteChange`.** A topology change cancels every active geometry gesture. Otherwise a gesture is cancelled only if the remote writes overlap its dependencies, and rerun on the new document if they do not (§5.7). The dependencies are:
  - drag: the moved joints and their incident walls;
  - helper resize: the wall, both endpoints and the walls at the moving end;
  - paused chain: its pending segment's history dependencies;
  - drawing chain: its origin joint. The `drawing` state stores a point, not a joint ID, so the check is by position. Once the chain has placed a wall, a joint must still be at the origin.
- **`resynced` and `offline`** cancel every active gesture: a snapshot always does (§5.7), and a lost connection does (P8).

Messages: "Drawing changed remotely — wall chain ended" when a chain ends (§5.5), "Drawing changed remotely" for other gestures (§5.7), and "Connection lost: editing resumes when it returns".

Two small fixes go with this:

- `placePoint` treats a same-step rejection as a refusal. The local `tooLarge` guard of Task 7.1 rejects inside `runCommand`, so the history entry is already gone when `placePoint` looks for it.
- `rerunMove` lets a drag rerun on the new visible document.

**Files:** Create `packages/editor/src/gestures.ts`. Replace `packages/editor/src/notices.ts`. Modify `packages/editor/src/history/history.ts`, `packages/editor/src/tools/wall-tool.ts`, `packages/editor/src/tools/select-tool.ts`. Create `packages/editor/test/shared-tools.test.ts`, `packages/editor/test/remote-gestures.test.ts`.

- [x] **Step 1: Write the failing wall-chain tests** `packages/editor/test/shared-tools.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MESSAGES, emptyDocument, type Document } from "@fm/domain";
import { CHAIN_ENDED, CONNECTION_LOST } from "../src/gestures";
import { COLORS } from "../src/view/colors";
import { jointAt, pointOf, wallDoc } from "./builders";
import { FakeRemote } from "./fake-remote";
import type { FakeShell } from "./fake-shell";

function wall(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "wall") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

/** Wall tool, first point (0, 0), first segment to (2, 0) submitted: the chain is paused. */
function pausedChain(doc: Document = emptyDocument()): FakeRemote {
  const r = FakeRemote.open(doc);
  r.shell.key("w");
  r.shell.click({ x: 0, y: 0 });
  r.shell.click({ x: 2, y: 0 });
  return r;
}

describe("wall chain on a shared document (spec §5.5 pause and resume)", () => {
  it("pauses after each submitted segment and ignores input without queueing it", () => {
    const r = pausedChain();
    expect(wall(r.shell)).toEqual({ kind: "paused", origin: { x: 2, y: 0 }, chainStart: { x: 0, y: 0 }, segment: r.last().id });
    expect(r.shell.view().commandBar.prompt).toBe("Waiting for server");
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(1); // shown at once
    r.shell.click({ x: 2, y: 2 });
    r.shell.type("3");
    r.shell.key("Enter");
    r.shell.key(" ");
    expect(r.submits()).toHaveLength(1);
    expect(wall(r.shell).kind).toBe("paused");
  });

  it("acceptance resumes drawing from the segment's end with a fresh preview and the same chainStart", () => {
    const r = pausedChain();
    r.shell.moveTo({ x: 2, y: 1.6 });
    r.accept();
    const t = wall(r.shell);
    expect(t).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, chainStart: { x: 0, y: 0 }, value: "" });
    expect(t.kind === "drawing" && t.preview?.ok).toBe(true);
    expect(r.shell.view().project?.status).toBe("saved");
  });

  it("closes a paused-and-resumed chain by clicking its first joint", () => {
    const r = pausedChain();
    r.accept();
    r.shell.click({ x: 2, y: 2 });
    r.accept();
    r.shell.click({ x: 0, y: 2 });
    r.accept();
    r.shell.click({ x: 0, y: 0 });
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    r.accept();
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(4);
    expect(Object.keys(r.shell.doc().joints)).toHaveLength(4);
    expect(r.submits()).toHaveLength(4);
  });

  it("a rejection ends the chain, removes the wall and explains why", () => {
    const r = pausedChain();
    r.reject();
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.doc().walls).toEqual({});
    expect(r.shell.view().toast).toBe("Someone else changed this first");
    expect(r.shell.state.undo.past).toEqual([]);
  });

  it("a remote topology change ends the paused chain at once; the pending segment still settles", () => {
    const r = pausedChain();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 5, y: 5 } }, to: { at: { x: 7, y: 5 } } });
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(CHAIN_ENDED);
    r.accept();
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(2);
    expect(r.shell.view().project?.status).toBe("saved");
  });

  it("an unrelated move keeps the paused chain; it resumes with a red preview and a click there is refused", () => {
    const r = pausedChain(wallDoc({ x: 5, y: 1 }, { x: 5, y: 3 }));
    r.shell.moveTo({ x: 2, y: 2 });
    const a = jointAt(r.doc, { x: 5, y: 1 });
    const b = jointAt(r.doc, { x: 5, y: 3 });
    r.remote({ type: "moveJoints", moves: [{ jointId: a, to: { x: 1, y: 1 } }, { jointId: b, to: { x: 3, y: 1 } }] });
    expect(wall(r.shell).kind).toBe("paused");
    r.accept();
    const t = wall(r.shell);
    expect(t.kind === "drawing" && t.preview?.ok).toBe(false); // Bob's wall now crosses the path (2,0)→(2,2)
    const overlays = r.shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    expect(overlays.some((p) => p.kind === "segment" && p.color === COLORS.invalid)).toBe(true);
    r.shell.click({ x: 2, y: 2 });
    expect(r.submits()).toHaveLength(1);
    expect(r.shell.view().toast).toBe(MESSAGES.crossing);
    expect(wall(r.shell).kind).toBe("drawing");
  });

  it("Esc while paused returns to idle; the submitted wall still settles", () => {
    const r = pausedChain();
    r.shell.key("Escape");
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    r.accept();
    expect(Object.keys(r.shell.doc().walls)).toHaveLength(1);
    expect(r.shell.view().project?.status).toBe("saved");
  });

  it("a dropped connection ends the paused chain and blocks editing", () => {
    const r = pausedChain();
    r.disconnect();
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(CONNECTION_LOST);
    expect(r.shell.view().project).toMatchObject({ status: "offline", canEdit: false });
  });

  it("draws the demo room with typed lengths against a server that answers later", () => {
    const r = FakeRemote.open();
    const s = r.shell;
    const shift = { shift: true };
    s.key("w");
    s.click({ x: 0, y: 0 }, shift);
    const legs: [{ x: number; y: number }, string][] = [[{ x: 3, y: 0.2 }, "6"], [{ x: 6.2, y: 2 }, "4"], [{ x: 3, y: 4.2 }, "6"]];
    for (const [p, length] of legs) {
      s.moveTo(p, shift);
      s.type(length);
      s.key("Enter");
      expect(wall(s).kind).toBe("paused");
      s.type("9"); // swallowed while paused
      r.accept();
    }
    s.click({ x: 0.02, y: 0.02 }, shift);
    r.accept();
    expect([Object.keys(s.doc().walls).length, Object.keys(s.doc().joints).length]).toEqual([4, 4]);
    expect(pointOf(s.doc(), jointAt(s.doc(), { x: 6, y: 4 }))).toEqual({ x: 6, y: 4 });
    expect(r.submits()).toHaveLength(4);
  });
});
```

In "an unrelated move keeps the paused chain", Bob's move writes only the free wall's joints. Alice's pending segment neither writes nor reads them, and a move is not a topology change, so the chain stays paused.

- [x] **Step 2: Write the failing gesture tests** `packages/editor/test/remote-gestures.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import { jointAt, pointOf, roomDoc, wallBetween } from "./builders";
import { FakeRemote } from "./fake-remote";
import type { FakeShell } from "./fake-shell";

function selectKind(shell: FakeShell): string {
  const t = shell.state.tool;
  return t.name === "select" ? t.state.kind : t.name;
}

/** Press the room's top-right corner and move past the threshold: a drag in progress. */
function dragging(): FakeRemote {
  const r = FakeRemote.open(roomDoc());
  r.shell.moveTo({ x: 6, y: 4 });
  r.shell.down({ x: 6, y: 4 });
  r.shell.moveTo({ x: 6, y: 4.4 });
  return r;
}

describe("gestures and remote changes (spec §5.7)", () => {
  it("a remote write to the dragged joint cancels the drag; releasing commits nothing", () => {
    const r = dragging();
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    expect(selectKind(r.shell)).toBe("moving");
    r.remote({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4.2 } }] });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.up({ x: 6, y: 4.4 });
    expect(r.submits()).toEqual([]);
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.2 });
  });

  it("an unrelated remote move reruns the drag on the new document", () => {
    const r = dragging();
    const origin = jointAt(r.doc, { x: 0, y: 0 });
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    r.remote({ type: "moveJoints", moves: [{ jointId: origin, to: { x: -0.4, y: 0 } }] });
    const t = r.shell.state.tool;
    expect(t.name === "select" && t.state.kind === "moving" && pointOf(t.state.baseDoc, origin)).toEqual({ x: -0.4, y: 0 });
    r.shell.moveTo({ x: 6, y: 4.6 });
    r.shell.up({ x: 6, y: 4.6 });
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(pointOf(r.shell.doc(), origin)).toEqual({ x: -0.4, y: 0 });
  });

  it("any remote topology change cancels the drag", () => {
    const r = dragging();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a snapshot cancels the drag", () => {
    const r = dragging();
    r.snapshot();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a dropped connection cancels the drag, and no new drag starts while offline", () => {
    const r = dragging();
    r.disconnect();
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(CONNECTION_LOST);
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(r.submits()).toEqual([]);
  });

  it("a resize being typed is cancelled when its wall's fixed endpoint changes remotely", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const fixed = jointAt(r.doc, { x: 6, y: 0 });
    // Phase 5 enters this state from the helper dimension; set it directly to test the §5.7 rule on its own.
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.remote({ type: "moveJoints", moves: [{ jointId: fixed, to: { x: 6.4, y: 0 } }] });
    expect(selectKind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
  });

  it("a resize being typed survives a remote move that does not touch its wall", () => {
    const r = FakeRemote.open(roomDoc());
    const right = wallBetween(r.doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const farCorner = jointAt(r.doc, { x: 0, y: 4 });
    r.shell.state = { ...r.shell.state, tool: { name: "select", state: { kind: "editingHelper", wallId: right, value: "3.5" } } };
    r.remote({ type: "moveJoints", moves: [{ jointId: farCorner, to: { x: -0.4, y: 4 } }] });
    expect(selectKind(r.shell)).toBe("editingHelper");
  });
});
```

The joint at (0, 4) belongs to the left and top walls. The right wall's resize depends on the right wall, (6, 0), (6, 4), and the walls at (6, 4): the right and top walls. The top wall's value does not change when (0, 4) moves, because a wall stores only its endpoint IDs, so the writes do not overlap.

- [x] **Step 3: Run them and see them fail**

Run: `pnpm --filter @fm/editor test shared-tools remote-gestures`
Expected: FAIL, `Cannot find module '../src/gestures'`.

- [x] **Step 4: Add `hasEntry`.** Append to `packages/editor/src/history/history.ts`:

```ts
/** The entry is still in the undo stack (a rejection in the same step removes it). */
export function hasEntry(h: HistoryState, id: string): boolean {
  return h.past.some((e) => e.id === id);
}
```

- [x] **Step 5: Fix `placePoint`.** In `packages/editor/src/tools/wall-tool.ts`, change the history import to:

```ts
import { hasEntry, isPendingEntry } from "../history/history";
```

and in `placePoint` replace the line

```ts
  if (out.committed === null) return { state: out.state, effects: out.effects }; // rejected: tool unchanged, toast shown
```

with

```ts
  // Refused by execute (nothing committed), or rejected by the document in the same step: tool unchanged, toast shown.
  if (out.committed === null || !hasEntry(out.state.undo, out.committed)) return { state: out.state, effects: out.effects };
```

- [x] **Step 6: Add `rerunMove`.** Append to `packages/editor/src/tools/select-tool.ts`:

```ts
/** A remote change that does not touch the drag: rerun it on the new visible document with the same cursor (§5.7). */
export function rerunMove(state: EditorState, tool: Moving): EditorState {
  if (!state.document) return state;
  const baseDoc = visibleDoc(state.document);
  return attemptMove(state, { ...tool, baseDoc, attempt: { ...tool.attempt, doc: baseDoc } }, tool.attempt.cursor);
}
```

`attempt.doc` is reset to the new base, so an invalid rerun falls back to the current drawing rather than the old one.

- [x] **Step 7: Implement** `packages/editor/src/gestures.ts`

```ts
import { EPS, distance, incidentWalls, type Document } from "@fm/domain";
import { assertNever, keyOf, uniqueKeys, type EntityKey, type Point, type TableName } from "@fm/protocol";
import { visibleDoc } from "./document/open-document";
import type { Host } from "./ports/host";
import type { EditorState, Step } from "./state";
import { showToast } from "./toast";
import { rerunMove } from "./tools/select-tool";
import { draggedJoints, idleTool, type SelectToolState, type WallToolState } from "./tools/types";
import { drawingAt } from "./tools/wall-tool";

// How tools react to document notices: pause and resume (§5.5), remote changes (§5.7), snapshots and disconnects.

export const CHAIN_ENDED = "Drawing changed remotely — wall chain ended";
export const GESTURE_CANCELLED = "Drawing changed remotely";
export const CONNECTION_LOST = "Connection lost: editing resumes when it returns";

type Drawing = Extract<WallToolState, { kind: "drawing" }>;
type Moving = Extract<SelectToolState, { kind: "moving" }>;
type Touches = (deps: EntityKey[]) => boolean;

const none = (state: EditorState): Step => ({ state, effects: [] });
const key = (table: TableName, id: string): EntityKey => ({ table, id });

/** `accepted` for the paused segment: the resume rule (§5.5). */
export function resumeChain(state: EditorState, id: string, host: Host): Step {
  const tool = state.tool;
  if (tool.name !== "wall" || tool.state.kind !== "paused" || tool.state.segment !== id || !state.document) return none(state);
  const { origin, chainStart } = tool.state;
  // 1. Check the anchor: the joint the segment created or reused must still be at the origin.
  if (!jointNear(visibleDoc(state.document), origin)) return endChain(state, host);
  // 2. Recompute the preview from the visible document at the current cursor; an invalid one is drawn red.
  return none(drawingAt(state, origin, chainStart));
}

/** `rejected` for the paused segment ends the chain; the rejection toast explains why. */
export function endChainOnRejection(state: EditorState, id: string): EditorState {
  const tool = state.tool;
  return tool.name === "wall" && tool.state.kind === "paused" && tool.state.segment === id ? idle(state) : state;
}

/**
 * A remote change (§5.7): a topology change cancels every active geometry gesture; any other change cancels
 * only a gesture whose dependencies it writes. A gesture it does not touch reruns on the new document.
 */
export function onRemoteChange(state: EditorState, writes: EntityKey[], topology: boolean, host: Host): Step {
  if (!state.document) return none(state);
  const doc = visibleDoc(state.document);
  const written = new Set(writes.map(keyOf));
  const touches: Touches = (deps) => topology || deps.some((k) => written.has(keyOf(k)));
  const tool = state.tool;
  switch (tool.name) {
    case "wall":
      return wallRemote(state, tool.state, doc, topology, touches, host);
    case "select":
      return selectRemote(state, tool.state, doc, touches, host);
    case "zone":
      return none(state);
    default:
      return assertNever(tool);
  }
}

/** A snapshot or a lost connection cancels every active gesture (§5.7, P8). */
export function cancelGestures(state: EditorState, cause: "snapshot" | "offline", host: Host): Step {
  const tool = state.tool;
  const chain = tool.name === "wall" && tool.state.kind !== "idle";
  const gesture = tool.name === "select" && (tool.state.kind === "moving" || tool.state.kind === "editingHelper");
  if (!chain && !gesture) return none(state);
  const text = cause === "offline" ? CONNECTION_LOST : chain ? CHAIN_ENDED : GESTURE_CANCELLED;
  return showToast(idle(state), text, host);
}

function wallRemote(state: EditorState, t: WallToolState, doc: Document, topology: boolean, touches: Touches, host: Host): Step {
  switch (t.kind) {
    case "idle":
      return none(state);
    case "drawing":
      // The chain depends on its origin joint; once a wall was placed, a joint must still be at the origin.
      return topology || anchorLost(doc, t) ? endChain(state, host) : none(refreshDrawing(state, t));
    case "paused":
      // It depends on what its pending segment writes and reads: that segment's history entry.
      return touches(segmentDependencies(state, t.segment)) ? endChain(state, host) : none(state);
    default:
      return assertNever(t);
  }
}

function selectRemote(state: EditorState, t: SelectToolState, doc: Document, touches: Touches, host: Host): Step {
  switch (t.kind) {
    case "idle":
    case "pressing":
      return none(state);
    case "moving":
      return touches(moveDependencies(t)) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(rerunMove(state, t));
    case "editingHelper":
      return touches(helperDependencies(doc, t.wallId)) ? showToast(idle(state), GESTURE_CANCELLED, host) : none(state);
    default:
      return assertNever(t);
  }
}

function endChain(state: EditorState, host: Host): Step {
  return showToast(idle(state), CHAIN_ENDED, host);
}

function idle(state: EditorState): EditorState {
  return { ...state, tool: idleTool(state.tool.name), snap: null };
}

/** Recompute the preview as on a pointer move, keeping a half-typed length. */
function refreshDrawing(state: EditorState, t: Drawing): EditorState {
  const next = drawingAt(state, t.origin, t.chainStart);
  const tool = next.tool;
  if (tool.name !== "wall" || tool.state.kind !== "drawing") return next;
  return { ...next, tool: { name: "wall", state: { ...tool.state, value: t.value } } };
}

function anchorLost(doc: Document, t: Drawing): boolean {
  return distance(t.origin, t.chainStart) >= EPS && !jointNear(doc, t.origin);
}

function jointNear(doc: Document, p: Point): boolean {
  return Object.values(doc.joints).some((j) => distance(j, p) < EPS);
}

function segmentDependencies(state: EditorState, id: string): EntityKey[] {
  return state.undo.past.find((e) => e.id === id)?.dependencies ?? [];
}

/** The moved joints and their incident walls, as in the command's dependencies (§4.1). */
function moveDependencies(t: Moving): EntityKey[] {
  const joints = draggedJoints(t.baseDoc, t.target);
  const walls = joints.flatMap((id) => incidentWalls(t.baseDoc, id));
  return uniqueKeys([...joints.map((id) => key("joints", id)), ...walls.map((id) => key("walls", id))]);
}

/** A resize keeps endpoint a: the wall, both endpoints and the walls at the moving end (§4.1, §5.6). */
function helperDependencies(doc: Document, wallId: string): EntityKey[] {
  const w = doc.walls[wallId];
  if (!w) return [key("walls", wallId)];
  const moving = incidentWalls(doc, w.b).map((id) => key("walls", id));
  return uniqueKeys([key("walls", wallId), key("joints", w.a), key("joints", w.b), ...moving]);
}
```

- [x] **Step 8: Replace** `packages/editor/src/notices.ts`

```ts
import { assertNever, type RejectReason } from "@fm/protocol";
import type { Notice } from "./document/types";
import { cancelGestures, endChainOnRejection, onRemoteChange, resumeChain } from "./gestures";
import { applyHistoryNotice } from "./history/history";
import type { Effect } from "./ports/effects";
import type { Host } from "./ports/host";
import { pruneSelection, type EditorState, type Step } from "./state";
import { showToast } from "./toast";

/** For each notice in order: history first, then tools (spec §7.0). */
export function applyNotices(state: EditorState, notices: Notice[], host: Host): Step {
  let s = state;
  const effects: Effect[] = [];
  for (const n of notices) {
    s = { ...s, undo: applyHistoryNotice(s.undo, n) };
    const r = toolNotice(s, n, host);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: pruneSelection(s), effects };
}

function toolNotice(state: EditorState, n: Notice, host: Host): Step {
  switch (n.type) {
    case "accepted":
      return resumeChain(state, n.id, host);
    case "rejected":
      return showToast(endChainOnRejection(state, n.id), rejectMessage(n.reason), host);
    case "remoteChange":
      return onRemoteChange(state, n.writes, n.topology, host);
    case "resynced":
      return cancelGestures(state, "snapshot", host);
    case "offline":
      return cancelGestures(state, "offline", host);
    default:
      return assertNever(n);
  }
}

export function rejectMessage(reason: RejectReason): string {
  switch (reason.kind) {
    case "conflict":
      return "Someone else changed this first";
    case "invalid":
      return "Rejected: the drawing would become invalid";
    case "malformed":
      return "The server refused a malformed change";
    case "tooLarge":
      return "The change is too large";
    case "unknownProject":
      return "The project no longer exists";
    default:
      return assertNever(reason);
  }
}
```

There is a module cycle: `notices` → `gestures` → `tools/*` → `commit` → `notices`. The cycle is harmless because these modules only declare functions and constants, and nothing in them runs at import time. dependency-cruiser has no circular-import rule (phase 1).

- [x] **Step 9: Run them and see them pass**

Run: `pnpm --filter @fm/editor test shared-tools remote-gestures`
Expected: PASS (9 and 7 tests). Then run `pnpm --filter @fm/editor test`: every phase 3 and 5 test still passes, because a local document emits `accepted` only and never pauses.

- [x] **Step 10: Record the rules in design memory.** The gesture dependency sets were drafted into `editor-interaction.md` while planning; replace that draft row with the rows below (today's date), adjusted to what was implemented, so no duplicate remains. Rows for the Decisions table of `docs/design-memory/editor-interaction.md`:

```markdown
| Gesture dependencies for remote changes (`gestures.ts`): drag = moved joints + their incident walls; helper resize = wall, both endpoints, walls at the moving end; paused chain = its pending segment's history dependencies; drawing chain = its origin joint, checked by position (once a wall is placed, a joint must still be at the origin). Snapshots and disconnects cancel every active gesture. Toasts: "Drawing changed remotely — wall chain ended", "Drawing changed remotely", "Connection lost: editing resumes when it returns" (<date>) | §5.7 names the rule but not each tool's set; the drawing state stores points, not joint IDs, so position is the simplest check | §5.5, §5.7 |
| A same-step rejection (the local `tooLarge` guard) leaves the wall tool unchanged, like an `execute` refusal (<date>) | The chain must not advance past a wall that was never submitted | §5.5, §7.4 |
```

Add a sprint-log row.

- [x] **Step 11: Check and commit**

```bash
pnpm check
git add packages/editor docs/design-memory/editor-interaction.md docs/plans/flatmate/phase-7-collaboration.md
git commit -m "editor: tools react to notices: paused chains resume or end, gestures cancel or rerun"
```

---

### Task 7.7: Shared undo and redo (spec §7.5)

The phase 3 history code already implements §7.5: pending entries, requests, invalidation by write overlap, and clearing on snapshots. These scenarios pin the shared behaviour against a server that answers later. They should pass at once; a failure is a bug in phase 3's history or commit code, fixed there and logged.

**Files:** Create `packages/editor/test/shared-undo.test.ts`.

- [x] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { REMOTE_UNDO } from "../src/history/history";
import { jointAt, pointOf, roomDoc } from "./builders";
import { FakeRemote } from "./fake-remote";

/** The room open on a shared document, with the corner dragged to (6, 4.6) and accepted. */
function moved(): { r: FakeRemote; corner: string } {
  const r = FakeRemote.open(roomDoc());
  const corner = jointAt(r.doc, { x: 6, y: 4 });
  r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
  r.accept();
  return { r, corner };
}

describe("undo on a shared document (spec §7.5)", () => {
  it("waits for the ordinary pending edit", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(r.shell.view().canUndo).toBe(false);
    r.shell.key("z", { meta: true });
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.shell.view().canUndo).toBe(true);
  });

  it("moves the entry between stacks only when the server accepts the undo", () => {
    const { r, corner } = moved();
    r.shell.key("z", { meta: true });
    expect(r.submits()).toHaveLength(2);
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4 }); // shown at once
    expect([r.shell.state.undo.past.length, r.shell.state.undo.future.length]).toEqual([1, 0]);
    expect(r.shell.state.undo.pending?.direction).toBe("undo");
    expect([r.shell.view().canUndo, r.shell.view().canRedo]).toEqual([false, false]);
    r.accept();
    expect([r.shell.state.undo.past.length, r.shell.state.undo.future.length]).toEqual([0, 1]);
    expect(r.shell.view().canRedo).toBe(true);
  });

  it("discards the entry when the server rejects the undo", () => {
    const { r, corner } = moved();
    r.shell.key("z", { meta: true });
    r.reject();
    expect(r.shell.state.undo).toEqual({ past: [], future: [], pending: null });
    expect(pointOf(r.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(r.shell.view().toast).toBe("Someone else changed this first");
  });

  it("two moves, two undos and two redos through the server restore each state", () => {
    const r = FakeRemote.open(roomDoc());
    const corner = jointAt(r.doc, { x: 6, y: 4 });
    const at = () => pointOf(r.shell.doc(), corner);
    r.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    r.accept();
    r.shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5.2 });
    r.accept();
    for (const [mods, expected] of [
      [{ meta: true }, { x: 6, y: 4.6 }],
      [{ meta: true }, { x: 6, y: 4 }],
      [{ meta: true, shift: true }, { x: 6, y: 4.6 }],
      [{ meta: true, shift: true }, { x: 6, y: 5.2 }],
    ] as const) {
      r.shell.key("z", mods);
      r.accept();
      expect(at()).toEqual(expected);
    }
    expect(r.submits()).toHaveLength(6);
  });

  it("a remote write invalidates the entry even if a later remote move restores the values", () => {
    const { r, corner } = moved();
    r.remote({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 5 } }] });
    r.remote({ type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 4.6 } }] });
    expect(r.shell.view().canUndo).toBe(false);
    r.shell.key("z", { meta: true });
    expect(r.shell.view().toast).toBe(REMOTE_UNDO);
    expect(r.submits()).toHaveLength(1);
  });

  it("an unrelated remote move keeps history usable", () => {
    const { r } = moved();
    r.remote({ type: "moveJoints", moves: [{ jointId: jointAt(r.doc, { x: 0, y: 0 }), to: { x: -0.4, y: 0 } }] });
    r.shell.key("z", { meta: true });
    expect(r.submits()).toHaveLength(2);
  });

  it("a remote topology change invalidates all history, and a reconnect snapshot clears it", () => {
    const { r } = moved();
    r.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
    r.accept();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } });
    expect(r.shell.state.undo.past.map((e) => e.status)).toEqual(["invalid", "invalid"]);
    r.disconnect();
    r.reconnect();
    expect(r.shell.state.undo).toEqual({ past: [], future: [], pending: null });
  });
});
```

`as const` in the undo/redo table makes the modifier objects readonly, which `FakeShell.key(key, mods?: Partial<Mods>)` accepts.

- [x] **Step 2: Run it**

Add one more `it` of your own (planned after the phase 3 wave 3 review, 2026-09-29): "refuses an ordinary edit while the undo request is pending". From `moved()`, press undo, then try an ordinary edit (a drag of another joint or a Delete of a selected wall). Expect the blocked-edit toast (§7.4, "Waiting for server" unless the gesture code says otherwise), still 2 submits, and after `r.accept()` the undone entry on the redo stack with nothing new on the undo stack. Phase 3's `recordCommit` throws if it is ever called while a history request is pending, so this test also proves the editor never gets there.

Run: `pnpm --filter @fm/editor test shared-undo`
Expected: PASS (8 tests).

- [x] **Step 3: Check and commit**

```bash
pnpm check
git add packages/editor/test/shared-undo.test.ts
git commit -m "editor: shared undo scenarios: settled-only stacks, rejection, invalidation, reconnect"
```

---

### Task 7.8: Remote cursors in the scene (spec §7.6)

**Files:** Modify `packages/editor/src/view/scene.ts`. Create `packages/editor/test/presence.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/presence.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { roomDoc } from "./builders";
import { FakeRemote } from "./fake-remote";

function presenceLayer(r: FakeRemote) {
  return r.shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
}

describe("presence in the scene (spec §7.6)", () => {
  it("draws each remote cursor with its name in the collaborator's colour", () => {
    const r = FakeRemote.open(roomDoc());
    r.event({ type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090ff", cursor: { x: 1, y: 2 }, selection: [] });
    const layer = presenceLayer(r);
    expect(layer).toContainEqual({ kind: "disc", center: { x: 1, y: 2 }, radius: { px: 5 }, color: "#0090ff" });
    expect(layer.some((p) => p.kind === "text" && p.text === "Bob" && p.color === "#0090ff")).toBe(true);
  });

  it("draws nothing for a collaborator without a cursor", () => {
    const r = FakeRemote.open(roomDoc());
    r.event({ type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090ff", cursor: null, selection: [] });
    expect(presenceLayer(r)).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test presence`
Expected: FAIL: the presence layer is empty (`expected [] to include …`).

- [x] **Step 3: Implement.** In `packages/editor/src/view/scene.ts`, in `buildScene`, replace the comment line

```ts
  // Phase 7 appends drawPresence(state, layers.presence) here.
```

with

```ts
  drawPresence(state, layers.presence);
```

and append at the end of the file:

```ts
/** Remote cursors with their names, in each collaborator's colour (§7.6). Remote selections are not drawn. */
function drawPresence(state: EditorState, out: Primitive[]): void {
  const offset = 10 / state.camera.zoom;
  for (const p of Object.values(state.presence)) {
    if (!p.cursor) continue;
    out.push({ kind: "disc", center: p.cursor, radius: { px: 5 }, color: p.color });
    out.push({
      kind: "text", text: p.name, at: { x: p.cursor.x + offset, y: p.cursor.y - offset },
      size: 11, color: p.color, align: "left", rotation: 0,
    });
  }
}
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/editor test presence`
Expected: PASS (2 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: draw remote cursors and names in the presence layer"
```

---
### Task 7.9: Editor public exports and the test-harness entry

`@fm/sync-tests` drives two editors through the same `FakeShell` the editor's own tests use. The editor package exports its harness as the subpath `@fm/editor/testing`; the app never imports it. `FakeHost` takes an ID prefix, because two editors in one test must not create the same changeset and entity IDs. `FakeShell.command` runs a command the way a tool does. It is for acceptance scenarios whose gesture belongs to another phase: the typed resize below uses phase 5's helper dimension.

**Files:** Modify `packages/editor/src/index.ts`, `packages/editor/package.json`, `packages/editor/test/fake-shell.ts`. Create `packages/editor/test/testing.ts`, `packages/editor/test/testing.test.ts`.

- [x] **Step 1: Write the failing test** `packages/editor/test/testing.test.ts`

```ts
import { describe, expect, it } from "vitest";
import * as editor from "../src/index";
import { FakeHost, FakeRemote, FakeShell, roomDoc, shared, wallBetween } from "./testing";

describe("harness entry and public API for other packages", () => {
  it("prefixes IDs so two editors in one test never collide", () => {
    const h = new FakeHost("alice-");
    expect([h.newId(), h.newId()]).toEqual(["alice-id1", "alice-id2"]);
    expect(new FakeHost().newId()).toBe("id1");
  });

  it("runs a command without a gesture, through the same path as a tool", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.command({ type: "setWallLength", wallId: right, length: 3.5, keep: "a" });
    expect(shell.view().canUndo).toBe(true);
    expect(shell.doc()).not.toEqual(roomDoc());
  });

  it("exports what the web adapter and the sync tests need", () => {
    for (const name of ["serverMessageEvent", "clientMessageFor", "sharedFromSnapshot", "hasPendingEdit", "sessionOf"] as const) {
      expect(typeof editor[name]).toBe("function");
    }
    expect(typeof FakeRemote.open).toBe("function");
    expect(shared().kind).toBe("shared");
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/editor test testing`
Expected: FAIL, `Cannot find module './testing'`.

- [x] **Step 3: Extend the fake shell.** In `packages/editor/test/fake-shell.ts`:

In `FakeHost`, replace the line `private next = 0;` with:

```ts
  private next = 0;
  private readonly prefix: string;

  /** `prefix` keeps the IDs of several editors in one test apart ("alice-id1", "bob-id1"). */
  constructor(prefix = "") {
    this.prefix = prefix;
  }
```

and make `newId` return the prefix:

```ts
  newId(): string {
    this.next += 1;
    return `${this.prefix}id${this.next}`;
  }
```

In the imports at the top of the file, change `import type { Document } from "@fm/domain";` to `import type { Command, Document } from "@fm/domain";` and add `import { runCommand } from "../src/commit";`. Add this method to `FakeShell`, after `fireTimer`:

```ts
  /** Runs a command the way a tool does (execute → commit → history → notices), for gestures another phase owns. */
  command(cmd: Command): void {
    const out = runCommand(this.state, cmd, this.host);
    this.state = out.state;
    this.effects.push(...out.effects);
  }
```

- [x] **Step 4: Create the harness entry** `packages/editor/test/testing.ts`

```ts
// The editor's test harness, exported as "@fm/editor/testing" for @fm/sync-tests. The app never imports it.
export { FakeHost, FakeShell } from "./fake-shell";
export { FakeRemote } from "./fake-remote";
export * from "./builders";
export * from "./shared-builders";
```

In `packages/editor/package.json`, change `"exports"` to:

```json
"exports": { ".": "./src/index.ts", "./testing": "./test/testing.ts" },
```

- [x] **Step 5: Extend the public index.** Since phase 3 wave 8 the index exports no write paths and uses named exports only (architecture.md); everything below is a read-only query, a wire mapper or a constant, which fits. A helper only tests need belongs in `@fm/editor/testing` instead. Append to `packages/editor/src/index.ts`:

```ts
export type { SharedDocument } from "./document/types";
export { hasPendingEdit, sessionOf } from "./document/open-document";
export { sharedFromSnapshot, type SnapshotEvent } from "./document/shared-document";
export { clientMessageFor, serverMessageEvent, type ServerEffect } from "./ports/wire";
export { REMOTE_REDO, REMOTE_UNDO } from "./history/history";
export { CHAIN_ENDED, CONNECTION_LOST, GESTURE_CANCELLED } from "./gestures";
export { LEAVE_BLOCKED, NAME_REQUIRED, OFFLINE_LIST } from "./session";
```

- [x] **Step 6: Run it and see it pass**

Run: `pnpm --filter @fm/editor test`
Expected: PASS, every editor test file including `testing.test.ts` (3 tests).

- [x] **Step 7: Check and commit**

```bash
pnpm check
git add packages/editor
git commit -m "editor: export the shared document and wire mappings; @fm/editor/testing harness entry"
```

---

### Task 7.10: `@fm/server` package entry

The sync tests import the server app like any other package. `src/main.ts` stays the composition root. The entry re-exports the domain validator adapter from its own file, so `only-domain-validator-imports-domain` still holds.

**Files:** Modify `packages/server/package.json`. Create `packages/server/src/index.ts`, `packages/server/test/index.test.ts`.

- [x] **Step 1: Write the failing test** `packages/server/test/index.test.ts`

```ts
import { describe, expect, it } from "vitest";
import * as server from "../src/index";

describe("@fm/server package entry", () => {
  it("exports the app, the in-memory repository and the domain validator", async () => {
    expect(typeof server.createServerApp).toBe("function");
    const repository = server.createInMemoryRepository();
    expect((await repository.create("Apartment")).meta.name).toBe("Apartment");
    expect(server.domainValidator.validate({ joints: {}, walls: {}, zoneLabels: {} })).toEqual({ ok: true });
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/server test index`
Expected: FAIL, `Cannot find module '../src/index'`.

- [x] **Step 3: Implement** `packages/server/src/index.ts`

```ts
// Package entry for other workspace packages (@fm/sync-tests). The composition root is src/main.ts.
export { createServerApp, type Connection, type ServerApp, type ServerAppDeps, type Session } from "./app/server-app";
export { createInMemoryRepository, type InMemoryRepository } from "./app/testing";
export { domainValidator } from "./adapters/domain-validator";
export type { ChangesetValidator, ProjectRepository, ProjectState } from "./app/ports";
```

In `packages/server/package.json`, add next to `"type": "module"`:

```json
"exports": { ".": "./src/index.ts" },
```

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/server test index && pnpm depcruise`
Expected: PASS (1 test); `no dependency violations found`.

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/server
git commit -m "server: package entry for workspace consumers"
```

---

### Task 7.11: `@fm/sync-tests`: two editors against the real server app

`Net` runs the real `createServerApp`, with the in-memory repository and the real domain validator. Every `Client` is a server-mode `FakeShell` with a queue in each direction:

- `pump()` sends the editor's new `workspace`, `submit` and `presence` effects, as the WebSocket adapter would;
- `deliver()` hands queued server messages to the editor unless `holding` is set;
- `drop` loses one message.

`settle()` repeats pump, wait for the server, deliver, until nothing moves. Tests that need a particular arrival order call `pump()` on each client in that order before `settle()`.

Rules for tests in this package:

- Never call `clearEffects()` on a client's shell: the client forwards effects by position in that log.
- Every changeset carries expectations, and the server checks them.
- Gestures go through `FakeShell`, except where a gesture belongs to another phase (`command()`).

**Files:** Create `packages/sync-tests/package.json`, `packages/sync-tests/tsconfig.json`, `packages/sync-tests/test/net.ts`, `packages/sync-tests/test/net.test.ts`.

- [x] **Step 1: Create the package**

`packages/sync-tests/package.json`:

```json
{
  "name": "@fm/sync-tests",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@fm/domain": "workspace:*",
    "@fm/editor": "workspace:*",
    "@fm/protocol": "workspace:*",
    "@fm/server": "workspace:*"
  }
}
```

`packages/sync-tests/tsconfig.json`. The server sources it typechecks import Node modules:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["test"]
}
```

Run:

```bash
mkdir -p packages/sync-tests/test
pnpm install
pnpm --filter @fm/sync-tests add -D @types/node
```

Expected: `Done`; `packages/sync-tests/node_modules/@fm/` links the four workspace packages.

- [x] **Step 2: Write the harness** `packages/sync-tests/test/net.ts`

```ts
import { clientMessageFor, initialState, serverMessageEvent, type Effect, type ServerEffect } from "@fm/editor";
import { FakeHost, FakeShell } from "@fm/editor/testing";
import type { Point, ServerMessage } from "@fm/protocol";
import { createInMemoryRepository, createServerApp, domainValidator, type InMemoryRepository, type ServerApp, type Session } from "@fm/server";

function isServerEffect(e: Effect): e is ServerEffect {
  return e.type === "workspace" || e.type === "submit" || e.type === "presence";
}

/** One editor connected to the server app, with a controllable message queue in each direction. */
export class Client {
  readonly shell: FakeShell;
  readonly clientId: string;
  readonly name: string;
  /** Server → client messages not yet delivered. */
  inbox: ServerMessage[] = [];
  /** While true, deliver() leaves the inbox alone (latency). */
  holding = false;
  /** Loses the next inbound message this predicate matches (a missed `changes`). */
  drop: ((m: ServerMessage) => boolean) | null = null;
  private readonly net: Net;
  private session: Session | null = null;
  private forwarded = 0;

  constructor(net: Net, clientId: string, name: string) {
    this.net = net;
    this.clientId = clientId;
    this.name = name;
    const host = new FakeHost(`${clientId}-`);
    const state = initialState({ mode: "server", me: { clientId, name }, viewport: { width: 1200, height: 800 }, dpr: 1 }, host);
    this.shell = new FakeShell(state, host);
    this.connect();
  }

  /** Like the WebSocket adapter: hello first, then tell the editor the connection is open. */
  connect(): void {
    const session = this.net.app.connect({ send: (m) => void this.inbox.push(m), close: () => this.disconnect() });
    this.session = session;
    session.receive(JSON.stringify({ type: "hello", clientId: this.clientId, name: this.name }));
    this.shell.send({ type: "serverEvent", event: { type: "connection", state: "open" } });
  }

  /** The connection drops: queued messages are lost and the editor goes offline. */
  disconnect(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.inbox = [];
    session.close();
    this.shell.send({ type: "serverEvent", event: { type: "connection", state: "closed" } });
  }

  /** Client → server: the editor's new workspace, submit and presence effects, in order. */
  pump(): number {
    const effects = this.shell.effects;
    const fresh = effects.slice(this.forwarded);
    this.forwarded = effects.length;
    let sent = 0;
    for (const e of fresh) {
      if (!isServerEffect(e) || this.session === null) continue; // offline: lost, like a closed socket
      this.session.receive(JSON.stringify(clientMessageFor(e)));
      sent += 1;
    }
    return sent;
  }

  /** Server → client: queued messages to the editor, in order, unless held. */
  deliver(): number {
    if (this.holding) return 0;
    let delivered = 0;
    for (let m = this.inbox.shift(); m !== undefined; m = this.inbox.shift()) {
      if (this.drop?.(m)) {
        this.drop = null;
        continue;
      }
      this.shell.send(serverMessageEvent(m));
      delivered += 1;
    }
    return delivered;
  }
}

/** The real server app (in-memory repository, domain validator) and the clients connected to it. */
export class Net {
  readonly repository: InMemoryRepository;
  app: ServerApp;
  readonly fatal: unknown[] = [];
  readonly clients: Client[] = [];

  constructor(repository: InMemoryRepository = createInMemoryRepository()) {
    this.repository = repository;
    this.app = this.start();
  }

  join(name: string): Client {
    const client = new Client(this, name.toLowerCase(), name);
    this.clients.push(client);
    return client;
  }

  /** Crash-only restart (spec §7.2): every connection drops; a new app reloads the same repository. */
  restart(): void {
    for (const c of this.clients) c.disconnect();
    this.app = this.start();
  }

  /** Forward effects, let the server finish, deliver replies; repeat until nothing moves. */
  async settle(): Promise<void> {
    for (let round = 0; round < 100; round += 1) {
      let moved = 0;
      for (const c of this.clients) moved += c.pump();
      await this.app.idle();
      for (const c of this.clients) moved += c.deliver();
      if (moved === 0) return;
    }
    throw new Error("the network did not settle in 100 rounds");
  }

  private start(): ServerApp {
    return createServerApp({ repository: this.repository, validator: domainValidator, onFatal: (error) => void this.fatal.push(error) });
  }
}

export function projectIdOf(c: Client): string {
  const d = c.shell.state.document;
  if (!d) throw new Error(`${c.name} has no drawing open`);
  return d.project.id;
}

export function seqOf(c: Client): number {
  const d = c.shell.state.document;
  if (!d || d.kind !== "shared") throw new Error(`${c.name} has no shared drawing open`);
  return d.confirmed.seq;
}

export function submitIds(c: Client): string[] {
  return c.shell.effectsOf("submit").map((e) => e.changeset.id);
}

/** Demo step 2 on a shared drawing: each segment waits for the server before the next (spec §5.5). */
export async function drawRoom(net: Net, c: Client): Promise<void> {
  const s = c.shell;
  const shift = { shift: true };
  s.key("w");
  s.click({ x: 0, y: 0 }, shift);
  const legs: [Point, string][] = [[{ x: 3, y: 0.2 }, "6"], [{ x: 6.2, y: 2 }, "4"], [{ x: 3, y: 4.2 }, "6"]];
  for (const [p, length] of legs) {
    s.moveTo(p, shift);
    s.type(length);
    s.key("Enter");
    await net.settle();
  }
  s.click({ x: 0.02, y: 0.02 }, shift);
  await net.settle();
}

/** Demo step 3: the divider between the two wall midpoints, then finish the chain. */
export async function drawDivider(net: Net, c: Client): Promise<void> {
  const s = c.shell;
  const shift = { shift: true };
  s.key("w");
  s.click({ x: 3.04, y: 0.03 }, shift);
  s.click({ x: 3.1, y: 3.97 }, shift);
  await net.settle();
  s.key("Enter");
}

/** Alice creates "Apartment" and draws the room; Bob opens it. */
export async function sharedRoom(net: Net): Promise<{ alice: Client; bob: Client; projectId: string }> {
  const alice = net.join("Alice");
  const bob = net.join("Bob");
  await net.settle();
  alice.shell.ui({ type: "createProject", name: "Apartment" });
  await net.settle();
  const projectId = projectIdOf(alice);
  await drawRoom(net, alice);
  bob.shell.ui({ type: "openProject", id: projectId });
  await net.settle();
  return { alice, bob, projectId };
}
```

- [x] **Step 3: Write the harness test** `packages/sync-tests/test/net.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { zones } from "@fm/domain";
import { Net, seqOf, sharedRoom, submitIds } from "./net";

const areas = (doc: Parameters<typeof zones>[0]) => zones(doc).map((z) => z.area?.toFixed(2));

describe("two editors on the real server app", () => {
  it("creates, opens and draws a room; the second editor sees the same drawing", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    expect(Object.keys(alice.shell.doc().walls)).toHaveLength(4);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(seqOf(bob)).toBe(seqOf(alice));
    expect(alice.shell.view().project).toEqual({ name: "Apartment", status: "saved", dirty: false, canEdit: true });
    expect(submitIds(alice)).toHaveLength(4);
    expect(net.fatal).toEqual([]);
  });

  it("relays presence between the editors and removes it when one leaves", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.moveTo({ x: 1, y: 1 });
    await net.settle();
    expect(bob.shell.view().presence).toEqual([{ clientId: "alice", name: "Alice", color: alice.shell.state.me.color, at: { x: 1, y: 1 } }]);
    alice.disconnect();
    await net.settle();
    expect(bob.shell.view().presence).toEqual([]);
  });

  it("demo step 7: Bob moves a wall and Alice's room area changes", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    expect(areas(alice.shell.doc())).toEqual(["22.04"]); // 5.8 × 3.8 clear
    bob.shell.key("v");
    bob.shell.drag({ x: 6, y: 2 }, { x: 7, y: 2 });
    await net.settle();
    expect(areas(alice.shell.doc())).toEqual(["25.84"]); // 6.8 × 3.8 clear
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
```

- [x] **Step 4: Run it**

Run: `pnpm --filter @fm/sync-tests test`
Expected: PASS (3 tests). These tests exercise code from Tasks 7.1–7.10 and phase 6. A failure is a real integration bug: find which side is wrong, fix it there with a unit test first, and log it.

- [x] **Step 5: Record it in design memory.** Add to the Decisions table of `docs/design-memory/implementation.md`, with today's date:

```markdown
| `@fm/sync-tests` drives two `FakeShell` editors against the real server app with a pump/idle/deliver loop; `@fm/editor` exports its harness as `@fm/editor/testing`; `@fm/server` exports its app from `src/index.ts`; `FakeHost` takes an ID prefix per editor (<date>) | Real server rules (receipts, expectations, validation) in every sync scenario, with full control of message order | plan phase 7, spec §9 |
```

- [x] **Step 6: Check and commit**

```bash
pnpm check
git add packages/sync-tests pnpm-lock.yaml docs/design-memory/implementation.md docs/plans/flatmate/phase-7-collaboration.md
git commit -m "sync-tests: two headless editors against the real server app"
```

---

### Task 7.12: Sync scenarios: concurrent edits (spec §9 sync row, acceptance scenarios)

These scenarios use code that already exists, so they should pass at once. A failure is a real bug: reproduce it in a unit test of the side at fault, fix it there, and log it.

**Files:** Create `packages/sync-tests/test/concurrency.test.ts`.

- [x] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { jointAt, pointOf, wallBetween } from "@fm/editor/testing";
import { REMOTE_REDO } from "@fm/editor";
import { Net, sharedRoom, submitIds } from "./net";

describe("concurrent edits against the real server (spec §4.0 cases, §9)", () => {
  it("same joint moved by both: the second is rejected as a conflict and both converge", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const corner = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    alice.shell.key("v");
    bob.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    bob.shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    alice.pump(); // Alice's submission arrives first
    bob.pump();
    await net.settle();
    expect(pointOf(alice.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
    expect(bob.shell.state.undo.past).toEqual([]);
  });

  it("different joints moved by both: both are accepted and both converge", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("v");
    bob.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    bob.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    jointAt(alice.shell.doc(), { x: 6, y: 4.6 });
    jointAt(alice.shell.doc(), { x: -0.4, y: 0 });
    expect(alice.shell.state.undo.past.at(-1)?.status).toBe("usable");
    expect(bob.shell.state.undo.past.at(-1)?.status).toBe("usable");
  });

  it("crossing walls drawn at once: each is valid alone, so the second is rejected as invalid", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("w");
    alice.shell.click({ x: 1, y: 1 });
    alice.shell.click({ x: 1, y: 3 });
    bob.shell.key("w");
    bob.shell.click({ x: 0.4, y: 2 });
    bob.shell.click({ x: 2, y: 2 });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(Object.keys(alice.shell.doc().walls)).toHaveLength(5);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Rejected: the drawing would become invalid");
    const tool = bob.shell.state.tool;
    expect(tool.name === "wall" && tool.state.kind).toBe("idle");
  });

  it("an undo racing a remote edit of the same joint is refused by the server", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const corner = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    alice.shell.key("v");
    bob.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle();
    const dragId = submitIds(alice).at(-1);
    alice.shell.key("z", { meta: true }); // the undo request, not sent yet
    bob.shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5 });
    bob.pump(); // Bob's move arrives first
    alice.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBe("Someone else changed this first");
    expect(alice.shell.state.undo.past.map((e) => e.id)).not.toContain(dragId);
    expect(alice.shell.state.undo.future).toEqual([]);
    expect(alice.shell.state.undo.pending).toBeNull();
    expect(pointOf(alice.shell.doc(), corner)).toEqual({ x: 6, y: 5 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("Bob moves the fixed endpoint while Alice submits a typed resize: her dependency expectation rejects it", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const right = wallBetween(alice.shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    // Phase 5 types this into the helper dimension; the command is what that gesture commits.
    alice.shell.command({ type: "setWallLength", wallId: right, length: 3.5, keep: "a" });
    bob.shell.key("v");
    bob.shell.drag({ x: 6, y: 0 }, { x: 6.4, y: 0 });
    bob.pump();
    alice.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBe("Someone else changed this first");
    jointAt(alice.shell.doc(), { x: 6, y: 4 }); // the resize never happened
    jointAt(alice.shell.doc(), { x: 6.4, y: 0 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("concurrent renames of one zone: the second conflicts through the label's expectation (spec §9)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("z");
    alice.shell.click({ x: 3, y: 2 }); // labels the room "Room 1" and selects the zone
    await net.settle();
    bob.shell.key("z");
    bob.shell.click({ x: 3, y: 2 }); // a labelled room: Bob only selects it
    alice.shell.ui({ type: "setField", fieldId: "name", value: "Kitchen" });
    bob.shell.ui({ type: "setField", fieldId: "name", value: "Dining" });
    alice.pump(); // Alice's rename arrives first
    bob.pump();
    await net.settle();
    const names = (c: typeof alice) => Object.values(c.shell.doc().zoneLabels).map((l) => l.name);
    expect(names(alice)).toEqual(["Kitchen"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
  });

  it("two users label the same unlabelled room at once: both labels are accepted and both show (spec §3.6)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("z");
    bob.shell.key("z");
    alice.shell.click({ x: 2, y: 2 });
    bob.shell.click({ x: 4, y: 2 });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(Object.keys(alice.shell.doc().zoneLabels)).toHaveLength(2);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("demo step 8: after Alice undoes two moves, Bob's change to that joint makes her redo unavailable", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const corner = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    alice.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle();
    alice.shell.drag({ x: 6, y: 4.6 }, { x: 6, y: 5.2 });
    await net.settle();
    alice.shell.key("z", { meta: true });
    await net.settle();
    alice.shell.key("z", { meta: true });
    await net.settle();
    expect(pointOf(alice.shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(alice.shell.view().canRedo).toBe(true);
    bob.shell.key("v");
    bob.shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    await net.settle();
    expect(alice.shell.state.undo.future.map((e) => e.status)).toEqual(["invalid", "invalid"]);
    expect(alice.shell.view().canRedo).toBe(false);
    const sent = submitIds(alice).length;
    alice.shell.key("z", { meta: true, shift: true });
    expect(alice.shell.view().toast).toBe(REMOTE_REDO);
    expect(submitIds(alice)).toHaveLength(sent);
  });

  it("a remote change cancels an affected drag but only refreshes an unaffected one", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const a = alice.shell;
    a.key("v");
    bob.shell.key("v");

    a.moveTo({ x: 6, y: 4 });
    a.down({ x: 6, y: 4 });
    a.moveTo({ x: 6, y: 4.4 });
    bob.shell.drag({ x: 6, y: 4 }, { x: 6.4, y: 4 });
    await net.settle();
    expect(a.view().toast).toBe("Drawing changed remotely");
    const sent = submitIds(alice).length;
    a.up({ x: 6, y: 4.4 });
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent);

    a.moveTo({ x: 6.4, y: 4 });
    a.down({ x: 6.4, y: 4 });
    a.moveTo({ x: 6.4, y: 4.4 });
    bob.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
    await net.settle();
    const tool = a.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("moving");
    a.moveTo({ x: 6.4, y: 5 });
    a.up({ x: 6.4, y: 5 });
    await net.settle();
    jointAt(a.doc(), { x: 6.4, y: 5 });
    jointAt(a.doc(), { x: -0.4, y: 0 });
    expect(bob.shell.doc()).toEqual(a.doc());
  });
});
```

`jointAt` throws when no joint is at the point, so a bare `jointAt(...)` call is an assertion.

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/sync-tests test concurrency`
Expected: PASS (9 tests; two added while planning: concurrent rename, double label).

- [x] **Step 3: Check and commit**

```bash
pnpm check
git add packages/sync-tests/test/concurrency.test.ts
git commit -m "sync-tests: concurrent edits, undo races and remote changes during gestures"
```

---

### Task 7.13: Sync scenarios: blocking, lost messages, gaps, crashes and late joiners

> **Trimmed (revised: lean mode, 2026-09-29).** Keep only the blocking and reconnect scenarios; skip lost messages, gaps, crashes and late joiners.

Like Task 7.12, these should pass at once.

**Files:** Create `packages/sync-tests/test/recovery.test.ts`.

- [x] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { zones } from "@fm/domain";
import { NO_MODS } from "@fm/editor";
import { jointAt, pointOf, wallBetween } from "@fm/editor/testing";
import { Net, drawDivider, seqOf, sharedRoom, submitIds } from "./net";

const areas = (doc: Parameters<typeof zones>[0]) => zones(doc).map((z) => z.area?.toFixed(2));

describe("blocking and recovery against the real server (spec §7.4, §7.7, §8, §9)", () => {
  it("while an edit is outstanding, other edits are refused and never replayed; the camera and selection still work", async () => {
    const net = new Net();
    const { alice } = await sharedRoom(net);
    const s = alice.shell;
    const before = submitIds(alice).length;
    s.key("v");
    alice.holding = true;
    s.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle(); // accepted on the server; the replies wait
    expect(s.view().project).toMatchObject({ status: "waiting for server", canEdit: false });

    s.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 }); // no drag starts while edits are blocked
    const bottom = wallBetween(s.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    s.click({ x: 3, y: 0 });
    expect(s.state.selection).toEqual([{ table: "walls", id: bottom }]);
    s.key("Delete");
    expect(s.view().toast).toBe("Waiting for server");
    s.key("z", { meta: true });
    expect(s.view().toast).toBe("Waiting for server");
    const zoom = s.state.camera.zoom;
    s.send({ type: "wheel", screen: { x: 600, y: 400 }, deltaX: 0, deltaY: -100, mods: { ...NO_MODS, ctrl: true } });
    expect(s.state.camera.zoom).toBeGreaterThan(zoom);

    alice.holding = false;
    await net.settle();
    expect(submitIds(alice)).toHaveLength(before + 1);
    expect(s.view().project).toMatchObject({ status: "saved", canEdit: true });
    jointAt(s.doc(), { x: 0, y: 0 });
    wallBetween(s.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
  });

  it("an ack lost with the connection: the snapshot contains the edit and the same-ID resend is acked from the receipt", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const before = seqOf(alice);
    alice.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    alice.pump();
    await net.app.idle(); // accepted and saved; the changes and ack are still queued…
    alice.disconnect(); // …and lost with the connection
    expect(alice.shell.view().project?.status).toBe("offline");
    alice.connect();
    await net.settle();
    const [original, resend] = submitIds(alice).slice(-2);
    expect(resend).toBe(original);
    expect(alice.shell.view().project?.status).toBe("saved");
    expect(seqOf(alice)).toBe(before + 1); // applied once
    expect(seqOf(bob)).toBe(before + 1);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a missed change is detected by its sequence gap and repaired with a snapshot", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.key("v");
    bob.drop = (m) => m.type === "changes";
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle();
    expect(bob.shell.doc()).not.toEqual(alice.shell.doc());
    alice.shell.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 });
    await net.settle();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    const opens = bob.shell.effectsOf("workspace").filter((e) => e.op.type === "open");
    expect(opens).toHaveLength(2); // the first open and the resync
  });

  it.each([
    ["before the write reached disk", false],
    ["after the write reached disk", true],
  ])("a crash during a save (%s) settles through restart, snapshot and the same-ID resend", async (_label, afterWrite) => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const corner = jointAt(alice.shell.doc(), { x: 6, y: 4 });
    const before = seqOf(alice);
    net.repository.failNextSave(new Error("disk full"), { afterWrite });
    alice.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle();
    expect(net.fatal).toHaveLength(1);
    expect(alice.shell.view().project?.status).toBe("waiting for server"); // no ack and no rejection

    net.restart();
    expect(alice.shell.view().project?.status).toBe("offline");
    alice.connect();
    bob.connect();
    await net.settle();
    expect(alice.shell.view().project?.status).toBe("saved");
    expect(seqOf(alice)).toBe(before + 1);
    expect(pointOf(alice.shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    const [original, resend] = submitIds(alice).slice(-2);
    expect(resend).toBe(original);
  });

  it("a late joiner derives the same zones", async () => {
    const net = new Net();
    const { alice, projectId } = await sharedRoom(net);
    await drawDivider(net, alice);
    const carol = net.join("Carol");
    await net.settle();
    carol.shell.ui({ type: "openProject", id: projectId });
    await net.settle();
    expect(carol.shell.doc()).toEqual(alice.shell.doc());
    expect(areas(carol.shell.doc())).toEqual(["10.64", "10.64"]);
  });

  it("opening during a submission delivers the snapshot, then only the later changes", async () => {
    const net = new Net();
    const { alice, projectId } = await sharedRoom(net);
    const carol = net.join("Carol");
    await net.settle();
    alice.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    carol.shell.ui({ type: "openProject", id: projectId });
    alice.pump();
    carol.pump();
    await net.settle();
    expect(carol.shell.doc()).toEqual(alice.shell.doc());
    expect(seqOf(carol)).toBe(seqOf(alice));
  });
});
```

- [x] **Step 2: Run it**

Run: `pnpm --filter @fm/sync-tests test recovery`
Expected: PASS (7 tests).

- [x] **Step 3: Check and commit**

```bash
pnpm check
git add packages/sync-tests/test/recovery.test.ts
git commit -m "sync-tests: blocked edits, lost acks, sequence gaps, crash-restart and late joiners"
```

---
### Task 7.14: WebSocket adapter

The adapter only moves bytes (P7). On open it sends `hello`, then reports `connection open`. It maps server messages to editor events with `serverMessageEvent`, and effects to client messages with `clientMessageFor`. It reconnects with backoff (1, 2, 4 … 30 s, spec §8) and throttles presence to 20 Hz, sending the latest position (§7.6). Anything sent while the socket is closed is dropped; the editor recovers through its reconnect resync. The socket and clock are injected, so the tests run in Node without a network.

**Files:** Create `packages/web/src/adapters/ws-server.ts`, `packages/web/test/ws-server.test.ts`.

- [x] **Step 1: Write the failing test** `packages/web/test/ws-server.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import type { Event as EditorEvent } from "@fm/editor";
import type { ClientMessage } from "@fm/protocol";
import { BACKOFF_MS, createWsServer, serverSink, type Clock, type SocketFactory, type SocketHandlers, type WsServer } from "../src/adapters/ws-server";

type FakeSocket = { handlers: SocketHandlers; sent: string[]; open: boolean; closed: boolean };

class SocketHub {
  sockets: FakeSocket[] = [];
  factory: SocketFactory = (_url, handlers) => {
    const s: FakeSocket = { handlers, sent: [], open: false, closed: false };
    this.sockets.push(s);
    return { send: (data) => void s.sent.push(data), close: () => void (s.closed = true), isOpen: () => s.open && !s.closed };
  };
  last(): FakeSocket {
    const s = this.sockets[this.sockets.length - 1];
    if (!s) throw new Error("no socket");
    return s;
  }
  open(): void {
    const s = this.last();
    s.open = true;
    s.handlers.open();
  }
  drop(): void {
    const s = this.last();
    s.open = false;
    s.handlers.close();
  }
  sentTypes(): string[] {
    return this.sockets.flatMap((s) => s.sent.map((raw) => String(JSON.parse(raw).type)));
  }
}

class FakeClock implements Clock {
  t = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 0;
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): number {
    this.nextId += 1;
    this.timers.push({ id: this.nextId, at: this.t + ms, fn });
    return this.nextId;
  }
  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

function setup() {
  const hub = new SocketHub();
  const clock = new FakeClock();
  const events: EditorEvent[] = [];
  const server = createWsServer({ url: "ws://test", clientId: "tab1", name: "Alice", dispatch: (e) => void events.push(e), socket: hub.factory, clock });
  return { hub, clock, events, server };
}

const presence = (x: number): Extract<ClientMessage, { type: "presence" }> => ({
  type: "presence", projectId: "p1", generation: "g1", cursor: { x, y: 0 }, selection: [],
});

describe("WebSocket adapter", () => {
  it("says hello first, then reports the open connection", () => {
    const { hub, events } = setup();
    hub.open();
    expect(JSON.parse(hub.last().sent[0] ?? "null")).toEqual({ type: "hello", clientId: "tab1", name: "Alice" });
    expect(events).toEqual([{ type: "serverEvent", event: { type: "connection", state: "open" } }]);
  });

  it("maps workspace replies to workspace events and everything else to server events; ignores garbage", () => {
    const { hub, events } = setup();
    hub.open();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    hub.last().handlers.message(JSON.stringify({ type: "projects", requestId: "r1", items: [{ id: "p1", name: "Apartment" }] }));
    hub.last().handlers.message(JSON.stringify({ type: "ack", projectId: "p1", generation: "g1", changesetId: "c1", seq: 3 }));
    hub.last().handlers.message("{not json");
    expect(events.slice(1)).toEqual([
      { type: "workspaceEvent", event: { type: "projects", requestId: "r1", items: [{ id: "p1", name: "Apartment" }] } },
      { type: "serverEvent", event: { type: "ack", projectId: "p1", generation: "g1", changesetId: "c1", seq: 3 } },
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("reconnects with backoff 1, 2, 4 s and starts over after a successful open", () => {
    const { hub, clock, events } = setup();
    hub.open();
    hub.drop();
    expect(events.at(-1)).toEqual({ type: "serverEvent", event: { type: "connection", state: "closed" } });
    clock.advance(BACKOFF_MS[0] - 1);
    expect(hub.sockets).toHaveLength(1);
    clock.advance(1);
    expect(hub.sockets).toHaveLength(2);
    hub.drop(); // the attempt fails
    clock.advance(2000);
    expect(hub.sockets).toHaveLength(3);
    hub.drop();
    clock.advance(3999);
    expect(hub.sockets).toHaveLength(3);
    clock.advance(1);
    expect(hub.sockets).toHaveLength(4);
    hub.open();
    hub.drop();
    clock.advance(1000);
    expect(hub.sockets).toHaveLength(5);
  });

  it("drops messages while the socket is closed instead of queueing them", () => {
    const { hub, server } = setup();
    server.send({ type: "listProjects", requestId: "r1" });
    hub.open();
    expect(hub.sentTypes()).toEqual(["hello"]);
  });

  it("throttles presence to 20 Hz and sends the latest position", () => {
    const { hub, clock, server } = setup();
    hub.open();
    server.sendPresence(presence(1));
    server.sendPresence(presence(2));
    server.sendPresence(presence(3));
    expect(hub.sentTypes()).toEqual(["hello", "presence"]);
    clock.advance(50);
    const sent = hub.last().sent.map((raw) => JSON.parse(raw));
    expect(sent.filter((m) => m.type === "presence").map((m) => m.cursor.x)).toEqual([1, 3]);
  });

  it("close() stops reconnecting", () => {
    const { hub, clock, server } = setup();
    hub.open();
    server.close();
    expect(hub.last().closed).toBe(true);
    hub.drop();
    clock.advance(60_000);
    expect(hub.sockets).toHaveLength(1);
  });

  it("serverSink sends presence through the throttle and everything else at once", () => {
    const calls: string[] = [];
    const fake: WsServer = {
      send: (m) => void calls.push(`send ${m.type}`),
      sendPresence: (m) => void calls.push(`presence ${m.type}`),
      close: () => {},
    };
    const sink = serverSink(fake);
    sink({ type: "workspace", op: { type: "list", requestId: "r1" } });
    sink({ type: "presence", projectId: "p1", generation: "g1", cursor: null, selection: [] });
    expect(calls).toEqual(["send listProjects", "presence presence"]);
  });
});
```

- [x] **Step 2: Run it and see it fail**

Run: `pnpm --filter @fm/web test ws-server`
Expected: FAIL, `Cannot find module '../src/adapters/ws-server'`.

- [x] **Step 3: Implement** `packages/web/src/adapters/ws-server.ts`

```ts
import { clientMessageFor, serverMessageEvent, type Event as EditorEvent } from "@fm/editor";
import { parseServerMessage, type ClientMessage } from "@fm/protocol";
import type { ServerEffectSink } from "./effect-runner";

// The WebSocket adapter (spec §5.2, §7.2): moves bytes, owns reconnect backoff (§8) and presence throttling (§7.6).
// Behaviour stays in the editor: it reopens the project when told the connection is open.

export type SocketHandlers = { open(): void; message(data: string): void; close(): void };
export type SocketLike = { send(data: string): void; close(): void; isOpen(): boolean };
export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketLike;
export type Clock = { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const; // 1, 2, 4 … max 30 s
export const PRESENCE_INTERVAL_MS = 50; // 20 Hz

type PresenceMessage = Extract<ClientMessage, { type: "presence" }>;

export type WsServer = { send(msg: ClientMessage): void; sendPresence(msg: PresenceMessage): void; close(): void };

export type WsServerOptions = {
  url: string;
  clientId: string;
  name: string;
  dispatch(e: EditorEvent): void;
  socket?: SocketFactory; // tests inject a fake
  clock?: Clock;
};

export function createWsServer(opts: WsServerOptions): WsServer {
  const openSocket = opts.socket ?? browserSocket;
  const clock = opts.clock ?? browserClock;
  let socket: SocketLike | null = null;
  let failures = 0;
  let retry: number | null = null;
  let stopped = false;
  let lastPresence = Number.NEGATIVE_INFINITY;
  let pendingPresence: PresenceMessage | null = null;
  let presenceTimer: number | null = null;

  /** Dropped while closed: the editor resyncs after reconnecting and never relies on delivery. */
  function send(msg: ClientMessage): void {
    if (socket !== null && socket.isOpen()) socket.send(JSON.stringify(msg));
  }

  function connect(): void {
    socket = openSocket(opts.url, {
      open() {
        failures = 0;
        send({ type: "hello", clientId: opts.clientId, name: opts.name });
        opts.dispatch({ type: "serverEvent", event: { type: "connection", state: "open" } });
      },
      message(data) {
        const parsed = parseServerMessage(data);
        if (!parsed.ok) {
          console.warn(`[rm] ignored a server message: ${parsed.error}`);
          return;
        }
        opts.dispatch(serverMessageEvent(parsed.value));
      },
      close() {
        socket = null;
        if (stopped) return;
        opts.dispatch({ type: "serverEvent", event: { type: "connection", state: "closed" } });
        const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 30_000;
        failures += 1;
        retry = clock.setTimeout(() => {
          retry = null;
          connect();
        }, delay);
      },
    });
  }

  function flushPresence(): void {
    presenceTimer = null;
    const msg = pendingPresence;
    pendingPresence = null;
    if (msg === null) return;
    lastPresence = clock.now();
    send(msg);
  }

  function sendPresence(msg: PresenceMessage): void {
    pendingPresence = msg; // only the latest position matters
    if (presenceTimer !== null) return;
    const wait = lastPresence + PRESENCE_INTERVAL_MS - clock.now();
    if (wait <= 0) flushPresence();
    else presenceTimer = clock.setTimeout(flushPresence, wait);
  }

  function close(): void {
    stopped = true;
    if (retry !== null) clock.clearTimeout(retry);
    if (presenceTimer !== null) clock.clearTimeout(presenceTimer);
    socket?.close();
    socket = null;
  }

  connect();
  return { send, sendPresence, close };
}

/** The effect runner's server sink: editor effects become client messages (the mapping lives in @fm/editor). */
export function serverSink(server: WsServer): ServerEffectSink {
  return (effect) => {
    const msg = clientMessageFor(effect);
    if (msg.type === "presence") server.sendPresence(msg);
    else server.send(msg);
  };
}

const browserSocket: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.open();
  ws.onmessage = (e) => {
    if (typeof e.data === "string") handlers.message(e.data);
  };
  ws.onclose = () => handlers.close();
  return { send: (data) => ws.send(data), close: () => ws.close(), isOpen: () => ws.readyState === WebSocket.OPEN };
};

const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};
```

A socket that fails to connect fires `close` without `open`, so failed attempts back off too. `BACKOFF_MS[0] - 1` in the test is `999`.

- [x] **Step 4: Run it and see it pass**

Run: `pnpm --filter @fm/web test ws-server`
Expected: PASS (7 tests).

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/web/src/adapters/ws-server.ts packages/web/test/ws-server.test.ts
git commit -m "web: WebSocket adapter with hello, backoff reconnect, presence throttle and effect sink"
```

---

### Task 7.15: Project list screen and server mode in the web shell

The app runs in **server mode** when a server URL is known: the `?server=` URL parameter wins over `VITE_SERVER_URL`, and `?server=off` forces local mode. The phase 4 and 5 Playwright specs open `?server=off`, so they stay local even when Playwright reuses a dev server started with `VITE_SERVER_URL` (for example `pnpm demo`); the collaboration test (Task 7.16) passes `?server=`.

The project list covers the canvas while no drawing is open:

- an input with placeholder `Project name` and a `Create` button; the editor opens a project as soon as it is created;
- one button per project, named after it;
- the loading and error states.

A **Projects** button returns to the list; the editor refuses while an edit is outstanding.

The WebSocket adapter is created inside `mountCanvas`, before the runner is set. Its socket opens asynchronously, so no server event can reach the store before effects can run.

**Files:** Modify `packages/web/src/identity.ts`, `packages/web/test/identity.test.ts`, `packages/web/src/styles.css`. Create `packages/web/src/panels/ProjectList.tsx`, `packages/web/test/project-list.test.tsx`. Replace `packages/web/src/app.tsx`, `packages/web/src/main.tsx`.

- [x] **Step 1: Write the failing tests.** Append to `packages/web/test/identity.test.ts`, and add `serverUrlFrom` to its import from `../src/identity`:

```ts
describe("serverUrlFrom", () => {
  it("prefers ?server= over the build-time URL", () => {
    expect(serverUrlFrom("?server=ws%3A%2F%2Flocalhost%3A8788", "ws://localhost:8787")).toBe("ws://localhost:8788");
    expect(serverUrlFrom("", "ws://localhost:8787")).toBe("ws://localhost:8787");
  });

  it("is local mode without a URL, or with ?server=off", () => {
    expect(serverUrlFrom("", undefined)).toBeNull();
    expect(serverUrlFrom("", "  ")).toBeNull();
    expect(serverUrlFrom("?server=off", "ws://localhost:8787")).toBeNull();
  });
});
```

`packages/web/test/project-list.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectList } from "../src/panels/ProjectList";

const send = (): void => {};

describe("ProjectList", () => {
  it("offers a create form and one button per project", () => {
    const html = renderToStaticMarkup(
      <ProjectList list={{ items: [{ id: "p1", name: "Apartment" }, { id: "p2", name: "Office" }], loading: false, error: null }} send={send} />,
    );
    expect(html).toContain('placeholder="Project name"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Create<\/button>/);
    expect(html).toMatch(/<button[^>]*data-project-id="p1"[^>]*>Apartment<\/button>/);
    expect(html).toMatch(/<button[^>]*data-project-id="p2"[^>]*>Office<\/button>/);
    expect(html).not.toContain("Loading");
  });

  it("shows loading, errors and an empty list", () => {
    const loading = renderToStaticMarkup(<ProjectList list={{ items: [], loading: true, error: null }} send={send} />);
    expect(loading).toContain("Loading");
    expect(loading).not.toContain("No projects yet");
    const offline = renderToStaticMarkup(<ProjectList list={{ items: [], loading: false, error: "Offline: reconnecting…" }} send={send} />);
    expect(offline).toContain('role="alert"');
    expect(offline).toContain("Offline: reconnecting…");
    expect(offline).toContain("No projects yet");
  });
});
```

- [x] **Step 2: Run them and see them fail**

Run: `pnpm --filter @fm/web test identity project-list`
Expected: FAIL: `serverUrlFrom` is not exported and `../src/panels/ProjectList` cannot be resolved.

- [x] **Step 3: Implement `serverUrlFrom`.** Append to `packages/web/src/identity.ts`:

```ts
/**
 * The server to use: `?server=` wins over the build-time `VITE_SERVER_URL`; `?server=off` forces local mode.
 * null means local mode: one unsaved drawing and no project list (spec §7.0).
 */
export function serverUrlFrom(search: string, buildTime: unknown): string | null {
  const param = new URLSearchParams(search).get("server")?.trim() ?? "";
  if (param !== "") return param === "off" ? null : param;
  return typeof buildTime === "string" && buildTime.trim() !== "" ? buildTime.trim() : null;
}
```

- [x] **Step 4: Implement** `packages/web/src/panels/ProjectList.tsx`

```tsx
import { useState, type FormEvent } from "react";
import type { UiAction, ViewModel } from "@fm/editor";

type Props = { list: NonNullable<ViewModel["projectList"]>; send(action: UiAction): void };

/** The project list (spec §1.4 step 1, §7.2.1). It renders the ViewModel and sends ui events only. */
export function ProjectList({ list, send }: Props) {
  const [name, setName] = useState("");

  const create = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    send({ type: "createProject", name: trimmed });
    setName("");
  };

  return (
    <section className="project-list" data-testid="project-list">
      <h1>Projects</h1>
      <form onSubmit={create}>
        <input aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create</button>
      </form>
      {list.loading ? <p className="muted">Loading…</p> : null}
      {list.error !== null ? <p className="error" role="alert">{list.error}</p> : null}
      {list.items.length === 0 && !list.loading ? <p className="muted">No projects yet</p> : null}
      <ul>
        {list.items.map((p) => (
          <li key={p.id}>
            <button type="button" data-project-id={p.id} onClick={() => send({ type: "openProject", id: p.id })}>
              {p.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [x] **Step 5: Run them and see them pass**

Run: `pnpm --filter @fm/web test identity project-list`
Expected: PASS: `identity.test.ts` (4 tests) and `project-list.test.tsx` (2 tests).

- [x] **Step 6: Replace** `packages/web/src/app.tsx`

```tsx
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { UiAction } from "@fm/editor";
import { CommandBar } from "./panels/CommandBar";
import { ProjectList } from "./panels/ProjectList";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { StatusBar } from "./panels/StatusBar";
import { Toast } from "./panels/Toast";
import { Toolbar } from "./panels/Toolbar";
import type { EditorStore } from "./store";

export type AppProps = { store: EditorStore; mountCanvas(canvas: HTMLCanvasElement): () => void; serverMode?: boolean };

export function App({ store, mountCanvas, serverMode = false }: AppProps) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    return mountCanvas(canvas);
  }, [mountCanvas]);

  const send = useCallback((action: UiAction) => store.dispatch({ type: "ui", action }), [store]);

  return (
    <div className="app">
      <Toolbar view={view} send={send} />
      <div className="workspace">
        <div className="canvas-host">
          <canvas ref={canvasRef} data-testid="canvas" style={{ cursor: view.cursor }} />
          {view.projectList !== null ? <ProjectList list={view.projectList} send={send} /> : null}
          {serverMode && view.project !== null ? (
            <button
              type="button"
              className="projects-button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => send({ type: "showProjectList" })}
            >
              Projects
            </button>
          ) : null}
        </div>
        <PropertiesPanel view={view} send={send} />
      </div>
      <CommandBar view={view} />
      <StatusBar view={view} />
      <Toast view={view} />
    </div>
  );
}
```

`onMouseDown` with `preventDefault` keeps focus off the button, like the toolbar: a focused button would also react to `Space` and `Enter`.

- [x] **Step 7: Replace** `packages/web/src/main.tsx`

```tsx
import { createRoot } from "react-dom/client";
import { initialState } from "@fm/editor";
import { attachInput } from "./adapters/input";
import { createCanvas2DRenderer } from "./adapters/canvas2d-renderer";
import { createEffectRunner } from "./adapters/effect-runner";
import { createTimers } from "./adapters/timers";
import { createWebHost } from "./adapters/web-host";
import { createWsServer, serverSink } from "./adapters/ws-server";
import { App } from "./app";
import { displayNameFrom, serverUrlFrom, tabClientId } from "./identity";
import { createEditorStore } from "./store";
import "./styles.css";

// Composition root. Server mode when a server URL is known (?server= or VITE_SERVER_URL), otherwise
// local mode: one unsaved LocalDocument and no project list (spec §7.0, §10 step 4).
const host = createWebHost();
const clientId = tabClientId(sessionStorage, () => crypto.randomUUID());
const name = displayNameFrom(location.search);
const serverUrl = serverUrlFrom(location.search, import.meta.env.VITE_SERVER_URL);
const initial = initialState(
  {
    mode: serverUrl === null ? "local" : "server",
    me: { clientId, name },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio,
  },
  host,
);
const store = createEditorStore({ initial, host });
const timers = createTimers(store.dispatch);

function mountCanvas(canvas: HTMLCanvasElement): () => void {
  const renderer = createCanvas2DRenderer(canvas);
  // The socket opens asynchronously, so the runner below is in place before any server event arrives.
  const server = serverUrl === null ? null : createWsServer({ url: serverUrl, clientId, name, dispatch: store.dispatch });
  store.setRunner(
    createEffectRunner({
      renderer,
      timers,
      server: server === null ? null : serverSink(server),
      onView: store.publishView,
    }),
  );
  const detach = attachInput(canvas, store.dispatch); // sends viewportResized at once → first frame
  return () => {
    detach();
    server?.close();
    store.setRunner(() => {});
    renderer.dispose();
  };
}

// Work that closing the tab would lose (spec §7.0, §7.7): local edits, or a submission whose outcome is unknown.
window.addEventListener("beforeunload", (e) => {
  if (store.getView().project?.dirty === true) {
    e.preventDefault();
    e.returnValue = "";
  }
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root element missing");
createRoot(root).render(<App store={store} mountCanvas={mountCanvas} serverMode={serverUrl !== null} />);
```

- [x] **Step 8: Styles.** Append to `packages/web/src/styles.css`:

```css
.project-list {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 16px;
  background: var(--bg);
  overflow: auto;
}

.project-list h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.project-list form {
  display: flex;
  gap: 8px;
}

.project-list input {
  width: 240px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  user-select: text;
}

.project-list button,
.projects-button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}

.project-list button[type="submit"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.project-list ul {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 320px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.project-list li button {
  width: 100%;
  text-align: left;
}

.project-list .error {
  color: var(--danger);
}

.projects-button {
  position: absolute;
  top: 8px;
  left: 8px;
}
```

- [x] **Step 9: Check the app by hand.** Terminal 1: `pnpm dev:server`. Terminal 2: `VITE_SERVER_URL=ws://localhost:8787 pnpm dev`. Open http://localhost:5173/?name=Alice, then:
  - Expect the project list. Create "Apartment": the drawing opens with status "saved".
  - Draw the room from demo step 2. Each typed segment shows "Waiting for server" briefly.
  - The Projects button returns to the list.
  - http://localhost:5173/?server=off opens local mode ("not saved", no list).

  Log anything unexpected in the sprint log.

- [x] **Step 10: Check and commit**

Run: `pnpm check && pnpm e2e`
Expected: pass. The phase 4 and 5 specs still run in local mode (`?server=off`).

```bash
git add packages/web
git commit -m "web: project list, Projects button and server mode through the WebSocket adapter"
```

- [x] **Step 11: Record it in design memory.** Add to `docs/design-memory/implementation.md` Decisions, with today's date, and commit with the next task:

```markdown
| Web mode: `?server=` wins over `VITE_SERVER_URL`, `?server=off` forces local mode; the WebSocket adapter is created in `mountCanvas` before the effect runner is set, so no server event is lost before effects can run (<date>) | One build serves both modes; the phase 4 smoke test stays local | plan phase 7 |
```

---

### Task 7.16: Playwright: two windows, one project

**Files:** Replace `packages/web/playwright.config.ts`. Modify `packages/web/e2e/support/canvas.ts` (created in phase 5). Create `packages/web/e2e/collaboration.spec.ts`.

- [x] **Step 1: Start a server for the tests.** Replace `packages/web/playwright.config.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// A fresh data directory per run for the collaboration test's server. Port 8788 leaves 8787 to `pnpm dev:server`.
// Playwright also loads this file in its workers; the extra empty temp directories they create are harmless.
const dataDir = mkdtempSync(join(tmpdir(), "fm-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec vite --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @fm/server start",
      port: 8788,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: "8788", DATA_DIR: dataDir },
    },
  ],
});
```

- [x] **Step 2: Canvas helpers.** (revised: lean mode, 2026-09-29) Task 5.10 was cut, so `canvas.ts` does not exist yet: first create it from phase 5 Task 5.10 Step 1 (`docs/plans/flatmate/phase-5-zones-helpers.md`), then continue. Phase 5 created `packages/web/e2e/support/canvas.ts` (`CENTER`, `ZOOM`, `WorldPoint`, `toScreen`, `moveTo`, `clickAt`, `typeLength`, `drawRoomWithDivider`, all taking the canvas locator). Keep them, and merge `expect` into its `@playwright/test` import (`import { expect, type Locator, type Page } from "@playwright/test";`). Then append (revised at review: phase 5 owns this file; creating it again would break `zones.spec.ts`):

```ts
export async function dragFromTo(page: Page, canvas: Locator, from: WorldPoint, to: WorldPoint): Promise<void> {
  await moveTo(page, canvas, from);
  await page.mouse.down();
  await moveTo(page, canvas, to);
  await page.mouse.up();
}

/**
 * Types a length and confirms it, then waits until the chain draws again. On a shared drawing the chain pauses
 * until the server accepts the segment (spec §5.5), and digits typed meanwhile are ignored.
 */
export async function typeLengthAndWait(page: Page, value: string): Promise<void> {
  await typeLength(page, value);
  await expect(page.getByTestId("command-value")).toHaveText("");
  await expect(page.getByTestId("command-bar")).toContainText("Next point or length");
}

/** Demo step 2 on a shared drawing: W, Shift held, typed lengths along the cursor direction, then the first joint. */
export async function drawDemoRoom(page: Page, canvas: Locator): Promise<void> {
  await page.keyboard.press("w");
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.down("Shift");
  const legs: [WorldPoint, string][] = [[{ x: 3, y: 0 }, "6"], [{ x: 6, y: 2 }, "4"], [{ x: 3, y: 4 }, "6"]];
  for (const [p, length] of legs) {
    await moveTo(page, canvas, p);
    await typeLengthAndWait(page, length);
  }
  await clickAt(page, canvas, { x: 0, y: 0 });
  await page.keyboard.up("Shift");
}
```

- [x] **Step 3: Write the test** `packages/web/e2e/collaboration.spec.ts`

```ts
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clickAt, dragFromTo, drawDemoRoom, moveTo } from "./support/canvas";

const canvasOf = (page: Page) => page.getByTestId("canvas");

const SERVER = "ws://localhost:8788"; // started by playwright.config.ts

async function openAs(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?name=${name}&server=${encodeURIComponent(SERVER)}`);
  await expect(page.getByTestId("project-list")).toBeVisible();
  return page;
}

test("two windows share a project: each sees the other, and Bob's wall move changes Alice's drawing", async ({ browser }) => {
  const project = `Apartment ${Date.now()}`;

  // Demo step 1: Alice creates the project; it opens at once.
  const alice = await openAs(browser, "Alice");
  await alice.getByPlaceholder("Project name").fill(project);
  await alice.getByRole("button", { name: "Create" }).click();
  await expect(alice.getByTestId("project-name")).toHaveText(project);

  // Demo step 2 on a shared drawing: each segment waits for the server.
  await drawDemoRoom(alice, canvasOf(alice));
  await expect(alice.getByTestId("project-status")).toHaveText("saved");

  // Demo step 7: Bob opens the same project.
  const bob = await openAs(browser, "Bob");
  await bob.getByRole("button", { name: project }).click();
  await expect(bob.getByTestId("project-name")).toHaveText(project);

  // Presence travels on pointer moves and is not replayed to late joiners (spec §7.2.1, §7.6).
  await moveTo(alice, canvasOf(alice), { x: 1, y: 1 });
  await moveTo(bob, canvasOf(bob), { x: 2, y: 2 });
  await expect(alice.getByTestId("collaborators")).toContainText("Bob");
  await expect(bob.getByTestId("collaborators")).toContainText("Alice");

  // Alice selects the bottom wall; Bob drags the right wall 1 m to the right.
  await alice.keyboard.press("v");
  await clickAt(alice, canvasOf(alice), { x: 3, y: 0 });
  await expect(alice.locator('[data-field-id="length"]')).toHaveValue("6.00");
  await bob.keyboard.press("v");
  await dragFromTo(bob, canvasOf(bob), { x: 6, y: 2 }, { x: 7, y: 2 });
  await expect(alice.locator('[data-field-id="length"]')).toHaveValue("7.00");
  await expect(bob.getByTestId("project-status")).toHaveText("saved");
});
```

- [x] **Step 4: Run it**

Run: `pnpm e2e`
Expected: PASS: `smoke.spec.ts` (1 test) and `zones.spec.ts` (2 tests) in local mode, and `collaboration.spec.ts` (1 test). Common failures:
- the project list never appears: the server did not start on 8788 (see the `webServer` output) or `?server=` was not read;
- digits missing from a length: `typeLengthAndWait` did not wait for the chain to resume;
- `7.00` never appears: check the sync tests first (`pnpm --filter @fm/sync-tests test`), then Bob's drag coordinates.

Record every failure and its fix in the sprint log.

- [x] **Step 5: Check and commit**

```bash
pnpm check
git add packages/web/playwright.config.ts packages/web/e2e docs/design-memory/implementation.md docs/plans/flatmate/phase-7-collaboration.md
git commit -m "web: Playwright test with two windows on one server project"
```

---

### Task 7.17: Reconnect check by hand (gate evidence)

> **Moved (revised: lean mode, 2026-09-29).** Do this check once, during the Task 8.8 rehearsal; skip it here.

**Files:** none, unless the check finds a bug. This task produces evidence for the gate report.

- [ ] **Step 1: Two windows.** Terminal 1: `pnpm dev:server`. Terminal 2: `VITE_SERVER_URL=ws://localhost:8787 pnpm dev`. Open `?name=Alice` and `?name=Bob` in two windows side by side.
- [ ] **Step 2: The collaboration demo.** Run demo steps 1–3 and 6–8 (spec §1.4); steps 4–5 too, now that phase 5 has landed. Time the pause after each typed segment by eye. Note whether the "Waiting for server" prompt flickers or is visible.
- [ ] **Step 3: Kill the server mid-drag.** Start dragging a joint in Alice's window, then in terminal 3 run `pkill -f "tsx src/main.ts"`. Expected:
  - Alice's drag is cancelled with "Connection lost: editing resumes when it returns";
  - both status bars show "offline";
  - the restart loop brings the server back within about a second;
  - both windows reconnect within the backoff (1 s, then 2 s), return to "saved", and the drawing matches in both;
  - Bob's cursor reappears in Alice's window after Bob moves the mouse.
- [ ] **Step 4: Kill the server with an edit outstanding.** This is hard to time by hand; the sync tests in Task 7.13 cover it. Try once with a slow typed segment and record what you saw.
- [ ] **Step 5: Log the results** in the sprint log (kind: evidence), with timings.

---

## Completion criteria

- [x] `pnpm check` passes with `@fm/sync-tests` included; `pnpm e2e` passes every spec (smoke and zones in local mode, collaboration against the server). (Lean mode: no zones spec, Task 5.10 cut.)
- [x] Every row of the spec §7.4 table has a test:

  | §7.4 row | Test |
  |----------|------|
  | valid local commit while ready | `shared-document.test.ts` "a commit sets inFlight…" |
  | document-edit input while blocked | `recovery.test.ts` "while an edit is outstanding…", `shared-undo.test.ts` "waits for the ordinary pending edit" |
  | consecutive `changes` (own / remote) | `shared-document.test.ts` "own consecutive changes…", "remote consecutive changes…", "a remote change that breaks the overlay's expectations…" |
  | matching `ack` with seq ≤ confirmed | "matching ack at or below confirmed seq…" |
  | matching `ack` ahead of confirmed | "a matching ack ahead of confirmed seq…", `shared-scenarios.test.ts` "an early ack…" |
  | matching `rejected` | "a matching rejection clears inFlight…" |
  | duplicate changes / unrelated ack | "duplicate changes are ignored", "unrelated acks and rejections change nothing" |
  | sequence gap | "a sequence gap requests a snapshot…", `recovery.test.ts` "a missed change is detected…" |
  | disconnect | "a disconnect keeps the outstanding edit…", `shared-tools.test.ts` "a dropped connection ends the paused chain…" |
  | snapshot | "a snapshot with an outstanding edit…", "a snapshot without…", `shared-scenarios.test.ts` "snapshot already contains my edit…" |

- [x] Spec §9 sync row covered in `@fm/sync-tests`:
  - same-entity conflict with convergence;
  - different entities both accepted;
  - crossing walls → `invalid`;
  - a blocked second edit is not replayed;
  - a duplicate/resent submit is acked once from the receipt;
  - a sequence gap → snapshot;
  - an undo racing a remote edit is refused;
  - a remote change cancels an affected drag and refreshes an unaffected one;
  - ~~a late joiner derives the same zones~~ (cut with Task 7.13's trim).
- [x] Spec §9 acceptance scenarios covered:
  - pause and resume, including closing a resumed chain on its first joint, a red preview after an unrelated move, and an end on a remote topology change;
  - the fixed-endpoint resize conflict;
  - history invalidation by write overlap, including a restored value;
  - snapshot + same-ID resend;
  - an old-generation response is ignored;
  - ~~opening during a submission~~ (cut with 7.13; server side covered by `server-app.test.ts`);
  - crash during save, before and after the write reached disk (server side, `crash-restart.test.ts`; the client-side scenario was cut with 7.13);
  - demo step 8.
- [x] Only `open-document.ts` switches on document kind: `grep -rn 'kind === "shared"\|kind === "local"\|case "shared"' packages/editor/src` lists only `document/`.
- [x] Demo steps 1–3 and 6–8 work in two browser windows against `pnpm dev:server`, and 4–5 as well with phase 5. The manual reconnect check (Task 7.17) is recorded. (Two windows covered by `collaboration.spec.ts`; the hand check moves to Task 8.8.)
- [x] Every finding is in the sprint log and in design memory (README working rule 5).

## Gate 7

Follow the [gate protocol](README.md#gate-protocol) with report `docs/reports/gate-7-collaboration.md`. Phase-specific verification:

```bash
pnpm check
pnpm --filter @fm/editor test shared session tools gestures undo presence wire   # the phase 7 editor tests
pnpm --filter @fm/sync-tests test --reporter verbose
pnpm e2e
grep -rn 'kind === "shared"\|kind === "local"\|case "shared"' packages/editor/src   # expect document/ only
grep -rnwE "async|await|Promise|setTimeout|WebSocket" packages/editor/src          # expect no output
```

Also the manual runs of Tasks 7.15 (Step 9) and 7.17.

The report must answer:

1. **§7.4 coverage.** Confirm the completion table: name the test for every row, and add any row the tests showed was missing.
2. **Unspecified interleavings.** Which interleavings did the tests find that spec §7.4 does not describe? For example: a snapshot while a history request is pending, a resync while a gesture was paused, or `created` arriving while another project was opening. Give the resolution for each, and record it in the spec and in `collaboration.md` if it changes behaviour.
3. **Latency.** How long is the paused chain on a local server, and is it visible in the demo? If it is, record the observation; do not add optimistic chaining (a Don't in `collaboration.md`).
4. **Reconnect.** What happened when the server was killed mid-demo (Task 7.17)? Report the time to recover, whether any gesture or edit was lost or doubled, and whether the backoff felt right.
5. **Readings made while planning.** Confirm or change each one:
   - the positional anchor check for a drawing chain;
   - leaving refused (not queued) while an edit is outstanding;
   - the local `tooLarge` guard;
   - presence cleared on every connection change;
   - a shared document is dirty while an edit is outstanding.
6. **Risks for phase 8.** What is fragile in the two-window demo (timing, focus, cursor presence after reload), and which fallback does the rehearsal need?

## Contract extensions

Additions to the README contracts; nothing is renamed.

- **`@fm/editor` document:**
  - `document/shared-document.ts`: `SnapshotEvent`, `sharedFromSnapshot`, `computeVisible`, `withVisible`, `sharedCanCommit`, `sharedStatus`, `sharedCommit`, `sharedOnEvent`.
  - `document/open-document.ts`: `hasPendingEdit(d)`, `sessionOf(d)`. `isDirty` is true for a shared document while `inFlight` is set.
- **`@fm/editor` ports and session:**
  - `ports/wire.ts`: `ServerEffect`, `serverMessageEvent(msg)`, `clientMessageFor(effect)`, all exported from the index.
  - `session.ts`: `OFFLINE_LIST`, `LEAVE_BLOCKED`, `NAME_REQUIRED`.
- **`@fm/editor` tools and history:**
  - `gestures.ts`: `resumeChain`, `endChainOnRejection`, `onRemoteChange`, `cancelGestures`, `CHAIN_ENDED`, `GESTURE_CANCELLED`, `CONNECTION_LOST`.
  - `history/history.ts`: `hasEntry`.
  - `tools/select-tool.ts`: `rerunMove`.
  - `tools/wall-tool.ts`: `placePoint` leaves the tool unchanged when the commit was rejected in the same step.
- **Editor index** additionally exports `SharedDocument`, `hasPendingEdit`, `sessionOf`, `sharedFromSnapshot`, `SnapshotEvent`, `serverMessageEvent`, `clientMessageFor`, `ServerEffect`, `REMOTE_UNDO`, `REMOTE_REDO`, `CHAIN_ENDED`, `CONNECTION_LOST`, `GESTURE_CANCELLED`, `LEAVE_BLOCKED`, `NAME_REQUIRED` and `OFFLINE_LIST`.
- **Editor test harness:** `package.json` `exports["./testing"]` → `test/testing.ts`, which exports `FakeHost`, `FakeShell`, `FakeRemote` and the builders. `FakeHost(prefix = "")`; `FakeShell.command(cmd)`. New `test/shared-builders.ts` and `test/fake-remote.ts`.
- **`@fm/server`:** `package.json` `exports["."]` → `src/index.ts`, which exports `createServerApp`, `createInMemoryRepository`, `domainValidator`, and the types `Connection`, `ServerApp`, `ServerAppDeps`, `Session`, `InMemoryRepository`, `ChangesetValidator`, `ProjectRepository` and `ProjectState`.
- **`@fm/sync-tests`:** a new package; `test/net.ts` has `Net`, `Client`, `sharedRoom`, `drawRoom`, `drawDivider`, `projectIdOf`, `seqOf` and `submitIds`.
- **`@fm/web`:**
  - `adapters/ws-server.ts` has `SocketHandlers`, `SocketLike`, `SocketFactory`, `Clock`, `BACKOFF_MS`, `PRESENCE_INTERVAL_MS`, `WsServer` (as in the README), `WsServerOptions` (with optional `socket` and `clock`) and `serverSink(server): ServerEffectSink`.
  - `identity.ts` has `serverUrlFrom(search, buildTime)`, and `panels/ProjectList.tsx` has `ProjectList`.
  - `App` gains the prop `serverMode`, and the app reads the URL parameter `?server=`.
  - The Playwright config also starts a server on port 8788; phase 7 appends `dragFromTo`, `typeLengthAndWait` and `drawDemoRoom` to phase 5's `e2e/support/canvas.ts`.
- **Behaviour the contracts did not state:**
  - creating a project opens it;
  - leaving a drawing while an edit is outstanding is refused with a toast;
  - with no drawing open, a reconnect refreshes the list and repeats a pending open;
  - presence is cleared on every connection change and every open;
  - a submission over `MAX_MESSAGE_BYTES` is refused locally as `rejected{tooLarge}`;
  - a drawing chain's origin dependency is checked by position.

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-29 | all | process | Lean mode: waves {7.1→7.3, 7.4+7.14, 7.10} · {7.5} · {7.6→7.7, 7.8} · {7.9, 7.15→7.16} · {7.11→7.13}; reviews after waves 1 and 3 | 1 fix below | `process.md` |
| 2026-09-29 | 7.1 | deviation | The plan's "refuses a commit while blocked" test built its input from a document whose corner had already moved | Input built from `shared()` first; `state.test.ts` narrows the now-union `OpenDocument` | none |
| 2026-09-29 | 7.1, 7.5, 7.6, 7.7 | carried | Carried phase 3 tests added: blocked commit throws, submitted changeset shape and effects, `sharedCommit` returns a new object, `Cmd+Z` on a paused chain waits, a submitted undo mid-chain drops the chain, an ordinary edit during a pending undo | All pass | none |
| 2026-09-29 | 7.5 | deviation | The plan's `_left` destructuring is flagged by ESLint (only `_` parameters are exempt); presence client IDs used as map keys unchecked | `Object.entries` filter; `isValidId` guard | `open-documents.md` |
| 2026-09-29 | 7.6 | deviation | Snapshots and disconnects must also cancel `editingHelper` (phase 5); `notices.ts` keeps the phase 3 invariant-named rejection text | Test "a snapshot cancels a resize being typed" | `editor-interaction.md` |
| 2026-09-29 | 7.12 | plan fix | The plan expected "Rejected: the drawing would become invalid" for crossing walls; the editor names the invariant ("Walls can't cross", spec §4.0) | Expectation updated | none |
| 2026-09-29 | 7.5 | bug (review) | A late `created` reply opened the new project even after the user opened another one, closing a drawing with an outstanding edit | Only list it then; test added. Also: the offline-drag test now checks the drag never starts | `collaboration.md`, spec §7.2.1 |
| 2026-09-29 | 7.13, 7.17 | trimmed | 7.13 keeps blocking and reconnect; 7.17 moves to 8.8 | none | none |
