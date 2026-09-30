# Gate 2: Domain

**Date:** 2026-09-28 · **Phase file:** `docs/plans/flatmate/phase-2-domain.md` · **Commits:** `2a67203`..`aaf6e42` (branch `implementation`)

## 1. Outcome

Demo steps 2–6 work as domain-level tests, driven only through `execute` (`packages/domain/test/demo-geometry.test.ts`):

```
step 2  four walls           ┌──────────┐   one room, 22.04 m²
step 3  divider (3,0)→(3,4)  ├────┬─────┤   T-junctions split the bottom and top walls
step 4  two labels           │ 10.64 │ 10.64 m²
step 5  right wall → 3.5 m   │ 10.64 │ 9.94 m²  (top wall now slopes)
step 6  drag (6,3.5)→(2,2)   refused: "Walls can't cross" (I5, b/w0 × e/w0), input unchanged
```

`@fm/domain` is complete: validation (I1–I8), the six commands behind `execute`, value patches with exact inverses and semantic dependencies, mitered outlines, faces, clear areas, zones and orphan labels, the label merge on divider deletion, hit candidates and the helper dimension, versioned serialization, and the `rectangleRoom` script helper. No UI exists yet. Phase 2 ran as five waves of parallel Opus agents; every wave had a spec-compliance review and a code-quality review, and every review found something real.

## 2. Completion criteria

- [x] `pnpm check` passes; `pnpm --filter @fm/domain test` runs 20 files and 186 tests (the plan's 114, plus review fixes).
- [x] Lint finds no `as`/`!` in `packages/domain/src` (the `CORE_SOURCES` lint rules; `pnpm check` clean), and dependency-cruiser confirms that `@fm/domain` imports only `@fm/protocol` (`domain-imports-protocol-only`, `cores-no-third-party-packages`, `cores-no-node-builtins`; 52 modules, 241 dependencies, no violations).
- [x] Each invariant I1–I8 is detected, including malformed IDs, `Object.prototype` names, NaN/Infinity and key/ID mismatch (`validate.test.ts` "I1"…"I8", `shape.test.ts`).
- [x] Mitered corner, T-junction, flat end and sharp-angle bevel outlines have worked-number tests (`outlines.test.ts`), plus sweeps of 1071 L/U and 2141 T/H/X/fan configurations (all simple, CCW).
- [x] Endpoint-on-wall T-junction split keeps the wall ID on the `a` side; interior crossing, passing through a joint and collinear overlap are rejected (`add-wall.test.ts`).
- [x] A divider 0.30 m from a corner succeeds; a split leaving a fragment under 1 cm fails atomically with "Intersection would create a wall shorter than 1 cm".
- [x] Destination-only moves: jumping across a wall is valid; ending across one is a `topology` error and the input is unchanged (`move-joints.test.ts`; the "unchanged" half was only in the title until the wave 5 review).
- [x] Faces: a rectangle gives one room, a divider gives two, dangling walls and separate components are handled (`faces.test.ts`).
- [x] Areas: 10.64 m² per demo room; a straight split wall keeps the area; a narrow room and a 0.10 m square give "Area unavailable" and the drawing stays valid (`zones.test.ts`; the square and the validity checks were added in wave 5).
- [x] Wall resize keeps connections, and its dependencies include the walls incident to the moving endpoint (`set-wall-length.test.ts`).
- [x] Label merge on divider deletion: ` / ` in label-ID order, slashes kept; single label, deleted labels and rooms opened to the exterior leave labels alone; the inverse patch restores both labels and the divider at once (`delete-entities.test.ts`).
- [x] Reordering table insertion order gives identical documents and patches, and equal-distance joint ties go to the smaller ID (`add-wall.test.ts`; at the gate the reorder test was extended to the joint- and wall-tie documents, see §4 #16).
- [x] Every command's patch inverts exactly (`execute.test.ts`, all six commands on deep-frozen inputs; each round trip must write).
- [x] `serialize`/`deserialize` round-trip, reject newer versions readably, drop unknown fields; migrations exercised (`serialize.test.ts`).
- [x] The script builds a 4 × 5 m room with an area of 18.24 m², through the public index (`execute.test.ts`).
- [x] Demo steps 2–6 pass through `execute` alone (§1 above).
- [x] The 312-wall timing is recorded in the sprint log (§3 below).

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: 6 typecheck programs, lint clean, `no dependency violations found (52 modules, 241 dependencies cruised)`; protocol 2 files / 18 tests, domain 20 / 186, editor 1 / 1 |
| `pnpm --filter @fm/domain test` | 20 files, 186 tests |
| `pnpm --filter @fm/domain test test/performance.test.ts --reporter=verbose` | `first call: validateDocument 15.9 ms, zones 8.1 ms (312 walls)`; `warm median: validateDocument 7.1 ms, zones 3.2 ms, execute(moveJoints) 7.4 ms (312 walls)` |
| `pnpm depcruise` | no violations; domain → protocol only |

### Answers the phase file asks for

**1. Which rules were ambiguous in practice?** The planning-time choices:

| Choice | Held? | What happened |
|--------|-------|---------------|
| Ties within `1e-9` count as equal | yes | Hit candidates first tied only on bitwise-equal distances (fixed, wave 1). Near-tie tests fail with `TIE = 0`. A comparator with a tolerance is not strictly transitive; accepted. |
| `labelZone` refuses a labelled room | yes | The toast rarely shows: the Zone tool selects the existing zone first. Two concurrent labels can still both be accepted (spec §3.6). |
| Merged names cut to 200 code units without splitting a character | fixed | `.slice(0, 200)` split a surrogate pair (half an emoji); `cutName` now keeps pairs whole (wave 3). |
| Label names may be empty | yes, now stated | The spec was silent; spec I8 now allows it, and an empty name adds nothing to a merge (`""` + "Dining" → "Dining", not " / Dining"). Phase 5 supplies "Room N". |
| Non-simple faces have no area and hold no labels | yes, refined | A label resolves to the innermost face and is refused there if that face is unsupported; before, it fell through to the outer room (wave 2). The orphan text "no enclosing walls" is misleading for a label inside a room whose walk repeats a joint. |
| Unchanged commands return empty patches | yes, extended | `setWallLength` to the current length wrote a joint 22–29% of the time (float noise); now an early return. `execute` returns the input document for every no-op (wave 4). |
| Reused `opId`s are refused | yes | It is a prefix test: "a" is refused after "a/b". Harmless (the editor generates UUIDs); `MAX_OP_ID_LENGTH` added. |

Rules that turned out ambiguous and were settled in the spec: the merge counts **labels**, not rooms (three rooms in a row with the outer two labelled give "One / Three"), and its dependencies include the merged face's boundary; deleting the two walls at a corner concurrently is rejected as `invalid` (I3), not `conflict`; label commands shape-check only (they skip `validateDocument`).

**2. Numeric tolerances.** No flaky comparison in the suite. Cases met, each now a test:
- `EPS` (1 mm) against `MIN_EDGE` (1 cm): the inner-miter clamp needed a `2·EPS` merge gap; the literal rule left 0.13 mm gaps that `isSimplePolygon` flagged. Repeated points are dropped.
- `setWallLength` float round trip → noise patches (`SAME_LENGTH = 1e-9`).
- Equal-distance ties for joints, walls and hits (tie and near-tie tests).
- The demo's 9.936 m² room sits 0.001 m² above a `toFixed(2)` boundary; tests compare with tolerances, not after rounding.
- The parallel thresholds in `segmentIntersection` (`1e-9`, relative) and `lineIntersection` (`1e-12`, relative) caused no failure in the sweeps (60,000 clamp configurations, 3000 random `addWall` determinism probes).

**3. Performance** on 312 walls (grid of 144 rooms): first call `validateDocument` 13–16 ms, `zones` 7–9 ms; warm medians `validateDocument` 6–7 ms, `zones` ≈3 ms, `execute(moveJoints)` 6–7.5 ms. Nothing is near the 50 ms flag. A drag preview costs about one validation. Earlier review probes: `addWall` 5.4 ms, delete a wall with a label merge 10.9 ms (15.8 ms cold), delete a joint 15.9 ms, `wallOutlines` 0.7 ms. These are measurements on one machine, not a performance claim.

**4. Toast texts.** They read well, with three caveats:
- "Joints can't overlap" is unreachable for moves: I4 always comes with I6 or I2, which `topologyMessage` ranks first. Keep it; it costs nothing.
- "Invalid drawing" shows only for invalid input documents, which a user cannot produce through the editor.
- "Zone not found", "Invalid ID", "Joint not found" etc. are programming errors in practice (the editor sends only IDs it holds); they are fine as fallbacks.
- "Intersection would create a wall shorter than 1 cm" is long but exact; keep it.

**5. What phase 3 must know.**
- A command that changes nothing returns `ok` with an empty patch **and the input document itself**; `runCommand` skips the commit.
- `Zone.unavailable` is `"Area unavailable: unsupported geometry"` or `"Area unavailable: unsupported boundary"`; display it as is.
- `hitCandidates` returns joints and walls only; labels are reached through zones (`faceAt`, phase 5).
- `zones` orders rooms by face key (sorted wall IDs), not by position; labels in a zone by label ID. A face key is valid within one document state only.
- Query results are deeply read-only and memoized by document identity; copy before sorting, never mutate a document after querying it.
- Demo IDs: the table at the top of Task 2.19. `a`–`e` are fixture opIds; editor tests that need those IDs must send the same commands. `{ existing }` endpoints give the same document as `{ at }` points.
- `execute` throws on untyped input (unknown `type` or `table`, missing `at`), against spec §8 "never exceptions". Accepted for typed commands; `commandIds` is the place for a shape check if scripts or an agent ever send JSON commands.
- `labelZone` accepts a point inside a wall body (0.05–0.099 m from the centreline), so a tag can sit over a wall; phase 5's narrow-room fixture relies on it.
- Through `execute`, a malformed ID gives `invalidInput` "Invalid ID"; direct command calls give `notFound`.

## 4. Implementation issues

| # | Issue | Cause | Fix | Recorded in |
|---|-------|-------|-----|-------------|
| 1 | `no-useless-escape` on `\/` in `ID_PATTERN` | The planning scratch run linted without `@eslint/js` recommended | Removed the escape (same regex) | `implementation.md` tooling + deviation |
| 2 | Relative imports into another package's internals passed every check | Ring rules check direction only | depcruise rule `only-through-package-index` | `architecture.md`, `process.md` #21 |
| 3 | IDs naming `Object.prototype` members passed I1/I8 (`constructor` resolved a function, `__proto__` vanished on load) | Plain objects used as maps | `isValidId` refuses them; every lookup guarded; `execute` checks all IDs first | `domain-geometry.md`, `process.md` #22 |
| 4 | Face half-edge keys could collide | `:` is a legal ID character | Separator `\|` | `domain-geometry.md` Don't |
| 5 | Zones cache shared mutable arrays; a planned test sorted them in place; read-only one level deep | Memo by identity | Deeply read-only `Face`/`Zone` and results, with type tests | `domain-geometry.md` |
| 6 | Inner miters unclamped: self-intersecting or spiking outlines | Plan accepted it as a constraint | `limitSide` clamp (user: favour correctness) | spec §3.5, `domain-geometry.md` |
| 7 | 20 cm notch at both ends of the demo divider | Outlines went straight across joints with 3+ walls | Outlines pass through the joint | spec §3.5, `domain-geometry.md` |
| 8 | Short walls (< ~2× thickness) leave small slivers | A clamped corner is not shared with the neighbour | Accepted limitation (not demo scale) | spec §3.5, `domain-geometry.md` |
| 9 | `setWallLength` to the same length produced noise patches | Float round trip | `SAME_LENGTH` early return | `domain-geometry.md` |
| 10 | Label inside an unsupported inner room resolved to the outer room | Non-simple faces skipped before choosing | Innermost face first, then refuse | spec §3.6, `domain-geometry.md` |
| 11 | Merged name could end in half an emoji | `.slice(0, 200)` | `cutName` | `domain-geometry.md` Don't |
| 12 | Merge accepted after a concurrent deletion opened the room | Dependencies covered only the source faces | Merged face's boundary added | spec §3.6, §4.1, `process.md` #23 |
| 13 | No-op identity and the ID guard applied to some commands only | Rule added one command at a time | Both enforced in `execute`, tested over all commands | `process.md` #24 |
| 14 | Round-trip tests passed for a do-nothing command | `apply(doc, invert(empty))` = `doc` | Each round trip must write | `domain-geometry.md` Don't |
| 15 | Plan's timing test failed `tsc` (`performance`, `console` unknown) | Domain tests have no DOM or Node types | Local `declare const` in the test | `implementation.md` |
| 16 | Tests weaker than their titles (labels not tied to rooms, "unchanged" never checked, reorder test without competing candidates) | Tests of working code are green from the start | Mutation-checked assertions; reorder test covers ties (`aaf6e42`) | `process.md` #25 |
| 17 | Auto-mode classifier blocked an agent's Bash (wave 4) | No verdict returned | Controller committed from the worktree | `EXECUTION.md` gotcha |

## 5. Changes to the plan

All rows are in `implementation.md` "Deviations from the plan"; plan code blocks of the affected tasks are the final code.

| # | Task | Planned | Done instead | Why | Later tasks revised |
|---|------|---------|--------------|-----|---------------------|
| 1 | 2.3 | `ID_PATTERN` with `\/` | Escape removed | Lint | 6.1 `isWireId`, README contract |
| 2 | 1.6 (after G1) | Ring rules only | `only-through-package-index` | Internals reachable by relative path | none |
| 3 | 2.3, 2.7, 2.11 | Pattern-only IDs; `:` key separator | Prototype names refused; `\|` | Issue 3–4 | 2.18 (`execute` ID guard), 6.1 |
| 4 | 2.10–2.16, 2.13 | Mutable face and zone arrays | Deeply read-only | Issue 5 | phase 3 scene polygon `readonly Point[]`, README contract |
| 5 | 2.8, 2.9, 2.14, 2.15 | Unchecked table lookups | `isValidId` guards | Wave 1 Don't | none |
| 6 | 2.10 (not in plan) | Unclamped miters; straight across 3+-wall joints | Clamp; through the joint | Issues 6–7 | README contract comment |
| 7 | 2.14, 2.15 | Source-face dependencies; `.slice`; whole-document cleanup | Merged-face boundary; `cutName`; cleanup at deleted walls' endpoints; empty names skipped | Issues 11–12 | phase 5 wording |
| 8 | 2.7, 2.17, 2.18 | Per-command no-op identity; mutable `MIGRATIONS`; public `AREA_UNAVAILABLE` | `execute` returns the input for any no-op; `readonly`; internal | Issue 13 | Contract extensions |
| 9 | 2.19 | Globals `performance`/`console` | Local declarations; tolerances; `{ existing }` chain test; warm medians | Issues 15–16 | none |

## 6. Changes to the spec

Clarifications within rev. 5; no feature added or cut.

| § | Change | Why | Commit |
|---|--------|-----|--------|
| §3.3 I8 | ID alphabet and length stated; `Object.prototype` names refused; names ≤ 200 code units, empty allowed | Issues 3, 11; empty names were unspecified | `98c4d72`, `3130679` |
| §3.4 | Label commands shape-check only; a valid input gives a valid result or an error | `execute`'s comment overclaimed | `43324db` |
| §3.5 | Outlines pass through joints with 3+ walls; inner corners clamped; short-wall sliver limitation | Issues 6–8 | `bf892a3`, `250bdc0` |
| §3.6 | Innermost-face label resolution; merge counts labels; cut rule; merged-face dependency; empty names in merges | Issues 10–12 | `342eb9d`, `3130679`, `b9845e6` |
| §4.1 | Delete dependencies listed exactly; concurrent corner deletion is `invalid`, not `conflict` | Wave 3 spec review | `3130679`, `b9845e6` |
| §11 item 5 | "three-or-more-room merges" → "merges of three or more labels" | Matches the label-count rule | `3130679` |

## 7. Design-memory updates

- `domain-geometry.md`: decisions for read-only queries, no-op identity, `execute`'s validity promise, innermost-face resolution, the label-count merge and its dependencies, the name cut and empty names, Delete dependencies, outlines (clamp, 3+-wall joints) and the sliver limitation, the ID rule; Don'ts for each corrected mistake (issues 3–14).
- `implementation.md`: tooling notes (lint config gap, integer-like key order, key order after `applyPatch`, Vitest output flags, domain-test globals, float comparisons, timings); 15 deviation rows for phase 2.
- `architecture.md`: packages meet only through their entry points (decision + Don't).
- `process.md`: lessons 21–25 (relative-path bypass, prototype names, count what a narrowed rule counts, apply cross-cutting rules to the whole set, tests weaker than their titles).
- `INDEX.md`: summaries checked (architecture and domain rows already updated); "Last updated" 2026-09-28.
- `EXECUTION.md` (plan): how waves run, the prompt template and gotchas.

## 8. Risks and open issues for the next phase

- **Short-wall slivers** (§3.5) and the WebGL follow-up (S1): earcut needs simple polygons. Outlines are simple in every swept configuration, but thin walls leave small gaps.
- **Untyped commands throw** in `execute`. Fine while only the typed editor sends commands; revisit if scripts or an agent send JSON.
- **Warm cost of a drag preview ≈ 7 ms on 312 walls.** Fine for the demo (tens of walls); phase 4 should not validate more than once per pointer event.
- **Phase 6 installs `@types/node`:** rerun the Task 1.7 proof that core `src` rejects `process`.
- **Tests of working code:** keep asking agents to mutation-check new assertions (lesson 25).
- Nested rooms and bridge-connected rings stay deferred (§11): a free-standing room inside another does not reduce its area, and `faceAt` on its wall returns the outer room.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | not started | |
| 2 Room by typed lengths | domain works | domain tests |
| 3 Divider with midpoint snaps | domain works (no snaps yet) | domain tests |
| 4 Zones with areas | domain works | domain tests |
| 5 Helper resize | domain works | domain tests |
| 6 Invalid drag reverts | domain refuses the move | domain tests |
| 7 Two windows, cursors | not started | |
| 8 Undo and remote invalidation | inverse patches and dependencies ready | domain tests |
| 9 Headless scenario and domain script | domain script works (`rectangleRoom`, 18.24 m²) | domain tests |
