import { length, shown, sub, type Document } from "@fm/domain";
import { field, numberField, type FieldCommand, type Properties } from "./fields";

// A section's Properties (spec "Editing", "Depth"): its letter and length to read, Depth and Flip to change, each one
// setSection. Depth is one value box: blank is Whole, 0 is Zero, anything else metres; the hint below it says so.

const SECTION = "Section";

export function sectionFields(doc: Document, sectionId: string): Properties {
  const row = doc.sections[sectionId];
  if (!row) return { kind: "none" };
  return {
    kind: "section",
    fields: [
      field(SECTION, "letter", "Letter", row.id, null),
      field(SECTION, "length", "Length", shown(length(sub(row.b, row.a))), "m"),
      { ...numberField(SECTION, "depth", "Depth", row.depth === null ? "" : shown(row.depth), "m", 0.01), placeholder: "Whole" },
      { ...field(SECTION, "depthHint", "", "Blank sees the whole drawing; 0 only the cut", null), hint: true },
      { ...field(SECTION, "flip", "Side", "Flip", null, false), action: true },
    ],
  };
}

export function sectionFieldCommand(doc: Document, sectionId: string, fieldId: string, value: string): FieldCommand {
  const row = doc.sections[sectionId];
  if (!row) return null;
  switch (fieldId) {
    case "depth": {
      if (value.trim() === "") return { type: "setSection", sectionId, depth: null };
      const depth = Number(value);
      return Number.isFinite(depth) ? { type: "setSection", sectionId, depth } : "notANumber"; // the domain says why a negative one can't be
    }
    case "flip":
      return { type: "setSection", sectionId, side: row.side === 1 ? -1 : 1 };
    default:
      return null;
  }
}
