# How the plan is executed (resume here)

> Part of the [Flatmate plan](README.md). Read this first when resuming in a new session. Then read the README (working rules, gate protocol, contracts), the current phase file (ticked steps, `## Sprint log`) and `docs/design-memory/INDEX.md`.

## Where we are

Update this section at every stop.

- **Branch:** `implementation` (`master` still ends at the plan commit `22f3cfe`). Never push.
- **Phase 2 (domain):** done; Gate 2 approved 2026-09-28 (report `docs/reports/gate-2-domain.md`, last code commit `aaf6e42`, domain 20 files, 186 tests).
- **Phase 3 (headless editor):** done; Gate 3 approved 2026-09-29 (report `docs/reports/gate-3-editor.md`).
- **Phase 4 (web shell):** done; Gate 4 approved 2026-09-29 (report `docs/reports/gate-4-web-shell.md`).
- **Phase 5 (zones and helpers):** done; Gate 5 approved 2026-09-29.
- **Phase 6 (server):** done; Gate 6 approved 2026-09-29.
- **Phase 7 (collaboration):** done; Gate 7 approved 2026-09-29.
- **Phase 8 (demo polish, final gate):** done in lean mode (8.1→8.5, 8.2, 8.3, 8.4 in parallel, then 8.7 README; 8.6 cut; 8.8 run 1 scripted incl. the reconnect check). Final report `docs/reports/gate-8-demo-polish.md`; Gate 8 approved 2026-09-29. The plan is complete. `pnpm check` 786 tests; `pnpm e2e` 2 passed.
- **After the plan (2026-09-29):** fixes `6732ebb` (labels follow their room), `1070eb9` (grid snap is the fallback, ignores the tolerance), `bd39a4e` (aligned snap: a point lines up with other joints' x/y, so walls can be made vertical at any zoom; lesson 31); spec §1.1 Crux sentence softened; §11 reordered (1 MCP server, 2 WebGL2 renderer).
- **After the follow-ups (2026-09-30):** SDF debug view `?sdf=debug` (S1.6, `a83c9a6`); zone tags fit their room when zoomed out: both lines, name only, or hidden, checked against the clear floor outline (`8ea8a5d` + the floor-outline fix; spec §5.9). §11 item 4 (project delete) added. C1 CAD snaps (15° angle, perpendicular; wall tool only; spec §5.8, plan `docs/plans/flatmate-snaps/`) merged `d38e75c`, review approved.

### Now (resume here after a context clear)

- **S1 (WebGL renderer): all code and docs merged; gate report `docs/reports/gate-s1-webgl.md` written; **Gate S1 approved 2026-09-29**.** Reviews found one real defect (helper line through its label under WebGL, fixed in the editor `b6c1d36`, lesson 32).
- **M1 (MCP server): all code and docs merged** (M1.1–M1.10 plus M1.9b `add_walls` for a maze demo, and the Review B fix). Gate report `docs/reports/gate-m1-mcp.md`; **Gate M1 approved 2026-09-30** (the user drew a maze and an apartment with Claude Code, free-form).
- **Both follow-ups are done.** Open for the user: a timed dry run of the rehearsal incl. rows 10a (scripted maze prompt) and 10b (WebGL toggle).
- HEAD `7115a80`+; `pnpm check` 899 tests (protocol 94, domain 194, editor 381, web 108, server 53, sync-tests 14, scripts 3, mcp 52); `pnpm e2e` 7 passed, screenshots skipped.
- **Naming:** in messages to the user, always write the feature next to the ID: "S1 (WebGL renderer)", "M1 (MCP server)".

| | S1: WebGL2 SDF renderer + live toggle | M1: MCP server (Claude as a collaborator) |
|---|---|---|
| Spec (the design) | §6.2 | §12 |
| Plan | [`../flatmate-s1/README.md`](../flatmate-s1/README.md) + `tasks.md` (S1.0a–S1.5) | [`../flatmate-mcp/README.md`](../flatmate-mcp/README.md) + `tasks.md` (M1.1–M1.11) |
| Design memory | `rendering.md` | `mcp.md` |
| Wave 1 | S1.0a screenshots, S1.0b renderer seam, S1.1 wall edges → review S1.1 | M1.1 editor `command` event, M1.2 package scaffold → review A (M1.1) |
| Later waves | see the S1 README "Waves" | see the M1 README "Waves" |
| Gate report | `docs/reports/gate-s1-webgl.md` | `docs/reports/gate-m1-mcp.md` |

- **How the history got here:** plans written and their code run in scratch copies (S1 at `1607c0d`, M1 at `bc7e47d`) → designs moved into the spec first (`bbfd448`, the user's rule: spec says *what*, plans say *how*) → both plans rechecked against the spec and the code changed since (`508a355`; each README's sprint log has a "recheck" row).
- **Decided (in the spec, don't reopen):** `draw_room` is four changesets, pre-checked together (§12.5); `list_projects` closes the drawing (§12.2); MCP tool calls run one at a time (§12.3); §6.2 uses `clamp(0.5 − d·dpr, 0, 1)` coverage and 5–9 draw calls.
- **Still open for the user:** M1 gate questions 2 (exact rehearsal prompt vs free-form) and 3 (keep or cut Claude's cursor, M1.9); rehearsal run 2 by hand (timed).

### Running S1 and M1 in parallel

- Use "One wave, step by step" below for each plan. In the implementer template, the task file is `docs/plans/flatmate-s1/tasks.md` or `docs/plans/flatmate-mcp/tasks.md` (give line ranges), and the working rules are still `docs/plans/flatmate/README.md` ("Working rules for every task").
- Dispatch a wave of each plan at the same time if you like, but **merge one plan's wave, run `pnpm check`, then merge the other's**. Never merge both at once.
- Shared files and merge rules: the M1 README, "Parallel development with S1". In short: `pnpm-lock.yaml` is never hand-merged (take one side, `pnpm install`, commit the result); the root `package.json` gets both scripts (`mcp`, `screenshots`, both after `e2e`); docs keep both sides.
- **Ports:** only S1.0a (screenshots) and the controller's `pnpm e2e` start servers (5173, 8787, 8788). Before wave 1, ask the user to stop any `pnpm demo` they have running (`lsof -i :5173 -i :8787 -i :8788`).
- Bookkeeping per wave goes in that plan's README (Progress ticks, Sprint log); commit it as `plan: S1 wave N (…)` or `plan: M1 wave N (…)`, and update "Now" above.
- Each plan ends at its own gate: write the report, then stop for the user's approval.

- Phases 1–3 settled notes below are history; the code wins where they differ.
- Wave 1 settled: failed opens are answered with `openFailed { projectId, generation, message }` and matched like snapshots; `error` never ends an open (spec §7.2, lesson 26). `NO_MODS` is frozen (`Readonly<Mods>`); `zoomAt` returns the camera unchanged for a factor that is not finite and > 0; only `_` parameters are exempt from the unused rule.
- Wave 2 settled: `SnapContext` has no `tolerance` (the chooser takes it); snap priority comes from a `PRIORITY` table by kind; `ViewModel.snap.kind` excludes `"none"`; `ports.test.ts` pins every port union with `Record<…["type"], true>`, so a later task that adds a variant must add it there too. Type-only tests are red in the typecheck, not in `vitest` (lesson 27).

- Wave 3 settled: history `rejected` drops only an unconfirmed (pending or invalid) entry with that ID; `recordCommit` throws while a history request is pending (only `runCommand` calls it, after `canCommit`); phase 7 Task 7.7 gains a test for an ordinary edit during a pending undo request; phase 7's private helper is `segmentDependencies`.

- Wave 4 settled: `entityExists` and `draggedJoints` check `isValidId`; an ID from a validated document's own keys counts as checked, outside strings must pass `isValidId` (domain-geometry Don't; phase 5's exported `tagLayout` needs the guard). `COLORS.helper` is teal; `DEFAULT_ME_COLOR`; `onToastTimer` returns a `Step`; `WallPreview` is a union on `ok`; `MoveAttempt` has no `patch`/`message`; `localState` takes no ID from the caller's host.

- Wave 5 settled: `runHistory` validates the tentative document and commits under a fresh host ID; server `invalid` rejections name the invariant via the domain's `invariantsMessage`; `drawSnap` is exhaustive; `labelBox` lives in `view/labels.ts` (phase 5's `helperBox` uses it); the properties panel shows committed values during a drag; phase 7 has a "Tests carried over from phase 3" list.

- Wave 6 settled: pointer routing lives in `pointer.ts`; the cursor follows the camera (`followCamera` replays the last pointer move after a wheel, a resize and a pan's end; spec §5.4); only an applied undo/redo drops the gesture (`undoRedo`, detected by a new document object); `FakeShell.wheel`; phase 7 gains carried tests (wheel presence, refused undo on a paused chain, `sharedCommit` returns a new object).

- Wave 7 settled: `PREVIEW_OP` and `Moves` live in `tools/types.ts`; `MoveAttempt` is one object type with `moves`, and the release commits them (spec §5.7); the drag threshold is in world units; the nearest handle wins; a vanished press target ends the press; a click clears the typed value and a click on the chain's origin is ignored (spec §5.5); per-move cost is a Gate 3 risk (domain validation).

- Wave 8 settled: the editor index exports only the values later phases import (named exports, no write paths); `FakeShell.type(text, mods?)`; the headless demo holds Shift while typing and passes through red; `PublicTypes` pins exported types; per-move cost measured warm with `performance.now()`.

## How the user wants to work (lean mode from phase 4, 2026-09-29)

The user asked to relax tests and steps after Gate 3 ("keep in mind this is a demo"). Phases 1–3 used the heavier process (two reviews per wave, mutation checks, a stop after each wave); see `docs/design-memory/process.md`.

- **Run waves back to back; stop only at gates** (README gate protocol), with a report of about one page.
- **Parallel agents on Opus**, each in its own git worktree (Agent tool: `model: "opus"`, `isolation: "worktree"`, `subagent_type: "general-purpose"`).
- **One review per wave, only for core logic** (editor, domain, server app, shared document, sync): one Opus reviewer checks plan compliance and code quality together. Glue code (web adapters, React panels, launcher, README, styling, scaffolding) gets no review; `pnpm check`, the Playwright smoke and a check by hand cover it.
- **Fix only what matters for the demo:** a finding that breaks the demo, leaves an invalid drawing, or lets two clients diverge. Drop minor and style findings without recording them.
- **The code wins over the plan text.** Implementers adapt stale plan code to the actual code and report it; the controller does not re-sync later phases' code copies.
- Explain results simply, with small tables or ASCII sketches.
- **Cut from the plan:** Tasks 5.10, 6.12 and 8.6. **Trimmed:** 6.11 (one restart test), 7.13 (blocking and reconnect only), phase 7 carried tests (undo and convergence only). Task 7.17's hand check happens once during the 8.8 rehearsal.

## One wave, step by step

1. **Group tasks** by import dependencies (each task's `**Files:**` line and imports). Tasks in a wave must touch disjoint files.
2. **Dispatch one implementer per task** with the template below.
3. **Merge:** for each report, check `git show --stat <sha>` (only the task's files, no scratch tests), then `git cherry-pick <sha…>` → for each worktree: `git worktree remove --force <path>` and `git branch -D <branch>` → `pnpm check`.
4. **Core waves only: one review** (Opus, read-only) over the wave's diff: plan compliance and code quality, reporting only demo-breaking, invalid-drawing or divergence defects (plus rule breaks: `as`, `!`, DOM in cores). Then one fix agent if needed, merged the same way.
5. **Bookkeeping, one docs commit per wave:** tick steps, one sprint-log row per real finding or deviation, design memory only when a decision changes, spec if behaviour changed. Update "Where we are". Commit `plan: phase M wave N (…)`, then start the next wave.

## Implementer prompt template

```
You are implementing one task of a written implementation plan, test-first, in an isolated git worktree.

## Project context
Flatmate: a small collaborative 2D floor-plan CAD editor. TypeScript pnpm monorepo with a hexagonal
core: @fm/protocol ← @fm/domain ← @fm/editor. Packages import each other's TypeScript sources (no build step).
<what already exists; recent review changes that affect this task>. Other agents work in parallel in their own
worktrees; stay strictly inside your task's files.

## Your task: Task <N> "<title>"
The full task text is in docs/plans/flatmate/<phase file>, lines <a>–<b>. Read it in full and follow it exactly.
Files: <files>. Background (read, don't edit): README working rules (lines 45–64), the contract section,
the spec sections <§>, docs/design-memory/<area>.md (Decisions and Don't).

## Steps
1. git log --oneline -1 must show <sha> (else stop, NEEDS_CONTEXT); pnpm install.
2. Write the test from the plan; run `pnpm --filter @fm/<pkg> test <test file>` (no `--`); confirm it FAILS for
   the expected reason (skip for tasks without tests).
3. Write the implementation from the plan; run it again green.
4. pnpm check from the worktree root must pass.
5. Commit only your files with the plan's commit message. Do not push.

## Rules
- No `as` (except `as const`) and no `!` in core src; no DOM/Node APIs in cores; assertNever in switches.
- If lint or types fail on the plan's code, make the minimal behaviour-preserving fix and report it.
- The plan's code may be stale where earlier phases changed the code: the actual code wins. Adapt minimally and
  report each adaptation.
- If a test fails: don't weaken the test; investigate; fix minimally and explain, or stop with
  NEEDS_CONTEXT/BLOCKED and the exact output.
- Do NOT edit docs/. Do not edit files outside your list.

## Report
STATUS (DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED); worktree, branch, SHA; green count;
pnpm check totals; deviations from the plan text (short).
```

## Gotchas met so far

- Editor diagnostics about missing modules after a merge usually come from removed agent worktrees; trust `pnpm check` in the main tree.
- Agent worktrees live in `.claude/worktrees/` (git- and ESLint-ignored). Remove them after merging, or `eslint .` may lint their copies.
- Run one test file with `pnpm --filter <pkg> test <pattern>`; `test -- <pattern>` runs every file.
- zsh: avoid `echo =====` (the `=` expands); shell `cd` prints a harmless zoxide warning.
- The plan's code was checked in scratch with only part of the lint config; expect small `@eslint/js` fixes.
- Reviews found real bugs in every core wave of phases 2–3 (ID handling, outline coverage, merge dependencies); lean mode keeps one review for core waves.
- Brief implementers on known Don'ts the plan's code breaks (e.g. unchecked `isValidId` lookups) as a planned deviation with its own red test, then revise the plan text to match.
- A worktree stays locked until its agent's completion notification arrives; remove it after that.
- Tests of existing code are green from the start: ask agents to mutation-check each new assertion, and to verify any formula the brief gives numerically (wave 5: the brief's area formula was wrong; the agent caught it).
- Filter tests need the filtered candidate inside tolerance, and mutation checks of policies catch weak fixtures (wave 2 of phase 3: 6 of 17 mutations survived the plan's snapping tests, then 7 of 29 survived the strengthened ones).
- An agent's sandbox may refuse a compound Bash command (heredoc writes chained with `&&`) as hard to verify; single commands and the Write tool work (wave 3 of phase 3).
- Port pre-flight: use `lsof -sTCP:LISTEN -i :5173 -i :8787 -i :8788`; plain `lsof -i` also lists an editor's CLOSED client sockets (S1 wave 1).
- A doc-only agent may stall after committing (wave 1 of phase 3: the watchdog killed it after its report); check for its commit before re-running.
- If the auto-mode safety classifier returns no verdict, agents lose Bash and cannot commit (wave 4). Then the controller checks the worktree itself: diff the task files against the plan's code blocks, delete scratch files, run the test and `pnpm check`, commit there with the plan's message, then merge as usual.
