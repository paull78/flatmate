import { execute, toStored, unwrap, validateDocument, type Command, type Document } from "@fm/domain";
import {
  TABLE_NAMES, buildExpectations, deepEqual, emptyVersions, patchWrites, uniqueKeys,
  type Changeset, type Point, type RejectReason, type VersionMap,
} from "@fm/protocol";
import { computeVisible, sharedCommit, withVisible } from "../src/document/shared-document";
import type { CommitInput, SharedDocument } from "../src/document/types";
import type { ServerEvent } from "../src/ports/events";
import { jointAt, roomDoc } from "./builders";

export const PROJECT = { id: "p1", name: "Apartment" };

/** Every entity of `doc` last written by changeset `lastCs`. */
export function versionsFor(doc: Document, lastCs: string): VersionMap {
  const v = emptyVersions();
  for (const id of Object.keys(doc.joints)) v.joints[id] = lastCs;
  for (const id of Object.keys(doc.walls)) v.walls[id] = lastCs;
  for (const id of Object.keys(doc.zoneLabels)) v.zoneLabels[id] = lastCs;
  return v;
}

/** A state the app could reach (spec §9.1): builders run this, and so do scenario folds after every step. */
export function checkConsistent(d: SharedDocument): void {
  if (!deepEqual(d.visible, computeVisible(d))) throw new Error("visible is stale");
  if (!validateDocument(d.confirmed.doc).ok) throw new Error("the confirmed document is invalid");
  for (const table of TABLE_NAMES) {
    for (const id of Object.keys(d.confirmed.doc[table])) {
      if (d.confirmed.versions[table][id] === undefined) throw new Error(`${table}/${id} has no version`);
    }
  }
}

/** A shared document built directly (spec §9.1 "test builders"); defaults: the demo room, seq 42, connected, generation g1. */
export function shared(opts: {
  doc?: Document; versions?: VersionMap; seq?: number; inFlight?: Changeset | null;
  connection?: SharedDocument["connection"]; generation?: string;
} = {}): SharedDocument {
  const doc = opts.doc ?? roomDoc();
  const d = withVisible({
    kind: "shared",
    project: PROJECT,
    generation: opts.generation ?? "g1",
    confirmed: { doc, versions: opts.versions ?? versionsFor(doc, "c0"), seq: opts.seq ?? 42 },
    inFlight: opts.inFlight ?? null,
    connection: opts.connection ?? "connected",
    visible: doc,
  });
  checkConsistent(d);
  return d;
}

/** The commit input a drag of the room's top-right corner to `to` produces. */
export function moveInput(d: SharedDocument, to: Point, id: string): CommitInput {
  const corner = jointAt(d.visible, { x: 6, y: 4 });
  const r = unwrap(execute(d.visible, { type: "moveJoints", moves: [{ jointId: corner, to }] }));
  return { id, patch: { puts: r.patch.puts, deletes: r.patch.deletes }, dependencies: r.patch.dependencies };
}

/** `d` with one outstanding edit: the corner moved to `to` as changeset `id`. */
export function pending(d: SharedDocument = shared(), to: Point = { x: 6, y: 4.6 }, id = "c1"): SharedDocument {
  const next = sharedCommit(d, moveInput(d, to, id)).doc;
  checkConsistent(next);
  return next;
}

export function inFlightOf(d: SharedDocument): Changeset {
  if (!d.inFlight) throw new Error("nothing in flight");
  return d.inFlight;
}

/** A changeset built the way a client builds one: execute on `doc`, expectations from `versions`. */
export function changesetFor(doc: Document, versions: VersionMap, cmd: Command, id: string): Changeset {
  const r = unwrap(execute(doc, cmd));
  const keys = uniqueKeys([...patchWrites(r.patch), ...r.patch.dependencies]);
  return { id, patch: { puts: r.patch.puts, deletes: r.patch.deletes }, expect: buildExpectations(versions, keys) };
}

type Ev<T extends ServerEvent["type"]> = Extract<ServerEvent, { type: T }>;

/** Server events addressed to `d` (its project and, by default, its generation). */
export const ev = {
  changes(d: SharedDocument, changeset: Changeset, seq: number, clientId = "bob", generation = d.generation): Ev<"changes"> {
    return { type: "changes", projectId: PROJECT.id, generation, seq, changeset, clientId };
  },
  ack(d: SharedDocument, changesetId: string, seq: number, generation = d.generation): Ev<"ack"> {
    return { type: "ack", projectId: PROJECT.id, generation, changesetId, seq };
  },
  rejected(d: SharedDocument, changesetId: string, reason: RejectReason, generation = d.generation): Ev<"rejected"> {
    return { type: "rejected", projectId: PROJECT.id, generation, changesetId, reason };
  },
  snapshot(d: SharedDocument, over: { doc?: Document; versions?: VersionMap; seq?: number; generation?: string } = {}): Ev<"snapshot"> {
    return {
      type: "snapshot",
      projectId: PROJECT.id,
      generation: over.generation ?? d.generation,
      meta: PROJECT,
      doc: toStored(over.doc ?? d.confirmed.doc),
      versions: over.versions ?? d.confirmed.versions,
      seq: over.seq ?? d.confirmed.seq,
    };
  },
};
