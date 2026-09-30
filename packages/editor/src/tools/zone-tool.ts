import { faceAt, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import type { EditorState, Step } from "../state";
import { tagAt } from "../view/tags";
import { labelAtFloor } from "./hit-test";
import type { ZoneToolState } from "./types";

/** Spec §3.6, §5.6: hovering highlights a room; a click selects its zone, labelling an unlabelled room first. */
export function zonePointer(state: EditorState, tool: ZoneToolState, e: PointerInput, host: Host): Step {
  const pointer = state.pointer;
  if (!state.document || !pointer) return { state, effects: [] };
  const doc = visibleDoc(state.document);
  switch (e.type) {
    case "pointerMove": {
      const hoverFaceKey = faceAt(doc, pointer.world)?.key ?? null;
      return { state: withZone({ ...state, snap: null, hover: null }, { ...tool, hoverFaceKey }), effects: [] };
    }
    case "pointerDown":
      return clickZone(state, doc, pointer.world, host);
    case "pointerUp":
      return { state, effects: [] };
    default:
      return assertNever(e.type);
  }
}

/** Properties-panel edits (`ui setField`): the selected zone's `name` renames it (spec §5.6); other fields are read-only. */
export function setField(state: EditorState, fieldId: string, value: string, host: Host): Step {
  const ref = state.selection[0];
  if (fieldId !== "name" || !ref || ref.table !== "zoneLabels") return { state, effects: [] };
  const out = runCommand(state, { type: "renameZone", id: ref.id, name: value }, host);
  return { state: out.state, effects: out.effects };
}

function clickZone(state: EditorState, doc: Document, world: Point, host: Host): Step {
  const existing = tagAt(doc, world, state.camera, host) ?? labelAtFloor(doc, world);
  if (existing) return { state: select(state, existing), effects: [] };
  if (!faceAt(doc, world)) return { state, effects: [] }; // outside every room, or on a boundary (spec §3.6)
  const id = host.newId();
  const name = `Room ${Object.keys(doc.zoneLabels).length + 1}`;
  const out = runCommand(state, { type: "labelZone", id, at: world, name }, host);
  if (out.committed === null) return { state: out.state, effects: out.effects }; // refused: the toast explains why
  return { state: select(out.state, id), effects: out.effects };
}

function select(state: EditorState, labelId: string): EditorState {
  const ref: EntityRef = { table: "zoneLabels", id: labelId };
  return { ...state, selection: [ref] };
}

function withZone(state: EditorState, tool: ZoneToolState): EditorState {
  return { ...state, tool: { name: "zone", state: tool } };
}
