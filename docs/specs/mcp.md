# Claude's tools

Claude edits a drawing through an MCP server, `@fm/mcp` (`packages/mcp`), as one more collaborator: how it runs the editor, the tool list, addressing, replies, the listing, `look`, the text budgets and what Claude can't do. What each feature's tools take is in that feature's document, linked from the list.

## One more collaborator

The server speaks MCP over stdio and runs one headless editor (`initialState` and `update`, a Node `Host`) connected to the collaboration server as a normal client ([collaboration.md](collaboration.md)). That server has no MCP code and checks Claude's edits like anyone's.

```
 Claude ── MCP over stdio ──► @fm/mcp tool ──► EditorSession ── update(state, event, host) ──► @fm/editor ──► @fm/domain
                                                    │ effects: submit, presence, workspace
                                                    ▼
                                               WebSocket ──► server ──► every other window
```

- A tool runs a domain command through the editor's event `{ type: "command", command }`, the commit path of a canvas tool: blocked while an edit is outstanding, executed, committed, kept in history. The shell never applies a command or builds a changeset itself.
- `EditorSession` (`packages/mcp/src/session.ts`) is the only place that changes editor state.
- One process holds one connection and at most one open project. `FM_SERVER_URL` names the server (default `ws://localhost:8787`), `FM_NAME` the client (default "Claude"). The socket reconnects with a backoff up to 8 s.
- The shell logs to stderr only: stdout carries the protocol.
- After an accepted edit Claude's cursor moves to where it happened, through the editor's `pointAt` event (presence only): a room's centre for `draw_room`, the last wall's middle for `add_walls`, a piece's centre for a move. `delete`, `set_ceiling` and the layout tools move none. The cursor carries no level: Claude stays at the floor.

## One edit, end to end

```
add_wall ─► schema ─► pre-check: execute on the drawing shown
   ├─ refused ─────────────────────────► reply: the domain's message
   └─ command event ─► submit c7 ─► server
        ├─ ack c7 ─────────────────────► reply: result, changed, warnings
        ├─ rejected c7 ────────────────► reply: the editor's toast text
        ├─ project deleted ────────────► reply: PROJECT_DELETED
        ├─ connection dropped ─────────► reply: CONNECTION_DROPPED (c7 settles after reconnecting)
        └─ no answer in 10 s ──────────► reply: NO_ANSWER (call get_drawing to check)
```

Every wait ends after the session's 10 s (`DEFAULT_TIMEOUT_MS`). The pre-check's refusal is the domain error's `message`, which names IDs; a person's toast shows its `plain` wording (`packages/domain/src/errors.ts`). Blocked or offline, an edit answers at once with the editor's toast. A refusal changes nothing and is a tool error. With no project open a drawing tool replies `NO_DRAWING`; the three project tools wait up to 10 s for the connection, then reply that the server is not connected.

## Each tool is one turn

Every handler runs whole in one turn of the session (`inTurns` in `tools.ts`, `serial` in `session.ts`): calls run one at a time in arrival order, each reading the drawing after the calls before it settled. Nothing is applied optimistically or replayed.

A few tools send several edits in their turn, checked together with `execute` first, so a refusal before sending changes nothing; another person's edit between them can still stop the rest, and the reply says how many went through.

| Tool | Edits |
|---|---|
| `draw_room` | four `addWall` (`rectangleRoom`) |
| `add_walls` | one `addWall` per wall; a refusal names the wall's place in the list |
| `set_zones` | `setZoneSides`, then one `setZoneExtent` per side given a zone |
| `set_opening` with `offset` and more | `moveOpening` and `setOpening`, in the first order the rules accept |
| `move_object` with `everyLayout` and a move | `setLinked` and `movePlacement`, not checked together (Limits) |

## The tools

54 tools: `TOOL_NAMES`, descriptions and annotations in `packages/mcp/src/server.ts`, schemas in `schemas.ts`, handlers in ten groups on one kit (`tool-kit.ts`).

| Group | Tools |
|---|---|
| Projects | `list_projects` (goes to the project list, closing the drawing), `create_project`, `open_project` (both reply with the listing) |
| Reading | `get_drawing` (the listing), `look` (a picture), `read_report` (a report sheet's whole text) |
| Walls and rooms ([wall-editing.md](wall-editing.md#claudes-tools), [walls-rooms.md](walls-rooms.md)) | `draw_room` (four walls from `corner`, `width` along x, `depth` along y), `add_wall`, `add_walls` (up to 50, in order), `set_wall_length` (joint a stays), `set_wall_thickness`, `set_wall_top`, `move_joint`, `move_walls`, `split_wall`, `straighten_wall`, `label_room` |
| Ceiling ([roofs.md](roofs.md#claudes-tools)) | `set_ceiling`: flat, shed or gable |
| Decks and structure ([heights-decks.md](heights-decks.md), [guards.md](guards.md#claudes-tools)) | `add_deck`, `set_deck`, `add_hole`, `set_hole`, `add_column`, `set_column`, `add_area`, `set_area` (columns and named areas: [walls-rooms.md](walls-rooms.md)) |
| Pieces ([furniture.md](furniture.md), [seating.md](seating.md#claudes-tools), [layouts.md](layouts.md#claudes-tools)) | `place_object`, `move_object` (one piece or a group), `set_configuration`, `set_size`, `set_zones`, `set_opens_into`, `set_desk`, `set_chairs`, `place_set`, `break_apart` |
| Stairs ([stairs.md](stairs.md#claudes-stair-tools)) | `add_stair` (up to a deck's edge, straight or L), `set_stair` |
| Layouts | `add_layout` (`addState`), `copy_layout` (`copyState`) |
| Openings ([openings.md](openings.md#claudes-tools)) | `add_door`, `add_window`, `set_opening` |
| Lines | `add_dimension` (ends tied to joints or floor corners), `add_section` ([sections.md](sections.md)) |
| Underlay ([underlay.md](underlay.md)) | `scale_underlay` |
| Sheets ([export.md](export.md)) | `add_sheet`, `set_sheet`, `move_sheet`, `delete_sheet` |
| Across the drawing | `rename` (a room label, layout or piece; a deck, area or sheet is refused naming its `set_` tool), `delete` (any rows as one edit, or one layout alone), `set_finish` ([finishes.md](finishes.md)), `set_project_field` (title block, sheet set, surroundings, trailer: [export.md](export.md), [surroundings.md](surroundings.md)) |

Each tool carries a title from its name ("Get drawing") and the MCP hints of its effect (`EFFECTS`): read, open, add, set or rescale (`move_walls`, `scale_underlay`: a second call changes again). Only read is read-only; `openWorldHint` is false for all.

The resource `flatmate://drawing` is `get_drawing` without a region, for a client to attach; it has no subscriptions.

## Addressing

- **IDs.** Every row is named by the id the listing gives, checked by the wire ID check. A created row's id is read from the edit's patch (`createdIn`) and given in the reply's `result` (`object`, `objects`, `deck`, `hole`, `column`, `area`, `opening`, `dimension`, `label`, `layout`, `sheet`, `section`).
- **Layouts.** A layout is named by its id from `layouts`, never by its name. A piece in one layout is the pair `object` and `layout`. Walls, openings, decks, columns and dimensions belong to every layout and take none.
- **Positions.** Metres, y up. A piece's `centre` is its footprint's centre, turned into the stored back-edge anchor by the tool; `rotation` is whole degrees counter-clockwise, and at 0 the front faces −y.
- **Along a wall.** An opening's `offset` is metres from joint a to its end nearer a; `side` is left or right looking from joint a to b.
- **The rest.** A section is its letter, a sheet its id ([export.md](export.md)), a preset its name. Without `on`, `place_object` and `move_object` follow the floor level's landing rule; `on` names `"floor"` or any deck, a loft included ([levels.md](levels.md)).

Inputs are the trust boundary: the SDK parses each schema before the handler runs and drops unknown fields. Coordinates lie within ±10,000 m (`MAX_COORD`), sizes in (0, 1,000] m; names take 1 to 200 characters. `delete`, `add_walls` and a group move take up to 50 items, `move_walls` 200 pieces. A kind, preset, field key or motif outside its list stops at the schema; the domain checks again.

## Words

- **Layout**, never "state", in every parameter, key, tool name and text; the domain and the editor keep `state`. `look` checks a layout id itself, as the editor's refusal says "layout state".
- **`centre: { x, y }`** for every centre. A point that isn't one keeps its name: `draw_room`'s `corner`, `add_stair`'s `at`, `add_dimension`'s `from` and `to`, `label_room`'s `point`, a room label's `at`.
- **`upper`, `lower`, `left`, `right`** for the plan's sides, `set_ceiling`'s `falls` and a deck's `guards` included.
- **camelCase** parameters and keys (`everyLayout`, `handrailLeft`); snake_case tool names.
- **Preset names** ("King", "4 seats", or the first size in cm, "170 × 70"): `preset-names.ts` maps them to the domain's ids. A bare width is refused.

## Edit replies

An edit replies without the drawing:

```
{ "result":   { "opening": "w3/d1", "wall": "w3" },
  "changed":  { "created": { "openings": ["w3/d1"] }, "updated": {}, "deleted": {} },
  "warnings": { "added": [ { "layout": "n/s0", "zone": "Door w3/d1 swing", "by": "Bed (o3)" } ], "cleared": [] } }
```

- `result`: what the tool touched or created, and `note` where `place_object` left a piece out of a layout.
- `changed` (`changedBy` in `tool-kit.ts`): every row the patches wrote, under `created`, `updated` and `deleted`, grouped by the listing's words (`walls`, `joints`, `labels`, `objects`, `placements`, `layouts`, `columns`, …). A wall is `{ id, from, to }`, a joint `{ id, at }`, a placement `{ object, layout }`, any other row its id; a deleted row is read from the drawing before. A row created and deleted by one call is left out. A multi-edit tool lists all its edits.
- `warnings` (`warningsBy`): the blocked use zones and door swings the edit made and ended, each with its layout's id. One standing before and after is in neither.

`get_drawing`, `open_project` and `create_project` reply with the listing.

## The listing

`summarize` (`packages/mcp/src/drawing.ts`) gives compact JSON: coordinates and lengths to the millimetre, areas to 0.01 m², a pitch to 0.1°.

- `project`, `units`, `counts`; `layouts` in order, each with `blocked`: every use zone or door swing a piece or wall overlaps, with ids ("Wardrobe (o2) front zone" by "Bed (o3)").
- `walls`: joints, ends, length; `thickness` only when not 0.20; `on`, `top`, `angle` (up to a degree off an axis), `openings` by offset and custom `sides` when they apply. `joints`. Columns stay out of both.
- `rooms`: labels, named areas, clear `area` net of holes (or null with a `note`), `outline`, `floor` (corners `add_dimension` ties to), `holes`, `freeFloor` per layout where furnished; then `unplacedLabels`, `unplacedAreas`.
- `objects`: kind, name, `sizes` per configuration; one `placement` when the same in every layout (centre, rotation, configuration, `on`, sides, zones), else `placements` per layout, null where absent; `linked: false` on an exception; a stair's `stair` line; `options`, `arms`.
- `decks` (with guards, holes, `slabArea`), `columns`, `dimensions`, `sections`, `fields`, `underlay` (bounds and scale, never the bytes), `ceiling`, `roof`, `outside`, `cut`, `levels` (floor first), `sheets` (a report as its length and first line).

Above 300 walls (`MAX_LISTED_WALLS`) the reply is an overview: counts, layouts, bounds, fields, underlay, ceiling, cut, levels, sheets, sections and a hint to pass a region, with no blocked clearances. `region: { min, max }` lists only what touches the box, with the whole drawing's counts; one holding more than 300 walls gets the overview.

## look

`look` replies with the PNG, then one caption line, with no output schema; no other reply carries the underlay's bytes. A picture is 1,100 px on its long side (`LOOK_LONG_SIDE`); a plan look stays under 1 MB.

- **Plan** (default): `lookPicture` in the editor, in one strong colour: the underlay faded grey, walls, openings, decks, the pieces of `layout` (default the first), room names, dimension lines, metre rulers. `toSvg` draws it and `rasterise.ts`, the only module importing resvg-js, rasterises it in the bundled Inter. Default region: the underlay with a 4 % margin, else the drawing. Caption: `[UNSCALED · ]region … · M m per look pixel · y up[ · layout Name]`, the layout while there are pieces. A region needs min below max, a long side of 0.05 to 100,000 m and a short side at least 1/1,100 of it. It draws the floor level.
- **3D** (`view: "3d"`): the layout from `yaw` (degrees counter-clockwise from +x, any value, default 225) and `tilt` (10 to 90, default 35, `DEFAULT_ANGLES`); `roof: true` shows the house from outside. The editor's `lookScene3d` gives the faces; `look3d-png.ts` draws them with `raster3d` ([view3d.md](view3d.md)).
- **Section** (`view: "section"`, `section`: a letter): `lookSection` in the layout ([sections.md](sections.md)).

A region off the plan, a yaw or tilt off 3D, `roof` off 3D or `section` off its view is refused. The description holds the tracing steps ([underlay.md](underlay.md)).

## Text budgets

Claude's clients keep the first 4,096 characters of a server's instructions and, in older versions, the first 2,048 of a tool's description. `packages/mcp/test/server.test.ts` holds the instructions and every description to those caps. The instructions sit within 40 characters of theirs, `get_drawing` and `add_stair` within 10: a new sentence there needs a cut.

- `INSTRUCTIONS` runs: the editor and coordinates, layouts and pieces, heights, the plan cut, decks, then Levels with the landing rule, and ends with one line pointing to `look`'s tracing steps (a test checks the ending).
- What doesn't fit lives in its tool's description: deck limits in `add_deck` and `set_deck`, tied ends in `add_dimension`, the title block in `set_project_field`, the tracing loop in `look`.
- Every number in the text comes from its constant (`shown(PLAN_CUT)`, …); a test lists the few prose phrases allowed a digit.

## Limits

- `place_object` and `move_object` without `on` pass no `stair`, `well` or `beam` role to the landing rule (`landsOn` in `object-tools.ts`), where the Object tool does (`packages/editor/src/snapping/piece.ts`). A stair, wheel well or beam Claude places or moves can land on, or be refused against, another surface than on the canvas. `on` avoids it.
- `place_set` lands the set's box as a block 1.00 m tall, where the canvas ghost is as tall as the tallest piece, so under something between the two they can pick different surfaces ([seating.md](seating.md)).
- `add_layout` runs `addState`, which can build a layout with two linked pieces overlapping; a shared drawing's server then rejects it ([layouts.md](layouts.md)).
- `get_drawing` and `look` never show the "No guard" warnings: no MCP code calls `missingGuards` ([guards.md](guards.md)).
- `place_object`'s description and `add_stair`'s `handrail` parameter (`server.ts:489-490`, `schemas.ts:415`) say a new stair's handrails start as glass or railing, leaving out None, which a low stair gets ([guards.md](guards.md)).
- `set_opening`'s description doesn't say it moves an opening by `offset`; only the parameter's does.
- A retired kind is refused by the schema and by `place_object`; a stored one still moves, resizes and changes configuration.
- `move_object` with `everyLayout` and a move sends two edits (`false` unlinks first, `true` links after); if the second is refused the first stays, and the reply lists only the last one's rows.
- No tool deletes a project, changes a section (delete and re-add, losing its sheets), adds a logo, views a loft, duplicates pieces, switches a stair's kind or reorders layouts. Lengths are metres only ([roadmap.md](roadmap.md)).
- No claim is made about how Claude chooses to use the tools; tests cover the tools, not the model.
