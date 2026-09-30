# Gate 6: Server

**Date:** 2026-09-29 · **Phase file:** `docs/plans/flatmate/phase-6-server.md` · **Commits:** `3053669`..`7b2c388` · Lean mode.

## 1. Outcome

A Node WebSocket server now stores projects as JSON files. It serializes work per project, validates every changeset against the whole resulting drawing, saves before acknowledging, keeps receipts so resends are idempotent, and crashes on any error inside a project task; the restart loop brings it back. No demo step is visible yet: the server side of steps 1, 7 and 8 is ready, and the client comes in phase 7.

## 2. Completion criteria

All ticked. For the persistent-failure criterion, the restart loop was observed once at the gate; the persistent-failure run itself was cut with Task 6.12.

## 3. Verification

| Command | Result |
|---------|--------|
| `pnpm check` | pass: protocol 94, domain 188, server 50, editor 272, web 59 = 663 tests |
| server tests per file | queue 4, testing 3, decide-submit 8, domain-validator 3, server-app 20, json-file-repository 8, ws-transport 2, crash-restart 2 |
| Smoke (Task 6.10) | `welcome`, `projectCreated`, `projects`, then `closed 1005`; data file created and ignored by git |
| Restart loop | `kill` of `tsx src/main.ts` → `exited with status 143; restarting in 1 s` → `listening` again |

## 4. Implementation issues

The reviews (parsers + `decideSubmit`, server app + JSON repository) found three real defects. All are fixed test-first.

| # | Issue | Fix |
|---|-------|-----|
| 1 | The parser threw on a table value shaped `{"toString": 1}` instead of returning `malformed` | Untrusted values are never stringified |
| 2 | Extra entity fields were accepted: stored and broadcast unvalidated. A 200,000-level nested field (400 KB) overflowed the recursive fingerprint inside the queued submit, which crashed the server, and the client's same-ID resend crashed it again after every restart | Entity values must be primitives or flat objects; the domain `parse*` functions reject unknown keys |
| 3 | macOS file names ignore case, so `load("ABC…")` opened `abc….json` as a second live copy with its own queue, which could overwrite an acknowledged change | `load` returns null unless the stored ID equals the requested one |

Lesson 29 in `process.md` records the pattern: at a trust boundary, bound the shape, never stringify untrusted values, and compare the ID you asked for with the one you got.

Side effect of fix 2: a local file whose entity has an extra field is now refused. Unknown top-level fields are still dropped (spec §3.7 allows both; memory updated).

## 5. Changes to the plan

- Task 6.11 trimmed to the two in-memory restart cases; Task 6.12 cut (lean mode).
- The plan's code matched the existing code everywhere. The agents added only one extra test (`isWireId` rejects `constructor` and `__proto__`).

## 6. Changes to the spec

None (§3.7 already says unknown fields are not preserved).

## 7. Design-memory updates

- `collaboration.md`: three server-session rows replace the planning draft (hello first, stale generations ignored, open leaves the old subscription at once, crash-only for any queued task error).
- `implementation.md`: the JSON repository layout, the WebSocket `maxPayload`, and durability wording.
- `domain-geometry.md`: unknown entity fields are rejected.
- `process.md`: lesson 29.

## 8. Gate questions

1. **Ordering:** only the per-project queue orders project work. `leave` and `presence` run outside it on purpose, and `createProject` sets up the live project from the workspace queue before anyone knows its ID. The review traced open, submit and leave: superseded opens are dropped by generation, and a joiner gets its snapshot and then exactly the later changes. No race remains.
2. **Durability on macOS:** `ack` means the OS reported the tmp write, `sync`, rename and directory sync complete (Node 22.14). Whether libuv's fsync forces the drive cache on macOS (`F_FULLFSYNC`) was not verified. The claim is "saved before acknowledged", with no power-loss durability claim.
3. **Validation gaps:** entity fields are now limited to what the domain checks. Expectations of unrelated entities and presence selections of missing entities are accepted but harmless (expectations only make a submit stricter; presence is not stored). Messages between 1 and 16 MB get `tooLarge` from the app, and anything bigger closes the socket. No gap can store an invalid drawing, because the validator checks the whole result.
4. **Persistent failure:** not run (6.12 cut). By design, a client reconnects with backoff and the server crashes again on the next repository access. That is acceptable for the demo (spec §7.2).
5. **Risks for phase 7:**
   - Generations must be unique per open.
   - Resends go out only after the snapshot.
   - An unknown project is answered with `openFailed` carrying the request's project and generation, and `error` never ends an open.
   - Presence is not replayed when someone joins.
   - Local files with extra entity fields are now refused.

## 9. Demo status

| Step (§1.4) | Status | Host |
|-------------|--------|------|
| 1 Project list | server ready, client in phase 7 | |
| 2–6 | works | browser, headless |
| 7–8 Two windows | server ready, client in phase 7 | |
