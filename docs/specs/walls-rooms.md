# Walls and rooms

Walls are the drawing's graph: joints are its points and walls its edges. Rooms are not stored: they are the closed faces of that graph. This document covers the wall and joint rows, what `addWall` does, outlines and mitres, how rooms are found, labels and tags, columns, named areas, the wall chain, and walls standing on a loft.

## Walls and joints

A joint is `{ id, x, y }` in metres, y up. A wall is a row of the `walls` table (`Wall` in `packages/domain/src/model.ts`):

| Field | Holds |
|---|---|
| `a`, `b` | its two joints; "left" and "right" are seen from a toward b |
| `thickness` | metres, centred on the centreline |
| `top` | "ceiling", a height from its base, or a deck's ID (a free column only); see [heights-decks.md](heights-decks.md) |
| `base` | `FLOOR_BASE` ("floor") or the ID of the deck it stands on |
| `column` | true for a column row |

It also holds its finishes per side ([finishes.md](finishes.md)).

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_WALL_THICKNESS` | 0.20 m | a wall drawn without a thickness |
| `SIZE_LIMITS.wall.thickness` | 0.05 to 0.50 m | `MIN_WALL_THICKNESS`, `MAX_WALL_THICKNESS` |
| `SIZE_LIMITS.column` | 0.10 to 2.00 m | a column's width and its depth |
| `EPS` | 0.001 m | "at the same place": joints, a point on a wall, touching |
| `MIN_EDGE` | 0.01 m | the shortest wall |
| `MIN_FACE_AREA` | 0.01 m² | the smallest room, by centreline area |

`wallFrame(doc, wallId)` in `packages/domain/src/graph.ts` gives a wall's ends, unit direction, left normal, half thickness and length. `wallBodies` (`packages/domain/src/queries/footprints.ts`) gives each row's body: a rectangle from joint to joint, with flat ends.

**Thickness.** `setWallThickness` changes one wall. A value outside the limits is refused with "Wall thickness must be between 0.05 and 0.50 m"; `addWall` refuses it with the same text.

## What changes the topology

Five commands add, remove or re-end wall rows:

| Command | What it does to the graph |
|---|---|
| `addWall` | adds a row and up to two joints; splits up to two walls |
| `splitWall` | splits one wall |
| `connectJoint` | merges a joint into another, or splits the wall it lands on; it lands by the rule of `addWall`'s ends, columns left out |
| `deleteEntities` | removes rows and unused joints; heals an in-line column; stitches a straight joint's two walls into one |
| `placeColumn` | adds a row and two joints; in a wall's line it splits the wall into wall, column, wall |

The others (`moveJoints`, `moveWalls`, `setWallLength`, `straightenWalls`, `setColumn`) only move joints. All but `addWall` and the column commands are in [wall-editing.md](wall-editing.md).

## What `addWall` does

`addWall { opId, from, to, thickness?, base?, top? }` (`packages/domain/src/commands/add-wall.ts`). Each end is `{ existing: jointId }` or `{ at: point }`. In order:

1. **Checks.** The operation ID is unused. `base` is the floor or an existing deck. `top` is "ceiling" or a height from the base, kept to the millimetre; a deck as top is refused ("Only a free column on the floor reaches up to a deck").
2. **Resolve each end** (`resolveEnd` in `commands/wall-ends.ts`). An existing joint is taken as it is. A point within `EPS` of a joint whose walls all stand on the new wall's base becomes that joint. Otherwise a point within `EPS` of a wall on that base splits the wall at the closest point. Otherwise it is a new joint. Of equal distances the smallest ID wins.
3. **Columns are locked.** An end on a column's joint, or one splitting a column, is refused.
4. **Length.** Ends closer than `MIN_EDGE` give "Wall too short". Two ends that split the same wall give "Walls can't overlap".
5. **Split** (`splitWallAt` in `commands/split-at.ts`, shared with `splitWall`). The split wall keeps its ID from its joint a to the new joint. A fragment copies its row and runs on to joint b, taking the openings past the split, which keep their place in the world. A split inside an opening is refused, and so is one leaving a piece under 1 cm ("Intersection would create a wall shorter than 1 cm").
6. **Overlap and crossing**, against every wall whose height range overlaps the new wall's. Sharing both joints with a wall, or lying along one, gives "Walls can't overlap". Meeting a wall anywhere but at a shared end joint gives "Walls can't cross". Against a column the refusal names the column and the wall.
7. **Validate** with `validateDocument` ([domain.md](domain.md)).
8. **Labels.** See `keepLabelsInRooms` under Labels.

IDs come from the operation ID: the new wall is `<opId>/w0`; split fragments are `<opId>/w1`, `<opId>/w2`; new joints are `<opId>/j0`, `<opId>/j1`; each in from-then-to order.

## Wall outlines and mitres

`wallOutlines(doc)` in `packages/domain/src/queries/outlines.ts` gives one counter-clockwise polygon per wall row. `wallCorners` gives each wall's two ends, and `jointOrder` each joint's walls counter-clockwise.

At each joint each wall's left edge meets the facing edge of the next wall counter-clockwise, and its right edge the next one clockwise. Both edge lines are offset by their own wall's half thickness, and both walls compute the corner from the same two lines, so the corner is shared.

| Case | The end |
|---|---|
| One wall at the joint | flat at the joint, no extension past it |
| Straight through | equal thickness: one continuous edge; different thickness: both end flat, a step |
| Nearly straight, unequal: the edge lines meet ahead of one wall and behind the other | both end flat |
| Outer tip farther than 4 times the thicker wall's half thickness from the joint (`MITER_LIMIT`) | a bevel: equal walls share the midpoint of their two edge points; unequal walls end flat |
| Otherwise | a mitre: the edge lines' intersection |

- At a joint of three or more walls each outline also passes through the joint point.
- Inner corners stay inside the wall. On each side, when the reaches of the two ends' inner corners along the wall sum to more than the wall's length less 2 mm, both are scaled so they meet.
- `faceExtent(doc, wallId, side)` in `packages/domain/src/queries/helpers.ts` reads where a face starts and ends from the outline, so corners, T-junctions, steps and bevels end a face as drawn.

## A full wall meeting a half wall

The plan is a cut ([levels.md](levels.md)): a wall crossing it is filled, one ending at or below it is an outline, and at an upper level a wall under the level is a ghost. Where one filled wall meets an unfilled one, the filled wall takes the joint (`takenEnd` in `packages/editor/src/view/walls-layer.ts`).

The unfilled wall ends in a cut straight across its own width, starting at its corner that reaches furthest along it. The area up to that cut is filled in the filled wall's colour. Its length along the wall is the thickness divided by tan(half the angle between the walls): the thickness at 90°, longer at a sharper angle until the outlines bevel, and nothing as the walls approach a straight line.

It applies to:

- an L: two walls, one filled, both sides of the unfilled end being mitre tips;
- a T whose stem is the one filled wall and whose bar is two unfilled walls in line, of equal thickness (compared exactly), exactly one side of the unfilled end being a mitre tip.

Every other joint keeps its drawing: four or more walls, a T with a filled wall in the bar, walls in line, and a corner the outlines bevel or end flat.

**Joint shares** (`jointShares`). At a joint of three or more walls with two or more filled walls, each unfilled wall's share of the joint (from its corners to the joint point) is filled in the filled walls' colour, with a face line across its end. This holds for a wall below the cut and for a ghost alike. A wall wholly above the cut is a dashed outline and takes no share.

## Rooms

`zones(doc)` in `packages/domain/src/queries/zones.ts` gives the rooms, sorted by key and memoised by document identity. `boundedFaces` in `queries/faces.ts` finds them:

1. Take only rows standing on the floor (`isFloorWall`).
2. Remove bridges: walls that belong to no cycle. They bound no room and take no area.
3. Group the remaining walls into connected groups and walk each face with its interior on the left. A counter-clockwise walk of at least `MIN_FACE_AREA` is a room. Each group's clockwise outside walk, of any size, is a hole.
4. A hole belongs to the smallest room of another group that contains the group's leftmost joint (smallest x, then y, then ID). An outside walk no room contains is dropped.
5. A free column is a hole of the smallest room around its centre, its body the ring.

So walls that close a loop inside a room (a stair core) cut a hole in it: the room's area leaves the group out, and the loop's inside is a room of its own.

A room (`Zone`) has `face`, `floor`, `area`, `unavailable`, `labelIds` (sorted by ID) and `holes`. The face's `key` is the sorted wall IDs of its outer ring, joined with "|". Holes are not part of it.

**The clear floor** (`insetFloor` in `queries/area.ts`). Each boundary edge is offset inward by half its wall's thickness and consecutive offset lines are intersected; collinear edges of equal thickness merge first, and between collinear edges of different thickness the floor steps across at their joint. It is accepted only as a simple polygon of positive area whose every edge keeps its source edge's direction.

**A hole has two shapes.** Its outline is the centreline walk; it decides which room a point belongs to. Its footprint (`holeFootprint`) is the outline pushed out by half of each wall's thickness; it decides area, the floor drawn and where a tag or a moved label may go. A free column's outline and footprint are both its body.

**Area.** A room's `area` is its floor less every hole's footprint. It is null, with a reason in `unavailable`, when:

- the outer walk repeats a joint ("Area unavailable: unsupported boundary"); such a room also holds no labels;
- the floor or a footprint fails the offset checks, a footprint reaches more than `EPS` outside the floor or into another footprint, or 1 mm² or less of floor is left ("Area unavailable: unsupported geometry"). Touching within `EPS` is accepted.

**Points.** `faceAt(doc, p)` gives the innermost room around a point (the smallest by centreline area), or null outside every room, within `EPS` of that room's boundary, or when that room's walk repeats a joint. It reads outlines only, never footprints. `onFloor(zone, p)` in `queries/floor.ts` is true inside the outer floor and in no footprint. `interiorPoint(zone)` is a point on the floor at least `EPS` from every edge, or null.

## Labels

A room's name is a `zoneLabels` row, `{ id, at, name, finish }` plus the room's wall defaults ([finishes.md](finishes.md)).

- A label resolves to `faceAt` of its point. A label that resolves to no room is an orphan (`orphanLabelIds`); its tag reads "no enclosing walls".
- `labelZone { id, at, name, finish }` (`commands/labels.ts`), with `finish` a finish or null, refuses a point in no room ("The point is in no room"), a room that already holds a label ("This room already has a label") and a name over 200 UTF-16 units. `renameZone` changes the name only.
- A label keeps its room through a move of joints, a wall resize or a new wall, while the room keeps its face key. `keepLabelsInRooms` then moves a label whose point left the room to the room's `interiorPoint`. When the edit changes the room's key (a new wall's end splits one of its walls), or the room is gone, the label stays where it is and resolves by its point. The column commands do not call it.

**Merged rooms.** When `deleteEntities` removes a wall and one supported room then holds exactly two labels that resolved to different rooms before, they combine. Labels are taken in ID order: the first keeps its ID and point, its name becomes the two names joined with " / " ("Kitchen / Dining"), and the second is deleted. An orphan that lands in the merged room does not combine, and with three or more labels nothing combines.

## Tags

A tag is the text drawn for a labelled room (`tagLayout` in `packages/editor/src/view/tags.ts`), centred on the label's point: the name; the clear size ("4.20 × 3.10 m") when the floor is a rectangle and the room has no hole other than free columns; and the area or "Area unavailable", followed in a furnished room by the active layout's free floor ([layouts.md](layouts.md)). The first set whose box has its four corners on the room's floor is used: all lines, then without the size, then the name alone; if none fits there is no tag. An orphan always shows its lines. An unlabelled room that holds furniture gets a one-line tag at its `interiorPoint` (`roomTagLayout`).

**Tags keep off furniture** (`tagOffset` in `view/tag-spot.ts`). A tag whose spot is taken moves to the first free spot, nearest first, of a 0.25 m lattice out to 2 m; with none free it stays. A spot is free when the box's four corners are on the floor, no corner of the floor or of a hole lies inside the box, and the box overlaps no obstacle beyond touching. Obstacles are every wall body, the label box of every deck drawn at the floor, and every piece of the active layout the floor level shows, rugs left out. Orphans never move. Tags do not avoid other room tags.

## Columns

A column is a wall row with `column: true`. Its width is its centreline's length (joint a to b) and its depth is its thickness. `columnOf(doc, wallId)` in `packages/domain/src/column-checks.ts` gives its centre, width, depth, rotation (degrees counter-clockwise) and `line`.

```
 free      ┌───┐      in a wall's line     ════┌─────┐════
           │ C │      (the wall is split)      │  C  │
           └───┘                           ════└─────┘════
```

**One writer.** Only `placeColumn`, `setColumn` (`commands/columns.ts`) and `deleteEntities` change a column's geometry. A wall command on a column row, or on a joint a column touches, is refused: "Column C1 can't be edited as a wall; edit its position, width and depth". `addOpening` and deleting a column's joint give the same refusal. `moveWalls` carries a column in a wall's line rigidly when both its joints move, and refuses a free column with "Free columns move on their own". The wall finish commands refuse with "A column takes no finish".

**Checks (`I20`, `columnViolations`).** Width and depth lie in 0.10 to 2.00 m, compared within 0.5 mm. A column has no wall at either end, or exactly one at each end with all three in one line. Its body stays `EPS` clear of every other wall body whose height range overlaps its own (an in-line column's two walls apart); a wall on another base may touch it but not overlap it. An in-line column is at least as deep as each of its walls.

**Free.** `placeColumn { opId, at, width, depth, rotation?, base?, top? }` writes row `<opId>/w0` with joints `<opId>/j0` and `<opId>/j1` at the centre ∓ half the width along the rotation. On the floor the centre must be in a room ("A column stands inside a room"); on a deck, inside the deck.

**In a wall's line.** When the centre lies in the body of a wall with the same base that is not a column (`wallUnder`, `placeInLine` in `commands/column-line.ts`; the closest, then the smallest ID), the column goes into that wall's line: wall, column, wall, centred on the centreline. It takes the wall's direction, base and top, whatever `rotation` and `top` say. The wall keeps its ID up to the column; `<opId>/w1` is the half past it. Each half keeps at least 1 cm ("A column needs at least 1 cm of wall on each side"). The column can't cover an opening, and openings past it keep their place in the world.

**Moving and sizing.** `setColumn { wallId, at?, width?, depth?, rotation?, top? }` keeps what is not given. An in-line column slides along its line only (`slideInLine`): the halves stretch and shrink, openings keep their place, and a slide that would cover or pass an opening is refused. It can't turn ("A column in a wall's line turns with its wall") or take a top of its own.

**Deleting** an in-line column heals the wall (`healColumn` in `commands/column-heal.ts`). Halves alike in thickness, top, base and finishes merge into the half at the column's joint a, which keeps its ID. Otherwise the column's row becomes a plain wall like the thinner half (the first when equally thick). Openings keep their place. When one of the halves is deleted in the same command there is no heal: the column goes as any row.

**Base and top.** A column stands on the floor or on a loft. A free column on the floor may take a deck as its top: it reaches up to that deck's underside and must lie under the deck. A row on a deck can't stand over a hole in it. `I21` (`wall-ranges.ts`) checks the references. The Column tool sets them with `columnRefs` (`packages/editor/src/tools/column-refs.ts`). A deck that a row references can't be moved, turned, resized or deleted ([heights-decks.md](heights-decks.md)).

**Area.** A free column is a hole of its room. An in-line column changes the room's boundary as any wall does.

## Named areas

A named area names part of one room without a wall. It is a label only: no fit, warning or free floor reads it. The Zone tool draws it ([tools.md](tools.md)).

- **Data.** A row of `areas`, `{ id, name, at, w, d }` (`packages/domain/src/area.ts`): a rectangle square to the page, centred at `at`, `w` along x and `d` along y, kept to the millimetre, shared by every layout. IDs are `<opId>/a0`.
- **Rules.** Each side is at least 0.30 m (`MIN_AREA_SIZE`). Two areas may touch but not overlap (`I26`, `validate-areas.ts`; "Overlaps Kitchen"). `addArea` and a move by `setArea` need the centre in a room ("Draw an area inside a room"); a resize or a rename does not. That rule lives in the commands only, so a wall edit is never refused for an area and can leave one with its centre in no room. `addArea` without a name takes the first free "Area N".
- **Its room and m²** (`areaRoom`, `areaM2` in `queries/areas.ts`). The room is `faceAt` of the centre. The m² is the rectangle cut to that room's clear floor, every part under it counted, less the hole footprints in it. It is null when the centre is in no room or the room's area is unavailable.
- **Tag** (`areaTagLayout` in `packages/editor/src/view/area-tags.ts`). The name over the m², hidden line by line when it does not fit inside the rectangle and on the floor. It moves by the room tags' free-spot rule, inside the rectangle and clear of the room tags. With its centre in no room it reads "no enclosing walls".

## The wall chain

`wallChain(doc, wallId, level, moving?)` in `queries/helpers.ts` gives the lengths shown along a selected wall: its measured face from start to end, cut at its openings' edges into pieces with role "gap" or "opening".

- **The face** (`wallFace`). The side facing a room. A divider (rooms on both sides) and a free wall (none) take the left of a to b. Its start and end come from `faceExtent`.
- **Pieces.** An opening piece is always the opening's full width; one reaching past the face sticks out of it. Pieces under 1e-6 m are left out. `moving` replaces the opening with its ID, or joins the chain as a preview.
- **Per level.** `level` is required. The chain measures the openings drawn solid at that level (`openingShown` is "cut"), then the dashed ones ("above") that overlap none of those along the wall.

## Walls on a loft

A wall's `base` is the floor or a deck that is a level; [levels.md](levels.md) has the levels side. On the wall side:

- **One base per joint.** Every row at a joint has the same base (`I21`). `addWall` resolves its ends only onto joints and walls of its own base.
- **Flush ends** (`flushEnd`). An end of a new wall on a deck that meets nothing of its own base but lies in the body of a wall of another base, with overlapping height range, stops on that wall's face. That wall is not split.
- **Pair checks by height.** Coinciding joints, crossing, a joint on a wall and overlap (`pairViolations` in `packages/domain/src/wall-pairs.ts`) apply only to walls whose ranges overlap; touching ranges do not. A loft wall may cross over a partition that stops under the loft.
- A wall on a deck lies inside the deck.

## Limits

- A wall group that touches its room's walls at a single joint repeats a joint in the walk: that room has no area and no labels.
- A counter-clockwise walk under `MIN_FACE_AREA` is no room, but its group's outside walk is still a hole of the room around it.
- Not supported for columns: one at a wall's end, at a corner or with a wall ending on it; round columns; grips; a wall topped by a deck.
- A loft wall meeting the shell at an angle is refused when its square end reaches past the deck's edge.

## At levels

- **Walls.** On the floor or on a loft, never on a platform or a raised floor (`I21`). The taken end and the joint shares follow the viewed level's cut.
- **Rooms, labels, tags, named areas.** Floor only: rooms come from floor walls, so a loft has none, and nothing on a loft changes a room's area, key or label. A piece on a platform counts in its room ([levels.md](levels.md)).
- **Columns.** On the floor, on a loft, or on the floor under a loft with the loft as top. A column on a loft is no hole of the room under it.
- **The wall chain.** Always one level's: a loft wall's openings are measured at the loft, not at the floor.
