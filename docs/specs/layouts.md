# Layouts

Flatmate arranges one home in several layouts of the same shell: Day, Night, Work. This document covers what every layout shares and what each one owns, objects and placements, linked pieces and exceptions, the checks that run per layout, the layout commands, the layout pill, the active layout of each viewer, the flip between two layouts, and free floor. The UI says **layout**; the code says **state** (`LayoutState`, `states`, `StateId`). The two words mean the same thing here.

## Shared and per layout

| Shared by every layout | Per layout |
|---|---|
| Walls, joints, rooms and their labels, columns, named areas | Which pieces stand in it (one placement per piece) |
| Openings ([openings.md](openings.md)) | A piece's configuration (bed down or folded, table open or closed) |
| Decks and their holes, the ceiling ([heights-decks.md](heights-decks.md)) | A piece's use-zone sides and zone extents ([furniture.md](furniture.md)) |
| Dimensions, sections, sheets, finishes | For an exception: its position, turn and surface |
| An object's kind, name, sizes, heights and options | Blocked use zones and door swings (warnings) |
| A linked piece's position, turn and surface | Free floor of each room |

Stairs, beams and wheel wells stand in every layout, at one place, and share their zone sides and extents too (`inEveryLayout` in `packages/domain/src/kinds.ts`). See [stairs.md](stairs.md), [roofs.md](roofs.md) and [surroundings.md](surroundings.md).

## Data

Three tables of the document hold layouts (`packages/domain/src/model.ts`; the document as a whole is in [domain.md](domain.md)).

```
states      { id, name, order }
objects     { id, kind, name, w, d, h, z, linked?: true, ... }      one row per piece
placements  { id, object, state, at, rotation, config, sides, zones, deck }
                                                       one row per piece and layout

  object o1 (sofa, linked) ──┬── placement in Day    same at, rotation, deck
                             └── placement in Night  same at, rotation, deck
  object o2 (chairs, an exception) ── placement in Day only
```

- **States.** A document always has at least one. A new document starts with `FIRST_STATE`: id `s0`, name "Layout", order 0. A name is free text of at most 200 UTF-16 units (`MAX_NAME_CHARS`); two layouts may share a name, and every command names a layout by id. `orderedStates` in `packages/domain/src/queries/states.ts` sorts by `order`, then by id. The pill, the sheets, Claude's listing and `look` all use it.
- **Objects** exist once. `w`, `d`, `h` and `z` are maps by configuration id, so a size or a name edit shows in every layout. Kinds, sizes and presets are in [furniture.md](furniture.md).
- **Placements** put an object in a state. `at` is the middle of the footprint's back edge, `rotation` is whole degrees from 0 to 359, counter-clockwise, `config` is one of the kind's configurations, `sides` and `zones` are that layout's use zones, and `deck` is the deck the piece stands on, or null for the floor.
- An object with no placement in a state is absent from that layout. An object left with no placement at all is removed in the same patch (`withoutPlacements` in `packages/domain/src/commands/objects.ts`).

## Linked pieces and exceptions

A piece is the same in every layout unless it is made an exception.

- **Linked.** The object row stores `linked: true`. The piece has one placement in every state, and they agree on `at`, `rotation` and `deck`. Configuration, zone sides and zone extents stay each layout's own.
- **Exception.** The object row has no `linked` key. Each layout places the piece on its own, or not at all.
- **Always in every layout.** Stairs, beams and wheel wells never store `linked` and can't be made exceptions. Their copies also agree on `sides` and `zones`.

`isLinked` and `sharedOf` in `packages/domain/src/linked.ts` say which objects are linked and which fields their copies share.

**The sync.** Commands edit one placement. `syncLinkedCopies` in `packages/domain/src/commands/linked-copies.ts` then makes the other copies follow, in the same patch:

1. The copy the command changed gives its shared fields to the others. If none changed, the first new copy does, else the first copy by id.
2. A state without a copy gets one, with the id `${object}/${state}`: a copy of the source, so it takes the source's configuration, sides and zones.
3. A linked object that lost a copy while that copy's state still exists loses every copy, and the object goes.

The result is validated as a whole, so an edit to a linked piece must fit in every layout.

| Edit | Linked piece | Exception |
|---|---|---|
| Place a new piece | Goes into every layout at its place | The layout in view only |
| Move, turn, put on a deck | Every layout, or refused; the reason names the layout where it doesn't fit ("... overlaps a wall in Night") | The layout in view only |
| Resize, rename, change kind | Every layout (the object's own fields) | Every layout where it stands |
| Configuration, zone sides, zone extents | The layout in view only | The layout in view only |
| Delete | Every layout | The layout in view only |

**Placing.** `placeObject`, `placePieces` and `duplicatePlacements` use `placeLinked` in `packages/domain/src/commands/link.ts`. `placeObject` takes `linked?: boolean`:

- absent: the piece is linked when it fits in every layout; when only another layout refuses it, it goes into its own layout as an exception;
- `true`: linked, or refused;
- `false`: an exception.

A piece that fits nowhere gets its own layout's refusal. A duplicate is linked only when its source is linked and the copy fits in every layout. A set placed as one follows the absent rule. Pieces that replace a linked set (Break apart, [seating.md](seating.md)) are linked or refused. A piece of a `placePieces` given a place in several layouts is an exception.

When a new piece lands in one layout only, the editor shows a note: "Only in Day: it doesn't fit in Night" (`placeNote` in `packages/editor/src/link-note.ts`). The ghost is tested against the layout in view, so a click on a ghost that fits always places.

**The switch.** `setLinked { placementId, on }` links or unlinks a piece.

- On: every layout takes this placement's position, turn and surface, and a layout without the piece gets a copy. Refused where the piece doesn't fit.
- Off: the copies stay where they are, and each layout owns its own from then on.
- A stair, beam or wheel well is refused: "<name> is in every layout".

Properties shows the switch as **Every layout**, in the Placement section, when the drawing has two or more layouts, and never for a stair, beam or wheel well (`linkedSwitch` in `packages/editor/src/properties/object.ts`). To take a linked piece out of one layout: switch it off, then delete it there.

## Checks per layout

Every command that moves a wall or a piece validates the whole document, so each check below runs in every layout, after furniture edits and wall edits alike. A wall moved in Day is refused if it meets a bed that stands there only in Night. The four state commands, `removePlacement` and `renameObject` return without `validateDocument`. On a shared drawing the server validates the result of every changeset as a whole ([collaboration.md](collaboration.md)). Refusal messages name the piece and the layout, and an overlap also gives the height ranges: "Bed in Night is not inside a room" ([warnings.md](warnings.md)).

| Invariant | Rule | Code |
|---|---|---|
| I9 | At least one state. Every placement names an existing object, state and deck (or no deck), with a configuration of its object's kind. One placement at most per object and state. Every object has a placement. | `layoutViolations` in `packages/domain/src/validate.ts` |
| I10 | A placement lies inside one room, or inside the deck it stands on, and clear of walls and decks. | `fitViolations` in `packages/domain/src/queries/fit.ts` |
| I11 | Two placements of one state don't overlap in plan and in height. Placements of different states never meet. | same |
| I17 | A piece's top stays under the ceiling. | same |
| I19 | A linked object has exactly one placement per state, equal in what it shares. | `copyViolations` in `packages/domain/src/stair-links.ts` |

Fit is skipped while I1 or I9 fails, so a broken reference is reported once. The fit rules themselves (shapes, tolerance, height ranges, standing on a deck) are in [furniture.md](furniture.md) and [heights-decks.md](heights-decks.md); the tuck exception is in [seating.md](seating.md). `placementFit` answers the same question for one candidate in one state, for ghosts and previews.

**Warnings**, never refusals, are also per layout. `clearanceWarnings(doc, stateId)` and `zoneBlocks(doc, stateId)` in `packages/domain/src/queries/clearance.ts` list the use zones of that state's placements and the door swings that a piece of that state or a wall blocks. A door is shared, but its swing is tested against each layout's furniture, so a swing can be blocked in Night and clear in Day. How warnings show is in [warnings.md](warnings.md).

## Commands

All in `packages/domain/src/commands/states.ts`. Renaming, copying and deleting don't validate their result and can't break fit: a copy repeats a valid layout. `addState` validates its result; it holds a part of a valid layout, so it fits.

| Command | Does | Refuses |
|---|---|---|
| `addState { opId, name }` | A new state `${opId}/s0`, after the last (`order` is the highest plus 1). It holds every linked piece and every stair, beam and wheel well, and no exception. Each stands as in the first layout by `order`: its configuration, sides and zones are that layout's. | An invalid, too long (over 120 characters) or used `opId`; a name over 200 units ("Name too long") |
| `copyState { opId, from, name }` | A new state `${opId}/s0` with a copy of every placement of `from`, exceptions included, as `${opId}/p0`, `p1`... in object-id order. Configuration, sides and zones are copied. Linked pieces stay linked. | The same; an unknown `from` ("Layout not found") |
| `renameState { stateId, name }` | Renames. The same name is accepted and changes nothing. | Unknown state; a name too long |
| `deleteState { stateId }` | Removes the state, its placements and every object left with none. Sheets follow in the same patch ([export.md](export.md)): a plan or compare sheet loses the drawings of that layout, a compare left with one drawing becomes a plan, a sheet left with none is removed, and a cover that shows the layout points at the first remaining one. | Unknown state; the last one ("A drawing keeps at least one layout") |

`deleteEntities` refuses a state ("Layouts are removed with their own command"). `movePlacements` and `duplicatePlacements` refuse placements of two states ("Placements must be in one layout"). `placeObject` with `{ existing: objectId }` puts an existing object into one more state, and is refused when it already stands there ("Already placed in this state"), so always for a linked object. The other furniture commands are in [furniture.md](furniture.md).

Dependencies, for conflicts between people ([collaboration.md](collaboration.md)): a state edit depends on its state; `copyState` also on the source state and each source placement; `deleteState` on its state, each placement and object it removes, the other placements of those objects, and each sheet it rewrites; a placement edit on the placement, its object, its state and its deck; a sync adds every row it touched.

## The active layout

Each viewer looks at one layout. It is editor state, `activeState` in `packages/editor/src/state.ts`, never part of the document and never sent as an edit.

- `activeStateId(state)` resolves it against the visible document: the viewer's choice while that state exists, else the first of `orderedStates`. Opening a drawing and a deletion of the layout in view both land on an existing layout.
- The plan, the 3D view, room tags, warnings, hit tests, the Object tool's ghost and every furniture gesture read the active layout.
- A change of the active layout drops furniture from the selection, because its placements belong to the layout left. Walls, openings and labels stay selected. A half-placed dimension is dropped too.
- The level in view is a separate choice ([levels.md](levels.md)).

## The layout pill

The pill floats at the bottom centre of the canvas (`StatePill` in `packages/web/src/panels/StatePill.tsx`). It lists `ViewModel.states`, `{ id, name, active }[]`, in `orderedStates` order.

| Control | UI action | Effect |
|---|---|---|
| Another layout's button | `setActiveState { id }` | Switches, locally, with a flip |
| The active layout's name field | `renameState { id, name }` | Renames on Enter or blur |
| `+` | `addState` | Copies the active layout and shows the copy |
| ⋯ then Rename | none | Focuses and selects the name field |
| ⋯ then Duplicate | `addState` | The same as `+` |
| ⋯ then Delete | `deleteState { id }` | Deletes the active layout; disabled on the last one, with the title "A drawing keeps at least one layout" |

- The UI's `addState` runs the domain's `copyState`, not `addState` (`onStateUi` in `packages/editor/src/layout-states.ts`). The copy is named "Layout N": N starts at the number of layouts plus 1 and skips names in use.
- Rename, copy and delete are ordinary edits and can be undone. Picking a layout is not an edit.
- Delete is only in the ⋯ menu, so a misclick on the pill never deletes a layout. Esc or a click away closes the menu; the up and down arrows move between its items.
- The pill is hidden while no drawing is open.

## The flip

Picking another layout starts a flip: the pieces glide from one arrangement to the other. It is presentation only; nothing is sent.

- The editor keeps `flip { from, to, startedAt, t }` and emits `requestFrame`. Each `frame` event carries the Host's clock and advances `t` until `FLIP_MS`, 500 ms (`packages/editor/src/flip-clock.ts`; `onFrame` in `layout-states.ts`).
- `flipPoses(doc, flip)` in `packages/editor/src/view/flip-poses.ts` gives one pose per object, eased with t²(3 − 2t).
- A piece in both layouts tweens its footprint's centre, its angle along the shorter arc, its width, depth, bottom and top, and draws the target layout's configuration. Centre and size move together, so a piece that keeps its back edge keeps it the whole way: a murphy bed folds down from its wall.
- A piece in one layout only stays in its pose. The plan fades it out or in; the 3D view shows it until the middle of the flip, or from the middle.
- A pose wholly above the cut of the level in view draws as a dashed outline, as on the still plan, so a lift bed turns solid as it comes down.
- Warnings and room tags show the target layout from the start.
- Any change to the visible document ends the flip at the final places. Picking a layout during a flip starts a new flip from the layout picked before.
- A layout made with `+` shows at once, with no flip.

The project cards flip on the same clock ([cards.md](cards.md)).

## Free floor

Free floor is the floor of a room that no furniture stands on, in one layout. `freeFloor(doc, stateId)` in `packages/domain/src/queries/free-floor.ts` returns it per room, keyed by the room's face key.

- It is the room's clear area ([walls-rooms.md](walls-rooms.md)) minus the shape area of each of that state's placements in the room, never below 0. The shape is the drawn one: a 0.90 m round table takes its circle, not its square.
- It is null where the clear area is unavailable.
- A rug takes no floor.
- A piece whose bottom is 1.20 m or more above its surface takes none (`ZONE_CLEAR_ABOVE` in `packages/domain/src/queries/vertical.ts`): a wall cabinet, a raised lift bed.
- Pieces stacked in plan below that height are each counted.
- A chair tucked under a table or desk: their overlap is counted once ([seating.md](seating.md)).
- A wheel well takes its part clear of the walls, and nothing where a piece covers it ([surroundings.md](surroundings.md)).

`furnishedRooms(doc)` is the set of rooms that hold a piece in some layout. Only those show free floor:

- The room tag's area line reads the clear area, then the active layout's free floor rounded to 0.1 m²: "22.04 m² · free 18.8 m²". Other rooms keep the plain area.
- An unlabelled furnished room shows a one-line tag with the same text at its interior point.
- Selecting a furnished room's label shows a read-only **Free floor** field in Properties, for the active layout (`packages/editor/src/properties/zone.ts`).

## Collaboration

Details are in [collaboration.md](collaboration.md).

- Presence carries each viewer's active layout as `state`. The editor sends presence again when the active layout changes: by picking, by copying, or when a deletion moves the viewer (`presenceOnStateChange` in `packages/editor/src/session.ts`).
- A collaborator's cursor reads a viewer's name plus the layout's name when they look at another layout, as "name · Night". An unknown layout shows the name alone. The level part of the label is in [levels.md](levels.md).
- Exceptions are separate rows per layout, so two people arranging exceptions in two layouts don't conflict. Configuration and zones are per placement, so they don't conflict across layouts either.
- A move of a linked piece writes its row in every layout, so two people moving one linked piece from two layouts conflict like any shared edit. Size, name and kind belong to the object and conflict the same way.
- A copy of a layout depends on its source placements: a zone-side toggle that lands before the copy makes the copy conflict; when the copy lands first, both are accepted.
- A new linked piece and a new layout made at the same time name no common row, so neither conflicts. The server's whole-document check (I19) refuses the second to arrive as invalid, not as a conflict.
- When someone deletes the layout a viewer is in, that editor moves to the first remaining layout and tells the others. A pending edit made in the deleted layout is rejected as a conflict.

## Claude's tools

Details are in [mcp.md](mcp.md). Claude names a layout by its id and a piece as the pair object and layout.

- `add_layout` runs `addState`: a new layout holding the linked pieces only. `copy_layout` runs `copyState`.
- `place_object` follows the placing rule above. Its `everyLayout` is `placeObject`'s `linked`, and the reply's note names a layout the new piece is left out of.
- `move_object` with `everyLayout` runs `setLinked`, alone or with a move: `false` unlinks before the move, `true` links after it. The two are checked together first, so a move the rules refuse leaves the link as it was ([mcp.md](mcp.md)).
- `delete` removes a linked piece from every layout and an exception from the named layout.
- `get_drawing` lists the layouts in order, each with its blocked zones and swings; each object with its place per layout, and `linked: false` on an exception when there are two or more layouts; and each furnished room's `freeFloor` per layout.

## Limits

- Layouts can't be reordered: no command changes `order`, and a new layout always goes last.
- The pill has no way to make an empty layout; `+` always copies. Only `add_layout` reaches the domain's `addState`.
- Walls, rooms, openings, decks and the ceiling can't differ between layouts.
- An object's size, height and elevation are the same in every layout; only the configuration picks between them.
- A linked piece shares its surface too, so it can't stand on a deck in one layout and on the floor in another without being made an exception.
- Whether a piece is linked shows in Properties only, not on the plan.
- A linked piece can't be removed from one layout in one step.
- The active layout is not saved with the drawing.

## At levels

Layouts and levels are independent: every layout holds the pieces of every level, and a viewer picks a layout and a level separately ([levels.md](levels.md)).

- **Placements.** A placement's `deck` names the platform or loft it stands on. A linked piece stands on the same surface in every layout; an exception's surface is per layout. An object's elevation is one number per configuration, measured from its surface, so an exception on a platform in Day and on the floor in Night keeps the same elevation over each.
- **Fit.** I10, I11 and I17 run in every layout for a piece on a platform and on a loft as for one on the floor, with the deck rules of [heights-decks.md](heights-decks.md).
- **Warnings.** `clearanceWarnings` is per layout and takes no level. A zone's band starts at its piece's surface, so a loft's zones warn about the loft's pieces. The editor shows each warning at the level that shows its piece or door.
- **Free floor.** A piece on a platform counts as on the floor and takes floor from its room. A piece on a loft takes none from the room under it, whatever its height: a loft has no room and no tag. A room that holds only loft pieces is not furnished and shows no free floor.
- **Room tags** are drawn at the floor level only. A room's label can be selected only there (`selectableAt` in `packages/editor/src/tools/selectable.ts`), so the Free floor field shows only at the floor.
- **The flip** draws at the level in view: a pose under the level, or one whose placements the level doesn't show (a loft's piece seen from the floor), is not drawn.
- **The pill** and the active layout are the same at every level.
