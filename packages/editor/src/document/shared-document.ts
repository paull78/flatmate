import { applyPatch, changesTopology, fromStored, validateDocument, type Document } from "@fm/domain";
import {
  MAX_MESSAGE_BYTES, assertNever, buildExpectations, failedExpectations, patchWrites, stampVersions, uniqueKeys, utf8Length,
  type Changeset,
} from "@fm/protocol";
import type { Effect } from "../ports/effects";
import type { ServerEvent } from "../ports/events";
import type { Host } from "../ports/host";
import type { CommitInput, DocStep, DocumentStatus, SharedDocument } from "./types";

// Spec §7.4 as a pure reducer: network and timers are effects out and events in (§9.1).

export type SnapshotEvent = Extract<ServerEvent, { type: "snapshot" }>;
type Step = DocStep<SharedDocument>;
type ProjectEvent = Extract<ServerEvent, { type: "snapshot" | "changes" | "ack" | "rejected" }>;

function same(d: SharedDocument): Step {
  return { doc: d, effects: [], notices: [] };
}

/** The first snapshot for the generation being opened creates the document (spec §7.0). */
export function sharedFromSnapshot(e: SnapshotEvent): SharedDocument {
  const doc = parseSnapshot(e);
  return withVisible({
    kind: "shared",
    project: { id: e.meta.id, name: e.meta.name },
    generation: e.generation,
    confirmed: { doc, versions: e.versions, seq: e.seq },
    inFlight: null,
    connection: "connected",
    visible: doc,
  });
}

/** visible = confirmed ⊕ inFlight, only while its expectations hold and the result validates (spec §7.4). */
export function computeVisible(d: SharedDocument): Document {
  const cs = d.inFlight;
  if (!cs || failedExpectations(d.confirmed.versions, cs.expect).length > 0) return d.confirmed.doc;
  const applied = applyPatch(d.confirmed.doc, cs.patch);
  return applied.ok && validateDocument(applied.value).ok ? applied.value : d.confirmed.doc;
}

export function withVisible(d: SharedDocument): SharedDocument {
  return { ...d, visible: computeVisible(d) };
}

/** Connected, synchronized and nothing outstanding (spec §7.4). */
export function sharedCanCommit(d: SharedDocument): boolean {
  return d.connection === "connected" && d.inFlight === null;
}

export function sharedStatus(d: SharedDocument): DocumentStatus {
  if (d.connection === "offline") return "offline";
  return d.connection === "syncing" || d.inFlight !== null ? "waiting for server" : "saved";
}

/**
 * One outstanding edit (spec §7.4): expectations from the confirmed versions, which equal the visible ones
 * because nothing is pending, for every write and semantic dependency. A submission too large to send is
 * refused here with the rejection the server would give (§7.2); above the socket's frame limit the server
 * would close the connection, and the same-ID resend after reconnecting would repeat that forever.
 * A submitted commit always returns a new object (undoRedo tells applied from refused by identity).
 */
export function sharedCommit(d: SharedDocument, input: CommitInput): Step {
  const keys = uniqueKeys([...patchWrites(input.patch), ...input.dependencies]);
  const changeset: Changeset = { id: input.id, patch: input.patch, expect: buildExpectations(d.confirmed.versions, keys) };
  const submit = submitEffect(d, changeset);
  if (utf8Length(JSON.stringify(submit)) > MAX_MESSAGE_BYTES) {
    return { doc: d, effects: [], notices: [{ type: "rejected", id: input.id, reason: { kind: "tooLarge" } }] };
  }
  return { doc: withVisible({ ...d, inFlight: changeset }), effects: [submit], notices: [] };
}

/** One transition per row of the §7.4 table. */
export function sharedOnEvent(d: SharedDocument, e: ServerEvent, host: Host): Step {
  switch (e.type) {
    case "connection":
      return e.state === "open" ? requestSnapshot(d, host) : disconnected(d);
    case "welcome":
    case "openFailed":
    case "projectDeleted":
    case "presence":
    case "presenceLeft":
      return same(d); // identity, failed opens and presence belong to the session (session.ts)
    case "snapshot":
    case "changes":
    case "ack":
    case "rejected":
      // Events of an older open, connection or resync are ignored (spec §7.2.1).
      return e.projectId === d.project.id && e.generation === d.generation ? projectEvent(d, e, host) : same(d);
    default:
      return assertNever(e);
  }
}

function projectEvent(d: SharedDocument, e: ProjectEvent, host: Host): Step {
  switch (e.type) {
    case "snapshot":
      return onSnapshot(d, e);
    case "changes":
      return onChanges(d, e, host);
    case "ack":
      return onAck(d, e, host);
    case "rejected":
      return onRejected(d, e);
    default:
      return assertNever(e);
  }
}

/** Replace confirmed; resend the outstanding edit with the same ID. If the snapshot contains it, the receipt acks it (§7.4). */
function onSnapshot(d: SharedDocument, e: SnapshotEvent): Step {
  const next = withVisible({
    ...d,
    project: { id: e.meta.id, name: e.meta.name },
    confirmed: { doc: parseSnapshot(e), versions: e.versions, seq: e.seq },
    connection: "connected",
  });
  return { doc: next, effects: next.inFlight ? [submitEffect(next, next.inFlight)] : [], notices: [{ type: "resynced" }] };
}

function onChanges(d: SharedDocument, e: Extract<ServerEvent, { type: "changes" }>, host: Host): Step {
  if (e.seq <= d.confirmed.seq) return same(d); // duplicate
  if (e.seq !== d.confirmed.seq + 1) return resync(d, host); // a gap: changes were missed
  const patch = e.changeset.patch;
  const applied = applyPatch(d.confirmed.doc, patch);
  if (!applied.ok) return resync(d, host); // the mirror disagrees with the server: start again from a snapshot
  const next = withVisible({
    ...d,
    confirmed: { doc: applied.value, versions: stampVersions(d.confirmed.versions, patch, e.changeset.id), seq: e.seq },
  });
  if (d.inFlight?.id === e.changeset.id) return same(next); // own change: tracked until its ack
  return {
    doc: next,
    effects: [],
    notices: [{ type: "remoteChange", writes: patchWrites(patch), topology: changesTopology(d.confirmed.doc, patch) }],
  };
}

function onAck(d: SharedDocument, e: Extract<ServerEvent, { type: "ack" }>, host: Host): Step {
  if (d.inFlight?.id !== e.changesetId) return same(d); // unrelated: never settles another submission
  // Ahead of confirmed.seq: changes were missed. The same-ID resend after the snapshot gets the ack again (§7.4).
  if (e.seq > d.confirmed.seq) return resync(d, host);
  return { doc: withVisible({ ...d, inFlight: null }), effects: [], notices: [{ type: "accepted", id: e.changesetId }] };
}

function onRejected(d: SharedDocument, e: Extract<ServerEvent, { type: "rejected" }>): Step {
  if (d.inFlight?.id !== e.changesetId) return same(d);
  return {
    doc: withVisible({ ...d, inFlight: null }),
    effects: [],
    notices: [{ type: "rejected", id: e.changesetId, reason: e.reason }],
  };
}

/** Ask for a snapshot unless one is already pending (gap, early ack, unappliable change). */
function resync(d: SharedDocument, host: Host): Step {
  return d.connection === "syncing" ? same(d) : requestSnapshot(d, host);
}

/** Reopen under a new generation; older events are then ignored (§7.2.1). */
function requestSnapshot(d: SharedDocument, host: Host): Step {
  const generation = host.newId();
  return {
    doc: { ...d, generation, connection: "syncing" },
    effects: [{ type: "workspace", op: { type: "open", projectId: d.project.id, generation } }],
    notices: [],
  };
}

/** Keep the outstanding edit unresolved; block edits; gestures cancel once (§7.7). */
function disconnected(d: SharedDocument): Step {
  if (d.connection === "offline") return same(d);
  return { doc: { ...d, connection: "offline" }, effects: [], notices: [{ type: "offline" }] };
}

function submitEffect(d: SharedDocument, changeset: Changeset): Effect {
  return { type: "submit", projectId: d.project.id, generation: d.generation, changeset };
}

function parseSnapshot(e: SnapshotEvent): Document {
  const parsed = fromStored(e.doc);
  // The server validated every accepted changeset, so a malformed snapshot is a bug: fail fast (spec §8).
  if (!parsed.ok) throw new Error(`Malformed snapshot for ${e.projectId}: ${parsed.error.message}`);
  return parsed.value;
}
