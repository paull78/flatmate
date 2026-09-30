# C1: More CAD snaps (angle steps and perpendicular) — plan

**Spec:** §5.8 "Angle and perpendicular" (the design), §11 item 3. **Design memory:** `editor-interaction.md` (the angle/perpendicular row; Don't list), `process.md` lessons 27 (put excluded candidates inside the window) and 30–31 (tolerance vs spacing, zoom). **How it runs:** lean mode (`../flatmate/EXECUTION.md`): one implementer, one review (editor core), no gate report beyond a short summary to the user. The code wins over this text.

## Task C1.1: angle and perpendicular policies, tie rule, glyphs (editor) — size M

**Files:** `packages/editor/src/snapping/{policies,snap,chooser}.ts`, `packages/editor/src/types.ts` (`SnapKind`), `packages/editor/src/tools/wall-tool.ts` (turns the new snaps on), `packages/editor/src/view/scene.ts` (`drawSnap`), and their tests (`test/snapping*.test.ts`, `test/view.test.ts`, `test/ports.test.ts` pins the `SnapKind` union, wall-tool tests).

- [x] **Step 1: Tests first** (each seen red), at the default zoom (80 px/m, tolerance 10 px = 0.125 m) unless stated:
  1. Angle: origin (0, 0), cursor (2, 0.6) (atan ≈ 16.7°, offset from the 15° ray ≈ 0.06 m) → kind `angle`, point on the 15° ray at a whole number of grid steps; cursor (2, 1.2) (≈ 31°, 0.05 m off 30°) → 30° ray.
  2. Angle off: the same cursor with `Shift` → today's orthogonal result; with `Ctrl` → raw cursor; from the select tool's joint drag (origin passed, snaps not turned on) → no `angle` or `perpendicular` kind ever.
  3. Priorities: an endpoint and a midpoint within the tolerance beat angle; angle beats aligned and grid; a far cursor (offset > tolerance from every ray) falls back to aligned/grid as today.
  4. Tie rule: origin (0, 0), a joint at (3, 5), cursor near the 45° ray and near x = 3 → point (3, 3), guides from the origin and from the joint; a joint whose line is parallel to the ray gives no crossing.
  5. Perpendicular: wall (0, 4)–(6, 4), origin (2, 0), cursor (2.05, 3.95) → kind `perpendicular` at (2, 4); a foot outside the wall's extent gives nothing; an origin lying on the wall gives nothing; perpendicular beats on-wall at the same place.
  6. Zoom: repeat case 1 at a zoom where the grid step is 0.5 m; the point stays on the ray (lesson 31).
  7. Glyphs (view test): `angle` draws a guide from the origin to the point plus the dot; `perpendicular` draws a right-angle mark (two segments) at the foot; `drawSnap` stays exhaustive.
  8. The demo: the headless narrated demo (`test/scenarios/demo-narrated.test.ts`, holds Shift) stays green unchanged.
- [x] **Step 2: Implement.** `snapPoint` gains an explicit flag from the wall tool (e.g. `angles: true`); `SnapContext` carries the origin for the new policies only when the flag is on and neither `Shift` nor `Ctrl` is held. Priorities per spec §5.8 (perpendicular 3, on-wall 4, angle 5, aligned 6, grid 7) in the `PRIORITY` table; `SnapCandidate.priority` widens to `1 … 7`. Angle rays: `k = round(atan2 / 15°)`, direction `(cos, sin)` cleaned to exact 0/±1 on axes; point at `roundTo(dot(cursor − origin, dir), grid)` along the ray; distance = |cross(cursor − origin, dir)|; skip when the rounded length is 0. The perpendicular glyph orients itself from `guides[0]` (the origin).
- [x] **Step 3:** `pnpm check`; commit `editor: 15° angle and perpendicular snaps in the wall tool, with glyphs (C1)`.

## Review (lean: one, core)

Check against §5.8: the new snaps never appear outside the wall tool or with Shift/Ctrl; priorities and the tie rule; no zoom-dependent surprise (the point stays on the ray at every grid step); typed lengths follow the snapped direction; the demo (Shift held) unchanged. Report only demo-breaking or wrong-geometry defects and rule breaks.

## Progress

- [x] C1.1 merged (`d38e75c`)
- [x] Review done: approved, no defects (one overclaiming comment corrected)
- [ ] `pnpm e2e` green (8 passed); user tried it by hand

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-30 | plan | scope | User chose 15° steps and wall tool only | design in spec §5.8 first, then this plan | `editor-interaction.md` |
| 2026-09-30 | C1.1 | merge | Implemented test-first (19 editor tests; 924 total); `ports.test.ts` had no `SnapKind` pin, one added; review fuzzed 200k cases (no NaN, points on 15° rays within 1e-9) and approved | comment on the perpendicular foot no longer claims exactness | — |
