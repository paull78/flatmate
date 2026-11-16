import { isRecord, isWireId } from "@fm/protocol";
import type { Point } from "@fm/protocol";
import type { Section } from "./section";

// The section row's shape check (I8), split from shape.ts, which reads it: so it imports neither shape.ts nor the model.

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Two own keys, both finite numbers: so exactly x and y. */
function parsePoint(v: unknown): Point | null {
  if (!isRecord(v) || Object.keys(v).length !== 2) return null;
  const { x, y } = v;
  return isNumber(x) && isNumber(y) ? { x, y } : null;
}

/**
 * Shape only: the letter, the length and the depth's sign are I25. A missing key fails its own check, so five own keys
 * means exactly these five. The side is here since its type holds only 1 and -1.
 */
export function parseSection(v: unknown): Section | null {
  if (!isRecord(v) || Object.keys(v).length !== 5) return null;
  const { id, side, depth } = v;
  const a = parsePoint(v.a);
  const b = parsePoint(v.b);
  if (!isWireId(id) || !a || !b || (side !== 1 && side !== -1)) return null;
  return depth === null || isNumber(depth) ? { id, a, b, side, depth } : null;
}
