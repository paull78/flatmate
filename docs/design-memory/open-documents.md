# Open documents: local and shared

[← index](INDEX.md)

```
EditorState.document: OpenDocument | null          null = no drawing open (project list)
OpenDocument = LocalDocument  (accepted now; saving: none | file)
             | SharedDocument (server accepts; §7.4)
```

## Decisions

| Decision | Why | Spec |
|----------|-----|------|
| Separate **acceptance** (who says an edit is real) from **persistence** (is it on disk) (2026-09-26) | The old shared `ProjectStore.submit` made a local file write gate acceptance and undo | §7.0 |
| `OpenDocument = LocalDocument \| SharedDocument`; tools, gestures, history and ViewModel use only `visibleDoc`, `canCommit`, `commit`, `onEvent`, `saveNow`, `status` (2026-09-26) | Tools and history written and tested once | §7.0 |
| The interface is shaped by the harder case: `commit` → accepted now, or pending then accepted/rejected via **notices**; `LocalDocument` emits `accepted` in the same `update` and never rejects (2026-09-26) | One code path; `execute` already refused invalid commands and nobody else writes locally | §7.0 |
| Only the `open-document` module switches on `kind`; creating the document on open is the only mode branch (2026-09-26) | Keeps mode checks out of tools | §7.0 |
| In-memory = `LocalDocument` with `saving: none` — no third kind, no null document (2026-09-26) | In-memory and file behave identically for edits and undo; only saving differs | §7.0 |
| Name is `OpenDocument`, not "session"; "session" keeps its network meaning (server project session, connection generation) (2026-09-26) | "Session" says *when*, not *what*, and was already used in §7.2.1 | §7.0 |
| Local file saving (follow-up X1; not in the initial build, 2026-09-27): whole-file snapshot of the §3.7 document; autosave 1 s after last commit + `Cmd+S`; one write at a time; each write has a unique `writeId` returned in `saveResult`, and a result counts only if it matches the active write; the autosave timer is `autosave/<openId>`; opening another drawing waits for the local file's save (stays on failure); on success, if the document's revision moved past `r`, write again at once; failure keeps edits, retries on next commit or `Cmd+S`; never blocks editing or undo (2026-09-26) | Snapshot saves are naturally retry-safe; saving is not acceptance | §7.0, §7.8 |
| Local files hold only the versioned document: no seq, version map or receipts (2026-09-26) | Single writer; nothing to reconcile | §7.8 |
| Local undo: same history code as a plain stack; entries usable within the same update (recorded pending, made usable by the `accepted` notice the local document emits in the same step; 2026-09-29), never invalidated (2026-09-26) | No remote writers | §7.0 |
| `dirty` in the ViewModel so the shell can warn before closing; in-memory with commits counts as dirty (2026-09-26) | Cheap protection against losing work | §5.9, §7.0 |
| Initial build: an in-memory drawing exists only in tests and the server-less web app (one drawing, no project list), so no in-app navigation leaves it; the before-close warning is its only guard. Cancel / Discard when leaving a dirty in-memory drawing comes with X1 (2026-09-26; deferred 2026-09-27) | Removing the navigation removes the need for the prompt; the demo uses server projects only | §7.0, §11 |
| Tool scenarios run against both kinds (shared with a fake server that answers later) (2026-09-26) | Pending paths (paused chain, pending history) otherwise untested until step 6 | §9 |
| Both kinds are **pure reducers** `(state, event) → {state, effects, notices}`: network and timers are effects out / events in; tested by one-transition table rows (builders + `checkConsistent`), event-sequence scenarios, and, as an optional follow-up, fast-check random sequences with per-step invariants (2026-09-26; fast-check made optional 2026-09-27) | `await` hides interleavings; real sockets and timers make rare orders untestable | §9.1 |
| `commit(d, { id, patch, dependencies })`: the caller creates the ID, which becomes the changeset ID (shared) and the history entry ID; `onEvent(d, event, host)` gets the host for new generations (2026-09-27) | One ID from gesture to server to history | §7.0 |
| A shared project opens when the first `snapshot` for `workspace.opening` arrives; no workspace `opened` event for shared projects (local files keep `opened`, X1) (2026-09-27) | The editor already matches snapshots by generation; one path for open and resync | §7.0 |
| `Notice` includes `offline`: a disconnect cancels gestures, including a paused wall chain; history waits for the snapshot after reconnect (2026-09-27) | Gestures must not survive a dropped connection | §7.0, §7.4 |
| Build order: headless editor and web shell run on an unsaved `LocalDocument`; no storage adapter before the server step (2026-09-26) | Local editing works from the start | §10 |
| Session rules (`session.ts`): creating a project opens it; a snapshot or `openFailed` counts only if it matches `workspace.opening`, and a workspace `failed` never touches it; with no drawing open, a reconnect refreshes the list and repeats a pending open under a new generation; opening or leaving clears gestures, selection, presence and history; leaving while an edit is outstanding is refused with a toast, not queued; presence is cleared on every connection change; presence client IDs pass `isValidId` before keying the map (2026-09-29) | §7.2.1 says switching waits for settlement; a refusal is the simplest waiting that never replays input | §7.2.1, §7.6 |
| A shared document is dirty while an edit is outstanding (its outcome would be lost on close) (2026-09-29) | The before-close warning then covers the one case where closing loses tracking (§7.7) | §7.0, §7.7 |

## Don't

- Don't write document logic as an async class that owns the socket, `await`s replies or starts real timers: code after `await` assumes a world that other handlers changed meanwhile.
- Don't give local files and the server one store contract (`ProjectStore` list/create/open/submit with ack). Superseded 2026-09-26: it made a disk write gate acceptance and undo.
- Don't model in-memory as a null document or a third kind.
- Don't silently discard a dirty in-memory drawing during app navigation; the earlier switch rule lost work without a choice (2026-09-26). Applies once X1 adds such navigation.
- Don't build the discard prompt (`pendingNavigation`, `discardDecision`, `discardPrompt`) in the initial build: nothing navigates away from an in-memory drawing yet (2026-09-27).
- Don't branch on document kind outside the `open-document` module.
- Don't identify a save result by revision or project alone: revisions restart per open document, so a late result from file A could mark file B saved (2026-09-26).
- Don't compare a save result's revision with `savedRevision` to detect newer edits (always false): compare the document's current revision with the completed one (2026-09-26).
- Don't let a local save failure revert an edit, block editing or touch history.
- Don't add a production in-memory store to fill the build-order gap; an unsaved `LocalDocument` is enough.
- Don't move drawings between local and shared, or support two tabs on one local file (non-goals; last save wins).
