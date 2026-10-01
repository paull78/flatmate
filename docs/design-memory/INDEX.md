# Design Memory — master index

Decisions, their reasons, and mistakes already made and corrected. **Consult before any design or implementation decision.** The spec is the source of truth for *what*; this memory records *why* and *what not to do again*.

- **Spec:** [`docs/specs/flatmate-design.md`](../specs/flatmate-design.md) (currently rev. 5)
- **Plan:** [`docs/plans/flatmate/README.md`](../plans/flatmate/README.md) · **Gate reports:** [`docs/reports/`](../reports/)
- **Last updated:** 2026-10-01

## How to use

1. Find the area below, open its detail file, read **Decisions** and **Don't**.
2. If the spec and this memory disagree, the spec wins — then fix the memory.
3. After changing a decision, update the detail file (decision, why, spec §, date) and the one-line summary here in the same commit.

## Areas

| Area | File | One-line summary |
|------|------|------------------|
| Context & scope | [scope.md](scope.md) | Flatmate, a collaborative floor-plan editor; Canvas2D demo first, WebGL SDF next; defer complexity outside the script |
| Architecture | [architecture.md](architecture.md) | Three rings: pure domain → platform-neutral editor (events in / effects out, panels send `ui` events) → shells; packages meet only through their entry points; the editor's index exports no write paths (state changes only through `update`); lint-enforced; `@fm/mcp` is a shell like the web app |
| Domain & geometry | [domain-geometry.md](domain-geometry.md) | Planar wall graph with endpoint/T joins only, 0.20 m thickness, 0.01 m min edge; simple zones and two-label slash merge; I1–I8; finding rooms grows faster than the room count |
| Editor & interaction | [editor-interaction.md](editor-interaction.md) | Wall chain, one-entity selection (press selects and drags), endpoint/midpoint/on-wall/aligned/grid snaps, typed digits work with Shift held, cursor follows the camera, undo drops the gesture, preview/commit gestures with per-tool remote dependencies, zone floor selection |
| Open documents | [open-documents.md](open-documents.md) | Local accepts at once, shared waits for server; file saves snapshots (X1 follow-up); server-less web app has one in-memory drawing and no project list |
| Collaboration & persistence | [collaboration.md](collaboration.md) | Shared documents only: server-validated changesets with version expectations (first writer wins), one outstanding edit, no local queue, receipts, crash-and-restart on save errors, `hello`/`welcome` sessions, `openFailed` tied to its open's generation, local `tooLarge` guard; project delete in the project queue, clients sent back to the list |
| MCP server | [mcp.md](mcp.md) | Follow-up M1 (spec §12): Claude as a third client, headless editor over `ws`, one `command` event through the commit path, outcomes read from the editor, bounded tool inputs, tool calls one at a time (`draw_room` and `add_walls` in one turn) |
| Undo / history | [undo-history.md](undo-history.md) | Plain stack for local documents; for shared: local, value-based, settled-only, fresh versions at request time, invalidated by dependency overlap |
| Rendering | [rendering.md](rendering.md) | Scene port with fixed units; render effect carries the camera; Canvas2D is the default and demo-critical; WebGL2 SDF renderer behind a shell-only live toggle with Canvas2D fallback; text always on a Canvas2D overlay; walls draw 1 px edge segments; speed measured with `?perf` and a grid seed |
| Implementation | [implementation.md](implementation.md) | Gate workflow, tooling decisions, plan-time implementation choices, deviations from the plan |
| Process & preferences | [process.md](process.md) | How the user wants to work (gates, findings to memory); recurring review lessons; open issues |
