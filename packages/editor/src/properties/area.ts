import { areaM2, areaRoom, shown, type Document } from "@fm/domain";
import { AREA_UNAVAILABLE_SHORT, ORPHAN_TEXT, formatArea } from "../view/tags";
import { field, numberField, parseNumber, type FieldCommand, type Properties } from "./fields";

// A named area's Properties (areas.07): its name, width and depth, each one setArea about its centre; its m², read only,
// the tag's own (cut to its room's floor). The domain refuses what I26 forbids, with its texts.

const SECTION = "Area";

export function areaFields(doc: Document, areaId: string): Properties {
  const a = Object.hasOwn(doc.areas, areaId) ? doc.areas[areaId] : undefined;
  if (!a) return { kind: "none" };
  const m2 = areaM2(doc, areaId);
  const area = areaRoom(doc, areaId) === null ? ORPHAN_TEXT : m2 === null ? AREA_UNAVAILABLE_SHORT : formatArea(m2);
  return {
    kind: "area",
    fields: [
      field(SECTION, "name", "Name", a.name, null, false),
      numberField(SECTION, "width", "Width", shown(a.w), "m", 0.01),
      numberField(SECTION, "depth", "Depth", shown(a.d), "m", 0.01),
      field(SECTION, "area", "Area", area, null),
    ],
  };
}

export function areaFieldCommand(areaId: string, fieldId: string, value: string): FieldCommand {
  if (fieldId === "name") return { type: "setArea", areaId, name: value };
  if (fieldId !== "width" && fieldId !== "depth") return null;
  const v = parseNumber(value);
  if (!Number.isFinite(v)) return "notANumber";
  return fieldId === "width" ? { type: "setArea", areaId, w: v } : { type: "setArea", areaId, d: v };
}
