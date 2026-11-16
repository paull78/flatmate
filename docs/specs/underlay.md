# Underlay

The underlay is a picture of a floor plan drawn under the drawing, for a person or Claude to trace. This document covers its row, commands, import, the Scale tool, Properties, drawing, and tracing with Claude. Claude's tool list and the rest of `look` belong to [mcp.md](mcp.md).

```
 drop or choose a PNG/JPEG/WebP/GIF ──► JPEG, long side ≤ 2000 px ──► placeUnderlay: one row "underlay"
                                                                       │  at = top-left, 0.01 m per px, unscaled
                       Scale tool / scale_underlay ──► scaleUnderlay ──┤
                                                                       ├─► Canvas2D draws it under the layers, faded
                                                                       └─► look (MCP): grey backdrop + drawing + rulers
```

## The row

The table `underlays` holds at most one row, under the id `underlay` (`UNDERLAY_ID`, `packages/domain/src/model.ts`). Every client and the MCP process hold it, as any table.

| Field | Meaning |
|---|---|
| `pictureId` | a fresh id per imported picture; the renderer caches the decoded picture by it |
| `mime` | always `image/jpeg` |
| `data` | base64 JPEG, 1 to `MAX_UNDERLAY_DATA_CHARS` (992,000) characters, so a put fits one 1 MB message |
| `width`, `height` | pixels, whole, 1 to `UNDERLAY_LONG_SIDE` (2000) |
| `at` | the plan point of the picture's top-left corner; pixel rows run toward −y |
| `metresPerPixel` | more than 0; a new picture gets `PROVISIONAL_METRES_PER_PIXEL` (0.01) |
| `scaled` | false until a scale command sets the scale |

Invariant I16 (`underlayViolations` in `packages/domain/src/underlay.ts`) checks these and that the row covers a finite, non-empty box; it never decodes the data. `underlayRect(doc)` is the one conversion from the row to a plan box: top-left at `at`, `width × metresPerPixel` wide, `height × metresPerPixel` tall, downward.

## Commands

In `packages/domain/src/commands/underlay.ts`. Each depends only on `underlays/underlay`, so it never conflicts with drawing edits, and each is one undoable edit.

- `placeUnderlay { pictureId, data, width, height, at }` puts the row, replacing any picture, at 0.01 m per pixel, unscaled.
- `scaleUnderlay { a, b, distance }` makes plan points `a` and `b`, as points on the picture, lie `distance` metres apart, with `a` fixed: with `k = distance / |ab|`, the scale is multiplied by `k` and `at` moves to `a + (at − a) × k`. Refusals: "Underlay not found", "Invalid scale points", "Scale points must be apart", "Distance must be more than 0", "Scale out of range" (the box would not be finite and non-empty). The same scale again on a scaled row is no change.
- `removeUnderlay` deletes the row, or refuses "Underlay not found".

The generic delete refuses the table: "The underlay is removed with its own command".

## Import

The web importer (`packages/web/src/adapters/underlay-import.ts`) takes one file dropped on the canvas (the drop point is ignored) or picked with Choose picture…. An allow-list accepts PNG, JPEG, WebP and GIF; HEIC, SVG and PDF are refused. It decodes the file with its EXIF orientation, paints it on white (JPEG has no alpha) and encodes JPEG within a budget (`nextAttempt` in `packages/web/src/underlay-budget.ts`): long side fitted to 2000 px without upscaling, at quality 0.85, then 0.6, then the long side times 0.8 per attempt, giving up below 1000 px. The studio logo uses the same importer with its own budget ([export.md](export.md)).

The editor (`importUnderlay` in `packages/editor/src/underlay.ts`) places it with a new `pictureId`, its top-left at the view's top-left, and turns this viewer's Show on. If it is not then fully in view, the importing view frames it with a 48 px margin (`FRAME_MARGIN_PX`, `frameBox` in `camera.ts`). Remote puts, Undo and Redo never move a camera. With no drawing open an import does nothing; while the drawing can't be edited it toasts the blocked message. Refusals (`UNDERLAY_REFUSALS`):

| Reason | Toast |
|---|---|
| `unsupported` | Not a picture: use a PNG, JPEG, WebP or GIF (export a PDF page as an image) |
| `unreadable` | Couldn't read this picture: use a PNG, JPEG, WebP or GIF |
| `tooLarge` | This picture is too detailed to fit: crop it or use a smaller PNG, JPEG, WebP or GIF |

## The Scale tool

The Scale tool (`packages/editor/src/tools/scale-tool.ts`) is picked only from the Underlay section: no key, no floating-bar button. It is floor only (`SCALE_TOOL` in `tool-table.ts`; [levels.md](levels.md)).

```
 idle ──press A──► second ──press B──► typing ──Enter──► scaleUnderlay ──► Select
```

- Presses use the raw pointer, never snapped. With no picture every press is ignored ("Choose a picture first"), and so is a press while typing or a second press within 4 px (`DRAG_THRESHOLD_PX`) of A.
- The distance is a typed length ([typed-input.md](typed-input.md)). An empty Enter does nothing. An unreadable value, 0 or less ("Type a distance in metres"), or a refused command toasts and keeps A, B and the value. An accepted scale, or one that changes nothing, returns to Select.
- Esc drops both points; with none placed it picks Select.
- The overlay is a dashed 1 px line from A to the cursor, then to B, with a 3 px disc at each point.
- A remote write to the row, a snapshot or a lost connection cancels a half-done scale with a toast. A local import or Remove drops it quietly.

## Properties

With nothing selected, Properties shows an **Underlay** section (`underlaySection` in `packages/editor/src/underlay.ts`, `UnderlaySection.tsx`).

| Control | Does | Off when |
|---|---|---|
| Choose picture… | opens the file picker | the drawing can't be edited |
| Scale | picks the Scale tool | can't be edited, or no picture |
| Remove | `removeUnderlay` | can't be edited, or no picture |
| Fade | 0 to 1, step 0.05; 0 full strength, 1 gone; starts at 0.5 | no picture |
| Show / Hide | toggles the picture | no picture |

Under it, the hint "Use a straight scan or screenshot; for a paper plan, your phone's document scanner straightens it", and under WebGL or WebGPU, "The underlay shows with Canvas2D". Fade and Show/Hide live in this viewer's `underlayView` for the session: never synced or undone. The view model never carries the picture's data.

## How it draws

The scene's `underlay` (`SceneUnderlay { pictureId, data, rect, fade }`, `packages/editor/src/view/scene.ts`) comes from the visible document, never a gesture's preview, and is null with no row or while hidden. Canvas2D (`drawScene` in `canvas2d-renderer.ts`) draws it once decoded, after the background and before the layers, stretched to its rect at alpha 1 − fade. WebGL2 and WebGPU leave it out ([rendering.md](rendering.md)).

The picture takes no input: clicks, box selection and Delete act on the drawing, and snapping ignores its corners. While this viewer shows it, the Auto snap step is 0.01 m (`TRACING_STEP` in `packages/editor/src/snapping/snap.ts`; [tools.md](tools.md)). Exports never draw it ([export.md](export.md)).

## Tracing with Claude

`get_drawing` lists `underlay: { bounds, metresPerPixel, scaled }` or null (`packages/mcp/src/drawing.ts`). `look`'s plan view (`lookPicture` in `packages/editor/src/view/look.ts`) draws the underlay as a grey backdrop at fade 0.5 (`LOOK_FADE`) under the drawing and metre rulers. Its default region is the underlay's rect plus 4 % of its long side on each side, else the drawing. While the row is unscaled the caption starts with `UNSCALED · `. No reply carries the picture's data.

`scale_underlay { a, b, distance }` runs `scaleUnderlay` (`packages/mcp/src/look-tools.ts`); `a` stays fixed and walls never move. A second call scales again, so the tool is annotated "rescale".

`look`'s description (`packages/mcp/src/server.ts`) teaches the loop: look at the whole plan; while UNSCALED, look at about 1 m around each end of the longest printed dimension, read them off the rulers and call `scale_underlay`; check a second printed dimension and, over 2 % off, ask the person to use the Scale tool; trace the outer shell, then inner walls, doors, windows and room names, looking after each batch. Furniture on the plan is left out: layouts are the person's.

`pnpm --filter @fm/mcp run ground-truth compare <name> --underlay` (`packages/mcp/scripts/compare-trace.ts`) scores a trace against the ground-truth project. It moves the trace by the offset from the row's `at` to the truth's top-left, never fitted, and passes when the room names match and every outer truth wall lies within 0.10 m of a traced wall. No claim is made about how well Claude traces other pictures.

## Limits

- One picture per project, of the four types above. No rotation, perspective correction or cropping.
- Canvas2D only; never in exports, nor in a project card's drawing ([cards.md](cards.md)).
- Import is asynchronous: of two quick drops the one finishing last wins, and one finishing after a project switch lands in the drawing open then.
- The underlay draws at every level ([levels.md](levels.md)); `look` draws the floor level.
