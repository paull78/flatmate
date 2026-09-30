# Gate M1: MCP server, Claude as a collaborator

**Approved 2026-09-30** after your hand check.

**Date:** 2026-09-29 · **Plan:** `docs/plans/flatmate-mcp/` · **Commits:** `5ed675f`..`7115a80` (interleaved with S1 on `implementation`)

## 1. Outcome

Demo step 10 (M1): Claude, connected over MCP, edits the shared drawing like a third window. `packages/mcp` runs the headless editor against the real server, so Claude's edits go through the editor's commit path, the one-outstanding-edit rule and server validation, and appear live in Alice's and Bob's windows with a "Claude" cursor. Twelve tools, including `add_walls` (up to 50 walls in one call, added at your request for a maze demo). Proven by tests against the in-memory server app and by a stdio end-to-end test against a real server process. Still needed: the manual check with Claude Code (below).

## 2. Completion criteria

- [x] The editor handles `{ type: "command" }` through `runCommand`; `runCommand` not exported (M1.1).
- [x] `pnpm check` green, incl. `@fm/mcp` typecheck, lint, dependency rules and tests.
- [x] Dependency rules refuse `packages/mcp/src` → server, web, sync-tests, `@fm/editor/testing`, and anything → `packages/mcp` (probe imports, M1.2).
- [x] Every tool input bounded; the SDK refuses invalid input before a handler runs (M1.4, M1.7, M1.9b).
- [x] Against the real server app: accepted edit reaches another client; local refusal and server rejection return their texts; drop and timeout end the wait; parallel calls run in order (M1.5).
- [x] Every tool works; `draw_room` and `add_walls` never leave a partial room or list on a domain error, also under parallel calls (M1.6, Review B fix, M1.9b).
- [x] Over stdio against a real server process: create, draw_room, get_drawing return a 10.64 m² room (M1.8, about 0.5 s).
- [x] (Optional) Another client sees Claude's cursor at its last edit (M1.9).
- [x] **Manual check 1** (you, 2026-09-30: drew your own maze and an apartment with free-form prompts, "it is working"; the scripted row 10a prompt was not run by hand): with `pnpm demo` and Claude Code connected, the maze prompt (rehearsal row 10a) draws in both windows with the "Claude" cursor.
- [~] **Manual check 2** (restart): done by the M1.8 agent against a server on a random port: while it was down, an edit replied "Offline: editing resumes when the connection returns"; after the restart, edits worked. Not yet repeated with Claude Code and `pnpm demo`.
- [x] README ("Use with Claude"), rehearsal rows 10a/10b, spec §12, design memory updated (M1.10).

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: 899 tests (protocol 94, domain 194, editor 381, web 108, server 53, sync-tests 14, scripts 3, mcp 52) |
| `pnpm e2e` | 7 passed, screenshots skipped (at `2a63fe3`; M1 changed no web code since) |
| maze prompt of row 10a | verified by a throwaway test against the real server app on the step 2–5 apartment: accepted, 7 → 16 walls (two T-splits), no new room, apartment areas unchanged, cursor at (10.5, 3) |

## 4. Implementation issues

| # | Issue | Cause | Fix | Recorded in |
|---|-------|-------|-----|-------------|
| 1 | Two parallel `draw_room` calls left three stray walls | the pre-check ran outside the serial chain and each wall took its own turn | `editAll`: check and all walls in one turn (`69252f8`) | `mcp.md` Don't, `process.md` lesson 33, spec §12.3 |
| 2 | Plan's stdout check used plain `pnpm mcp` | pnpm's banner goes to stdout and breaks JSON-RPC | plan text now `pnpm --silent mcp`; README uses `--silent` | M1 sprint log |
| 3 | "…then label it Maze" can't work | an open maze is not a closed room ("Click inside a room") | the prompt asks Claude to describe the route instead | `mcp.md` Don't |

## 5. Changes to the plan

| # | Task | Planned | Done instead | Why |
|---|------|---------|--------------|-----|
| 1 | M1.6 | four `edit` calls for `draw_room` | one `editAll` turn | Review B (issue 1) |
| 2 | M1.9b (new) | — | `add_walls`, 1–50 walls in one call | your maze request; one model turn per wall was slow |
| 3 | M1.10 | bathroom rehearsal prompt | maze prompt (bathroom kept as fallback) | your maze request |

## 6. Changes to the spec

| § | Change | Commit |
|---|--------|--------|
| §12.3 | "a tool call is one turn" made explicit | `b72817d` |
| §1.4, §11, §12.2, §12.3, §12.5 | `add_walls` | `954ae86` |
| §12.2, §12.4, §12.5 | aligned with the code: `delete` refuses unknown ids up front; a room's summary says why an area is unavailable; project tools wait up to 10 s for the connection, edits get the offline text at once; cursor places per tool | `7115a80` |

## 7. Design-memory updates

- `mcp.md`: "not implemented" header removed; decisions for `editAll`, `add_walls`, connection wait, `delete` lookup, maze rehearsal; Don'ts for per-step serialising and labelling an open maze.
- `architecture.md`, `implementation.md`: `@fm/mcp` ring rules; SDK pin, tests, `--silent`.
- `process.md`: lesson 33 (serialise the unit the guarantee is about).
- `INDEX.md`: MCP row (built), Architecture summary.

## 8. Gate questions

1. **Does the code match §12?** Yes, after the alignments in §6; every difference is listed there.
2. **Rehearsal prompt:** exact coordinates (the maze), so the step is predictable; a free-form "draw a maze" can be tried in the hand check, but no claim is made about what Claude chooses.
3. **Presence (M1.9):** done, kept.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1–9 | works (unchanged) | browser, two browsers |
| 10a Claude draws a maze | works: tests, plus your free-form hand check (2026-09-30) | Claude Code + two browsers |
| 10b WebGL toggle | works; gate S1 approved | browser |

**For your check:** `pnpm demo`; Alice and Bob windows on a project with the apartment; from the repo root `claude mcp add flatmate -- pnpm --silent --dir "$PWD" mcp`, then in a new Claude Code session paste the row 10a prompt from `docs/reports/demo-rehearsal.md`. Zoom Alice's window out (Ctrl + wheel) so x = 9–13 m is visible. Optionally kill the server (`lsof -tiTCP:8787 -sTCP:LISTEN | xargs kill`) and ask for an edit during the gap, then again after it restarts.
