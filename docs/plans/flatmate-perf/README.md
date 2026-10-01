# P1: Measuring speed (grid seed and `?perf` readout) — plan

**Spec:** §6.3. **Memory:** `rendering.md` (speed row, Don't list), `domain-geometry.md` (rooms scaling). **How it runs:** lean mode (`../flatmate/EXECUTION.md`): no editor-core change, so no review; a short summary to the user. The code wins over this text.

## Task P1.1: grid seed (server scripts) — size S

**Files:** `packages/server/scripts/seed-grid.ts`, `packages/server/scripts/run-seed-grid.ts`, `packages/server/test/seed-grid.test.ts`, root `package.json` (`demo:seed-grid`).

- [x] **Step 1: Tests first** (seen red): `gridDocument(3)` has 24 walls, 16 joints, 9 labels; the domain finds 9 rooms of 7.84 m² (3 m minus a 0.20 m wall); `seedGrid(repo, 3)` stores "Grid 3×3" through `decideSubmit` (seq 1, the validator accepts it) and a second call returns the same project.
- [x] **Step 2: Implement** per §6.3: joints `g-x-y`, walls `gh-…`/`gv-…`, labels `gl-i-j`; one changeset with every put.
- [x] **Step 3:** `pnpm check`.

## Task P1.2: `?perf` readout (web shell) — size S

**Files:** `packages/web/src/perf.ts` (meter and `perfFrom`), `packages/web/src/panels/PerfPanel.tsx`, `packages/web/src/store.ts` (times `update`), both renderers (optional `onFrame`), `packages/web/src/main.tsx`, `packages/web/src/app.tsx`, tests in `packages/web/test/`.

- [x] **Step 1: Tests first** (seen red): `perfFrom` reads `?perf`; the meter keeps the last 120 samples per kind and reports average and worst; the store reports one `update` time per event when given a meter; the panel shows update, draw, the renderer name and the primitive count.
- [x] **Step 2: Implement** per §6.3; `gl.finish()` only when `onFrame` is set.
- [x] **Step 3:** `pnpm check`; `pnpm e2e` unchanged.

## Task P2: faster room tags (domain query + editor cache) — size S, editor core

**Spec:** §3.6 (rooms cached, `zoneOfLabel`), §5.9 ("Tag layouts are cached"). **Why:** a CPU profile of one pan step at 50×50 (Node, 49 ms): tag layout 66% of `update`, computed twice per event (hover via `tagAt`, drawing via `drawZones`) and never reused; `zoneOfLabel` searches every room per tag (27%). **Files:** `packages/domain/src/queries/zones.ts` (+ index export, test), `packages/editor/src/view/tags.ts`, `packages/editor/test/tags*.test.ts`.

- [x] **Step 1: Tests first** (seen red): the domain's `zoneOfLabel` gives the zone whose `labelIds` holds the label (the same object as in `zones(doc)`), null for an orphan and for an unknown ID; `tagLayout` returns the identical object for the same document, zoom and Host (also after a pan), and a new one after a zoom or on a new document.
- [x] **Step 1b** (after the first measurement): `wallOutlines` returns the same result for the same document (it took 37% of a pan step once tags were cached).
- [x] **Step 2: Implement:** the room analysis also builds label → zone; `tagLayout` caches per Host → document → (zoom, layouts), keeping one zoom per document.
- [x] **Step 3:** `pnpm check`; `?perf` on the 50×50 grid before and after (pan and zoom, both renderers), numbers in `rendering.md`.
- [x] **Review** (editor core, done: no defects; keys complete, no shared result is mutated, `zoneOfLabel` matches the old search): cache keys complete (nothing else feeds a layout), no stale layout after an edit, remote change, rename or zoom.

## Task P3: WebGL reuses unchanged layers (editor + web) — size M, editor core

**Spec:** §5.9 ("Unchanged layers keep their array", the `tags` layer), §6.2 (a GPU buffer per batch). **Why:** after P2 a pan step at 50×50 spends 16 ms in the WebGL draw: the editor makes new arrays for every layer on every event, and the renderer re-uploads every batch on every frame (one shared buffer per kind). **Files:** `packages/editor/src/view/{scene,zones-layer,scene-types}.ts` (+ a small memo helper), `packages/web/src/adapters/webgl-renderer.ts`, `packages/web/src/adapters/webgl/instances.ts` (per-layer build), tests in both packages, `packages/web/test/fixtures.ts`.

- [x] **Step 1: Tests first** (seen red): the layer order is grid, zoneFills, walls, tags, annotations, overlays, presence; tag plates and text are in `tags`; after a pan, `walls`, `zoneFills` and `tags` are the same arrays and `grid` is not; a selection change, a hover change, an invalid drag, a zoom (tags only), the Zone tool and an edit each give new arrays for the layers that read them; `buildLayer` gives the same batches as today's `buildFrame` for one layer; the demo frames' draw-call counts.
- [x] **Step 2: Implement:** layer builders take only their inputs as arguments and are memoized on the last arguments (===); WebGL keeps per-layer batches with their own buffer and VAO, rebuilt when the layer's array changes, deleted on dispose.
- [x] **Step 3:** `pnpm check`, `pnpm e2e` (renderers spec: pixel probes, context loss), `?perf` before/after on the 50×50 grid.
- [x] **Review** (editor core + WebGL, done: no defects; keys complete, no shared layer mutated, buffers freed on rebuild and dispose, paint order unchanged): memo keys complete (each builder reads only its arguments), no stale layer after edits, remote changes, undo, tool switches; GPU buffers freed on layer change and dispose, context loss still falls back.

## Progress

- [x] P1.1 done (seeding takes 0.2 s for 30×30, 1.1 s for 50×50: 5 100 walls, 800 KB)
- [x] P1.2 done (946 tests; e2e 8 passed)
- [x] P2 done and reviewed (no defects)
- [x] P3 done and reviewed (no defects); published to `main` `b6390c5`
- [x] First numbers recorded in `rendering.md` (Canvas2D vs WebGL on the grid, pan/zoom and one edit)

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-30 | plan | finding | Building an N×N grid with `execute` wall by wall: N = 20 took 18 s, N = 30 took 3 min; one `zones()` took 2 ms at 100 rooms, 30 ms at 400, 147 ms at 900 (grows faster than the room count) | seed writes the document directly and validates once; rooms scaling recorded | `domain-geometry.md` |
| 2026-09-30 | P1.1 | measure | `zones()` on the seed grid: 9 ms (100 rooms), 27 ms (400), 119 ms (900), 865 ms (2 500) | recorded; editing a 2 500-room drawing will take about a second per change or preview | `domain-geometry.md` |
| 2026-09-30 | P1.2 | measure | `?perf` on the grids (headless Chromium, M4 Pro GPU): 50×50 update 40 ms vs draw 9 ms (Canvas2D) / 15 ms (WebGL); WebGL slower than Canvas2D | numbers and causes recorded (tags 17 of 26 ms of `buildScene`; WebGL rebuilds instances per Scene) | `rendering.md` |
| 2026-09-30 | P2 | measure | Node, one update at 50×50: pan 49 → 12 ms with tags cached, → 3.3 ms with outlines cached too; browser `?perf`: pan update 40 → 3.5 ms, zoom 26 → 6.5 ms | draw now dominates (Canvas2D 11 ms, WebGL 16 ms); WebGL layer reuse noted as the next lever | `rendering.md`, `domain-geometry.md`, `editor-interaction.md` |
| 2026-09-30 | P2 | finding | "Zoom is fast, pan is slow" (user): hover hit-testing stops at the first wall hit but otherwise lays out every tag; a zoom keeps the point under the cursor (often on a wall), a pan sweeps across room interiors | fixed by the tag cache | `editor-interaction.md` |
| 2026-09-30 | P3 | measure | 50×50 WebGL draw per pan step 16 → 5.0 ms (Canvas2D 10.5 ms), per zoom 15.5 → 5.9 ms; editor update unchanged (about 3 ms pan, 6 ms zoom) | step 5 now takes 8 draw calls (tags layer); text overlay is what remains | `rendering.md` |
