# Guards and handrails

A deck has a guard along its open edges and a stair has handrails. This document covers what is stored, where guards and rails stand, the warning, the "Open to below" marks, how they draw, and Claude's tools. Decks and holes are in [heights-decks.md](heights-decks.md), stairs in [stairs.md](stairs.md), levels in [levels.md](levels.md).

Every figure here is a default, never a compliance claim. Guards and handrails are drawn only: they refuse nothing, and no piece is checked against one.

## What is stored

```
 a loft at its own level                    stored per side, in the deck's own frame
 +--------------+-------------------+       +------ back ------+
 | upper: Rail  #                   |       |                  |
 |  +--+ hole:  #   Open to below   |      left    +--+      right
 |  |OB| Glass  #                   |       |      |  | hole   |
 |  +--+        : right: None,      |       |      +--+        |
 | lower: Rail  :  a warning mark   |       +----- front ------+
 +--------------+-------------------+       named on the plan by where it faces:
                                              upper, right, lower, left
```

- **A deck** stores four guards, `guardFront`, `guardRight`, `guardBack` and `guardLeft` (`Deck` in `packages/domain/src/model.ts`), in its own frame: the front faces −y at rotation 0, as a piece's does.
- **A hole** stores one `guard` for all its sides (`DeckHole`).
- **A guard** is a `GuardValue`: a kind (`railing`, `glass` or `none`) and a height above the deck's top. A None guard keeps its height, so switching it back restores it.
- **A stair with rails** stores them on its object: a flight, a winder, a Ship's ladder and an Alternating tread `handrails { left, right }`, the sides as you walk up; a spiral one `handrail`. Each is `railing`, `glass` or `none`. A Rung ladder stores none (`railShape` in `packages/domain/src/kinds.ts`).

The guard runs, the rails' lines and the "Open to below" spots are not stored. One query each works them out from the geometry: the plan, 3D, sections and paper read the runs and rails, and only the plan's pictures read the spots.

How an older file's rows are filled on load is in [domain.md](domain.md).

## Constants

| Name | Value | What it is |
|---|---|---|
| `GUARD_DROP` | 0.76 m | a deck higher than this starts with a guard, and warns without one; a stair placed from a deck's edge rising more than this starts with rails. `PLATFORM_TOP` ([heights-decks.md](heights-decks.md)) is defined as this value |
| `GUARD_HEIGHT` | 1.00 m | a guard's default height above its deck's top |
| `MIN_GUARD_HEIGHT`, `MAX_GUARD_HEIGHT` | 0.30 m, 1.10 m | the range of a guard's height, stored to the millimetre |
| `HANDRAIL_HEIGHT` | 0.90 m | a rail's top above the pitch line, a spiral's treads or its landing; not editable |
| `HANDRAIL_INSET` | 0.02 m | how far inside a stair's long side, or a landing's side, a rail's centre line runs |
| `POST_SPACING` | 1 m | the most a Railing's posts stand apart |
| `RAIL_THICK`, `POST_SIDE`, `PANE_THICK` | 0.04, 0.04, 0.012 m | the 3D sizes of a top rail, a post and a Glass pane |

## Defaults

- A new deck's four sides start from its top (`guardFor`): Railing above 0.76 m, else None, at 1.00 m. A new hole starts the same way, from its deck's top.
- A side or a hole keeps its guard when the deck's top changes. Raising a platform keeps its None, and lowering a loft keeps its rail.
- An L's landing is a deck ([stairs.md](stairs.md)), so it starts the same way and has a gap for each flight.

## Open edges and guard runs

`guardRuns(doc)` (`packages/domain/src/queries/guards.ts`) gives every deck's guard as straight runs: `{ deck, kind, a, b, bottom, top, side, hole }`.

1. **Edges.** The slab's boundary edges, a hole's sides included (`slabOf` in `packages/domain/src/queries/slab.ts`). Each edge has an `owner`, decided in the deck's frame: the side of the rectangle it lies on, or the hole beyond it. A hole that notches a side leaves two pieces of that side.
2. **Guard and top.** An edge takes its owner's guard. Its top is the deck's top plus the guard's height, or the lowest ceiling over the edge's two ends if that is lower (`ceilingOver`). An edge with no room under the ceiling has no run.
3. **Closed stretches** (`againstSpans`, `closedSpans`):
   - a wall whose bottom is at or below the deck's top and whose top reaches the guard's top. A 0.40 m knee wall standing on the deck closes a 0.30 m guard and not a 1.00 m one;
   - the slab of another deck with the same top. Its slab, not its rectangle: a hole in it is still a drop;
   - a stair's end, as below.
4. **Open stretches** are what is left (`openSpans` in `packages/domain/src/queries/edge-spans.ts`). Each one gives a run, unless its guard is None.

A None guard's kept height still decides which walls close its edge, and so whether it warns.

**A stair's end.** Only a stair's end makes a gap, and only through its links:
- a stair that `reaches` the deck: its back edge. A spiral: the right half of its back edge, its landing's width;
- a stair that `startsAt` the deck: its front edge.

The end must lie on the edge's line. It also opens the edge of another deck with the same top, so a stair arriving across the seam of two decks opens both. A stair lying along an edge, or one that touches a deck without a link, makes no gap. Pieces never close a stretch.

**Posts.** `guardPosts(run)` gives a Railing's posts: one at each end and evenly between, no more than 1 m apart.

## Side names

People and Claude name a side by where it faces on the plan at the deck's current rotation: `upper`, `right`, `lower`, `left` (`PLAN_SIDES`, `sideName` and `sideAt` in `packages/domain/src/queries/deck-sides.ts`). An unturned deck's front is `lower`. The name follows the nearest quarter turn: 45° counts as unturned and 46° as one quarter, so four sides keep four names at every angle. Turning a deck renames its sides; each stored side keeps its guard.

## The warning

`missingGuards(doc)` lists every side or hole that wants a guard and has none: on a deck higher than 0.76 m, set to None, with at least one open stretch. Sides come first, front to left, then holes by ID.

- The text is "No guard on Loft's right side" or "No guard round a hole in Loft" (`packages/editor/src/view/warnings.ts`).
- The mark is at the middle of that side's or hole's longest open stretch.
- A side's row selects the deck, a hole's row the hole.
- The warnings show in every layout, at the floor level and at the deck's own level, and count in the warning count ([warnings.md](warnings.md)).
- Only a None side or hole warns. A Railing or Glass guard never does, however low or cut short, and a None side under a low ceiling still does.

## Setting a guard

`patchedGuard` (`packages/domain/src/commands/decks.ts`) is the one rule for a guard edit: a patch gives a kind, a height or both, and the rest is kept. A kind off the list is refused with "Invalid guard: railing, glass or none", a height outside the range with "Guard height must be 0.30 to 1.10 m".

- `addDeck` and `setDeck` take `guard`, every side's kind with each side's height kept, and a patch per side field. A side's patch is applied over `guard`.
- `addDeckHole` and `setDeckHole` take `guard`, a patch.

**Properties.** A deck's panel ends with a Guards group: for each side by its plan name (Upper, Right, Lower, Left), a kind and a Height (`guardFields` in `packages/editor/src/properties/fields.ts`). A hole's panel has Guard and Height after Width and Depth. A None guard's Height is read-only. There is no canvas gesture and no highlight of the side.

## A flight's handrails

`flightHandrails(doc)` (`packages/domain/src/queries/handrails.ts`) gives the rails of every stair with a pitch line ([stairs.md](stairs.md)): the flight kinds and the winder. Each long side set to Railing or Glass has a rail on its open stretches.

- The rail's top is 0.90 m above the pitch line, or as much as fits under the ceiling. It stays level past the last nosing, over the top tread.
- A wall closes the stretch it lies along only if it reaches the rail's top at its own high end and starts no higher than the pitch line at its own low end. A 1.50 m half wall counts at the foot and not along the whole flight.
- Only a wall closes a stretch. A platform beside a flight keeps the rail.
- A winder has no rail along its front square: both rails start where the straight treads do.
- A Rung ladder has no handrail. Its handhold and hooks are in [stairs.md](stairs.md).

## A spiral's rails

`spiralRails(doc)` (`packages/domain/src/queries/spiral-rails.ts`) gives two things, both of the spiral's one `handrail` kind; None draws neither.

- **The landing's rail.** The landing's sides each have a level rail 0.90 m above the landing, except the side from the back edge to the centre, where the last tread meets it. A side is closed by a wall as tall as the rail or by the slab of a deck at the landing's height, the deck it reaches included. A spiral on an edge has no rail along its back; one standing free has.
- **The balustrade.** One straight rise round the treads, 0.02 m inside their outer edge, from 0.90 m above the first tread's top to 0.90 m above the stair's top. It bends where it meets the ceiling.

## Which rails a stair starts with

`withHandrail` (`packages/domain/src/commands/stairs.ts`) fills the rails of every new stair object, and `railFor` is the one rule for the kind:

1. None when the stair rises 0.76 m or less;
2. else Glass when the side or hole its top arrives on is Glass (`guardAt`, read at the placement's `at`);
3. else Railing, also where that side is None, where the stair reaches nothing, and where its `at` lies on no edge of the deck.

- A stair placed with `placeObject` and `reaches` (only Claude's `place_object` sends it) is linked first, so the rule reads the rise to the deck: a Stair up to a 0.45 m platform gets None, Storage steps up to a loft get Railing.
- `placeStair` reads the rise from the stair's surface to the deck, and gives every part of an L the rail the upper flight arrives on, or its `handrail` when given.
- A stair loaded without rails gets them by the same rule (`withLoadRails`), an L's two flights as `placeStair` gives them: the deck the upper flight reaches, where its top arrives, and the rise from the surface the lower flight stands on.
- The rails are chosen once. They stay when the deck's guard, the link or the rise changes.
- A duplicate keeps them.
- A kind switch keeps them: a spiral's one goes to both sides of a flight, a flight's two go to a spiral when they agree (else Railing). A switch to a Rung ladder drops them; a switch from one picks them again.
- A flight with no rails yet takes its L partner's before `railFor`.

**Setting them.** `setStair` takes `handrail` (a spiral's one, or both sides of a flight), `handrailLeft` and `handrailRight`. The two flights of an L share each side: setting one sets the other (`ellPartner`). Refusals: "Invalid handrail: railing, glass or none", "A spiral stair has one handrail" for a side on a spiral, and "Rung ladder has no handrail". Properties shows Left handrail and Right handrail on a flight and Handrail on a spiral.

## Open to below

`openBelow(doc, level)` (`packages/domain/src/queries/open-below.ts`) gives the spots where a loft's level shows the room below. Nothing is stored and nothing is selected.

- **A room the level's decks cover in part** gets one spot, at the most open point of its uncovered part: the sampled point farthest from the room's outline, its holes and the decks' rectangles. The grid's step is 0.1 m, coarser in a large room so that a room takes about 6,000 samples at most.
- **A hole with no stair standing in it** gets one spot at its centre.
- A room the level does not touch, or covers wholly, gets none.

`openBelowLayer` (`packages/editor/src/view/zones-layer.ts`) writes "Open to below" at each spot, in the tags' muted ink with no plate. It tries one line, then "Open to" over "below", and leaves the words out where neither fits within the spot's clear distance. The words take the tags' slot of the picture, so they draw on the canvas and in every export of that level ([export.md](export.md)).

## On the plan

- **A guard** (`guardPrimitives` in `packages/editor/src/view/guards-layer.ts`): a thin line along each run. A Railing adds a dot at each post; Glass has none.
- **A stair's rails** (`railLines` in `packages/editor/src/view/stair-plan.ts`, `spiralRailLines` in `spiral-plan.ts`): a thin line in the guards' width, a spiral's balustrade an arc. They stop where the stair's solid lines stop at the cut.
- **Ink** (`guard` and `openingGlass` in `packages/editor/src/view/plan-style.ts`): on the canvas a Railing is the dark ink and Glass the windows' blue; on paper and in `look`'s picture both are ink. A project card draws them heavier.

## In 3D and in sections

- **A guard** (`guardBoxes` in `packages/editor/src/view3d/guard-faces.ts`): a top rail on posts, in the `metal` slot. Glass is an opaque pane in the windows' glass colour under the top rail, with no posts. With less than 0.04 m under the ceiling there is only as much rail as fits.
- **A flight's rails** (`handrail-faces.ts`): a rail sloped with the pitch line on a post at each end of the stretch, in the stair's colours. Glass is a pane from the pitch line up to under the rail, with no posts.
- **A spiral's rails** (`spiral.ts`): the landing's rail drawn as a guard, and the balustrade on a post at each tread and each end. Glass has panes from the treads' line and no posts.
- **Sections** ([sections.md](sections.md)): a guard past the section's line draws as thin outlines and is never a cut shape. A stair's rails are part of the stair's faces (`stairFaces`), so a section draws them with the stair.

## Claude's tools

The tool list and replies are in [mcp.md](mcp.md), the stair tools' other values in [stairs.md](stairs.md).

- `get_drawing` lists a deck's `guards` by plan name, each a kind and a height, each hole's `guard`, and a stair's `handrails` (left and right) or `handrail` (a spiral).
- `add_deck` and `set_deck` take `guard`, every side's kind, and `guards`: any of `upper`, `right`, `lower`, `left`, each a kind and a height, both optional. The names are read at the deck's rotation after the edit, and `guards` is applied over `guard`.
- `add_hole` and `set_hole` take `guard`: a kind, a height or both.
- `add_stair` takes one `handrail` for every side of every flight, ignored on a Rung ladder.
- `set_stair` takes `handrail`, `handrailLeft` and `handrailRight`. A Rung ladder refuses them.

## Limits

- No rail on part of a side, and no piece standing as the guard. Shelves at an edge are drawn by setting that side to None or lower; a None side above 0.76 m still warns.
- A stair's rail has no height setting, and `add_stair` takes no sides.
- Glass is opaque in 3D.
- No check of a piece against a guard or a rail, and no warning for a stair with no handrail.
- Claude sees no missing guard: `get_drawing` lists no "No guard" warning and `look` draws no warning marks.

## At levels

- **On a platform and on a loft.** Every deck has guards, whatever its top. A platform up to 0.76 m starts with None on every side and never warns; a raised floor, a loft and a high landing start with a Railing.
- **Walls.** A deck's guard and a spiral's landing rail read every wall by its height range, on the floor or standing on a deck: a wall on a loft closes that loft's edge when it is as tall as the guard. A flight's rails read every wall the same way.
- **Drawing a guard at a level.** A run draws at a level unless it is above that level's cut or under the level (`relationAt` in `packages/domain/src/queries/levels.ts`). A loft's guard does not draw at the floor level and a platform's does. At a loft's level a platform's guard is hidden when the guard's top is at or under that loft's top. A spiral's landing rail follows the same test.
- **The warning** shows at the floor level and at the deck's own level, not at another loft's.
- **Open to below** is for a loft's level only: nothing at the floor, and a platform is no level ([levels.md](levels.md)).
- **A stair's rails** draw with the stair at each level that shows it ([stairs.md](stairs.md)): to the cut from below, whole from the level it reaches. The 0.76 m rule reads the stair's own rise, from the surface it stands on: a stair drawn at a loft's level up to a deck 0.76 m or less above that loft starts with no rails.
