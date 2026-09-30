# M1: MCP server, Claude as a collaborator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude edits a Flatmate drawing like a third browser window. A new shell, `packages/mcp` (`@fm/mcp`), speaks MCP over stdio and runs the headless editor against the real collaboration server as a normal client. Its edits go through the editor's commit path, the one-outstanding-edit rule and server validation, and they appear live in the browser windows. Spec §11 item 1 and demo step 10 (§1.4).

**Spec:** §12 (the design: tools, outcomes, summary, constraints), §1.4 step 10, §2.3, §2.4, §3.4 (commands), §5.1–§5.2 (update, Host, effects, events), §7.0–§7.7 (shared documents, one outstanding edit, protocol, presence, reconnect), §11 item 1. **Design memory:** `mcp.md`.

**Design memory to read first:** `INDEX.md`; `architecture.md` (shells change state only through `update`; packages meet only through entry points; one wire mapping in `@fm/editor/src/ports/wire.ts`; the index exports no write paths); `collaboration.md` (one outstanding edit, no local queue); `open-documents.md`; `process.md` lessons 21 (probe a boundary by every route), 25 (tests green from the start need a mutation check), 26 (correlate every reply), 29 (trust boundaries).

**How it runs:** lean mode, as in [`../flatmate/EXECUTION.md`](../flatmate/EXECUTION.md): waves of parallel Opus implementers in git worktrees (implementer prompt template there; point it at [`tasks.md`](tasks.md) instead of a phase file), one review per core wave, one gate at the end. The code wins over stale plan text. Working rules and commands are those of [`../flatmate/README.md`](../flatmate/README.md) ("Working rules for every task", "Gate protocol"); the gate report is `docs/reports/gate-m1-mcp.md`.

**Tech stack additions:** `@modelcontextprotocol/sdk` **1.31.0** (pinned; latest on npm on 2026-09-29), `zod` ^4.6.5 (the SDK's peer: `^3.25 || ^4.0`), `ws` ^8.22.0 (as the server), `tsx` ^4.23.15 (dev). All code in this plan was run in a scratch copy of the repo before it was written down, first at `1607c0d` and again at `bc7e47d` (the S1 plan commit): `pnpm check` green, 839 tests (794 + 5 editor + 40 MCP), plus a manual reconnect check against a killed and restarted server. Test counts will move as other work lands; compare deltas, not totals.

---

## Decisions

Made by the user (not reopened here):

| # | Decision |
|---|----------|
| U1 | New shell package `packages/mcp` (`@fm/mcp`): MCP over stdio with the official TypeScript SDK. |
| U2 | It runs the headless editor (`initialState` + `update`, a Node `Host`) and connects to the collaboration server as a normal client with `ws` and the editor's wire mapping (`clientMessageFor`, `serverMessageEvent`). Presence shows a "Claude" cursor near its last edit (optional task, last). |
| U3 | The editor gains exactly one event, `{ type: "command"; command: Command }`, routed through `runCommand` (blocking, history, toasts). Nothing new that writes is exported. |
| U4 | Tools: `list_projects`, `create_project`, `open_project`, `get_drawing`, `draw_room(x, y, width, height)` (uses `rectangleRoom`), `add_wall(a, b)`, `set_wall_length(wall, length)` (keeps endpoint a), `move_joint(joint, to)`, `label_room(point, name)`, `rename_room(label, name)`, `delete(ids)`. Each edit waits for accept, reject or offline and returns the drawing summary or the reason text. Inputs are validated at the MCP boundary. |
| U5 | Tests: Vitest in `packages/mcp` against the real server app in memory (like sync-tests' `Net`), driving the session and the tool handlers directly; one stdio end-to-end test. |

Made while planning (confirm at the gate):

| # | Decision | Why |
|---|----------|-----|
| P-M1 | `visibleDoc` joins the editor index's read-only queries (next to `hasPendingEdit`, `sessionOf`). | The session must read the drawing it shows; it is a read, not a write path. `index.test.ts` also pins that `runCommand` stays private. |
| P-M2 | `FakeShell.command` sends the new event instead of calling `runCommand`. | One commit path for tests and the MCP shell; every existing test that uses `command` now exercises the event (all existing editor and sync tests stay green: 366 and 14 at `bc7e47d`). |
| P-M3 | `draw_room` is four `addWall` edits, one changeset each, in order. Before submitting, it runs the four commands through `execute` on the current drawing; if any would fail, nothing is submitted and the reason comes back. | `rectangleRoom` returns four commands and the editor event carries one. A local check first means a domain error never leaves a partial room; only a concurrent remote edit can stop it half-way, and then the reply says so. See open question Q1. |
| P-M4 | The session runs tool calls one at a time, in arrival order (a promise chain in the shell). | Claude may call tools in parallel. Each command still runs against the settled document after the previous outcome; nothing is optimistic or replayed, so this is not the edit queue §7.4 forbids. |
| P-M5 | `list_projects` goes to the project list (the editor's `showProjectList`), so it leaves the open drawing; `create_project` creates and opens. | The editor lists projects only from the project list. Listing without leaving would need a shell-side request that bypasses `update`. |
| P-M6 | An edit's outcome is read from the editor: the `submit` effect names the changeset; it has settled when `hasPendingEdit` turns false; a `rejected` message for that ID gives the editor's toast text as the reason; a toast raised by the dispatch itself (no submit) is a local refusal. Waits end with `CONNECTION_DROPPED` on disconnect and `NO_ANSWER` after 10 s. | Reuses the editor's texts ("Walls can't cross", "Someone else changed this first", "Waiting for server") instead of re-deriving them; correlated by changeset ID and generation (lesson 26). After a drop, the editor's same-ID resend still settles the edit on reconnect (§7.7). |
| P-M7 | Validation lives in zod input schemas the SDK applies before a handler runs: coordinates finite and within ±10 000 m, sizes in (0, 1 000] m, IDs via `isWireId`, names trimmed to 1–200 characters (`MAX_NAME_CHARS`, `MAX_NAME_LENGTH`), 1–50 ids for `delete`; unknown fields are dropped. | Lesson 29: bound the shape, not only the type. The domain checks again (IDs, names), so a schema gap is not a correctness hole. |
| P-M8 | IDs from `crypto.randomUUID()`, as in the web host; client name from `FM_NAME` (default "Claude"); server from `FM_SERVER_URL` (default `ws://localhost:8787`). | Same ID shape as browser edits; the demo needs no configuration. |
| P-M9 | Launch with `pnpm mcp` (root script `pnpm --silent --filter @fm/mcp start`). stdout carries JSON-RPC: ESLint allows only `console.error`/`console.warn` in `packages/mcp/src`. The process exits when stdin ends. | `pnpm` without `--silent` prints a banner on stdout, which breaks the protocol (checked). |
| P-M10 | The end-to-end test spawns the real server (`node --import tsx src/main.ts`, `PORT=0`, temporary `DATA_DIR`) and the MCP server through the SDK's `StdioClientTransport`; it runs in `pnpm check` (about 1 s). | Spawning is practical: the server prints its port, both entry points run under `tsx`, and the test proves the stdout discipline and the real WebSocket path. |

## Architecture

```
 Claude Code / Claude Desktop
        │  MCP (JSON-RPC over stdio)
        ▼
┌──────────────────────────── @fm/mcp (new shell) ────────────────────────────┐
│ main.ts        composition root: env, Node host, ws link, StdioServerTransport│
│ server.ts      McpServer: 12 tools, zod input schemas (schemas.ts)           │
│ tools.ts       handler per tool → one domain Command (draw_room: four)       │
│ drawing.ts     Document → compact JSON summary (walls, joints, rooms, m/m²)  │
│ session.ts     EditorSession: owns EditorState; dispatch = update(); waits   │
│                for outcomes; one tool call at a time                        │
│ ws-link.ts     WebSocket adapter: parse frames, reconnect with backoff       │
│ node-host.ts   Host: randomUUID, performance.now, fixed-width text estimate  │
└───────┬────────────────────────────────────────────────────────┬────────────┘
        │ update(state, event, host) → { state, effects }         │ ClientMessage / ServerMessage
        ▼                                                          ▼
   @fm/editor (+ one event: command → runCommand)           collaboration server
        │                                                   (ws://localhost:8787)
        ▼                                                          │ changes, presence
   @fm/domain ──► @fm/protocol                         browser windows (Alice, Bob)
```

One edit, end to end:

```
tool call add_wall(a, b)
  └─ schemas.ts: shape OK
      └─ tools.ts: { type: "addWall", opId, from: {at: a}, to: {at: b} }
          └─ session.edit: dispatch({ type: "command", command })
              └─ update → runCommand: canCommit? execute → commit → history → notices
                  ├─ refused (domain error, blocked): toast, no submit ──► reply: toast text
                  └─ submit effect {changeset c7} ──► ws ──► server validates
                        ├─ changes + ack c7  → hasPendingEdit false ──► reply: drawing summary
                        ├─ rejected c7       → toast "Someone else changed this first" ──► reply
                        └─ connection closed → CONNECTION_DROPPED (the editor resends c7 on reconnect)
```

Dependencies (checked by dependency-cruiser):

```
@fm/mcp/src ──► @fm/editor, @fm/domain, @fm/protocol   (entries only), ws, @modelcontextprotocol/sdk, zod
@fm/mcp/test ─► also @fm/server (entry only: createServerApp, createInMemoryRepository, domainValidator)
nothing ──────► @fm/mcp
```

## Files

| Action | Path | Responsibility | Task |
|--------|------|----------------|------|
| Modify | `packages/editor/src/ports/events.ts` | `Event` gains `{ type: "command"; command: Command }` | M1.1 |
| Modify | `packages/editor/src/update.ts` | `case "command"` → `runCommand` | M1.1 |
| Modify | `packages/editor/src/index.ts` | export `visibleDoc` (read-only query) | M1.1 |
| Modify | `packages/editor/test/fake-shell.ts` | `command()` sends the event | M1.1 |
| Modify | `packages/editor/test/ports.test.ts`, `test/index.test.ts` | pin the new variant and export; `runCommand` stays private | M1.1 |
| Create | `packages/editor/test/command-event.test.ts` | the event's behaviour on local and shared documents | M1.1 |
| Create | `packages/mcp/package.json`, `packages/mcp/tsconfig.json` | the package; all dependencies (lockfile changes once) | M1.2 |
| Create | `packages/mcp/src/node-host.ts`, `test/node-host.test.ts` | Node `Host` | M1.2 |
| Modify | `package.json` (root), `pnpm-lock.yaml` | `mcp` script; lockfile from `pnpm install` | M1.2 |
| Modify | `.dependency-cruiser.cjs`, `eslint.config.js` | MCP ring rules; no stdout logging in `packages/mcp/src` | M1.2 |
| Create | `packages/mcp/src/drawing.ts`, `test/drawing.test.ts` | drawing summary | M1.3 |
| Create | `packages/mcp/src/schemas.ts`, `test/schemas.test.ts` | tool input schemas (trust boundary) | M1.4 |
| Create | `packages/mcp/src/session.ts`, `test/harness.ts`, `test/session.test.ts` | `EditorSession`; in-memory link to the real server app | M1.5 |
| Create | `packages/mcp/src/tools.ts`, `test/tools.test.ts` | tool handlers | M1.6 |
| Create | `packages/mcp/src/server.ts`, `test/server.test.ts` | `McpServer` with the 11 tools (tested over `InMemoryTransport`) | M1.7 |
| Create | `packages/mcp/src/ws-link.ts`, `src/main.ts`, `test/stdio.e2e.test.ts` | WebSocket adapter, entry point, stdio end-to-end test | M1.8 |
| Modify | `packages/mcp/src/session.ts`, `src/tools.ts`, `test/tools.test.ts` | presence: a "Claude" cursor at the last edit (optional) | M1.9 |
| Modify | `README.md`, `docs/reports/demo-rehearsal.md`, `docs/specs/flatmate-design.md` | "Use with Claude", step 10 row, spec touch-ups | M1.10 |
| Create/Modify | `docs/design-memory/mcp.md`, `INDEX.md`, `architecture.md`, `implementation.md` | memory | M1.10 |
| Create | `docs/reports/gate-m1-mcp.md` | gate report | M1.11 |

## Waves

Tasks in a wave touch disjoint files and run in parallel worktrees. A task starts only after the waves it imports from are merged.

| Wave | Tasks | Depends on | Review |
|------|-------|------------|--------|
| 1 | M1.1 editor event (S) ∥ M1.2 package scaffold (S) | — | **Review A** (core): M1.1 only |
| 2 | M1.3 drawing (S) ∥ M1.4 schemas (S) ∥ M1.5 session (L) | wave 1 (M1.5 uses the event and `visibleDoc`) | — |
| 3 | M1.6 tools (M) | wave 2 | **Review B** (boundary): M1.4 + M1.5 + M1.6 together |
| 4 | M1.7 MCP server (S) | wave 3 | — |
| 5 | M1.8 ws link + entry + e2e (M) ∥ M1.9 presence (S, optional) | wave 4 (M1.9 only waves 1–3) | — |
| 5b | M1.9b `add_walls` (S), added 2026-09-29 | wave 5 | — (reuses `editAll`, covered by Review B's fix) |
| 6 | M1.10 docs and memory (M) | waves 1–5b | — |
| 7 | M1.11 gate (manual checks with Claude and two browser windows; report) | all | stop for approval |

Review A checks: the event takes exactly the tool path (blocking, history, notices, toasts); nothing new writes from the index; `FakeShell.command` still covers the old tests. Review B checks: every input is bounded before it reaches the editor; every wait ends (accept, reject, refusal, drop, timeout); replies are correlated by changeset ID and generation; no state change outside `update`; `draw_room` never leaves a partial room on a domain error. Report only demo-breaking, invalid-drawing or divergence defects, plus rule breaks.

### Parallel development with S1 (WebGL renderer, `docs/plans/flatmate-s1/`)

M1 owns `packages/mcp/**` and seven editor files (above). The S1 plan (committed as `bc7e47d`) lives in `packages/web/**` plus `packages/editor/src/view/scene.ts` and `packages/editor/test/view.test.ts`; its renderer toggle is shell-only (no new editor event). So the two plans share **no source file**. Shared files, and how merges go (both plans cherry-pick onto `implementation`, one wave at a time):

| Shared file | M1 change | S1 change | Merge rule |
|-------------|-----------|-----------|------------|
| `pnpm-lock.yaml` | M1.2: `packages/mcp` importer (SDK, zod, ws, tsx) | S1.2: `earcut` for `packages/web` | Never hand-merge. On conflict: `git checkout --theirs pnpm-lock.yaml && pnpm install`, then `pnpm check`, and commit the regenerated file with the cherry-pick. |
| `package.json` (root) | M1.2: script `mcp` after `e2e` | S1.0a: script `screenshots` after `e2e` | Same spot, so a textual conflict is likely: keep both lines (mind the commas). |
| `eslint.config.js`, `.dependency-cruiser.cjs` | M1.2: one config block, three rules | none planned | If S1 adds any, keep both; rerun `pnpm lint` and `pnpm depcruise`. |
| `README.md` | M1.10: "Use with Claude"; Limits paragraph | S1.5: renderer text; the same Limits paragraph ("Rendering is Canvas2D only …", "§11 … not implemented") | The later docs task rewrites that paragraph by hand to state both (S1.5 says it keeps M1's lines). |
| `docs/reports/demo-rehearsal.md` | M1.10: row 10a (Claude) and one pre-flight line | S1.5: its step 10 row (renderer toggle) | Keep both rows; number them 10a / 10b. |
| `docs/specs/flatmate-design.md` | §11 item 1 "Done" marker; §12 only if the code differs | §11 item 2 "Done" marker; §6.2 only if the code differs | The designs were written before implementation (`bbfd448`), so only small hunks remain; keep both. |
| `docs/design-memory/INDEX.md` | MCP row (drop ", not built"); Architecture summary | Rendering summary | Keep both; one "Last updated" date. |
| `docs/design-memory/implementation.md` | two rows | its rows | Keep both. |

Rule for the controllers: do not merge an M1 wave and an S1 wave at the same moment; merge one, run `pnpm check`, then the other.

## Completion criteria

Each bullet names the step that produces its evidence.

- [x] The editor handles `{ type: "command" }` through `runCommand`: local commit with history, domain error as toast, one submit on a shared document, refusal while an edit is outstanding (M1.1 `command-event.test.ts`); `runCommand` is not exported (M1.1 `index.test.ts`).
- [x] `pnpm check` green, including `@fm/mcp` typecheck, lint, dependency rules and tests (every task's last step).
- [x] Dependency rules refuse `packages/mcp/src` → server, web, sync-tests or `@fm/editor/testing`, and any package → `packages/mcp` (M1.2 step 6, probe imports).
- [x] Every tool input is bounded (M1.4 `schemas.test.ts`), and the SDK refuses invalid input before a handler runs (M1.7 `server.test.ts`).
- [x] Against the real server app: accepted edit reaches another client; local refusal returns the toast text and submits nothing; server rejection returns its text; drop and timeout end the wait; parallel calls run in order (M1.5 `session.test.ts`).
- [x] Every tool works against the real server app, `draw_room` refuses a room against an existing wall without submitting anything, and another client sees Claude's room (M1.6 `tools.test.ts`).
- [x] Over stdio against a real server process: `create_project`, `draw_room`, `get_drawing` return a 10.64 m² room (M1.8 `stdio.e2e.test.ts`).
- [x] (Optional) Another client sees Claude's cursor where its last edit happened (M1.9).
- [x] With `pnpm demo` running and Claude Code connected (`claude mcp add …`), asking Claude to draw the rehearsal's maze (row 10a) shows it in both browser windows, with the "Claude" cursor (M1.11 manual check 1). (revised in M1.10: was a bathroom) Done 2026-09-30 by the user with their own free-form prompts (a maze and an apartment), not the scripted row.
- [~] Killing the server during a session: the next edit returns the offline text; after the restart loop brings it back, edits work again (M1.11 manual check 2). Checked by the M1.8 agent on a random port, not repeated by hand with Claude Code.
- [x] README, rehearsal row, spec and design memory updated (M1.10).

## Gate questions (for the user at M1.11)

Settled in the spec before implementation (§12, commit `bbfd448`); reopen only if the gate shows a problem:
- `draw_room` is four changesets, pre-checked together; a concurrent edit can stop it part-way (§12.5, was Q1).
- `list_projects` closes the open drawing (§12.2, was Q2).
- Tool calls run one at a time, stated next to §7.4's "no local edit queue" (§12.3, was Q3).

Still open:
1. Does the implementation match §12? List every difference and how §12 was updated (M1.10 step 3).
2. Rehearsal: the step 10 prompt names the exact walls (see M1.10). Keep the precise prompt, or try a free-form "add a bathroom" and accept whatever Claude does?
3. Presence (M1.9): done or cut?

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-29 | plan | tooling | Plan code run in a scratch copy at `1607c0d` and `bc7e47d`: `pnpm check` green (839 tests at `bc7e47d`); stdio e2e about 1 s; `pnpm` without `--silent` prints a banner on stdout, which breaks MCP | `pnpm mcp` uses `--silent`; ESLint `no-console` rule for `packages/mcp/src` | `implementation.md` (M1.10) |
| 2026-09-29 | plan | deviation | `rectangleRoom` returns four commands but "each editing tool submits one changeset" | `draw_room` pre-checks the four commands, then submits four changesets (P-M3; gate question 1) | `mcp.md` (M1.10) |
| 2026-09-29 | plan | recheck | Spec §12 written from this README before implementation (`bbfd448`); code changed since `bc7e47d` only in snapping and the scene's snap glyph (`bd39a4e`, aligned snap), which M1 does not touch; editor tests now 372 | M1.10 steps 3–4 trimmed to what remains; `§11 M1` references now `§12`; gate questions 1–3 settled in the spec | `mcp.md` (`bbfd448`) |
| 2026-09-29 | wave 1 | merge | M1.1 and M1.2 applied verbatim (base `87b4c58`); M1.2's five probe imports each refused by the expected rule; Review A approved with no findings. Root `package.json` conflicted with S1.0a's `screenshots` script | kept both scripts; lockfile taken from M1.2 unchanged; `pnpm check` 826 tests (editor 378, mcp 2) | — |
| 2026-09-29 | wave 2 | merge | M1.3, M1.4, M1.5 applied verbatim (base `f3be93b`); plan values (10.64 m², `r-1/w0` IDs) hold after `6732ebb`; mutation checks of M1.4 (`isWireId`) and M1.5 (`rejected`, `serial`) went red as planned | merged; mcp 28 tests | — |
| 2026-09-29 | M1.5 | note | `ready()` while disconnected (or after `close()`) returns `NOT_CONNECTED` only after `timeoutMs` | passed to Review B | — |
| 2026-09-29 | M1.6 | review | Review B: `draw_room` pre-checked outside the serial chain and queued each wall separately, so a parallel tool call ran between walls; reproduced: two parallel `draw_room`s left three stray walls ("after 3 of 4 walls") | fix: check and four walls in one serial turn (`editAll`); spec §12.3 sentence made explicit | `mcp.md`, `process.md` lesson 33 |
| 2026-09-29 | waves 3–5 | merge | M1.6, M1.7, M1.8 applied verbatim; M1.8 test moved `client.connect` inside `try` so a failed handshake still kills the child; plan step 4 used plain `pnpm mcp`, whose banner breaks stdout | step 4 text now `pnpm --silent mcp`; reconnect checked by hand on a random port (offline text, then edits work after restart); stdio e2e about 0.5 s | — |
| 2026-09-29 | M1.9b | scope | User asked for a maze demo; with `add_wall` a 30-wall maze is 30 model turns | `add_walls` (1–50 walls, one call, pre-checked, one turn) designed in spec §12 first, then task M1.9b; rehearsal row 10a becomes a maze (M1.10) | `mcp.md` |
| 2026-09-29 | M1.10 | docs | Maze for row 10a checked with a throwaway test through the tools against the step-5 apartment (and with its right wall at x = 7): 7 walls accepted, 9 new walls with two T-splits, 11 joints, no new room, areas unchanged, cursor (10.5, 3). "Label it Maze" fails on an open maze ("Click inside a room"). §12 vs code: `delete` refuses unknown ids before sending; project tools wait up to 10 s for the connection, edits get the offline text at once; presence at the room's centre for `draw_room`, none for `delete`; rooms carry the reason an area is unavailable | row 10a ends with a question instead of a label; bathroom prompt kept as fallback; §12.2, §12.4, §12.5 aligned; README (twelve tools, `@fm/mcp` rows), rehearsal, memory updated | `mcp.md`, `architecture.md`, `implementation.md`, `INDEX.md` |
| 2026-09-30 | M1.11 | gate | User drew a maze and an apartment with Claude Code over MCP, free-form: "it is working" | manual check 1 passed; gate M1 approved; the scripted row 10a prompt was not run by hand | — |
