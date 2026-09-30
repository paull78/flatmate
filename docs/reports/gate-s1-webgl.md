# Gate S1: WebGL2 SDF renderer and live toggle

**Date:** 2026-09-29 · **Plan:** `docs/plans/flatmate-s1/` · **Commits:** `665ac71`..`2a63fe3` (interleaved with M1 on `implementation`)

## 1. Outcome

Demo step 10 (S1) works in a real browser engine: the toolbar button (or `?renderer=webgl`) switches the drawing between Canvas2D and a WebGL2 renderer live, mid-gesture, without losing the drawing or the wall chain. If WebGL2 is missing or its context is lost, the app falls back to Canvas2D and shows a notice. Canvas2D stays the default, and steps 1–9 still pass their e2e tests. Walls now draw 1 px edge segments over their fills, in both renderers. Still needed: your visual check, the live toggle by hand, and a timed dry run of rehearsal row 10.

## 2. Completion criteria

- [x] Canvas2D references of the pre-S1 look committed (S1.0a, `80e185a`); both final sets `canvas2d/` and `webgl/` committed (`2a63fe3`).
- [x] `pnpm check` passes. The editor has the wall-edge tests and the five count assertions count fills. Web Vitest covers the runner swap, the switch and its fallbacks, the toggle markup, the overlay and the builder.
- [x] Builder tests pin encodings, batch order and draw calls 5 (step 4) and 7 (step 5), and triangulate every demo wall outline without losing area.
- [x] `pnpm e2e` passes, including `renderers.spec.ts`: probes in both renderers, toggle mid-drawing, no-WebGL2 fallback, context-lost fallback.
- [x] Default stays Canvas2D; smoke and collaboration e2e pass. *The dry run of the rehearsal by hand is still open (yours).*
- [x] `demo-rehearsal.md` has row "10 (S1)" (Run 1 column empty, for your dry run).
- [x] README, spec §11 item 2 ("Done"), §6.2, `rendering.md`, `implementation.md`, `INDEX.md` updated; no analytic-AA claim for polygons, no uncomputed draw-call count, no speed claim.
- [x] You approved the visual check (2026-09-29).

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: 889 tests (protocol 94, domain 194, editor 381, web 108, server 53, sync-tests 14, scripts 3, mcp 42) |
| `pnpm e2e` | 7 passed (smoke, collaboration, renderers ×5), screenshots skipped; renderers spec stable over 3 runs |
| `pnpm screenshots`, `FM_RENDERER=webgl pnpm screenshots` | 1 passed each; five images per set |

## 4. Implementation issues

| # | Issue | Cause | Fix | Recorded in |
|---|-------|-------|-----|-------------|
| 1 | Under WebGL the helper's dimension line ran through its "4.00" label (demo step 5, vertical wall) | WebGL batches polygons before segments in a layer; Canvas2D hid the line under the label plate by scene order. The plan's "only overlaps ≤ 1 px" claim was never checked | the line stops at the plate (`outsideBox`, `b6c1d36`); Canvas2D unchanged, counts unchanged | `rendering.md`, `process.md` lesson 32, spec §6.2 |
| 2 | Shader comment called all SDF distances exact | arc butt ends are a bound near the corners | comment corrected (`fecfbd1`) | — |
| 3 | Bob's cursor off-target in the Canvas2D screenshot | the spec shot Alice before the presence throttle's trailing update (the app was right) | 300 ms wait in the spec; both sets re-shot (`2a63fe3`) | S1 sprint log |

## 5. Changes to the plan

| # | Task | Planned | Done instead | Why |
|---|------|---------|--------------|-----|
| 1 | S1.2 review | review only | plus an editor fix and an audit of paint order in every layer | issue 1 |
| 2 | S1.4 step 6 | 2-minute hand check | moved to this gate (you) | agents must not leave servers running |
| 3 | S1.5 | README "polygons with MSAA" | "MSAA when the browser provides it" | `antialias: true` is a request |

## 6. Changes to the spec

| § | Change | Commit |
|---|--------|--------|
| §6.2 | "only overlaps ≤ 1 px" replaced: the scene doesn't rely on paint order within a layer; two momentary drag overlaps remain | `b72817d` |
| §11 item 2 | "Done (gate S1)" | `3301489` |

## 7. Design-memory updates

- `rendering.md`: helper/paint-order decision and Don't; the plan's five S1 rows (switch, two canvases, draw calls, coverage, wall edges) and three Don'ts (`loseContext`, `alpha: false`, no parity/speed claim).
- `implementation.md`: `earcut`, pixel probes, screenshots.
- `process.md`: lesson 32 (an order-dependent effect breaks when a second backend orders differently).
- `INDEX.md`: Rendering summary.

## 8. Gate questions

1. **Where does WebGL differ visibly?** About 0.2–0.3 % of pixels per image. WebGL shows no miter seams at wall corners and T-junctions, which Canvas2D still shows faintly, and slanted edges step slightly differently. Hairlines match. No text overlaps geometry in the five images, and none shows the translucent preview rim, so check both by hand. While dragging a joint, two overlaps still differ for an instant (a snap guide ends under a handle disc; the red ghost disc sits over an on-wall snap cross).
2. **Draw calls:** 5 at step 4 and 7 at step 5, both pinned by builder tests; steps 2, 3, 6 and 7 were not computed (upper bound 9 pairs today). The code matches §6.2.
3. **Frame time:** not measured.
4. **Wall edges in Canvas2D** (old `80e185a` vs new): outer edges are crisp instead of a grey antialiasing row (walls look about 0.5 px wider per side); corner seams are fainter. Your call whether you like it.
5. **Headless WebGL:** stable (3 runs); ANGLE on SwiftShader; no launch flags needed.
6. **Merge conflicts with M1:** only the root `package.json` scripts (`mcp`, `screenshots`), kept both. S1.5's docs landed before M1's; M1.10 keeps S1's lines.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1–9 | works (unchanged; smoke and collaboration e2e) | browser, two browsers |
| 10 WebGL toggle | works in Playwright; hand check and timed dry run pending (you) | browser |

**Hand check (2026-09-29):** in Edge the toggle first showed "WebGL2 is unavailable", then worked after a pending browser update. VS Code's built-in browser has GPU features disabled, so it always falls back (as designed). The app now logs why WebGL is unavailable (`fc2b157`), and the rehearsal pre-flight says to demo in Chrome or Edge.

**For your check:** `pnpm demo`, open `?name=Alice`, click "Canvas2D" in the toolbar (top right) to switch, draw and drag in both. Compare `docs/reports/screenshots/canvas2d/*.png` with `webgl/*.png`.
