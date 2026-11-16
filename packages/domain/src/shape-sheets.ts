import { isRecord } from "@fm/protocol";
import { SHEET_KINDS, SHEET_SIZES, SHEET_SLOTS, SHEET_SPLITS, flatDrawings, type Sheet, type SheetDrawings } from "./model";
import { hasExactKeys, isFiniteNumber, isValidId, isValidName } from "./shape";

// The sheet row's shape check (I8), split from shape.ts, which re-exports it.

const SHEET_KEYS = ["id", "kind", "order", "inPdf", "title", "scale", "split", "cx", "cy", "finishes", "marks", "drawings", "text", "size", "section"];

/** Exactly the eight flat keys, each an ID or null (library.17). Counts, gaps and what they name are I23. */
function parseDrawings(v: unknown): SheetDrawings | null {
  if (!isRecord(v) || !hasExactKeys(v, SHEET_SLOTS.flat())) return null;
  const out = flatDrawings([]);
  for (const key of SHEET_SLOTS.flat()) {
    const id = v[key];
    if (id !== null && !isValidId(id)) return null;
    out[key] = id;
  }
  return out;
}

/** Shape only: the scale's list, the text's cap and the drawings' counts and names are I23 (sheetset). */
export function parseSheet(v: unknown): Sheet | null {
  if (!isRecord(v) || !hasExactKeys(v, SHEET_KEYS)) return null;
  const { id, order, inPdf, title, scale, cx, cy, finishes, marks, text, section } = v;
  const kind = SHEET_KINDS.find((k) => k === v.kind);
  const split = SHEET_SPLITS.find((s) => s === v.split);
  const size = SHEET_SIZES.find((s) => s === v.size);
  const drawings = parseDrawings(v.drawings);
  if (!isValidId(id) || !kind || !split || !size || !drawings || !isValidName(title) || typeof text !== "string") return null;
  if (!isFiniteNumber(order) || !isFiniteNumber(cx) || !isFiniteNumber(cy) || (scale !== null && !isFiniteNumber(scale))) return null;
  if (typeof inPdf !== "boolean" || typeof finishes !== "boolean" || typeof marks !== "boolean" || (section !== null && !isValidId(section))) return null;
  return { id, kind, order, inPdf, title, scale, split, cx, cy, finishes, marks, drawings, text, size, section };
}
