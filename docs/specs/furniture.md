# Furniture

The pieces a layout holds: the kinds table, sizes, presets and configurations, how a piece is placed and sized, the shape each kind draws and fits by, rugs, pieces hung on a wall, use zones, built-in units, object options and the palette. Chairs at tables, tucks, Break apart and sets are in [seating.md](seating.md); layouts, placements across layouts and exceptions in [layouts.md](layouts.md); stairs in [stairs.md](stairs.md); the collision rule in height and the landing rule in [heights-decks.md](heights-decks.md); the 3D parts of pieces in [view3d.md](view3d.md).

## The kinds table

Every kind is a row of `OBJECT_KINDS` (`packages/domain/src/kinds.ts`, with more rows in `kinds-more.ts` and the row type and helpers in `kind-rows.ts`). The table is a domain constant: it is never stored and never sent. The table holds 88 rows: 85 have a palette card, the built-in desk is reached through Opens into, and two retired kinds (`kitchenBlock`, `bathroomBlock`) keep their rows so stored drawings load, draw and edit them, with no card, no entry in the Kind field and no place in Claude's kind list.

The groups are editor data, `GROUPS` in `packages/editor/src/view/palette.ts`. Adding a kind takes a row in the table, a symbol and a line in `GROUPS`.

| Group | Kinds | Holds |
|---|---|---|
| Sleep | 9 | beds, the built-in unit, sofa bed, nightstand, cot |
| Sit and eat | 13 | tables, the two tables with chairs, sofas, chairs, stool, bar table, bench |
| Work | 3 | desk, desk with chair, corner desk |
| Kitchen | 11 | modules, appliances, wall cabinet, cooker hood, corner counter |
| Bathroom | 10 | sanitary pieces, vanity unit, washing machine, towel rail |
| Storage | 12 | wardrobes, shelves, cabinets, TV units, pegboard, coat hooks and stand |
| Sets | | several pieces placed together: [seating.md](seating.md) |
| Basic | 18 | custom boxes, plants, heaters, wall unit, wheel well, beam, rugs, picture, mirror, clock |
| Stairs | 9 | [stairs.md](stairs.md) |

The columns of a row (`ObjectKind`):

| Column | Meaning |
|---|---|
| `configs` | the configurations in order, the first the default; each has `w`, `d`, `h`, `z` (elevation, a number or `"ceiling"`) and `zone` (the use zone's depth, or null) |
| `sides`, `zoneDefaults` | the use-zone sides a new placement has on, and each side's default run |
| `presets` | the named sizes |
| `outline` | the shape drawn and fitted: `rect`, `round`, `quarter`, `corner`, `ell`, `soft`, `pan` |
| `arms` | an `ell` kind's default arms |
| `sitAt`, `seat`, `seatsUnder`, `aggregate` | the seating columns: [seating.md](seating.md) |
| `family`, `opensInto` | a built-in unit's family and its name in Opens into |
| `options` | the object options the kind takes |
| `rug`, `front`, `flue`, `well`, `beam`, `stair`, `retired`, `semanticClass` | flags and derived data, described on the type |

`WORKTOP_HEIGHT` is 0.90 m and `SEATED_HEIGHT` 0.75 m.

## Objects, sizes and configurations

An object exists once and has a placement per layout it stands in ([layouts.md](layouts.md)). It stores four maps keyed by configuration id: `w`, `d`, `h` and `z`, copied from the kind or a preset when it is created (`defaultSize`, `presetSize`).

- Width and depth: 0.02 to 10 m (`MIN_OBJECT_SIZE`, `MAX_OBJECT_SIZE`). Height: 0.01 to 10 m (`MIN_HEIGHT`), kept to the millimetre. Elevation: 0 to 10 m above what the piece stands on, or `"ceiling"`.
- The width is shared by every configuration; depth, height and elevation are per configuration. `setObjectSize` writes the width to every configuration and the depths, heights and elevations it is given, in every layout, as one patch; `d: {}` sets the width only. Shared width is a rule of the size commands, not an invariant: a piece stored with different widths is aligned by its next size command.
- A placement's `at` is the middle of the footprint's back edge. Before rotation the footprint spans x from −w/2 to w/2 and y from −d to 0, so the front faces −y; `rotation` is whole degrees, counter-clockwise about `at` (`footprintQuad` in `packages/domain/src/queries/footprints.ts`). A configuration change or a resize keeps the back edge in place, so a Murphy bed folds down from its wall.
- `setConfiguration` changes one placement's configuration. Seven kinds have two: the lift bed, the three built-in units, the sofa bed, the folding table and the extending table.
- `setObjectKind` switches a piece to a kind `canSwitchKind` allows: the same configuration ids in order, not retired, both stairs or neither, both `ell` or neither, neither a table or desk with chairs, and the same well and beam flags. Width, depth and arms stay; heights and elevations become the new kind's, so fit can refuse the switch (a spiral stair takes its kind's own width and depth, and a linked stair keeps its rise: [stairs.md](stairs.md)); every option is dropped; a name still equal to the old kind's label takes the new label. Between single-configuration kinds every placement's sides and stored zones go back to the new kind's defaults. Properties' Kind field is a drop-down of the kind and every kind it can switch to, in table order, read-only when there is none.

## Presets

A preset (`Preset` in `kind-rows.ts`, the lists in `packages/domain/src/presets.ts`) is a label, a width and a depth per configuration, and optionally a height and an elevation per configuration. Within one kind the presets give heights and elevations all or none. `presetSize(kind, presetId, from?)` is the one way to read a preset: what it doesn't give stays as it is on an existing piece and takes the kind's default on a new one.

- Nothing records a piece's preset. `presetOf(object)` names the first preset whose width, depths and, where given, heights and elevations match the object's to the shown centimetre (`shownCm`) in every configuration; else Properties shows a disabled "Custom".
- Picking a preset in Properties sends one `setObjectSize` with every depth and the heights and elevations the preset gives.
- A preset counted in seats carries `seats` (the sofa, the sofa bed, the extending table, the two tables with chairs); the palette shows a card for each of those.

## Placing a piece

The Object tool (`packages/editor/src/tools/object-tool.ts`) is armed by a palette card or by quick add ([tools.md](tools.md)). A see-through ghost of the armed kind follows the pointer, centred on it to the centimetre, in the kind's first configuration, at the armed size and at the tool's start angle (0 when armed, plus 90° counter-clockwise for each `R`).

**The ghost is the click.** A click (a press released within 4 px, `DRAG_THRESHOLD_PX`) places exactly the ghost: its anchor to the millimetre, its angle, its size and the surface it landed on, as one `placeObject` in the active layout. The ghost's fit and the command share their tests (`placementFit`, `sizePlaceable` in `packages/domain/src/queries/fit.ts`), so a green ghost is placed. A red ghost still sends, so the refusal toasts its reason. The kind stays armed; Esc ends the tool.

**Contact with a wall** (`contactPlace` in `packages/editor/src/snapping/contact.ts`), one stateless call per move from the start angle, within the snap tolerance of 10 px:

1. The back within the tolerance of a wall face: the piece straightens to the face and slides flush. Always taken.
2. Another side within the tolerance: the piece turns so that side becomes its back, flush on the face, keeping its centre. Taken only if the piece then fits.
3. With a second face square to the first within the tolerance, the piece slides along the first into the corner.
4. Faces are tried in order: a back contact first, then the smaller gap, the smaller turn, the wall id.
5. Nothing taken: the start angle.

A corner kind (outline `quarter`, `corner` or `ell`) left touching two faces at a right angle takes the turn that puts its back-left corner on the room's corner, if it fits (`cornerTurn` in `snapping/corner.ts`). A seat takes the tuck snap first ([seating.md](seating.md)). A beam never turns: a long side slides flush to a wall face or to a hollow deck's edge from under it. After contact, on each axis no wall holds, the ghost aligns to the layout's other pieces ([tools.md](tools.md)). Ctrl keeps the start angle with no snap and no guide. A dragged piece and a duplicate's ghost take the same call.

**Fit.** A piece lies inside one room, off every wall body, and overlaps no other piece of its layout in plan and height together; its top stays under the ceiling. Fit reads the kind's shape, not its rectangle. Two exceptions need only their centre in a room: a wheel well may run under walls and a beam meets no wall. A wheel well stands on the floor only ([surroundings.md](surroundings.md)). The rule in height, decks and the surface a piece lands on are in [heights-decks.md](heights-decks.md); the refusal's words in [warnings.md](warnings.md). `placementFit` gives the first rule broken: `wall`, `deck`, `object`, `ceiling`, `room`, a deck reason, or `floorOnly` for a wheel well on a deck.

**A piece lowered to fit.** A new piece, by a click, a drawn footprint or quick add, takes the lower of its height and the room over it (`lowerGhost` in `tools/lowered-ghost.ts`).

- Which kinds (`lowerable` in `packages/domain/src/lowering.ts`): one configuration, no stair, a numeric elevation. Pieces that open, lift beds and stairs stay refused.
- The room (`roomOver` in `queries/room-over.ts`) is the lowest deck underside or ceiling over the piece's parts, from the top of what it stands on, to the millimetre. Another piece overhead doesn't count: it still refuses.
- Never below 3/4 of the armed height (`LOWEST_SHARE`, `lowestHeight`, rounded up to the millimetre). Below that the ghost stays red.
- The search at full height runs first. Only when that is red does it run again at the lowest height, take the height from the room where it landed, and check that with `placementFit`. A piece that fits at full height lands where it would without the rule.
- The height is an ordinary value afterwards. Dragging, nudging, typing or duplicating an existing piece never lowers it: a height is shared by every layout.
- The elevation stays. Claude's `place_object` never lowers by itself: its `height` is refused on a kind that can't be lowered ([mcp.md](mcp.md)).

## Sizing while placing

**The armed size** (`packages/editor/src/tools/armed-size.ts`). The session keeps one entry per kind: the picked preset's label and a typed width, first-configuration depth and height over it. The size list, the fields, the ghost, the click and the plates read it there and nowhere else. A preset pick replaces a typed size. A typed size equal to a preset's whole size to the shown centimetre becomes that preset; else the list reads "Custom". Without a pick, the armed preset is the one matching the kind's default size. The entry is never stored.

**The hint line** shows a Size list for a kind with presets, then Width and Depth fields, and a Height field only for a kind that may be lowered. A stair kind and an armed set get no fields. A value that doesn't read or lies outside the size bounds stays in its field marked invalid, with no toast, and the ghost keeps the last good size. The fields hold only what the person set: they never follow the ghost. No elevation can be typed.

**A typed height** is the height lowering starts from, and may itself go below the 3/4 share. A typed size travels in `placeObject`'s `size`, as a drawn one does, with the armed preset's id beside it.

A red click ghost's plate advises drawing the piece to size or typing a lower height ([warnings.md](warnings.md)).

**Drawing a footprint.** A press dragged past 4 px draws the piece as a rectangle along the world axes, placed on release with its drawn size (`drawnFootprint` in `snapping/drawn-footprint.ts`).

- Each corner snaps to a wall face corner, else to its foot on a wall face, else to the centimetre. An axis no wall fixed takes the nearest side of another piece within the tolerance (no rugs, no turned pieces). Ctrl: none.
- The back is the walled side opposite the one open side; with two or more open sides, or none, the start angle decides. The width runs along the back. `R` turns the piece a quarter turn inside the same rectangle, for that press only.
- The drawn size sets the width of every configuration and the depth of the first; the others keep the preset's or the kind's depth. Heights and elevation come from the armed size, a typed height included.
- A set's press only places it. A new `ell` piece takes its kind's arms clamped into the drawn box (`armsFor`); `sizePlaceable` refuses a box that can't hold an arm.

Claude's `place_object` takes a `preset`, or `width` and `depth` together (the first configuration's depth), with or without a preset; `set_size` edits a placed piece ([mcp.md](mcp.md)).

## Outlines

A kind's `outline` sets its shape inside the w × d rectangle (`packages/domain/src/shapes.ts`). A piece has two shapes by job (`pieceShape`): the outline, one ring, draws it and fills it, and gives free floor, the room test and the click hit test their shape; the parts, convex rings, decide collisions. For every outline but `ell` the parts are the outline itself. Grips, guides, snapping and use zones read the rectangle.

| Outline | Shape | Kinds |
|---|---|---|
| `rect` | the rectangle | most |
| `round` | an ellipse touching the four sides, drawn as 32 straight lines | round table, round box, plants, round rug, stool, coat stand, round table with chairs |
| `quarter` | a quarter ellipse about the back-left corner, 8 lines | corner shower |
| `corner` | the triangle back-left, front-left, back-right | corner basin, corner box |
| `soft` | a rounded rectangle | washbasin, nightstand |
| `pan` | a flat back with rounded corners and a full front (a superellipse of power 3.2) | toilet, bidet |
| `ell` | two arms meeting at the back-left corner | the four corner pieces |

Curves are inscribed, so no shape leaves its rectangle and every ring but the `ell`'s is convex. `soft` and `pan` round their corners by min(0.06 m, 20 % of the smaller side) (`cornerRadius`). Free floor takes the outline's area (`pieceArea`).

## Corner pieces

```
      w
 ┌──────────────┐
 │   back arm   │ t1 = arms.back     ■ arm grips, on the inner edges
 │ ┌─────■──────┘                    □ side grips, at the arm ends
 │ │░░░░░░░░░░░░ □
 │ ■░░░░                             ░ the front zone: one outline
 └□┘                                   over two strips
 t2 = arms.left
```

An `ell` piece (corner desk, corner wardrobe, corner counter, corner sofa) fills two arms of its footprint: the back arm runs the whole width with depth `arms.back`, the left arm the whole depth with depth `arms.left` (`packages/domain/src/arms.ts`). The object stores `arms`, shared by every layout; the kind's column gives the default, 0.60 m each and 0.90 m for the sofa. A preset sets width and depth; the arms stay.

- An arm is at least 0.10 m (`MIN_ARM`) and at least 0.10 m shallower than the side it runs across (`armsFit`), checked with the object's row and refused with its own message. `armsFor` clamps arms into a box for tiles and ghosts.
- The parts are the back arm and the left arm below it. Another piece may stand in the empty quarter, and a click there selects nothing. Free floor takes w·t1 + t2·(d − t1).
- Both outer sides are backs for contact: a touch on the left side straightens the piece and slides it flush, and never turns it.
- Arms change in Properties (Back arm, Left arm), by `set_size` (`backArm`, `leftArm`) and by two grips at the middle of the inner edges (`snapping/arm-drag.ts`), which snap like a side grip. Each sends one `setObjectSize` with `arms`, so width, depth and arms are checked once as a final state. The right and front side grips sit at the arm ends.
- The Kind field of an `ell` piece lists only `ell` kinds. The corner desk is sat at ([seating.md](seating.md)).
- There is no mirror: the corner is always back-left, and the piece is turned instead.

## Symbols

Each kind draws a plan symbol in footprint space (`furnitureSymbol` and `objectLook` in `packages/editor/src/view/furniture.ts`; the kinds' lines in the files under `view/symbols/`). The symbol is the outline, the kind's inner detail in a lighter line, and a heavier front line along the shape's front, except for a kind whose `front` is false (rugs, plants, the `soft` and `pan` kinds, stool, coat stand, wheel well, beam) for a table or desk with chairs, and for a piece with `roundChairs` on. Every point stays inside the rectangle, and fixed sizes shrink on a small piece. Selected, ghosted and refused pieces draw in one colour and fill the shape fit checks.

- **Two looks.** Over finishes a picture draws every piece white with a thinner grey outline, else grey: one flag per picture (`piecesStyle` in `view/floor-look.ts`).
- **Above the cut.** A piece wholly above the plan's cut draws its shape's outline dashed, with no fill and no symbol: a wall cabinet, a cooker hood, a hung wall unit. Pieces draw lowest bottom first, so dashed ones land on top. A piece's lines are cut under every filled piece drawn after it.
- **Plants** (plant, palm, fern, rosette) fit by their round ring and have no front line. At rest each fills a lobed canopy with dark lines in place of the ring (`CANOPIES` in `view/symbols/plants.ts`); selected, ghosted or refused it fills the ring, which a click also hits.

## Rugs

One predicate, `isRug(kind)`, reads the `rug` column (rug, round rug; 0.01 m thick).

- A rug overlaps any other piece freely, placed or dragged. It still lies inside one room and off the walls.
- It blocks no use zone and no door swing, and takes no free floor.
- It draws first and is picked last, so a click on a piece standing on it picks the piece.
- Its sides attract no guide and no drawn corner, and room tags ignore it.
- Its lines are cut under the pieces standing on it. Its fill is its own (`rugFill`), kept in the white look, and it has no front line.

## Wall-hung pieces

A hung piece is an ordinary piece with a thin footprint and an elevation: picture, mirror, clock, wall TV, pegboard, coat hooks, radiator, towel rail, electric fireplace, wall unit, wall cabinet, and the presets hung at an elevation. Nothing ties it to a wall: the contact snap turns its back to the face it touches, and it moves and fits like any piece. The smallest width or depth, 0.02 m, lets a frame be as thin as it is. A hung piece whose bottom is 1.20 m or more over its surface owns no use zone that warns and blocks no zone of a piece on that surface. A thin piece against a wall stays clickable ([tools.md](tools.md)). A cooker hood, a beam and a lift bed's Up configuration default to `"ceiling"`.

## Use zones

A use zone is the free floor a piece needs on one side. It warns and never refuses ([warnings.md](warnings.md)).

**Data.** A configuration's `zone` is the depth, or null for none (a closed built-in unit, a folded table, a lift bed up); a depth of 0 or less reads as none. A placement stores, per layout, `sides` (four flags, copied from the kind by `defaultSides`) and `zones`: twelve flat keys, `frontDepth`, `frontStart`, `frontEnd` and the same for back, left and right (`packages/domain/src/use-zone.ts`). A side's three keys are all null, meaning the kind's default, or all numbers: a depth and two insets from the side's corners, front and back from the left corner, left and right from the back corner.

**Reading.** `zoneExtent(doc, placement, side)` is the one rule: null when the side is off or the configuration has no zone; else the stored entry, else the configuration's depth with the kind's `zoneDefaults`. Defaults run the whole side, except: a bed's left and right start 0.45 m from the head, a desk's front is 0.70 m long and centred, and an open Murphy bed's front is inset 0.10 m at each end (`MURPHY_MATTRESS_INSET`). Insets that leave less than 0.10 m of the side (`MIN_ZONE_SIZE`) shrink in proportion when read (`clampInsets`); the stored numbers stay.

**Commands.** `setZoneSides` sets one placement's four flags. `setZoneExtent` sets one side's depth and insets, or null for the default. It refuses a depth under 0.10 m or over 10 m, a negative inset, and insets leaving less than 0.10 m of the side in the current configuration. Both act on one layout and are allowed in any configuration.

**The front zone of an `ell` piece** is one zone of two strips at one depth, one in front of each inner edge, meeting at the inner corner (`packages/domain/src/ell-zone.ts`). `frontStart` trims the left strip from the left arm's front end and `frontEnd` the back strip from the back arm's right end. It draws as one outline. A piece in either strip blocks it once. An `ell` piece blocks other zones by its arms, so its empty quarter stays free.

**What blocks a zone** (`clearanceWarnings` in `packages/domain/src/queries/clearance.ts`): another piece of the layout or a wall body that overlaps it on the plan and reaches into its height band. A blocking piece counts by its rectangle, an `ell` piece by its arms: a round table's empty corner still blocks. A seat never blocks a zone of a piece you sit at, a rug blocks none, and a zone never warns against its own piece. The band and the cut at a deck's edge are in [levels.md](levels.md).

**Editing on the canvas.** A selected piece shows its zones as faint dashed outlines. Each active zone has a "×" chip and each inactive side a "+" chip, where the current configuration has a zone (`view/zone-chips.ts`); a click toggles the side. A zone at least 32 px deep and long on screen (`ZONE_HANDLES_MIN_PX`) shows a depth handle and two end handles. A drag moves that edge flush to a wall face or another piece's face within the tolerance, else by whole snap steps, with Ctrl to the centimetre (`zoneDragExtent` in `snapping/zone-drag.ts`), and commits one `setZoneExtent`. Properties shows a switch per side where the configuration has a zone, Claude uses `set_zones`, and exports draw no zones.

## Built-in units

Three kinds share `family: "builtIn"` and the configurations `folded` (Closed) and `down` (Open): `builtInTable`, `builtInDesk` and `murphyBed`. Closed is the cabinet against the wall, with no zone; open is the cabinet plus what comes out, with a front zone. The Built-in unit card places a built-in table.

- Properties shows Kind as "Built-in unit", read-only, and **Opens into**: Table, Desk or Bed (each kind's `opensInto`). It sends `setObjectKind`, in every layout. Width, depths and configurations stay, and so do each placement's sides and stored zones; heights become the new kind's.
- The stored height is the cabinet's (1.60, 1.40 and 2.24 m). The open table and desk are sat at, and a seat tucks under the open configuration only.
- A piece that opens can't be lowered and gets no Height field while placing.
- Claude: `set_opens_into` and `set_configuration`.

## Object options

A kind's `options` column lists the per-object switches it takes (`packages/domain/src/options.ts`). An object stores the ones that are on as a flat record of `true` keys, `options`, absent when none is on. One command, `setOption { objectId, option, on }`, refuses an option the kind doesn't list. Any kind switch drops them all; a duplicate copies them. Properties shows a field per listed option under Name.

| Option | Kinds | Effect |
|---|---|---|
| `computer` ("With computer") | desk, desk with chair | a monitor, keyboard and mouse on the top, on the plan and in 3D (`computerGear` in `view/computer.ts`); drawn only, never fitted |
| `roundChairs` ("Round chairs") | chair, desk with chair, the two tables with chairs | round chairs: [seating.md](seating.md) |
| `leftEntry`, `hooks` | winder stair, rung ladder | [stairs.md](stairs.md) |

## The palette

The palette column is 312 px wide: a 64 px rail and two columns of cards (`packages/web/src/panels/Palette.tsx`, `palette-model.ts`).

- **The rail** lists the groups in order, then Floors ([finishes.md](finishes.md)). A click shows that group's cards. The last group opened is remembered per viewer in the browser (`fm.paletteGroup`).
- **A card** (`PaletteCard` in `view/palette.ts`) shows the symbol, the name in bold and the size in grey through `cardSize`: "1.80 × 1.10 m", or "Ø 1.48 m" for a round outline of equal sides. A kind whose presets all count seats gets a card per preset, named `<kind> · <preset>`; every other kind gets one card at its default size. `PALETTE_KINDS` holds one card per kind, which quick add reads; `PALETTE` expands the preset cards. A group with no cards is hidden. Three cards show the open configuration so they aren't a thin strip (Murphy bed, built-in unit, folding table); placing still uses the first.
- **A click** sends `pickKind`, then `pickPreset` for a preset card (`cardActions`); a set's card sends `pickSet`. A card shows pressed while the Object tool is armed with its kind and, for a preset card, its preset.

Quick add, with one row per kind and other names for each, is in [tools.md](tools.md).

## Limits

- No size range or lock per kind, and no typed elevation while placing.
- Nothing attaches a hung piece to a wall: it stays where it is when the wall moves.
- Contact judges an `ell` piece by its rectangle's corners, and a rug near a wall turns by it like any kind.
- A drawn ghost takes no guides and no touch to turn; drawn corners don't catch a turned piece.

## At levels

- **Placing.** A new piece lands by the landing rule at the viewed level ([heights-decks.md](heights-decks.md), [levels.md](levels.md)). At a loft's level, where no deck of the level is under the ghost, it is red and a release sends nothing. Contact and drawn corners read only the walls the viewed level sees.
- **On a platform.** The piece's elevation is measured from the platform's top. It lies inside the deck or overhangs it as [heights-decks.md](heights-decks.md) says, and counts in its room.
- **On a loft.** The piece lies inside the loft's deck in place of one room, shows at the loft's level only, takes no free floor and doesn't furnish the room under it.
- **Lowering** measures the room from the top of the surface the piece lands on.
- **Use zones** start at their piece's surface and stop at the edge of its deck ([levels.md](levels.md)).
- **Wheel wells** are floor only: refused on a platform and on a loft ([surroundings.md](surroundings.md)).
- **Hung pieces** set to `"ceiling"` hang from what is over them: a loft's underside where one is overhead, else the ceiling.
