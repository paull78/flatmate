import { areaName } from "@fm/domain";
import { OPENING_KINDS, deckView, type Document, type EntityRef } from "@fm/domain";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import type { UnderPointerView } from "./view-model-types";

/** The right-click list (AC-06), its rows in plain names; null while closed. */
export function underPointerView(state: EditorState): UnderPointerView | null {
  const list = state.underPointer;
  if (!list || !state.document) return null;
  const doc = visibleDoc(state.document);
  const rows = list.rows.map((ref) => ({
    key: `${ref.table}|${ref.id}`,
    ref,
    label: rowLabel(doc, ref),
    selected: state.selection.some((s) => s.table === ref.table && s.id === ref.id),
  }));
  return { at: list.at, rows };
}

function rowLabel(doc: Document, ref: EntityRef): string {
  if (ref.table === "placements") {
    const p = doc.placements[ref.id];
    return (p && doc.objects[p.object]?.name) || "Piece";
  }
  if (ref.table === "openings") {
    const o = doc.openings[ref.id];
    return o ? OPENING_KINDS[o.kind].label : "Opening";
  }
  if (ref.table === "sections") return `Section ${ref.id}`; // its letter is its ID
  if (ref.table === "decks") return deckView(doc, ref.id)?.name ?? "Deck";
  if (ref.table === "walls") return doc.walls[ref.id]?.column ? "Column" : "Wall";
  if (ref.table === "zoneLabels") return doc.zoneLabels[ref.id]?.name ?? "Room";
  if (ref.table === "areas") return `Area · ${areaName(doc.areas[ref.id] ?? { name: "" })}`;
  return ref.table === "deckHoles" ? "Hole" : "Dimension"; // the only other tables everythingAt lists
}
