# Specs

What Flatmate does, one short document per topic. Each says what is true now: the rules, the limits and the names the code uses. Why Flatmate works this way is in [PHILOSOPHY.md](../../PHILOSOPHY.md), how the code is laid out is in [architecture.md](../architecture.md), and a first walk through the app is in [try-it.md](../try-it.md).

## The documents

- [overview.md](overview.md) · what Flatmate is, the 2.5D model, what is in and out, the three rings in short (details: `docs/architecture.md`)
- [domain.md](domain.md) · the document's tables, the invariants, the command style, saving and versions of the stored format
- [walls-rooms.md](walls-rooms.md) · walls and joints, mitres, half walls at a joint, rooms and how they are found, columns, named areas, the wall chain
- [wall-editing.md](wall-editing.md) · the Wall tool, moving runs and joints, stitch, join and split, straighten, typed and matched lengths, groups
- [openings.md](openings.md) · doors, windows, passages and curtains: kinds, heights, fit, swings, how they draw on the plan and in 3D, window dressings
- [furniture.md](furniture.md) · kinds, sizes and presets, placing (ghost, contact, fit), symbols, corner pieces, rugs, wall-hung pieces and plants, use zones, the palette
- [seating.md](seating.md) · chairs at tables and desks, the tuck rule, seated tables, Break apart, sets
- [layouts.md](layouts.md) · layout states: objects and placements, exceptions, linked layouts, the checks per layout, the pill, the flip, free floor
- [heights-decks.md](heights-decks.md) · height ranges and the collision rule, the ceiling, decks (platform, raised floor, loft), the landing rule, holes
- [levels.md](levels.md) · surfaces and levels: the policy, the viewed level, drawing and placing at a level, zones on decks
- [stairs.md](stairs.md) · stair kinds, riser and going, drawing a stair from an edge, landings, spirals, stairs through holes, storage steps and ladders
- [guards.md](guards.md) · guards and handrails, loft and platform edges
- [roofs.md](roofs.md) · the ceiling's shapes (flat, shed, gable), overhang and covering, beams and collar ties
- [finishes.md](finishes.md) · floor finishes and motifs, wall and roof finishes, inherited defaults, the colour picker
- [surroundings.md](surroundings.md) · the ground round the house, the trailer, wheel wells and door steps
- [editor.md](editor.md) · the core loop, ports and effects, editor state, the scene and the view model
- [tools.md](tools.md) · global input, the tools other than Wall, gestures, selection, snapping, guides, dimensions, quick add, the hit list
- [typed-input.md](typed-input.md) · typed values: what a value can be, keys, the hint, feet and inches
- [warnings.md](warnings.md) · refusals and their reason at the pointer, standing warnings, error handling
- [rendering.md](rendering.md) · the plan renderers (Canvas2D, WebGL2, WebGPU), the render format, how speed is measured
- [view3d.md](view3d.md) · the 3D view: camera and orbit, faces, parts of pieces, joints and seams, look in 3D
- [export.md](export.md) · PNG, SVG and the PDF sheet set: sheets, pages, the title block, the rooms table, project fields
- [sections.md](sections.md) · section cuts: the data, drawing one, the picture, the strip under the plan, on paper
- [underlay.md](underlay.md) · the plan picture under the drawing: import, scale, properties, tracing with Claude
- [collaboration.md](collaboration.md) · open documents (local and shared), the server, the protocol, sessions, submit, undo, presence, recovery
- [mcp.md](mcp.md) · Claude's tools: the list, addressing, replies, the listing, look, limits
- [samples.md](samples.md) · the sample houses and what each shows, the studio's layout
- [cards.md](cards.md) · the project list as cards
- [roadmap.md](roadmap.md) · what is next, by area; one paragraph per future feature

## Keeping them true

- A change to a feature edits its document in place, as what is true now. Nothing is appended as a dated note, and nothing says how a rule came to be: the history is in git.
- Each rule has one owner. Another document that needs it links to it.
- A new document is added to the list above. A future feature is one paragraph in the roadmap until it is built.
- Every document about a feature of a home ends with a section "At levels": what the feature does for a thing on a platform and on a loft, or "floor only" with the reason. [levels.md](levels.md) has the rule they follow.
- `pnpm check` fails on a file missing from the list, a document over 30 KB, a missing "At levels" section, and on a section number, a date or a working note's ID left in the text (`scripts/src/spec-docs.ts`).
