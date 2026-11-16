import { isRecord, isWireId, MAX_NAME_CHARS } from "@fm/protocol";
import type { Point } from "@fm/protocol";
import type { Area } from "./area";

// The area row's shape check (I8), split from shape.ts, which reads it: so it imports neither shape.ts nor the model.

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Two own keys, both finite numbers: so exactly x and y. */
function parsePoint(v: unknown): Point | null {
  if (!isRecord(v) || Object.keys(v).length !== 2) return null;
  const { x, y } = v;
  return isNumber(x) && isNumber(y) ? { x, y } : null;
}

/** Shape only: the size and overlaps are I26. Five own keys, each passing its own check, means exactly these five. */
export function parseArea(v: unknown): Area | null {
  if (!isRecord(v) || Object.keys(v).length !== 5) return null;
  const { id, name, w, d } = v;
  const at = parsePoint(v.at);
  if (!isWireId(id) || typeof name !== "string" || name.length > MAX_NAME_CHARS || !at) return null;
  return isNumber(w) && isNumber(d) ? { id, name, at, w, d } : null;
}
