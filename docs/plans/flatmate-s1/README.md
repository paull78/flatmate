# S1: WebGL2 SDF Renderer and Live Canvas2D Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **The plan ends in one gate (lean mode): stop there, write the gate report, update design memory, and wait for the user's approval.**

**Goal:** Draw the editor's Scene with a WebGL2 SDF renderer and switch between it and Canvas2D live, from a toolbar button or `?renderer=webgl|canvas2d`, without the demo ever depending on WebGL (spec §1.4 step 10, §6.2, §11 item 2).

**Architecture:** The editor stays as it is except for one change: the `walls` layer now draws 1 px edge segments over each wall fill (option A), so wall edges get analytic antialiasing under WebGL. Everything else is shell code in `@fm/web`: the effect runner gains `setRenderer` (it keeps the last scene and redraws it at once), a small `RendererSwitch` owns the choice and the fallback, a pure `buildFrame` turns a Scene into typed arrays per (layer × kind), and a thin WebGL2 backend draws them, with text on the existing Canvas2D canvas stacked above as an overlay.

**Tech stack:** TypeScript 6, React 19, Vite 8, Vitest 5 (Node environment), Playwright 1.63 (Chromium; headless WebGL2 runs on SwiftShader), WebGL2 with GLSL ES 3.00, `earcut` 3.2.4 (ships its own types).

**Task file:** [tasks.md](tasks.md) (all tasks, complete code, commands).

**Resuming:** read this file, then `docs/plans/flatmate/EXECUTION.md` (lean mode, how a wave runs, the implementer prompt template: use it with `docs/plans/flatmate-s1/tasks.md` as the task file), then the ticked steps and the `## Sprint log` below.

**Sources of truth:** spec `docs/specs/flatmate-design.md` (§1.4 step 10, §5.9, §6, §6.1, §6.2, §11 item 2) for *what*; `docs/design-memory/INDEX.md`, `rendering.md` (Decisions and Don't), `architecture.md`, `scope.md` and `process.md` for *why*. The code wins over stale plan text (EXECUTION.md): implementers adapt and report.

---

## Decisions already made (do not reopen)

| # | Decision | Where it lands |
|---|----------|----------------|
| 1 | **Option A:** each wall is its filled outline polygon plus 1 px, round-capped segments along every outline edge, in the fill colour, in both renderers. All fills of the layer come first, then all edges. | Task S1.1, `packages/editor/src/view/scene.ts` |
| 2 | **Text on a Canvas2D overlay** stacked above the WebGL canvas. Under WebGL all text sits above all geometry, so tag and helper text can cover handles, snap glyphs and remote cursors. This is an accepted trade-off and the docs say so. | Tasks S1.3, S1.5 |
| 3 | **Shell-only toggle:** a toolbar button plus `?renderer=webgl|canvas2d`; no editor state or event. Toggling swaps the renderer in the effect runner and redraws the last scene at once. Default is Canvas2D. WebGL2 missing or context lost → Canvas2D plus a notice in the toolbar; no context restore beyond that. | Tasks S1.0b, S1.4 |
| 4 | **"Done"** = the user's visual check against committed reference screenshots, plus Playwright pixel probes. No pixel parity requirement, no performance claim beyond numbers actually measured. | Tasks S1.0a, S1.4, S1.5, gate |
| 5 | **Restore phase 8 Task 8.6** (screenshots) first, so Canvas2D references of the current look exist before anything changes. | Task S1.0a |
| 6 | **Lean mode:** waves back to back, one gate at the end (`docs/reports/gate-s1-webgl.md`), reviews only for the editor change (S1.1) and the pure instance builder (S1.2). | Waves below |

Choices made while planning (verified in a scratch copy of the repo, see "Verification while planning"):

- **Two stacked canvases, not three.** A canvas keeps the context type and attributes of its first `getContext` call. The existing input canvas (`data-testid="canvas"`) stays on top and takes input. Under Canvas2D it draws everything opaque. Under WebGL it becomes the transparent text overlay. A new `gl-canvas` lies under it with `pointer-events: none`. The only cost: `createCanvas2DRenderer` drops `alpha: false`, since it paints an opaque background anyway.
- **Coverage from `d · dpr`, not `fwidth(d)`.** Fragment distances are exact Euclidean distances in CSS px, so one device pixel is `1 / dpr` of them. `clamp(0.5 − d·dpr, 0, 1)` gives the same result as the spec's `0.5 − d / fwidth(d)` for these fields, with no derivatives inside branches. The spec §6.2 sketch was updated before implementation (`bbfd448`).
- **Kind order inside a layer:** WebGL draws polygons, then segments, arcs and discs; Canvas2D keeps scene order. This was wrong as first written ("only overlaps of 1 px or less"): the helper's dimension line ran under its label plate in Canvas2D but over it in WebGL (S1.2 review). The helper line now stops at the plate (editor fix `b6c1d36`); what remains is momentary while dragging a joint (spec §6.2). Option A's "all fills, then all edges" makes the walls layer identical in both renderers.
- **Dashes and arcs** are implemented to spec but unused by today's editor. A dash pattern keeps its first on/off pair, and dash ends are not antialiased. Arcs have butt ends (ring ∩ wedge).
- **Colours** are parsed from `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`. Anything else draws magenta rather than throwing mid-frame. Blending is premultiplied (`ONE, ONE_MINUS_SRC_ALPHA`).
- **Translucent walls** (the wall tool's preview, `#2563eb99`) get a slightly darker rim, because the inner half of each 1 px edge blends over the fill. This happens in both renderers and is accepted.
- **File names follow the spec's tree (§5.2):** `packages/web/src/adapters/webgl-renderer.ts`, plus `adapters/webgl/instances.ts` (pure) and `adapters/webgl/shaders.ts`.

---

## Architecture

```
 @fm/editor (unchanged API)                          @fm/web shell
 update() ─► render effect {scene, camera, view} ─► EffectRunner.run ─► current Renderer.render(scene, camera)
                                                        ▲
                                                        │ setRenderer(r): r.render(last scene) at once
                                          RendererSwitch (toolbar button, ?renderer=)
                                           ├─ canvas2d(): createCanvas2DRenderer(canvas)
                                           └─ webgl(onLost): createWebGLRenderer(glCanvas, canvas, onLost)
                                                  null (no WebGL2 / shader error) ─► Canvas2D + notice
                                                  webglcontextlost ─► onLost ─► Canvas2D + notice

 Stage, bottom → top
 ┌─ gl-canvas   WebGL2: polygons (earcut, MSAA) + SDF segments/arcs/discs    pointer-events: none
 └─ canvas      Canvas2D mode: the whole scene, opaque          ◄── pointer, wheel (keys on window)
                WebGL mode:    text only, cleared transparent

 WebGL frame (at most one per animation frame, latest scene wins)
 Scene ──buildFrame (pure, Vitest)──► Frame { batches: [layer × kind] Float32Array, texts: [...] }
          batches ──► one draw call each; uniforms: centre, zoom, half viewport, dpr
          texts   ──► drawTextOverlay ─► drawPrimitive (the Canvas2D code, text only)
```

**Draw calls per frame** (computed by the builder tests on the demo drawing, Task S1.2): one per non-empty (layer × kind).

| Frame | Batches | Draw calls |
|-------|---------|-----------:|
| Demo step 4 (room, divider, two zones, pointer away) | grid/segment, zoneFills/polygon, walls/polygon, walls/segment, annotations/polygon | 5 |
| Demo step 5 (right wall selected, helper shown) | the 5 above + annotations/segment, overlays/disc | 7 |
| Upper bound for today's editor | the only (layer × kind) pairs `buildScene` emits: grid/segment, zoneFills/polygon, walls/polygon, walls/segment, annotations/polygon, annotations/segment, overlays/segment, overlays/disc, presence/disc | 9 |

The spec's old "about 10–15" was too high; §6.2 now has these counts (`bbfd448`). Instance data is rebuilt for every new Scene object, and the editor builds a new Scene after every event. Pan and zoom are uniforms, but in practice a pan also rebuilds the buffers. Nothing here is a performance claim.

---

## File structure

| Action | Path | Responsibility | Task |
|--------|------|----------------|------|
| Create | `packages/web/e2e/support/demo-driver.ts` | server-mode demo driving for screenshots (`openProject`, `drawDemoApartment`, `helperLabelPage`, …) | S1.0a |
| Create | `packages/web/e2e/screenshots.spec.ts` | five demo screenshots per renderer; runs only with `FM_SCREENSHOTS=1` | S1.0a |
| Modify | `package.json` (root) | `screenshots` script | S1.0a |
| Create | `docs/reports/screenshots/canvas2d/*.png` | Canvas2D references (pre-S1 look; re-shot in S1.5) | S1.0a, S1.5 |
| Create | `docs/reports/screenshots/webgl/*.png` | WebGL references | S1.5 |
| Modify | `packages/web/src/adapters/effect-runner.ts` | returns `EffectRunner { run, setRenderer }`; keeps the last render | S1.0b |
| Modify | `packages/web/test/effect-runner.test.ts` | harness sets the renderer; swap tests | S1.0b |
| Create | `packages/web/src/renderer-switch.ts` | `rendererFrom(search)`, `createRendererSwitch` (choice, fallback, notice, subscribe) | S1.0b |
| Create | `packages/web/test/renderer-switch.test.ts` | switch behaviour with fake renderers | S1.0b |
| Create | `packages/web/src/panels/RendererToggle.tsx` | toolbar button + notice | S1.0b |
| Create | `packages/web/test/renderer-toggle.test.tsx` | markup of the toggle and its place in the toolbar | S1.0b |
| Modify | `packages/web/src/panels/Toolbar.tsx` | optional `children` at the end | S1.0b |
| Modify | `packages/web/src/app.tsx` | two stacked canvases; subscribes to the switch; renders the toggle | S1.0b |
| Modify | `packages/web/src/main.tsx` | creates the switch; `mountCanvas(canvas, glCanvas)` attaches it | S1.0b, S1.4 |
| Modify | `packages/web/src/styles.css` | `.gl-canvas`, `.renderer-toggle`, `.renderer-notice` | S1.0b |
| Modify | `packages/editor/src/view/scene.ts` | `drawWalls`: fills, then 1 px edge segments | S1.1 |
| Modify | `packages/editor/test/view.test.ts` | new edge tests; five count assertions now count fills | S1.1 |
| Modify | `packages/web/package.json`, `pnpm-lock.yaml` | `earcut` ^3.2.4 dependency | S1.2 |
| Create | `packages/web/src/adapters/webgl/instances.ts` | pure `buildFrame(scene)`, `parseColor`, `dashPair`, `arcSpan`, layouts | S1.2 |
| Create | `packages/web/test/webgl/instances.test.ts` | encodings, order, counts, earcut on the demo drawing | S1.2 |
| Create | `packages/web/src/adapters/webgl/shaders.ts` | GLSL ES 3.00 sources: polygon, segment, arc, disc | S1.3 |
| Create | `packages/web/src/adapters/webgl-renderer.ts` | `createWebGLRenderer(glCanvas, overlay, onLost)`: programs, VAOs, draw, overlay, rAF | S1.3 |
| Modify | `packages/web/src/adapters/canvas2d-renderer.ts` | `DrawContext.clearRect`, `drawTextOverlay`, no `alpha: false` | S1.3 |
| Modify | `packages/web/test/canvas2d-renderer.test.ts` | `clearRect` in the recording fake; overlay test | S1.3 |
| Create | `packages/web/e2e/support/pixels.ts` | composited pixel probe (`pixelAt`, `expectPixel`) | S1.4 |
| Create | `packages/web/e2e/renderers.spec.ts` | pixel probes in both renderers, toggle mid-drawing, two fallbacks | S1.4 |
| Modify | `docs/reports/demo-rehearsal.md`, `README.md`, spec, design memory | step 10 row, honest docs | S1.5 |

---

## Waves

Tasks in one wave touch disjoint files and run in parallel worktrees (EXECUTION.md, "One wave, step by step").

| Wave | Tasks (size) | Depends on | Review |
|------|--------------|-----------|--------|
| 1 | **S1.0a** screenshots (S) · **S1.0b** renderer seam and toggle, Canvas2D only (M) · **S1.1** wall edge segments (S) | base commit | one Opus review of S1.1 only |
| 2 | **S1.2** pure instance builder + earcut (M) | S1.1 (its demo-drawing tests expect the edge segments) | one Opus review of S1.2 |
| 3 | **S1.3** WebGL2 backend + text overlay (M) | S1.2 | none (glue; S1.4's probes test it) |
| 4 | **S1.4** wiring, fallback and pixel probes (S), then **S1.5** references, rehearsal step 10, docs (S) | S1.0b, S1.3 | none |
| Gate | `docs/reports/gate-s1-webgl.md`, stop for the user's visual check | all | — |

**Ports in wave 1:** only the S1.0a agent starts servers (`pnpm demo` uses 5173 and 8787; the Playwright config also starts 8788). The S1.0b and S1.1 agents run `pnpm check` only, never `pnpm e2e` or `pnpm demo`. The controller runs `pnpm e2e` after merging the wave. Before wave 1, make sure nothing of yours is listening on 5173, 8787 or 8788 (`lsof -i :5173 -i :8787 -i :8788`).

**Parallel work on M1 (MCP server, spec §12)** may be running at the same time. Its files barely overlap with S1's: M1 adds `packages/mcp` and an editor event (`ports/events.ts`, `update.ts`); S1 touches `view/scene.ts` only in the editor. Expect hand merges only in the root `package.json` (both add scripts), `README.md`, `docs/reports/demo-rehearsal.md` (step 10 has one part for each), spec §11 ("Done" markers only; both designs are already in the spec) and `design-memory/INDEX.md`. S1.5 edits those last and keeps M1's lines.

---

## Gate protocol

Follow `docs/plans/flatmate/README.md` → "Gate protocol", with these specifics:

- Report: `docs/reports/gate-s1-webgl.md` from `docs/reports/TEMPLATE.md` (sections 1–9). In §9 add a row "10 WebGL toggle".
- Verification to record in report §3:

```bash
pnpm check
pnpm e2e                                   # smoke, collaboration, renderers (5 tests); screenshots skipped
pnpm demo                                  # second terminal, then:
pnpm screenshots                           # Canvas2D set
FM_RENDERER=webgl pnpm screenshots         # WebGL set
for p in protocol domain editor web server sync-tests scripts; do
  pnpm --filter "@fm/$p" test 2>&1 | grep -E "Tests +[0-9]+" | sed "s/^/$p: /"
done
```

- The user's visual check: open `docs/reports/screenshots/canvas2d/*.png` and `docs/reports/screenshots/webgl/*.png` side by side (same five names), then toggle live in a real browser (`pnpm demo`, `?name=Alice`). Their verdict is part of "done".
- Commit `gate S1: report, memory and plan updates`, then stop.

## Completion criteria

- [x] Canvas2D references of the pre-S1 look are committed (S1.0a). Both final sets, `canvas2d/` and `webgl/`, are committed at the gate (S1.5).
- [x] `pnpm check` passes. The editor has its new wall-edge tests, and the five changed count assertions count fills (S1.1). Web Vitest covers the runner swap, the switch and its fallbacks, the toggle markup, the overlay and the builder.
- [x] The builder tests pin encodings, batch order and the draw-call counts for demo steps 4 (5) and 5 (7), and triangulate every demo wall outline without losing area (S1.2).
- [x] `pnpm e2e` passes, including `renderers.spec.ts`:
  - wall centre and empty floor probes in both renderers;
  - toggling mid-drawing keeps the drawing and the wall chain;
  - WebGL2 unavailable → Canvas2D with a notice;
  - context lost → Canvas2D with a notice, keeping the drawing.
- [x] The default stays Canvas2D. Demo steps 1–9 behave as before (the smoke and collaboration e2e tests pass, plus one dry run of the rehearsal).
- [x] `docs/reports/demo-rehearsal.md` has the step 10 (S1) row.
- [x] README, spec §11 item 2 (and §6.2 if the code differs), `rendering.md`, `implementation.md` and `INDEX.md` are updated (S1.5), with no claim of analytic AA for polygons, of a draw-call count other than the computed one, or of performance numbers that were not measured.
- [x] The user approved the visual check (2026-09-29).

## Questions the gate report must answer

1. Side by side, where does WebGL differ visibly from Canvas2D? Check text over handles, snap glyphs and cursors; polygon edges (MSAA) against Canvas2D's; hairline weight; the translucent preview rim. Which differences are acceptable for the demo?
2. What are the draw calls per frame at demo steps 2–7, from the builder tests or a debug count? Does the code match spec §6.2 (written before implementation)? List any difference.
3. Was any frame time measured? If yes, give the method (DevTools Performance, machine, browser, drawing) and the numbers. If not, say "not measured"; no other wording.
4. Did the wall edges change the Canvas2D look in a way the user dislikes (compare the S1.0a references with the S1.5 re-shoot)?
5. Were the headless WebGL probes stable (SwiftShader)? Were any launch flags needed? (None were needed while planning; see below.)
6. Were there merge conflicts with M1, and how were they resolved?

---

## Verification while planning (2026-09-29)

The plan's code was applied to a scratch copy of the repo at `1607c0d`:

- `pnpm check` passed: protocol 94, domain 188, editor 365, web 108, server 53, sync-tests 14, scripts 3 = 825 tests, no depcruise violations.
- `renderers.spec.ts` (5 tests) and `smoke.spec.ts` passed in headless Chromium.
- `screenshots.spec.ts` passed for both renderers against a scratch server.
- Headless Chromium from Playwright 1.63 on macOS reported `WebGL 2.0 … ANGLE (… SwiftShader …)`, with `SAMPLES` 4 and `WEBGL_lose_context` available, with and without `--enable-unsafe-swiftshader` / `--use-angle=swiftshader`. No launch arguments are needed. If a future Chromium drops the automatic SwiftShader fallback, add `launchOptions: { args: ["--enable-unsafe-swiftshader"] }` to the Chromium project in `playwright.config.ts` and log it.
- `earcut@3.2.4` is ESM with bundled types (`export default function earcut(data, holeIndices?, dim?): number[]`), so no `@types/earcut` is needed.

Expected counts after S1: editor 365 (+1), web 108 (+38).

**Rechecked 2026-09-29 at `bbfd448`** (no code rerun): since `1607c0d` the code changed in the domain (labels follow rooms, `6732ebb`) and in snapping (`1070eb9` grid fallback, `bd39a4e` aligned snap). S1.1's anchors in `scene.ts` (`drawWalls`, `PREVIEW_WALL`) and `view.test.ts` (the five counts) are unchanged. The aligned snap adds `COLORS.snapGuide` (`#d9770680`, which S1.2's parser accepts) and overlay guide segments (overlays/segment, already in the upper bound of 9). The screenshot driver's clicks hit endpoints and midpoints, which outrank the aligned snap. New baseline: editor 372, so 373 after S1.1.

---

## Progress

- [x] Wave 1 merged (S1.0a, S1.0b, S1.1) and S1.1 reviewed
- [x] Wave 2 merged (S1.2) and reviewed
- [x] Wave 3 merged (S1.3)
- [x] Wave 4 merged (S1.4, S1.5)
- [x] Gate S1 approved (2026-09-29)

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-09-29 | plan | recheck | §6.2 design and counts written into the spec before implementation (`bbfd448`); code changes since `1607c0d` checked against S1.1–S1.4 (see "Rechecked" above) | S1.5 steps 4–5 trimmed to what remains; test baseline updated | `rendering.md` (`bbfd448`) |
| 2026-09-29 | wave 1 | merge | S1.0a, S1.0b, S1.1 applied verbatim, no adaptations (base `87b4c58`); S1.1 review approved with no findings. Root `package.json` conflicted with M1.2's `mcp` script as the M1 README predicted | kept both scripts; `pnpm check` 826 tests (editor 378, web 88, mcp 2); `pnpm e2e` 2 passed, screenshots skipped | — |
| 2026-09-29 | S1.0a | tooling | `lsof -i :5173 …` also lists an editor's CLOSED client sockets, so the pre-flight looked busy while nothing listened | check with `lsof -sTCP:LISTEN -i :5173 -i :8787 -i :8788` | — |
| 2026-09-29 | S1.2 | review | Review found the helper's dimension line drawn through its label plate under WebGL (kinds batched: polygons before segments), visible at demo step 5 on the vertical right wall; the plan's "only overlaps ≤ 1 px" claim was wrong | editor fix `b6c1d36`: the line stops at the plate (`outsideBox`, Canvas2D unchanged, counts still 5/7); audit left three momentary drag-only overlaps (guide under handle, ghost over on-wall cross, triangle glyph under handle) | `rendering.md`, `process.md` lesson 32, spec §6.2 |
| 2026-09-29 | waves 2–4 | merge | S1.2, S1.3, S1.4 applied verbatim; S1.3 shader comment overclaimed exact distances for arc ends | comment corrected (`fecfbd1`); `pnpm e2e` 7 passed (renderers 5, stable over 3 runs, SwiftShader, no launch flags); S1.4 step 6 (hand check) moved to the gate | — |
| 2026-09-29 | S1.5 | finding | Both sets shot (`1 passed` each). The renderers differ in about 0.2–0.3 % of pixels (2 % fuzz): Canvas2D still shows faint miter seams at wall corners and T-junctions, WebGL none; grid and helper hairlines match to 1 level; the helper line stops at the "3.5" plate in both. No text overlaps geometry in the five images, and none shows the translucent wall-tool preview, so those two differences are checked by hand at the gate. Against the S1.0a set, the wall edges make the seams much fainter and the walls about 0.5 px wider per side | references committed; gate question 1 and 4 answers in the S1.5 report to the controller | — |
| 2026-09-29 | S1.5 | finding | `two-windows-alice.png` shows Bob's cursor at about (3.4, 3.4) in both Canvas2D sets but at (4.5, 1) in the WebGL set: the spec shoots Alice once "Bob" is in the collaborators list, not once his cursor reached its last point (a timing race, not a renderer difference) | fixed by the controller: the spec waits 300 ms after Bob appears (the 50 ms presence throttle sends his last position on a trailing timer; the app was right); both sets re-shot | — |
| 2026-09-29 | S1.5 | deviation | Docs differ from the plan text: README says polygons get MSAA "when the browser provides it" (`antialias: true` is a request) and the `@fm/web` package row names both renderers; the §11 sentence says the MCP server is in progress; rehearsal row 10's Run 1 is left for the user's dry run (note added); `rendering.md`'s "first follow-up" row now says §11 item 2 | code wins over plan text; no speed claim | `rendering.md`, `implementation.md`, `INDEX.md` |
| 2026-09-30 | S1.6 | scope | User could not see any difference between the renderers and asked how to verify SDF | `?sdf=debug` view designed in spec §6.2 first, then task S1.6 | `rendering.md` |
