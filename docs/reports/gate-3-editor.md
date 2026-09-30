# Gate 3: Headless editor

**Date:** 2026-09-29 · **Phase file:** `docs/plans/flatmate/phase-3-editor.md` · **Commits:** `f723242`..`881cc01` (branch `implementation`)

## 1. Outcome

Demo steps 2, 3 and 6 run headless through `update` alone, driven by physical-style input in `FakeShell` (`packages/editor/test/scenarios/demo.test.ts`):

```
step 2  W, Shift held, click (0,0), type 6 ⏎ 4 ⏎ 6 ⏎, click the first joint
        → 4 walls, corners exactly (0,0) (6,0) (6,4) (0,4); the chain closes
step 3  click near both wall midpoints with Shift → divider (3,0)→(3,4), exact;
        bottom and top walls split; undo restores the unsplit room exactly
step 6  select the right wall, drag its (6,4) handle to (2,2) → walls drawn red,
        release refused with "Walls can't cross", no history entry;
        drag through (2,2) and end at (4,3) → commits (4,3)
```

`@fm/editor` is a pure `update(state, event, host) → { state, effects }` core with one trailing `render` effect (scene, ViewModel, camera). It has the wall tool (§5.5), the Select tool with hit-testing and preview/commit drags (§5.6–§5.7), four snap policies with Shift and Ctrl (§5.8), key routing (§5.4), the camera and pan/zoom, toasts, value-based undo/redo on a `LocalDocument` (§7.5), and a minimal public index for the phase 4 web shell. There is no browser yet. Phase 3 ran as eight waves of Opus agents. Every wave had a spec-compliance review and a code-quality review, and every review found something real.

## 2. Completion criteria

- [x] `pnpm check` passes, and the purity grep on `packages/editor/src` prints nothing (§3). The grep first matched the word "async" in a `ports/host.ts` comment; the comment was reworded in wave 8.
- [x] `update` appends exactly one `render` effect per event, built from the final state and carrying the camera. Tests: `update.test.ts` "ends every update with one render effect, after the handler's effects" and "builds the render effect's camera and scene / view from the state after the event". The scene and view tests were added in wave 6, when a mutant built them from the input state and still passed.
- [x] Every row of the first §5.5 table has a test in `wall-tool.test.ts` (27 tests): first click, click-click, typed `Enter` and `Space`, empty `Enter`, a click on `chainStart` closes, `Esc` twice. Also tested: a rejected `addWall` keeps the tool and the typed value and shows a toast, a click clears the value, and a click on the origin is ignored.
- [x] §9 snapping rows: endpoint beats grid, the midpoint is exact, on-wall outranks grid, Shift constrains to the axis and filters candidates, Ctrl bypasses, and dragged entities are excluded. Tests in `snapping.test.ts` (18) and `select-tool.test.ts`.
- [x] Select tool (`select-tool.test.ts`, 31 tests):
  - a press selects at once;
  - the 4 px threshold, now measured in world units at the current zoom;
  - a handle drag keeps the wall selected, and the nearest handle wins;
  - a drag is one changeset: the release commits the last preview;
  - an invalid drag is red, reverts, adds no history entry and shows a toast;
  - `Esc` cancels;
  - `Delete`/`Backspace` removes a wall and its unused joints.
- [x] Undo (`undo.test.ts`, 7 tests):
  - a drag is one entry;
  - two moves, two undos and two redos restore each state (§9 acceptance);
  - a new edit clears redo;
  - `canUndo`/`canRedo` drive the toolbar;
  - a deleted free-standing wall comes back with its joints and IDs;
  - an undone wall leaves the selection.
- [x] Demo steps 2, 3 and 6 pass headless with exact coordinates, and undoing the divider restores the unsplit room exactly (§1). Two reviews tightened this:
  - wave 8: the demo now holds Shift while typing, as in §1.4, and step 6 also passes through red and ends valid;
  - wave 6: `drawRoom` typed without Shift before then.
- [x] A `LocalDocument` never pauses and accepts in the same update (`document.test.ts`, `wall-tool.test.ts`). The demo run emits only `render` effects (demo step 3 test), and presence is a stub that returns nothing in local mode.
- [x] The public index exports what phase 4 lists, plus `NO_MODS` and the types (`index.test.ts`; `PublicTypes` pins 47 type names through the typecheck). It exports no write paths (§5, row 9).
- [x] Every extension point exists with its final signature. The wave 8 spec review spot-checked `zonePointer`, `setField`, `hitTest`, `press`, `editingHelper`, `drawSelection`, `drawWalls`, `textBox`/`labelBox`, the `zoneLabels` case, `toolNotice`, `placePoint`, `drawingAt`, `blockedMessage` and the session stubs. The phase 5 and phase 7 plans were revised for every signature that changed (§5).
- [x] The sprint log is complete: 37 rows, one per merge and review. Every finding is in design memory (§7).

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: typecheck (protocol, domain, editor), lint clean, depcruise `no dependency violations found (103 modules)`; protocol 3 files / 22 tests, domain 20 / 187, editor 16 / 223 |
| `pnpm --filter @fm/editor test --reporter verbose` | 16 files, 223 tests |
| `pnpm --filter @fm/editor test test/perf.test.ts` | 200 warm pointer moves with a live wall preview on the demo document: 0.41–0.61 ms per move (three runs, `performance.now()` after 20 warm-up moves); the test asserts < 16 ms and that both valid and red previews ran |
| purity grep (`async\|await\|Promise\|setTimeout\|setInterval\|Date\|Math.random\|window\|globalThis\|console`) | no output |
| `wc -l` (largest src files) | `select-tool.ts` 171, `view/scene.ts` 165, `history/history.ts` 139, `tools/wall-tool.ts` 137, `view/view-model.ts` 110, `keys.ts` 97, `state.ts` 91; editor src total 1786 |

### Answers the phase file asks for

**1. Purity.** `update` stayed pure and synchronous; the grep prints nothing.
- The clock is only read through `host.now()`: toast expiry (`until`), and the ViewModel hides an expired toast before its timer fires.
- IDs come only from `host.newId()`: changesets, and a fresh ID per history commit (§7.5 step 3). `localState` in tests uses its own host, so the caller's first ID is not burned.
- Timers are `startTimer` effects answered by `timerFired`. An early timer re-arms with the time left.
- Text sizes come from `host.textMetrics`.
- Nothing needed randomness or I/O. `update` is "pure given the Host", and the comment says so now.

**2. Size.** The largest file is `select-tool.ts` at 171 lines; `update.ts` has 75, `keys.ts` 97, `pointer.ts` 58, `tools/wall-tool.ts` 137, `tools/hit-test.ts` 34, `tools/types.ts` 62 and `view/scene.ts` 165. Nothing is near 300, so no split is needed before phase 5, which already puts helper editing in `tools/helper-edit.ts` and zones in `view/zones-layer.ts`. One structural change: pointer routing moved out of `update.ts` into `pointer.ts` (wave 6), so `keys.ts` can replay the pointer without an import cycle.

**3. Ambiguous rules.** The planned readings:

| Reading | Held? | What happened |
|---------|-------|---------------|
| Only a click on `chainStart` closes a chain | yes | A typed length landing on the first joint does not close it (test added in wave 7). |
| A typed length uses the modifiers of the last pointer event | yes, extended | The direction also follows the camera: after a scroll, the cursor's world point is recomputed (spec §5.4, "The cursor follows the camera"). The preview and the typed length now share one "cursor on the origin" test. |
| One press selects and can drag | yes | A handle click without a drag keeps the wall selected. To select an endpoint joint, click it while its wall is not selected (recorded). |
| A wall drag moves by a grid-rounded delta | yes | `Math.round` sends halves toward +∞ (−2.5 → −2.4, +2.5 → +2.6). Two tests sat on such a half and were moved off it. |
| A joint drag snaps the joint itself and ignores its own walls | yes | Shift's axis runs through the joint, not the press point. A test now presses off-centre to pin this. |
| Digits, `Enter`, `Space` and `Backspace` are swallowed while a chain is paused | coded, untested | Only a shared document pauses; this is on phase 7's list of tests carried over. |

Rules that turned out ambiguous and were settled in the spec:
- **The cursor follows the camera** (§5.4).
- **Undo/redo mid-gesture:** one that applies drops the gesture, while a refused one only toasts (§5.4 row).
- **Clicks during a chain:** a click clears the typed value, and a click on the chain's origin is ignored (§5.5 rows).
- **Drag threshold:** measured in world units at the current zoom (§5.7).
- **Release:** it commits the last previewed moves with a fresh `execute`; the pointer-up position and modifiers play no part (§5.7).

Readings recorded in `editor-interaction.md` without a spec change:
- `Esc` in the idle Select tool clears the selection, and in the Zone tool it goes straight to Select;
- `Delete` acts only in the idle Select tool and never with `Cmd`/`Ctrl`;
- `Ctrl+Z` also undoes, and `Meta`+wheel also zooms;
- the right button reaches no tool;
- value fields ignore modifiers;
- any `pointerUp` ends a middle-drag pan;
- the nearest handle wins;
- a press target that vanishes ends the press.

**4. Scene cost.**
- **Demo document:** 0.41–0.61 ms per pointer move for the core (update, scene, ViewModel; not Canvas2D drawing or real text measurement).
- **Larger drawings** (wave 7 code review, n × n grids of 1 m rooms): about 5 ms per move at 220 walls and 19 ms at 480. Most of it is the domain's whole-document `validateDocument` inside `execute` (3.5 ms and 17 ms).
- **Memoizing before phase 5:** nothing needs it for the demo.
  - `wallOutlines` and `buildScene` are small next to validation.
  - Zones are memoized by document identity in the domain.
  - The risk is a preview `execute` on drawings of several hundred walls. A fix belongs in the domain (check only around the moved joints), not in the editor (§8).

**5. Extension points.** Nothing is missing. Several signatures changed during the phase, and the later plans were revised in the same commits:
- **Phase 5:**
  - `press` and `move` have no `pressScreen` or `screen` parameter, and use the world-unit threshold;
  - `release(state, tool, host)`;
  - the placeholder attempt has `moves: []`;
  - `handleHit` picks the nearest handle;
  - `drawRoom` holds Shift while typing;
  - `helperBox` uses `labelBox`.
- **Phase 7:**
  - Task 7.9's index append fits the "no write paths" rule, and a test-only helper belongs in `@fm/editor/testing`;
  - `sharedCommit` must always return a new document object, since `undoRedo` detects an applied request that way;
  - the list of tests carried over from phase 3 has 8 items.
- **Phase 8:** the narrated demo types with Shift held.

## 4. Implementation issues

| # | Issue | Cause | Fix | Recorded in |
|---|-------|-------|-----|-------------|
| 1 | A late `error` for a missing project cancelled a newer open | Uncorrelated failure reply | Wire `openFailed { projectId, generation }`, matched like a snapshot | `collaboration.md`, `process.md` #26 |
| 2 | Plan tests passed with filters and priorities deleted (6 of 17 snapping mutants, then 7 of 29) | Excluded candidates outside the tolerance window | Candidates placed where they would win; `PRIORITY` table | `editor-interaction.md`, `process.md` #27 |
| 3 | Type-only test was green in vitest before its sources existed | Vitest erases types | Red step is the typecheck | `process.md` #27 |
| 4 | History: a stray `rejected` dropped an accepted entry; recording during a pending request moved the wrong entry | Filter by ID only; implicit ordering | `rejected` drops only unconfirmed entries; `recordCommit` throws while a request is pending | `undo-history.md` |
| 5 | `constructor` wall "existed" and survived pruning | Unchecked table lookups | `isValidId` in `entityExists`, `draggedJoints` | `domain-geometry.md` Don't |
| 6 | Early toast timer left the toast up for good; `WallPreview` allowed `{ ok: true, doc: null }` | Unguarded timing; independent fields | Re-arm with the time left; union on `ok` | `implementation.md` |
| 7 | Undo committed under the entry's own ID; `drawSnap` compiled without a case for a new kind | §7.5 step 3 missed; `void` switch | Fresh host ID; `assertNever` | `rendering.md`, `editor-interaction.md` |
| 8 | Cursor world point went stale after a scroll (2 m off), so typed lengths followed the old point | `pointer.world` refreshed only by pointer events | `followCamera` replays the last pointer move | spec §5.4, `editor-interaction.md`, `process.md` #28 |
| 9 | Undo mid-chain kept a preview of undone walls; a refused undo then lost the chain | Gesture not reset; reset unconditionally | Only an applied undo drops the gesture and replays the pointer | spec §5.4, `editor-interaction.md` |
| 10 | Scroll during a press made the next small move jump the wall | Screen-point threshold with a moving camera | World-unit threshold | spec §5.7, `process.md` #28 |
| 11 | Releasing Shift before the button committed a position never previewed | Release recomputed at the pointer-up | Release commits the last attempt's moves | spec §5.7 |
| 12 | On a short selected wall, pressing near one end grabbed the other | First handle in range | Nearest handle | `editor-interaction.md` |
| 13 | A press whose target vanished became a silent red drag | No guard for a missing target | Ends the press | `editor-interaction.md` |
| 14 | No preview, but a typed length still placed a wall (cursor 0.5 mm off the origin); double click toasted "Wall too short" | Two different on-origin tests | One `onOrigin` test; clicks on the origin ignored | spec §5.5 |
| 15 | Demo typed digits without Shift; "red then valid" unpinned | Scenario ignored the physical input | Shift on digits and Enter; recovered-drag scenario | `process.md` #18 (applied) |
| 16 | Public index exported `commit`, `onEvent`, `zoomAt`…; a shell could write around `update` | `export *` and a wide plan list | Minimal named exports and a test that write paths are absent | `architecture.md` |
| 17 | Plan tests covered little of each module (routing 6 of 25 mutants; wall tool, select tool, undo and demo each had unpinned rules) | Tests of the plan's code green from the start | Tests added in every wave from mutation checks and reviews | `process.md` #25 |
| 18 | Agent sandbox refused compound heredoc commands; a locked worktree until the agent's notification | Tooling | Write tool; remove after notification | `EXECUTION.md` gotchas |

## 5. Changes to the plan

All rows are in `implementation.md` "Deviations from the plan"; plan code blocks of the affected tasks are the final code.

| # | Task | Planned | Done instead | Why | Later tasks revised |
|---|------|---------|--------------|-----|---------------------|
| 1 | 3.1 | `error { requestId: null }` for an unknown project | `openFailed` wire message | Issue 1 | phases 6, 7 (Tasks 6.1, 6.3, 6.7, 7.2, 7.4, 7.5) |
| 2 | 3.3, 3.4 | `SnapContext.tolerance`; per-policy priority | Chooser takes the tolerance; `PRIORITY` by kind; union pins | Issues 2–3 | README contract |
| 3 | 3.6 | Filter `rejected` by ID; no guard on `recordCommit` | Unconfirmed-only; throw while pending | Issue 4 | Task 7.7 (+1 test), helper renamed `segmentDependencies` |
| 4 | 3.7 | Direct lookups; `WallPreview`/`MoveAttempt` shapes | `isValidId`; unions; `onToastTimer` returns a `Step` | Issues 5–6 | 3.9–3.12, phase 5 literals, README |
| 5 | 3.8, 3.9 | Entry's own ID; vague `invalid` toast; `textBox` in scene | Fresh ID; `invariantsMessage` (domain); `labelBox` | Issue 7 | phase 5 `helperBox`, phase 7 carried tests |
| 6 | 3.10 | Routing inside update.ts; `runHistory` directly | `pointer.ts`, `followCamera`, `undoRedo`, `FakeShell.wheel` | Issues 8–9 | 3.11/3.12 carried tests; phase 7 carried tests |
| 7 | 3.11 | `PREVIEW_OP` in wall-tool.ts | In tools/types.ts; scene's `PREVIEW_WALL` built from it | One source for the ID | none |
| 8 | 3.12 | `pressScreen`; release at the pointer-up; first handle | World threshold; last-preview commit (`MoveAttempt.moves`); nearest handle; vanished target | Issues 10–13 | phase 5 `press`/`move`/`release`/`handleHit`; README `SelectToolState`, `MoveAttempt` |
| 9 | 3.14 | Wide index with `export *` | Minimal named exports | Issue 16 | phase 7 Task 7.9 note; README index line |
| 10 | 3.14 | Demo types without Shift; perf from the vitest duration | `FakeShell.type(text, mods?)`; warm `performance.now()` timing | Issue 15; honest numbers | phase 5 `drawRoom`, phase 8 narrated step 2 |

## 6. Changes to the spec

| § | Change | Why | Commit |
|---|--------|-----|--------|
| §7.2 | `openProject` uses `projectId`; `snapshot` carries `meta`; new `openFailed { projectId, generation, message }`; `error` never ends an open | Issue 1; table abbreviations | `2e89d0b`, `0ffcda9`, `c885d9a` |
| §5.2, §7.0, §7.2.1 | `openFailed` in the ports and the open flow | Issue 1 | `c885d9a` |
| §5.4 | "The cursor follows the camera" paragraph; undo/redo row: one that applies drops the gesture, a refused one only toasts | Issues 8–9 | `a19fb7f`, `81c2c91` |
| §5.5 | Click row clears the typed value; a click on the origin is ignored | Issue 14; the spec's "carry over" contradicted sensible behaviour | `71c0cdf`, `f7e2b60` |
| §5.7 | Threshold "4 px at the current zoom", in world units; the release commits the last attempt's moves | Issues 10–11 | `565d04a`, `71c0cdf` |

## 7. Design-memory updates

- `editor-interaction.md`:
  - decisions: state fields, cursor follows the camera, applied-only undo drops the gesture, world-unit threshold;
  - readings recorded for the tools, keys and pointer;
  - Don'ts: gesture previews across an applied undo, cached `pointer.world`, screen-point thresholds.
- `architecture.md`: minimal editor public API (decision and Don't).
- `collaboration.md`: `openFailed` tied to its open's generation (decision and Don't).
- `undo-history.md`: `rejected` only for unconfirmed entries; `recordCommit` guard; created-entity dependencies.
- `domain-geometry.md`: what counts as a checked ID (Don't clarified); per-move validation cost (risk row).
- `rendering.md`: plan-time readings, including majors at 2.5 m for some zooms.
- `open-documents.md`: wording.
- `implementation.md`: deviation rows for all eight waves.
- `process.md`: lessons #26 (correlate every reply), #27 (filter tests need the candidate inside the window; type-only tests are red in tsc), #28 (a cached value derived from two inputs goes stale when either changes).
- `INDEX.md`: editor summary and "Last updated" refreshed.

## 8. Risks and open issues for the next phase

- **Per-move cost on large drawings.** 19 ms at 480 walls, dominated by domain validation. Fine for the demo. If a drawing of a few hundred walls feels slow in phase 4, validate locally around the moved joints in the domain.
- **Mouse-wheel zoom speed.** `exp(-0.01·deltaY)` is 2.7× per 100 px notch. It's fine on a trackpad pinch; check it with a mouse in phase 4 and tune it if needed.
- **Physical key mapping** is phase 4's job (`KeyboardEvent.code` for digits). The headless demo only proves that the value field takes digits with Shift held.
- **Phase 7 carried tests** (8 items in its "Tests carried over from phase 3" list):
  - `canCommit` guards, which only a shared document can reach;
  - swallowing keys while paused;
  - presence after a wheel;
  - a refused undo on a paused chain;
  - `sharedCommit` returning a new object.
- **Accepted:**
  - a document whose IDs start with `preview/` turns every wall preview red (only a crafted file can do this);
  - value fields ignore modifiers (`Cmd+Backspace` edits the typed value).
- **Small debt:**
  - `localState(host, doc)` ignores its `host` parameter;
  - a few exports are used only in their own file (they are listed extension points);
  - phase 5 copies the value-field regex.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | not started (phase 7) | |
| 2 Room by typed lengths | works | headless editor (`demo.test.ts`) |
| 3 Divider with midpoint snaps | works | headless editor |
| 4 Zones with areas | domain only (phase 2); editor in phase 5 | domain script |
| 5 Helper resize | domain only (phase 2); editor in phase 5 | domain script |
| 6 Invalid drag reverts | works, including a drag that passes through red and ends valid | headless editor |
| 7 Two windows, cursors | not started (phase 7) | |
| 8 Undo and remote invalidation | local undo works; remote invalidation in phase 7 | headless editor |
| 9 Headless scenario and domain script | partial: headless scenario for steps 2, 3, 6; domain script (phase 2) | Node tests |
