import { dimensionLength, isValidId, type Document } from "@fm/domain";
import { dimensionValue } from "../view/dimension-layout";
import { field, type Properties } from "./fields";

/** A placed dimension's length, read-only (dims.17): it changes only when a corner its ends sit on moves. */
export function dimensionFields(doc: Document, id: string): Properties {
  const d = isValidId(id) ? doc.dimensions[id] : undefined;
  const length = d ? dimensionLength(doc, d) : null;
  if (length === null) return { kind: "none" };
  return { kind: "dimension", fields: [field("Dimension", "length", "Length", dimensionValue(length), "m")] };
}
