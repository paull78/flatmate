import { applyPatch, execute, topologyMessage, validateDocument, type Command } from "@fm/domain";
import { patchWrites } from "@fm/protocol";
import { canCommit, commit, status, visibleDoc } from "./document/open-document";
import type { DocStep, OpenDocument } from "./document/types";
import { patchOnly, prepareRedo, prepareUndo, recordCommit, startRequest } from "./history/history";
import { applyNotices } from "./notices";
import type { Host } from "./ports/host";
import { pruneSelection, type EditorState, type Step } from "./state";
import { showToast } from "./toast";

// committed: the commit ID, or null when nothing was committed. Set even if the document rejects the commit in
// the same step (phase 7's local tooLarge guard); callers that need an accepted edit check history (phase 7's hasEntry).
export type CommandOutcome = Step & { committed: string | null };

export function blockedMessage(d: OpenDocument): string {
  return status(d) === "offline" ? "Offline: editing resumes when the connection returns" : "Waiting for server";
}

/** execute → commit → history → notices. The only way tools change the document. */
export function runCommand(state: EditorState, cmd: Command, host: Host): CommandOutcome {
  const d = state.document;
  if (!d) return { state, effects: [], committed: null };
  if (!canCommit(d)) return { ...showToast(state, blockedMessage(d), host), committed: null };
  const r = execute(visibleDoc(d), cmd);
  if (!r.ok) return { ...showToast(state, r.error.message, host), committed: null };
  if (patchWrites(r.value.patch).length === 0) return { state, effects: [], committed: null }; // nothing changed
  const id = host.newId();
  const step = commit(d, { id, patch: patchOnly(r.value.patch), dependencies: r.value.patch.dependencies });
  const recorded: EditorState = { ...state, undo: recordCommit(state.undo, id, r.value.patch) };
  return { ...finishCommit(recorded, step, host), committed: id };
}

/** Undo or redo as a history request: value check, local validation, commit (spec §7.5 steps 1–4). */
export function runHistory(state: EditorState, direction: "undo" | "redo", host: Host): Step {
  const d = state.document;
  if (!d) return { state, effects: [] };
  if (!canCommit(d)) return showToast(state, blockedMessage(d), host);
  const doc = visibleDoc(d);
  const prepared = direction === "undo" ? prepareUndo(state.undo, doc) : prepareRedo(state.undo, doc);
  if (!prepared.ok) return showToast(state, prepared.error, host);
  const tentative = applyPatch(doc, prepared.value.patch);
  if (!tentative.ok) return showToast(state, tentative.error.message, host);
  const valid = validateDocument(tentative.value);
  if (!valid.ok) return showToast(state, topologyMessage(valid.error), host);
  const id = host.newId();
  const step = commit(d, { id, ...prepared.value });
  return finishCommit({ ...state, undo: startRequest(state.undo, { direction, id }) }, step, host);
}

function finishCommit(state: EditorState, step: DocStep<OpenDocument>, host: Host): Step {
  const after = applyNotices({ ...state, document: step.doc }, step.notices, host);
  return { state: pruneSelection(after.state), effects: [...step.effects, ...after.effects] };
}
