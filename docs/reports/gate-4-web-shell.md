# Gate 4: Web shell (Canvas2D, no server)

**Date:** 2026-09-29 · **Phase file:** `docs/plans/flatmate/phase-4-web-shell.md` · **Commits:** `47176eb`..`f6304b5` · First phase run in lean mode (`EXECUTION.md`).

## 1. Outcome

The headless editor now runs in the browser on one unsaved local document. Demo steps 2 (typed room with `Shift` held), 3 (divider snapping to both midpoints, T-junctions) and 6 (invalid drag drawn red, refused with "Walls can't cross") work in Chromium with real mouse and keyboard input. Undo and redo work from the keyboard and the toolbar.

## 2. Completion criteria

All ticked in the phase file. Checks by hand were run by the controller with a Playwright script (real pointer and key events, 1400×900 at DPR 2), not by a person. Still for the user's hands (section 8): trackpad pinch, middle-drag pan, `Cmd+S`, and the typed digits on the user's keyboard layout.

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: protocol 22, domain 187, editor 223, web 59 (9 files) = 491 tests |
| `pnpm e2e` | pass: 1 test (room typed with `Shift`, bottom wall reads `6.00`) |
| Manual script | steps 2, 3, 6; undo removes the divider, redo restores it; toast gone after 3 s; `Space` does not scroll; `Backspace` does not navigate; `Ctrl`+wheel zooms at the cursor; wheel pans; backing store 2280×1618 for a 1140×809 CSS canvas; leave warning after drawing, none on a fresh page |
| `grep '@fm/editor' packages/web/src` | only Contract extensions item 4 names |

## 4. Implementation issues

| # | Issue | Fix |
|---|-------|-----|
| 1 | React 19 renders `readOnly=""`; the plan's panel test expected `readonly=""` | Case-insensitive assertions (test only) |
| 2 | `playwright install` removed an older headless Chromium from the shared user cache | None; other Playwright installs may re-download it |

The plan's code matched the phase 3 editor everywhere; no adaptations were needed.

## 5. Changes to the plan

Lean mode (commit `ed6879f`): no reviews for this all-glue phase; Tasks 5.10, 6.12 and 8.6 cut; 6.11, 7.13 and the phase 7 carried tests trimmed; 7.17 moved into 8.8.

## 6. Changes to the spec

None.

## 7. Design-memory updates

- `process.md`: lean mode from phase 4 (supersedes "keep both reviews").

## 8. Gate questions and risks

1. **Input feel:** `Shift` constrains, typed digits work with `Shift` held (digit codes normalized), `Enter` confirms. Needs your hands: trackpad pinch and two-finger scroll, `Ctrl` bypass on a real mouse, digits on your layout.
2. **Frame time:** not profiled in DevTools. Headless `update` costs ~0.5 ms per move on the demo drawing, and the renderer draws at most once per animation frame; dragging looked smooth in the scripted run.
3. **Shell leaks:** none. The shell uses only the ViewModel, the Scene and `worldToScreen`.
4. **Contract extensions:** all six confirmed as written; no spec change needed.
5. **Text for phase 5:** labels use `UI_FONT` through `fontString`, shared by `host.textMetrics` and the renderer, so measured and drawn widths match. Tags need multi-line text and plates, which phase 5 adds as primitives.
6. **Risks for phase 5:** tag hit-testing relies on OffscreenCanvas metrics (not unit-tested; e2e only); the properties rename flow (blur/Enter/Escape) has no browser test now that 5.10 is cut. An invalid drag shows the joint at its last valid position in red rather than under the cursor (by design, `tools/types.ts`); say so during the demo.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | not started (phase 7) | |
| 2 Room by typed lengths | works | browser, headless |
| 3 Divider with midpoint snaps | works | browser, headless |
| 4 Zones with areas | not started (phase 5) | |
| 5 Helper resize | not started (phase 5) | |
| 6 Invalid drag reverts | works | browser, headless |
| 7 Two windows, cursors | not started (phase 7) | |
