# Wall editing

How walls are drawn and changed: the Wall tool's transitions, moving a run, sliding a straight joint, connecting a dropped joint, stitch, join and split, near-square and Straighten, typed and matched lengths, groups, and Claude's tools. Wall data, mitres and rooms: [walls-rooms.md](walls-rooms.md). Typed values: [typed-input.md](typed-input.md). Snaps and the snap step: [tools.md](tools.md). Refusals: [warnings.md](warnings.md).

## Terms

| Term | Meaning | Code |
|---|---|---|
| in line | Two walls meet at a joint that lies within 1 mm (`EPS`) of the line through their far ends, between them. | `continuation` (private) |
| straight joint | A joint with exactly two walls, in line. | `isStraightJoint` |
| run | The walls reached from a wall by walking through joints where exactly one other wall continues in line, whatever else meets there. A T's stem does not stop it; a column in a wall's line belongs to it. | `wallRunOf` |
| connected run | A run with a joint that holds a wall outside the run. | `wallsTarget` |
| side | The walls going on from a wall through joints where exactly one other wall continues within 1°. | `nearSide` |

The queries are in `packages/domain/src/queries/runs.ts`, `wallsTarget` in `packages/editor/src/tools/run-drag.ts`, `nearSide` in `packages/domain/src/commands/straighten-walls.ts`.

## The Wall tool

The tool's state is `WallToolState` (`packages/editor/src/tools/types.ts`); its transitions are in `packages/editor/src/tools/wall-tool.ts`.

**Thickness.** Every wall the tool draws, and its preview, uses `wallThickness` of the editor state (`packages/editor/src/state.ts`), not of the document. It starts at 0.20 m and shows in the floating bar. `setWallThickness` (`packages/editor/src/properties/edit.ts`) keeps the setting and toasts for a value it can't read or outside 0.05 to 0.50 m.

**Points.** Every point is the snapped cursor (`snapPoint`, [tools.md](tools.md)). Two points within 1 mm are the same point. A typed length runs from the origin towards the snapped cursor, after `Shift`'s axis.

| State | Input | Next state | Effect |
|---|---|---|---|
| `idle` | press at p | `drawing` with `origin` and `chainStart` at p, `value` empty, `dragFrom` the raw pointer point | none |
| `idle` | `Esc` | the Select tool | none |
| `drawing` with `dragFrom` | release more than 4 px from `dragFrom`, snapped to q | `idle`: one drag draws one wall and the chain ends | `addWall(origin, q)`; a refusal toasts |
| `drawing` with `dragFrom` | release within 4 px, or one that snaps onto the origin | `drawing`, `dragFrom` cleared: the press counts as a click | none |
| `drawing` | pointer move | same, with a preview from the origin to the snapped cursor | none |
| `drawing` | a value key or `Backspace` | same, `value` edited | none |
| `drawing` | press on the origin (a double click) | same; ignored, no toast | none |
| `drawing` | press on `chainStart` | `idle`: the chain closes | `addWall(origin, chainStart)` |
| `drawing` | press at q | `drawing` from q, `value` empty | `addWall(origin, q)` |
| `drawing` | `Enter` with a value v | `drawing` from q = origin + v · direction, `value` empty | `addWall(origin, q)` |
| `drawing` | `Enter` with no value | `idle` | none |
| `drawing`, `paused` | `Esc` | `idle`; walls already placed stay | none |
| `drawing`, shared document | press at q or `Enter` with a value, the commit pending | `paused` with `origin` q and `segment` the commit's id | `addWall(origin, q)` submitted |
| `paused` | pointer move, press, value key, `Backspace`, `Enter` | same; no preview; input is ignored, never queued | none |
| `paused` | `accepted` for `segment`, a joint still within 1 mm of the origin | `drawing` from the origin, same `chainStart`, preview at the cursor | none |
| `paused` | `accepted` for `segment`, no joint at the origin | `idle`, with the `CHAIN_ENDED` toast; the accepted walls stay | none |
| `paused` | `rejected` for `segment` | `idle`; the rejection's toast gives the reason | none |

- The 4 px drag threshold (`DRAG_THRESHOLD_PX`) is world distance times the zoom. Only the chain's first press can start a drag; a dragged wall never pauses.
- A press ignores a typed value; the value is cleared when a wall is placed, and kept after a refusal or a press on the origin. A typed length never closes the chain.
- `Enter` toasts and places nothing for a value that can't be read, for zero or less, and with the cursor on the origin (no direction).
- A refused `addWall` toasts the reason. After a press or a typed length the state stays as it is; a refused dragged wall still ends the chain. The preview runs the same `addWall` under the id `preview` (`PREVIEW_OP`), red when refused.
- Where an end lands is `addWall`'s end resolution (`resolveAt` in `packages/domain/src/commands/wall-ends.ts`), with its refusals: see [walls-rooms.md](walls-rooms.md).

A local document never pauses; pending commits are in [collaboration.md](collaboration.md), the resume is `resumeChain` in `packages/editor/src/gestures.ts`. A remote topology change ends a chain, drawing or paused, with the `CHAIN_ENDED` toast, and so does losing the joint at the origin once a wall is placed; the general rule for gestures under remote changes is in [tools.md](tools.md).

## Moving a wall: the run moves

```
 ═════╦═════ ↓   press one piece of a split side and drag:
      ║          the whole run moves, through the T,
 ═══════════     straight across itself; the stem stretches
```

- **One command.** Pressing a wall in Select and dragging moves its whole run by one delta: `moveWalls { walls, by, placements? }` (`packages/domain/src/commands/move-walls.ts`). Every joint of every listed wall moves, as one patch and one undo step; walls meeting those joints stretch or turn. The editor sends the run it finds at the press.
- **Columns.** A column in the run moves rigidly: `moveWalls` passes the column lock only for a column whose two joints both move. A free column in the list refuses.
- **The run shows before the drag**: `highlightedWalls` in `packages/editor/src/view/run-highlight.ts` lights the run of a hovered or lone selected wall in Select. The selection stays that one wall.
- **Across only.** A connected run moves only along its normal: the pointer's movement is projected on it (`wallsDelta`). A run with no connection moves freely, each axis rounded to the snap step, `Shift` keeping the larger axis.
- **Snapping across** (`acrossSnap` in `packages/editor/src/snapping/across.ts`). The distance across is rounded to the snap step. Within the 10 px snap tolerance, the run's centreline or a face lines up with the centreline or a face of another exactly parallel wall on screen, centre to centre or face to face; the nearest wins, and lining up wins over the step. It draws as an aligned snap. A column is no target.
- **`Ctrl`** drops lining up and the step, keeps across-only, and rounds to the millimetre.
- **Live distances** (`runDistances` in `packages/editor/src/view/run-distances.ts`). While a connected run moves, at most two lines show the clear distance in whole centimetres from each face of the run to the nearest wall face on that side that is parallel within 1° and whose span overlaps the run's. None shows while the move is refused.

### Doors and windows when a wall stretches

An opening's offset runs from its wall's joint a. In every command that moves joints (`moveJoints`, `setWallLength`, `moveWalls`, `straightenWalls`, `connectJoint`), `keepOpeningsInPlace` (`packages/domain/src/commands/opening-stay.ts`) treats each wall at a moved joint by what happened to it. A wall that stretches (its direction unchanged, its ends moved by different amounts) keeps its openings at their place in the world: the offsets are corrected for joint a's move. A wall carried whole (both ends by one delta) or turned keeps its offsets, so its openings travel with it. An opening that a stretch would push off its wall refuses the move, naming the opening.

## A straight joint slides along its line

Dragging a straight joint moves it only along its line (`slideLine`, `slidePoint` in `packages/editor/src/tools/joint-slide.ts`): by the snap step from where it started when the snap is the grid or none, else onto the projection of the snap point on the line. `Ctrl` frees the joint: it goes to the pointer. Both round to the millimetre. A corner or a T drags freely.

## Connect on drop

A joint drag previews and commits `connectJoint { opId, jointId, to }` (`packages/domain/src/commands/connect-joint.ts`). The joint lands where `resolveAt` says, with its own walls left out of the search (no self-split) and columns left out:

- On another joint of the same base it merges into it: its walls are re-ended, it is deleted, and a dimension anchored to it is re-pointed to the joint it merged into.
- On a wall's body of the same base it splits that wall there, the moving joint as the split joint, the fragment `${opId}/w1`.
- Anywhere else it is a plain `moveJoints`.

"On" is within 1 mm. A joint drag has no angle snaps, and `Shift` holds it to the axis from where it started. The joint's own walls stretch or turn to the landing point first, so a stretched wall keeps its openings in place.

Refusals: "Wall too short" when the merge target is the far end of one of the joint's walls; "Walls can't overlap" when the merge would leave two walls between the same joints; "Joints can't overlap" when the landing is within 1 mm of a joint of another base whose height range overlaps the moving joint's (this reason outranks a crossing); a split inside an opening; a split that would leave a piece under 1 cm (`MIN_EDGE`).

A column's joint is locked, and a landing on or near a column refuses with the column's own reason.

## Stitch, join and split

**Stitch on delete** (`stitchJoint` in `packages/domain/src/commands/stitch.ts`, called by `deleteEntities`). After a delete, each joint a deleted wall left behind is stitched when it is a straight joint between two walls that match:

- the same thickness, the same top and the same base, neither a column;
- each side shows the same, face to face: the resolved finish and band (`sideFinishes`), compared after the delete and after room labels merge, because merged rooms change inherited finishes.

The survivor is the wall whose joint b is the stitched joint, so its joint a stays; on a tie, the first by id. It keeps its id, sense and stored sides, and takes both walls' openings at their world places. The joint is deleted, and a dimension anchored to it is deleted. Other joints are never stitched, so a Split stays.

**Delete on a straight joint** joins its two walls the same way and deletes neither.

- Pieces that differ refuse, naming the difference: "The walls differ in thickness (0.20 and 0.12 m)", "… in height" (top or base), "… in finish on the Bath side" (the room's name, or "the outside").
- Two walls more than 0° and at most 1° out of line refuse with the angle: "These walls are 0.35° out of line: move one side to line them up" (`kinkAngle`).

On a corner, a T, or two walls more than 1° apart, Delete on the joint deletes its walls.

**Finding the joint.** While a run is hovered, selected or moving, each straight joint in it shows a tick with a dot across the wall (`runJointTicks`). A click on a selected wall's end handle selects that joint. A selected joint's Properties (`packages/editor/src/properties/joint.ts`) shows **Join walls** when the joint is straight or within 1° of it. Join walls sends the same delete; where it would refuse, it is disabled with the reason under it.

**Split.** A selected wall's Properties shows **Split**, which arms a one-shot gesture in Select (`splitting`; `packages/editor/src/tools/split-gesture.ts`):

- Within 30 px of the wall (`SPLIT_REACH_PX`) the pointer's projection shows a tick with the clear distance from each end beside it. The tick snaps to the room-side face's midpoint or to another joint's line (aligned), else to the snap step along the face from its start.
- A press on the wall, or `Enter`, splits at the tick; a typed value and `Enter` split at that distance from the face's start. `Esc` clears a typed value, then cancels. A press off the wall cancels.
- A refusal keeps the gesture armed. A remote change cancels it when it writes the wall, its joints, the walls at them or its openings, deletes any opening, or changes the topology ([tools.md](tools.md)).

`splitWall { opId, wallId, offset }` (`packages/domain/src/commands/split-wall.ts`) cuts at `offset` metres along the room-side face from the face's start. The wall keeps its id from joint a to the new joint `${opId}/j0`; the fragment `${opId}/w1` copies its row and runs to joint b. Openings past the cut move to the fragment at their world places. It refuses inside an opening, where a piece would be under 1 cm, and on a column.

## Near-square and Straighten

**Near-square lands square** (`squared` in `packages/editor/src/snapping/near-square.ts`, run by `snapPoint` on the far ends passed as `squareFrom`). Without `Ctrl`, when the point comes from the grid, an aligned snap or no snap, and a wall from a far end to it would be within 1° (`NEAR_SQUARE_DEG`) of horizontal or vertical but not on it, the point takes the far end's y (near horizontal) or x (near vertical).

- The Wall tool passes its origin; a joint drag the far ends of the joint's walls; other tools pass none. A straight joint slides instead.
- It never changes an exact snap: endpoint, midpoint, on-wall, perpendicular, angle, equal.
- When two walls on one axis disagree about the coordinate, that axis is left alone. A typed length follows the corrected direction.

**The angle readout.** A selected wall off both axes by more than 0° and at most 1° shows a read-only Angle in Properties ("0.35°"), from `offAxisAngle`. `get_drawing` lists it as `angle`.

**Straighten** (`straightenWalls { wallId }`, `straightenPlans`). The action shows in a wall's Properties when its side lies within 1° of horizontal or vertical and its joints are not all on one line: a side with a slight kink, in one piece or several, such as a joint 0.35° out of line. It gives every joint along the side the same y (or x):

- The line most of the side already holds wins: each wall votes its length, half for each end's coordinate rounded to the millimetre. On a tie, the lower coordinate.
- When the drawing refuses that line (a piece in the way), the next candidate is tried. With none left the action is off with the first refusal under it.
- Walls meeting the side stretch by those millimetres. One undo step. A side already straight on an axis, or more than 1° off both, refuses.

## Typed and matched lengths

**A typed clear length** (`clearLengthCommand` in `packages/editor/src/tools/chain-edit.ts`). A value typed into a selected wall's length plate is the clear length of its room-side face after the move, to the millimetre. It sends `setWallLength { wallId, length, keep: "a" }`: joint a stays, joint b moves along the wall. The editor corrects the centre length until the face measures the typed value on the resulting document. `setWallLength` also takes `keep: "b"`, refuses a length under 1 cm with "Wall too short", is locked on a column, and writes nothing for an unchanged length. The plates for the pieces between openings are in [openings.md](openings.md).

**A typed distance while moving walls** (`typedDelta` in `run-drag.ts`, `movingKey` in `packages/editor/src/tools/select-tool.ts`). Value keys go to a distance in metres. When it reads as more than 0, the preview moves exactly that far: a connected run along its normal, on the side the pointer moved to; a free run or a group along the larger axis of the pointer's movement. Until the pointer has moved, the value waits. Release or `Enter` commits what the preview shows. `Esc` clears the value, then cancels the drag. Any other single character is swallowed, so a letter never picks a tool; `Ctrl` and `Cmd` chords pass.

**Equal length** (`equalLength` in `packages/editor/src/snapping/equal.ts`). In the Wall tool and in joint drags, when the wall being drawn or changed comes within the snap tolerance of the length of another wall, its end snaps to that length along its own direction. The other wall is parallel within 1°, off the moving wall's line by at least 1 mm, on screen, and neither a column nor excluded from the snap. The nearest length wins; both walls show "=" (snap kind `equal`). It runs after near-square and replaces only a grid or free point, or the Wall tool's plain angle ray. A sliding straight joint has none.

## Walls in groups

A group is walls and pieces of the active layout, alone or mixed (`packages/editor/src/tools/wall-group.ts`).

- **Selecting.** `Shift`-click toggles a wall, and a box takes the walls with both ends inside it. Columns, joints and openings are never grouped ([tools.md](tools.md)).
- **Moving.** Dragging a member of a group with walls moves every selected wall's joints and every selected piece by one delta, rounded per axis to the snap step; `Shift` keeps the larger axis, `Ctrl` rounds to the millimetre. No run and no across-only apply. One selected wall alone still drags its run. Walls with one end in the group stretch.
- **One command.** It is one `moveWalls` with `placements`: the joints and the pieces move, then one validation, so a piece may pass through a wall's old place. The pieces are in one layout; a linked piece moves in every layout, and labels stay in their rooms. One undo step.
- **What stays.** Decks with their holes, free columns, named areas and unselected pieces. A move that leaves any of them invalid is refused with the domain's reason.
- **Keys.** A group with walls can't be turned (`R`), nudged with the arrow keys or duplicated. `R` and the arrows say why; Cmd or Ctrl+D does nothing and says nothing (`packages/editor/src/duplicate.ts:49`).

## Claude's tools

Claude gives exact coordinates, with no snaps (`packages/mcp/src/shell-tools.ts`; see [mcp.md](mcp.md)).

| Tool | Command |
|---|---|
| `move_walls { walls, by, objects?, layout? }` | `moveWalls` on the walls named, not their runs; `objects` need `layout` |
| `move_joint { joint, to }` | `connectJoint` |
| `split_wall { wall, offset }` | `splitWall` |
| `straighten_wall { wall }` | `straightenWalls` |
| `set_wall_length { wall, length }` | `setWallLength`, keeping joint a; the centreline length, not the clear length |
| `delete` on a straight joint | `deleteEntities`, which joins the walls |

## Limits

- A connected run can't be dragged along its own line; `Ctrl` does not free it.
- Typing a wall's clear distance to its neighbour is not supported.
- Split's aligned snap works on walls along an axis.

## At levels

A wall stands on the floor or on a loft, never on a platform ([levels.md](levels.md)), so nothing here acts on a wall on a platform. A piece that moves with a group keeps its surface, platform or loft.

- **Wall tool.** A wall takes the base under its first point at the viewed level (`baseAt` in `packages/editor/src/tools/column-refs.ts`): the floor at the floor level, a platform's area included; at a loft's level the level's deck there. On a loft, a far end drawn into the body of a wall of another base whose height range overlaps the new wall's lands flush on that wall's face (`flushEnd`): a floor wall that rises past the loft or a wall on another loft, never a partition that stops under the loft. The preview, the click and the typed length agree.
- **Snaps and connections stay within one base.** The Wall tool and a joint drag leave out every wall of another base, its joints and all columns (`otherParts` in `packages/editor/src/snapping/snap.ts`), for the point snaps and for equal length. `resolveAt` merges and splits only within the moving joint's base, so a loft wall's end never joins a floor wall.
- **Height ranges decide the pair checks.** Coinciding joints, a crossing, a joint on a wall and an overlap are refused only where the two height ranges overlap (`packages/domain/src/wall-pairs.ts`): a loft wall may cross over a floor partition that stops under the loft.
- **Inside the deck.** A wall on a loft lies inside its deck and off its holes, so a run move, a joint drag, Straighten or a typed length that takes it past the edge is refused. A floor wall can't enter a deck's body where their heights meet.
- **Selecting.** At the floor level every wall can be hovered, selected, boxed and dragged as a run or in a group, a loft's walls included; at a loft's level only the walls standing on its decks. A wall's joint can be hit and dragged only at its base's level (`selectableAt` in `packages/editor/src/tools/selectable.ts`).
- **Changing the viewed level** to another height drops a wall chain, a walls or joint drag and an armed Split, with no toast (`dropGesture`).
- **Split and stitch.** A fragment keeps its wall's base and top; a stitch needs one base.
- **Across snap and live distances** read every wall, whatever its base.
