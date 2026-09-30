# UX fixes after the follow-ups — plan

Small user-reported fixes, each designed in the spec first. Lean mode (`../flatmate/EXECUTION.md`): one implementer per task, one review for editor-core changes. The code wins over this text.

## Task U1: drag to draw one wall (editor) — size S

**Spec:** §5.5 (rows with `dragFrom`, paragraph "Drag to draw one wall"). **Memory:** `editor-interaction.md` (the wall-tool drag row; Don't list). **Files:** `packages/editor/src/tools/types.ts` (`drawing` gains `dragFrom: Point | null`), `packages/editor/src/tools/wall-tool.ts`, `packages/editor/test/wall-tool.test.ts` (and any test that builds a `drawing` state literally).

- [x] **Step 1: Tests first** (FakeShell, local and shared documents), each seen red:
  1. Press at a joint (0, 0), move to (3, 0) with the button held, release → one wall (0,0)–(3,0), tool `idle`, no preview in the scene.
  2. Same on a shared document → one `submit` effect, tool `idle` (not `paused`), and the wall settles on `accepted`.
  3. Press and release within 4 px, then move and click at (3, 0) → the chain as today (wall placed, still `drawing` from (3, 0)).
  4. Drag whose release would be refused (e.g. crossing a wall) → toast, `idle`, no submit.
  5. Mid-chain: after a click placed a wall, a press-drag-release does NOT end the chain via `dragFrom` (it behaves as today).
  6. The drag threshold follows the camera: a wheel zoom during the drag doesn't turn a 3 px move into a drag (measure world distance × current zoom, lesson 28).
- [x] **Step 2: Implement** per §5.5; reuse `DRAG_THRESHOLD_PX` from `tools/hit-test.ts`; the release point is snapped exactly like a click (same `snapCursor`).
- [x] **Step 3:** `pnpm check`; headless narrated demo and e2e helpers (clicks) unchanged; commit `editor: drag from the first point draws one wall (U1)`.

## Progress

- [x] U1 merged (`f54864f`)
- [x] U1 reviewed: one fix (jitter snapping back onto the first point)
- [ ] user tried it

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-30 | U1 | user report | After a drag from a joint the wall stayed "suspended" until the next click (release ignored) | designed in spec §5.5 first; user chose "one drag = one wall" | `editor-interaction.md` |
| 2026-09-30 | U1 | review | A 5 px jitter on the first click counted as a drag, snapped back onto the origin and showed "Wall too short", ending the chain | a release that snaps onto the first point is a click (test added); spec §5.5 row updated | `editor-interaction.md` |
| 2026-09-30 | U1 | deviation | `dragFrom` stores the raw press point, not the snapped one; a remote rerun keeps it | spec §5.5 aligned | — |
