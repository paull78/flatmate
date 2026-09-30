# Gate 7: Collaboration

**Date:** 2026-09-29 · **Phase file:** `docs/plans/flatmate/phase-7-collaboration.md` · **Commits:** `2ff162b`..`bb51af3` · Lean mode.

## 1. Outcome

Two browser windows now open the same server project and edit it together (demo steps 1, 7 and 8). The project list creates and opens projects. Each edit shows at once, goes to the server as one changeset and settles there; wall chains pause until their segment is acknowledged. Remote cursors and names are drawn, and remote changes cancel or rerun an affected gesture. Shared undo only touches settled entries. The Playwright test runs Alice and Bob in two windows against a real server: each sees the other, and Bob's wall move changes Alice's drawing.

## 2. Completion criteria

All ticked, with lean-mode notes:
- No zones browser spec (Task 5.10 cut).
- The late-joiner scenario and the client side of "opening during a submission" and "crash during save" were cut with Task 7.13's trim. The server side of both is covered in phase 6.
- The hand reconnect check (Task 7.17) moves to the Task 8.8 rehearsal.

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: protocol 94, domain 188, server 51, editor 356, sync-tests 14, web 70 = 773 tests |
| `pnpm e2e` | 2 passed: local smoke, and two windows on one project (1.5 s) |
| kind-switch grep | only `packages/editor/src/document/` |
| async grep (`async\|await\|Promise\|setTimeout\|WebSocket` in editor src) | no output |

## 4. Implementation issues

| # | Issue | Fix |
|---|-------|-----|
| 1 | A late `created` reply opened the new project even after the user had opened another, closing a drawing with an outstanding edit (review) | It now only lists the project; test added; spec §7.2.1 and `collaboration.md` updated |
| 2 | The offline-drag test could not fail if the drag gate were removed (review) | It now checks that the drag never starts |
| 3 | Plan code and tests were stale in small ways: an input built from an already-moved document, `_left` flagged by ESLint, and "Rejected: the drawing would become invalid" where the editor now names the invariant | Adapted; no behaviour change |
| 4 | Snapshots and disconnects must also cancel helper editing (added in phase 5) | Covered and tested |

The review of the SharedDocument reducer, the wire mapping and the WebSocket adapter found nothing at the demo bar.

## 5. Changes to the plan

- 7.13 trimmed to the blocking and reconnect scenarios; 7.17 moved to 8.8.
- 7.16 first created `e2e/support/canvas.ts`, since 5.10 was cut.
- 7.4 exported the wire mapping early so the web adapter could land in wave 1.

## 6. Changes to the spec

- §7.2.1: creating a project opens it only if nothing else was opened or is opening by the time the server confirms the creation.

## 7. Design-memory updates

- `collaboration.md`:
  - the SharedDocument reducer and resync rule;
  - the local `tooLarge` refusal;
  - the late `created` rule.
- `open-documents.md`: session rules, and a shared document counts as dirty while an edit is outstanding.
- `editor-interaction.md`: gesture dependencies, the rerun rule, and a same-step rejection leaves the wall tool unchanged.
- `architecture.md`: one wire mapping for every shell.
- `implementation.md`: the sync-tests harness and web server mode.

## 8. Gate questions

1. **§7.4 coverage:** every row in the completion table has a named test in `shared-document.test.ts`, `shared-scenarios.test.ts`, `shared-tools.test.ts` or `shared-undo.test.ts`, plus the sync tests. No missing row was found.
2. **Interleavings §7.4 did not describe:**
   - A late `created` while another project was opening. Resolved above.
   - A snapshot while a history request is pending clears both stacks and the request.
   - A resync while a chain is paused leaves it paused until the snapshot, which then cancels it.
   - Accepted and not fixed: an `openFailed` answering a document's own resync generation is ignored, so the drawing would stay "syncing". The server only sends it for unknown projects, and nothing deletes projects.
3. **Latency:** not timed by hand. The two-window Playwright test types each segment and waits for the acknowledgement, and it finishes in 1.5 s. On localhost the pause is not expected to show; the 8.8 rehearsal will confirm.
4. **Reconnect:** moved to the 8.8 rehearsal. Headless, the reconnect scenario settles a lost acknowledgement through the snapshot and the same-ID resend, and both clients converge.
5. **Readings made while planning:** all confirmed.
   - The positional anchor check for a drawing chain.
   - Leaving is refused, not queued, while an edit is outstanding.
   - The local `tooLarge` guard.
   - Presence is cleared on every connection change.
   - A shared document is dirty while an edit is outstanding.
6. **Risks for phase 8:**
   - Keyboard focus when switching windows.
   - Cursors only reappear after the other person moves the mouse (presence is not replayed on join).
   - A server restart mid-demo cancels gestures ("Connection lost").
   - The rehearsal needs the seeded fallback project (Task 8.4) and one hand run of the reconnect.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | works | browser + server |
| 2–6 | works | browser (local and shared), headless |
| 7 Two windows, cursors | works | browser (Playwright) |
| 8 Concurrent edit | works | browser (Playwright), sync tests |
| 9 Portable core | phase 8 | |
