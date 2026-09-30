import type { Document } from "@fm/domain";
import type { Changeset, EntityKey, Patch, RejectReason, VersionMap } from "@fm/protocol";
import type { Effect } from "../ports/effects";
import type { ProjectInfo } from "../types";

// Spec §7.0. Tools, gestures, history and the ViewModel react to notices.
export type Notice =
  | { type: "accepted"; id: string }
  | { type: "rejected"; id: string; reason: RejectReason }
  | { type: "remoteChange"; writes: EntityKey[]; topology: boolean }
  | { type: "resynced" }
  | { type: "offline" };

export type CommitInput = { id: string; patch: Patch; dependencies: EntityKey[] };

export type DocumentStatus =
  | "not saved" | "unsaved changes" | "saving" | "saved" | "save failed" | "waiting for server" | "offline";

export type DocStep<D> = { doc: D; effects: Effect[]; notices: Notice[] };

export type LocalDocument = {
  kind: "local";
  project: ProjectInfo;
  openId: string; // fresh per open
  doc: Document; // the truth
  revision: number; // +1 on every commit, undo and redo
  saving: { kind: "none" }; // X1 adds { kind: "file", … }
};

// Spec §7.4: the server is the truth; `confirmed` mirrors it and one edit at most is outstanding.
export type SharedDocument = {
  kind: "shared";
  project: ProjectInfo;
  generation: string; // §7.2.1: fresh for every open, reconnect and resync
  confirmed: { doc: Document; versions: VersionMap; seq: number };
  inFlight: Changeset | null; // no local queue
  connection: "connected" | "syncing" | "offline";
  visible: Document; // cache: confirmed ⊕ inFlight while its expectations hold and the result validates
};

export type OpenDocument = LocalDocument | SharedDocument;
