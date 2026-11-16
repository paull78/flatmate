# Roadmap

What Flatmate does not do yet and is meant to: one paragraph per feature, with what it would need from the code. There are no dates. The order of the first list is the intended next order; the groups after it are by area, in no order. A built feature leaves this page for the document of its topic. What Flatmate leaves out on purpose is in [overview.md](overview.md).

## Next, in this order

**Lights and fans.** Pieces in the catalog, placed like any other: a ceiling light with presets (flush, pendant, chandelier, track), a ceiling fan, and a wall light (sconce) hung on a wall like a wall unit. The ceiling ones hang from what is over them, so they follow a roof's slope and a loft's underside, and collide by height range: a fan that doesn't fit over a loft bed is refused. Out: light in the 3D scene, switches and wiring. It needs new rows in `MORE_KINDS` (`packages/domain/src/kinds-more.ts`) with the "ceiling" elevation that `rangeOf` (`packages/domain/src/queries/vertical.ts`) already hangs from the ceiling or a loft, plus a plan symbol and 3D parts for each.

**Fireplace and chimney.** A piece against a wall with its hearth in front, a firebox and a mantel, and a masonry chimney that rises through the ceiling and ends above the roof; the wood stove's flue goes out of the roof the same way, with a cap. To settle: whether the chimney is part of the piece or a column, and what a loft or beam over it does (a hole, or a refusal). The wood stove's `flue` (`packages/domain/src/kind-rows.ts`) is drawn only, up to what is over it; a chimney needs a solid that passes the ceiling and is cut by the roof's planes (`roofPlanes` in `packages/domain/src/roof.ts`), where every piece today must end below the ceiling.

**Roof windows, the roof terrace and the A-frame.** A roof window sits in a shed or gable's slope, placed by its centre on the plan with a width and a length along the slope; it cuts the roof and the ceiling. A roof terrace cuts one slope down to an open floor, with a wall at the back, the slope's cheeks at the sides and a parapet at the eave. An A-frame is a gable whose slopes reach the floor, so its long sides are the roof. Out: dormers, opening sashes, a terrace on a flat roof. The ceiling row (`CEILING_ID`) holds one flat, shed or gable roof with no openings, and `MIN_CEILING` (1 m, `packages/domain/src/ceiling.ts`) with `MAX_PITCH` (60°, `roof.ts`) keeps every eave at least 1 m up; an A-frame needs an eave at the floor and headroom refusals near it.

**Pieces outside the walls.** An outdoor AC unit first (on a pad, or on brackets at an elevation), then gas bottles, a water tank and bins, standing against an outer wall's outside face, shared by every layout like an opening and listed under no room. Out: the line between the indoor and outdoor units, outdoor furniture. The fit rule (I10 in `packages/domain/src/queries/fit.ts`) keeps every piece inside one room or one deck; this group needs one exception to it, with a plain reason when the piece isn't against an outside face.

**Dropped ceilings.** A lowered ceiling over part of a room, as a rectangle drawn and edited with a deck's gestures, with an underside height and a type: Classic (solid up to the ceiling) or Cove (a band along its edges, full height inside). Inside one room, its underside at least 2.00 m and not below the head of an opening under it. Out: non-rectangular or sloped drops. It needs a new table in the `Document` and `ceilingOver` (`vertical.ts`) returning the lowest underside at a point, so pieces against the ceiling and decks' headroom follow it.

**Furniture from your own outline.** A "Draw to fit" tile takes a straight, L or U footprint and offers two to four proposals of ordinary pieces that all fit, each with a one-line reason; picking one places them in every layout as one changeset. First wardrobes (modules of 45 to 120 cm, a filler panel up to 0.10 m), then kitchens (sink, hob, dishwasher, fridge and counters by a fixed table of rules). Out: islands, wall cabinets, editing a placed run as a whole. It needs pure generator functions in `@fm/editor`, tested by tables and properties, and two Claude tools to ask for proposals and place one.

**Homes on several floors.** A storey is a level that carries rooms: its own walls, outer walls copied up once and never linked, the floor below as a reference, a height and a traced picture per floor, stairs between floors, stacked 3D, a sheet per floor and Claude on any floor. Built whole or not at all. To settle: how many floors, basements and split levels, and roofs over a stepped house. Levels come only from decks (`levels` in `packages/domain/src/queries/levels.ts`), and the ceiling and the underlay are one row each (`CEILING_ID`, `UNDERLAY_ID` in `packages/domain/src/model.ts`); floors need a level that owns walls and rooms, and a ceiling and a picture per floor.

**3D zoom, pan and perspective, shadows and glass.** Zoom and pan in the 3D view, a perspective camera, lighting with shadows, and see-through glass for windows, a glass shower screen, a Glass guard and a sheer curtain. The camera in `packages/editor/src/view3d/camera3d.ts` is orthographic and framed on the walls' box so it never zooms or slides, and both 3D renderers draw opaque faces with a depth buffer; glass needs transparent faces drawn after the opaque ones, far to near, without writing depth.

## Furniture and windows

**Blinds on windows.** A roller, Roman or Venetian blind on a window's room side, beside the two dressings that exist (a sheer curtain and a roller-shutter box). It needs a third field on `Opening` (`model.ts`) next to `sheer` and `shutterBox`, read where `dressings` allows them in `packages/domain/src/opening-kinds.ts`.

**Window dressings, the rest.** Curtains on doors, a curtain checked against pieces as a use zone, a casement's swing drawn through its sheer, a TV on a swing arm, a picture's image, and gallery walls. Each needs a field or a check on the opening or the hung piece it extends.

**Stacking helpers.** Stacked presets drawn as bands (washer and dryer, fridge and top cabinet), an "On top of" choice that sets the elevation to the top of the piece under it, and a height strip in Properties with every range over the footprint. They need no data change: a query over `rangeOf` for the placements under a footprint.

**Walk paths.** A check of the way between doors and furniture, beyond today's door swings and use zones, and swept checks for a flip. It needs a path query in `@fm/domain` and a warning kind beside the blocked-zone warnings.

**Sizes, the rest.** A minimum and maximum size per kind, a typed elevation while placing, typing a size on the canvas, and turning a drawn ghost. A size range needs a column on the kind's row in `kind-rows.ts`.

**More pieces.** An island, a bunk bed, a shoe cabinet, a sideboard, a floor lamp, a column of modules stacked bottom to top, and a finish per piece. A kind is a row in `kinds.ts` or `kinds-more.ts`; a finish per piece needs a field on `LayoutObject`.

**Quick add, later.** A palette at the cursor, recent pieces, and tools and doors in the same search. It needs the quick-add search to index tools and opening kinds beside the kinds.

## Decks, stairs and structure

**Decks of any shape.** A deck as a polygon (an L-shaped loft, a loft that follows the walls), and round or polygon holes. `Deck` and `DeckHole` (`model.ts`) are rectangles; the deck rules, levels, landing rule, slab and exports move to polygons, with holes as inner rings as rooms have.

**Walls under a deck, rooms on a loft.** A floor wall whose top follows a deck's underside, and rooms, tags and areas for walls standing on a loft. It needs a wall top that reads the deck over it, and room finding per level.

**Columns and hangers.** Round columns, a column at a wall's end or corner with the wall ending on it, and hangers from the ceiling holding a deck. A column is a wall row with `column` set (`packages/domain/src/column-checks.ts`), so a round one needs a shape of its own.

**More stairs.** U stairs with a half landing, floating treads, a pull-down loft ladder, a library ladder, a mirrored spiral, a winder with a straight run before its turn, and an L of winders; a setter for a stair's start deck (Properties shows "Starts at" read only); a headroom rule for loft stairs under a low roof; a rail on part of a deck's side and a stair's rail height. A kind is a row with a `stair` rule in `kinds.ts`.

**Beams, the rest.** Rafters, purlins and a ridge beam along the slope, a beam on a loft past its edge, and a check that a beam rests on something. They need beam rows that follow `roofPlanes` and a support check in the fit rule.

**Trailer, the rest.** A gooseneck trailer with the house's end raised over the neck, a porch, and a loft cantilevered past an end wall. They need walls on a raised floor and a deck outside the walls.

## Heights, roofs, openings and finishes

**Roof shapes, the rest.** Hips and valleys, an L-shaped house's own roofs, dormers, an overhang per side, the pitch in percent or x:12, head-height bands, and a roof plan on sheets. `ROOF_SHAPES` (`packages/domain/src/roof-shapes.ts`) holds flat, shed and gable, with one `overhang`.

**Headroom per use.** A headroom per use (sitting up in bed, standing at a counter), checked like a blocked use zone. It needs a height per zone kind, read by the zone check.

**Openings, the rest.** A door open or closed in 3D (a stored value per door), a door's own sill, a head up to its wall's top, a bifold door, awning, sliding-sash and double-hung windows, and a garage door. An `Opening` stores no open state, and a kind is a row of `OPENING_KINDS`.

**Finishes, the rest.** The ceiling's finish, a splashback (a band not from the floor), stone and slate, a finish per named area, finishes on columns and on a deck's underside, photo textures, and the colour picker elsewhere with recent colours and an eyedropper. A motif is an entry of `MOTIF_IDS` (`packages/domain/src/finishes.ts`); an area's finish needs a field on `Area` (`packages/domain/src/area.ts`).

## Plan drawing and editing

**Wall editing, the rest.** A box selection that also takes decks, columns and named areas, a wall-hung piece that follows its wall when the wall moves, typing a wall's clear distance to its neighbour, drawing a wall by its face with Tab to pick the side, arrow nudges for walls (`packages/editor/src/tools/nudge.ts` nudges pieces, columns, decks and holes), and Split's typed distance from the nearer end. Each extends the tools in `packages/editor/src/tools/`.

**Interior wall crossings.** A wall drawn across another splits both, with deterministic ids. Walls may only meet at joints today, so it touches ids, dependencies and label merges.

**Click cycling.** Repeated clicks on one spot step through everything under the pointer, in the right-click list's order, replacing the special cycles for stacks, holes, stacked openings and areas. It needs the hit list to keep the last click's place.

**Label placement.** Stair labels and room tags that avoid each other, walls and pieces. It needs one placement pass over every label of the plan, in place of each label placed alone.

**Named areas, the rest.** A tint per area while the Zone tool is out, turned areas, and areas on a loft. `Area` is an unturned rectangle.

**Faster drawing.** A room from typed dimensions or a template, a loop mode for walls, free text labels, a measure tool, a grid toggle, align and distribute, and feet and ft² on screen. Each is a tool or a command in `@fm/editor` over the existing wall and room commands.

**A PDF page as the underlay.** The import takes PNG, JPEG, WebP and GIF and stores a JPEG (`packages/web/src/adapters/underlay-import.ts`).

## 3D view

**Better-looking parts.** More parts per kind, tapered cylinders and rounded boxes, the toilet first, each judged against a reference picture. It needs new part shapes in `packages/editor/src/view3d/parts/`.

**More in 3D.** Textures and skies, selecting in 3D, parts that move along a path in a flip (`flipPoses` moves boxes only), palette themes per viewer, and AI renderings from the 3D view (research first).

## Exports

**Schedules.** Room numbers in tags and the rooms table, and a door and window schedule with opening tags on the plan. They need a number per room and per opening, and a table beside the rooms table.

**The 3D view on the PDF.** A sheet kind for it beside `SHEET_KINDS` (`model.ts`).

**Later.** Automatic dimension chains, site context (trees, cars, outdoor furniture), and DXF export. DXF needs a writer in `@fm/export`; site context needs pieces outside the rooms.

## Files and collaboration

**Local-folder workspace.** A workspace over a local folder through the File System Access API (Chromium only): it lists `*.flatmate.json` files, creates, opens and saves them whole, never talks to the server; one tab per file, the last save wins. It needs a folder adapter for the workspace port in `@fm/web`, with every file opened as a `LocalDocument` (`packages/editor/src/document/local-document.ts`).

**Saving to a file.** A drawing saved to a file, with autosave, Cmd+S, and Cancel or Discard when leaving with unsaved work. `saveSnapshot` (`packages/editor/src/ports/effects.ts`) is declared and never emitted, and `saveResult` (`ports/events.ts`) is ignored; it needs the editor to emit the one and handle the other, and a shell adapter that writes the file.

**Offline editing.** Edits without a server need a queue and a rebase policy; a shared document allows one edit waiting for the server.

**Sharing.** Share links, version history, and a read-only phone viewer. They need accounts or link tokens in the server.

**Claude's one-option tools.** `set_desk`, `set_chairs` and `set_opens_into` folded into one tool, in `packages/mcp/src/`.

## Graphics and a native shell

**Renderer leftovers.** Input coalescing, reusing the WebGL 2D buffers, a WebGPU 3D renderer, GLSL generated from WGSL, and an exact angle comparator in place of `atan2` in `packages/domain/src/queries/outlines.ts`.

**A native shell.** One Rust and wgpu shell for macOS, Windows and Linux, running the TypeScript core in an embedded JS engine and talking to the unchanged server over WebSocket; after the features settle. Canvas2D stays the web default.
