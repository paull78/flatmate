# Undo / history

[← index](INDEX.md)

## Decisions (rev 4)

The rows below apply to `SharedDocument`s. A `LocalDocument` runs the same history code as a plain stack: entries usable within the same update (recorded pending, made usable by the same-step `accepted` notice; 2026-09-29), value checks always pass, never invalidated; undo/redo commit like any edit and trigger autosave (2026-09-26, §7.0).

| Decision | Why | Spec |
|----------|-----|------|
| History is local to the open document; stores value patches, before/after values, semantic dependencies — **no pre-built versioned inverses** | Pre-built inverses stamped with old versions break `c1 → c2 → undo c2 → undo c1` | §7.5 |
| Entries usable only after their edit is **accepted** (the `accepted` notice; immediate for local documents) | Undoing an unconfirmed edit is ill-defined | §7.5 |
| Undo/redo enabled only when connected, the single outstanding submission settled (2026-09-26), no history request pending | Keeps ordering trivial | §7.5 |
| Local check: written entities must equal the entry's after-values (redo: before-values), incl. absence | Instant refusal UX | §7.5 |
| Inverse built at request time with fresh ID and expectations from the **current** confirmed versions; server expectations protect races | Critique 2: client-only check raced with remote edits | §7.5 |
| Entry moves stacks only on acceptance; rejection discards it with reason; other commits blocked while a history request is pending | No half states | §7.5 |
| Invalidation: remote writes overlapping an entry's dependencies; **any remote topology change invalidates all**; snapshots clear both stacks | Conservative and simple | §7.5 |
| An entry's dependencies are the patch's writes **plus** its semantic dependencies (`entryDependencies`); `addWall`'s `DomainPatch.dependencies` omit the entities it creates, so the writes are what make an undo of an add depend on the new wall (2026-09-29, Task 3.6; pinned by a test) | Inverse dependencies include created entities | §7.5 |
| A rejection removes the entry with that ID only if it is unconfirmed (pending or invalidated); a usable entry is kept (2026-09-29, wave 3 review) | A stray rejection must not drop an accepted edit; an edit invalidated by a remote change and then rejected must not stay as a dead entry blocking undo | §7.5 |
| `recordCommit` throws while a history request is pending (programming error, like `commit` while blocked); `canCommit` already prevents it (2026-09-29, wave 3 review) | Otherwise the request's acceptance moves the newer entry, not the one it undid | §7.5 |
| All-or-nothing; partial undo out of scope | Multi-entity ops (splits) can't be partially reverted (critique 1) | §1.3 |

## Don't

- Don't remove a rejected entry only when it is `pending`: a conflict usually invalidates it first, and the dead entry would block undo (2026-09-29, found by the wave 3 fix agent's test).
- Don't skip individual entities during undo.
- Don't rely on the client-side check alone.
- Don't let a remote move that restores original coordinates "revalidate" an invalidated entry — invalidation is by write overlap, not by value.
- Don't preserve history across reconnects (non-goal).

## Known consequence

Any remote `addWall`/delete (topology change) wipes the other user's whole history. Demo step 8 deliberately uses a non-topological move.
