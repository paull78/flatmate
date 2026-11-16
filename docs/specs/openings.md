# Openings

Doors, windows, open passages and curtains: the data, the kinds, how an opening fits its wall along it and in height, swing zones, the Opening tool and Properties, the plan and 3D drawing of each kind, and a window's dressings. Openings sit on walls and are shared by every layout. They take part in no room, area or free-floor computation, and the plan draws them over the wall layer.

## Data

```ts
Opening = { id, wall, kind, offset, width, side: "left" | "right", hinge: "a" | "b",
            glazed: boolean, sill, head, sheer?: "glass" | "floor", shutterBox?: true }
```

- `Opening` is in `packages/domain/src/model.ts`. `offset` is metres from the wall's joint `a` to the opening's start, so moving the wall's joints carries the opening.
- `side` is the side of the a → b direction the opening opens to or hangs on. `hinge` is the span's end nearer joint `a` or `b`.
- `sill` and `head` are metres above the wall's bottom (the floor, or the top of the deck the wall stands on). `openingRange` in `packages/domain/src/queries/vertical.ts` gives the range above the floor. Every view reads it.
- A kind that ignores `side`, `hinge` or `glazed` keeps the stored value, so switching back restores it. `sheer` and `shutterBox` are absent when off, never stored empty.

Commands (`packages/domain/src/commands/openings.ts`), each result validated as a whole document:

- `addOpening`: a row `${opId}/d0`, with `wall`, `kind`, `offset` and optional `width`, `side`, `hinge`, `glazed`, `sill`, `head`, `sheer`, `shutterBox`. Defaults: the kind's width, side left, hinge `a`, not glazed, heights from `defaultOpeningHeights`. Refused on a column's row.
- `moveOpening`: sets `offset`.
- `setOpening`: sets any of kind, width, side, hinge, glazed, sill, head, sheer, shutterBox. `sheer: "none"` and `shutterBox: false` remove them.
- `removeOpening`: deletes the row.

Deleting a wall, or a joint with its walls, deletes their openings in the same patch (`deleteEntities`). A wall split inside an opening's reach is refused ("A wall can't end inside door d0"), and so is a column placed over one ("A column can't cover door d0"); openings past the cut move to the new fragment at the same place in the world (`carryOpenings`). An opening moved onto a wall running the other way flips its `side` and `hinge`, so it stays the same door (`rehost` in `packages/domain/src/commands/split-openings.ts`). Splits and joins are in [wall-editing.md](wall-editing.md); the wall chain that measures the gaps between openings, where a typed piece sends `setOpening` (width) or `moveOpening`, is in [walls-rooms.md](walls-rooms.md).

## Kinds

Every per-kind fact is a column of `OPENING_KINDS` in `packages/domain/src/opening-kinds.ts`. Only the plan's symbols and the 3D faces switch on the kind, for geometry; every other reader reads a column. `OPENING_KIND_IDS` gives the picker's order; the tool starts with `swing`.

| Kind | Label | Side label | Hinge label | Glass | Clearance | Width, default (m) |
|---|---|---|---|---|---|---|
| `swing` | Swing door | Side | Hinge | glazed | square | 0.50 to 2.00, 0.80 |
| `double` | Double door | Side | none | glazed | twoSquares | 0.80 to 2.40, 1.20 |
| `sliding` | Sliding door | Side | Parks at | glazed | none | 0.50 to 2.00, 0.80 |
| `pocket` | Pocket door | none | Pocket at | never | none | 0.50 to 1.20, 0.80 |
| `folding` | Folding door | Side | Stacks at | never | strip | 0.50 to 3.00, 0.90 |
| `slidingGlass` | Sliding glass door | none | none | always | none | 1.00 to 4.00, 2.40 |
| `window` | Fixed window | none | none | always | none | 0.30 to 3.00, 1.00 |
| `casement` | Casement window | Side | Hinge | always | none | 0.30 to 1.20, 0.60 |
| `twoLeaf` | Two-leaf window | Side | none | always | none | 0.60 to 2.40, 1.20 |
| `passage` | Open passage | none | none | never | none | 0.50 to 3.00, 0.90 |
| `curtain` | Curtain | Hangs on | none | never | none | 0.50 to 3.00, 0.80 |

The other columns:

- `group`: the first six rows are Doors, the three windows Windows, the passage and the curtain Doorways.
- `noun`, used in messages (`openingLabel`): "Door" for the Doors, "Window" for the Windows, "Opening" for the Doorways.
- `fromFloor`: true for every kind but the three windows. Such a kind has sill 0.
- `tool`: `add_window` for the three windows, `add_door` for the rest.
- `framed`: true for every kind but `passage` and `curtain`.
- `hingeAt`: `far` for `sliding` and `pocket`, whose leaf needs wall past the hinge end; `near` for the rest.
- `pocket`: true for `pocket` only. `dressings`: true for the three windows only.
- `walkThrough`: true for the Doors and the passage. Door steps read it: [surroundings.md](surroundings.md).
- `glass` "glazed" means by the stored `glazed` flag. `hasGlass(o)` answers for 3D panes and sections.

## Fit on a wall

Invariant `I12` (`openingViolations` in `packages/domain/src/validate-openings.ts`) is checked after every edit. Nothing is clamped: an edit that breaks it is refused, and so is lowering a wall or the ceiling under a head.

- Every opening is on an existing wall. A column's row holds none.
- Its reach lies within the wall: from 0 to the centre-line length. `wallReach` (`packages/domain/src/queries/openings.ts`) is the span, plus one width past the `hinge` end for a kind with `pocket`.
- Two openings on one wall whose reaches overlap along it must be apart in height (see Heights). Touching along the wall is allowed.

Messages name the opening: "Door d0 doesn't fit on wall w3", "Door d1 overlaps window d0 on wall w3", "Pocket door p needs 0.80 m of wall past its end". A width outside the kind's range is refused by label: "Sliding glass door width must be between 1.00 and 4.00 m". How refusals show is in [warnings.md](warnings.md).

`suggestOpening(doc, wall, point, kind)` gives what a click proposes: the kind's default width centred on the point's projection, shifted to stay within the wall; `side` from the side of the wall the point is on; `hinge` at the wall end nearer the point, or the other end for a `far` kind.

## Heights and sills

```
 a wall's elevation, its bottom at 0 (the floor, or its deck's top)
 ------------------------------------- top
        +---+  head <= top - 0.10        +-----+
        | W |                            |  W  |
        +---+  sill                      +-----+   0.10 m of wall between
        +---+  head                      +-----+   two stacked openings
        | D |                            |  W  |
 -------+---+---- bottom: a door's sill 0 +-----+
```

- `defaultOpeningHeights(fromFloor, wallHeight)`: 0 to 2.10 for a `fromFloor` kind, 0.90 to 2.10 for a window, the head dropped to 0.10 m (`HEAD_CLEAR`) under a lower wall's top.
- A drawing saved without heights reads each opening at these defaults on its wall (`fillOpeningHeights` in `packages/domain/src/serialize.ts`).
- Fit in height, to the millimetre: a `fromFloor` kind's sill is 0; a sill is never below the wall's bottom; the opening is at least 0.30 m tall (`MIN_OPENING_HEIGHT`); the head stays 0.10 m under the wall's top, and a shutter box needs 0.25 m of wall above the head. Under a sloped ceiling the top is the lowest over the opening's own span (`wallTopOver`). The refusal carries the values: "A door's head must be at least 0.10 m under its wall's top, at 2.15 m".
- Stacking: two openings whose reaches overlap along the wall keep 0.10 m of wall between the lower one's head and the upper one's sill, or 0.25 m (`SHUTTER_BOX.height`) when the lower one has a shutter box. A pocket fills its wall only up to its door's head, so a window may sit above it.
- `openingHeightsFor(o, kind, { sill?, height? })` is the one rule Properties, `setOpening` and Claude's tools share. A given sill keeps the opening's height; a given height keeps its sill. A kind switch within `fromFloor` kinds, or within windows, keeps both. A window becoming a `fromFloor` kind takes sill 0 and keeps its head. A `fromFloor` kind becoming a window keeps its head and takes sill 0.90; the result is refused when under 0.30 m tall.

## Swing zones

`swingZone(doc, openingId)` in `packages/domain/src/queries/clearance.ts` gives one rectangle per opening on its `side`, on the wall face, across the whole span. Its depth comes from the `clearance` column:

- `square`: the width. A swing door's square, one corner at the hinge.
- `twoSquares`: half the width. A double door's two half-width squares side by side, as one rectangle.
- `strip`: 0.15 m (`FOLD_DEPTH`), a folding door's strip.
- `none`: no zone.

A zone is a warning, never a refusal. `clearanceWarnings(doc, stateId)` reports a zone that overlaps a piece of the layout or a wall body other than its own wall; a column in a swing blocks it and is named as a column. Only a piece or wall whose height range reaches into the zone's band blocks it: from the surface the door's wall stands on to 1.20 m above it (`ZONE_CLEAR_ABOVE`). A rug blocks nothing. The warning's name is "Door's swing". The checks per layout are in [layouts.md](layouts.md).

A casement's and a two-leaf window's swing is drawn but not checked.

## The Opening tool

Key `D`, at every level (`packages/editor/src/tools/opening-tool.ts`).

- Hovering a wall the viewed level reaches previews the armed kind as `suggestOpening` places it, with the level's heights. The preview is red where the add would be refused, and the reason shows at the pointer.
- A click sends `addOpening` with the previewed values, never glazed. The kind stays armed across placements. A refused click toasts the reason.
- The floating bar shows one `KindPicker` button (`packages/web/src/panels/KindPicker.tsx`): the armed kind's icon and name, opening a list of the eleven kinds under their three group names. Picking a kind sends `pickOpeningKind`, which also selects the tool.
- There is no flip key while placing: side and hinge come from the pointer. Escape returns to Select.

With the Select tool:

- An opening wins a click over its wall; a joint wins over both. Openings stacked on one stretch share the point: a click picks the lowest the level can select, and a click on the selected one the next one up, round again.
- A drag slides the opening along its wall: the drag along the wall is rounded to the snap step (exact with Ctrl) and the offset kept to the centimetre. The drop sends `moveOpening`.
- Arrow keys do not move an opening. Delete removes it.

## Properties

`openingFields` in `packages/editor/src/properties/opening.ts` builds the panel from the kind's row; each change is one `setOpening` and one undo step.

- Opening: Kind (the same `KindPicker`).
- Size: Width; Sill (windows only); Height (head minus sill).
- Swing: the side under its row's label (Left or Right); the hinge under its row's label (Start or End); Glazed, where the row's glass is "glazed".
- Dressing, on kinds with `dressings`: Sheer curtain (None, Sill, Floor) and a Shutter box switch.

A field the row leaves out is hidden and its value stays stored. Switching kind with no width clamps the width into the new range about the same centre; the result is refused only if it does not fit its wall or meets another opening.

## On the plan

`openingsLayer` (`packages/editor/src/view/openings-layer.ts`) draws each opening the viewed level shows. The symbols are `openingPrimitives` in `view/opening-symbols.ts`, with parts and constants in `view/opening-parts.ts`.

Line weights (`PlanStyle.openingWeights`):

| Weight | Canvas | Paper | Mainly for |
|---|---|---|---|
| `frame` | 1.25 px | 0.25 mm | frames, leaves |
| `line` | 1 px | 0.18 mm | wall-face lines, glass, dashed boxes, jambs |
| `hair` | 0.75 px | 0.13 mm | arcs, the threshold, sash lines |

Two levels of detail. `openingsDetailed(style, zoom)` is true when a 0.06 m frame (`FRAME_M`) is `openingDetailFrom` wide in the picture's units: 4 px on the canvas (about 67 px per metre), 1 mm on paper (1:50, not 1:100). `look` and project cards always draw the simple level. Simple: a leaf is one line (two faces when glazed). Detailed: frames inside `width`, clamped to a thin wall's thickness (`jambOf`), leaves in outline 0.04 m thick (`LEAF_M`), a window's sash lines, and lever handles on a door's leaf. A leaf hangs at the same point at both levels. The glass line is blue on the canvas and ink on paper.

A `fromFloor` opening on a floor wall first shows its room's floor through its span and a threshold line (door spans: [finishes.md](finishes.md)). Then:

- **Swing door.** A leaf perpendicular to the wall from the hinge end and a quarter arc. The leaf hangs 0.04 m inside the span (`REBATE_M`, the frame's rebate), so its length is the width minus 0.08 m. A detailed frame is rebated at the opening side's face and 0.06 m wide behind it, through the wall's thickness.
- **Double door.** Two leaves of half the clear width, hung at both ends on the `side` face, each with its arc.
- **Sliding door.** The leaf along the `side` face across the span, and a dashed box the leaf's size past the `hinge` end on that face (`parkedBox`). The plan draws it no frames.
- **Pocket door.** Plain jambs with no stop; the jamb at the `hinge` end is split on the wall's axis by the slot. The leaf parks in the wall on its axis, one width past that end, as a dashed box.
- **Folding door.** An accordion folded at the `hinge` end inside the frame: one fold per 0.13 m of width, at least two, in a stack 0.10 + 0.11 x width long (`foldedLength`) and 0.15 m deep, centred on the `side` face (`foldCorners`). A dashed line runs across the rest of the span, where the door closes.
- **Sliding glass door.** Drawn closed, with a window's square frame blocks: two glazed sashes from inside each frame to 0.025 m past the middle, on tracks 0.02 m either side of the wall's axis.
- **Fixed window.** The span cleared, a line on each wall face and a glass line on the axis. Detailed: 0.06 m square frame blocks and two sash lines.
- **Casement and two-leaf window.** The fixed window plus one leaf at `hinge` (casement) or two half leaves, each with its arc, toward `side`. The leaves hang at the frame's face, half a frame off the wall's axis (`sashFace`).
- **Open passage.** Jamb lines and a dashed line along each wall face for the lintel above the cut.
- **Curtain.** Jamb lines and a wave across the whole span, 0.06 m off the `side` face (`CURTAIN_OFF`), 0.03 m in amplitude with a 0.10 m period (`curtainOffset`).

An opening wholly above the level's cut draws its span's outline across the solid wall, dashed, with no leaf, swing or glass (`openingAbove`).

## In 3D

`openingFaces` in `packages/editor/src/view3d/opening-faces.ts` lists what stands in each opening. Swing, double, sliding and folding doors stand open; the sliding glass door and the windows are closed. Each has one pose in every layout. An opening under 0.10 m tall is not drawn (`MIN_GAP` in `view3d/items.ts`). The 3D view's general rules are in [view3d.md](view3d.md); sections draw an opening as glass or a doorway by `hasGlass` ([sections.md](sections.md)).

- **Frames.** A `framed` kind has a block on both jambs and the head, a window also on its sill: 0.06 m, or the wall's thickness if thinner, as deep as the wall, inside the stored width and range. Spans are kept to the wall's clear span (`keptSpan`). Under 0.20 m of span or height (`MIN_FRAMED`) there is no frame or leaf, only a pane where the opening has glass.
- **Swing and double door.** Leaves 0.04 m thick, open at 90 degrees from the frame's rebate, on the `side` face, their top one frame under the head. A swing leaf is the span minus 0.08 m long; a double door has two of half that.
- **Sliding door.** The leaf parked in the plan's dashed box, the opening's full width and height.
- **Pocket door.** Frames only. **Open passage.** The hole only.
- **Folding door.** The plan's zigzag stood up as thin sheets from the bottom to one frame under the head, in the joinery's lit and shaded tones by turns.
- **Sliding glass door.** Two closed glass panels on the plan's tracks. **Fixed and casement window.** One pane. **Two-leaf window.** A middle post between two panes.
- **Curtain.** Pleats through the plan's wave, from 0.02 m above the bottom to a 0.04 m square rod at the head. The rod reaches 0.10 m past each jamb and stops at the wall's clear span.
- **Glazed leaf.** A frame one frame wide around a pane seen from both sides; solid where that leaves no room.
- A leaf belongs to its wall's faces, so it hides with that wall.

## Window dressings

A kind with `dressings` may carry a sheer curtain (`sheer`: "glass" hangs to the sill, "floor" to the wall's bottom) and a roller-shutter box (`shutterBox`). Another kind refuses them ("A door takes no sheer curtain or shutter box"), and switching a dressed window to such a kind drops them.

- They hang on the room side (`roomSideOf` in `packages/domain/src/queries/dressing.ts`): the face toward a room when the other side has none, else the opening's own `side`.
- `dressingOf(doc, openingId)` gives the box and the curtain to every view. The box is the window's width, 0.12 m deep (`SHUTTER_BOX.depth`), from the head to 0.25 m above it. The curtain hangs 0.06 m (`SHEER.off`) in front of the face, or of the box, from 0.05 m (`SHEER.rail`) above the head, or from the box's top.
- Plan: the box as a dashed outline, the curtain as a wavy line; the curtain is dashed too when its window is above the cut.
- 3D: the box as a joinery block; the curtain as cream strips 0.06 m wide with 0.04 m gaps, so the glass shows between them.

## Claude's tools

The tool list and replies are in [mcp.md](mcp.md). The opening tools (`packages/mcp/src/opening-tools.ts`):

- `add_door`: `wall`, `offset`, and optional `kind` (the `add_door` rows, `swing` by default), `width`, `side`, `hinge`, `glazed`, `height`.
- `add_window`: `wall`, `offset`, and optional `kind` (`window` by default, `casement`, `twoLeaf`), `width`, `side`, `hinge`, `sill`, `height`, `sheer` ("none", "glass", "floor"), `shutterBox`.
- `set_opening`: `opening`, and any of `offset`, `kind`, `width`, `side`, `hinge`, `glazed`, `sill`, `height`, `sheer`, `shutterBox`. The opening keeps its ID. With an offset and another change it tries move then change, then change then move, and sends the first order the rules accept.
- Each tool's width bound spans its kinds' ranges (`add_door` 0.50 to 4.00, `add_window` 0.30 to 3.00, `set_opening` 0.30 to 4.00); the domain refuses a width outside the kind's own. `height` is the opening's own height, from its sill.
- An add with neither `sill` nor `height` takes the domain's defaults on its wall. An add with only one takes the other from a new opening of the kind on a tall wall (a window's sill 0.90, height 1.20), so a low wall may refuse it.
- `get_drawing` lists openings under their wall in offset order, each with its `id`, `kind`, `name` (the label), `offset`, `width`, `height`, a window's `sill`, only the `side`, `hinge` and `glazed` its row uses, and `sheer` and `shutterBox` only when set.

## Limits

- No sheer or shutter box on a door or doorway. A sheer is not checked against pieces.
- No open or closed state for a door, stored or per viewer.
- No sill on a door, no head up to the wall's top, no arched heads, no roof windows.
- A leaf is only drawn. A parked sliding leaf can cover a neighbouring opening or run past its wall's end.
- A pocket's wall thickness is not checked.
- Nothing in 3D is see-through: glass is an opaque colour (`glass` in `view3d/style.ts`).

## At levels

The rule is in [levels.md](levels.md). No wall stands on a platform or a raised floor, so no opening does either; an opening is on a floor wall or on a wall standing on a loft.

- **Shown.** `openingShown(doc, openingId, level)` in `packages/domain/src/queries/levels.ts` answers "cut", "above" or "hidden". An opening on a loft's wall belongs to that loft's level and is hidden at every other, the floor included. An opening on a floor wall shows at each level by its own range: whole where the cut crosses it, dashed above the cut, not drawn below it.
- **Picked.** An opening is selectable where the level draws it. At the floor every opening on a floor wall is selectable, even one under the cut; one on a loft's wall is not selectable there.
- **Placed.** The Opening tool reaches a wall standing on the viewed surface and, from a loft, a floor wall the loft's cut crosses (`wallOpenableAt`). A wall on a loft holds every kind; on a wall standing on the viewed surface the heights are the defaults, measured from that surface. On a floor wall seen from a loft, `openingDefaults` gives a window a sill 0.30 m above the loft's top and a head 0.10 m under the wall's top, and refuses a `fromFloor` kind: "A door on this wall starts at the floor: place it from the floor's level".
- **Swing.** A door on a loft's wall has the same zone, cut at the deck's rectangle (`clippedToDeck`); a hole in the deck, such as a stairwell, does not cut it, and a swing wholly past the edge is no zone. Its band starts at the deck's top, so a piece on the loft blocks it and a piece under the loft does not. Its warning shows at the loft's level, where the door is cut, and `get_drawing` lists it with the others.
- **Floor through the span.** A door on a loft's wall has no door span, as a loft has no rooms. In 3D its threshold shows the deck's top in its finish.
- **Dressings.** `roomSideOf` tests the floor's rooms under the window, whatever its wall stands on, so a dressed window on a loft's wall usually takes its own `side`. A "floor" sheer there ends at the loft's top.
- **Measured.** The wall chain measures a loft wall's openings at the loft's level.
