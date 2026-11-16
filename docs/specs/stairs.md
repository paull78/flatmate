# Stairs

Stairs and ladders are pieces sized by their box: width, depth (the run) and height (the rise). This document covers the kinds, risers and goings, what a stair reaches, drawing one from a deck's edge, landings, stairs through holes, the checks, how a stair draws, and what Claude's stair tools take. Guards and handrails are in [guards.md](guards.md), decks and holes in [heights-decks.md](heights-decks.md), levels in [levels.md](levels.md).

## Kinds

A kind is a stair when its `stair` column holds a `StairRule` (`STAIR_RULES` in `packages/domain/src/stairs.ts`, read with `stairRuleOf` in `packages/domain/src/kinds.ts`). Code reads the rule's `shape` (`flight`, `winder`, `spiral`, `ladder`) and `body`, never a kind ID.

| Kind (ID) | Default width × run × rise | Largest riser | Recommended going | Under it | Makes an L |
|---|---|---|---|---|---|
| Stair (`stair`) | 0.90 × 2.99 × 2.15 | 0.19 | 0.63 − 2 × riser, kept 0.25 to 0.30 | solid | yes |
| Open stair (`openStair`) | 0.90 × 2.99 × 2.15 | 0.19 | as the stair | open, a piece may stand there | yes |
| Storage stair (`storageStair`) | 0.60 × 1.99 × 2.15 | 0.23 | 0.508 − 4/3 × riser | solid, cubby doors | yes |
| Storage steps (`storageSteps`) | 0.60 × 0.70 × 0.45 | 0.19 | 0.35 exactly | solid, a drawer per step | no |
| Winder stair (`winderStair`) | 0.90 × 3.07 × 2.15 | 0.19 | as the stair, on its straight treads | solid | no |
| Ship's ladder (`shipsLadder`) | 0.60 × 1.10 × 2.15 | 0.241 | a 60° climb | open | no |
| Alternating tread (`alternatingTread`) | 0.60 × 1.12 × 2.15 | 0.22 | a 60° climb | open | no |
| Rung ladder (`rungLadder`) | 0.45 × 0.58 × 2.15 | 0.30 (rung spacing) | a 75° climb | its box | no |
| Spiral stair (`spiralStair`) | 1.60 × 1.60 × 2.15 | 0.22 | 30° a tread, round a 0.13 m column | its box | no |

- A placement's `at` is the middle of the stair's back edge. The front edge is the bottom step and the back edge the top, so rotating a stair turns the way it climbs.
- A spiral's box stays square: a resize and a drawn footprint keep width and depth equal (`squareSize` in `packages/domain/src/queries/stairs.ts`).
- Properties' Kind row switches a stair to another stair kind (`setObjectKind`); Claude has no tool for it. Width and run stay (a spiral takes its kind's default size). A linked stair keeps its rise; an unlinked one takes the new kind's default rise. The target riser and the options go, and the use-zone sides become the new kind's.
- A winder less than 0.05 m deeper than wide (`MIN_WINDER_EXTRA`) is refused.
- A stair has at least 2 risers, a winder 5 (`minRisers`).

## Riser and going

Nothing but the box and an optional target riser is stored. `stairGeometry(rule, w, d, h, target)` gives the rest:

- **Risers:** the rise over the largest riser, rounded up, never under `minRisers` whatever the target (`risersFor`).
- **Flight:** one tread fewer than risers; the going is the run over the treads.
- **Ladder:** one rung fewer than spaces; the going is the run over the spaces.
- **Winder:** three treads (`WINDERS`) turn in the square at its front, as deep as the stair is wide; the going is the rest of the run over the straight treads.
- **Spiral:** the going is measured on the walking line, 0.305 m from the column's edge (`SPIRAL_WALKING_LINE`), and does not depend on the box.
- **Pitch line:** `pitch(a)` is the line through the nosings (a ladder's rungs) at `a` metres up the run. The geometry also gives where each nosing lies (`nosingAt`) and the run a going gives (`runFor`). A winder's line is level across the front square, at 4 risers, then rises.

`recommendedRun` is the kind's going for the riser times the treads (a winder: the width plus the straight treads; a ladder: the rise at its angle; a spiral: its diameter). Fit run and a stair drawn on an edge use it.

**Target riser.** A stair's object may hold `riser`, between 0.10 and 0.35 m. The count is then the rise over the target, rounded up, so the riser stays at or under the target when the rise changes. The geometry functions take the target as a required argument, null for the kind's largest riser. A duplicate keeps it, and each flight of an L has its own.

**`setStair { objectId, riser?, going? }`** (`packages/domain/src/commands/stairs.ts`) is one edit:
- A riser sets the count and keeps the run, so the going gives way. Null clears the target.
- A going, between 0.05 and 0.60 m, keeps the riser and sets the run from `runFor`, the back edge staying. A run that does not fit is refused. A spiral has no going to set.
- The same command carries the handrails ([guards.md](guards.md)) and the options `hooks` and `leftEntry`.

## In every layout

A stair has one placement per layout state, and `syncLinkedCopies` (`packages/domain/src/commands/linked-copies.ts`) makes the others follow the copy a command changed: a new state gets a copy, and deleting one copy deletes the stair. The configuration may differ between copies. Invariant I19 (`stairViolations` in `packages/domain/src/stair-links.ts`) refuses a stair missing from a state or copies that differ in position, rotation, surface, use-zone sides or zones.

## Reaching and starting

A stair object has two links, each a deck's ID or null:

- `reaches`: the deck its top arrives at. While it is set, the height in every configuration is that deck's top less the top of the stair's surface (`stairRise`), and I19 checks it. A deck edit that changes the reached deck or the deck the stair stands on rewrites the height (`relinkStairs`). Raising the deck an L reaches changes the upper flight's rise only: the landing and the lower flight stay.
- `startsAt`: the deck at whose edge its steps begin, which must be lower than the stair's top. It changes no height. `stairBase` gives where the steps begin: the start deck's top, else the stair's surface. Risers, checks and drawing count the rise from there.

Links change only by explicit acts. No placement, move, nudge or rotation links a stair by touching an edge.

- `reaches` is set by the gesture's caught edge, Properties' Reaches (`setStairReaches`), and `reaches` on `placeObject` or a move.
- `startsAt` is set by no command but the L that `placeStair` makes.
- A duplicate copies both links. A copied flight of an L makes no pair with the other flight.

Deleting a deck clears both links to it and keeps the heights (`unlinkStairs`). A stair moved off its edge keeps its link and gets the reach warning: `touchedDeck` finds the deck whose slab edge the back edge's middle lies on, within 1 mm, the two edges parallel, with the stair off the slab 1 cm in front of its back edge. The deck it stands on never counts.

## Drawing a stair from an edge

```
 hover: an edge catches        click 1, then move           click 2
   LOFT +2.15                    LOFT +2.15
 +--------------+              +--------------+
 +--+==o==+-----+              +--+=====+-----+
    |  ^  |                       |  ^  |
    | UP  |  straight out         +-----+------+
    | 12 R|  = straight           |LAND |< UP  |
    +-----+                       +-----+------+ x
       x                         sideways past 30° = an L
```

1. **Hover.** With a stair kind armed in the Object tool, the deck edge near the cursor catches the ghost, sized for its rise.
2. **Click 1** fixes the top at that point, even while the ghost is red.
3. **Move.** Straight out keeps a straight flight. More than 0.45 m sideways along the edge and more than 30° off straight out bends it into an L toward the cursor's side.
4. **Click 2** places the stair in one edit. A red ghost places nothing and toasts why. Esc goes back to hovering.

- A stair that cannot turn there (its kind makes no L, or the rise is too low) is placed by click 1 where it fits.
- A press, a drag and a release give the same stair as the two clicks. The edge sets the rotation, so R does nothing.
- With no edge caught, a stair is placed like any piece and reaches nothing.

**Which edges catch.** `stairEdges(doc, surface, width)` (`packages/domain/src/queries/stair-edge.ts`) gives the slab edges of every deck whose top is above the surface's top, except the surface deck's own edges, an edge shorter than the stair's width, and an edge flush against a floor wall's face. A hole's sides are edges facing into the hole; a notch's open side is none.

**Which edge the cursor catches.** `catchEdge` (`packages/editor/src/tools/stair-gesture.ts`). An edge's band runs along it from 0.30 m behind it (`CATCH_BEHIND`) out to the end of the run its rise gives.
- Within 0.30 m of one or more edges whose band holds the cursor, the nearest catches, whatever is held, on any deck. A tie keeps the held edge.
- Farther out, a held edge holds until the cursor is 0.30 m outside its band (`HOLD`); else the nearest edge whose band holds the cursor catches.

**Sliding** (`slideOnEdge`). The stair's whole width stays on the edge. It goes flush to an end of the edge within the snap tolerance (10 px), else a long side goes onto a floor wall's face within 0.30 m (`wallSides`), else its middle goes onto the snap step's lattice along the edge. With Ctrl, none of these: the projection to the centimetre.

**The stair on an edge.** `stairOnEdge(doc, { state, kind, deck, at, shape, surface })` gives the parts. The back's middle is `at` projected onto the nearest catching edge within 1 cm (`EDGE_TOLERANCE`), to the millimetre; up points at the deck; the width is the kind's default and the run its recommended run. Only the back's middle has to be on the edge: the gesture keeps the whole width on it (`slideOnEdge`), but a caller passing `at` near an end, as `add_stair` does, gets a stair hanging half its width past the end, with no warning. Refusals: "Not on an edge a stair can go up to", "Only a stair or a ladder goes up to a deck", an L of a kind that doesn't turn, and "Too low for an L: each flight needs two risers".

**The command.** `placeStair` (`packages/domain/src/commands/place-stair.ts`) places the parts through `placeObject` with explicit links, as one patch and one undo entry, in every layout. `stairFits` runs the same placement, so the ghost and the commit cannot disagree.

**Hints and fixes.** The command bar's hint line gives one prompt per state of the gesture (`packages/editor/src/view/stair-hint.ts`). A ghost that fits adds its numbers: "12 risers × 0.179 · going 0.27 · run 2.99". A red ghost says "Doesn't fit: 0.69 m short" (`stairShortfall`: the run less the longest run that fits with the back kept on the edge), or the commit's refusal; an L has no shortfall.

A red ghost offers at most three chips (`stairFixes` in `packages/editor/src/tools/stair-fixes.ts`), each a stair that fits there:
- **straight:** "Make it an L" (on the side whose use zones stay free, else the cursor's side), then other kinds with their run ("Storage stair · 1.99 m");
- **an L:** "Turn the other way", "Keep it straight", then other turning kinds as the same L.

Click 1 on a red ghost pins that point's chips until a stair is placed, Esc, a tool change, a kind change or a level change. Hovering a chip previews its stair; clicking places it.

## The L and its landing

Only the Stair, the Open stair and the Storage stair turn (`turns`). An L is three plain parts:

- **the upper flight:** ceil(R/2) of the R risers, its back on the edge. It reaches the deck and starts at the landing;
- **the landing:** a solid deck, square at the flight's width, named "Landing" ("Landing 2" when taken), its top the lower flight's rise. It is centred on the upper flight's axis and touches its front edge;
- **the lower flight:** the rest of the risers, its back on the landing's side toward the turn, at a right angle. It reaches the landing.

Both flights use the kind's riser and going for the whole rise. After placement each part moves, turns and deletes alone. `ellPartner` pairs the two flights through the landing only so that a handrail set on one goes to the other ([guards.md](guards.md)).

## The spiral

A spiral rises clockwise and its last tread ends at its back edge (`spiralTreads`).

- **Top landing:** the quarter the treads leave open at the top, the square from the centre to the box's right and back sides (`spiralLanding`). You step off the last tread onto it, then onto the deck. It is not stored. It is the spiral's only way off: `stairOnEdge` stops the back's middle half a width short of the edge's end on the landing's side, so the landing's back is on the edge, and the reach warning wants the same.
- **Entry zone:** a new spiral gets one use zone, on the side of its box you walk in from to the first tread (`spiralEntrySide`): 7 risers right, 10 back (the default rise, under the deck), 12 or 13 left. Every way of making a spiral reads `newSides(kind, h)`. A later change of rise or size keeps the zone.
- From 11 risers the landing hangs over the first treads, and no check sees it.

## Winders, storage steps and hooks

**Winder stair.** One rectangle. Its first three treads wind through a quarter turn in the front square, radiating from the inner corner at 30° and 60° (`winderTreads` in `packages/domain/src/queries/winders.ts`); the rest is a straight flight to the back edge. You walk in from the square's right, or its left with the option `leftEntry` ("Enters from" in Properties). Drawn on an edge, it enters from the left when the right entry's zone meets a floor wall and the left's does not; placed any other way, from the right. It has a use zone on its entry side, along the square only. Switching the side swaps the left and right use zones in every layout.

**Storage steps.** A straight flight for platforms with treads 0.35 m deep: 0.45 m takes 3 risers of 0.150 over a 0.70 m run. A stair rising 0.76 m or less starts with no handrails ([guards.md](guards.md)).

**Hooks.** The Rung ladder's option `hooks` is drawn only: a tick across each rail at the back on the plan, and in 3D a strap 0.08 m over the slab in place of the handhold.

## Heights and collisions

The collision rule is in [heights-decks.md](heights-decks.md). A stair changes it in two ways (`pitchLineOf` and `undersideOf` in `packages/domain/src/queries/underside.ts`):

- **Above.** A flight or a winder is solid only under its pitch line, and a person needs 1.00 m above the line to get past (`MIN_PASSAGE`). A slab, a hung piece or a wall over the flight collides where it leaves less, read at its highest point over the flight's width. The line stays level past the last nosing.
- **Below.** A piece fits under an Open stair, a Ship's ladder or an Alternating tread when its top is at or below the underside, the pitch line less 0.23 m (`UNDERSIDE_DEPTH`), at its end nearest the bottom step. Otherwise the refusal names the piece's range and the underside's height at that end.
- A Rung ladder and a Spiral collide as their whole box.
- A piece reaching down past the pitch line from above gets the plain overlap refusal.

**Through a hole.** A stair caught on a hole's side hangs into the hole. A flight longer than its hole is refused only where the slab leaves less than 1.00 m over the pitch line; less than the wanted headroom is a warning.

## Checks

Warnings, never refusals (`stairChecks` in `packages/domain/src/queries/stair-checks.ts`), worded in `packages/editor/src/view/stair-text.ts`.

| Kinds | Wanted |
|---|---|
| Stair, Open stair, Winder stair | riser at most 0.197, going at least 0.254, 2 × riser + going 0.60 to 0.66, width at least 0.80 |
| Storage stair | riser 0.178 to 0.305, going at least 0.508 − 4/3 × riser, width at least 0.508 |
| Storage steps | riser at most 0.197, going at least 0.254, width at least 0.40, rise at most 0.76 |
| Ship's ladder, Alternating tread | riser at most 0.241, slope 50° to 70°, width at least 0.508 |
| Spiral stair | riser at most 0.241, clear width (half the diameter less 0.065) at least 0.66, walking tread at least 0.171 |
| Rung ladder | spacing 0.254 to 0.356, angle 70° to 80°, width at least 0.305 |

- Bounds hold within 0.5 mm and 0.05°.
- **Headroom:** the least clearance over the pitch line, wanted 2.00 m (1.88 m for a Storage stair, none for a Rung ladder). A flight or a winder reads the ceiling per tread, a spiral over its whole footprint; every solid over the stair is read at its far end.
- **Reach:** "Doesn't reach the Loft" when a linked stair's back edge is off its deck's edge.

## On the plan

`stairPlan` (`packages/editor/src/view/stair-plan.ts`) draws every stair, with its lines by body from `stair-lines.ts` and a spiral's from `spiral-plan.ts`.

- Treads, and a walking line from a dot on the first step to an arrow at the top, always uphill.
- **From below:** a break line at the first tread whose top is above the level's cut, everything past it dashed, and "UP · 12 R". A ladder breaks where its pitch line crosses the cut and reads "UP · 7 rungs". A winder never breaks inside its front square.
- **At a level it reaches** (`reachesLevel`): the whole flight, "DN · 12 R", cut to what shows outside that level's slabs.
- By body: side boards, staggered half nosings, rails and rungs, a spiral's radial treads, column and landing square, a winder's rays.
- The label runs along the flight, its centre 0.18 m off the lower long side, and is drawn after every piece.

## In 3D

`stairFaces` (`packages/editor/src/view3d/stair-faces.ts`) draws parts in place of the box, by body: step blocks, with a Storage stair's cubby doors or Storage steps' drawer fronts; a winder's three blocks, then straight ones; side boards with open treads; half treads on a centre stringer; wedge treads round a column and the landing as a slab 0.04 m thick; rails and rungs with a handhold 0.90 m above the top.

## Properties

The Stair section (`stairFields` in `packages/editor/src/properties/stair.ts`) takes the place of Size and Height: Width and Run (a spiral: Diameter), Reaches (any deck but its surface, or Nothing), a "Through" row per hole it overlaps, Starts at (read-only), Rise (typed only while no link is set), Fit run, Target riser ("Target spacing" on a ladder), Risers ("12 × 0.179"), Going (read-only on a spiral), Slope, the handrails, and each check as a tick or a warning.

## Claude's stair tools

The tool list and replies are in [mcp.md](mcp.md).

- `add_stair { layout, kind, deck, at, shape?, handrail? }` runs `placeStair` standing on the floor, with `at` as given, not clamped to keep the width on the edge. `shape` is `straight`, `l-left` or `l-right`, as seen from the floor facing the edge.
- `set_stair { object, riser?, going?, handrail?, handrailLeft?, handrailRight?, hooks?, leftEntry? }` runs `setStair`; at least one value is needed, and `riser: null` clears the target.
- `place_object` takes any stair kind with `reaches` and refuses a width and depth for one. `move_object` takes `reaches`: a deck's ID, or "nothing" to unlink.
- `get_drawing` gives each stair a line and its failed checks: "starts at Platform +1.08, reaches Loft +2.15, 6 risers of 0.178, going 0.274, run 1.37". A spiral reads "turn 270°, diameter 1.60"; a target riser, "3 winders" and the handrails are given too.

## Limits

- No U stairs, curved stairs, floating treads, pull-down or library ladders.
- An L is not edited as a whole: no group, no landing that carries its flights, no choice of the riser split, no link between its flights' targets.
- No L of a steep, round or winder kind. A winder has no straight run before its turn and no turn at the top. Its treads have no width at the inner corner, so no building code is claimed.
- No `startsAt` setter outside the L. A kind switch keeps the run: it does not refit the stair to its edge.
- A spiral is clockwise only, and nothing checks headroom under its landing.
- A stair being drawn has no target riser, and no fix chip grows a hole.
- Storage steps draw no drawers on the plan. Hooks check nothing.
- No stair to a storey through the ceiling, and no rule-set picker.

## At levels

- **Surface.** A stair stands on its placement's surface like any piece, and its rise is the reached deck's top less that surface's top.
- **Drawing.** The gesture's surface is the viewed level's, never the landing rule's: the floor at the floor level, even over a platform, and the viewed loft at a loft level. Only decks higher than that surface catch. A stair placed with no edge caught lands like any piece ([levels.md](levels.md); Claude's `place_object` passes no stair to the rule, see [heights-decks.md](heights-decks.md)), and Properties' Reaches then links it from a platform. Claude's `add_stair` always stands on the floor.
- **Platforms.** A stair up to a platform is too low for an L when it has fewer than 4 risers.
- **Showing.** A stair shows at the level it stands on, labelled UP and broken where that level's cut crosses it, and whole at every level it reaches, labelled DN (`shownAt` in `packages/domain/src/queries/levels.ts`). An L shows whole from its top.
- **Landings.** An L's landing is a plain deck: with its top at or above the floor's cut it is a level of its own. With the 1.20 m cut that is an L to a deck above 2.47 m for a Stair or an Open stair, and above 2.53 m for a Storage stair.
- **An L at a loft level.** Decks' slabs may not overlap on the plan ([heights-decks.md](heights-decks.md)), so an L drawn from a loft up to a higher deck is refused where its landing lies over the loft ("Loft and Landing overlap"). A straight flight there is placed.
- **Walls.** The flush-edge rule, the wall snap and the winder's entry side read floor walls only, so a wall standing on a loft does not count.
