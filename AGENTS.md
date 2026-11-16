# AGENTS.md

Instructions for any coding agent (Claude, Codex, …) working in this repository.

## Project

Flatmate: a collaborative 2.5D home planner (plan shapes with height ranges) for tiny houses, flats and, later, homes on several floors, built for other people to use; released early, as version 0.1. TypeScript monorepo with a hexagonal, portable core.

- **Spec (source of truth for *what*):** `docs/specs/`, one short document per topic, listed in `docs/specs/README.md`. Read the index, then the documents of the feature at hand, whole. Every cycle edits the document its feature belongs to, in place and as what is true now (no dated notes, no history), before or with the code; a new topic gets a new document in the index; future features stay one-paragraph entries in `docs/specs/roadmap.md` until picked.
- **Project memory (the *why* and the mistakes not to repeat), in the maintainer's working copy:** `docs/memory/INDEX.md`, run by the project-time workflow below. The public repo has the spec but not the memory and history folders below.
- **Historical, in the working copy, read only when asked:** `docs/design-memory/`, `docs/plans/` and the gate reports in `docs/reports/` come from before project-time (up to 2026-10-15); `docs/recaps/`, and the research in `reports/` and `research_notes/`, are dated records. Don't follow their workflow rules or update them; where they disagree with `docs/memory/` or the philosophy below, those win.

## Architecture rules (summary — details, in the working copy, in `docs/memory/architecture.md`)

- Dependencies point inward: `web`/`server` shells → `@fm/editor` → `@fm/domain` → `@fm/protocol`. `@fm/export` (file writers) uses the editor and protocol through their entries; only shells import it.
- `@fm/domain`: pure synchronous functions, no ports, no I/O, no UI concepts.
- `@fm/editor`: `update(state, event, host) → { state, effects }`; sync queries via `Host`, async work as effects; no DOM, React, WebGL or network.
- `server/src/app` never imports `@fm/domain`; only `server/src/adapters/domain-validator` does.
- Core packages: no DOM lib, no Node built-ins, no `as` casts, exhaustive switches with `assertNever`.

## Product philosophy (`PHILOSOPHY.md`; the higher one wins)

1. The drawing is always true: valid, convergent, the ghost is the click.
2. 2.5D is the boundary: plan shape plus height range; the 3D view shows, the plan edits.
3. Usable without a manual.
4. Right the first time: no fix after placing, no warning by default.
5. Real homes set the scope, weighted by how many need it.
6. Grow by reuse: an option, preset or row before a new tool, mode or kind.
7. Delight from care, not decoration.
8. Claude can do what a person can.

A usability fix found in real use may add a concept; new power may not. While the versions are 0.x the stored format may change without an upgrade step for old drawings. Recommendations name the principle they follow.

## Working style

- Prefer the simplest solution; cut functionality or add a hard constraint before designing something clever.
- Protect the first five minutes (what a new person sees and does first) and the portable core. If a feature or edge case makes geometry, sync, or UI substantially more complex, defer it and state the supported constraint in the spec.
- Explain designs in simple terms with ASCII diagrams.
- Tests first for domain and editor logic; headless editor scenarios drive gestures through the fake shell.
- Don't overclaim in docs or comments (durability, determinism, antialiasing, performance).
- At levels: before designing a feature read `docs/specs/levels.md` (surfaces and levels). Every feature's document in the spec ends with a section "At levels" saying what the feature does for a thing on a platform and on a loft, or "floor only" with the reason, and a room feature or per-level query adds a row to the levels table (`packages/domain/test/levels-fixture.test.ts`). `pnpm check` fails on a feature document without the section.

<!-- project-time:start v5 -->
## Project workflow (project-time)

This repo runs the project-time workflow. Its state lives in `docs/`: the files are the source of truth, the conversation is scratch.

**Memory has three levels**, from specific to general. Each has an `INDEX.md` (`## Pinned`, then one line per area) and area files.

| Level | Where | Holds | Changed |
|---|---|---|---|
| cycle | `docs/current/memory/` | the feature being built on this branch | as things happen |
| project | `docs/memory/` | what is true now for this repo: code, product, working rules, this machine's setup | only by `project-wrap` (and setup, moving old auto-memory in) |
| general | `~/.agents/memory/` | what holds in every project: the user, their tools, lessons | at wrap, only big lessons that are general, proven and undisputed, or when the user asks to remember something for every project |

The rest of `docs/`: `docs/current/` is the active cycle (`spec.md`, `plan/INDEX.md` with `plan/step-NN-*.md`, `memory/`); `docs/archive/<date>-<slug>/` holds finished cycles.

**Session start.** Read `~/.agents/memory/INDEX.md` and `docs/memory/INDEX.md`. If `docs/current/` exists, also read `docs/current/memory/INDEX.md` and `docs/current/plan/INDEX.md`. Open area files only when they relate to the work at hand. Where levels disagree, the more specific wins: cycle, then project, then general. Pins from all three apply.

**Recording.** Write to the cycle level as soon as it happens, before moving on:
- a decision (with the why and the rejected options), a discovery, a pivot, an issue;
- anything the user asks to pin or remember: a one-liner under `## Pinned` in the cycle INDEX, as `- <slug>.<NN> · <the rule>`. With no active cycle, a pin waits for the next cycle: say so.

When the user asks to remember something for every project, write it to the general level at once, as a pin or a line in an area file. Nothing else skips a level.

Entries go in area files by topic, each area listed in one line in the INDEX:

    ### <slug>.<NN> · <decision|discovery|pivot|issue> · <YYYY-MM-DD> · <phase or step>
    <the fact>
    **Why:** <reason; rejected options>

NN is the highest number in the cycle plus one, pins included. Never delete a cycle entry. A pivot adds a new entry marked `Supersedes <id>` and appends `Superseded by <id>` to the old one. If the old one is in project memory, add `- <old> → <new> · <one line>` under `## Overrides` in the cycle INDEX instead.

**Flowing up.** At wrap, the cycle entries that still matter are promoted to project memory, which keeps only what is true now: a promoted entry replaces the one it changes, and the history stays in `docs/archive/`. Only a big lesson that is general, proven and undisputed goes on to the general level; most cycles add nothing there. Both levels are merged and compacted as entries arrive, so they stay small.

**Claude Code auto-memory is off** in this repo (`.claude/settings.json`): everything goes to one of the three levels.

**Commits.** The workflow commits at setup, cycle start, gates, each finished build step, spec amendments, plan updates, parallel-run start and record, interim recaps, and wrap, each with only the files that step touched. Messages start with `<slug>:` or `<slug> step NN:`. Never push, and never merge a feature branch into the default branch. The general level lives outside the repo and is never committed.

**Sub-agents** never write under `docs/` or in `~/.agents/memory/`. They report back; the main agent records.

**To continue work,** run `/project-time`.
<!-- project-time:end -->
