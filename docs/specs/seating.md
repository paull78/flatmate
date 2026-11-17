# Seating

Chairs and the pieces you sit at: a table or desk that holds its chairs as one piece, the tuck rule that lets a loose chair go under a table, the snap that tucks it, Break apart, and sets of several pieces placed in one edit. Kinds, sizes, presets, options and placing in general are in [furniture.md](furniture.md); layouts and free floor in general are in [layouts.md](layouts.md).

## Words

| Word | Meaning | In the kinds table (`ObjectKind`, `packages/domain/src/kind-rows.ts`) |
|---|---|---|
| seat | a piece that may go under a table | `seat`: its backrest's depth in metres; null for every other kind |
| piece you sit at | a piece a seat may go under | `sitAt: true`, and `seatsUnder`: the configurations that take a seat |
| table or desk with chairs | one piece that draws a table and its chairs | `aggregate`: `{ table, config, chairs, reach }` (`Aggregate`, `packages/domain/src/sets.ts`) |
| set | several ordinary pieces placed by one edit | not in the table: a list in the editor (`packages/editor/src/furniture-sets.ts`) |

The seats are two kinds:

| Kind | Size | `seat` | Meaning |
|---|---|---|---|
| `chair` | 0.45 × 0.45, 0.90 tall (`CHAIR_SIZE`) | 0.10 (`SEAT_BACK`) | its back 0.10 m is the backrest |
| `stool` | Ø 0.40, 0.75 tall | 0 | no backrest |

An armchair, a sofa and a bench are not seats: nothing is pulled up to them.

The pieces you sit at, with the configurations that take a seat:

| Kind | `seatsUnder` |
|---|---|
| `desk`, `cornerDesk`, `roundTable`, `barTable` | `standard` |
| `extendingTable` | `closed`, `extended` |
| `foldingTable` | `open` (not `folded`) |
| `builtInTable`, `builtInDesk` | `down`, labelled Open (not `folded`) |

A table or desk with chairs is not a piece you sit at: no loose chair tucks under it. A counter is a cabinet, solid to the floor: neither a chair nor a stool goes under it.

## The tuck rule

Against a piece you sit at, in a configuration listed in `seatsUnder`, standing on the same surface, a seat is solid only in its backrest: the back strip of its footprint, `seat` metres deep (`seatStrip`, `packages/domain/src/queries/tucks.ts`). The rest of the seat may go under the table.

```
        table                 a chair facing the table
   ┌────────────────┐
   │     ┌────┐     │         the seat part may overlap the table
   └─────┼────┼─────┘  edge
         │▓▓▓▓│  ▓ the back 0.10 m: solid, stays outside
         └────┘
```

- A chair 0.45 deep goes at most 0.35 m under. Its backrest under the edge is refused, with the ordinary overlap refusal.
- The strip spans the chair's whole width, so a chair goes in more than a corner only when it faces the table. A corner of the seat part may cross at any angle while the strip stays clear.
- A stool has no strip: it is solid nowhere against a piece you sit at and may stand wholly under it, even where their heights overlap (a 0.75 m stool under a 0.75 m desk).
- The rule changes only which shapes are compared. `collisionRings` picks, for a pair, the seat's strip in place of its whole shape; the shared collision check then runs as for any pair, so height ranges still decide (see [heights-decks.md](heights-decks.md)). The document invariant, the server, Claude's tools and every gesture read the same check.
- Different surfaces: a chair on a platform and a desk on the floor collide by their whole shapes.
- Every other pair is unchanged: a seat against a coffee table, an armchair, another seat or a folded unit collides whole. Folding a unit over a tucked chair is refused where the folded footprint meets the chair.
- One seat may be under two tables at once.

A piece's role is `tuckRole(pose)`: `{ seat: strip }`, `"under"` or null. `placementTuck(doc, placementId)` gives it for a stored placement. `tucks(doc)` lists every seat and `"under"` piece in one layout, on one surface, whose fit shapes overlap beyond touching, as `{ seat, table, state, overlap }`. It compares shapes by their convex parts, so a seat under both arms of a corner desk gives two entries. It does not compare heights.

### Free floor

A room's free floor subtracts each piece's area, so a tucked seat and its table would count their overlap twice. `freeFloor` (`packages/domain/src/queries/free-floor.ts`) gives each overlap from `tucks` back once, where both pieces take floor. A piece whose bottom is 1.20 m or more above its surface takes no floor (`ZONE_CLEAR_ABOVE`, `packages/domain/src/queries/vertical.ts`), so a chair under such a table gives nothing back; a table raised less still takes floor, and its tuck is given back. A chair touching a table gives nothing back. The rest of free floor is in [layouts.md](layouts.md).

### Warnings

A seat never blocks a use zone of a piece you sit at, tucked or not. It blocks other pieces' zones and warns in a door swing like any piece. Zones are in [furniture.md](furniture.md), warnings in [warnings.md](warnings.md).

### Drawing and picking

- The table reads on top. In the stacking order (`stackOrder`, `packages/domain/src/queries/vertical.ts`) a seat draws before other pieces with the same bottom.
- A piece's lines are clipped to outside every filled piece drawn after it, so a tucked chair shows only the part outside the table, on every renderer and export. A selected chair shows its whole outline, over the fills.
- A seat whose lines are all clipped away by fills drawn after it (a stool under a table, or a chair wholly under a raised piece) draws its outline dashed, over those fills. A selected seat draws whole instead.
- The click order (`pickOrder`) puts a seat after other pieces with the same bottom: a click on the overlap selects the table, the next click the chair.

## The tuck snap

A single seat that is placed, dragged or carried as a duplicate's ghost may snap under a table (`tuckPlace`, `packages/editor/src/snapping/tuck.ts`). It runs first in `contactPlace`, before wall contact.

It takes an edge of a piece with the `"under"` role in the same layout when:

- the seat's front faces the edge and its back is outside the edge;
- its nearer front corner is within the snap tolerance of the edge's line, 10 px on screen, or across it;
- its centre, kept along the edge, leaves at least part of the seat under that edge.

The seat then turns square to the edge and slides in until its backrest is flush with it: fully tucked. Its place along the edge is kept. At a round table it turns to face the centre, in whole degrees. A stool, with no backrest, lands with its back edge on the table's edge. On a slanted edge or a circle the seat stops 1 mm out.

- Edges are the piece's outline: the inner edges of a corner desk count, the seam between its arms does not.
- Of several candidates the nearest edge wins (a crossed edge counts as distance 0), then the smaller turn, then the table's ID, then the edge's order.
- A candidate is taken only if the seat fits there by the tuck rule and lands on the table's own surface. With none, the ordinary contact result stands.
- A snapped seat is `held`: no furniture guide moves it afterwards.
- Ctrl skips the snap. A group drag, a group duplicate and Claude's tools never snap.
- A seat whose front turns away from the edge does not turn round to tuck, and a chair whose back is past the edge is not pulled out.

## Tables and desks with chairs

Three kinds draw a table or desk and its chairs as one piece. The piece's size includes the chairs, so fit, use zones, grips, layouts and Claude's tools treat it like any piece. The whole rectangle or circle is solid: nothing stands in its corners, and free floor counts all of it.

| Kind | Label | Table part | Chairs | `reach` | Use zone |
|---|---|---|---|---|---|
| `seatedDining` | Dining table with chairs | `extendingTable`, closed | on the two long sides, and at the ends | 0.60 (`SEATED_REACH`) | 0.15 m on all four sides |
| `seatedRound` | Round table with chairs | `roundTable` | around | 0.60 | 0.15 m on all four sides |
| `deskSet` | Desk with chair | `desk` | one, centred at the front | 0.10 (`SEAT_BACK`) | 0.60 m at the front |

Each is 0.90 m tall, a chair's back. `reach` is the distance from the table's edge to the piece's edge, where a chair's back stands. At 0.60 a chair stands 0.15 m off the table, with room to sit. At 0.10 the chair is fully tucked.

| Preset | Table | Piece |
|---|---|---|
| Dining, 4 seats | 1.20 × 0.80 | 1.20 × 2.00 |
| Dining, 6 seats | 1.40 × 0.90 | 2.60 × 2.10 |
| Dining, 8 seats | 2.00 × 0.90 | 3.20 × 2.10 |
| Dining, 10 seats | 2.60 × 0.90 | 3.80 × 2.10 |
| Round, 4 seats | Ø 0.90 | Ø 2.16 |
| Round, 6 seats | Ø 1.20 | Ø 2.46 |
| Round, 8 seats | Ø 1.50 | Ø 2.76 |
| Desk with chair | 1.20 × 0.60 | 1.20 × 0.70 |

### How the chairs are laid out

`aggregateLayout(kind, w, d)` (`packages/editor/src/view/aggregate.ts`) is the one owner of a piece's table and chair poses. The plan symbol, the fills, the 3D parts and Break apart all read it. The counts and sizes it uses are in the domain's `sets.ts`.

- **Dining** (`diningTable`): the table is the piece less `reach` at each long side. If the piece less `reach` at each end leaves a table of at least 1.40 m, the table is that long and one chair sits at each end. Otherwise there are no end chairs and the table is the piece's whole length. Each long side has max(1, round(table length / 0.60)) chairs (`diningChairsPerSide`), spread evenly.
- **Round** (`roundSetTable`): the table is the largest whose chairs keep their back corners inside the piece's circle. Chairs: 4 under a 1.10 m table, 6 under 1.40 m, else 8 (`roundChairs`), evenly round it, facing the centre. A piece resized to an ellipse uses its smaller side.
- **Desk**: the desk is the piece less 0.10 m at the front, with one chair centred there.

Chairs are all or none. They draw only when the table is at least 0.20 m long and deep (`MIN_SET_TABLE`), every chair lies inside the piece's outline, and no two chairs overlap, under the table or anywhere. Otherwise the piece draws as a bare table of its whole size.

### How it draws

Each chair is a loose chair at its pose: the chair's own symbol, clipped by the table, and the chair's own 3D parts. The table draws as its own kind, a dining table without the seam across its top. The table and each chair are filled and outlined separately; there is no outline round the whole piece and no heavier front line.

### Round chairs

The `roundChairs` option is listed by the three kinds above and by the loose `chair`. With it on, a chair draws a rounded outline (corners rounded by 0.12 m, `roundChairRing`), a rounded seat and a curved back band, and in 3D a round-backed chair. A loose round chair has no heavier front line. Fit and the hit test keep the chair's rectangle, and grips keep its footprint (`packages/editor/src/snapping/resize.ts`). The options mechanism (`setOption`, the Properties switch, the desk's computer) is in [furniture.md](furniture.md).

### Kind

No piece switches kind to or from a table or desk with chairs (`kindsSwitchable`, `packages/domain/src/kinds.ts`): its size means the table and the chairs together.

## Break apart

Break apart splits a table or desk with chairs into its table and loose chairs. Properties shows the button for any kind with an `aggregate`; it acts on one selected piece with the Select tool idle. `brokenApart(doc, objectId)` (`packages/editor/src/break-apart.ts`) computes the pieces; `breakApartSelection` and Claude's `break_apart` send them in one `placePieces` that removes the original, so it is one edit and one undo step.

```
 one piece  ── Break apart ──▶  a table + N loose chairs
 moves, turns and fits as one   each chair moves, tucks and deletes alone
 its size decides the chairs    undo restores the piece; there is no regroup
```

- In every layout where the piece stands, each part gets a placement where `aggregateLayout` draws it, on the same surface.
- No part is taller than the original and each keeps its elevation, so a piece lowered to fit under a loft still fits.
- A dining table becomes an `extendingTable` turned a quarter turn about its centre, because that kind extends along its depth: the loose table extends along its length. Its extended depth is its closed depth plus the kind's own extension, 0.46 m (a 1.40 × 0.90 table: width 0.90, closed 1.40, extended 1.86).
- A desk keeps its computer. Round chairs stay round.
- Each part takes its kind's label as its name and its kind's default zone sides, with no stored zones: the piece's name and zone settings are dropped.
- The size and configuration are read from the piece's first placement by ID.
- A piece too small for chairs breaks into its bare table alone.
- The new pieces in the active layout end up selected.
- Any other piece is refused with "Only a table or desk with chairs breaks apart". If the result is invalid, the domain refuses with its reason and nothing changes.

## Sets

A set is a list of kinds and offsets (`FURNITURE_SETS`), each piece at its kind's default size. Nothing links the pieces after placing.

| Set | Pieces | Overall box (`setBox`) |
|---|---|---|
| `bedAndNightstands`, Bed and nightstands | a 1.70 × 2.10 bed, a 0.45 × 0.40 nightstand on each side, flush at the head | 2.60 × 2.10 |
| `sofaAndRug`, Sofa and rug | a 2.10 × 0.90 sofa, a 1.00 × 0.50 coffee table 0.50 m in front of it, a 2.00 × 1.40 rug under the table | 2.10 × 2.35 |

- The palette has a Sets group with a card per set; quick add finds them too. For a one-word query a set is listed after the plain pieces.
- A card arms the Object tool with the set (`pickSet`, stored as `objectSet` in the editor state). A ghost of every piece follows the pointer, `R` turns it, and a click places all the pieces or, if one does not fit, none, with the reason.
- While placing, the overall box takes wall contact and guides as one rectangular piece, as tall as the set's tallest piece, so a bed set lands flush with its head to a wall. Ctrl keeps the angle and takes no wall.
- A set has one size: a press and drag places it at the release, and the size picker is off. Its ghost is never lowered to fit and gets no advice plate.
- The set stays armed after a click. Picking a kind leaves the set.

## One command for several pieces

`placePieces { opId, remove?, pieces }` (`packages/domain/src/commands/place-pieces.ts`) puts new pieces in the document and takes away at most one object, in one patch, all or none. Break apart and sets both use it.

- A piece (`NewPiece`) is `{ kind, name?, size?, options?, placements }`. Each placement is `{ state, at, rotation, config?, deck }`, at most one per layout and at least one.
- Sizes default to the kind's. Options must be ones the kind lists.
- Piece i becomes object `<opId>/o<i>`; placements are `<opId>/p<n>`, numbered across the whole list.
- Places and sizes are stored as given. The domain checks only the result, once, so a piece may stand where the removed object stood, and two new pieces that collide refuse the whole command.
- A stair is refused ("A stair is placed on its own"): it has its own links and rules.
- The editor computes the pieces, so `aggregateLayout` and the sets list stay out of the domain.
- Linking (see [layouts.md](layouts.md)): replacing a linked object, the pieces are linked and the command is refused where a part does not fit in every layout, with no fall back. Replacing an unlinked object never links. With no `remove`, it tries them linked (each piece with a single placement), and on a refusal places them again unlinked.
- Other refusals: "Nothing to place", "A piece needs a place", "Already placed in this state", "Operation ID already used", "Unknown configuration", "Invalid size", "Invalid options".

## Claude's tools

The full list and reply format are in [mcp.md](mcp.md).

| Tool | Takes | Does |
|---|---|---|
| `place_object`, `move_object` | as for any piece | accept a tucked seat by the tuck rule; no snap, so the position and rotation given must already fit |
| `set_chairs` | `object`, `round` | turns Round chairs on or off through `setOption`; refused for a kind that does not list it |
| `break_apart` | `object` | Break apart, as one edit; refused for any other piece |
| `place_set` | `set`, `layout`, `centre`, `rotation` (default 0) | places a set with its overall box centred on `centre`, with no snapping, all or none |

`get_drawing` lists a piece's `options` and gives free floor with tucks counted once.

## Limits

- A loose chair tucks only under the kinds listed above, in the listed configurations.
- A broken-apart piece is not regrouped, except by undo.
- Resizing a dining piece across 2.60 m wide jumps between a table of its whole length with no end chairs and a 1.40 m table with them. Presets never land in that range.
- Chairs are never drawn in part: a size that cannot hold them all draws a bare table.
- Round chairs change the drawing only, not the fit.
- The flip between layouts draws tucked chairs unclipped while it moves.
- The pieces of a set are not linked to each other, and a set has no size picker.
- `place_set`, `place_object`, `move_object` and a group drag never take the tuck snap; the tuck rule still applies to where they put a seat.

## At levels

- **The tuck rule** holds on any one surface: a chair and a table both on the floor, both on one platform or both on one loft. A chair and a table on different surfaces collide by their whole shapes, and `tucks` lists none between them.
- **The tuck snap** lands the seat on the table's own surface or does not snap. A desk on a loft does not take a chair on the floor under it.
- **Free floor** gives a tuck back only where both pieces take floor. A platform's pieces count in their room; a loft's pieces take no floor, so a tuck on a loft changes no room's free floor.
- **Tables and desks with chairs** stand on a platform or a loft like any piece; their layout and drawing do not depend on the surface.
- **Break apart** keeps every part on the surface the piece stands on in each layout, platform and loft included.
- **Sets:** in the editor the overall box lands by the landing rule at the viewed level, and every piece stands on the surface the box lands on, a platform or a loft included. `place_set` lands the box at the floor level: on the floor or a platform, never on a loft. Both size the box as tall as the set's tallest piece (`setHeight` in `packages/editor/src/furniture-sets.ts`; 0.90 m for the sofa and rug), so under a low loft or ceiling they pick the same surface.
