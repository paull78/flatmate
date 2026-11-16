import { sheetsOf } from "@fm/domain";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { showToast } from "../toast";
import { CLASH_TEXT } from "../toast-text";

// A report being written (sheetset.07, .14): this viewer's draft, per sheet. The page reads it and nothing's sent until
// the box is left, so its text is one undo step. It stays until the server has the text, so a refusal loses nothing.

export type ReportDraft = {
  text: string;
  base: string; // the stored text this draft last knew of: a change to it is said once
  sent: string | null; // the commit waiting for its answer
  held: boolean; // left, and not saved: refused or blocked
  overtaken: boolean; // another changed the stored text since, so leaving replaces theirs
};
export const OVERTAKEN_NOTE = "Someone else changed this report. When you leave the box, your text replaces theirs, and ⌘Z brings theirs back.";

export type ReportDrafts = Readonly<Record<string, ReportDraft>>;

/** The drafts with one replaced, or gone when null. */
export function withDraft(drafts: ReportDrafts, id: string, draft: ReportDraft | null): ReportDrafts {
  if (draft !== null) return { ...drafts, [id]: draft };
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== id));
}

const entryOf = (state: EditorState, commit: string): [string, ReportDraft] | undefined => Object.entries(state.reportDrafts).find(([, d]) => d.sent === commit);

/** The server has the text, so the stored row now says what the draft did. Words typed since aren't waiting on this answer. */
export function draftAccepted(state: EditorState, commit: string): EditorState {
  const entry = entryOf(state, commit);
  return entry ? { ...state, reportDrafts: withDraft(state.reportDrafts, entry[0], null) } : state;
}

/** Refused: the text stays in the box and on the page, for another try. */
export function draftRefused(state: EditorState, commit: string): EditorState {
  const entry = entryOf(state, commit);
  return entry ? { ...state, reportDrafts: withDraft(state.reportDrafts, entry[0], { ...entry[1], sent: null, held: true }) } : state;
}

/**
 * Another's edit. A sheet that went takes its draft. A draft keeps its words through a change to its text, as Claude can
 * write while a person types and it can be hours of typing: the toast says so once, the box's note until leaving (sheetset.72), and leaving sends it, last writer wins.
 * One sent or refused was told already, by its answer. Unlike a title's `DraftInput`, which gives way.
 */
export function draftsOnRemoteChange(state: EditorState, host: Host): Step {
  const entries = Object.entries(state.reportDrafts);
  if (entries.length === 0 || !state.document) return { state, effects: [] };
  const sheets = sheetsOf(visibleDoc(state.document));
  let changed = false;
  let told = false;
  const kept = entries.flatMap(([id, d]): [string, ReportDraft][] => {
    const text = sheets.find((s) => s.id === id)?.text;
    if (text === undefined) {
      changed = true;
      return [];
    }
    if (d.sent !== null || d.held || text === d.base) return [[id, d]];
    changed = true;
    told ||= text !== d.text;
    return [[id, { ...d, base: text, overtaken: text !== d.text }]];
  });
  if (!changed) return { state, effects: [] };
  const next: EditorState = { ...state, reportDrafts: Object.fromEntries(kept) };
  return told ? showToast(next, CLASH_TEXT, host) : { state: next, effects: [] };
}
