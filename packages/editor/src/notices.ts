import { invariantsMessage } from "@fm/domain";
import { assertNever, type RejectReason } from "@fm/protocol";
import type { Notice } from "./document/types";
import { cancelGestures, endChainOnRejection, onRemoteChange, resumeChain } from "./gestures";
import { applyHistoryNotice } from "./history/history";
import type { Effect } from "./ports/effects";
import type { Host } from "./ports/host";
import { pruneSelection, type EditorState, type Step } from "./state";
import { showToast } from "./toast";

/** For each notice in order: history first, then tools, so history is settled before tools react (spec §7.0). */
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

/** Tools react through gestures.ts: resume or end a paused chain (§5.5), cancel or rerun gestures (§5.7). */
function toolNotice(state: EditorState, n: Notice, host: Host): Step {
  switch (n.type) {
    case "accepted":
      return resumeChain(state, n.id, host);
    case "rejected":
      return showToast(endChainOnRejection(state, n.id), rejectMessage(n.reason), host);
    case "remoteChange":
      return onRemoteChange(state, n.writes, n.topology, host);
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
      return "Someone else changed this first";
    case "invalid": {
      // The server formats each violation as "<invariant>: <message>", e.g. "I5: walls cross".
      const ids = new Set(reason.violations.map((v) => (v.split(":")[0] ?? "").trim()));
      return invariantsMessage(ids) ?? "Rejected: the drawing would become invalid";
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
