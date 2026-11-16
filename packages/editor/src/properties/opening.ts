import { OPENING_GROUP_LABELS, OPENING_KINDS, OPENING_KIND_IDS, isOpeningKind, isSheer, isValidId, openingHeightsFor, type Document, shown } from "@fm/domain";
import type { Field, OpeningChoice } from "../view/view-model-types";
import { field, numberField, parseNumber, withOptions, type FieldCommand, type Properties } from "./fields";

/** The kinds the picker offers, in the table's order, each with its group's name (openkinds.07): the floating bar's and Properties'. */
export const OPENING_CHOICES: readonly OpeningChoice[] = OPENING_KIND_IDS.map((kind) => ({ kind, label: OPENING_KINDS[kind].label, group: OPENING_GROUP_LABELS[OPENING_KINDS[kind].group] }));

/**
 * A selected opening (spec: openings) in sections Opening (kind), Size (width, a window's Sill, Height: sills.07) and Swing
 * (side, hinge, glazed), a window's Dressing (sheer curtain, shutter box: hangings.04), read from
 * its kind's row (openkinds.15): the side and the hinge show under the row's labels ("Hinge", "Parks at", "Hangs on"),
 * glazed where its glass is `glazed`; a field the row leaves out is hidden, and the document keeps its value for
 * switching back (openkinds.10).
 */
export function openingFields(doc: Document, openingId: string): Properties {
  const o = isValidId(openingId) ? doc.openings[openingId] : undefined;
  if (!o) return { kind: "none" };
  const row = OPENING_KINDS[o.kind];
  const options = OPENING_CHOICES.map((c) => ({ value: c.kind, label: c.label, group: c.group }));
  const kind: Field = { ...withOptions(field("Opening", "kind", "Kind", o.kind, null, false), options), kindPicker: true };
  const width = numberField("Size", "width", "Width", shown(o.width), "m", 0.01);
  const sill = row.fromFloor ? [] : [numberField("Size", "sill", "Sill", shown(o.sill), "m", 0.01)];
  const height = numberField("Size", "height", "Height", shown(o.head - o.sill), "m", 0.01);
  const sides = [{ value: "left", label: "Left" }, { value: "right", label: "Right" }];
  const ends = [{ value: "a", label: "Start" }, { value: "b", label: "End" }];
  const side = row.sideLabel === null ? [] : [withOptions(field("Swing", "side", row.sideLabel, o.side, null, false), sides)];
  const hinge = row.hingeLabel === null ? [] : [withOptions(field("Swing", "hinge", row.hingeLabel, o.hinge, null, false), ends)];
  const glazed: Field[] = row.glass === "glazed" ? [{ ...field("Swing", "glazed", "Glazed", String(o.glazed), null, false), toggle: true }] : [];
  const sheers = [{ value: "none", label: "None" }, { value: "glass", label: "Sill" }, { value: "floor", label: "Floor" }];
  const dressing: Field[] = row.dressings // a window's sheer curtain and shutter box, on its room side (hangings.04)
    ? [withOptions(field("Dressing", "sheer", "Sheer curtain", o.sheer ?? "none", null, false), sheers), { ...field("Dressing", "shutterBox", "Shutter box", String(o.shutterBox === true), null, false), toggle: true }]
    : [];
  return { kind: "opening", fields: [kind, width, ...sill, height, ...side, ...hinge, ...glazed, ...dressing] };
}

/**
 * A selected opening's fields (spec: openings): each sets one field with setOpening; the domain refuses a width outside the
 * kind's range, or a kind switch whose range excludes the width, with its message. A sill keeps the opening's height, a
 * height keeps its sill (`openingHeightsFor`, sills.07); the domain refuses heights that don't fit. A value no choice
 * offers is ignored.
 */
export function openingFieldCommand(doc: Document, openingId: string, fieldId: string, value: string): FieldCommand {
  const o = isValidId(openingId) ? doc.openings[openingId] : undefined;
  switch (fieldId) {
    case "sill":
    case "height": {
      const n = parseNumber(value);
      if (!Number.isFinite(n)) return "notANumber";
      if (!o) return null;
      return { type: "setOpening", openingId, ...openingHeightsFor(o, o.kind, fieldId === "sill" ? { sill: n } : { height: n }) };
    }
    case "kind":
      return isOpeningKind(value) ? { type: "setOpening", openingId, kind: value } : null;
    case "width": {
      const width = parseNumber(value);
      return Number.isFinite(width) ? { type: "setOpening", openingId, width } : "notANumber";
    }
    case "side":
      return value === "left" || value === "right" ? { type: "setOpening", openingId, side: value } : null;
    case "hinge":
      return value === "a" || value === "b" ? { type: "setOpening", openingId, hinge: value } : null;
    case "glazed":
      return value === "true" || value === "false" ? { type: "setOpening", openingId, glazed: value === "true" } : null;
    case "sheer":
      return value === "none" || isSheer(value) ? { type: "setOpening", openingId, sheer: value } : null;
    case "shutterBox":
      return value === "true" || value === "false" ? { type: "setOpening", openingId, shutterBox: value === "true" } : null;
    default:
      return null;
  }
}
