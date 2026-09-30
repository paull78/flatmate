import { applyPatch, emptyDocument, type Document } from "@fm/domain";
import type { ProjectInfo } from "../types";
import type { CommitInput, DocStep, LocalDocument } from "./types";

export function createLocalDocument(project: ProjectInfo, openId: string, doc: Document = emptyDocument()): LocalDocument {
  return { kind: "local", project, openId, doc, revision: 0, saving: { kind: "none" } };
}

/**
 * Accepted at once and never rejected: callers validate every patch first (execute for commands,
 * runHistory's tentative check for undo and redo) and nobody else writes to a local document
 * (spec §7.0). A patch that fails to apply is a programming error.
 */
export function localCommit(d: LocalDocument, input: CommitInput): DocStep<LocalDocument> {
  const next = applyPatch(d.doc, input.patch);
  if (!next.ok) throw new Error(`Local commit ${input.id} failed: ${next.error.message}`);
  return {
    doc: { ...d, doc: next.value, revision: d.revision + 1 },
    effects: [],
    notices: [{ type: "accepted", id: input.id }],
  };
}
