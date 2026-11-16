import { reasonOf } from "../toast-text";
import type { Field } from "../view/view-model-types";
import { NEAR_SQUARE_DEG } from "../snapping/near-square";
import { FLOOR_BASE, deckLabel, deckView, halfWallTop, roundMm, wallHelperDimension, wallRange, type Document, shown, offAxisAngle, straightenPlans } from "@fm/domain";
import { field, numberField, parseNumber, type FieldCommand, type Properties } from "./fields";
import { wallSideCommand, wallSideFields } from "./wall-finish";

/**
 * A wall's length (read-only: typed on the canvas), thickness (layout-states.27), base (read-only: the floor, or the
 * deck it was drawn on, pillars.14) and top (heights.10): "To ceiling", a switch, and the top's height above the base,
 * read-only while it follows the ceiling.
 */
export function wallFields(doc: Document, wallId: string): Properties {
  const h = wallHelperDimension(doc, wallId);
  const wall = doc.walls[wallId];
  const range = wallRange(doc, wallId);
  if (!h || !wall || !range) return { kind: "none" };
  const full = halfWallTop(doc, wallId) === null;
  const top = shown(range.top - range.bottom);
  const base = wall.base === FLOOR_BASE ? null : deckView(doc, wall.base);
  return {
    kind: "wall",
    split: true, // Properties' Split arms the Split gesture (straight step 15)
    fields: [
      field("Wall", "length", "Length", shown(h.length), "m"),
      numberField("Wall", "thickness", "Thickness", shown(wall.thickness), "m", 0.05),
      field("Wall", "base", "Base", base ? deckLabel(base) : "Floor", null),
      { ...field("Wall", "toCeiling", "To ceiling", String(full), null, false), toggle: true },
      full ? field("Wall", "top", "Top", top, "m") : numberField("Wall", "top", "Top", top, "m", 0.01),
      ...angleField(doc, wallId),
      ...straightenField(doc, wallId),
      ...wallSideFields(doc, wallId),
    ],
  };
}

export function wallFieldCommand(doc: Document, wallId: string, fieldId: string, value: string): FieldCommand {
  const range = wallRange(doc, wallId);
  switch (fieldId) {
    case "thickness": {
      const thickness = parseNumber(value);
      return Number.isFinite(thickness) ? { type: "setWallThickness", wallId, thickness } : "notANumber";
    }
    case "top": {
      const top = parseNumber(value);
      return Number.isFinite(top) ? { type: "setWallTop", wallId, top } : "notANumber";
    }
    case "straighten":
      return { type: "straightenWalls", wallId };
    case "toCeiling":
      if (value === "true") return { type: "setWallTop", wallId, top: "ceiling" };
      if (value !== "false") return null;
      // Switched off, the wall keeps its height above its base as a fixed top and stops following the ceiling; typing a
      // lower Top makes it a half wall (decks.56).
      return range ? { type: "setWallTop", wallId, top: roundMm(range.top - range.bottom) } : null;
    default:
      if (fieldId.startsWith("left.") || fieldId.startsWith("right.")) return wallSideCommand(doc, wallId, fieldId, value);
      return null;
  }
}

/** A wall off both axes by more than 0 and at most 1° shows its angle, read-only (straight.11): an invisible slant, found. */
function angleField(doc: Document, wallId: string): Field[] {
  const angle = offAxisAngle(doc, wallId);
  if (angle <= 0 || angle > NEAR_SQUARE_DEG) return [];
  return [field("Wall", "angle", "Angle", angle < 0.01 ? "less than 0.01°" : `${angle.toFixed(2)}°`, null)];
}

/**
 * Straighten (straight.43): on a wall whose side is nearly straight and nearly square but not exactly, an action that
 * puts the whole side on one line; where the drawing refuses it, the action is off with the reason under it.
 */
function straightenField(doc: Document, wallId: string): Field[] {
  if (straightenPlans(doc, wallId) === null) return [];
  const reason = reasonOf(doc, { type: "straightenWalls", wallId });
  const action: Field = { ...field("Wall", "straighten", "", "Straighten", null, reason !== null), action: true };
  return reason === null ? [action] : [action, { ...field("Wall", "straighten.reason", "", reason, null), hint: true }];
}
