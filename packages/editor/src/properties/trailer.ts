import { TRAILER_HITCHES, hitchName, surroundingsOf, trailerOf } from "@fm/domain";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import { shellBounds } from "../view3d/camera3d";
import type { Field } from "../view/view-model-types";
import { field, type FieldCommand } from "./fields";

// The Trailer section (trailer.03): with nothing selected and Surroundings On wheels, the trailer's three project
// fields after Ceiling. The hitch's ends are named as the plan shows them, along the box the trailer is drawn under
// (x on a tie, as trailerFaces reads it). Field ids are "trailer.<name>".

const SECTION = "Trailer";
const AXLES = [{ value: "2", label: "Two" }, { value: "3", label: "Three" }];
const BOX = [{ value: "off", label: "Off" }, { value: "on", label: "On" }];

export function trailerFields(state: EditorState): Field[] | null {
  const d = state.document;
  if (!d || state.selection.length > 0) return null;
  const doc = visibleDoc(d);
  if (surroundingsOf(doc) !== "wheels") return null;
  const t = trailerOf(doc);
  const box = shellBounds(doc);
  const alongX = !box || box.max.x - box.min.x >= box.max.y - box.min.y;
  const hitches = TRAILER_HITCHES.map((h) => ({ value: h, label: hitchName(h, alongX) }));
  return [
    { ...field(SECTION, "trailer.hitch", "Hitch", t.hitch, null, false), options: hitches },
    { ...field(SECTION, "trailer.axles", "Axles", String(t.axles), null, false), options: AXLES },
    { ...field(SECTION, "trailer.tongueBox", "Tongue box", t.tongueBox ? "on" : "off", null, false), options: BOX },
  ];
}

/** The command for a committed Trailer field, or null for an id that is not one. A default clears its row. */
export function trailerFieldCommand(fieldId: string, value: string): FieldCommand {
  switch (fieldId) {
    case "trailer.hitch": return { type: "setProjectField", key: "trailerHitch", value: value === "high" ? "" : value };
    case "trailer.axles": return { type: "setProjectField", key: "trailerAxles", value: value === "2" ? "" : value };
    case "trailer.tongueBox": return { type: "setProjectField", key: "tongueBox", value: value === "off" ? "" : value };
    default: return null;
  }
}
