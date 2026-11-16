import { sheetsOf } from "@fm/domain";
import { runCommand } from "../commit";
import { canCommit, visibleDoc } from "../document/open-document";
import type { Effect } from "../ports/effects";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { withDraft, type ReportDraft } from "./report-draft";

// What the report's box does (sheetset.07, .14; AC-03): each change is this viewer's draft, with no command, and leaving
// the box is one `setSheet`. Anything else that takes the box away goes through `flushReportDrafts`, so typed text never depends on a blur.

/** A change in the box. Typing on after leaving starts a new draft from what's stored now, whatever the old answer turns out to be. */
export function typeReport(state: EditorState, id: string, text: string): EditorState {
  if (!state.document) return state;
  const stored = sheetsOf(visibleDoc(state.document)).find((s) => s.id === id)?.text;
  if (stored === undefined) return state;
  const known = state.reportDrafts[id];
  const open = known && known.sent === null && !known.held ? known : null;
  const draft: ReportDraft = { text, base: open?.base ?? stored, sent: null, held: false, overtaken: open?.overtaken ?? false };
  return { ...state, reportDrafts: withDraft(state.reportDrafts, id, draft) };
}

/** Commits a draft that isn't already on its way. A local document's answer comes within the command; a server's later, by `draftAccepted` or `draftRefused`. */
export function leaveReport(state: EditorState, id: string, host: Host): Step {
  const draft = state.reportDrafts[id];
  if (!draft || draft.sent !== null || !state.document) return { state, effects: [] };
  const stored = sheetsOf(visibleDoc(state.document)).find((s) => s.id === id)?.text;
  if (stored === undefined || stored === draft.text) return { state: { ...state, reportDrafts: withDraft(state.reportDrafts, id, null) }, effects: [] };
  const out = runCommand(state, { type: "setSheet", sheetId: id, text: draft.text }, host);
  const now = out.state.document;
  const landed = now !== null && sheetsOf(visibleDoc(now)).find((s) => s.id === id)?.text === draft.text;
  const next = !landed ? { ...draft, held: true } : now && canCommit(now) ? null : { ...draft, sent: out.committed, held: false };
  return { state: { ...out.state, reportDrafts: withDraft(out.state.reportDrafts, id, next) }, effects: out.effects };
}

/** Every draft gets its try, as the view closes or the selection moves. What can't be saved stays for when the view is next open. */
export function flushReportDrafts(state: EditorState, host: Host): Step {
  let next = state;
  const effects: Effect[] = [];
  for (const id of Object.keys(state.reportDrafts)) {
    const r = leaveReport(next, id, host);
    next = r.state;
    effects.push(...r.effects);
  }
  return { state: next, effects };
}

/** Back to the plan. */
export function closeSheetsView(state: EditorState, host: Host): Step {
  const flushed = flushReportDrafts(state, host);
  return { state: { ...flushed.state, exportOpen: false }, effects: flushed.effects };
}
