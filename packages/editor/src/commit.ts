import { applyPatch, execute, isFloor, topologyMessage, validateDocument, type Command, type Document, type DomainError, type DomainPatch, type Violation } from "@fm/domain";
import { patchWrites } from "@fm/protocol";
import { canCommit, commit, status, visibleDoc } from "./document/open-document";
import type { DocStep, OpenDocument } from "./document/types";
import { dropRefused, isRemoteRefusal, patchOnly, prepareRedo, prepareUndo, recordCommit, startRequest } from "./history/history";
import { applyNotices } from "./notices";
import type { Host } from "./ports/host";
import { activeStateId, pruneSelection, viewedLevelOn, type EditorState, type Step } from "./state";
import { refuse, showToast } from "./toast";
import { openingText, refusalText } from "./toast-text";
import { placeNote } from "./link-note";
import { viewAt } from "./view/plan-view";
import { warningCount } from "./view/warnings";

// committed: the commit ID, or null when nothing was committed. Set even if the document rejects the commit in
// the same step (phase 7's local tooLarge guard); callers that need an accepted edit check history (phase 7's hasEntry).
// patch: the committed edit's patch, for the ids it created (cleanup step 09); null when nothing was committed.
export type CommandOutcome = Step & { committed: string | null; patch: DomainPatch | null };

export function blockedMessage(d: OpenDocument): string {
  return status(d) === "offline" ? "Offline: editing resumes when the connection returns" : "Waiting for server";
}

/** A refusal naming the layout in view when the edit breaks it there too, not the first layout by ID (stairdraw.54). */
function inViewFirst(error: DomainError, doc: Document, layout: string | null): DomainError {
  const here = (v: Violation): boolean => v.entities.some((e) => e.table === "placements" && doc.placements[e.id]?.state === layout);
  if (!error.violations.some(here)) return error;
  const violations = [...error.violations.filter(here), ...error.violations.filter((v) => !here(v))];
  return { ...error, violations, message: topologyMessage(violations) };
}

/** execute → commit → history → notices. The only way tools change the document. A refusal toasts in plain words. */
export function runCommand(state: EditorState, cmd: Command, host: Host): CommandOutcome {
  const d = state.document;
  if (!d) return { state, effects: [], committed: null, patch: null };
  if (!canCommit(d)) return { ...showToast(state, blockedMessage(d), host), committed: null, patch: null };
  const r = execute(visibleDoc(d), cmd);
  if (!r.ok) {
    return { ...refuse(state, refusalText(inViewFirst(r.error, visibleDoc(d), activeStateId(state)), visibleDoc(d), cmd), host), committed: null, patch: null };
  }
  if (patchWrites(r.value.patch).length === 0) return { state, effects: [], committed: null, patch: null }; // nothing changed
  const id = host.newId();
  const step = commit(d, { id, patch: patchOnly(r.value.patch), dependencies: r.value.patch.dependencies });
  const warningBlink = state.warningBlink + (raisesWarnings(state, visibleDoc(d), visibleDoc(step.doc)) ? 1 : 0);
  // An edit that goes through ends an earlier refusal's toast (stairdraw.54).
  const recorded: EditorState = { ...state, toast: null, undo: recordCommit(state.undo, id, r.value.patch), warningBlink };
  const done = finishCommit(recorded, step, host);
  const note = placeNote(visibleDoc(d), r.value.doc, cmd, activeStateId(state)); // "Only in Day: …" (review.06)
  const noted = note === null ? done : showToast(done.state, note, host);
  return { state: noted.state, effects: note === null ? done.effects : [...done.effects, ...noted.effects], committed: id, patch: r.value.patch };
}

/**
 * Whether this edit raises the count at the layout and level in view before it (clarity.02). Only own edits reach here:
 * undo, redo and remote changes don't, and a drag's preview isn't committed. A deleted layout can't raise it, its pieces
 * being gone. "After" goes last: the scene reads it next, and the owner keeps one result (clarity.12).
 */
function raisesWarnings(state: EditorState, before: Document, after: Document): boolean {
  const layout = activeStateId(state);
  const from = viewedLevelOn(state, before);
  const to = viewedLevelOn(state, after);
  if (isFloor(from) !== isFloor(to)) return false; // the viewed deck went, so the view falls to another level
  const was = warningCount(before, viewAt(layout, from));
  return warningCount(after, viewAt(layout, to)) > was;
}

/** Undo or redo as a history request: value check, local validation, commit (spec: collaboration steps 1–4). */
export function runHistory(state: EditorState, direction: "undo" | "redo", host: Host): Step {
  const d = state.document;
  if (!d) return { state, effects: [] };
  if (!canCommit(d)) return showToast(state, blockedMessage(d), host);
  const doc = visibleDoc(d);
  const prepared = direction === "undo" ? prepareUndo(state.undo, doc) : prepareRedo(state.undo, doc);
  if (!prepared.ok) {
    const undo = isRemoteRefusal(prepared.error) ? dropRefused(state.undo, direction) : state.undo;
    return showToast({ ...state, undo }, prepared.error, host);
  }
  const tentative = applyPatch(doc, prepared.value.patch);
  if (!tentative.ok) return showToast(state, tentative.error.message, host);
  const valid = validateDocument(tentative.value);
  if (!valid.ok) return showToast(state, openingText(valid.error, tentative.value, null) ?? topologyMessage(valid.error), host);
  const id = host.newId();
  const step = commit(d, { id, ...prepared.value });
  return finishCommit({ ...state, undo: startRequest(state.undo, { direction, id }) }, step, host);
}

function finishCommit(state: EditorState, step: DocStep<OpenDocument>, host: Host): Step {
  const after = applyNotices({ ...state, document: step.doc }, step.notices, host);
  return { state: pruneSelection(after.state), effects: [...step.effects, ...after.effects] };
}
