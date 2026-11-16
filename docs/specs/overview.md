# Overview

What Flatmate is, the model every feature follows, what it holds and what it leaves out, and how the code is layered. Read this first; every rule lives in the document linked beside it.

## What Flatmate is

Flatmate is a home planner in the browser for tiny houses, flats and small homes. A person draws the home on a plan and sees it in 3D beside the plan. Several people edit the same drawing at once, and Claude edits it as one more collaborator.

It runs on the person's own machine: a server that stores the drawings and a web app. [README.md](../../README.md) owns install and run, [try-it.md](../try-it.md) the first walk through the app, and [PHILOSOPHY.md](../../PHILOSOPHY.md) the principles, in the order that settles a conflict between them.

## The 2.5D model

Every part of a home is a shape on the plan with a height range, in metres above the floor (0.00).

```
2.50 +-----------------------------+  ceiling
     |          +----------+       |
1.80 |          | loft bed |       |
1.45 |          +----------+       |
0.75 |          +------+           |
     |  wall    | desk |           |
0.00 +----------+------+-----------+  floor
```

- A wall is its footprint from its base to the ceiling, or to a lower top for a half wall.
- A piece of furniture stores a height `h` and an elevation `z` for each configuration (`LayoutObject` in `packages/domain/src/model.ts`).
- A deck is a rectangle with a `top`: solid down to the floor, or a 0.12 m slab with room below (`DECK_THICKNESS` in `packages/domain/src/presets.ts`).
- The ceiling is one row: flat at 2.50 m by default (`DEFAULT_CEILING` in `packages/domain/src/model.ts`), or a shed or gable roof whose `height` is its low side.

Two things collide only when their plan shapes overlap and their height ranges overlap (`solidsCollide` in `packages/domain/src/queries/fit.ts`). Ranges that only touch do not overlap. The desk above ends at 0.75 m and the loft bed starts at 1.45 m, so the desk fits under it. [heights-decks.md](heights-decks.md) owns the rule.

The plan edits and the 3D view shows. Every tool works on the plan, which is drawn as a horizontal cut 1.20 m above the viewed level (`PLAN_CUT` in `packages/domain/src/queries/vertical.ts`), lower under a low ceiling. The 3D view is built from the same shapes and ranges. Its controls change only how it is seen: they turn and tilt an orthographic camera, size the panel and hide the roof. Nothing is selected or changed there. See [view3d.md](view3d.md) and [levels.md](levels.md).

## What is in

| Area | What exists | Document |
|------|-------------|----------|
| Shell | walls with thickness that meet at shared joints, rooms with their clear area, columns, named areas | [walls-rooms.md](walls-rooms.md), [wall-editing.md](wall-editing.md) |
| Openings | doors, windows and doorways (passages and curtains) | [openings.md](openings.md) |
| Furniture | kinds with standard sizes, sets, chairs at tables and desks | [furniture.md](furniture.md), [seating.md](seating.md) |
| Layouts | layout states: the shell is shared, each state arranges the furniture | [layouts.md](layouts.md) |
| Heights | the ceiling, half walls, decks (platforms and lofts), levels | [heights-decks.md](heights-decks.md), [levels.md](levels.md) |
| Stairs | flights, spirals, storage steps and ladders, guards and handrails | [stairs.md](stairs.md), [guards.md](guards.md) |
| Roof | flat, shed or gable, with beams | [roofs.md](roofs.md) |
| Finishes | floors, wall sides, the roof's covering | [finishes.md](finishes.md) |
| Surroundings | the ground, the trailer, wheel wells, door steps | [surroundings.md](surroundings.md) |
| Editing | tools with single-key shortcuts, typed values, snapping, refusals and warnings | [tools.md](tools.md), [typed-input.md](typed-input.md), [warnings.md](warnings.md) |
| Views | the plan in three renderers, the 3D view, section cuts | [rendering.md](rendering.md), [view3d.md](view3d.md), [sections.md](sections.md) |
| Paper | PNG, SVG and PDF sheets | [export.md](export.md) |
| Tracing | a plan picture under the drawing | [underlay.md](underlay.md) |
| Together | shared drawings on the server, live cursors, undo per person | [collaboration.md](collaboration.md) |
| Claude | an MCP server with the same rules as a person | [mcp.md](mcp.md) |
| Start | the project list as cards, the sample houses | [cards.md](cards.md), [samples.md](samples.md) |

The drawing itself is a set of tables (`Document` in `packages/domain/src/model.ts`); [domain.md](domain.md) owns them and their invariants.

## The three rings

```
shells                     web, server, mcp, scripts, test harnesses
  @fm/export, @fm/render   file writers and GPU records: read the editor, imported by shells only
  @fm/editor               how a person edits: tools, snapping, camera, undo
    @fm/domain             what a valid drawing is
      @fm/protocol         wire messages, patches and changesets
```

- The domain is pure functions: `execute` in `packages/domain/src/commands/execute.ts` turns a drawing and a command into a new drawing and a patch, or an error, and `validateDocument` in `packages/domain/src/validate.ts` checks a whole drawing.
- The editor is one function, `update(state, event, host)` in `packages/editor/src/update.ts`: it returns the next state and effects (`render`, `submit`, `startTimer`, `saveFile` and others) as plain data for a shell to perform.
- Every shell reaches the same domain rules: the web app through the editor, the MCP shell through a headless editor after a first check with `execute`, the server through its `ChangesetValidator` port (`packages/server/src/app/ports.ts`). [../architecture.md](../architecture.md) owns the packages, who imports what and the dependency rules; [editor.md](editor.md) owns the loop, ports and effects.

## Limits

Left out on purpose, for the reasons in [PHILOSOPHY.md](../../PHILOSOPHY.md):

- **No 3D modelling.** Nothing is drawn or moved in the 3D view, which has no zoom, pan or perspective. Whatever is not a plan shape with a height range is outside the model.
- **Not a construction tool.** A stair's size checks are warnings (`packages/domain/src/queries/stair-checks.ts`), and nothing checks a building code.

Not built yet; see [roadmap.md](roadmap.md):

- **Several floors.** A home is one floor plus the decks on it, viewed one level at a time.
- **Local files and offline editing.** Without a server URL the web app holds one unsaved `LocalDocument` (`packages/editor/src/document/types.ts`) with no project list, lost on reload. The `saveSnapshot` effect is declared and never emitted.

Not supported:

- **Arc walls and crossing walls.** Walls are straight. One that would cross another in its interior is refused ("Walls can't cross"); it may end on one, which splits it.
- **Walk paths.** Only use zones and door swings are checked, as warnings. See [warnings.md](warnings.md).
- **Layers, styles and comments.**
- **AI features inside the editor.** Claude works through the MCP server only.
- **Merging.** The server takes one edit at a time per project. An edit built on versions that have changed is rejected, so the first writer wins. See [collaboration.md](collaboration.md).
- **Authentication, and more than one tested browser engine.** See the README's [Limits](../../README.md#limits).
- **A stable stored format.** The server upgrades a stored drawing when it loads it (`upgradeStored` in `packages/domain/src/serialize.ts`): missing tables and fields are filled, and the result is written back with the next accepted edit. While versions are 0.x, a change of format may come without an upgrade step. [domain.md](domain.md) owns the detail.
