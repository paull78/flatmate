# Editor

The editor package (`@fm/editor`, `packages/editor/src`) is how a person edits a drawing: events in, effects out, as plain data. Packages and dependency rules: [../architecture.md](../architecture.md). Tools and selection: [tools.md](tools.md); typed values: [typed-input.md](typed-input.md); refusals: [warnings.md](warnings.md); renderers: [rendering.md](rendering.md); collaboration: [collaboration.md](collaboration.md).

## The core loop

```ts
update(state: EditorState, event: Event, host: Host): { state: EditorState; effects: Effect[] }
```

`update` in `update.ts` is synchronous and pure given the `Host`: no promises, no DOM, no network. Every handler returns a `Step` (`{ state, effects }`, in `state.ts`), and `update` appends exactly one `render` effect to every call.

```
Event ──► update: gates ─► route ─► after ─► { state', [...effects, render] }
                             └─ runCommand ─► execute ─► commit
shell runs the effects; their results return as Events
```

1. Gates. A nudge run (`beforeEvent` in `tools/nudge.ts`), then a duplicate's ghost (`ghostGate` in `duplicate.ts`), may keep, end or swallow the event.
2. Route. A switch on `event.type` sends it to its handler; `assertNever` closes the switch.
3. After. The refusal plate is raised or cleared (`withPlate` in `plate.ts`); a document change ends a running flip; a change of active layout drops the selected furniture and a half-placed dimension; `settleLevel` (`levels.ts`) keeps the viewed level valid; the section strip follows the selection (`stripAfter`); a new selection closes an open finish row (`closeFinishOnSelection`); a change of active layout or level sends presence.
4. Render. `buildScene(state)` and `buildViewModel(state, host)` build the `render` effect from the final state.

The document changes only through `runCommand` in `commit.ts`: domain `execute`, then commit, history and notices. A document that can't take an edit only toasts `blockedMessage`; a refused command changes nothing ([warnings.md](warnings.md)); a patch that writes nothing commits nothing. An own edit that raises the warnings count in view adds 1 to `warningBlink`, the shell's cue to blink. `placeNote` toasts when an edit lands in one layout only ([layouts.md](layouts.md)). Undo and redo go through `runHistory` in the same file ([collaboration.md](collaboration.md)). Commands themselves are in [domain.md](domain.md).

## Ports

| Shape | Where | Use |
|---|---|---|
| Sync query | `Host` in `ports/host.ts`, passed to every `update` | an answer needed inside `update` |
| Async action | `Effect` in `ports/effects.ts`, returned as data | the shell does it; a result returns later as an `Event` |

| `Host` method | Returns |
|---|---|
| `now()` | a monotonic clock in ms, for timers, frames and toasts; not a calendar |
| `today()` | the local date as `YYYY-MM-DD`, for an export's date of issue |
| `newId()` | a fresh ID |

Text widths are not a query: the core measures text with its own tables ([rendering.md](rendering.md)). A platform object stays an opaque handle (`ImageHandle`, `unknown`) the core never reads. A new port takes one of the two shapes: a sync `Host` method, or an effect with a request ID answered by an event.

`ports/wire.ts` maps server messages to events (`serverMessageEvent`) and server effects to messages (`clientMessageFor`) for every shell.

## Events

`Event` in `ports/events.ts`:

| Group | Events |
|---|---|
| Pointer and keys | `pointerDown`, `pointerMove`, `pointerUp` (screen point, `mods`, button 0, 1 or 2), `pointerLeave`, `wheel`, `key` |
| Panels | `ui` with a `UiAction` |
| Time | `timerFired`, `frame` |
| Projects and server | `workspaceEvent` (`projects`, `created`, `drawing`, `failed`), `serverEvent` (`welcome`, `snapshot`, `openFailed`, `projectDeleted`, `changes`, `ack`, `rejected`, `presence`, `presenceLeft`, `connection`) |
| Shell answers | `rasterised`, `saveResult` (ignored), `viewportResized` |
| Shells with no pointer | `pointAt` (a world point; moves the cursor for presence only, no hover or tool), `command` (a domain `Command`, run through `runCommand`) |

Pointer events carry screen coordinates only. The editor owns the camera and turns them into world points (`screenToWorld` in `camera.ts`). A `wheel` with Ctrl or Meta zooms at the cursor by `exp(-deltaY × 0.01)`; any other wheel pans. A `timerFired` with an unknown ID is ignored. A `frame` drives a project card's change of layout while one runs, else the layout flip.

`UiAction` is what panels send; tests send the same.

| Group | Actions |
|---|---|
| Projects and cards | `createProject`, `openProject`, `deleteProject`, `showProjectList`, `cardSeen`, `cardHover`, `setCardOrder`, `cardNextLayout`, `cardOrbit` |
| Tools and their settings | `pickTool`, `pickKind`, `pickSet`, `pickPreset`, `setArmedSize`, `pickOpeningKind`, `pickDeckPreset`, `pickMotif`, `setWallThickness`, `setColumnSize`, `setSnapStep`, `chipHover`, `chipClick` |
| Selection and Properties | `selectEntity`, `pickUnderPointer`, `hoverUnderPointer`, `closeUnderPointer`, `selectHole`, `hoverHole`, `setField`, `toggleFinish`, `deleteSelection`, `duplicate`, `breakApart`, `split`, `undo`, `redo` |
| Layouts and levels | `setActiveState`, `addState`, `renameState`, `deleteState`, `setViewedLevel` |
| Viewer switches | `setFinishesOn`, `setUnderlayFade`, `toggleUnderlay` |
| Underlay and logo | `importUnderlay`, `removeUnderlay`, `importLogo`, `removeLogo` |
| 3D panel | `toggle3d`, `toggleRoof3d`, `set3dSize`, `turn3d`, `orbit3d`, `reset3d` |
| Section strip and dock | `showSection`, `closeSection`, `setSectionMarks`, `setDockHeight`, `resetDockHeight`, `toggleLargerDock`, `setDockShare`, `swapFrames` |
| Export and sheets | `openExport`, `closeExport`, `setExport`, `download`, `setSheetSetting`, `selectSheet`, `addSheet`, `addMissingSheet`, `addMissingSection`, `duplicateSheet`, `deleteSheet`, `moveSheet`, `tickSheet`, `tickAllSheets`, `setSheet`, `renameSheet`, `setSheetDrawing`, `setSheetSection`, `toggleSheetPane`, `frameSheet`, `typeReport`, `leaveReport`, `openSheet` |

Typed values arrive as text (`setField`, `setWallThickness`, `setArmedSize`, `setColumnSize`); the editor reads and checks them.

## Effects

| Effect | Asks the shell to | Answer |
|---|---|---|
| `render` | draw `scene` with `camera`, show `view`, draw `view3d` (null while the 3D panel is closed) | none |
| `workspace` | run a `WorkspaceOp`: `list`, `create`, `delete`, `open`, `read` | `workspaceEvent`, `serverEvent` |
| `submit` | send a shared document's changeset | `serverEvent` |
| `presence` | send this user's cursor, selection, layout and level | none |
| `startTimer`, `cancelTimer` | start or cancel a timer by ID | `timerFired` |
| `requestFrame` | send one animation frame | `frame` |
| `saveFile` | download `ExportContent` (`svg`, `pdf` or `image`) | none |
| `rasterise` | draw an `ExportPage` to an image of a pixel size | `rasterised` |
| `saveSnapshot` | declared for a local-folder workspace; never emitted | `saveResult` |

The timers are `toast` (`TOAST_MS`, 6000 ms, `toast.ts`), `rest` (`REST_MS`, 150 ms, `plate.ts`) and `nudge` (400 ms).

## Editor state

`EditorState` in `state.ts` is one immutable value, built by `initialState(opts, host)`.

| Group | Fields |
|---|---|
| Document | `mode` (`"local"` or `"server"`), `document` (`OpenDocument`, null on the project list), `undo` |
| Tool and pointer | `tool` (`ToolState`, one variant per tool), `selection`, `hover`, `hoverHandle`, `underPointer` (the right-click list), `pointer`, `panDrag`, `snap` |
| View | `camera`, `activeState`, `viewedDeck`, `flip`, `view3d`, `stripSection`, `frames` |
| Tool settings | `wallThickness`, `snapSettings`, `objectKind`, `objectSet`, `armed`, `sizeDraft`, `openingKind`, `deckPreset`, `columnSize` |
| Viewer switches | `underlayView`, `finishesOn`, `sectionMarksOn`, `openFinish` |
| Feedback | `toast`, `plate`, `refused`, `warningBlink` |
| Export | `exportOpen`, `selectedSheet`, `reportDrafts`, `exportChoices`, `exportPending` |
| Session | `workspace` (projects, order, loading, error, the project opening, the cards), `presence` (others, by client ID), `me` |

- `selection` holds one entity, or one or more placements of the active layout.
- The view, tool settings, viewer switches, feedback and export fields are this viewer's: never an edit, never saved with the drawing, never undone. `presence` holds the other users' cursors and selections; `workspace.order` is kept by the shell across sessions.
- `activeState` and `viewedDeck` are preferences resolved on each read: `activeStateId` falls back to the first layout, `viewedLevel` to the floor.
- `pruneSelection` drops from the selection, hover and right-click list any entity that is gone or that the viewed level can't select.
- `switchTool` drops a gesture in progress, the snap, the hover, `hoverHandle` and `underPointer`. It clears the selection only when the new tool is not Select and differs from the current one.

`initialState` starts with the Select tool, the camera on (3, 2) at 80 px per metre (`DEFAULT_ZOOM`; zoom stays within `MIN_ZOOM` 5 and `MAX_ZOOM` 2000), a 10 px snap tolerance, the snap step `"auto"`, the underlay at fade 0.5 and shown, finishes and section marks on, and a grey `me` colour until the server assigns one. Local mode opens one unsaved document, "Untitled"; server mode opens on the project list.

## The scene

`buildScene` in `view/scene.ts` returns what to draw, in world coordinates (metres, y up), as ordered layers (types in `view/scene-types.ts`):

```ts
type Scene = { layers: Layer[]; underlay: SceneUnderlay | null };
type Layer = { name: LayerName; primitives: readonly Primitive[] };
```

| Primitive | Fields |
|---|---|
| `segment` | `a`, `b`, `width`, `color`, `cap` (`butt`, `round`), `dash?` |
| `polygon` | `points`, `holes` (cut out even-odd, `[]` when none), `color` |
| `arc` | `center`, `radius` (metres), `from`, `to`, `width`, `color` |
| `disc` | `center`, `radius` (a `Width`), `color` |
| `text` | `text`, `at`, `size` (px), `color`, `align`, `rotation`, `font`, `style?` |

`Width` is `{ px }` (constant on screen) or `{ m }` (scaled). `Color` is lowercase `#rrggbb` or `#rrggbbaa`. `Dash` is one on/off pair in drawing units. `Font` is `inter` on screen or `helvetica` on paper. Angles are world radians, counter-clockwise; text stands upright with a middle baseline.

`LAYER_ORDER` paints back to front: `grid`, `ghosts`, `finishes`, `zoneFills`, `deckFloors`, `decks`, `objects`, `overheads`, `warnings`, `walls`, `openings`, `deckLabels`, `tags`, `dimensions`, `marks`, `annotations`, `overlays`, `presence`. A scene has every layer, in that order.

- The document layers come from builders that remember their last call (`memoLast` in `view/memo.ts`): with the same inputs a layer is the same array as in the last scene, so a pan rebuilds none, except `finishes` and `deckFloors` (plain functions over memoised parts), `decks` while the Zone tool hovers a deck, and `objects` during a flip. `grid`, `annotations`, `overlays` and `presence` are built on every event.
- During a gesture the scene draws the gesture's preview document. A right-click row under the pointer draws as if selected.
- `underlay` (`pictureId`, `data`, `rect`, `fade`) is the plan picture under the grid, null with none or while this viewer hides it. It is not a layer, so exports never see it ([underlay.md](underlay.md)).

## The view model

`buildViewModel(state, host)` in `view/view-model.ts` says what the panels show, not how (types in `view/view-model-types.ts`).

| Group | Keys |
|---|---|
| Tool and canvas | `activeTool`, `tools`, `commandBar`, `typing`, `cursor`, `snap`, `gridStep`, `cut`, `snapStep`, `snapSteps` |
| Tool settings | `wallThickness`, `objectKind`, `sizePicker`, `sizeFields`, `openingKind`, `openingKinds`, `deckPreset`, `deckPresets`, `columnSize`, `columnSizes`, `palette`, `floors` |
| Properties | `properties`, `projectFields`, `ceiling`, `outside`, `trailer`, `rooms`, `underlay`, `logo`, `toolHelp`, `shortcuts` |
| Document and session | `project`, `projectList` (only with no document), `presence`, `toast`, `canUndo`, `canRedo`, `states`, `levels`, `warnings`, `underPointer` |
| Other views | `view3d`, `frames`, `sectionMarks`, `sectionStrip`, `export`, `sheetsView` |

- `properties` is `{ kind: "none" }`, a group with its `count`, or one entity's kind with its `fields`.
- A `Field` has `id`, `label`, `section` (its group in Properties), `value` as text, `unit` and `readOnly`; optional flags pick its control (`options`, `select`, `toggle`, `step`, `multiline`, `action`, `check`, …). A stepper sends `setField` with the value from `steppedValue`.
- `cursor` is one of ten CSS cursor names (`default`, `crosshair`, `move`, `grab`, the four resize arrows, …); which shows where is in [tools.md](tools.md).
- Shortcuts name keys neutrally (`Mod+Z`, `Delete`); the shell draws them for its platform.

## The shell

A shell holds the state, feeds events to `update` and runs the effects. It holds no rules: the editor decides what to show and what an input means.

The web shell (`packages/web/src`):
- `store.ts` holds the only mutable copy of the state. Events dispatched while effects run wait in a queue, in order; a throw in `update` empties it.
- `adapters/effect-runner.ts` runs effects in order: `render` to the plan renderer, the 3D panel and the panels (a new renderer gets the last scene at once, `setRenderer`); `workspace`, `submit` and `presence` to the WebSocket adapter in server mode; timers, frames, downloads and rasterising to theirs.
- `adapters/web-host.ts` is the `Host`: `performance.now()`, the local date, `crypto.randomUUID()`. `adapters/input.ts` turns DOM input into events.
- React panels render the view model and send `ui` events; they call the editor's pure helpers (`searchPalette`, `steppedValue`) and never change state. A button's mouse down commits a draft field's text first (`keepFocus`, `panels/keep-focus.ts`). An error boundary shows a throw during render as a page with Reload.

The other shells are Claude's MCP server, which sends `command` and `pointAt` ([mcp.md](mcp.md)), the tests' fake shell (`test/fake-shell.ts`, a manual clock) and the sync tests.

## Limits

- No local-folder workspace: `saveSnapshot` and `saveResult` are declared and have no sender; the web shell's runner and `update` ignore them.
