import { areaFields } from "./area";
import { assertNever } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import { activeStateId, type EditorState } from "../state";
import type { Properties } from "./fields";
import { columnFields } from "./column";
import { deckFields } from "./deck";
import { holeFields } from "./hole";
import { dimensionFields } from "./dimension";
import { jointFields } from "./joint";
import { objectFields } from "./object";
import { openingFields } from "./opening";
import { sectionFields } from "./section";
import { wallFields } from "./wall";
import { zoneFields } from "./zone";

/** The Properties panel for the selection (spec: editor): one entity's fields, a group's count (direct.08), or none. */
export function properties(state: EditorState): Properties {
  if (state.selection.length > 1) {
    const walls = state.selection.filter((r) => r.table === "walls").length; // a group with walls (straight.09)
    return walls > 0 ? { kind: "group", count: state.selection.length, walls, duplicate: "Walls can't be duplicated" } : { kind: "group", count: state.selection.length };
  }
  const ref = state.selection[0];
  if (!ref || !state.document) return { kind: "none" };
  const doc = visibleDoc(state.document);
  switch (ref.table) {
    case "walls": // a column row is edited as a column, never as a wall (pillars.14)
      return doc.walls[ref.id]?.column ? columnFields(doc, ref.id) : wallFields(doc, ref.id);
    case "joints":
      return jointFields(doc, ref.id);
    case "zoneLabels":
      return zoneFields(doc, ref.id, activeStateId(state));
    case "placements":
      return objectFields(doc, ref.id);
    case "openings":
      return openingFields(doc, ref.id);
    case "dimensions":
      return dimensionFields(doc, ref.id);
    case "decks":
      return deckFields(doc, ref.id);
    case "deckHoles":
      return holeFields(doc, ref.id);
    case "sections":
      return sectionFields(doc, ref.id);
    case "areas":
      return areaFields(doc, ref.id);
    case "states":
    case "objects":
    case "projectFields":
    case "underlays":
    case "logos":
    case "ceilings":
    case "sheets":
      return { kind: "none" };
    default:
      return assertNever(ref.table);
  }
}
