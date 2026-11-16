import { MESSAGES, invariantsMessage } from "@fm/domain";
import { assertNever, type RejectReason } from "@fm/protocol";
import type { Notice } from "./document/types";
import { cancelGestures, endChainOnRejection, endPieceEditOnRejection, endScaleOnRejection, onRemoteChange, resumeChain } from "./gestures";
import { draftAccepted, draftRefused, draftsOnRemoteChange } from "./export/report-draft";
import { applyHistoryNotice } from "./history/history";
import type { Effect } from "./ports/effects";
import type { Host } from "./ports/host";
import { pruneSelection, type EditorState, type Step } from "./state";
import { showToast } from "./toast";
import { CLASH_TEXT } from "./toast-text";

/** For each notice in order: history first, then tools, so history is settled before tools react (spec: collaboration). */
export function applyNotices(state: EditorState, notices: Notice[], host: Host): Step {
  let s = state;
  const effects: Effect[] = [];
  for (const n of notices) {
    s = { ...s, undo: applyHistoryNotice(s.undo, n) };
    const r = toolNotice(s, n, host);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: pruneSelection(s), effects };
}

/** Tools react through gestures.ts: resume or end a paused chain (spec: wall-editing), cancel or rerun gestures (spec: tools). */
function toolNotice(state: EditorState, n: Notice, host: Host): Step {
  switch (n.type) {
    case "accepted":
      return resumeChain(draftAccepted(state, n.id), n.id, host);
    case "rejected":
      return showToast(draftRefused(endPieceEditOnRejection(endScaleOnRejection(endChainOnRejection(state, n.id))), n.id), rejectMessage(n.reason), host);
    case "remoteChange": {
      const drafts = draftsOnRemoteChange(state, host);
      const tools = onRemoteChange(drafts.state, n.writes, n.topology, host);
      return { state: tools.state, effects: [...drafts.effects, ...tools.effects] };
    }
    case "resynced":
      return cancelGestures(state, "snapshot", host);
    case "offline":
      return cancelGestures(state, "offline", host);
    default:
      return assertNever(n);
  }
}

export function rejectMessage(reason: RejectReason): string {
  switch (reason.kind) {
    case "conflict":
      return CLASH_TEXT;
    case "invalid": {
      // The server formats each violation as "<invariant>: <message>", e.g. "I5: walls cross".
      const ids = new Set(reason.violations.map((v) => (v.split(":")[0] ?? "").trim()));
      return invariantsMessage(ids) ?? MESSAGES.invalid; // the local fallback's text too (cleanup.09)
    }
    case "malformed":
      return "The server refused a malformed change";
    case "tooLarge":
      return "The change is too large";
    case "unknownProject":
      return "The project no longer exists";
    default:
      return assertNever(reason);
  }
}
