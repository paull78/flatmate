# Context & scope

[← index](INDEX.md)

## Context

- Flatmate: a small collaborative 2D CAD editor for floor plans, keyboard-first, with walls, rooms and live collaboration (spec §1.1).
- Don't state facts about other products or their teams that came from model background knowledge rather than a source (spec §1.1 softened 2026-09-29, gate 8).

## Decisions

| Decision | Why | Spec |
|----------|-----|------|
| TypeScript core, not Rust/WASM | User choice: speed of delivery and polish | §2 |
| Tiers: demo-critical F1–F10, first follow-up S1 (WebGL SDF), then prioritized later work (2026-09-27) | Keep the demo path complete before adding showcases or edge cases | §1.2, §11 |
| Canvas2D alone makes the complete demo (steps 1–9) | Renderer showcase must not block the demo | §1.4 |
| Wall thickness fixed at 0.20 m (not editable) | Removes a class of geometry edge cases | §1.3, §3.3 |
| Explicit non-goals list (openings, layers, styles, nested holes, partial undo, merging same-entity edits, persistence of offline edits, logs, compaction…) | Keep scope honest | §1.3 |
| Initial build cuts loop mode, perpendicular/angle snaps, multi/box selection, nudge, interior wall crossings, complex zone topology, standalone dimensions and local-folder storage (2026-09-27) | They expand interaction, geometry or persistence code without improving the five-minute script enough | §1.2–1.4, §11 |
| Demo steps 2–3 hold `Shift`; the divider joins two wall midpoints (2026-09-27) | Without angle snapping a typed length follows the raw cursor direction; midpoints give exact divider points | §1.4, §5.8 |
| Demo step 7: Bob's window is opened (or reloaded) at step 7, after Alice creates "Apartment": the project list is fetched on load and when leaving a drawing, not pushed to other clients (2026-09-29, rehearsal) | A pushed list needs a workspace subscription; the demo only needs the list once | §1.4, §7.2.1 |
| Follow-up order (§11): S1 WebGL renderer, then more CAD snaps, then interior wall crossings (swapped 2026-09-29 after gate 8) | Snaps are cheap, editor-only and visible; crossings reopen the geometry that produced the most defects | §11 |
| Follow-up M1 (MCP server: Claude as a collaborator through the headless editor and the real server) is §11 item 1, developed in parallel with S1 (WebGL renderer) (2026-09-29, user) | Cheaper than S1 and shows the portable core driven by an AI shell; touches different files (new package + one editor event) | §1.2, §11 |
| Name **Flatmate**, scope `@fm/*`, file format `"flatmate"`; developed on `main` with one local branch per feature, squash-merged; only `main` is pushed (2026-10-01, user) | One branch to keep in step; `git log main` reads as a changelog | — |

## Don't

- Don't add features outside the tiers without updating §1.2/§1.3.
- Don't claim "cutting from the end leaves a complete demo" unless polish and demo-critical interaction details are before the cut line.
- Don't include illustrative ports (`fetch`, thumbnails/`exportImage`) in the MVP; they only explain the port pattern.
- When in doubt, **cut functionality or add a hard constraint** rather than design a clever general solution (user preference).
- Don't name other commercial editors, their links, code names, file extensions or staff in the repo, beyond generic comparisons such as "Figma for 2D CAD" (2026-09-30, user).
- Don't develop on a long-lived private branch and copy its files onto `main` with a publish script. Superseded 2026-10-01: two branches to keep in step, agent worktrees started from the wrong one, and a squash merge per feature gives the same public history (user).
- Don't treat the follow-up list as required scope for the demo; WebGL SDF is the first follow-up after the Canvas2D path (2026-09-27).
