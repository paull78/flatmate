# Roofs

The ceiling's shape: flat, or the underside of a shed or gable roof. It covers the roof's fields and edits, what a slope does to everything under it, the roof on the plan and in 3D, beams and collar ties. The ceiling as a plain height and the collision rule are in [heights-decks.md](heights-decks.md).

```
 shed, falls "-y" (toward the bottom)        gable, falls "-y" or "+y": ridge along x
        high wall ─────┐                          ridge
              ╱‾‾‾‾‾‾‾‾│                        ╱‾‾‾‾‾╲
   low wall  ╱  pitch  │              eaves    ╱       ╲    eaves
   ┌────────╱          │              ┌───────╱         ╲───────┐
 box edge            box edge       box edge                  box edge
```

## The ceiling row

A drawing has at most one row in `doc.ceilings`, under `CEILING_ID` (`"ceiling"`): the `Ceiling` type in `packages/domain/src/model.ts`. The row also holds the house's outside walls default ([finishes.md](finishes.md)).

| Field | Meaning | Read as, when absent |
|---|---|---|
| `height` | the flat ceiling, or a slope's low side, in metres | 2.50 (`DEFAULT_CEILING`) with no row |
| `shape` | `flat`, `shed` or `gable` (`ROOF_SHAPES`) | `flat` |
| `pitch` | degrees | 10 (`DEFAULT_PITCH`) |
| `falls` | `-y`, `+y`, `-x` or `+x` (`FALLS`): the side the roof falls toward | `-y` |
| `overhang` | metres past the box on every side | 0.30 (`DEFAULT_OVERHANG`) |
| `covering` | the roof's `Finish` | none |

Read the roof through `roofOf(doc)` in `packages/domain/src/roof.ts`, which fills every default, and the covering through `roofCovering(doc)`. A flat ceiling has no roof.

## Where the roof is

Nothing about the roof's position is stored. `roofBox(doc)` (memoised) is the outer box of the outlines of the walls standing on the floor, in whole millimetres. Columns and walls on a deck do not count. The roof covers that box, and its heights are the underside's at the box's edge. The overhang is drawn only.

- A shed is one plane rising from `height` at the box's edge on the `falls` side to the opposite edge.
- A gable is two such planes, one from each of the two opposite edges, and the ceiling is the lower of the two. Only the axis of `falls` counts: `-y` and `+y` give the same gable.
- `planesOf(roof, box)` builds the planes (`Plane { c, gx, gy }`); `roofPlanes(doc)` memoises them.
- The high side (`highSide(doc)`: a shed's high wall, a gable's ridge) is `height` + tan(`pitch`) × run. The run is the box's span across the slope, half of it for a gable.
- With no floor walls there is no box, and a shed or gable reads its low side everywhere.

An edit that changes the box moves the roof with it. The low side and the pitch stay, and the high side changes with the span: moving a wall outward never lowers the ceiling under the old box. A wall edit that leaves a piece too tall for the moved slope is refused.

## Reading the ceiling

All ceiling heights come from the planes through `ceilingAtPoint(doc, p)` (`roof.ts`), in whole millimetres. Under a flat ceiling the readers in `vertical.ts` answer the one height without the box.

| Query | Answers | Read by |
|---|---|---|
| `ceilingOver(doc, ring)` (`packages/domain/src/queries/vertical.ts`) | the lowest ceiling over a footprint: its lowest corner | a piece's fit, a deck's top, the room over a piece (`roomOver`), hanging (`overheadOver`), guard and handrail tops, stair headroom |
| `ceilingAlong(doc, wallId)` | the lowest ceiling over a wall's outline | a fixed wall top, a new opening's default heights with no span |
| `wallRange(doc, wallId)` | a full wall's top: the highest ceiling over its outline, a ridge crossing included | every range check, the cut |
| `wallTopOver(doc, wallId, from, to)` | a full wall's top over a stretch of its body: the lowest ceiling there | an opening's head, a new opening's default head on its span |
| `highestCeilingAlong(doc, a, b)`, `highestCeilingOver(doc, ring)` | the highest ceiling along a segment or over a footprint | a new wall's top, the cut |

What follows from the table:

- **Pieces.** A piece's top must not pass the lowest ceiling over its footprint; the refusal gives the ceiling there. A piece set to "ceiling" hangs from the lowest ceiling over its footprint or from a loft's underside ([levels.md](levels.md)).
- **Full walls.** A wall whose top is "ceiling" follows the slope and is never refused for it. Its range tops at its highest point, and a gable's end walls rise to the ridge.
- **Fixed tops.** A half wall or a column with a numeric top must stay under the lowest ceiling over its outline (invariant `I17`, `ceilingViolations` in `packages/domain/src/ceiling.ts`).
- **Openings.** A head keeps 0.10 m (`HEAD_CLEAR`) of wall above it, measured against the wall's top over the opening's own span. ([openings.md](openings.md))
- **Decks.** A deck's top must not pass the lowest ceiling over its rectangle.
- **Stairs and guards.** Headroom reads the ceiling over each tread ([stairs.md](stairs.md)). A guard's or a handrail's top stops at the lowest ceiling over its edge ([guards.md](guards.md)).
- **The cut.** Under a slope the plan's cut reads the highest ceiling: see [levels.md](levels.md).

## Setting the ceiling

`setCeiling { height?, shape?, pitch?, highSide?, falls?, overhang? }` (`packages/domain/src/commands/heights.ts`) writes the one row. What is not given stays.

- **One edit rule** (`solveRoof`): a low side keeps the pitch; a pitch keeps the low side; a high side keeps the low side and solves the pitch over the current run. `pitch` and `highSide` together are refused ("Give the pitch or the high side, not both"). A high side with a flat shape or no box is refused ("A flat ceiling has no high side"); one at or under the low side fails the pitch bound.
- **A first slope.** When the row holds no `falls`, a first Shed or Gable falls across the box's shorter span: `-x` when the box is deeper in y than it is wide in x, else `-y`. It takes the default pitch and overhang. The direction is stored and never follows a wall.
- **Shapes.** Flat to a slope keeps the height as the low side. A slope back to Flat keeps the low side as the height, and is refused when anything stands above it. The pitch, direction, overhang and covering stay on the row while it is flat.
- **Rounding.** `height` and `overhang` are kept to the millimetre; a solved pitch is unrounded. A non-finite number is refused as "Invalid height".
- **Checks.** The result is validated whole, so every fit, wall, opening and level rule applies. The command depends on the ceiling row, every wall and every placement. Raising the ceiling against a loft is in [levels.md](levels.md).

Limits (`I17`):

| Value | Range | Constants |
|---|---|---|
| `height` | 1.00 to 10 m | `MIN_CEILING`, `MAX_CEILING` |
| `pitch` | 1° to 60° | `MIN_PITCH`, `MAX_PITCH` |
| `overhang` | 0 to 1.00 m | `MAX_OVERHANG` |
| high side | at most 10 m | `MAX_HIGH_SIDE` |

The last three are checked only under a shed or a gable.

Presets (`ROOF_PRESETS`), rules of thumb:

| ID | Label | Shape | Low side | Pitch |
|---|---|---|---|---|
| `tinyShed` | Tiny house shed | shed | 2.75 m | 10° |
| `tinyGable` | Tiny house gable | gable | 2.30 m | 35° |
| `smallShed` | Small home shed | shed | 2.50 m | 10° |
| `smallGable` | Small home gable | gable | 2.50 m | 25° |

`roofPresetOf(roof)` matches to the centimetre and the tenth of a degree.

## Properties' Ceiling section

With nothing selected, Properties shows the Ceiling section (`ceilingFields` in `packages/editor/src/properties/ceiling.ts`). Field IDs are `ceiling.<name>`; each commit is one `setCeiling`.

| Field | Shown for | Notes |
|---|---|---|
| Preset | every shape | the four, or a disabled "Custom"; one sets shape, low side and pitch |
| Shape | every shape | Flat, Shed, Gable |
| Height | flat | |
| Low side | shed | Bottom, Top, Left, Right (`FALLS_LABELS`): `-y`, `+y`, `-x`, `+x` |
| Ridge along | gable | Length or Width: Length is the box's longer axis. A change sets `falls` to `-y` (ridge along x) or `-x` |
| Low wall (shed), Eaves (gable) | slopes | the low side, `height` |
| Pitch | slopes | degrees to one decimal, with percent and rise per 12 read-only beside it |
| High wall (shed), Ridge (gable) | slopes | the high side; typing it solves the pitch |
| Overhang | slopes | |

Under a slope a Roof section follows with one Covering row (field IDs `roof.<name>`).

## The roof on the plan

`roofLines(doc, style)` in `packages/editor/src/view/roof-layer.ts` draws the roof overhead, at every level and on paper. A flat ceiling draws nothing.

- The edge: the box plus the overhang (`roofEdge`), in a long dash (`style.roof`), longer than the dash of pieces above the cut and of decks' edges.
- A gable's ridge: the same dash, with the word "Ridge" beside it, a quarter of the way along from one end.
- An arrow down each slope with the pitch in degrees beside it, a quarter of the way along from the other end.
- Project cards leave the lines out. PNG, SVG, a sheet's fit and Claude's `look` frame the roof's edge.

## The roof in 3D

- **Walls.** A full wall is built to its highest point, cut under the planes, and its top faces are lifted onto the slope (`underCeiling` in `packages/editor/src/view3d/ceiling-clip.ts`). Joint caps compare tops at the joint (`wallTopAt`, not rounded).
- **The Roof switch.** `View3dState.roof`, per viewer, off by default, toggled by the UiAction `toggleRoof3d`. On, no wall is hidden and the roof draws over the house. Under a flat ceiling the same switch is named Outside and draws no roof ([finishes.md](finishes.md)). See [view3d.md](view3d.md).
- **The slab.** `roofFaces(doc, style, finishes)` in `packages/editor/src/view3d/roof-faces.ts`: over the box plus the overhang, its underside on the ceiling's planes and its top 0.15 m above (`ROOF_THICKNESS`). One slab per plane; a gable's two meet at the ridge with no side face there. Without a covering it is slate grey (`style.roof`).
- **The covering.** `setRoofCovering { finish }` sets or clears it (`null`). It is refused under a flat ceiling ("A flat ceiling has no roof") and for a motif that is not a roof's. Motifs: [finishes.md](finishes.md). With the viewer's Finishes switch on (always, in Claude's `look`), the slab's top and edges take the covering's colour; the underside stays slate. The pattern is laid along the eave and up the slope in true length. A pattern finer than 0.05 m (`MIN_SPACING_3D`) is left out. The plan never shows the covering.
- **Sections.** A section clips its cut under the ceiling, draws the roof's band and gives walls past the cut their sloped tops ([sections.md](sections.md)).

## Beams and collar ties

A beam is a piece, kind `beam` (`packages/domain/src/kinds-more.ts`): a level timber hung from what is over it, its ends into walls. Its width is its length.

| Preset (`BEAM_PRESETS`) | Length × depth | Height | Elevation |
|---|---|---|---|
| Beam (the kind's default) | 2.40 × 0.15 m | 0.20 m | ceiling |
| Heavy beam | 2.40 × 0.20 m | 0.30 m | ceiling |
| Collar tie | 1.80 × 0.10 m | 0.15 m | ceiling |

- **The kind row.** `beam: true` (`isBeam`), no use zones, no front line. It stands in every layout state, kept in step like a stair (`inEveryLayout`), and switches kind only with another beam (`kindsSwitchable`). Quick add also finds it by joist, collar tie, tie beam, rafter tie and girder.
- **Into walls.** A beam meets no wall or column: `fitViolations` and `footprintFit` (`packages/domain/src/queries/fit.ts`) skip that pairing. On the floor its centre must lie in a room, outside every floor wall's body (`wellRoom`); with its centre under a wall it is "not inside a room".
- **Decks and pieces.** A beam meets pieces and decks by height range, and by range alone: it passes over a platform it does not stand on. It may not pass through a loft's slab.
- **Where it hangs.** From `overheadOver` ([levels.md](levels.md)). Under a 2.50 m flat ceiling a default beam spans 2.30 to 2.50 m; under a hollow loft with its top at 2.15 m it spans 1.83 to 2.03 m.
- **Following the roof.** A beam stays level. Under a slope it hangs from the lowest ceiling over its footprint, so a tie across a gable meets the slopes at its ends, and a shorter tie hangs higher.
- **Dragging** (`beamPlace` in `packages/editor/src/snapping/contact.ts`). Placing or dragging never turns a beam. A long side within the snap tolerance of a wall face it faces square on slides flush with it. Under any hollow deck, a platform included, with the centre under the slab, a long side within the tolerance of a slab edge (a hole's side included) slides flush with it from below, and no guide then moves it off. Ctrl snaps nothing.
- **Drawn.** On the plan as any piece: crossing the cut, its outline and two lines along its length at a third and two thirds of its depth; wholly above the cut, a dashed outline. In 3D one box in the wood shade.

## Claude's tools

The full list is in [mcp.md](mcp.md).

- `set_ceiling` takes `preset` (a preset's ID), `shape`, `height` (the flat height or the low side), `pitch` or `highSide` (never both), `falls` (`lower`, `upper`, `left`, `right`: Properties' Bottom, Top, Left, Right, so `lower` or `upper` gives a gable's ridge along x) and `overhang`. A preset gives the shape, the low side and the pitch; the other values given override it, and a `highSide` replaces the preset's pitch.
- `get_drawing` lists `ceiling` (the flat height or the low side) and, under a slope, `roof`: `shape`, `falls`, `lowSide`, `pitch`, `highSide`, `overhang` (metres to the millimetre, pitch to 0.1°) and `covering` when it has one.
- `set_finish` with `roof: true` sets the covering.
- `look` takes `roof` for the 3D view only: the Roof switch for that picture.
- A beam is placed with `place_object` (kind `beam`, a preset), sized with `set_size` and listed by `get_drawing` with its "ceiling" elevation.

## Limits

- On a row that has never taken a shape, Flat stores no slope, given or not: pitch, falls and overhang sent to such a row are accepted and not stored, so the first Shed or Gable takes the shorter span. A click on the pressed Flat button, or `set_ceiling` with `shape: "flat"` and the height it has, changes nothing and adds no undo step.
- Once the row has had a shape, a flat row keeps any finite pitch or overhang sent to it; the next slope is then refused by the bounds.
- One roof over the whole box. An L-shaped house's roof covers its empty corner. No hips, valleys, dormers, skylights or roofs per level.
- One storey per drawing: two floors drawn side by side stand under one roof.
- The overhang is equal on every side and takes part in no check.
- The plan gives the pitch in degrees only, and the ridge is a labelled long dash. Roofs get no sheet of their own and no head-height bands.
- No ceiling finish.
- A beam is always level: no rafters, purlins or ridge beam following the slope. Nothing checks that a beam rests on anything, its structural size, or a door's head under it. Beams are pieces, never wall or column rows.

## At levels

- **The roof is the drawing's, not a level's.** The box comes from the floor's walls alone; a wall or column on a loft never moves it. Its heights are above the floor (0.00), whatever a thing stands on.
- **On a platform or a raised floor.** A piece's absolute top (its surface's top plus its elevation and height) is checked against the lowest ceiling over its footprint.
- **On a loft.** The same check applies to a loft's pieces. The deck's own top must stay at or under the lowest ceiling over its rectangle. A full wall on a loft runs from the deck's top to the highest ceiling over its outline, and a fixed top on a loft stays under the lowest. A loft's cut reads the highest ceiling over its decks ([levels.md](levels.md)).
- **The plan.** The roof's edge, ridge and arrows draw at every level, the floor's and each loft's.
- **Beams.** A beam on the floor passes over a platform and hangs from the ceiling, never from a platform's underside. Under a hollow loft it hangs from the loft's underside. A beam standing on a deck hangs from what is over it, its own deck left out, and lies on that deck as any piece does ([heights-decks.md](heights-decks.md)); the room test for its centre applies on the floor only.
- **3D.** The slab and the sloped walls do not change with the viewed level.
