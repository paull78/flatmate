import { freeFloor, furnishedRooms, type Document } from "@fm/domain";
import { areaFieldText, formatArea, zoneOfLabel } from "../view/tags";
import { field, type FieldCommand, type Properties } from "./fields";
import { finishFieldCommand, finishFields } from "./zone-finish";
import { roomWallCommand, roomWallFields } from "./room-walls";

/**
 * spec: tools: an editable name and a read-only area; the area is derived, so it follows geometry changes. Free floor in
 * the active layout, for a room that holds furniture in some layout (spec: layouts). Then the floor finish (AC-08).
 */
export function zoneFields(doc: Document, labelId: string, layout: string | null): Properties {
  const label = doc.zoneLabels[labelId];
  if (!label) return { kind: "none" };
  const zone = zoneOfLabel(doc, labelId);
  const free = zone && zone.area !== null && layout !== null && furnishedRooms(doc).has(zone.face.key) ? freeFloor(doc, layout).get(zone.face.key) : null;
  return {
    kind: "zone",
    fields: [
      field("Room", "name", "Name", label.name, null, false),
      field("Room", "area", "Area", areaFieldText(zone), null),
      ...(free !== null && free !== undefined ? [field("Room", "free", "Free floor", formatArea(free), null)] : []),
      ...finishFields(doc, labelId),
      ...roomWallFields(doc, labelId), // the room's walls default, in the Room section (inherit step 05)
    ],
  };
}

export function zoneFieldCommand(doc: Document, labelId: string, fieldId: string, value: string): FieldCommand {
  if (fieldId === "name") return { type: "renameZone", id: labelId, name: value };
  return fieldId.startsWith("walls.") ? roomWallCommand(doc, labelId, fieldId, value) : finishFieldCommand(doc, labelId, fieldId, value);
}
