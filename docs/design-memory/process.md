# Process, preferences & lessons

[← index](INDEX.md)

## How the user works

- Explain in **simple terms with ASCII diagrams**; one question at a time, multiple choice when possible.
- Prefer the **simplest solution**; cut functionality or add hard constraints instead of clever general designs.
- For this demo, keep the five-minute script and portable-core story sharp. Defer a feature or edge case when it materially complicates geometry, sync or UI without improving that demonstration (2026-09-27, spec §1 and §11).
- Implementation runs in phases with **gates**: at each gate write a report (issues, plan changes, spec changes, risks) in `docs/reports/`, make sure every finding is in design memory, and stop for approval (2026-09-27, plan README).
- **All findings go to design memory**, when they happen, not only at gates (2026-09-27).
- The user reviews code in batches. Phase 1 and Tasks 2.1–2.6 ran one task at a time, each left uncommitted until the user said "next". From Task 2.7 the user asked for **parallel agent development on Opus**: independent tasks run as waves of subagents, each in its own git worktree, and the controller stops after each wave for review (2026-09-28).
- When the user delegates a decision they say **"favour correctness"**: fix a real defect rather than record it as a limitation, and keep both reviews (spec, then quality) per wave (2026-09-28).
- **Lean mode from phase 4 (2026-09-29, after Gate 3):** the user asked to relax tests and steps because this is a demo. Waves run back to back and the controller stops only at gates. One combined review (plan + quality) per wave, only for core logic (editor, domain, server app, shared document); glue code (web adapters, panels, launcher, README, styling) gets none. Fix only findings that break the demo, leave an invalid drawing, or let clients diverge; drop minor ones unrecorded. No mutation checks (red then green stays). The code wins over stale plan code (no syncing of later plan copies). One docs commit per wave; short gate reports. Cut: tasks 5.10, 6.12, 8.6; trimmed: 6.11, 7.13, phase 7 carried tests; 7.17 folds into 8.8. This supersedes "keep both reviews" above.
- The user edits the spec directly (rev 4 was theirs) and runs external design critiques — treat critiques on their merits, verify each point, don't accept or dismiss wholesale.
- Spec lives at `docs/specs/flatmate-design.md` (moved out of `docs/superpowers/` on 2026-09-27); the implementation plan at `docs/plans/flatmate/`; gate reports at `docs/reports/`. Commit spec changes when asked.

## Recurring lessons from critiques

1. **State the guarantee, then check the mechanism actually provides it** (e.g. "planar graph" was promised while remote changes bypassed validation).
2. **Validate at the single authority** (server, atomically), not only on the client.
3. **Define every state × event** for protocols and tools (tables beat prose).
4. **Don't overclaim** (antialiasing, draw calls, durability, determinism, "complete demo").
5. **Examples in tests must be realizable** (typed lengths need directions; nested cases need semantics).
6. **Check degenerate geometry with a concrete counterexample** before trusting a validity test.

7. **Keep collaboration bounded initially:** one outstanding edit; block further commits instead of queuing dependent optimistic edits (2026-09-26, §7.4).

8. **Keep invariant tests aligned with the full invariant list:** include shape and finite-number validation as well as geometry (2026-09-26, §3.3 and §9).

9. **Keep diagrams and error summaries aligned with protocol failure paths:** definite rejection and an unresolved write outcome require different client behavior (2026-09-26, §7.3 and §8).

10. **Match each mode's contract to who has authority:** separate acceptance (who says yes) from persistence (is it saved). One shared store contract forced a local file write to gate acceptance and undo (2026-09-26, §7.0).

11. **When a constraint changes, sweep the plain-language sections too:** §4.0 still justified changeset IDs by queued edits after the one-outstanding-edit rule removed the queue (fixed 2026-09-26).

12. **Name both sides of every comparison in state rules:** `saveResult.revision` shadowed the document's `revision`, making the autosave catch-up rule read as never-true (2026-09-26, §7.0).

13. **Identify async results by a unique request ID, not by a counter that restarts:** save results matched by revision could settle another document's write (2026-09-26, §7.0).

14. **Guard navigation as well as tab closing when work is volatile:** a dirty in-memory drawing was silently discarded when opening another project; the editor now requires an explicit choice (2026-09-26, §7.0). Simpler still: on 2026-09-27 the initial build removed that navigation, so the prompt moved to X1; removing the situation beats guarding it.

15. **Separate demo requirements from future breadth:** advanced CAD controls, arbitrary crossings, complex rooms and dimension entities inflated the first build. Give each a follow-up priority instead of requiring it for the demo path (2026-09-27, §1 and §11).

16. **After cutting features, re-run the demo script against the rules that remain, and check each screen has state and an input path:** removing midpoint and angle snapping made the divider and typed walls imprecise, the paused chain lost `chainStart`, and the project list had no state or panel event (2026-09-27, §1.4, §5).

17. **Reuse an existing recovery path before adding a new one:** receipts and the same-ID resend already settle a failed save after a restart, so in-process write recovery was redundant for the demo (2026-09-27, §7.2).

18. **Rehearse the demo at the level of physical input:** the script said "type `6` with `Shift` held", but `Shift`+`6` is `^` on a US keyboard. Check key events, not just editor semantics (2026-09-27, §5.4, found while planning phase 8).

19. **Plans written in parallel need a cross-file review:** separately written phases collided on the same file (`e2e/support/canvas.ts`), replaced layout CSS another phase added, and asserted on canvas text that is not in the DOM. Review later phases against the actual code of earlier ones (2026-09-27, plan review).

20. **Every completion criterion needs a step that produces its evidence:** phase 1's criteria claimed an unresolvable-import check that no step ran. When starting a phase, map each criterion to the step that proves it (2026-09-27, gate 1).

21. **Probe a boundary by every route that can cross it:** the `exports` map blocked `@fm/domain/src/geometry`, but `../../domain/src/geometry` went around it and passed every check. A negative check per route, not per rule (2026-09-28, found by the user's question).

22. **Plain objects used as maps inherit members:** an ID named `constructor` looked up a function, and `__proto__` could not be stored at all. Where untrusted strings key plain objects, exclude those names at the shape layer (or use own-property lookups), and test with them (2026-09-28, wave 1 spec review).

23. **When a rule is narrowed, say what it counts:** "two-room merge" in the spec versus "exactly two labels" in the plan agreed on the demo but split on three rooms with one unlabelled. Probe the narrowed rule with a case where the counted things differ (2026-09-28, wave 3 spec review). When a review settles such a rule, re-derive everything that depends on it: counting labels widened the merge to three rooms, but its dependencies still covered only the two source rooms (found by the code review the same day).

24. **Apply a cross-cutting rule to the whole set, and test it over the set:** the ID guard reached the commands one wave at a time, and no-op identity was fixed for three commands while `moveJoints` still returned a copy. One test that loops over every command (the `execute` ID-guard and no-op tests now do) catches the member that was missed (2026-09-28, wave 4 spec review). Better still, enforce the rule at the single entry every command passes through (`execute`), as the code review did the same day.

25. **A passing test can still assert less than its title:** tests of already-working code pass on the first run, so nothing shows what they fail to catch. The demo test compared areas in zone-sort order (swapping the labels stayed green), and a test titled "leaving the document unchanged" never looked at the document. For tests that are green from the start, mutate the code or the input once per claim and watch the test go red; check each title against its assertions (2026-09-28, wave 5 spec review).

26. **An uncorrelated error reply can cancel a newer request:** an unknown project was answered with `error { requestId: null }`, and the client cleared whatever open was pending, so a late failure for one project dropped the snapshot of the project opened next. Snapshots were already matched by project and generation; failures were not. Correlate every reply with the request it answers, the failure path included (2026-09-28, code review; spec §7.2).

27. **A filter test needs the filtered thing inside the window it filters from:** the Shift snapping test's off-axis corner sat 1 m from the cursor, outside the 0.125 m tolerance, so it passed with the axis filter deleted. Put every excluded candidate where it would otherwise win, then mutation-check the filter. Likewise a test that imports only types is not red at runtime (Vitest erases them); its red step is the typecheck (2026-09-28, phase 3 wave 2).

28. **A cached value derived from two inputs goes stale when either one changes:** `pointer.world` was computed from the screen point and the camera, but only pointer events refreshed it, so a two-finger scroll left the typed-length direction 2 m off; the select tool's drag threshold compared screen points, so a scroll during a press made the next small move jump the wall. List every event that changes an input (here: wheel, resize, pan) and recompute there, or measure in the space that does not move (2026-09-29, phase 3 wave 6 reviews).

29. **At a trust boundary, bound the shape, not just the type, and compare what you asked for with what you got:** the wire parser kept any extra entity field (stored unvalidated; a deeply nested one overflowed recursive hashing and crashed the server on every same-ID resend), stringified an untrusted object, and a case variant of a project ID opened the same file twice on macOS. Accept only the fields the validator checks, never stringify untrusted values, and check that a loaded record's ID equals the requested one (2026-09-29, phase 6 reviews).

30. **Check a tolerance against the spacing it filters:** the grid snap shared the 10 px tolerance with the other snaps, but grid cells are at least 16 px wide, so half of every cell never snapped and walls landed at raw cursor positions; the snapping tests even pinned that behaviour as "returns the raw cursor". When two constants interact (a tolerance and a step), test the worst point between them (2026-09-29, user bug report).
31. **A zoom-dependent value must not decide where geometry lands without a zoom-independent way back:** after lesson 30 made every free point land on the current grid, and the grid step changes with zoom (0.2 m and 0.5 m grids don't share points), a joint placed at one zoom could not be lined up again at another. The fix snaps to other joints' x and y (aligned snap). When a rule depends on view state, test the same edit at two zoom levels (2026-09-29, user bug report).

32. **An order-dependent effect breaks when a second backend orders differently:** the helper plate hid its dimension line only because Canvas2D paints in scene order; WebGL batches by kind and drew the line through the number. The plan had claimed "only overlaps of 1 px or less" without checking every layer. When a new backend changes an implicit order, audit every place that relied on it, and prefer geometry that needs no order (2026-09-29, S1.2 review).
33. **A check-then-act sequence must hold its lock for the whole sequence:** `draw_room` pre-checked four walls, then queued each wall separately, so a parallel tool call ran between them and the room stopped half-way on a domain error the pre-check was meant to rule out. Serialise the unit the guarantee is about (the tool call), not its steps, and test it with two calls in parallel (2026-09-29, M1 Review B).

34. **A new operation in a second queue breaks invariants the first queue gave for free:** the project list read every `*.json` it had just listed, safe only because no file ever disappeared (saves rename atomically; create and list share one queue). Project delete moves a file from the project's queue, so a list running at the same time read a missing file, and crash-only turned that into a server restart. The in-memory test repository could not show it; a real-file race test (20 overlapping list/remove pairs) did. When an operation runs in a new queue, list what the other queues assumed about the data it touches (2026-10-01, D1 review).

35. **An index over floating-point coordinates needs a guard for the far range:** the room index looped `for (x = x0; x <= x1; x++)` over cell numbers, and beyond 2^53 cells `x + 1 === x`, so a room 2^60 m away (finite, so valid under I8) hung every client. Equivalence tests on drawings near the origin cannot see this; ask what the validator accepts, not what the demo draws, and check loops over derived integers with `Number.isSafeInteger` (2026-10-01, P4 review).

## Open options

- Sender could receive only `changes` as acknowledgement, with bare `ack` reserved for duplicate resends (one less message on the common path). Not adopted yet.

## Open issues (from rev-4 review, 2026-09-26)

None open. (Last one resolved 2026-09-26: document logic as pure reducers with table-driven tests, spec §9.1.)
