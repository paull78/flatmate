# D1: Project delete — plan

**Spec:** §7.2.1 "Deleting a project" (the design), §7.1 (`remove`), §7.2 (messages), §5.2 (`deleteProject` ui action), §12.3 and §12.5 (MCP). **Memory:** `collaboration.md` (project delete row), `mcp.md` (closed-drawing check). **How it runs:** lean mode (`../flatmate/EXECUTION.md`): D1.1 first, then D1.2 and D1.3 in parallel worktrees, then D1.4; one review over D1.2 + D1.3 (server app and editor are core). The code wins over this text.

```
Bob (list) ── deleteProject ──► server: project queue ── remove file ──► projectDeleted ──► Alice: back to the list + toast
     ◄────────── projects (new list) ─┘
Alice offline during the delete: reconnect ─► reopen ─► openFailed ─► same as projectDeleted
```

## Task D1.1: protocol messages — size S

**Files:** `packages/protocol/src/messages.ts`, `packages/protocol/test/messages.test.ts` (or the existing parser test file).

- [x] **Step 1: Tests first** (seen red): `parseClientMessage` accepts `deleteProject { requestId, projectId }` and refuses a bad `requestId` or `projectId` ("Invalid deleteProject"); `parseServerMessage` accepts `projectDeleted { projectId, generation }` and refuses a bad target.
- [x] **Step 2: Implement** the two union members and their parser cases (`projectTarget` for `projectDeleted`).
- [x] **Step 3:** `pnpm check` compiles everywhere else (exhaustive switches in server, editor wire, sync-tests and MCP will go red: leave them to D1.2/D1.3 only if they fail typecheck; otherwise add the minimal `case` that keeps today's behaviour).

## Task D1.2: server delete (repository + app) — size S, core

**Files:** `packages/server/src/app/{ports,server-app,testing}.ts`, `packages/server/src/adapters/json-file-repository.ts`, `packages/server/test/{server-app,json-file-repository,testing}.test.ts`.

- [x] **Step 1: Tests first** (seen red):
  - JSON repository: `remove(id)` moves `<id>.json` to `deleted/<id>.json`; then `list()` omits it (the `deleted` folder is not a project) and `load(id)` is null.
  - In-memory repository (`testing.ts`): same contract.
  - App: Alice opens P, Bob sends `deleteProject` → Alice gets `projectDeleted` with her generation, Bob gets `projects` without P; Alice's next submit gets `rejected{unknownProject}`; a later `openProject` P gets `openFailed`; an unknown ID gets `error { requestId, message: "Unknown project" }`.
  - Ordering: a submit queued before the delete is saved and acked first; the delete runs after it (use the deferred save of the existing queue tests).
  - A `remove` that throws calls `onFatal`.
- [x] **Step 2: Implement** per §7.2.1: in `handle`, `deleteProject` enqueues on the project key: `loadLive` (null → `error`), `repository.remove`, `live.delete`, for each subscriber send `projectDeleted` with its generation (later submits are rejected because the project is no longer live), then `send(requester, { type: "projects", requestId, items: await repository.list() })`.
- [x] **Step 3:** `pnpm check`.

## Task D1.3: editor + MCP — size S, core

**Files:** `packages/editor/src/ports/{events,effects,wire}.ts`, `packages/editor/src/session.ts`, `packages/editor/src/document/shared-document.ts` (ignore the new event), `packages/editor/test/{session,wire,ports}.test.ts`, `packages/mcp/src/session.ts`, `packages/mcp/test/` (session test).

- [x] **Step 1: Tests first** (seen red):
  - `ui deleteProject { id }` on the list emits `workspace { op: { type: "delete", requestId, projectId } }` and sets `loading`; ignored with a drawing open, while `opening`, and in local mode.
  - `wire`: `delete` op ↔ `deleteProject`; `projectDeleted` → `serverEvent`. `ports.test.ts` union pins updated.
  - `projectDeleted` for the open project and generation: document null, selection, history and presence cleared, a `list` request, toast "This project was deleted"; with a pending edit too. Another project or an old generation: ignored.
  - `openFailed` answering the open document's resync (its current generation): same as `projectDeleted`. The existing `openFailed` for `workspace.opening` keeps its behaviour.
  - MCP session: an `edit` waiting on the server when `projectDeleted` arrives resolves with `err("This project was deleted")`; the next `edit` gets `NO_DRAWING`.
- [x] **Step 2: Implement:** `UiAction` `deleteProject`, `WorkspaceOp` `delete`, `ServerEvent` adds `projectDeleted`; `session.ts` one `projectGone(state, host)` used by both cases (`closeDocument` + `showList` + toast `PROJECT_DELETED`); MCP `editNow` probe returns the toast text when `state.document` is null.
- [x] **Step 3:** `pnpm check`.

## Task D1.4: web list button + end-to-end checks — size S

**Files:** `packages/web/src/panels/ProjectList.tsx`, `packages/web/src/styles.css`, `packages/web/test/` (panel test), `packages/sync-tests/test/` (one test), `packages/web/e2e/collaboration.spec.ts` (one test).

- [x] **Step 1: Tests first** (seen red): the panel shows a Delete button per row; clicking it shows the §7.2.1 question with Delete and Cancel; Delete sends `{ type: "deleteProject", id }`, Cancel sends nothing. Sync test: Alice with a pending edit, Bob deletes, Alice is on the list with the toast and Bob's list lacks the project; reopening it fails with "Unknown project".
- [x] **Step 2: Implement** the in-place confirm (React state per row; no browser dialog).
- [x] **Step 3:** `pnpm check`, `pnpm e2e` with one new two-window test: Alice has the project open, Bob deletes it, Alice sees the list and the toast.

## Progress

- [x] D1.1 protocol (placeholder cases in server and editor keep everything compiling)
- [x] D1.2 server (done by the controller, see the log)
- [x] D1.3 editor + MCP (agent; also `update.ts` routes the new ui action)
- [x] Review (D1.2 + D1.3): one defect (list during a delete crashed the server), fixed
- [x] D1.4 web, sync test (pending edit dropped; offline client), e2e (Cancel, then Delete) — e2e 9 passed
- [ ] Published

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-10-01 | design | finding | A client offline during the delete reopens on reconnect, gets `openFailed`, and the shared document ignored it (only `workspace.opening` is matched): it would stay "syncing" forever | `openFailed` for the open document's own generation counts as "project gone" (§7.2.1) | `collaboration.md` |
| 2026-10-01 | design | finding | The MCP `edit` wait treats "no pending edit" as success; a delete closes the drawing and drops the edit, which would read as accepted | the probe checks for a closed drawing first (§12.3) | `mcp.md` |
| 2026-10-01 | D1.2 | tooling | Agent worktrees were created from `main` (the public snapshot), not `implementation`; the D1.2 agent reset its worktree branch to `78b1f9b`, then the auto-mode classifier refused its next command | D1.2 done by the controller in the main tree (disjoint from D1.3's files); EXECUTION.md gotcha added | — |
| 2026-10-01 | D1.2 | simplification | Clearing each subscriber's `project` after the delete changed nothing: a later submit already finds no live project and is rejected `unknownProject` | line dropped; spec §7.2.1 sentence trimmed | — |
| 2026-10-01 | review | defect | A `listProjects` (workspace queue) overlapping a delete (project queue) read the moved file: ENOENT → `onFatal` → server restart; also two near-simultaneous deletes. The in-memory repository hid it | `list()` skips ENOENT like `load()`; real-file race test (red 15/20 before) | `collaboration.md`, `process.md` lesson 34 |
