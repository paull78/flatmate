# Demo rehearsal

Target: steps 1–9 of spec §1.4 in under five minutes, twice in a row, without using a fallback.

## Pre-flight (before every rehearsal and before a live demo)

- [ ] `git status` clean; `pnpm install`; `pnpm check` and `pnpm e2e` green
- [ ] `pnpm demo:seed` (fallback project exists)
- [ ] `pnpm demo` running; Alice's window open at 100 % browser zoom. Open Bob's window at step 7: the project list loads when the page opens and is not pushed, so a Bob window opened earlier must be reloaded
- [ ] a terminal ready with `pnpm demo:headless` and `pnpm demo:script` typed in
- [ ] notifications off; other tabs closed
- [ ] `Shift` may stay held while typing lengths: the input adapter reads digits from the physical key (spec §5.4)
- [ ] the renderer button (toolbar, right) reads "Canvas2D"; no renderer notice is shown
- [ ] demo in Chrome or Edge with graphics acceleration on, not VS Code's built-in browser (it has no WebGL2, so step 10b would only show the fallback notice)
- [ ] (step 10a) `claude mcp add flatmate -- pnpm --silent --dir "$PWD" mcp` done once; a Claude Code session open in a terminal, `/mcp` shows `flatmate` connected

## Steps

| # | Do | Expect on screen | If it fails | Target | Run 1 (scripted) | Run 2 (by hand) |
|---|----|------------------|-------------|--------|-------|-------|
| 1 | Alice: type "Apartment" in the project list, Create | empty canvas, project name in the status bar | server terminal: wait for the restart; reload; else open "Sample apartment" and skip to 5 | 0:20 | pass | |
| 2 | `W`; click origin; holding Shift: move right, `6` `Enter`; up `4`; left `6`; click first joint | closed 6 × 4 m room; prompt back to "First point" | `Cmd+Z` the bad wall and retype; else open "Sample apartment" | 0:40 | pass | |
| 3 | click bottom midpoint (midpoint glyph), Shift-click top midpoint, `Enter` | divider; T-junctions; two rooms | zoom in (`Ctrl` + wheel) until the midpoint glyph shows; `Cmd+Z` and redraw | 0:30 | pass | |
| 4 | `Z`; click inside each room | two tags, each 10.64 m² | "Area unavailable": the room is not closed; show the sample project | 0:20 | pass (10.64 m²) | |
| 5 | `V`; select the right wall; click its length; `3.5` `Enter` | top-right corner at (6, 3.5); top wall slopes; right room ≈ 9.94 m² | reselect the wall; click the length text again | 0:30 | pass (3.50, 9.94 m²) | |
| 6 | drag the top-right corner to (2, 2) | red preview (the corner stays at its last valid spot, drawn red); reverts on release; toast "Walls can't cross" | release over empty space and retry slowly | 0:20 | pass | |
| 7 | open Bob's window (`?name=Bob`); open "Apartment"; move the cursor; move a wall | Bob's cursor in Alice's window; Alice's areas change | reload Bob; check both show the same project name | 0:40 | pass (Bob listed; left area 11.20 m²) | |
| 8 | Alice: move one joint twice, undo twice; Bob moves that joint; Alice redoes | redo refused: "Can't redo: the drawing changed remotely" | explain the rule: it is the intended behaviour | 0:50 | pass | |
| 9 | terminal: `pnpm demo:headless`, then `pnpm demo:script` | five green steps and a zone table; the Kitchen/Living table | show `demo-narrated.test.ts` in the editor instead | 0:40 | pass (run separately by the agents) | |
| 10a (M1) | Alice: zoom out (`Ctrl` + wheel) until x = 9–13 m, right of the apartment, is in view. Claude Code: "Open the Apartment project in Flatmate. Use add_walls to draw a small maze to the right of the apartment, in this order: outer walls (9, 0) to (13, 0), (13, 0) to (13, 4), (13, 4) to (10, 4) and (9, 4) to (9, 1), then inner walls (9, 1) to (12, 1), (13, 2) to (10, 2) and (9, 3) to (12, 3). That leaves an entrance at the bottom of the left side and an exit at the left end of the top. Then describe the route from the entrance to the exit." | seven walls appear in both windows: a 4 × 4 m square with 1 m corridors, the inner walls joined to the sides at T-junctions; no new area tag and the apartment's areas unchanged (the maze is open, so it is no room); a "Claude" cursor at (10.5, 3), the middle of the last wall. The correct route: right along the bottom row, up, left, up, right, up, left, out through the top-left gap | Claude reports a refusal ("Wall N of 7: …: nothing was drawn"): ask it to call `get_drawing` and retry clear of the apartment; or use the fallback prompt below; or skip to 10b | 0:40 | | |
| 10b (S1) | Alice: click the renderer button (toolbar, right); drag a joint; click it again | button reads "WebGL", drawing unchanged, the drag works; back to "Canvas2D" | a notice "WebGL2 is unavailable" or "context lost": stay on Canvas2D and say WebGL is not available on this machine | 0:20 | | |
|   | **Total** | | | **4:50** | 4.1 s scripted (no human timing) | |

Row 10a was checked on 2026-09-29 with a throwaway test that sent these seven walls through the MCP tools to the real server app, next to the demo apartment after step 5 and again with its right wall moved to x = 7: accepted, 9 new walls (the inner walls at (13, 2) and (9, 3) split the sides) and 11 new joints, no new room, apartment areas unchanged (10.64 and 9.94 m²), Claude's cursor at (10.5, 3). The prompt ends with a question, not "label it Maze": with two openings the maze is no closed room, and `label_room` there replies "Click inside a room" (checked). The prompt names the coordinates to keep the step predictable; which tools Claude calls is not guaranteed.

Fallback prompt for 10a (the planned bathroom): "Open the Apartment project in Flatmate. Add a 2 × 2 m bathroom outside the right wall: add walls from (6, 0) to (8, 0), (8, 0) to (8, 2) and (8, 2) to (6, 2), then label the room at (7, 1) Bathroom." Expect three walls, then the "Bathroom" tag with 3.24 m² (1.8 × 1.8, checked with the domain on the step-5 room); if Bob moved the right wall at step 7, ask Claude to call `get_drawing` and use the current right wall.

## Reconnect check (moved from Task 7.17)

Run 1 (scripted): Alice pressed a joint and started dragging, then the server process was killed.
- Alice's drag was cancelled with "Connection lost: editing resumes when it returns", and the status showed "offline".
- The restart loop brought the server back. Both windows returned to "saved" 3.1 s after the kill.
- Both windows then showed the same areas (11.75 m² and 9.94 m²). No edit was lost or doubled.

## Notes

| Run | Step | What went wrong | Fix (commit) or fallback used |
|-----|------|-----------------|-------------------------------|
| 1 | 7 | Bob's window, opened before Alice created "Apartment", did not list it (the list is fetched, not pushed) | Demo instruction: open or reload Bob's window at step 7 (pre-flight updated; `scope.md`) |
| 1 | all | Run 1 was driven by a Playwright script with real mouse and keyboard events, so it proves the steps but not their timing or feel | Run 2 by hand, with a stopwatch, before a live demo |
| S1 | 10b | Row 10b (S1) has not been rehearsed yet: its dry run by hand is for the user at gate S1. The Playwright renderer tests (`pnpm e2e`) toggle mid-drawing and probe pixels in both renderers; that proves the toggle, not its timing or feel on the demo machine | Dry run by hand at the gate; fill Run 2 for row 10b |
| M1 | 10a | Row 10a (M1) has not been rehearsed with Claude yet: its geometry is checked by a test (above), not Claude's tool choices or the timing | Dry run with Claude Code at gate M1 (manual check 1); fill Run 2 for row 10a |
