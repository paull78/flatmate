import { entityValue, invertPatch, type Document, type DomainPatch } from "@fm/domain";
import {
  assertNever, deepEqual, err, keyOf, ok, patchWrites, uniqueKeys, type EntityKey, type Patch, type Result,
} from "@fm/protocol";
import type { CommitInput, Notice } from "../document/types";

// Spec §7.5; a LocalDocument runs the same code as a plain stack (§7.0).
export type UndoEntry = {
  id: string;
  patch: DomainPatch;
  dependencies: EntityKey[]; // writes + semantic dependencies (entryDependencies); patch.dependencies holds only the semantic ones
  status: "pending" | "usable" | "invalid";
};
export type UndoRequest = { direction: "undo" | "redo"; id: string }; // id = commit ID of the history request
export type HistoryState = {
  past: UndoEntry[];
  future: UndoEntry[];
  pending: UndoRequest | null; // the undo/redo request in flight, not an unconfirmed edit (status "pending")
};
export type CommitInputWithoutId = Omit<CommitInput, "id">;

export const emptyHistory: HistoryState = { past: [], future: [], pending: null };
export const REMOTE_UNDO = "Can't undo: the drawing changed remotely";
export const REMOTE_REDO = "Can't redo: the drawing changed remotely";

/** The value part of a patch, without `before` and `dependencies` (what gets committed). */
export function patchOnly(p: Patch): Patch {
  return { puts: p.puts, deletes: p.deletes };
}

/** Writes plus semantic dependencies; the writes include entities the edit created (inverse dependencies). */
export function entryDependencies(p: DomainPatch): EntityKey[] {
  return uniqueKeys([...patchWrites(p), ...p.dependencies]);
}

/** Commits are blocked while a history request is pending (spec §7.5 step 4); recording one is a programming error. */
export function recordCommit(h: HistoryState, id: string, patch: DomainPatch): HistoryState {
  if (h.pending) throw new Error("commit while a history request is pending");
  const entry: UndoEntry = { id, patch, dependencies: entryDependencies(patch), status: "pending" };
  return { ...h, past: [...h.past, entry], future: [] };
}

/** The entry is still in the undo stack (a rejection in the same step removes it). */
export function hasEntry(h: HistoryState, id: string): boolean {
  return h.past.some((e) => e.id === id);
}

export function isPendingEntry(h: HistoryState, id: string): boolean {
  return h.past.some((e) => e.id === id && e.status === "pending");
}

export function startRequest(h: HistoryState, req: UndoRequest): HistoryState {
  return { ...h, pending: req };
}

export function canUndo(h: HistoryState): boolean {
  return h.pending === null && h.past[h.past.length - 1]?.status === "usable";
}

export function canRedo(h: HistoryState): boolean {
  return h.pending === null && h.future[h.future.length - 1]?.status === "usable";
}

export function prepareUndo(h: HistoryState, doc: Document): Result<CommitInputWithoutId, string> {
  if (h.pending) return err("Waiting for the previous undo");
  const entry = h.past[h.past.length - 1];
  if (!entry) return err("Nothing to undo");
  if (entry.status === "pending") return err("Waiting for server");
  if (entry.status === "invalid" || !matchesAfter(doc, entry.patch)) return err(REMOTE_UNDO);
  return ok({ patch: invertPatch(entry.patch), dependencies: entry.dependencies });
}

export function prepareRedo(h: HistoryState, doc: Document): Result<CommitInputWithoutId, string> {
  if (h.pending) return err("Waiting for the previous undo");
  const entry = h.future[h.future.length - 1];
  if (!entry) return err("Nothing to redo");
  if (entry.status === "invalid" || !matchesBefore(doc, entry.patch)) return err(REMOTE_REDO);
  return ok({ patch: patchOnly(entry.patch), dependencies: entry.dependencies });
}

export function applyHistoryNotice(h: HistoryState, n: Notice): HistoryState {
  switch (n.type) {
    case "accepted":
      return h.pending?.id === n.id ? settleRequest(h, true) : markUsable(h, n.id);
    case "rejected":
      return h.pending?.id === n.id ? settleRequest(h, false) : removeUnconfirmed(h, n.id);
    case "remoteChange":
      return invalidate(h, n.writes, n.topology);
    case "resynced":
      return emptyHistory;
    case "offline":
      return h;
    default:
      return assertNever(n);
  }
}

// Undo checks after-values, redo checks before-values, including absence (spec §7.5 step 2).
function matchesAfter(doc: Document, p: Patch): boolean {
  return (
    p.puts.every((put) => deepEqual(entityValue(doc, { table: put.table, id: put.entity.id }), put.entity)) &&
    p.deletes.every((key) => entityValue(doc, key) === null)
  );
}

function matchesBefore(doc: Document, p: DomainPatch): boolean {
  return p.before.every((b) => deepEqual(entityValue(doc, { table: b.table, id: b.id }), b.value));
}

function markUsable(h: HistoryState, id: string): HistoryState {
  return {
    ...h,
    past: h.past.map((e): UndoEntry => (e.id === id && e.status === "pending" ? { ...e, status: "usable" } : e)),
  };
}

/**
 * A rejected ordinary edit removes its entry, also when a remote change invalidated it while pending
 * (the usual conflict). A usable entry was accepted, so a rejection naming it is stray and is ignored.
 */
function removeUnconfirmed(h: HistoryState, id: string): HistoryState {
  return { ...h, past: h.past.filter((e) => !(e.id === id && e.status !== "usable")) };
}

/** Accepted: move the entry to the other stack unless it was invalidated meanwhile. Rejected: discard it. */
function settleRequest(h: HistoryState, accepted: boolean): HistoryState {
  const req = h.pending;
  if (!req) return h;
  const from = req.direction === "undo" ? h.past : h.future;
  const entry = from[from.length - 1];
  const rest = from.slice(0, -1);
  const moved = accepted && entry && entry.status !== "invalid" ? [entry] : [];
  return req.direction === "undo"
    ? { past: rest, future: [...h.future, ...moved], pending: null }
    : { past: [...h.past, ...moved], future: rest, pending: null };
}

/** By write overlap, never by value; any remote topology change invalidates everything (spec §7.5). */
function invalidate(h: HistoryState, writes: EntityKey[], topology: boolean): HistoryState {
  const written = new Set(writes.map(keyOf));
  const mark = (e: UndoEntry): UndoEntry =>
    topology || e.dependencies.some((k) => written.has(keyOf(k))) ? { ...e, status: "invalid" } : e;
  return { ...h, past: h.past.map(mark), future: h.future.map(mark) };
}
