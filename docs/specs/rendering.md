# Rendering

How the web shell draws the plan: the three plan renderers, how one is chosen, the render format they share (`@fm/render`), the font, dash and colour rules, the one clip rule, how the renderers are kept in agreement, and how speed is measured. The Scene is in [editor.md](editor.md), what each level draws in [levels.md](levels.md), the 3D view in [view3d.md](view3d.md), files and PDFs in [export.md](export.md).

## The renderers

`Renderer` (`packages/web/src/adapters/renderer.ts`) has `render(scene, camera)` and `dispose()`. The editor never knows which renderer draws. Each keeps only the latest scene and draws at most once per animation frame; a `render` after `dispose` draws nothing.

| Renderer | File (`packages/web/src/adapters/`) | Draws | Antialiasing |
|---|---|---|---|
| Canvas2D | `canvas2d-renderer.ts` | every primitive and the underlay, in scene order | the browser's |
| WebGL2 | `webgl-renderer.ts` | the render format's buffers | SDF coverage for segments, arcs, discs; MSAA for polygons |
| WebGPU | `webgpu-renderer.ts` | the same buffers in the same order, through WGSL | the same coverage; MSAA ×4 |

**Canvases.** `gl-canvas` lies under the input canvas (`app.tsx`). Under Canvas2D the input canvas draws everything. Under a GPU renderer it is cleared transparent each frame and draws only the text, in scene order, above all geometry (`drawTextOverlay`). WebGPU draws on a canvas of its own beside `gl-canvas`, removed on dispose, because a canvas keeps one context mode.

**Canvas2D** fills the background, draws the underlay once decoded ([underlay.md](underlay.md)), then the layers. Polygons with holes fill even-odd. A run of opaque, undashed segments of one colour, width and cap is stroked as one path (`drawPrimitives`).

**WebGL2** uses `ONE, ONE_MINUS_SRC_ALPHA` blending on premultiplied output and one draw call per non-empty pair of layer and kind. Segments, arcs and discs are instanced quads whose shader turns a distance `d` in CSS px into coverage, `clamp(0.5 - d * dpr, 0, 1)`; arc butt ends give only a bound near their corners. Wall edges get this antialiasing because `walls-layer.ts` draws each wall's fill, then thin segments along its outline in the same colour, all fills before all edges. `?sdf=debug` shows WebGL2's distance field instead: inside a shape its colour, outside alternating 4 px bands fading out by 16 px; polygons draw as usual.

**WebGPU.** `acquireGpu` (`webgpu/kit.ts`) builds the device and every pipeline before the app mounts, only when the URL asks for WebGPU, because WebGPU reports a bad shader asynchronously. No adapter, a refused device, a canvas format outside `TARGET_FORMATS`, a failed pipeline or no answer within 2 s gives no kit. A frame is one pass cleared to the background, MSAA ×4 resolved to the canvas.

## Choosing a renderer

`createRendererSwitch` in `packages/web/src/renderer-switch.ts`. `?renderer=webgl` or `?renderer=webgpu` starts on that renderer; anything else starts on Canvas2D, the default. The list is WebGPU (only when asked for), WebGL2, Canvas2D:

- A renderer starts at the first entry that works; Canvas2D always works.
- A lost context or device moves to the next entries, with a notice. There is no restore.
- The renderer button in the canvas corner chip (`panels/RendererToggle.tsx`) toggles between Canvas2D and the first GPU entry that works, at once, redrawing the last scene.

| Notice | Text |
|---|---|
| `WEBGPU_UNAVAILABLE` | WebGPU is unavailable: drawing with WebGL2 |
| `WEBGPU_LOST` | WebGPU device lost: drawing with WebGL2 |
| `WEBGL_UNAVAILABLE` | WebGL2 is unavailable: drawing with Canvas2D |
| `WEBGL_LOST` | WebGL context lost: drawing with Canvas2D |

The input adapter sends `viewportResized` on a CSS resize and on a pixel ratio change alone (a `resolution` media query), so every renderer redraws at a new screen's ratio.

## The render format

`@fm/render` (`packages/render/src`) is a core package (no DOM, no Node built-ins) that turns a Scene's layers into flat buffers a GPU renderer in any language can draw. It also holds the GLSL, the WGSL, the camera uniform and the pass facts.

```
 createEncoder().encode(scene) → { layers: { name, rev, buffer | null }[] }    one per scene layer, in order

 buffer, little-endian, version 1
   header   u32 × 14: magic "FMR1" · version · per kind in KIND_ORDER: count · byteOffset · strideBytes
   sections Float32 records per kind, back to back, in KIND_ORDER: polygon, segment, arc, disc
```

| Kind | Floats | Record |
|---|---|---|
| polygon | 6 per vertex | x y · r g b a (earcut triangles, snapped to 1 µm) |
| segment | 13 | ax ay bx by · width unit cap · dashOn dashOff · r g b a |
| arc | 11 | cx cy · radius start span · width unit · r g b a (span counter-clockwise, 0 to 2π) |
| disc | 8 | cx cy · radius unit · r g b a |

Positions are world metres; `unit` 0 is metres scaled by zoom, 1 is CSS pixels; `cap` 0 is butt, 1 round; a dash of 0 0 is solid; colours are straight, 0 to 1. Polygons under three points, zero-length butt segments, zero-span arcs and all text are left out. `readHeader` refuses another magic or version, a stride other than the table's and a section outside the buffer.

- **One table.** `LAYOUT` (`layout.ts`) holds every stride, attribute location and offset and the unit and cap codes. The encoder writes by it, both GPU renderers read their vertex layouts from it (`vertexLayouts()` in `pass.ts` for WebGPU), and tests hold the hand-written GLSL (`shaders.ts`) and the WGSL (`wgsl.ts`) to it. Changing `KIND_ORDER` changes the format.
- **Revisions.** An encoder sends a layer's buffer, with a new `rev`, only when its primitives array is a different object from its last call; otherwise the buffer is null. The first call sends every layer, so a new encoder is a reset. The editor keeps unchanged layers' arrays, so a pan sends only the layers rebuilt every event.
- **The layer cache.** Both GPU renderers share `createLayerCache` (`adapters/gpu-layers.ts`): upload on a new buffer, keep it while the rev holds, collect the texts. A sync that throws frees every upload and starts a new encoder.
- **Pass facts** (`pass.ts`, `camera.ts`): the camera uniform is `center` vec2, `zoom`, `dpr`, `half` vec2 in 24 bytes at `@group(0) @binding(0)` (`packCamera`); instanced kinds read the unit quad (4-vertex strip) at slot 0 and their records at slot 1; polygons a triangle list at slot 0; the target is non-sRGB `bgra8unorm` or `rgba8unorm`; entry points `vs` and `fs`.

## Layers and draw order

The 18 layers paint back to front: grid, ghosts, finishes, zoneFills, deckFloors, decks, objects, overheads, warnings, walls, openings, deckLabels, tags, dimensions, marks, annotations, overlays, presence (`LAYER_ORDER`, [editor.md](editor.md)).

Canvas2D paints in scene order. The GPU renderers paint layer by layer and, within a layer, polygons, then segments, arcs and discs, with all text after all geometry. So a layer must not rely on paint order where shapes of different kinds overlap: the shapes avoid each other (a dimension line stops at its label plate), or the clip rule cuts them.

## One clip rule

A filled piece's lines are cut to outside every filled piece drawn after it, so Canvas2D, WebGL2, WebGPU and paper agree. `objectsLayer` (`packages/editor/src/view/objects-layer.ts`) finds the later fills whose boxes cross each piece, and `clipOutside` (`view/clip.ts`) cuts its segments and arcs to outside each convex ring; a cut arc becomes short segments. Fills, discs and texts are not cut. Stairs take part both ways. A selected piece draws its lines whole, after every piece.

## Fonts, dashes and colours

**Fonts.** A text primitive names `"inter"` or `"helvetica"`. `packages/editor/src/view/fonts.ts` owns them: `textWidth(font, text, size)`, `fontMetrics(font)`, `FONT_FAMILY` and `CHROME_FONT` (Inter). Widths come from tables: Inter's 256-entry Windows-1252 table (`view/inter-widths.ts`, generated from the bundled `packages/editor/fonts/Inter-Regular.ttf`), Helvetica's `helveticaWidth`. A character outside Windows-1252 measures 1.25 em. Kerning is off wherever text is drawn. The `Host` never measures text. The web loads the TTF as a `FontFace` and mounts once it has loaded or after 3 s. How `look` and paper draw text is in [export.md](export.md).

**One dash pair.** `Dash = readonly [on, off]` in drawing units; every backend draws exactly that pair.

**One colour parser.** Scene colours are lowercase `#rrggbb` or `#rrggbbaa` (`COLOR_PATTERN`, `view/colors.ts`), held by a test over every constant, style and drawn colour. `colorChannels` is the one parser, for the encoder, SVG, PDF and 3D; a refused colour draws magenta. Presence colours are lowercased where they enter the Scene.

## Keeping the renderers in agreement

They share one Scene, encoder, layout table, camera packing, colour parser and dash pair, and fonts measured by tables. Then:

- `packages/render/test` checks the encoder against a frozen copy of the old WebGL builder (`old-instances.ts`, never edited to pass), the header, the revisions, and both shader dialects against `LAYOUT`.
- `packages/web/e2e/webgpu.spec.ts` compares WebGPU with WebGL2: a fixture layer with every kind, no pixel more than 16 levels apart at pixel ratio 1 and 2; the sample apartment, at most 1 % of pixels apart. It compiles every WGSL module and loses the device through `window.__fmGpu.lose()` (under `?perf` only).
- `packages/web/e2e/renderers.spec.ts` probes colours at chosen pixels per renderer, the toggle, the fallbacks and the debug view.
- Canvas2D against the GPU renderers has no pixel test: it rests on the draw order and clip rules.

## Measuring speed

No speed is claimed unless measured; numbers are recorded, never asserted.

- **`?perf`** (`packages/web/src/perf.ts`) shows the average, median and worst of the last 120 samples of: update (the editor's `update` per event), draw (the renderer's frame), the interval between frames, the primitive count, and the 3D draws while open. Under WebGL2 the draw ends with `gl.finish()`, in this mode only; WebGPU's is timed until `onSubmittedWorkDone` and is not comparable. The meter is also `window.__fmPerf` (`reset()`, `summary()`).
- **`pnpm seed:grid [N]`** stores "Grid N×N": N × N labelled 3 m rooms, N from 1 to 200, default 30. Run it before the server.
- **`FM_PERF=1 pnpm test`** also runs the wall-clock budgets in unit tests (`describe.skipIf(!PERF)`); without it they are skipped, so a busy machine never fails `pnpm check`.
- **`FM_PERF=1 pnpm e2e perf`** seeds the 50 × 50 grid and times seven gestures, each on three fresh pages at 1400 × 900 and ratio 2, printing medians: pans in each renderer with the 3D view closed, pans and a joint drag in Canvas2D with it open, zoom steps in WebGL and WebGPU. `perf-studio.spec.ts` times a drag and the Day/Night flip in the seeded studio. The browser runs on the GPU (`--use-angle=metal`); without it headless WebGL runs on the CPU.

## Limits

- WebGPU runs only with `?renderer=webgpu`. A lost context or device is never restored.
- The underlay draws under Canvas2D only.
- Text is never on the GPU, and format version 1 has no text section. Its vertical anchor is Canvas2D's `middle`, not a number in the core.
- The SDF debug view is WebGL2's only.
- The encoder runs only on little-endian platforms.
- The clip rule cuts by convex rings only: a stair's fills cut other lines only where they are convex.
