# Tools and input

Keys, the pointer, the tools other than Wall, gestures, selection, snapping, the nudge, duplicating, dimensions, quick add. The Wall tool: [wall-editing.md](wall-editing.md); typed values: [typed-input.md](typed-input.md); toasts: [warnings.md](warnings.md).

## Global input

`onKey` (`packages/editor/src/keys.ts`) precedence: (1) the open value field, if the tool holds one; (2) a tool's key; (3) the global keys. While a value is typed or walls are dragged, a chord with Ctrl or Cmd skips the value field, so Cmd+Z still undoes. Modifier-only keys are ignored. `Space` never pans. With the sheets view over the plan, only `Esc` (which closes it), undo and redo get through.

| Input | Action |
|---|---|
| a tool's key (table below) | picks that tool (`pickTool` in `packages/editor/src/levels.ts`); never with Ctrl, Cmd or Alt |
| `Esc` | see "What Escape does" |
| `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` | undo, redo. One that applies drops the gesture in progress, keeps the tool and replays the pointer; a refused one only toasts. During a nudge run or with a duplicate's ghost up, cancels it and does nothing else |
| `Delete`, `Backspace` | deletes the selection: Select tool idle, or a selected zone or named area in the Zone tool |
| arrows, `Shift`+arrows | the nudge |
| `Cmd/Ctrl+D` | duplicate as a ghost |
| `R` | turns 90° counter-clockwise: the Object tool's ghost, a piece or furniture group being dragged (the drop lands turned, one undo step), a duplicate's ghost, else the idle selection (a group about its bounding box's centre). A selection with walls toasts "Walls don't turn" |
| `Page Up`, `Page Down` | the next level up or down ([levels.md](levels.md)) |
| `3`, `Shift+3`, `[`, `]` | the 3D view ([view3d.md](view3d.md)) |
| middle-button drag | pans |
| wheel, trackpad scroll | pans; with Ctrl or Cmd, or a pinch, zooms at the cursor (`wheelCamera` in `packages/editor/src/update.ts`) |
| right button, or Ctrl-click with no drag | the list of what's under the pointer |
| `Shift` held | keeps an axis (horizontal or vertical through the origin, or a drag's larger axis); in Select, toggles group members |
| `Ctrl` held | no snap, guide or wall contact; the rotation grip turns by whole degrees |

### What Escape does

The first that applies: close the list under the pointer; close an open finish row; the tool's escape. Select cancels its gesture (a typed distance first) and, idle, clears the selection. Dimension and Section step back a point; Deck, Hole and Zone drop a press; Scale drops both points; Object sends a stair's fixed top back to hovering ([stairs.md](stairs.md)); with nothing to drop, each picks Select. A cancelled gesture commits nothing.

## The tools

`TOOLS` in `packages/editor/src/tools/tool-table.ts` lists them in the floating bar's order with their keys.

| Tool | Key | What it does |
|---|---|---|
| Select | `V` | selects, drags, resizes and turns; the rest of this document |
| Zone | `Z` | a click selects a room's zone, labelling it first if needed; a drag of 0.30 m or more both ways draws a named area ([walls-rooms.md](walls-rooms.md)); Floor mode lays a finish ([finishes.md](finishes.md)) |
| Object | `O` | places the armed kind as a ghost ([furniture.md](furniture.md)); a stair kind draws from a deck edge ([stairs.md](stairs.md)) |
| Opening | `D` | previews the armed kind on the wall under the pointer, red where it won't fit; a click adds it ([openings.md](openings.md)) |
| Dimension | `M` | three clicks place a dimension (below) |
| Section | `S` | three clicks place a section cut, then Select; picking it turns section marks on ([sections.md](sections.md)) |
| Column | `C` | a ghost column on the pointer; a click places and selects it ([walls-rooms.md](walls-rooms.md)) |
| Deck | `K` | draws a deck ([heights-decks.md](heights-decks.md)) |
| Hole | `H` | cuts a hole in a deck ([heights-decks.md](heights-decks.md)) |
| Scale | none | the Scale button in Properties' Underlay section; two raw clicks and a typed distance ([underlay.md](underlay.md)) |

After a placement Section, a named area and Scale go back to Select; the others stay armed. The Deck and Hole tools' clicks, drags and refusals: [heights-decks.md](heights-decks.md).

## Gestures: preview and commit

A gesture shows its result before it commits. Each move runs the command on the document the gesture started from, and the preview is that result. The release runs the last attempt's command again with a fresh `execute`, whatever the release position and modifiers, so what commits is what the preview showed.

```
press on a target ── release within 4 px ──► a click (selection)
      └─ past 4 px: moving { baseDoc, attempt }
           each move: attempt = execute(baseDoc, command at the snapped pointer)
               ok      → preview = attempt.doc
               refused → last valid preview, the refused place drawn red
           release: the last attempt's command (one changeset, one undo step);
                    refused: nothing sent, the reason toasts
           Esc: idle, nothing sent
```

- `DRAG_THRESHOLD_PX` = 4 (`packages/editor/src/tools/hit-test.ts`), as world distance × zoom: a scroll under a still press can start a drag.
- No drag starts while an edit is in flight (`canCommit`); a box still does, as it commits nothing.

### What ends a gesture

The general rule is in `packages/editor/src/gestures.ts`.

- **`onRemoteChange`.** A remote change that changes topology, or writes one of the gesture's dependencies, cancels it with `GESTURE_CANCELLED`, "Drawing changed remotely". Any other remote change reruns the gesture with the same parameters on the new visible document, red where it stops fitting.
- A drag's dependencies are those `execute` returned for its last valid command, the zero move's until one succeeds. A surviving nudge run reruns its last valid offset, or falls back to no move, drawn red. A duplicate's ghost depends on its sources.
- A press and a box survive remote changes (a box reads the document at its release), as do the other tools' half-made gestures, redrawn on the next move; Scale cancels when the underlay row is written.
- **`cancelGestures`.** A snapshot or a lost connection cancels every active gesture but a press and a box within 4 px, with `CONNECTION_LOST` offline, else `GESTURE_CANCELLED` (`CHAIN_ENDED` for a wall chain).
- A rejection of the user's own change ends a chain piece being typed and a half-done scale. A level change (`dropGesture`, [levels.md](levels.md)) or an applied undo or redo drops the gesture, no toast.

## Selection

A selection is one entity, or a group of walls and pieces of the active layout. Joints, openings, rooms, named areas, dimensions, sections, decks, holes and columns are selected alone. Walls in groups: [wall-editing.md](wall-editing.md).

The Select press (`pressSelection` in `packages/editor/src/tools/press-selection.ts`):

- A press on an unselected wall, joint, opening or piece selects it at once, so it can drag it.
- `Shift` toggles a piece or a wall: a `Shift` press adds it at once (so a `Shift` drag moves the group), a `Shift` click on a selected one takes it out.
- A plain press on a group member keeps the group for a drag; a click leaves that piece alone selected.
- A click on a selected wall's joint handle selects that joint.
- **Box.** A press on empty canvas, a room's floor or tag, or a deck, hole or named area not selected alone, clears the selection at once (`Shift` keeps it). A release within 4 px selects that thing alone, even with `Shift`, or nothing on empty canvas. Past 4 px it draws a box, whose release selects the active layout's pieces and the walls lying wholly inside (`placementsInBox` in `packages/editor/src/tools/box-select.ts`; touching an edge counts). `Shift` adds them to a selection of walls and furniture.

### The hit list and click cycling

`hitTest` in `packages/editor/src/tools/hit-test.ts` picks what a press reaches, among what the viewed level can select (`selectableAt`, [levels.md](levels.md)). The Select tool tries a wall's helper plates and a hole's gap plates before it. Then, in order:

1. handles of the selection, within `HANDLE_HIT_PX` = 8: first a wall's joints, a piece's side, rotation and arm grips, the side grips of a deck, hole or named area, a section's end and far grips; then a piece's zone handles; then its zone chips;
2. joints, within `HIT_TOLERANCE_PX` = 6;
3. placed dimensions: the nearest line within the tolerance, or a press inside its text (lower ID on a tie);
4. openings;
5. walls; in the tolerance band outside a wall's body, a piece whose shape holds the point wins;
6. section marks, then a named area's tag;
7. pieces of the active layout, then a hole under them;
8. room tags, the selected named area's body, a hole, a deck, a labelled floor.

**An opening's hit area** is its span along its wall, and across, the wall body's half thickness plus the hit tolerance; it wins over its wall. Openings stacked on one stretch of wall share the point: the selected one stays the hit so a press can drag it, else the lowest by sill; a click on the selected one selects the next one up, and round.

**Pieces** under the pointer are in click order: by bottom, lowest first, then by ID; seats and rugs later ([seating.md](seating.md)). A click on the one selected piece where others lie under it selects the next one, then the hole under them if any, then the first piece again.

**Holes and their deck.** A hole is reached only where no deck stands at the point: at the floor no deck at all, at an upper level none of the level's decks. So a click in a hole reaches the hole, never its deck; the deck is reached on its slab, and a deck standing in the hole (a platform, a stair's landing) takes the click there. A selected hole holds a press under pieces, so it can be dragged; a click on it with pieces over it goes back to the first piece. A press on a hole or deck not selected alone acts as floor: a click selects it, a drag draws a box.

### What's under the pointer

The right button, or a Ctrl-click that never became a drag, opens a list at the pointer on release, with the Select tool idle (`opensList` in `packages/editor/src/pointer.ts`). It lists `everythingAt`: what a click cycle reaches there, top first, joints left out. A click on a row selects it; `Esc`, the wheel or a press on the canvas closes it.

## Snapping

Wall points, joint drags and the Dimension tool use `snapPoint` (`packages/editor/src/snapping/snap.ts`). Policies return candidates; `choose` (`chooser.ts`) takes, within the tolerance, the lowest priority, then the smallest distance, then x, then y.

Priorities, best first: endpoint (joints), midpoint (wall midpoints), perpendicular (the foot of the Wall tool's origin on a wall), on wall, angle (rays every 15° from the origin, at whole steps), aligned (another joint's x and/or y, with a thin guide line), grid (the snap step: the fallback, outside the tolerance).

- The tolerance is `tolerancePx` = 10 px on screen. `Shift` projects the cursor on the horizontal or vertical through the origin first, and then only that axis's own coordinate aligns. `Ctrl` keeps the cursor.
- Where a joint's x or y line crosses the angle ray near the cursor, the point is that crossing. Near-square and equal lengths: [wall-editing.md](wall-editing.md).
- The Dimension tool passes `DIMENSION_POLICIES` (`dimension-policies.ts`): face corners, joints, the foot of A on a wall face, points on a face, angle steps, the grid.

**The snap step.** `snapStep` gives the step every snapped move rounds to. The floating bar offers Auto or a fixed 1, 5, 10, 25 or 50 cm (`SNAP_STEPS` in `packages/editor/src/types.ts`, the UI action `setSnapStep`). Auto is the smallest of 1, 2, 5 × 10ⁿ m, from 1 cm to 10 m, at least 16 px on screen (`gridSpacingFor`); while the drawing has a plan picture that this viewer shows, Auto is 1 cm (`TRACING_STEP`).

**Furniture gestures** use `pickSnap` (`picker.ts`): each lists targets with their own tolerance; the nearest in range wins, a tie to the first listed, else the snap step; `Ctrl` gives the free value.

| Gesture | Targets (tolerance) | No target | `Ctrl` |
|---|---|---|---|
| move a piece, a group or a duplicate's ghost | guides (10 px) | the delta on the step | the raw delta |
| side grip | wall faces, then other pieces' faces (10 px) | the movement on the step | the cursor |
| rotation grip | each wall within 0.15 m: its angle plus 0, 90, 180 or 270° (3°) | the nearest 15° | the nearest whole degree |

A side grip keeps the size to the millimetre and within 0.02 to 10 m (`MIN_OBJECT_SIZE`, `MAX_OBJECT_SIZE`; `resizeTo` in `resize.ts`). A single piece being moved, placed or carried as a ghost takes wall contact first ([furniture.md](furniture.md)), and a seat the tuck snap ([seating.md](seating.md)). A group takes no wall contact and no touch to turn.

### Guides

On each screen axis, the moving box's two edges and centre line are matched against those of the other pieces of the active layout that the level draws (`guideBoxes` in `guides.ts`; rugs don't count). A group uses its footprints' bounding box and never aligns to its own pieces. A piece at an odd angle offers its centre lines only. A thin line runs through each moved line within 2 mm (`ALIGN_EPS`) of another piece's line. There are no guides to walls. None while refused. A nudge run draws the guides its preview lands on but never snaps to them.

### Live distances

While pieces are moved, resized or nudged, or a duplicate's ghost fits, up to four lines in whole centimetres run from the piece's sides (a group's box) to the nearest wall face or piece (`liveDistances` in `packages/editor/src/view/distances.ts`); none under half a centimetre.

## The nudge

In the Select tool, with the selection all furniture of the active layout, one column, one hole or one deck, an arrow moves it 1 cm and `Shift`+arrow 10 cm along the world axes, whatever the zoom and the snap step. With walls selected: "Arrow keys move furniture only". The presses form one run (`nudge.ts`):

- Each press previews at once; a refused offset keeps the last valid one, drawn red. The run commits its last valid offset, one undo step, 400 ms (`NUDGE_MS`) after the last press, or after an edit in flight settles.
- `Esc`, `Cmd/Ctrl+Z`, Undo and Redo cancel it, nothing sent. A press (but the middle button), a key other than an arrow or a modifier, a UI action or a command commits it first, then runs. No run starts while an edit is in flight.

## Duplicate as a cursor ghost

In the Select tool, `Cmd/Ctrl+D` or Properties' Duplicate picks up see-through copies of the selected furniture of the active layout as one ghost (`copying`, `packages/editor/src/duplicate.ts`). Nothing enters the document until a click, and the ghost is never sent.

- **Start.** Centred on the cursor (a group by its box's centre), or over the originals with no pointer on the canvas. The originals stay selected. While an edit is in flight the key toasts.
- **Move and turn.** It moves as a drag of the same pieces, with the step, contact and guides; the originals count as other furniture. `R` turns it 90° counter-clockwise.
- **Click.** One `duplicatePlacements`, the copies selected, one undo step. Refused: the reason toasts and the ghost stays. Where it won't fit, it and every piece it would hit are drawn red.
- **Gate** (`ghostGate`). A second duplicate is ignored. Any other UI action or command, a tool or a layout switch included, drops the ghost, then runs. `Esc` drops it. During a nudge run, a duplicate commits the run first.

## Dimensions

A placed dimension measures the straight distance between two points, in every layout, and follows the wall corners it is anchored to.

```
dimensions: Record<DimensionId, { id, a: DimensionEnd, b: DimensionEnd, offset }>
DimensionEnd = { joint, tx, ty }   anchored: unit direction from the joint to its corner, (0, 0) the centre
             | { x, y }            free
```

- `offset` is signed metres along the left normal of a → b.
- **Anchors** (`packages/domain/src/queries/dimensions.ts`). `faceCorners(doc)` lists where wall faces meet at joints. `dimensionEnd` anchors a point within 1 mm (`ANCHOR_TOLERANCE`) of a face corner or a joint centre to that joint, the nearest first; any other point is free. `dimensionPoints` works out the measured points each time: the face corner at the joint whose direction is closest to `(tx, ty)`, or the joint centre. Moving walls move it with no write.
- **I15.** Anchored ends' joints exist, numbers are finite, `(tx, ty)` has length 0 or 1, the offset is within ±1000 m (`MAX_DIMENSION_OFFSET`). Its toast: "A dimension needs this corner".
- **Commands.** `addDimension { opId, a, b, offset }` makes `${opId}/m0`; ends under 1 cm apart (`MIN_DIMENSION`) are refused, "Dimension too short". It is not an invariant: a corner move is never refused. `setDimensionOffset { id, offset }` changes only the offset: ends are fixed once placed. `deleteEntities` removes a dimension, and every dimension anchored to a joint it deletes.
- **The tool.** Three clicks: A, B, then the offset, the pointer's signed distance from A → B rounded to the snap step (`Ctrl` keeps the rounding). A press under 1 cm from A is ignored. The preview is the dimension itself with its value. A refused add keeps A and B.
- **Selected.** Dragging its line or text sets the offset (`Ctrl`: to the millimetre), one `setDimensionOffset` per drag. Arrows, `R` and `Cmd/Ctrl+D` ignore it. Properties shows a read-only Length.
- **Look** (`dimensionLayout` in `packages/editor/src/view/dimension-layout.ts`): metres, two decimals, no unit ("3.65").

## Quick add

A search field at the top of the furniture palette (`packages/web/src/panels/QuickAdd.tsx`, `quick-add.ts`) finds a kind or a set and arms the Object tool with it. `/`, Ctrl+K or ⌘K focuses it, unless a panel field or a typed value has the keys (`isQuickAddShortcut`); the editor's key map gives them no meaning. At most 8 rows show (`QUICK_ADD_ROWS`). Enter or a click sends `pickKind`, plus `pickPreset` for a preset row (`pickSet` for a set), and the field lets go of the focus.

**Matching** (`searchPalette` in `packages/editor/src/view/palette-search.ts`, pure). Case, accents and apostrophes are ignored, "160x200" is two numbers, every word must match in any order, and rows sort by their weakest word's tier, then palette order. Tiers, best first: the label's start, an alias, a preset's size in cm or label, the word inside a label or alias word (3+ characters), one typo from one (5+ characters; two typos from 9). At each tier a label beats an alias. Numbers match only preset sizes. Aliases are English synonyms per kind in `palette-aliases.ts`.

## Limits

- Quick add: no palette at the cursor, no recent items, no search over tools, openings or commands.
- Dimensions: no chained, baseline or angular ones, none to furniture or per layout, no moving an end, no typed or driving values. A free end goes stale when its face moves.

## At levels

Which tools work at an upper level and what each level can select: [levels.md](levels.md). Specific here:

- Dimensions are floor only: the Dimension tool is `floorOnly`, and a placed dimension is selectable only at the floor.
- The hit list, a box and the list under the pointer offer only what the viewed level can select: at a loft, a click over the partition under it reaches the loft.
