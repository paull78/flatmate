import type { Document } from "@fm/domain";
import { assertNever } from "@fm/protocol";
import type { ServerEvent } from "../ports/events";
import type { Host } from "../ports/host";
import { localCommit } from "./local-document";
import { sharedCanCommit, sharedCommit, sharedOnEvent, sharedStatus } from "./shared-document";
import type { CommitInput, DocStep, DocumentStatus, OpenDocument } from "./types";

// The only module that switches on document kind (spec §7.0).

export function visibleDoc(d: OpenDocument): Document {
  switch (d.kind) {
    case "local":
      return d.doc;
    case "shared":
      return d.visible;
    default:
      return assertNever(d);
  }
}

export function canCommit(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return true;
    case "shared":
      return sharedCanCommit(d);
    default:
      return assertNever(d);
  }
}

/** Callers check canCommit first; committing while blocked is a programming error. */
export function commit(d: OpenDocument, input: CommitInput): DocStep<OpenDocument> {
  if (!canCommit(d)) throw new Error("commit while the document cannot accept edits");
  switch (d.kind) {
    case "local":
      return localCommit(d, input);
    case "shared":
      return sharedCommit(d, input);
    default:
      return assertNever(d);
  }
}

export function onEvent(d: OpenDocument, event: ServerEvent, host: Host): DocStep<OpenDocument> {
  switch (d.kind) {
    case "local":
      return { doc: d, effects: [], notices: [] }; // a local document never talks to the server
    case "shared":
      return sharedOnEvent(d, event, host);
    default:
      return assertNever(d);
  }
}

export function status(d: OpenDocument): DocumentStatus {
  switch (d.kind) {
    case "local":
      return "not saved"; // saving: none; X1 adds the file statuses
    case "shared":
      return sharedStatus(d);
    default:
      return assertNever(d);
  }
}

/** Work that closing the tab would lose: local commits, or a submission whose outcome is unknown (§7.7). */
export function isDirty(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return d.revision > 0;
    case "shared":
      return d.inFlight !== null;
    default:
      return assertNever(d);
  }
}

/** An edit whose outcome is still unknown; leaving the drawing waits for it (§7.2.1). */
export function hasPendingEdit(d: OpenDocument): boolean {
  switch (d.kind) {
    case "local":
      return false;
    case "shared":
      return d.inFlight !== null;
    default:
      return assertNever(d);
  }
}

/** The server session a document belongs to (presence, stale-event checks); null for local documents. */
export function sessionOf(d: OpenDocument): { projectId: string; generation: string; connected: boolean } | null {
  switch (d.kind) {
    case "local":
      return null;
    case "shared":
      return { projectId: d.project.id, generation: d.generation, connected: d.connection === "connected" };
    default:
      return assertNever(d);
  }
}
