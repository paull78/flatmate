# Collaboration & persistence

[← index](INDEX.md)

## Decisions

| Decision | Why | Spec |
|----------|-----|------|
| Server is the source of truth; one JSON file per project (doc + versions + receipts + seq); **no change log** | Relay-only had no truth; logs + compaction broke idempotency (critique 2) | §7.1 |
| Only `SharedDocument`s use the server; the web adapter is `ws-server` (workspace ops, submit, presence). Local files never pass through it (2026-09-26) | Acceptance and persistence separated; see [open-documents.md](open-documents.md) | §7.0, §7.1 |
| `Changeset = { id, patch, expect }`; **version map** `lastCs` per entity with **tombstones** (`null` = never existed) | Compare-and-set without ABA; recreate needs deletion version | §4 |
| `expect` covers every written entity **and semantic dependencies** (table in §4) | Read dependencies catch meaning conflicts (e.g. fixed endpoint moved during resize) | §4 |
| Accept only if expectations hold **and** result validates → **first writer wins**, no LWW | LWW + generic apply could break invariants (critique 1) | §4, §7.3 |
| Topology change detected from before/after values, not a client flag | Don't trust clients | §4 |
| Server: per-project serialized queue; write tmp → sync → atomic replace; publish/broadcast/ack only after completion. **Any repository error exits the process** (crash-only); restart reloads from disk; clients resolve through snapshot + same-ID resend (2026-09-27) | Receipts + same-ID resend already settle the outcome from disk, so in-process recovery was redundant | §7.2, §8 |
| **Receipts** for every accepted ID with payload fingerprint, never expire; matching retry → `ack` only; same ID + different payload → `malformed` | Idempotency survives restart/compaction | §7.2 |
| Separate `changes` (broadcast incl. sender) and `ack` (sender) messages | Ack can settle without reapplying | §7.2, §7.4 |
| Plain-language explanation of id vs seq, version map, broadcast and concurrency cases lives in spec §4.0 — keep it in sync with §4.1/§7 | User asked for it in the document (2026-09-26) | §4.0 |
| Lettered end-to-end walkthrough of one ordinary command (a–s) lives in spec §7.9 — update it whenever §4, §5.7 or §7 change | User asked for it in the document (2026-09-26) | §7.9 |
| `SharedDocument` (client side): `confirmed` + **one outstanding `inFlight`**, no local queue; new document edits blocked until settlement (2026-09-26) | Avoid dependent local edits; camera, selection and presence continue | §7.4 |
| Seq gap / reconnect / open → full snapshot (with version map); resubmit `inFlight` with same ID — also the only way an ack that arrived ahead of confirmed seq gets settled (2026-09-26) | Simple recovery; one path instead of two | §7.2.1, §7.4 |
| One active project per connection; session generation ignores stale events; open is serialized in the project queue | Snapshot then consecutive changes | §7.2.1 |
| Disconnect: block edits, retain one unresolved submission, reconnect clears history; offline editing deferred (2026-09-26) | A queue would reintroduce dependency reconciliation | §7.7 |
| Protocol adds `hello`/`welcome` (identity, colour) and `presenceLeft` (2026-09-27); an unknown project gets `openFailed` (next row) | §7.2.1 described them without message names | §7.2 |
| An unknown project on `openProject` is answered with `openFailed { projectId, generation, message }`, carrying the request's project and generation. The client treats it like a snapshot: it counts only if it matches `workspace.opening`, and then ends the open with its message. `error` stays for list/create requests and for malformed messages that cannot be answered with `rejected`, and the client's `failed` never touches `opening` (2026-09-28) | The earlier `error { requestId: null }` could not be tied to its open: a late one for a missing project cleared `opening`, so the snapshot of the project opened next was dropped. A malformed-message `error` during a pending open did the same (code review) | §7.2, §7.2.1 |
| Server sessions: `hello` first, else the connection closes; `welcome` assigns a colour by join order; a submit for a project the session has not opened → `rejected{unknownProject}`; a submit or presence with a stale generation is ignored; a malformed submit is rejected against the session's current project and generation, otherwise answered with `error { requestId: null }` (2026-09-29) | One simple rule per case; a stale generation is the client's own past, and its same-ID resend follows the new snapshot | §7.2, §7.2.1 |
| Opening leaves the previous subscription at once, outside the queue (others get `presenceLeft`); snapshot and new subscription happen inside the project queue; an unknown project gets `openFailed` with the request's `projectId` and `generation`. Presence bypasses the queue and is not replayed to joiners (2026-09-29) | Snapshot then consecutive changes per generation, with no extra state | §7.2.1 |
| Crash-only covers any error inside a queued server task (project or workspace queue), not only repository errors; after `onFatal` is called once, the app sends nothing more and ignores further input (2026-09-29) | One recovery path: restart, snapshot, same-ID resend | §7.2 |
| Receipt mismatch and the crash-on-save-error branch are explicit in the submit diagram and error summary; no `internal` rejection (2026-09-26; crash-only 2026-09-27) | A save error never becomes a rejection; the disk decides after restart | §7.3, §8 |
| `SharedDocument` is one pure reducer (`document/shared-document.ts`). `visible` is a cache recomputed on every change; an own `changes` drops the overlay because its stamped versions break the edit's expectations, so no extra flag exists. A gap, an unappliable change and an ack ahead of `confirmed.seq` request one snapshot (new generation) unless already syncing (2026-09-29) | Every §7.4 row is one tested transition | §7.4, §9.1 |
| A submission whose message would exceed `MAX_MESSAGE_BYTES` is refused locally with the `rejected{tooLarge}` notice the server would send (2026-09-29) | Above the server's socket frame limit the connection closes, and the same-ID resend after every reconnect would loop | §7.2, §7.4 |
| A late `created` reply only lists the new project when another open has started or a drawing is open (2026-09-29, phase 7 review) | A create reply must not replace a newer open or close a drawing with an outstanding edit | §7.2.1 |

## Don't

- Don't give the local folder the server's contract (`ProjectStore` with ack, "Saving" until the write completes). Superseded 2026-09-26 by local documents with snapshot saving ([open-documents.md](open-documents.md)).
- Don't treat a connection close after a failed or uncertain write as rejection, or keep accepting edits against unresolved state (2026-09-26).
- Don't build in-process recovery for save errors (reload and inspect receipt, `internal` rejection, suspending submissions). Superseded 2026-09-27 by crash-only restart: receipts and the same-ID resend already resolve the outcome from disk.
- Don't queue a second collaborative edit or replay blocked input. The earlier one-in-flight-plus-queue design is superseded to avoid dependent-edit reconciliation (2026-09-26, §7.4).
- Don't hold an ack that arrives ahead of the confirmed seq (no `heldAck` field): ignore it; the same-ID resend after the snapshot gets it again from the receipt. Costs one round trip after a gap (2026-09-26, §7.4).
- Don't call versions "hashes": `lastCs` is the id of the last accepting changeset.
- Don't use `seq` as the entity version: clients don't know it until acceptance, so edits couldn't chain on pending ones.
- Don't use last-writer-wins.
- Don't apply remote changes without the server having validated them.
- Don't cancel an already-submitted change locally; wait for its outcome.
- Don't compact receipts or tombstones (non-goal) — and never in a way that breaks idempotency.
- Don't claim universal power-loss durability; the repository defines completion for its host.
- Don't reapply values from an `ack`.
- Don't answer a request-scoped or generation-scoped operation with an uncorrelated error: a late reply cancels a newer request. Superseded 2026-09-28: `error { requestId: null }` for an unknown project became `openFailed` with the request's project and generation (§7.2).
