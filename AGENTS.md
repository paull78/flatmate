# AGENTS.md

Instructions for any coding agent (Claude, Codex, …) working in this repository.

## Project

Flatmate: a small collaborative 2D CAD editor for floor plans. TypeScript monorepo with a hexagonal, portable core.

- **Spec (source of truth for *what*):** `docs/specs/flatmate-design.md`
- **Design memory (the *why* and the mistakes not to repeat):** `docs/design-memory/INDEX.md`
- **Implementation plan:** `docs/plans/flatmate/README.md` (phases, shared contracts, gate protocol); gate reports in `docs/reports/`
- **Resuming implementation:** `docs/plans/flatmate/EXECUTION.md` (where we are, how waves of agents run, prompt template)
- **Follow-up plans (after the main plan):** `docs/plans/flatmate-s1/` (WebGL2 renderer, spec §6.2), `docs/plans/flatmate-mcp/` (MCP server, spec §12), `docs/plans/flatmate-snaps/` (CAD snaps), `docs/plans/flatmate-ux/` (UX fixes), `docs/plans/flatmate-perf/` (speed, spec §6.3), `docs/plans/flatmate-delete/` (project delete, spec §7.2.1), `docs/plans/flatmate-mcp-large/` (MCP on large drawings, spec §12.4); their status is in EXECUTION.md → "Now"

## Design memory: rules

1. **Before any design or implementation decision**, read `docs/design-memory/INDEX.md`, then the detail file for the area you are touching. Check its **Don't** list.
2. **Keep it updated.** Whenever a decision is made, changed or reversed (by you, the user, the spec, or a review), update in the same commit:
   - the detail file: decision, why, spec section, date; move superseded choices to **Don't** with the reason;
   - the one-line summary in `INDEX.md` and its "Last updated" date.
3. **Hierarchy:** `INDEX.md` holds only links and one-line summaries. Details go in the area files. Add a new area file (and an index row) rather than overloading an existing one.
4. **No duplication of the spec:** reference spec sections (`§4`) instead of copying text.
5. **Conflicts:** if the spec and memory disagree, the spec wins; fix the memory and mention it to the user.
6. **Review findings:** when a critique or review finds a real problem, record the lesson in `process.md` and the corrected rule in the relevant area file.
7. **Open issues** live in `process.md`; remove them once resolved in the spec or code.

## Implementation workflow

- Follow the plan phase by phase, tests first. Tick checkboxes as steps complete.
- **Record every finding in design memory when it happens** (bug from a wrong assumption, spec gap, tooling gotcha, deviation from the plan), in the same commit as the fix, and log it in the phase file's `## Sprint log`.
- **Gates:** each phase ends with a gate. Write `docs/reports/gate-<N>-<slug>.md` from `docs/reports/TEMPLATE.md` (issues, plan changes, spec changes, memory updates, risks, demo status), commit it, then stop and wait for the user's approval before the next phase.

## Architecture rules (summary — details in `docs/design-memory/architecture.md`)

- Dependencies point inward: `web`/`server` shells → `@fm/editor` → `@fm/domain` → `@fm/protocol`.
- `@fm/domain`: pure synchronous functions, no ports, no I/O, no UI concepts.
- `@fm/editor`: `update(state, event, host) → { state, effects }`; sync queries via `Host`, async work as effects; no DOM, React, WebGL or network.
- `server/src/app` never imports `@fm/domain`; only `server/src/adapters/domain-validator` does.
- Core packages: no DOM lib, no Node built-ins, no `as` casts, exhaustive switches with `assertNever`.

## Working style

- Prefer the simplest solution; cut functionality or add a hard constraint before designing something clever.
- This is a demo, not a production CAD editor. Protect the five-minute demo and the portable-core story. If a feature or edge case makes geometry, sync, or UI substantially more complex, defer it and state the supported constraint in the spec. Keep the drawing valid and both clients convergent within that scope.
- Explain designs in simple terms with ASCII diagrams.
- Tests first for domain and editor logic; headless editor scenarios drive gestures through the fake shell.
- Don't overclaim in docs or comments (durability, determinism, antialiasing, performance).
