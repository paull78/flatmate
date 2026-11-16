import type { EntityKey } from "@fm/protocol";
import { holeView, isValidId } from "@fm/domain";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { showToast } from "../toast";
import { gapCommand } from "./hole-edit";
import type { SelectToolState } from "./types";
import { cantRead, editedValue, readValue } from "../typed-value";

// Typing a hole's gap (stairwell.36), as the helper's value field (helper-edit.ts): digits, a point and Backspace edit,
// Enter or Space applies one setDeckHole, Esc cancels (selectEscape). A gone hole ends the edit.

type Editing = Extract<SelectToolState, { kind: "editingGap" }>;

/** The gap's value field. Returns null for keys it does not capture. */
export function gapKey(state: EditorState, tool: Editing, key: string, host: Host): Step | null {
  const value = editedValue(tool.value, key);
  if (value === null && key !== "Enter") return null;
  const doc = state.document && visibleDoc(state.document);
  if (!doc || !isValidId(tool.holeId) || !holeView(doc, tool.holeId)) return { state: withSelect(state, { kind: "idle" }), effects: [] };
  return value === null ? apply(state, tool, host) : { state: withSelect(state, { ...tool, value }), effects: [] };
}

/** A bad number keeps editing; any other outcome ends it and keeps the selection. A gap may be 0 (flush). */
function apply(state: EditorState, tool: Editing, host: Host): Step {
  const idle = withSelect(state, { kind: "idle" });
  if (tool.value === "") return { state: idle, effects: [] };
  const value = readValue(tool.value, "metres");
  if (value === null) return showToast(state, cantRead(tool.value), host);
  if (value < 0) return showToast(state, "Type a length in metres", host);
  const command = state.document && gapCommand(visibleDoc(state.document), tool.holeId, tool.side, value);
  return command ? runCommand(idle, command, host) : { state: idle, effects: [] };
}

/** What a gap edit reads: its hole and its deck; a remote change to either cancels it. */
export function gapDependencies(state: EditorState, holeId: string): EntityKey[] {
  const hole = state.document ? visibleDoc(state.document).deckHoles[holeId] : undefined;
  return [{ table: "deckHoles", id: holeId }, ...(hole ? [{ table: "decks" as const, id: hole.deck }] : [])];
}

function withSelect(state: EditorState, tool: SelectToolState): EditorState {
  return { ...state, tool: { name: "select", state: tool } };
}
