# Gate 1: Skeleton and protocol basics

**Date:** 2026-09-27 · **Phase file:** `docs/plans/flatmate/phase-1-skeleton.md` · **Commits:** `a9a2dee`..`e239f4e` (branch `implementation`)

## 1. Outcome

No demo step runs yet; this phase builds the ground they stand on. The workspace has `@fm/protocol`, `@fm/domain` and `@fm/editor`. One command, `pnpm check`, typechecks, lints, checks the ring rules and runs the tests. The ring boundaries of spec §2.4 now fail the build when broken, and core sources can't see DOM or Node globals. `@fm/protocol` holds the result helpers and the table-level sync bookkeeping (patches, version map with tombstones, expectations, canonical JSON) that the server and the clients will share.

## 2. Completion criteria

- [x] `pnpm install` works from a clean clone with Node 22 and pnpm 10.20.0 (`packageManager` pinned), with no ignored-build-script warning for esbuild. Checked by cloning the branch into a scratch directory.
- [x] `typescript` is pinned to `~6.0`; `pnpm exec tsc --version` prints `Version 6.0.3`.
- [x] `pnpm check` passes: two typecheck programs per package for protocol, domain and editor; lint clean; no dependency violations; 20 tests pass.
- [x] `@fm/protocol` exports everything in the README contract for `util.ts` and `patch.ts`, plus `isRecord`.
- [x] Protocol tests cover `applyStoredPatch` purity, tombstones in `stampVersions`, `null` expectations for never-existed IDs, `failedExpectations`, the delete-recreate-delete sequence (spec §9), `canonicalJson` key order (spec §7.2), `uniqueKeys` and `patchWrites`.
- [x] Lint rejects `as` and `!` in core sources and allows `as const` (Task 1.5 negative check).
- [x] dependency-cruiser rejects domain → editor, a Node built-in in a core package, a third-party package in a core package, server/app → domain, and unresolvable imports (Task 1.6 negative checks; the last one was added during the sprint, see §5).
- [x] Core `src` typecheck fails on `process` (Task 1.7).
- [x] The sprint log lists the resolved tool versions and any warnings.

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: 4 test files, 20 tests (protocol 18, domain 1, editor 1); 6 typecheck programs; lint clean; `no dependency violations found (10 modules, 13 dependencies cruised)` |
| `pnpm exec tsc --version` | `Version 6.0.3` |
| `pnpm ls -D --depth 0` | @eslint/js 10.0.1, dependency-cruiser 18.4.0, eslint 10.11.0, tsx 4.23.15, typescript 6.0.3, typescript-eslint 8.70.1, vitest 5.0.2 |
| Fresh clone: `pnpm install && pnpm check` | install runs esbuild's postinstall, no warnings; check passes |
| Lint negative check (Task 1.5) | exactly 2 errors: `consistent-type-assertions` (2:18), `no-non-null-assertion` (3:18); `as const` not reported |
| depcruise negative checks (Task 1.6) | 3 errors for the core files, 5 with the server/app file, 1 `no-unresolvable` for a bare `@fm/editor` import in domain; all as planned |
| Core typings proof (Task 1.7) | `src/leak.ts(1,20): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? …` |

### Answers the phase file asks for

1. **Tool versions.** Exactly the scratch-check versions (above), plus Vite 8.3.1 and esbuild 0.28.2 as Vitest's dependencies. No peer warnings. typescript-eslint 8.70.1 still declares `typescript >=4.8.4 <6.1.0`, so the `~6.0` pin must stay.
2. **Typings isolation (P2).** The TS2591 line is quoted above. Phase 6 installs `@types/node` for the server; it must rerun Task 1.7 Step 2 (risk below).
3. **Resolution.** dependency-cruiser resolves `@fm/protocol` to the real path `packages/protocol/src/index.ts`, so the path rules match. No rule needed a different pattern than planned.
4. **Commands.** `pnpm --filter @fm/protocol test patch` runs one file (1 file, 12 tests); `test -- patch` runs `vitest run -- patch` and every file (2 files, 18 tests). The README's form without `--` is right.
5. **Vite version.** 8.3.1. Phase 4 adds Vite 8 to `@fm/web`.
6. **Size and difficulty.** Nothing was slower or harder than planned; every expected output matched. The steps were the right size for per-task review.

## 4. Implementation issues

None. Every command produced the planned output.

## 5. Changes to the plan

| # | Task | Planned | Done instead | Why | Later tasks revised |
|---|------|---------|--------------|-----|---------------------|
| 1 | 1.6 | Completion criteria claim an unresolvable-import negative check | Ran it and added it to Task 1.6 as a revised step | No step produced the evidence the criterion claimed | none |
| 2 | 1.1 | "`pnpm check` first runs in Task 1.4" | Corrected to Task 1.7 | Lint and depcruise configs only exist after Tasks 1.5 and 1.6 | none |

Process change requested by the user: tasks run one at a time, each left uncommitted for review and committed when the user says "next". Implementation happens on the `implementation` branch; `master` still ends at the plan commit `22f3cfe`.

## 6. Changes to the spec

None.

## 7. Design-memory updates

- `implementation.md`: two rows in "Deviations from the plan" (§5 above); tooling note that gate 1 confirmed the planning-time versions and the pin stays.
- `process.md`: lesson 20, "every completion criterion needs a step that produces its evidence".
- `INDEX.md`: summaries still accurate; "Last updated" already 2026-09-27.

## 8. Risks and open issues for the next phase

- **Phase 2 rewrites `packages/domain/src/index.ts`.** It must keep the re-exports of `ok`, `err`, `unwrap`, `assertNever`, `Point` and `Result` (contract extension), or the editor smoke test breaks.
- **Phase 6 installs `@types/node`.** Rerun the Task 1.7 Step 2 proof then; core `src` must still reject `process`.
- **Lesson 20 applied forward.** At the start of each phase, map each completion criterion to the step that proves it, and add a step where one is missing.
- The `~6.0` pin blocks TypeScript 7 until typescript-eslint supports it. That is acceptable for the demo; nothing to do.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | not started | |
| 2 Room by typed lengths | not started | |
| 3 Divider with midpoint snaps | not started | |
| 4 Zones with areas | not started | |
| 5 Helper resize | not started | |
| 6 Invalid drag reverts | not started | |
| 7 Two windows, cursors | not started | |
| 8 Undo and remote invalidation | not started | |
| 9 Headless scenario and domain script | not started | |
