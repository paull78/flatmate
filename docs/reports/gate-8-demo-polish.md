# Gate 8: Demo polish (final gate)

**Date:** 2026-09-29 · **Phase file:** `docs/plans/flatmate/phase-8-demo-polish.md` · **Commits:** `2cf40ae`..`54c8b3f` · Lean mode.

## 1. Outcome

The five-minute demo (spec §1.4, steps 1–9) now runs end to end:
- **Steps 1–8** ran in two real Chromium windows against `pnpm demo`: create "Apartment", draw the room with typed lengths, add the divider, label both zones, resize the right wall to 3.5 m, try an invalid drag, then Bob joins with his cursor, moves a wall, and has a redo refused.
- **Step 9** is two terminal commands: `pnpm demo:headless` (the narrated headless scenario) and `pnpm demo:script` (a room built through the domain API only).
- **Supporting pieces:** a fallback project (`pnpm demo:seed`), a one-command launcher (`pnpm demo`), a palette and styling pass, and an honest root README.

The hand-timed rehearsal (run 2) is still for you to do.

## 2. Completion criteria

Met: `demo:script`, `demo:headless`, `demo:seed` (idempotent), `pnpm demo` (starts both servers; Ctrl+C leaves nothing listening), `colors.test.ts` with `pnpm e2e` green before and after the palette, the README with every command it cites run, `pnpm check` + `pnpm e2e`, and memory.

Not met:
- **Screenshots:** Task 8.6 was cut (lean mode).
- **Two timed rehearsals:** run 1 was driven by a script with real mouse and keyboard, and all nine steps passed. Run 2 by hand, timed, is for you.

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: protocol 94, domain 188, editor 364, web 70, server 53, sync-tests 14, scripts 3 = **786 tests** |
| `pnpm e2e` | 2 passed (local smoke; two windows on one project) |
| `pnpm demo:script` | Kitchen 8.64 m², Living 8.64 m² |
| `pnpm demo:headless` | 5 narrated steps (2–6) pass; zone table 10.64 / 9.94 m² |
| `DATA_DIR=<tmp> pnpm demo:seed` twice | the same project ID both times, and one file on disk |
| Scripted rehearsal (run 1) | steps 1–8 pass in two windows (4.1 s scripted); step 9 commands pass |
| Reconnect check (from 7.17) | server killed mid-drag → "Connection lost", status "offline", both windows back to "saved" in 3.1 s, same areas in both |

## 4. Implementation issues

| # | Issue | Fix |
|---|-------|-----|
| 1 | At step 7, Bob's window, opened before Alice created "Apartment", did not list it: the list is fetched, not pushed | Demo instruction: open or reload Bob's window at step 7 (rehearsal pre-flight, `scope.md`) |
| 2 | Four agents edited the root `package.json` scripts in parallel | Merged by hand; one list of `demo*` scripts |
| 3 | Editor tests have no `console` type (no DOM or Node types) | The narrated test declares the one member it uses |
| 4 | Memory inconsistencies found while drafting §12 | A duplicate draft `tooLarge` row was removed, and "macOS fsync does not flush" was reworded to "not verified" |

## 5. Changes to the plan

- 8.6 screenshots cut.
- 8.8 includes the reconnect check; its pre-flight opens Bob's window at step 7.
- 8.1 added `scripts/` to depcruise, with a rule that it imports only the domain and protocol entries.

## 6. Changes to the spec

None. Spec step 7 already says "Open a second window as Bob"; the rehearsal instruction only makes the timing explicit.

## 7. Design-memory updates

- `rendering.md`: hex-only palette with a contrast test.
- `implementation.md`: the `@fm/scripts` rule, seeding through `decideSubmit`, and the `console` gotcha.
- `scope.md`: open Bob's window at step 7.

## 8. Gate questions

1. **Fragile steps and fallbacks** (see the rehearsal table):
   - Step 3: the midpoint snap near other candidates. Fallback: zoom in and redraw.
   - Step 5: the helper text is a small target. Fallback: reselect the wall and click again.
   - Step 7: Bob's window must open after the create, and his cursor only shows once he moves.
   - A server restart cancels any gesture. Recovery took about 3 s.
   - Keyboard focus: after typing in the properties panel, press Enter or click the canvas before typing lengths.
   - The general fallback is the seeded "Sample apartment".
2. **Tests per layer:** domain 188, protocol 94, editor 364 (headless scenarios included), server 53, sync 14, web unit 70, Playwright 2, scripts 3.
   Covered in phase 6 only, or cut:
   - the zones browser test (5.10);
   - the late-joiner and client-side crash-during-save sync scenarios (7.13);
   - the persistent-failure check (6.12);
   - screenshots (8.6).
   Each is covered headless or on the server side, or accepted for the demo.
3. **README claims:** every command it cites was run. Corrected or dropped:
   - the web test "draws a room and reads its area" (only a wall length is read; areas are checked headless);
   - the screenshots reference;
   - "in-memory server" (it is the real server app with in-memory storage);
   - "the editor never touches the clock" (time comes through `Host`);
   - broad durability wording ("saved before acknowledged", no power-loss claim).
   Added limits: Canvas2D only, one edit in flight per client, no compaction, cursors not replayed to late joiners, Chromium only, §11 not implemented.
4. **Shift + digits:** no issue. The input adapter reads digits from the physical key code, so typing with Shift held works in the browser (smoke test, sync tests, scripted rehearsal). Spec §1.4 step 2's wording ("holding Shift … type 6") is correct. Other keyboard layouts are unchecked until your hand rehearsal.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | works | browser + server |
| 2 Room by typed lengths | works | browser (local and shared), headless |
| 3 Divider with midpoint snaps | works | browser, headless |
| 4 Zones with areas | works | browser, headless |
| 5 Helper resize | works | browser, headless |
| 6 Invalid drag reverts | works | browser, headless |
| 7 Two windows, cursors | works | browser (open Bob's window at step 7) |
| 8 Redo refused after a remote change | works | browser, sync tests |
| 9 Portable core | works | `pnpm demo:headless`, `pnpm demo:script` |
| 10 WebGL toggle | follow-up S1 | |


## 10. Sprint summary: issues by theme

**How the issues were counted:** the "Implementation issues" rows of gate reports 1–7 plus the rehearsal notes, 48 in total. By gate: G1 0, G2 17, G3 18, G4 2, G5 3, G6 3, G7 4, rehearsal 1. Each issue is counted under one theme. "Cost most" means the issue forced spec changes, revisions to later plans, or several review rounds.

From phase 4 on, lean mode ran no reviews on glue code (web adapters, panels, launcher, styling). The low counts for rendering/web and for phases 4–8 partly show that less was reviewed, not only that there were fewer defects.

| Theme | Count | Cost most | Memory entry that prevents a repeat |
|-------|-------|-----------|-------------------------------------|
| Geometry (domain) | 11 (G2) | 1. Wall outlines: inner miters were unclamped (self-intersecting, spiking), and a 20 cm notch showed at 3+-wall joints (the demo divider). Two spec §3.5 changes and sweeps of 3,212 configurations; short-wall slivers accepted as a limitation. 2. IDs naming `Object.prototype` members (`constructor`, `__proto__`): the guard spread through the domain, the editor (G3 #5) and the wire parser, and revised the plans for phases 3 and 6. 3. Label-merge rule and its dependencies (counts labels, not rooms; merged-face boundary): three review rounds, spec §3.6 and §4.1. | `domain-geometry.md` Don'ts "inner miter corners unclamped", "outline straight across a joint with 3+ walls"; "index a table only after `isValidId`" + `process.md` #22; "limit a merge's dependencies to the source faces" + `process.md` #23 |
| Interaction (editor) | 11 (G3 10, G5 1) | 1. The cursor's world point went stale after a scroll (typed walls 2 m off), and a scroll during a press made the next move jump (G3 #8, #10). This added `pointer.ts`/`followCamera` and changed spec §5.4 and §5.7. 2. An undo during a gesture kept a preview of undone walls (G3 #9, spec §5.4). 3. The demo typed digits without Shift, while `Shift`+`6` is `^` on a US keyboard (G3 #15; first found while planning). | `editor-interaction.md` Don'ts "cache `pointer.world` across camera changes", "drag threshold between screen points" + `process.md` #28; "keep a gesture's preview across an applied undo"; digits-from-physical-key decision + `process.md` #18 |
| Open documents and sync | 7 (G3 3, G5 1, G7 2, rehearsal 1) | 1. An uncorrelated `error` for a missing project cancelled a newer open (G3 #1). This added a new wire message, `openFailed`, and changed spec §5.2, §7.0, §7.2 and §7.2.1, plus the plans for phases 6–7. 2. A late `created` reply opened the new project over a newer open, closing a drawing with an outstanding edit (G7 #1, spec §7.2.1). 3. A stray history rejection dropped an accepted entry (G3 #4). | `collaboration.md` Don't "uncorrelated error" + `process.md` #26; `collaboration.md` decision "late `created` only lists"; `undo-history.md` Don't "remove a rejected entry only when pending" |
| Server and persistence | 3 (G6) | 1. Extra entity fields were stored unvalidated. A 400 KB nested field overflowed recursive hashing and crashed the server again on every same-ID resend. 2. macOS case-insensitive file names opened one project as two live copies. 3. The parser stringified an untrusted `{"toString": 1}`. | `process.md` #29 (bound the shape, never stringify untrusted values, compare the ID asked for with the one loaded); `domain-geometry.md` serialization row (unknown entity fields rejected) |
| Rendering and web | 1 (G4) | React 19 renders `readOnly=""`; test-only fix. Not measured: frame time was never profiled, mouse-wheel zoom speed was not checked with a real mouse, and tag hit boxes are covered only end to end. | none needed for the issue; `rendering.md` palette/contrast row (phase 8) |
| Tooling | 8 (G2 4, G3 3, G4 1) | 1. A relative import into another package's internals passed tsc, lint and the ring rules (G2 #2). 2. The editor index exported write paths (`commit`, `zoomAt`…) that let a shell bypass `update` (G3 #16). 3. Agent tooling: the auto-mode classifier and sandbox refused commands, and worktrees stayed locked (G2 #17, G3 #18). | `architecture.md` Don'ts "reach into another package by relative path" + `process.md` #21; "export write paths or `export *`"; `EXECUTION.md` "Gotchas met so far" |
| Process | 7 (G2 2, G3 2, G5 1, G7 2) | 1. Tests weaker than their titles: in the plan's tests, many mutants survived (6 of 17 snapping mutants, then 7 of 29), and some "unchanged" titles never checked the document (G2 #16, G3 #2, #17). 2. Parallel tasks needed each other's behaviour in their tests, so assertions were dropped and later restored (G5 #1). 3. Stale plan code (G7 #3). The plan-level item from G1 (a completion criterion with no step producing its evidence) belongs here too. | `process.md` #25, #27; lean-mode rule "the code wins over stale plan code"; `process.md` #20. G5 #1 got no entry (lean mode); `process.md` #19 is the closest. |

## 11. All plan and spec changes

Detailed rows for phases 1–3 are in `implementation.md` "Deviations from the plan" (26 rows). Lean mode stopped that table after phase 3; later changes are only in the gate reports.

| Gate | Kind | Change | Why | Commit |
|------|------|--------|-----|--------|
| 1 | plan | 1.6 gets an unresolvable-import negative check; 1.1 "`pnpm check` first runs in 1.4" corrected to 1.7 | A criterion had no step producing its evidence; the configs only exist after 1.5–1.6 | — |
| 1 | process | Tasks one at a time, committed on "next" | User review style | — |
| 2 | plan | `ID_PATTERN` escape removed (2.3; `isWireId` in 6.1 too) | Lint | — |
| 2 | plan | Depcruise rule `only-through-package-index` (1.6, after G1) | Relative paths bypassed package entries | — |
| 2 | plan | IDs refuse `Object.prototype` names; `\|` key separator; `execute` checks every ID first; `isValidId` guards on lookups (2.3, 2.7–2.9, 2.11, 2.14, 2.15, 2.18, 6.1) | Prototype-name IDs; `:` is a legal ID character | — |
| 2 | plan | Deeply read-only faces, zones and query results (2.10–2.16; phase 3 scene type) | Shared memo was mutated in place | — |
| 2 | plan | Outline clamp and outlines through 3+-wall joints (2.10, not in plan) | Self-intersecting outlines; divider notch ("favour correctness") | `a387168` |
| 2 | plan | Merge depends on the merged face; `cutName`; cleanup only at deleted walls' endpoints; empty names skipped (2.14, 2.15) | Reviews of the merge rule | `5eafa38` |
| 2 | plan | `execute` returns the input for any no-op; read-only `MIGRATIONS`; internal `AREA_UNAVAILABLE` (2.7, 2.17, 2.18) | Rule applied to some commands only | — |
| 2 | plan | Perf test declares its globals; tolerances; warm medians (2.19) | Domain tests have no DOM/Node types | `aaf6e42` (reorder test) |
| 2 | process | Parallel Opus waves from Task 2.7 | User request | — |
| 2 | spec | §3.3 I8: ID alphabet, length, prototype names refused; names ≤ 200 code units, empty allowed | Issues 3, 11; empty names unspecified | `98c4d72`, `3130679` |
| 2 | spec | §3.4: label commands shape-check only | `execute` comment overclaimed | `43324db` |
| 2 | spec | §3.5: outlines through 3+-wall joints; clamped inner corners; sliver limitation | Issues 6–8 | `bf892a3`, `250bdc0` |
| 2 | spec | §3.6: innermost-face resolution; merge counts labels; cut rule; merged-face dependency; empty names | Issues 10–12 | `342eb9d`, `3130679`, `b9845e6` |
| 2 | spec | §4.1: exact Delete dependencies; concurrent corner deletion is `invalid` | Wave 3 spec review | `3130679`, `b9845e6` |
| 2 | spec | §11 item 5: "three-room merges" → "merges of three or more labels" | Matches the label-count rule | `3130679` |
| 3 | plan | `openFailed` wire message (3.1; 6.1, 6.3, 6.7, 7.2, 7.4, 7.5 revised) | Uncorrelated failure reply | — |
| 3 | plan | Snap chooser owns the tolerance; `PRIORITY` table (3.3, 3.4) | Weak filter tests | — |
| 3 | plan | History: `rejected` drops only unconfirmed entries; `recordCommit` throws while a request is pending (3.6; 7.7 +1 test) | Accepted entry dropped | — |
| 3 | plan | `isValidId` in state helpers; `WallPreview`/`MoveAttempt` unions; toast timer re-arms (3.7) | Unguarded lookups, loose shapes | — |
| 3 | plan | Fresh ID per history commit; domain `invariantsMessage`; `labelBox` (3.8, 3.9) | §7.5 step 3 missed | — |
| 3 | plan | `pointer.ts` with `followCamera`; `undoRedo` (3.10) | Stale cursor; undo mid-gesture | — |
| 3 | plan | `PREVIEW_OP` in `tools/types.ts` (3.11) | One source for the ID | — |
| 3 | plan | World-unit drag threshold; release commits the last preview; nearest handle; vanished target ends the press (3.12; phase 5 revised) | Issues 10–13 | — |
| 3 | plan | Minimal named index exports (3.14) | Write paths exported | — |
| 3 | plan | Demo types with Shift; perf timed with `performance.now()` (3.14; phase 5, 8 revised) | Physical input; honest numbers | — |
| 3 | spec | §7.2: `openProject` uses `projectId`; `snapshot` carries `meta`; `openFailed`; `error` never ends an open | Issue 1 | `2e89d0b`, `0ffcda9`, `c885d9a` |
| 3 | spec | §5.2, §7.0, §7.2.1: `openFailed` in ports and open flow | Issue 1 | `c885d9a` |
| 3 | spec | §5.4: the cursor follows the camera; an applied undo drops the gesture, a refused one only toasts | Issues 8–9 | `a19fb7f`, `81c2c91` |
| 3 | spec | §5.5: a click clears the typed value; a click on the origin is ignored | Issue 14 | `71c0cdf`, `f7e2b60` |
| 3 | spec | §5.7: 4 px threshold in world units at the current zoom; release commits the last attempt | Issues 10–11 | `565d04a`, `71c0cdf` |
| 4 | plan | Lean mode: no reviews for glue; cut 5.10, 6.12, 8.6; trimmed 6.11, 7.13 and the phase 7 carried tests; 7.17 moved into 8.8 | User: relax tests and steps for a demo | `ed6879f` |
| 5 | plan | 5.10 cut (its `e2e/support/canvas.ts` moves to 7.16); 5.9 keeps phase 3's "step 6 recovered" test (7 demo tests) | Lean mode | — |
| 6 | plan | 6.11 trimmed to two in-memory restart cases; 6.12 cut; one extra test (`isWireId` rejects `constructor`, `__proto__`) | Lean mode | — |
| 7 | plan | 7.13 trimmed to the blocking and reconnect scenarios; 7.16 creates `canvas.ts`; 7.4 exports the wire mapping early | Lean mode; 5.10 cut; wave ordering | — |
| 7 | spec | §7.2.1: creating a project opens it only if nothing else was opened or is opening when the server confirms | Late `created` review finding | `3aefbc7` (code `6db92d1`) |
| 8 | plan | 8.6 screenshots cut; 8.8 includes the reconnect check; pre-flight: open or reload Bob's window at step 7 | Lean mode; rehearsal run 1 | `78cb707` |

Specs for gates 1, 4, 5, 6 and 8: no changes. Gate 6 relied on §3.7, which already says unknown fields are not preserved. The step-7 fix for gate 8 fits the existing §1.4 wording.

## 12. State of design memory

Counted by diffing `docs/design-memory/` from the plan commit `22f3cfe` to `78cb707`. The counts cover rows added or rewritten during the sprint; "modified" rows were reworded in place.

| Area file | Decisions added | Don'ts added | Highlights |
|-----------|-----------------|--------------|------------|
| `architecture.md` | 3 | 2 | Minimal editor public API; packages meet only through entry points; one wire mapping for every shell |
| `domain-geometry.md` | 10 (+2 modified) | 10 (+1 modified) | Read-only queries; no-op identity in `execute`; innermost-face labels; label-count merge and its dependencies; outline clamp; sliver limitation; prototype-name IDs; per-move validation cost (risk row) |
| `editor-interaction.md` | 8 (1 replaces a planning draft) | 3 | Cursor follows the camera; applied undo drops the gesture; world-unit threshold; gesture dependencies; blocked/reject toasts |
| `collaboration.md` | 7 (1 replaces a planning draft; +1 modified) | 1 | `openFailed`; server session rules; crash-only for any queued task; SharedDocument reducer; local `tooLarge`; late `created` |
| `undo-history.md` | 3 | 1 | Entry dependencies include created entities; rejection drops only unconfirmed entries; `recordCommit` guard |
| `open-documents.md` | 2 (+1 modified) | 0 | Session rules; a shared document is dirty while an edit is outstanding |
| `rendering.md` | 2 | 0 | Plan-time drawing rules confirmed; hex-only palette with a contrast test |
| `scope.md` | 1 | 0 | Bob's window is opened at step 7 (the list is fetched, not pushed) |
| `implementation.md` | 1 decision, 26 deviation rows (phases 1–3), 17 tooling notes | 0 | Parallel waves; JSON repository, WebSocket limits, durability wording; `@fm/scripts` ring rule; seed through `decideSubmit` |
| `process.md` | lessons #20–#29 (10) | n/a | Preferences added: parallel Opus waves, "favour correctness", lean mode |

**Open issues in `process.md`:** none. One open option remains, not adopted: acknowledge the sender with `changes` only, keeping bare `ack` for duplicate resends. Accepted limitations and risks are recorded where they apply:
- per-move validation cost on large drawings (`domain-geometry.md`);
- short-wall slivers (`domain-geometry.md`);
- untyped commands throw in `execute` (gate 2);
- an `openFailed` answering a resync generation leaves the drawing "syncing" (gate 7).

**Contradictions between memory and spec.** No direct conflict on a design rule was found. These rules were checked and agree:
- `openFailed` tied to its generation, and the late-`created` rule (§7.2.1);
- the cursor follows the camera (§5.4);
- the 4 px world-unit drag threshold (§5.7);
- the 10 px snap tolerance (§5.8);
- the local `tooLarge` guard (§7.4);
- unknown fields not preserved (§3.7);
- 0.01 m minimum edge and 0.20 m thickness (§3.3, §1.3);
- about 10–15 draw calls, and text always on Canvas2D (§6);
- durability wording: "the repository defines completion", with no power-loss claim (§7.2).

Found, reported honestly:
1. **Crux claim.** Spec §1.1 states who created Crux. `scope.md` marks this as unverified, since it came from model background knowledge. The rule "spec wins" would push the memory to overclaim, so I recommend softening the spec sentence instead. It needs the user's call.
2. **Wall edges under WebGL (spec §6.2 and the `rendering.md` Don't, versus the code).** Both say polygon edges are "covered by SDF-drawn wall outlines". The scene draws walls as filled polygons only; no outline segments exist (`scene.ts` `drawWalls`). With S1 as written, wall edges would get MSAA only. This is not a memory/spec conflict, but both assume something the code does not do (see section 14).
3. **Small inconsistencies:**
   - (fixed at this gate) a duplicate "Draft (planning)" `tooLarge` row in `collaboration.md` was removed.
   - (fixed at this gate) `implementation.md` said "macOS `fsync` does not flush the drive cache" as a fact; now "not verified".
   - Spec §7.2 names crash-only for queued *project* tasks; memory also covers the workspace queue, which the spec does not mention.
   - `scope.md`'s "the list is fetched, not pushed" is not stated in spec §1.4 or §7.2.1. It is compatible with them, but it is a gap.
   - The spec header still reads "plan-time clarifications 2026-09-27", though clarifications landed through 2026-09-29.

## 13. Follow-ups (spec §11)

Recommendation only; the spec is not edited here.

| § 11 now | Recommended | Reason from the sprint |
|----------|-------------|------------------------|
| 1 WebGL2 SDF renderer | **1, unchanged** | The Renderer port and Scene held up without change through phases 4–8, and the palette is hex-only, so it is easy to parse into GPU colours. It is the demo's step 10 and the clearest proof of the portable-core story. |
| 3 More CAD snaps | **move to 2** | Snapping was the cleanest editor area: pure policies, one chooser and a `PRIORITY` table, hardened by mutation tests. Angle snaps would remove the demo's "hold Shift" workaround (lesson 18). This is editor-only work, with no domain or sync risk. |
| 2 Interior wall crossings | **move to 3** | Geometry produced the most defects (11, and every phase-2 review found real ones). Crossings change `addWall` normalization, deterministic IDs, dependencies and possibly label merges, which is the area that cost most. Do it after the cheaper, visible win. |
| 4 Richer selection | 4, unchanged | Multi-selection widens gesture dependencies and remote cancellation, both subtle in phase 7. |
| 5 Complex zones and merges | 5, unchanged | Phase 2 showed how subtle even the two-label merge was. |
| 6 Loop mode, 7 X1, 8 X2, 9 X3 | unchanged | Nothing in the sprint argues for a change. X3 stays last: one outstanding edit kept sync bounded. |

Worth adding to §11, both small and neither needed for the demo:
- **Domain-local validation for moves.** A move costs about 19 ms per pointer move at 480 walls (gate 3), because every preview validates the whole document. Add it before any demo on larger drawings, and before crossings, which add validation work.
- **Presence replay on join and a pushed project list.** Both caused friction at demo step 7: cursors show only after the other person moves, and Bob must reload. Add them only if the hand rehearsal (run 2) shows the friction matters; the demo instruction already covers it.

Also note: if scripts or an agent ever send JSON commands (the portable-core pitch), `execute` should get a shape check first, because untyped input throws (gate 2).

## 14. Recommendation for S1 (WebGL2 SDF renderer)

**What the port and Scene already give:**
- **Port:** `Renderer { render(scene, camera); dispose() }` (`packages/web/src/adapters/renderer.ts`). The editor's `render` effect carries the camera, so a renderer never reads editor state.
- **Scene** (`packages/editor/src/view/scene-types.ts`):
  - always six layers in a fixed order (grid, zoneFills, walls, annotations, overlays, presence);
  - five primitive kinds (segment, polygon, arc, disc, text);
  - widths as `{ px }` or `{ m }`, which maps directly to a shader uniform for zoom;
  - fixed units (`rendering.md`): dashes in px, arc radius in m, angles CCW with world y up;
  - hex colours (`#rrggbb` / `#rrggbbaa`).
- **Reference implementation:** `canvas2d-renderer.ts` is 150 lines. `drawPrimitive` is an exhaustive switch with `assertNever`, and `drawScene`, `widthPx` and `backingSize` are exported. It is tested against a recording `DrawContext` fake. The text overlay can reuse `drawPrimitive` for `text` primitives only, so alignment follows from the shared `worldToScreen` and `backingSize`.
- **Hit-testing does not depend on the renderer.** The editor hit-tests document geometry and text boxes from `host.textMetrics` (OffscreenCanvas, same `fontString`), never pixels. Swapping renderers cannot change what a click hits.
- **Frame coalescing:** at most one draw per animation frame (latest scene wins); the WebGL renderer can copy this.

**Risks seen:**
1. **Wall edges.** Walls are filled outline polygons with no stroke (section 12, item 2). Under WebGL they would get MSAA only, against the analytic-AA pitch. Either add thin outline segments to the `walls` layer (this also changes the Canvas2D look), or state plainly that walls use MSAA. Earcut needs simple polygons: outlines were simple in all swept configurations, but short walls leave slivers.
2. **Text overlay order.** Canvas2D draws text in scene order: a tag plate and then its text in `annotations`, below `overlays` and `presence`. With a separate overlay canvas, all text sits above all geometry, so tag or helper text would cover handles, snap glyphs and remote cursors. Either accept that or split the overlay per layer. The two canvases must also agree on size and DPR, and a canvas cannot hold both a 2D and a WebGL2 context, so the renderers need two stacked canvases.
3. **The scene is rebuilt on every event.** `buildScene` runs after every `update`, and the grid, label boxes and px paddings depend on the camera. So §6.2's "pan/zoom is a matrix uniform; buffers rebuilt only when the Scene changes" in practice means rebuilding on every pointer move and every wheel event. At demo size, the core (update, scene and ViewModel) measured 0.41–0.61 ms per move (gate 3). GPU upload and draw time were never measured. Measure before claiming anything.
4. **Live toggle wiring.** The renderer is created once in `mountCanvas` and passed to `createEffectRunner`. A toggle needs a renderer swap in the runner, plus a redraw of the last scene: the editor only emits `render` on events. It also needs a fallback to Canvas2D when WebGL2 is missing or the context is lost (`rendering.md`: the demo must not depend on WebGL).
5. **Matching details:** negated angles for arcs, dash phase from `a`, round versus butt caps, and blending of `#rrggbbaa` colours.
6. **No visual references.** Task 8.6 (screenshots) was cut, so no images of the Canvas2D output are committed to compare against.

**Suggested phases for a separate S1 plan:**

| Phase | Content | Evidence |
|-------|---------|----------|
| S1.0 References and seam | Restore 8.6 as `pnpm screenshots`: Canvas2D at a fixed DPR, five demo states, committed. Add `setRenderer` to the effect runner, keep the last scene, and add `?renderer=` / a toggle with Canvas2D only. Decide the wall-edge question (risk 1). | Screenshots in git; e2e green; no visual change |
| S1.1 Pure instance builder | Scene → typed arrays per (kind × layer): colour parsing, px/m widths, dashes, earcut on outlines and zone floors; text passed through as a list. No GL. | Vitest: counts per layer, draw calls = non-empty (kind × layer), earcut on the demo drawing |
| S1.2 GL backend and text overlay | WebGL2 context, SDF segment/arc/disc shaders, flat polygons, camera and DPR uniforms, one draw per frame; overlay canvas draws text via `drawPrimitive`. | Side-by-side check against the S1.0 references by eye; one Playwright pixel probe (for example, a wall centre is wall-coloured) |
| S1.3 Live toggle and fallback | Two stacked canvases, a toolbar/key toggle, fallback on missing context or context loss; add demo step 10 to the rehearsal. | e2e: toggle there and back mid-drawing; rehearsal row; frame time measured in DevTools and reported only as measured |

S1 does not start in this sprint.
