# Collaboration

How a drawing is held open, how several people edit one project through the server, and what happens when edits race or the connection drops. The stored tables and how a project file loads are in [domain.md](domain.md); layouts under collaboration in [layouts.md](layouts.md); the core loop, events and effects in [editor.md](editor.md); package rules in [../architecture.md](../architecture.md).

## Open documents

The drawing the editor has open is an `OpenDocument` (`packages/editor/src/document/types.ts`), null on the project list. `open-document.ts` is the only module that switches on its kind.

| | `LocalDocument` | `SharedDocument` |
|---|---|---|
| When | local mode: `?server=off`, or no `?server=` and no `VITE_SERVER_URL` | server mode, made by the first `snapshot` of the open in progress |
| Truth | `doc` | the server; `confirmed` mirrors it |
| A commit | applied at once, `revision` + 1, never rejected | shown at once, pending until `ack` or `rejected` |
| Saving | none | the server saves before it acknowledges |
| `status` | "not saved" | "waiting for server", "saved" or "offline" |
| `isDirty` | `revision > 0` | an edit in flight |

Local mode keeps one unsaved drawing and no project list. The web shell warns before the tab closes while `isDirty` (`beforeunload`, `packages/web/src/main.tsx`).

Tools, history and the view model use `visibleDoc`, `canCommit` (local always; shared when connected and nothing is in flight), `commit(d, { id, patch, dependencies })`, `onEvent`, `status`, `isDirty`, `hasPendingEdit` and `sessionOf`. The caller picks the ID and checks `canCommit` first; committing while blocked throws. Both kinds are pure reducers with no network, timers or `await`; tests send events in any order.

**Notices** report what happened. `applyNotices` in `packages/editor/src/notices.ts` gives each to history first, then to the tools.

| Notice | History | Tools |
|---|---|---|
| `accepted { id }` | the entry becomes usable, or the undo request settles | a paused wall chain resumes ([wall-editing.md](wall-editing.md)) |
| `rejected { id, reason }` | the entry is removed | the chain ends; toast `rejectMessage` ([warnings.md](warnings.md)) |
| `remoteChange { writes, topology }` | overlapping entries invalid; all if `topology` | gestures cancel or rerun ([tools.md](tools.md)) |
| `resynced` | both stacks cleared | every gesture cancels |
| `offline` | unchanged | every gesture cancels, `CONNECTION_LOST` |

A `LocalDocument` emits only `accepted`, in the same step. It never rejects: `execute` and the undo check validate first, and nobody else writes to it.

## The server

```
 web, MCP --WebSocket--> adapters/ws-transport.ts  (bind, Origin, frames)
                                   |
                         app/server-app.ts  (per-project queue, seq, broadcast)
                            |                          |
               ProjectRepository              ChangesetValidator
           json-file-repository.ts            domain-validator.ts
           <DATA_DIR>/<id>.json               fromStored + validateDocument
```

`packages/server/src/app` knows projects, sequence numbers and generic changesets, never `@fm/domain`. Its ports are in `app/ports.ts`. `main.ts` reads `PORT` (8787), `DATA_DIR` (`./data`) and `HOST`.

**One JSON file per project** holds the whole `ProjectState`: `meta` (`id`, `name`), `seq`, `doc`, `versions` (with tombstones) and `receipts`. There is no change log.

- `create` writes a file with a random UUID, `seq` 0, empty tables and versions.
- `load` takes IDs matching `^[A-Za-z0-9_-]{1,128}$`, and refuses a file whose `meta.id` differs from the ID asked (case-insensitive disks). The app loads a project once, runs the validator's `upgrade` on it and keeps it in memory.
- `save` writes `<id>.json.tmp`, syncs it, renames it over the file and syncs the directory where the platform allows. Nothing more is claimed against power loss.
- `remove` moves the file into `deleted/`; restore it by hand while the server is stopped.

**A file that isn't a project** (not JSON, or not a project state) is skipped by the list, answers an open with `openFailed` "Unknown project", and its path goes to stderr. Every other repository error, and any throw in a queued task, is fatal: the process exits with no ack and no rejection. `pnpm dev:server` restarts it after 1 s (`packages/server/scripts/dev-server.sh`), and the reload from disk decides whether a changeset is saved.

**Who can reach it.** There is no login, and binding to this machine is not authentication. It binds to `127.0.0.1` and refuses a WebSocket upgrade whose `Origin` names another host (`fromThisMachine` in `ws-transport.ts`); no `Origin` is a program, such as Claude's MCP server, and passes. Setting `HOST` to another address accepts any page, and anyone who reaches the port can read, change and delete every project. Binary frames and frames over 16 MB close the socket.

## Protocol

Messages and their parsers are in `packages/protocol/src/messages.ts`. IDs match `^[A-Za-z0-9_.:/-]{1,128}$` and never name an `Object.prototype` member; names are not blank and at most 200 characters (`MAX_NAME_CHARS`); a message over `MAX_MESSAGE_BYTES` (1,000,000 bytes) is `tooLarge`.

| Client to server | Server to client |
|---|---|
| `hello { clientId, name }`, first | `welcome { clientId, color }` |
| `listProjects`, `createProject { name }` | `projects { items }`, `projectCreated { meta }` |
| `deleteProject { projectId }` | `projects` to the sender, `projectDeleted` to every subscriber |
| `readProject { projectId }` | `projectDrawing { doc }`, no underlays or logos, joins no session ([cards.md](cards.md)) |
| `openProject { projectId, generation }` | `snapshot { meta, doc, versions, seq }`, always whole, or `openFailed { message }` |
| `closeProject { projectId, generation }` | nothing to the sender; `presenceLeft` to the others. The subscription ends and the connection stays |
| `submit { changeset }` | `changes { seq, changeset, clientId }` to every subscriber, sender included; `ack { changesetId, seq }` or `rejected { changesetId, reason }` to the sender |
| `presence { cursor, selection, state, level }` | `presence` with `clientId`, `name`, `color` to the others; `presenceLeft` |
| | `error { requestId, message }`: a delete of an unknown project; `requestId` null for a message that doesn't parse and `rejected` can't answer |

List, create, delete and read carry a `requestId`; list and create share one queue (`#workspace`), the others run in the project's; project messages carry `projectId` and the recipient's `generation`. `RejectReason`: `malformed { message }`, `tooLarge`, `unknownProject`, `conflict { entities }`, `invalid { violations }`.

## Sessions

- The first message must be `hello`; anything else, or a parse failure before it, closes the connection. Colours go round six (`PRESENCE_COLORS`) in order of joining. The web shell takes the name from `?name=` ("Guest" if blank, cut to `MAX_NAME_CHARS` if longer, so the `hello` always parses) and a per-tab client ID from `sessionStorage` (`identity.ts`).
- One connection has one open project. A generation is a fresh ID per open, reconnect and resync; both sides ignore messages of another generation, and a stale submit gets no answer. A submit for a project the session hasn't opened is `unknownProject`.
- Opening runs in the project's queue: snapshot first, then subscription, so every later `changes` follows the snapshot. Opening another project leaves the old one, which sends `presenceLeft` to the others. Going back to the project list sends `closeProject` for the drawing left behind, open or still opening (`showList` in `packages/editor/src/session.ts`): the server drops the subscription, the leaver gets no more of its changes or presence, and an open still queued for it is superseded. A `closeProject` for another project or generation changes nothing. Claude's `list_projects` goes to the list the same way, so it sends one too. After it, a `submit` from the leaver for that drawing is rejected as `unknownProject` and its `presence` is dropped, as for a drawing it never opened.
- Creating a project opens it, unless a drawing is open or another open is in progress when the reply arrives.
- Leaving a drawing with an edit in flight is refused (`LEAVE_BLOCKED`), never queued. Opening or leaving clears gestures, selection, presence, history and the viewed level (`closeDocument` in `packages/editor/src/session.ts`).
- **Deleting** is offered only on the list. The server runs it in the project's queue, after any save: it moves the file, forgets the project, sends `projectDeleted` to each subscriber, then the list to the sender; later submits get `unknownProject`. A client whose open project gets `projectDeleted`, or `openFailed` for its own reopen, returns to the list with the `PROJECT_DELETED` toast and drops its edit in flight and history.
- A snapshot that fails `fromStored` counts as a failed open: `CANT_OPEN` ([warnings.md](warnings.md)).

## Submit

`runCommand` in `packages/editor/src/commit.ts` commits a command's puts and deletes with its dependencies ([domain.md](domain.md)); a patch that writes nothing commits nothing.

**IDs, sequence numbers and versions.** The client names each changeset with a fresh `id` before sending, to match replies and make a resend safe. The server gives `seq` on acceptance, consecutive per project. The version map (`VersionMap` in `packages/protocol/src/patch.ts`) holds, per row, the ID of the last changeset that wrote it: every accepted put or delete stamps its rows (`stampVersions`), a deleted row keeps its entry as a tombstone, and no entry means the row never existed (`lastCs: null`). An ID never returns, so a row moved away and back still fails an old expectation.

**Building a changeset** (`sharedCommit` in `shared-document.ts`): `expect` lists each written row and each dependency once, with its confirmed version. A changeset over `MAX_MESSAGE_BYTES` is refused locally as `tooLarge`, so it never loops through reconnects.

**The server's decision.** Before the queue, the parser's `validateChangeset` refuses as `malformed` an unknown table, a row that isn't flat, a patch that writes nothing, duplicates, a row both put and deleted, and a write without an expectation. Then `decideSubmit` (`app/decide-submit.ts`) runs one submit at a time per project (`KeyedQueue`):

1. A receipt with the same fingerprint (SHA-256 of the canonical patch and expectations) answers `ack` with the original `seq`, with no reapply or broadcast. A different fingerprint is `malformed`.
2. An expectation whose version differs is a `conflict` naming those rows: first writer wins.
3. The validator runs `fromStored` and `validateDocument` on the whole result; a violation is `invalid` ("I5: …").
4. `seq` + 1, versions stamped, a receipt stored, the file saved; only then is the state published, broadcast and acknowledged.

Nothing is merged. Edits on disjoint rows that are valid together both pass, in arrival order. Dependencies name what a command relied on, not every row the whole-document check reads, so two disjoint edits can each pass alone and fail together: the second is `invalid`, not `conflict`. Every accepted changeset leaves a valid document, but nothing validates at load, so a stored drawing that is invalid opens as confirmed ([domain.md](domain.md)).

## The shared document

`SharedDocument` holds `confirmed { doc, versions, seq }`, `inFlight` (one changeset or null), `connection` ("connected", "syncing", "offline"), `generation` and `visible`: confirmed plus the in-flight patch while its expectations hold and the result validates (`computeVisible`). While an edit is in flight, edits and undo toast `blockedMessage` and are not queued; camera, selection and presence go on.

| Event (`sharedOnEvent`) | Action |
|---|---|
| other project or generation; `changes` at or below confirmed `seq`; `ack` for another ID | ignored |
| `changes` after a gap, or one that won't apply | resync |
| `changes`, next `seq` | applied to confirmed with versions; own ID: no notice, in flight until the ack; else `remoteChange` |
| `ack`, `seq` ahead of confirmed | resync; the same-ID resend gets the ack again |
| `ack` | in flight cleared, `accepted`; no values taken from it |
| `rejected` for the edit in flight | in flight cleared, `rejected` |
| connection closed | "offline", `offline` once; the edit in flight stays unresolved |
| connection open | a new snapshot request |
| `snapshot` | confirmed replaced, connected, `resynced`; the edit in flight resent with the same ID |

Resync asks for a snapshot under a new generation and sets "syncing", unless one is pending.

## Undo in a shared document

History (`packages/editor/src/history/history.ts`) belongs to the open document and is never saved. An entry holds the domain patch and its dependencies: its writes, rows it created included, and the semantic ones. A local document runs the same code; its entries are usable at once.

1. An entry is pending until its edit is accepted. Undo or redo is enabled when `canCommit` holds, no undo request is pending, the top entry isn't pending, and some entry is usable.
2. Undo checks that the written rows hold the after-values, absence included; redo checks the before-values. If not, or if the entry is invalid, it toasts "Can't undo: the drawing changed remotely" (or redo) and drops that entry and the invalid ones directly under it (`dropRefused`), so the next press reaches an older one.
3. The inverse (`invertPatch`) or forward patch is validated locally. A refusal there toasts and keeps the entry: moving what blocks it can make it apply.
4. It commits with a fresh ID and current confirmed versions; further commits wait for it.
5. Accepted: the entry moves to the other stack, unless a remote change invalidated it meanwhile. Rejected: the entry is dropped.

A remote write invalidates the entries whose dependencies it touches; a remote topology change (a joint or wall made or deleted, or a wall's ends changed: `changesTopology`) invalidates all. A snapshot clears both stacks; a new edit clears redo. Undoing one's own edits doesn't invalidate older entries, because versions are read at each request.

## Presence

A client sends its cursor, selection, active layout (`state`) and viewed level (`level`: a deck's ID, null for the floor) on every pointer move and on a change of layout or level, only while a shared document is connected (`pointerPresence`, `presenceOnStateChange` in `session.ts`). The web adapter sends the latest at most every 50 ms (`packages/web/src/adapters/ws-server.ts`). The server relays it unread, outside the queue, never stores it and never replays it. The editor ignores its own and clears all on a connection change. A remote cursor is a 5 px disc in the sender's colour with a label (`drawPresence` in `packages/editor/src/view/scene-marks.ts`); remote selections aren't drawn. The label's layout part is in [layouts.md](layouts.md), its level part in [levels.md](levels.md).

## Disconnect and recovery

The web adapter reconnects after 1, 2, 4, 8, 16, then every 30 s (`BACKOFF_MS`), back to 1 s once a socket opens, sends `hello` again, and drops messages sent while closed. Offline, a shared document allows viewing, camera and selection, not commits, and keeps its one edit in flight. On reconnect the editor reopens the project under a new generation; the snapshot replaces confirmed, cancels gestures and clears history, and the edit in flight is resent with the same ID, so a receipt settles it once. On the list, a reconnect fetches the list and repeats an open in progress. Closing the tab loses track of an edit in flight; reopening shows the server's state.

## One command, end to end

```
Alice drags joint J1 (walls W1, W4); Bob has the project open.
Alice   execute(visible, moveJoints): put J1; dependencies J1, W1, W4
        commit c1, expect J1@c0 W1@c0 W4@c0; history entry pending
        inFlight c1, visible shows the move, "waiting for server"
        submit c1 ---------------------------------> server queue
server  parse, receipt, expectations, apply + validate
        seq 43, J1 -> c1, receipt, file saved
        changes{43, c1} -> Alice, Bob;  ack{c1, 43} -> Alice
Bob     applies 43; remoteChange{J1}: a gesture on J1 cancels,
        his history entries on J1 turn invalid
Alice   changes{43, c1} is hers: no notice, nothing moves
        ack: inFlight null, entry usable, "saved"
        (rejected instead: entry removed, J1 snaps back, toast)
```

## Limits

- One edit in flight per client; no offline editing, no merging, no partial undo.
- No deleting from inside a drawing, no undoing a delete; other clients' lists don't refresh.
- Saving files: [domain.md](domain.md).
- Receipts and tombstones are never compacted. A save that keeps failing, such as on a full disk, becomes a restart loop.
