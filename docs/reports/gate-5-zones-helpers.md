# Gate 5: Zones and helper dimensions

**Date:** 2026-09-29 · **Phase file:** `docs/plans/flatmate/phase-5-zones-helpers.md` · **Commits:** `335ad12`..`94895aa` · Lean mode.

## 1. Outcome

Demo steps 2–6 now run end to end, headless (`scenarios/demo.test.ts`) and in Chromium. `Z` plus two clicks labels "Room 1" and "Room 2" at 10.64 m² each. Selecting the right wall shows its helper; clicking the helper, typing `3.5` and pressing Enter moves the top joint to exactly (6, 3.5), and the areas become 10.64 and 9.94 m². Step 6 then starts from (6, 3.5), is drawn red and is refused. Renaming a zone in the properties panel is one undoable edit.

## 2. Completion criteria

All ticked. The browser criterion was met differently: Task 5.10 (Playwright steps 2–5) was cut, so the controller ran steps 2–6 and a rename round trip once in Chromium with a Playwright script.

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: protocol 22, domain 187, editor 272 (24 files), web 59 |
| `pnpm e2e` | pass (phase 4 smoke) |
| Browser script (1400×900, DPR 2) | step 4 "Room 2" 10.64 m², no duplicate on a second click; step 5 length 3.50, right area 9.94 m²; rename to "Kitchen" then `Cmd+Z` back to "Room 2"; step 6 "Walls can't cross"; steps 2–6 took 2 s scripted |
| `wc -l` editor src | largest `select-tool.ts` 176, `scene.ts` 169: no split needed |
| `perf.test.ts` | 220 moves in 39 ms (under 0.2 ms per move); gate 3 measured 0.4–0.6 ms, so drawing zones and tags added no visible cost |

## 4. Implementation issues

| # | Issue | Fix |
|---|-------|-----|
| 1 | Parallel tasks needed each other's behaviour in their tests (floor-click selection, zone properties, `Z` hover) | Agents used direct state or dropped one assertion; the controller restored the plan's gestures after the merges |
| 2 | The plan's `drawSelection` and `tagLayout` looked up outside IDs without `isValidId` | Guards kept (existing `draggedJoints` path; `isValidId` in `tagLayout`) |
| 3 | A wall removed during helper editing (phase 7 remote delete) | The edit ends silently on the next key, with no toast and no commit |

Both reviews (waves 1–2, wave 3) found no defect at the demo bar. Below the bar, not fixed: in one Zone-tool test the tag click is also inside the floor, and a second click on the helper while editing clears the typed value.

## 5. Changes to the plan

- Task 5.10 cut (lean mode). Its `e2e/support/canvas.ts` now gets created in phase 7 Task 7.16 Step 2 (revised).
- Task 5.9 keeps phase 3's "step 6 recovered" test, so there are 7 demo tests instead of 6.

## 6. Changes to the spec

None.

## 7. Design-memory updates

- `editor-interaction.md`: the phase 5 readings are confirmed (label at the raw click point, "Room N" by label count, `Z` outside click keeps the selection, a click on an unlabelled floor clears it), plus how helper editing reacts to tool keys, `Esc`, `Cmd+Z` and a vanished wall.

## 8. Gate questions and risks

1. **Tag hit accuracy:** in Chromium, "Room 1" is 41.2 px wide and "10.64 m²" is 49.0 px (FakeHost: 43.2 and 57.6). The browser measures and draws through the same `fontString`, so the hit box matches the drawn text.
2. **Helper placement:** at 80 px/m the helper sits inside the room, clear of the tag. At about 15 px/m the helper and both tags overlap. At 400 px/m it is fine. For a room drawn clockwise the helper sits outside the room, which is accepted.
3. **Zone rules:** all confirmed as planned (section 7).
4. **Demo timing:** 2 s scripted; not yet timed by hand. The fiddly step is likely clicking the small helper text: try it once by hand before phase 8.
5. **Scene cost:** no regression (section 3).
6. **Risks for phases 6–7:**
   - Two clients can label the same room at once: each is refused locally, but both may be accepted (spec §3.6).
   - Renames can race.
   - `editingHelper` must be cancelled like a gesture when a remote change touches its wall (the vanished case is already safe).
   - Mouse-wheel zoom speed is still unchecked with a real mouse.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | not started (phase 7) | |
| 2 Room by typed lengths | works | browser, headless |
| 3 Divider with midpoint snaps | works | browser, headless |
| 4 Zones with areas | works | browser (script), headless |
| 5 Helper resize | works | browser (script), headless |
| 6 Invalid drag reverts | works | browser, headless |
| 7 Two windows, cursors | not started (phase 7) | |
