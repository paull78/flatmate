# M2: MCP on large drawings — plan

**Spec:** §12.2 (`get_drawing` region), §12.4 ("Large drawings are summarized, not listed"). **Memory:** `mcp.md`. **Why:** carving a maze in the 50 × 50 seed grid through the MCP: every edit reply listed the whole drawing, about 760 KB (some 200 000 tokens), so about 100 `delete` calls could not run. **How it runs:** lean mode, on the feature branch `mcp-large-drawings`; a shell change, so no review; `pnpm check`. The code wins over this text.

## Task M2.1: summary limit and region (MCP shell) — size S

**Files:** `packages/mcp/src/{drawing,tools,schemas,server}.ts`, `packages/mcp/test/{drawing,tools,schemas}.test.ts`.

- [x] **Step 1: Tests first** (seen red):
  - `summarize` on a drawing with at most 300 walls is unchanged (the existing tests);
  - with more than 300 walls it returns the overview: project, counts, bounds, a hint, and no lists; its JSON stays small (under 2 KB) on the 50 × 50 grid shape;
  - with a region: only walls whose extent touches the box, joints inside, rooms whose outline touches it, unplaced labels inside; counts are the whole drawing's; more than 300 walls in the region gives the overview with the "narrow it" hint;
  - the `get_drawing` schema accepts an optional region with finite bounded corners and refuses `min` above `max`;
  - tools: an accepted edit on a drawing over the limit replies with the overview.
- [x] **Step 2: Implement** per §12.4: `summarize(project, doc, region?)` returns a listing or an overview; `get_drawing` passes the region; the tool and server descriptions mention the region and the limit.
- [x] **Step 3:** `pnpm check`.

## Task M2.2: carve the 50 × 50 maze through the MCP (by hand, after `/mcp`)

- [x] Delete the 2 500 labels, then 2 499 interior walls chosen by a seeded random spanning tree (recursive backtracker) over the seed grid's ID scheme, then the entrance and exit, 50 ids per `delete` call; record time and reply sizes in the sprint log.

## Progress

- [x] M2.1 (61 MCP tests; `pnpm check` 997)
- [x] M2.2 (2026-10-01: Grid 50×50 carved live, seed 2026)

## Sprint log

| Date | Task | Kind | What happened | What was done | Memory |
|------|------|------|---------------|---------------|--------|
| 2026-10-01 | design | finding | Every MCP edit reply listed the whole drawing: 764 KB on the 50 × 50 grid; a maze of about 100 `delete` calls would return some 20 M tokens | overview above 300 walls; `get_drawing` region | `mcp.md` |
| 2026-10-01 | M2.1 | deviation | Rooms in a region are matched by the extent (bounding box) of their outline, like walls, not by the exact outline | spec §12.4 wording aligned | — |
| 2026-10-01 | M2.2 | result | 102 MCP calls (open, 50 label deletes, 51 wall deletes; up to 11 in parallel per turn, run in order by the session): 2 501 walls removed, 2 599 left, all 2 601 joints kept, 0 closed rooms (a spanning-tree maze leaves none); every reply about 400 bytes instead of 764 KB; `get_drawing` with a region listed the entrance corner | time per call not measured | — |
| 2026-10-01 | M2.2 | finding | After `/mcp`, the client's cached `get_drawing` schema still showed no `region`, yet the call with a region worked (the server's schema decides) | a new session shows the new schema | — |
