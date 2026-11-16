import { LOWER_HEIGHT, WALL_SIDES, assertNever, motifsFor, outsideOf, sidesOf, sortedIds, wallSideRooms, type Document, type SideFacing } from "@fm/domain";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import type { Field } from "../view/view-model-types";
import { field, parseNumber, type FieldCommand } from "./fields";
import { finishCommand, finishRows } from "./zone-finish";

// The Outside walls section (inherit step 06, AC-08, inherit.03): with nothing selected, the house's outside walls
// default (setOutsideFinish, on the ceiling row, inherit.07) as Finish and Lower rows, and a note counting the sides
// facing outside and the custom ones among them, which keep their own. A wall standing on a loft faces no outside and
// is not counted (spec: levels).

const SECTION = "Outside walls";

/** Whether a side faces outside: a side facing a room or standing on a loft takes no outside default. */
function facesOutside(facing: SideFacing): boolean {
  switch (facing.kind) {
    case "outside": return true;
    case "room":
    case "loft": return false;
    default: return assertNever(facing);
  }
}

/** The sides facing outside, and how many of them are custom. */
function outsideCount(doc: Document): { all: number; custom: number } {
  let all = 0, custom = 0;
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    if (!w || w.column) continue;
    const rooms = wallSideRooms(doc, id);
    for (const side of WALL_SIDES) {
      if (!rooms || !facesOutside(rooms[side])) continue;
      all++;
      if (sidesOf(w)?.[side]) custom++;
    }
  }
  return { all, custom };
}

/** The section's fields with nothing selected; null otherwise. */
export function outsideFields(state: EditorState): Field[] | null {
  const d = state.document;
  if (!d || state.selection.length > 0) return null;
  const doc = visibleDoc(d);
  const value = outsideOf(doc);
  const lower = value?.lower ?? null;
  const n = outsideCount(doc);
  return [
    ...finishRows(SECTION, "outside.", { id: "finish", label: "Finish" }, motifsFor("wall"), value?.finish ?? null),
    ...finishRows(SECTION, "outside.lower.", { id: "motif", label: "Lower" }, motifsFor("wall"), lower?.finish ?? null, lower ? { id: "outside.lower.height", height: lower.height } : undefined),
    { ...field(SECTION, "outside.note", "", `Every side facing outside (${n.all}) shows these${n.custom > 0 ? `, but ${n.custom} custom` : ""}`, null), hint: true },
  ];
}

/** An Outside walls field's command, or null for another field. */
export function outsideFieldCommand(doc: Document, fieldId: string, value: string): FieldCommand {
  if (!fieldId.startsWith("outside.")) return null;
  const current = outsideOf(doc);
  if (fieldId.startsWith("outside.lower.")) {
    const name = fieldId.slice("outside.lower.".length);
    const lower = current?.lower ?? null;
    const height = lower?.height ?? LOWER_HEIGHT.default;
    if (name === "height") {
      const h = parseNumber(value);
      if (!Number.isFinite(h)) return "notANumber";
      return lower ? { type: "setOutsideFinish", part: "lower", finish: lower.finish, height: h } : null;
    }
    return finishCommand(lower?.finish ?? null, "motif", name, value, (finish) => ({ type: "setOutsideFinish", part: "lower", finish, ...(finish ? { height } : {}) }));
  }
  return finishCommand(current?.finish ?? null, "finish", fieldId.slice("outside.".length), value, (finish) => ({ type: "setOutsideFinish", part: "finish", finish }));
}
