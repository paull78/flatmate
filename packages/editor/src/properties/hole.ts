import { holeView, isGuard, shown, type Document } from "@fm/domain";
import { guardFields, numberField, parseNumber, type FieldCommand, type Properties } from "./fields";

// A hole's Properties (stairwell.08): Width and Depth, along its deck's axes, each typed value one setDeckHole about its
// centre; then its Guard and Height, one for all its sides (edges.01). Its place is dragged; the domain refuses what I22,
// the slab and the guard's range forbid, with their texts.

const SECTION = "Hole";

export function holeFields(doc: Document, holeId: string): Properties {
  const hole = holeView(doc, holeId)?.hole;
  if (!hole) return { kind: "none" };
  return {
    kind: "hole",
    fields: [
      numberField(SECTION, "width", "Width", shown(hole.w), "m", 0.01),
      numberField(SECTION, "depth", "Depth", shown(hole.d), "m", 0.01),
      ...guardFields(SECTION, "guard", "guardHeight", "Guard", hole.guard),
    ],
  };
}

export function holeFieldCommand(holeId: string, fieldId: string, value: string): FieldCommand {
  if (fieldId === "guard") return isGuard(value) ? { type: "setDeckHole", holeId, guard: { kind: value } } : null; // a value no choice offers is ignored
  if (fieldId !== "width" && fieldId !== "depth" && fieldId !== "guardHeight") return null;
  const v = parseNumber(value);
  if (!Number.isFinite(v)) return "notANumber";
  if (fieldId === "guardHeight") return { type: "setDeckHole", holeId, guard: { height: v } };
  return fieldId === "width" ? { type: "setDeckHole", holeId, w: v } : { type: "setDeckHole", holeId, d: v };
}
