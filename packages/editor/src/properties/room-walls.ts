import { LOWER_HEIGHT, motifsFor, roomWallSides, roomWallsOf, sidesOf, type Document } from "@fm/domain";
import type { Field } from "../view/view-model-types";
import { field, parseNumber, type FieldCommand } from "./fields";
import { finishCommand, finishRows, ownerOf } from "./zone-finish";

// A room's Walls and Lower rows (surfaces step 09, inherit step 05, AC-06): in the Room section under Floor, they set
// the room's walls default on its label (setRoomWallFinishes, inherit.01); every side facing the room shows it but the
// custom ones, which the note counts. A second label in the room says where they're set, as its Floor does.

/** A room's Walls and Lower rows and the note, under Floor. */
export function roomWallFields(doc: Document, labelId: string): Field[] {
  const label = doc.zoneLabels[labelId];
  if (!label) return [];
  const owner = ownerOf(doc, labelId);
  if (owner !== null) return [field("Room", "walls", "Walls", `Set on ${doc.zoneLabels[owner]?.name ?? ""}`, null)];
  const value = roomWallsOf(label);
  const lower = value?.lower ?? null;
  const custom = roomWallSides(doc, labelId).filter(({ wallId, side }) => {
    const w = doc.walls[wallId];
    return w !== undefined && sidesOf(w)?.[side] != null;
  }).length;
  return [
    ...finishRows("Room", "walls.", { id: "finish", label: "Walls" }, motifsFor("wall"), value?.finish ?? null),
    ...finishRows("Room", "walls.lower.", { id: "motif", label: "Lower" }, motifsFor("wall"), lower?.finish ?? null, lower ? { id: "walls.lower.height", height: lower.height } : undefined),
    { ...field("Room", "walls.note", "", `Every side facing ${label.name} shows these${custom > 0 ? `, but ${custom} custom` : ""}`, null), hint: true },
  ];
}

/** A Walls or Lower field's command, or null for another field. */
export function roomWallCommand(doc: Document, labelId: string, fieldId: string, value: string): FieldCommand {
  const label = doc.zoneLabels[labelId];
  if (!label || ownerOf(doc, labelId) !== null) return null;
  const current = roomWallsOf(label);
  if (fieldId.startsWith("walls.lower.")) {
    const name = fieldId.slice("walls.lower.".length);
    const lower = current?.lower ?? null;
    const height = lower?.height ?? LOWER_HEIGHT.default;
    if (name === "height") {
      const h = parseNumber(value);
      if (!Number.isFinite(h)) return "notANumber";
      return lower ? { type: "setRoomWallFinishes", labelId, part: "lower", finish: lower.finish, height: h } : null;
    }
    return finishCommand(lower?.finish ?? null, "motif", name, value, (finish) => ({ type: "setRoomWallFinishes", labelId, part: "lower", finish, ...(finish ? { height } : {}) }));
  }
  if (!fieldId.startsWith("walls.")) return null;
  return finishCommand(current?.finish ?? null, "finish", fieldId.slice("walls.".length), value, (finish) => ({ type: "setRoomWallFinishes", labelId, part: "finish", finish }));
}
