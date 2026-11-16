# Surfaces and levels

The one rule for where a thing belongs in height: what it stands on (its surface) and which plan it belongs to (its level). This document covers that rule, the level each viewer looks at, how a plan is drawn, picked and furnished at a level, the level strip, and use zones on decks. Every other document's "At levels" section follows the rule given here. Nothing about levels is stored: they are worked out from the decks and the ceiling.

## Two words

```
 surface     what a thing stands on: the floor or one deck                 (stored)
 level       which plan it belongs to: the floor level, or a loft's        (derived, `levelOf`)
             floor level = the floor + platforms + raised floors below the cut

 stands on   a piece on its surface; a wall on its base
 hangs from  an elevation of "ceiling": the ceiling, or a loft's underside
 is over     a deck over a piece it doesn't carry: the piece lies wholly below it

 clearances  are measured from the surface of what owns them
 room things follow the level: they reach everything on the floor level and stop at a loft
```

- A piece's surface is its placement's `deck` (a deck's ID, or null for the floor). A wall's or column's surface is its `base` (a deck's ID, or `FLOOR_BASE`).
- A surface belongs to a level: `levelOf(doc, deck)` in `packages/domain/src/queries/levels.ts`. It answers the floor level for null, for a missing deck and for a deck below the floor's cut. `isFloor(level)` is true for the one level without decks.
- A piece belongs to the level of its surface (`placementLevel`). A wall belongs to the level of its base.
- An opening on a wall standing on a loft belongs to that loft's level. An opening on a floor wall shows at each level by its own height range (`openingShown`).
- A numeric elevation is measured from the surface's top. An elevation of "ceiling" hangs the piece from what is over it: the lowest ceiling over its footprint, or the underside of a hollow deck that is a level (`overheadOver` in `packages/domain/src/queries/vertical.ts`).
- Where a domain query takes a level, the argument is required. None defaults to "every level". Queries with no level argument, such as `clearanceWarnings`, are filtered by their caller. In the editor, `drawnBounds`, `footprintCorner` and `drawnFootprint` default their level to the floor: a caller at an upper level passes it.

## Decks by height

A deck's top alone decides what it is. The data, the landing rule's fit tests and holes are in [heights-decks.md](heights-decks.md).

| Deck | Top | A piece may overhang it | Its level | Under it |
|---|---|---|---|---|
| Platform | up to 0.76 m (`PLATFORM_TOP`) | yes, by 0.30 m (`OVERHANG`) | the floor's | solid, or stowed pieces |
| Raised floor | above 0.76 m, below the floor's cut | no | the floor's | nothing hangs under it |
| Loft | at or above the floor's cut | no | its own | a hollow one: pieces set to "ceiling" hang under it |

A wall or column stands on the floor or on a loft, never on a platform or a raised floor. Invariant `I21` (`packages/domain/src/wall-ranges.ts`) allows only a deck that is a level as a base, and requires one base per joint. A deck as a top goes only with a free column on the floor, and that deck is a level too. Any edit that would leave such a row on or under a deck below the cut is refused, a ceiling change included. So every wall whose base is a deck is on a loft.

## Levels and the cut

`levels(doc)` (memoised) answers the floor first, then one `Level { height, deckIds, cut, name }` for each distinct deck top at or above the floor's cut, ascending.

- The floor level has height 0, no decks and the name "Floor".
- Heights compare in whole millimetres: a deck makes a level when mm(top) ≥ mm(floor's cut). Tops equal to the millimetre make one level. It keeps its decks in ID order and is named after them, joined by ", " ("Loft, Bunk"); a blank deck name reads "Deck".
- The cut at a level is `cutAt(doc, base, rings)`: the level plus 1.20 m (`PLAN_CUT`), or half the way to the ceiling when that is lower, rounded to the millimetre. Under a sloped ceiling, "the ceiling" is the highest point over the level's decks, or over the whole roof for the floor. `cutHeight(doc)` is the floor's cut. At the boundary a bottom at the cut is above it and a top at the cut is below it (`relationToCut`).
- `levelHeight(level)` gives the text "+2.15", or "0.00" for the floor. The canvas chip reads "Cut +2.33" for the viewed level's cut.
- `ownsDeck(doc, level, deckId)`: the floor level owns the decks below its cut, an upper level owns its own decks. `levelDeckAt(doc, level, p)` is the owned deck under a point, so on the shared edge of two lofts at different heights each level reaches its own deck.

## The viewed level

Each viewer looks at one level, as each has an active layout. It is never stored, sent as an edit or undone.

- `EditorState.viewedDeck` holds null or a deck's ID. `viewedLevelOn(state, doc)` in `packages/editor/src/state.ts` is the one place that ID becomes a `Level`.
- The view holds one deck's ID, the level's lowest, not the level. It follows that deck's top when anyone raises or lowers the deck. When the deck is deleted or stops being a level, the view returns to the floor, even while another deck still makes a level at the old height. `settleLevel` then clears `viewedDeck`, so the view stays at the floor if that deck becomes a level again.
- The strip's viewed row and `stepLevel` compare levels by height, not by deck ID.
- Every change goes through `viewLevel` in `packages/editor/src/levels.ts`: the strip (UiAction `setViewedLevel { deck }`), Page Up and Page Down (`stepLevel`), picking a floor-only tool (`pickTool`), and picking a hole's row in Properties when the viewed level can't select that hole (`selectHole`, which views the floor). Escape never changes it. Opening another project resets it.
- `viewLevel` prunes the selection, and when the viewed height changes it cancels the gesture in progress with no toast (`dropGesture`), keeping the tool and the selection.
- `settleLevel(before, after)` runs after every event. On a fallback to the floor it drops the gesture. When the view follows its deck to a new height, it drops the gesture only if the earlier selection loses a member there, and it rebuilds the Object tool's ghost. It ends a Select press whose target, or whose zone chip's piece, the level can't select.

## Drawing at a level

`PlanView { layout, level, cut }` (`packages/editor/src/view/plan-view.ts`) is resolved once per picture and passed to `planPicture` and every layer builder. No layer reads the cut or the session itself. Which view a picture takes:

| Helper | Gives | Used by |
|---|---|---|
| `planView(state)` (`packages/editor/src/levels.ts`) | the active layout at the viewed level | the canvas, PNG and SVG |
| `floorView(doc, layout)` | the floor's view | project cards, Claude's `look` |
| `paperView(layout, level)` | a sheet plan's view | PDF pages |
| `viewAt(layout, level)` | the memoised view under all three | |

`viewAt` keeps one memo slot for the floor and one for an upper level; `paperView` shares the floor's slot and keeps its own for a loft, so a page never takes the canvas's view.

`relationAt(range, level)` classifies a height range: "under" (top at or below the level, to the millimetre; never at the floor), "below", "crossing" or "above" the cut. `hiddenAt(range, level)` is true for "under"; `shownAt` and `wallSeenAt` are built on it.

| Range at level L with cut C | Walls and columns | Decks | Pieces |
|---|---|---|---|
| a deck of L | | filled, with its label (`deckRelationAt`) | |
| under L | ghost: a light grey hairline, no fill | ghost outline, no label | hidden |
| above L, below C | thin outline | filled | drawn as normal |
| crossing C | solid | filled, heavier outline | drawn as normal |
| wholly above C | dashed outline, no fill | overhead line | dashed, no symbol |

Pieces follow `shownAt(doc, placementId, level)` at every level, the floor included: a level shows a piece when it is not under the level and does not belong to a higher level. A stair reaching the level is shown whole there (`reachesLevel`; see [stairs.md](stairs.md)). So the floor does not draw a loft's mattress, while a floor piece raised above the floor's cut draws dashed. The objects layer, use-zone warnings, the Day/Night flip, room tags' obstacles, guides and live distances all call `shownAt`.

An opening draws by `openingShown`: "cut" where the level's cut crosses its range (drawn whole, with its swing), "above" (dashed), or "hidden" (below the cut, under the level, or on a wall of another level's deck). Where an opening is hidden its wall draws across it.

At an upper level the picture has no room fills, room finishes, room tags, named areas or dimensions, and the Dimension tool's draft is not drawn. The tags layer carries the level's "Open to below" marks instead ([guards.md](guards.md)). Section marks and the underlay draw at every level. A deck's finish draws only at the level that owns the deck.

Ghost walls are a layer of their own, `ghosts`, first after the grid and before finishes, zone fills, deck floors and decks. A partition below the loft therefore runs under the loft's fill and pieces. One memoised build serves the `ghosts` and `walls` layers.

A hidden piece takes its use zones, its warnings and its flip with it. A use-zone warning shows at every level that shows the piece owning the zone, and keeps every blocker, even one the level hides. A swing warning shows at every level whose cut crosses its door, and drops the blocking pieces that level hides (`shownBlockers` in `packages/editor/src/view/warnings.ts`). A tall piece or a floor door can therefore warn at two levels.

Other pictures: PNG and SVG draw the viewed level in the active layout, framed as the floor is so images of two levels line up. Each plan on a PDF sheet names its own level ([export.md](export.md)). Project cards and Claude's `look` draw the floor. The 3D view does not change with the viewed level.

## Selecting and tools

`selectableAt(doc, layout, ref, level)` in `packages/editor/src/tools/selectable.ts` gates the hit test, box selection and the kept selection.

| Thing | Selectable at the floor | Selectable at an upper level |
|---|---|---|
| Piece | shown there and belonging to the floor level | shown there, standing on the level's decks, in the active layout |
| Deck, hole | any | the level's decks and their holes |
| Wall, column | any | those based on the level's decks |
| Joint | a floor wall's, never a column's | one of a wall based on the level's decks, never a column's |
| Opening | any on a floor wall, even under the cut | those the level draws |
| Section | any | any |
| Room tag, named area, dimension | any | none |

`pruneSelection` drops from the selection and the hover whatever the viewed level can't select. It runs after commits, undo and redo, remote changes and level switches. No gesture moves a piece between a loft and the floor: the floor does not grab a loft's piece, and at the loft a drag past the edge is refused. Properties' "Stands on" moves it, and the piece then leaves the selection.

Tools (`packages/editor/src/tools/tool-table.ts`):

| Tools | At an upper level |
|---|---|
| Select, Object, Wall, Column, Opening, Hole | work there |
| Zone, Dimension, Section, Deck, Scale (`floorOnly`) | picking one views the floor first; moving the view up drops one to Select |

- The Zone tool's Floor mode is the exception (`floorOnlyNow`): it stays at any level and lays finishes on the level's own decks. A click off every deck there toasts "No floor at +2.15 here".
- Wall and Column build on the level's deck under the point (`baseAt` in `packages/editor/src/tools/column-refs.ts`), so a loft takes partitions and knee walls. See [walls-rooms.md](walls-rooms.md) for walls on a loft.
- The Opening tool reaches a wall standing on the level's own surface, or a floor wall the level's cut crosses, such as the shell seen from a loft (`wallOpenableAt`).
- The Hole tool cuts the deck under the press: at an upper level only that level's decks, at the floor any deck (`deckForHole`).

## Placing at a level

The landing rule, `landing(doc, candidate, level)` in `packages/domain/src/queries/landing.ts`, is in [heights-decks.md](heights-decks.md): the piece's current surface first, then the level's candidates, the first it fits on winning. The level decides the candidates and one more answer, `Landed`'s `{ kind: "none" }`:

- At the floor level the candidates are the floor, then the deck under the centre among the decks below the floor's cut. A piece never lands newly on a loft from the floor level.
- At an upper level the only candidate is that level's deck under the centre.
- At an upper level with none of its decks under the centre, a piece that does not fit its current surface (or has none) lands on "none".

"None" is refused by the editor, not by an invariant. A drag that answers "none" is the `DragTry` variant `noFloor` and never commits. The Object tool's ghost carries `noFloor`, draws red and its click sends nothing. Both toast `noFloorAt(level)`: "No floor at +2.15 here".

Snaps use `wallSeenAt` (`packages/editor/src/snapping/near-walls.ts`): at the floor every floor wall and no wall on a deck; at an upper level every wall not under the level, so the shell and the walls on the level's decks. Guides and live distances use only the pieces the level shows. A group move carries no surface (`Places`), so each piece keeps its own.

Claude works at the floor level: `place_object` and `move_object` without `on` follow the floor level's landing rule, and `on` picks any deck ([mcp.md](mcp.md)). They pass no stair, wheel well or beam to it, so for those pieces Claude's answer can differ from a click's ([heights-decks.md](heights-decks.md)).

## The level strip and presence

`LevelStrip` (`packages/web/src/panels/LevelStrip.tsx`) sits in the pill dock at the bottom centre of the canvas, 8 px left of the layout pill and bottom-aligned with it.

- One row per level, highest first: its height and its name ("+2.15  Loft", "0.00  Floor"). The viewed row is pressed. A click views that level and sends the level's lowest deck ID.
- The strip is hidden while the drawing has only the floor level. The view model is `levels: { rows: { deck, height, name, viewed }[] } | null`.
- Page Up and Page Down step one level and do nothing past the ends. They are ignored with Ctrl, Cmd or Alt. The keys and the strip are ignored while a value is being typed.

Presence carries a required wire field `level`: the viewed deck's ID while it is a level, else null. The protocol validates it and the server relays it. The editor sends presence when the layout or this ID changes. Each receiver resolves the ID in its own document; an ID it doesn't hold as a level reads as the floor. A remote cursor's label joins name, other layout and level name with " · ". The level name shows only when that level's height differs from the viewer's.

## Zones on decks

A use zone has a band in height: from its piece's surface to 1.20 m above it (`ZONE_CLEAR_ABOVE`). The rule lives in `packages/domain/src/queries/clearance.ts` alone. Use zones themselves are in [furniture.md](furniture.md).

```
   loft top 2.45 ─┬──────────────── band of a loft piece's zone: 2.45 → 3.65
                  │  bed ▭   books ▮      the bookcase blocks the bed's zone
   underside 2.33 ┴────────────────
      wall, top 2.33 ┃              a floor wall stopping under the loft blocks no loft zone
   floor 0.00 ─────────────────────  band of a floor piece's zone: 0.00 → 1.20
```

- A piece or a wall blocks a zone when it overlaps the zone on the plan and its height range reaches into the band.
- A piece whose bottom is 1.20 m or more above its own surface owns no zone that warns: a hung shelf, a wall cabinet.
- What lies wholly at or below the surface does not block: a bed stowed under a platform.
- Every wall counts by its range. A full floor wall blocks floor zones. A wall standing on a loft blocks the loft's zones and no floor zone.
- On a platform the band rises with it: on a 0.45 m platform it runs 0.45 to 1.65 m. There is no special case for platforms.
- A door on a wall standing on a loft has a swing zone as a floor door has: the same rectangle on its opening side, cut at the deck's edge, with its band starting at the deck's top. A swing wholly past the edge is no zone. A floor door's band is 0.00 to 1.20 m.

## Room features at a loft

A room's features reach everything on the floor level and stop at a loft, which has no room. The levels table, `packages/domain/test/levels-fixture.test.ts`, holds one row per room feature and per-level query; a new one adds a row.

- **Rooms, tags and areas.** Rooms come only from floor walls (`isFloorWall`). A closed loop of walls on a loft makes no room, tag or area and changes none under it. Named areas stay with the floor's room.
- **Pieces in a room.** A piece on a platform or a raised floor counts in its room. A piece on a loft takes no free floor from the room under it and does not make that room furnished, whatever its height.
- **Free floor.** Counted at the floor level only, with the floor's 1.20 m.
- **Wall finishes.** A wall standing on a loft shows its own custom finish on a side, else nothing: no room's walls default and no outside default reaches it. It is not listed under Outside walls, and setting a room's walls at once leaves it alone. In Properties its sides read "Left side" and "Right side", and a side with no custom finish says "On a loft".
- **What a wall side faces.** `wallSideRooms` answers one of three: a room, outside, or the loft. Each caller handles the three in a switch ending in `assertNever`.
- **The wall chain.** A loft wall's openings are measured at the loft's level, not at the floor.
- **Clearances.** Use zones and door swings on a loft are blocked by what stands on the loft, not by what is under it.
- **Shown and picked.** A loft's pieces, and the openings of a wall standing on it, draw and select at the loft's level only. A platform's pieces draw and select at the floor, with the floor's. A floor or platform piece whose top is above a loft also draws at the loft, where it can't be selected.

## Limits

- A loft has no rooms, tags, areas, free floor or wall-finish default of its own. Rooms get no outline at an upper level: the ghost partitions and the shell show where they are.
- A piece's elevation is one number on the piece, measured from its surface, while its surface is per layout. A piece standing on different surfaces in two layouts moves in both when its elevation is typed in one.
- The floor's cut follows the ceiling, so under a ceiling below 2.40 m a deck lower than 1.20 m can be a loft. Raising the ceiling is refused while a wall or column stands on, or a free floor column reaches up to, a deck that would stop being a level. A piece hung under such a deck is no reason for refusal: it hangs from the ceiling after the change, and the edit is refused only if its new place breaks another rule.
- A deck whose top is at the ceiling makes a level whose cut is the level itself: every full wall is "under" it and draws as a ghost.
- The 3D view has no viewed level: no highlight and no cut. Claude's `look` and its placing without `on` stay at the floor level.
- PNG and SVG images at a loft use the floor's frame, so they keep a blank margin where the hidden floor pieces would be.
- The guard is by example and reminder. The levels table and the "At levels" sections do not prove a feature right at every level, and the compiler guards only a caller that switches over the three answers of `wallSideRooms`.
- Storeys are not built. A loft stays inside its storey's walls; no level carries rooms.
