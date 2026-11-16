# Heights and decks

Every wall, piece and deck has a vertical range above the floor (0.00), and the ceiling is a height. This document covers those ranges and the one collision rule that reads them, wall tops, a piece's height and elevation, how the plan shows heights, decks (the data, pieces on, over and under one, the landing rule, editing, the deck lock) and holes in decks. Levels and the cut are in [levels.md](levels.md).

## Ranges

A `Range` is `{ bottom, top }` in metres above the floor. `packages/domain/src/queries/vertical.ts` is the one place the domain turns wall tops, the objects' height and elevation maps, the ceiling row and deck tops into ranges. Outside the domain a lint rule forbids reading those fields.

| Thing | Range | Query |
|---|---|---|
| Wall or column, top "ceiling" | its base to the highest ceiling along it | `wallRange` |
| Wall or column, numeric top | its base to the base plus that height | `wallRange` |
| Free column topped by a deck | its base to that deck's underside | `wallRange` |
| Piece, numeric elevation | its surface's top plus the elevation, then its height | `rangeOf`, `placementRange` |
| Piece, elevation "ceiling" | what is over it less its height, up to what is over it | `overheadOver` |
| Solid deck | 0 to its top | `deckRange` |
| Hollow deck | its top less 0.12 m (`DECK_THICKNESS`) to its top | `deckRange` |

- A base is the floor (0) or a deck's top. `surfaceTop(doc, deck)` gives the top a piece stands on: 0 for the floor.
- `solids(doc)` lists walls, deck cells and the pieces' convex parts as boxes with a range.
- An opening's range is `openingRange` ([openings.md](openings.md)), and lowering a wall under its head is refused.

## The collision rule

Two things collide only when their shapes overlap on the plan and their ranges overlap in height. `rangesOverlap` treats ranges that touch, or overlap by no more than 1 mm (`EPS`), as apart. A desk (0.00–0.75) fits under a loft bed (1.45–1.80).

Three tests in `packages/domain/src/queries/fit.ts` apply it: `solidsCollide` for two solids, `deckClash` for a piece and a deck, and `aboveCeiling` for a piece and the ceiling. The whole-document check (`fitViolations`) and the test for one candidate (`footprintFit`) share them. The rule applies to:

- two pieces in one layout (I11);
- a piece and a wall or column (I10): a free-standing half wall, a column, a wall on another surface;
- a piece and a deck (I10, see "Pieces and decks");
- a deck and a wall or column (I18);
- a piece and the ceiling (I17): its top stays under the lowest ceiling over it (`ceilingOver`).

Kinds that bend the rule: [seating.md](seating.md), [furniture.md](furniture.md) (rugs), [stairs.md](stairs.md), [surroundings.md](surroundings.md) (wheel wells), [roofs.md](roofs.md) (beams).

No command checks heights itself: `validateDocument` does, in the editor and on the server. Refusals name the ranges or the ceiling (`collisionMessage` in `packages/domain/src/errors.ts`), in the toast and in Claude's reply: "Loft bed (1.45–1.80) and Wardrobe (0.00–2.05) overlap in Day".

## Wall tops and half walls

A wall's `top` is "ceiling", a number, or a deck's ID. "ceiling" is a full wall: it follows the ceiling. A number is a half wall: its height above its base, not above the floor. A deck's ID is a free column's only ([walls-rooms.md](walls-rooms.md)).

- `setWallTop { wallId, top }` (`packages/domain/src/commands/heights.ts`) takes "ceiling" or a number, kept to the millimetre. It refuses a column row and a deck's ID ("Only a free column on the floor reaches up to a deck").
- I17 (`packages/domain/src/ceiling.ts`): every wall and column is at least 0.10 m tall (`MIN_WALL_TOP`), and a fixed top reaches at most the lowest ceiling along the wall (`ceilingAlong`): "A wall can't be taller than the 2.20 m ceiling".
- Properties shows "To ceiling" (a switch) and "Top", the height above the base, read-only while the wall follows the ceiling. Switching "To ceiling" off stores the wall's present range as a fixed top: its height up to the highest ceiling along it.

## The ceiling as a height

The table `ceilings` holds at most one row, with the ID `ceiling`. With no row the ceiling is flat at 2.50 m (`DEFAULT_CEILING`). Its `height` is the flat ceiling, or a slope's low side; shapes, pitch and overhang are in [roofs.md](roofs.md).

- I17: the height is 1 to 10 m (`MIN_CEILING`, `MAX_CEILING`).
- `ceilingHeight(doc)` is the stored height. `ceilingOver(doc, ring)` is the lowest ceiling over a shape: under a slope, the lowest of the shape's corners.
- `setCeiling { height }` keeps the height to the millimetre and writes the one row. Every wall, piece and deck is checked again, so a ceiling lowered onto a piece, a deck, a half wall or an opening's head is refused with the values.

## A piece's height and elevation

An object carries two maps beside its widths and depths, one entry per configuration: `h`, the height, and `z`, the elevation.

| Field | Values |
|---|---|
| `h` | 0.01 m (`MIN_HEIGHT`) to 10 m (`MAX_OBJECT_SIZE`) |
| `z` | 0 to 10 m above the piece's surface, or the word "ceiling" |

- A numeric elevation is measured from the top of what the piece stands on (`elevationOf`).
- "ceiling" hangs the piece from what is over it: the lowest ceiling over its shape, or the underside of a hollow deck that is a level and overlaps it, other than the deck it stands on (`overheadOver`).
- `setObjectSize` takes partial `h` and `z` maps, kept to the millimetre; an unknown configuration is refused. `setObjectKind` resets heights and elevations to the new kind's defaults; a stair that reaches a deck keeps its rise ([stairs.md](stairs.md)).
- Properties has a Height section per configuration: Height, Elevation ("m above Loft" on a deck), an "At ceiling" switch, the top and its gap to the ceiling.

## How the plan shows heights

The plan is a horizontal cut. Walls ending under the cut draw as thin outlines, and walls and pieces wholly above it as dashed outlines with no fill or symbol, by the table in [levels.md](levels.md).

- **Stacking.** Pieces draw in `stackOrder`: lowest bottom first, then by ID, with places of their own for rugs, seats and stairs. Dashed pieces draw last.
- **Decks** draw in three layers (`decks-layer.ts`): `decks` under the pieces, `overheads` over the pieces and under the walls (the dashed outlines of decks wholly above the cut), and `deckLabels` after the openings.
- **Height texts.** A deck is labelled with its name and absolute top, "Loft +2.15" (`deckTitle`). The other height text on the canvas is the cut's chip ([levels.md](levels.md)); a wall's and a piece's heights read in Properties.
- **The flip.** `flipPoses` tweens each piece's bottom and top too, so a lift bed rises and falls ([layouts.md](layouts.md)).

## Decks

A deck is a raised rectangle shared by every layout. The table `decks` holds rows of `Deck`:

| Field | Meaning |
|---|---|
| `id` | `<opId>/k0` |
| `name` | free text; a blank name reads "Deck" (`deckLabel`) |
| `at` | the centre, in plan coordinates |
| `w`, `d` | width and depth, each at least 0.30 m (`MIN_DECK_SIZE`) |
| `rotation` | whole degrees, 0 to 359 |
| `top` | metres above the floor, 0.15 to 10 (`MIN_DECK_TOP`, `MAX_DECK_TOP`) |
| `solid` | true fills from the floor to the top; false is a hollow slab 0.12 m thick |
| `finish`, `guardFront` … `guardLeft` | [finishes.md](finishes.md), [guards.md](guards.md) |

A deck's top alone decides whether it is a platform, a raised floor or a loft: the table is in [levels.md](levels.md). The two presets (`DECK_PRESETS` in `packages/domain/src/presets.ts`) only fill a new deck's fields: `platform` ("Platform", top 0.45, solid) and `loft` ("Loft", top 2.15, hollow, so its underside is at 2.03).

`deckViews(doc)` (`packages/domain/src/queries/decks.ts`) turns a row into a ring, a range and a slab.

**The deck's own rules** are I18 (`deckViolations` in `packages/domain/src/decks.ts`), checked before fit:

1. The sizes and top are within the limits above. A deck that breaks them is checked no further.
2. The centre and the four corners each lie in a room or in a wall's body: "Loft must lie over the building".
3. The slab clears every wall and column under the collision rule, so a deck crosses a partition only where the partition's top is at or below the deck's underside: "Loft (2.03–2.15) overlaps a 2.50 m wall".
4. No two decks' slabs overlap on the plan; touching is fine, so steps can be a row of low decks: "Loft and Platform overlap". A deck may stand in another deck's hole.
5. The top is at or under the lowest ceiling over the deck: "Loft reaches 2.15 m; the ceiling is 2.10 m".

**Commands** (`packages/domain/src/commands/decks.ts`): `addDeck { opId, preset, at, … }` takes the preset's name (numbered when taken: "Loft 2"), top and solid flag, at 2.00 × 1.40 m (`DEFAULT_DECK_SIZE`), unrotated; any field given overrides the preset's. `setDeck { deckId, … }` sets any field. Lengths are kept to the millimetre.

## Pieces and decks

Each placement stands on the floor or on one deck: `deck` is a deck's ID or null, per layout. I9 refuses a placement naming a missing deck.

**On a deck** (`deckStanding` in `packages/domain/src/queries/stands-on.ts`), "inside its deck" takes the place of "inside one room". The tests run in this order:

1. No part of the piece overlaps a hole: "Bed stands over a hole in Loft in Night".
2. A piece wholly inside the deck's rectangle, within 1 mm, stands on it.
3. Otherwise the deck must be a platform, with its top at most 0.76 m (`PLATFORM_TOP`): on a higher deck the piece "lies outside Loft".
4. On a platform the piece may overhang: its centre is on the slab, every corner is inside the deck grown by 0.30 m (`OVERHANG`) in the deck's own frame, and every corner off the deck lies in the room of its centre.

**Its own deck is solid up to its top** for a piece standing on it. A piece hung "against the ceiling" that would dip below the top of its own deck collides with it.

**Over or under a deck it doesn't stand on** (`deckClash` in `fit.ts`), where the piece overlaps the slab on the plan: it collides if the ranges overlap, and otherwise it must lie wholly below the deck's underside. "Stool (2.15–2.60) is above Loft in Day, which it doesn't stand on". So a desk fits under a hollow loft, and nothing fits under a solid deck or floats over a deck. Two kinds are excepted: a beam meets a deck by range alone ([roofs.md](roofs.md)), and a stair clears a deck that leaves at least 1.00 m (`MIN_PASSAGE`) above its pitch line ([stairs.md](stairs.md)).

**Through a hole.** A deck meets everything as its slab's cells, so whatever overlaps no cell rises through the hole.

## The landing rule

`landing(doc, candidate, level)` in `packages/domain/src/queries/landing.ts` answers which surface one piece stands on when it is put somewhere new by position. It refuses nothing itself.

1. It lists surfaces in order: the piece's current surface, if it has one (at any level), then the level's candidates ([levels.md](levels.md)), where the deck under the footprint's centre is `deckUnder`'s: on the slab, so not in a hole; on a shared edge the higher top, then the lower ID.
2. The first surface where `footprintFit` says the piece fits wins.
3. When none fits, the answer is the first in the list, and validation refuses the edit with that surface's reason. An upper level with no candidate answers "none" ([levels.md](levels.md)).

Where it runs: the Object tool's ghost, click and drawn footprint; the set ghost and click, where a set lands as one block as tall as its tallest piece; a drag of one piece and its rotation grip, with their contact and settle searches; and Claude's `place_object` and `move_object` without `on`, and `place_set`, where a set lands as a 1 m block, all at the floor level. Everything else keeps each piece's surface and is refused if the piece does not fit there: group drags, nudges, duplicates (a copy stands on its source's surface), resizes, typed values, and changes of size, kind and configuration. Commands only set a surface: `placeObject { deck }`, `movePlacement { deck? }`.

A desk dropped under a loft stays on the floor; a chair dropped on a platform lands on it. Properties' "Stands on" picks a surface by hand: the floor, the deck under the piece's centre, or the deck it stands on, each as "Loft +2.15". It moves the piece there in place.

## Editing a deck

**The Deck tool** (`K`, `packages/editor/src/tools/deck-tool.ts`) works from the floor level. The floating bar picks the preset, Platform or Loft, per viewer (`deckPreset`).

- A press dragged past 4 px draws a rectangle along the world axes. Each corner snaps to a wall face corner, else onto a face, else to the centimetre; with Ctrl, to the centimetre only. A draft `addDeck` would refuse draws red.
- A click adds 2.00 × 1.40 m centred on the pointer.
- The new deck is selected and the tool stays. A refused release toasts the reason.

**A selected deck** (`deck-edit.ts`):

- A drag moves its centre by the snap step. Then a side within the snap tolerance of a wall face or of another deck's edge parallel to it lands on it (`snapDeckAt`). Ctrl turns both off.
- Arrow keys nudge it 1 cm, Shift 10 cm. Four side grips move one side, the opposite side fixed, to the centimetre, never under 0.30 m. There is no rotation grip.
- Properties: Name, Top, Solid, Width, Depth, Rotation, a row per hole, the finish and the guards. A typed size keeps the centre.

**What a change carries** (`setDeck`):

| Change | Pieces on the deck | Its holes |
|---|---|---|
| Move (a new centre, same size) | move with it, in every layout | move with it |
| Turn | refused while it carries a piece | turn about its centre |
| Resize, even one that shifts the centre | stay on the plan | stay on the plan |
| New top | stay on the plan and rise or fall with it | stay |

After any of them validation decides: a piece left outside the deck or a hole left outside it (I22) refuses the edit. A stair standing on or reaching the deck follows its top ([stairs.md](stairs.md)).

**Deleting** a deck is refused while a piece stands on it, unless the same command deletes that piece: "Loft carries Bed in Night; move it off first". The turn refusal reads the same. A deleted deck takes its holes with it.

## The deck lock

A deck that a wall or column row references, as its base (it stands on the deck) or as its top (a free column reaching up to it), keeps its place, size and turn and can't be deleted. `lockDeck` in `packages/domain/src/commands/deck-lock.ts` refuses a move, resize or turn in `setDeck`, and a delete unless the same command deletes the row.

- The refusal is an I21 violation naming the first such row by ID, and in plain words for people: "A column stands on Loft; move it first", "A column reaches up to Loft; move it first".
- A new top and a change of `solid` are not locked. The rows' ends move with the deck, and validation decides.
- Which decks can be a base or a top is in [levels.md](levels.md); the column's side of the rule is in [walls-rooms.md](walls-rooms.md).

## Holes in decks

A deck can have rectangular holes, so a stair rises through a loft. The table `deckHoles` holds rows `{ id, deck, at, w, d, guard }`, shared by every layout: `at` is the centre in plan coordinates, `w` and `d` the sides along the deck's axes, each to the millimetre. The ID is `<opId>/h0`. The guard is in [guards.md](guards.md).

**The hole's rules** are I22 (`packages/domain/src/deck-holes.ts`):

- its deck exists ("A hole is cut in a deck");
- each side is at least 0.30 m;
- it lies in its deck's rectangle and may reach the edge, which makes a notch;
- it overlaps no other hole of its deck; touching is fine.

**The slab** (`packages/domain/src/queries/slab.ts`) is the deck's rectangle less its holes, built in the deck's own frame (`deckFrame`):

```
 the loft and a notch         its slab as cells
 ┌───────────────┬─────┐      ┌───────────────┬─────┐
 │               │hole │      │      A        │     │
 │               └─────┤      ├───────────────┼─────┤
 │                     │      │      B        │  C  │
 └─────────────────────┘      └───────────────┴─────┘
```

- `cells`: the rectangle cut along every hole side into a grid, the cells in no hole, merged into convex rectangles. Every check against a deck tests them.
- `edges`: the boundary, the slab on the left of each, with the side or hole it lies on. A hole's sides are edges; a notch's open side is none.
- A hole side within 1 mm of the deck's side or of another hole's side is on it.
- The editor and Claude's tools find a hole through `holeView(doc, id)` and a deck's holes through `deckViews`. One editor module reads the `deckHoles` table directly (`packages/editor/src/tools/gap-edit.ts`).

A point is on a deck when it is in the rectangle and strictly inside no hole (`onSlab`), so landing, levels, "Stands on" and the hit test see the hole. A wall or column standing on a deck, or a column reaching up to it, may not lie over a hole (I21).

**Commands** (`packages/domain/src/commands/deck-holes.ts`): `addDeckHole { opId, deck, at, w, d }` and `setDeckHole { holeId, at?, w?, d? }`. Validation makes the refusals:

- a hole cut, moved or grown under a piece or a wall on the slab names it;
- a hole shrunk, moved or deleted from under something rising through it gives that thing's collision with the slab.

**The Hole tool** (`H`, `packages/editor/src/tools/hole-tool.ts`) stays at the level in view.

- With no deck in the drawing its button is off and `H` does nothing. It cuts the deck under the press (`deckForHole`): at the floor level any deck, a platform included; at an upper level only that level's decks. With no such deck under the press it sends no edit and toasts "A hole is cut in a deck".
- A drag past 4 px cuts along the deck's axes. Each corner takes the wall-face snap, then goes onto the deck's side or another hole's side within the snap tolerance; with Ctrl nothing snaps. A click cuts 1.00 × 1.00 m (`CLICKED_HOLE`) centred on the pointer. The new hole is selected.

**Editing a hole** (`hole-edit.ts`), at the floor level and at its deck's level:

- A click in a hole selects it; a deck standing in the hole is picked first.
- It moves, nudges and resizes as a deck does, landing on its deck's edge and its other holes' sides (`snapHoleAt`), never under 0.30 m.
- Selected alone, it shows a dimension from each side to its deck's edge along the deck's axes; a side on the edge has none. A click on one types a new distance, which moves the hole and keeps its size.
- Properties: Width and Depth about its centre, then its guard. Delete removes it.

**On the plan** a deck's fill is its slab with each hole open, and its outlines (solid, ghost or dashed) are the slab's edges. At its deck's level an empty hole is labelled "Open to below" ([guards.md](guards.md)). Stairs through a hole are in [stairs.md](stairs.md), the slab in 3D in [view3d.md](view3d.md), Claude's `add_deck`, `set_deck`, `add_hole` and `set_hole` in [mcp.md](mcp.md).

## Limits

- Decks and holes are rectangles. A deck is drawn along the world axes; a rotation is typed, and only while the deck carries no piece and no row references it.
- A hollow deck is always 0.12 m thick.
- Decks do not overlap on the plan, except a deck standing in another's hole.
- A deck changes no room, named area or tag. No round or polygon holes, and no holes in the ceiling.
- I18 tests only a deck's centre and four corners against the building. Over low walls a deck is refused when a corner lies in the square outside a wall junction, so it stops short of the outer corners, while an edge may pass outside the building between two corners, as across the missing quarter of an L-shaped shell.
- Under a shed or gable ceiling, switching a wall's "To ceiling" off is refused: Properties stores the highest ceiling along the wall, while I17 allows a fixed top only up to the lowest. So in Properties such a wall stays full; `setWallTop` with a height at or under the lowest ceiling still makes it a half wall.
- Claude's `place_object` and `move_object` pass no stair, wheel well or beam to the landing rule. Claude can land a beam on a platform where a click lands it on the floor, and be refused an open stair a click places.

## At levels

- **Ranges and collisions.** Every range is absolute, so the one collision rule holds for a thing on the floor, on a platform and on a loft alike. A piece's numeric elevation is measured from its platform's or loft's top. A half wall on a loft is measured from the loft's top.
- **Hanging.** A piece set to "ceiling" hangs from the lowest ceiling over it, or from the underside of a hollow loft whose slab overlaps it, on the floor, on a platform and on a loft alike. The deck it stands on never counts.
- **Standing.** On a platform (top at most 0.76 m) a piece may overhang by 0.30 m. On a raised floor and on a loft it lies wholly inside the slab.
- **The deck lock** concerns lofts only: a wall or column can take as base or top only a deck that is a level.
- Landing, the Deck and Hole tools and drawing at a level follow [levels.md](levels.md).
