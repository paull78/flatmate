# Finishes

What a surface is made of: a room's or a deck's floor, each side of a wall, the roof's covering. This document covers the `Finish` value, the motifs, patterns, floors on the plan, on paper and in 3D, door spans, wall sides and their defaults, and the colour picker. The roof's slab is in [roofs.md](roofs.md), the 3D view in [view3d.md](view3d.md).

## One finish, three surfaces

`Finish { motif, colour, strength, size, angle }` (`packages/domain/src/finishes.ts`) serves every `Surface`: `"floor"`, `"wall"`, `"roof"`. `finishIssue(f, surface)` gives the first broken rule: `motif` known and suiting the surface, `colour` `#rrggbb` in lower case, `strength` a whole percent 0 to 100, `size` whole millimetres in the motif's range, `angle` whole degrees 0 to 179. Commands pass a finish through `checkedFinish`, which lower-cases the colour and adds a missing "#" (`givenColour`). A stored row is never normalised: I8 refuses it, naming the field ("covering.size must be …").

| Finish | Stored on | Fields | Command |
|---|---|---|---|
| A room's floor | its label | `finish` (null: none) | `setFinish { id, finish }`; `labelZone` takes one ([walls-rooms.md](walls-rooms.md)) |
| A deck's floor | the deck | `finish` (null: none) | `setDeckFinish { deckId, finish }` |
| A wall side, custom | the wall | `finishLeft`, `lowerLeft`, `lowerLeftHeight`, the same for Right | `setWallSide`, `setWallFinish`, `resetWallSide` |
| A room's walls default | its label | `walls`, `wallsLower`, `wallsLowerHeight` | `setRoomWallFinishes` |
| The outside walls default | the ceiling row | `outside`, `outsideLower`, `outsideLowerHeight` | `setOutsideFinish` |
| The roof's covering | the ceiling row | `covering` | `setRoofCovering` ([roofs.md](roofs.md)) |

Rows hold flat fields only: the wire takes no nested value. Code reads and writes a wall's sides only through `sidesOf` and `withSides` (`wall-sides.ts`), as `SideFinish { finish, lower: { finish, height } | null }`, and the defaults through `roomWallsOf`, `withRoomWalls`, `outsideOf` and `withOutside` (`wall-defaults.ts`). A missing `finish` reads as null. Each command depends only on the row it writes; setting the value a row holds is no change. Refusals of `setFinish`, `labelZone`, `setDeckFinish` and `setWallFinish` toast the field's name: "Size must be 0.10–0.40" (`toast-text.ts`). Claude uses `set_finish` and `get_drawing` ([mcp.md](mcp.md)).

**Changing the motif** (`withMotif`, for Properties and Claude) keeps the colour and the direction the pattern runs, carrying the angle's offset from the old motif's default onto the new one's, and takes the new motif's size and strength. From none it takes the motif's defaults (`motifDefaults`).

## The motifs

`MOTIFS` (domain) holds the rules; `MOTIF_DRAWINGS` (`packages/editor/src/view/finish/motifs.ts`) one cell of each, in units of its size, repeated by two vectors. Both are keyed by `MotifId`. `MOTIF_IDS` orders every picker.

| Motif | Surfaces | Size means | Range (m) | Default | Colour | Strength | Angle |
|---|---|---|---|---|---|---|---|
| Planks | floor, wall | width; 6 long, rows shifted a third | 0.10–0.40 | 0.20 | `#c8a27a` | 45 | 0 |
| Wide planks | floor, wall | width; 8 long, shifted half | 0.20–0.40 | 0.30 | `#d8bc94` | 40 | 0 |
| Herringbone | floor | width; 5 long, at right angles | 0.05–0.20 | 0.09 | `#c8a27a` | 50 | 45 |
| Square tiles | floor, wall | side | 0.10–0.60 | 0.30 | `#e8e4dc` | 55 | 0 |
| Large tiles | floor, wall | short side; 1 × 2, shifted half | 0.30–0.75 | 0.60 | `#cfcbc4` | 45 | 0 |
| Mosaic | floor, wall | side | 0.02–0.05 | 0.025 | `#a9c9d6` | 50 | 0 |
| Cement tiles | floor | side; a centre and a corner diamond | 0.15–0.40 | 0.20 | `#e3d9c6` | 70 | 0 |
| Plain | floor, wall | none | 0 | 0 | `#e6e3dd` | 0 | 0 |
| Brick | wall | course; 4 long, running bond | 0.05–0.10 | 0.065 | `#b5654a` | 50 | 0 |
| Subway tiles | wall | course; 2 long, running bond | 0.05–0.15 | 0.075 | `#f1efea` | 40 | 0 |
| Board and batten | wall | batten; one every 8 | 0.03–0.10 | 0.05 | `#7d8a80` | 60 | 90 |
| Shingles | wall, roof | course; 2 wide, staggered half | 0.10–0.25 | 0.13 | `#8a6f55` | 55 | 0 |
| Standing seam | wall, roof | seam spacing | 0.30–0.60 | 0.45 | `#4a4f54` | 60 | 90 |
| Corrugated | wall, roof | rib spacing | 0.05–0.15 | 0.076 | `#9aa1a6` | 40 | 90 |
| Roof tiles | roof | side | 0.15–0.40 | 0.25 | `#b4562f` | 55 | 0 |

**Colour.** The base colour fills the surface. Each line and shape has a shade, a factor on the base: lines 0.60, cement tiles' centre 0.75 and corner 0.60, board and batten's batten and corrugated's trough 0.85, roof tiles' half 0.82. Strength blends from the base (0 %) to the shade (100 %) (`mixColour`). Every primitive is one solid colour.

## Building the pattern

`finishGeometry(ring, holes, finish)` in `packages/editor/src/view/finish/geometry.ts` builds every pattern, on every surface: the fill, lines, filled shapes, `spacing` and `tooFine`.

- Cells repeat from the drawing's (0,0), turned about it by the angle, so two rooms in one finish line up through a doorway.
- A pattern needing more than 20,000 cells over the floor's bounding box (`MAX_CELLS`) is `tooFine` and draws its colour alone at every zoom.
- Lines merge along each line of the pattern, then are cut to the floor less its holes. Shapes are clipped to the floor; a shape meeting a hole is dropped.
- `spacing` is the finest gap between lines. `patternShows` draws lines and shapes only from 4 px on the canvas and 0.8 mm on paper (a section's picture likewise), and 0.05 m in 3D on every surface (`MIN_SPACING_3D`).
- `roomFinishes`, `deckFinishes` and `spanFinishes` (`view/finish/rooms.ts`) build every finished floor through one value-keyed cache, so a drag or a flip never re-tiles one.

## Floors on the plan

- The `finishes` layer (`floorsLayer`) lies under the zone fills: each finished room's colour, shapes, then lines, 0.75 px on the canvas and 0.1 mm on paper. A finished room draws no blue fill; a labelled room without one keeps the blue, and stays white on paper.
- Hovered by the Zone tool, a finished room takes the selection blue at 35 %; selected, a 2 px blue outline.
- The `deckFloors` layer draws a deck's finish in place of its tint, at the level owning it (`deckFloorIds`).
- **The Finishes switch** (`EditorState.finishesOn`) is per viewer, on at load, never saved, sent or undone. Off, that viewer sees blue fills, and in 3D plain floors, grey walls and a slate-grey roof.
- Over finishes, pieces draw white ([furniture.md](furniture.md)). A finish hides the underlay.

## Door spans

The floor changes under a closed door. `doorSpans(doc)` (`packages/domain/src/queries/door-spans.ts`) gives a span to each opening from the floor (`fromFloor`) on a floor wall:

```
  room A     ━━━━━┯━━━━━┯━━━━━  door line: the face on the opening's side
  wall            │span │
             ━━━━━┷━━━━━┷━━━━━  far face
  room B     the span shows B, else A, else nothing
```

The span runs along the door within the wall's clear stretch (`clearStretch`), 1 cm past the far face (`SPAN_OVERHANG_M`). The openings layer draws it as its room's floor looks (`floorLookOf`): the room's finish, its pattern where the room's shows; else a labelled room's `openingFloor` fill, else the background. Then a hairline threshold on the door line (selection blue when selected), then the leaf and swing. In 3D the threshold takes the same floor.

## Setting a floor finish

- **Palette, Floors group** (last on the rail): the Finishes switch, then a tile per floor motif at its defaults. A tile arms the Zone tool's Floor mode (`pickMotif`): "Click a floor to lay Planks".
- **Floor mode.** `floorTarget` (`tools/zone-tool.ts`) serves click and hover. At the floor level it takes a room's tag, then the level's deck under the point (`levelDeckAt`), then the room's floor; at an upper level, the level's own deck only. The click sets the motif's defaults and selects the target; an unlabelled room is labelled "Room N" in the same command. Off every deck at an upper level: "No floor at +2.15 here". The mode stays armed, through undo, until Esc or another tool.
- **Properties.** The Room section and a deck's Deck section show a Floor row ("Planks · Oak", or "None"). Open: Pattern, Colour, Custom, Strength (%), Size (m, three decimals) and Angle (°); Plain has no numbers. A too-fine pattern adds "Pattern too fine for this room" (or deck).
- A room shows its first label's finish, by ID in string order (`firstLabelId`); another label there reads "Set on <name>". A label outside every room shows nothing.

## On paper and in 3D

Exports draw floors with the canvas's builders ([export.md](export.md)). PNG and SVG follow the viewer's With or Without (default With); a PDF page follows its sheet's own `finishes` flag alone (default on). `look`'s plan draws none. The rooms table names the motif ("… · Planks").

In 3D a finished floor or deck top takes its colour, its lines and shapes 1 mm above (`Style3d.patternLift`), shapes without outline. A deck's sides keep their colour; a selected deck stays all selection blue. `look` in 3D always draws finishes.

## Wall sides and their defaults

A wall's left and right sides are seen from joint a toward joint b. A side has a finish and an optional lower band: a second finish from the side's bottom up to a height, 0.10 to 3.00 m in whole millimetres (`LOWER_HEIGHT`, default 1.20). On a side no taller than the band, the band covers it all. A column takes no finish.

`sideFinishes(doc, wallId)` (`packages/domain/src/queries/side-finishes.ts`, memoised) answers what each side shows, with its `source`:

1. its custom side, when the wall row holds one (`custom`);
2. else, facing a room, the walls default on the room's first label (`room`);
3. else, facing outside, the house's outside default (`outside`);
4. else nothing.

`wallSideRooms` (`queries/helpers.ts`) decides what a side faces, probing past each face at the wall's middle: a room, outside, or the loft ([levels.md](levels.md)). 3D, `look`, sections and Properties read through `sideFinishes`: repainting a room never touches a custom side, a new wall comes out finished, and deleting a label leaves its sides bare.

- A custom side always has a finish: None is refused ("A custom side needs a finish; Reset returns it to its room's"), and so is a band on a side with no custom finish. A default may hold a band alone.
- `setWallSide` writes a whole side, `setWallFinish` one part of a custom side, `resetWallSide` returns it to its default. `setOutsideFinish` creates the ceiling row if missing; `setCeiling` keeps the outside fields.
- A split copies the sides to both halves. A column heals into one wall only when the halves' custom sides match ([walls-rooms.md](walls-rooms.md)); a join needs what the sides show to match ([wall-editing.md](wall-editing.md)).

## Wall finishes in Properties

Every finish is one row, a swatch and "<pattern> · <colour>" ("to 1.20 m" for a band, or "None"). A click opens its fields under it, one row at a time (`properties/open-finish.ts`); a new selection closes it, and Esc closes it first.

- **A wall** has a section per side, named by what it faces: "Bath side" ("Room side" unlabelled), "Outside", or "Left side" and "Right side" when both face the same room or none (`sideNames`). An inherited side shows Finish and Lower read-only, its source ("Bath's walls", "Outside walls", "No room", or "On a loft": [levels.md](levels.md)) and Customize, which copies what it shows, or Plain White `#f2f0eb` (`PLAIN_WHITE`). A custom side shows "Custom" with Reset, then Finish (no None) and Lower.
- **A room** adds Walls and Lower under Floor: "Every side facing Bath shows these, but 2 custom".
- **Nothing selected:** an Outside walls section, its note counting the sides facing outside (no loft wall).
- **Under a slope** the Roof section has a Covering row.

## Walls in 3D and in sections

Each long side draws in bands (`sideBands` in `view3d/wall-faces.ts`): the band's finish below its height, the finish above, in its colour, at 0.87 where shaded. Its pattern (`view3d/wall-pattern.ts`) is laid up from the floor's 0.00 and along from the side's left end as you face it, cut by openings, clipped under a slope, 1 mm off the face. Ends, top, jambs and sills keep the wall's grey. The covering on the slab is in [roofs.md](roofs.md).

Under a flat ceiling the 3D panel's Roof switch is named Outside ("Show the outside walls"): on, no wall is hidden and no roof drawn. `look`'s `roof` does the same.

A section paints each wall face beyond its cut in its bands and pattern, with a line at a band's height (`wallPaint`; [sections.md](sections.md)). The plan never shows wall finishes or the covering.

## Colours and the picker

Floor rows offer twelve named swatches (`SWATCHES` in `properties/zone-finish.ts`); wall and roof rows six paints (White, Off-white, Charcoal, Navy, Barn red, Forest), then those. A colour off the list reads "Custom #rrggbb".

The Custom row (field id `hex`, flag `colour: true`) is a swatch opening the browser's colour picker, beside the hex typed for an exact value (`packages/web/src/panels/ColourField.tsx`). A pick commits once, as the picker closes: one edit, one undo step, focus back on the drawing. While Properties can't edit, a pick is dropped.

## Limits

- No ceiling finish: the 3D camera is always outside and above.
- No finish on a column, a deck's underside or sides, a joint cap or a wall top.
- One split per side, no splashback. A side is customised whole, with one Reset.
- No stone, slate or photo textures; no palette click mode for walls.
- A side faces one thing, found at the wall's middle.

## At levels

- Room floors draw only at the floor level (`floorsLayer`) and reach nothing on a loft.
- A deck's finish draws on the plan only at the level that owns it: a platform's at the floor, a loft's at its own level. Floor mode lays a platform's from the floor and a loft's from its level.
- Only doors on floor walls have spans. A door on a loft's wall has none; in 3D its threshold shows the deck's top, in its finish if any.
- A wall standing on a loft shows its custom finish or nothing ([levels.md](levels.md)). Its band is measured from its bottom, the deck's top; the pattern is laid from the floor's 0.00.
- 3D has no viewed level ([levels.md](levels.md)): every finish draws at once.
