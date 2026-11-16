import { isTargetRiser } from "./stairs";
import { isRecord } from "@fm/protocol";
import { parseArms } from "./arms";
import { inEveryLayout, isElevation, isObjectHeight, isObjectSize, kindConfigs, kindOf, railShape, type OrCeiling } from "./kinds";
import { isGuard, isGuardHeight, isHandrailKind, type FlightRails, type GuardValue, type LayoutObject } from "./model";
import { parseOptions } from "./options";
import { hasExactKeys, isFiniteNumber, isValidId, isValidName } from "./shape";

// The object row's shape check (I8), split from shape.ts, which re-exports it.

/**
 * Exactly one size per configuration of the kind, each within MIN_OBJECT_SIZE..MAX_OBJECT_SIZE, or for heights
 * MIN_HEIGHT..MAX_OBJECT_SIZE (`inRange` isObjectHeight, catalog.22).
 */
function parseSizes(v: unknown, configs: readonly string[], inRange: (v: number) => boolean = isObjectSize): Record<string, number> | null {
  if (!isRecord(v) || !hasExactKeys(v, configs)) return null;
  const out: Record<string, number> = {};
  for (const c of configs) {
    const size = v[c];
    if (!isFiniteNumber(size) || !inRange(size)) return null;
    out[c] = size;
  }
  return out;
}

/** Exactly one elevation per configuration of the kind: 0 to 10 m, or "ceiling"; never null (heights.37). */
function parseElevations(v: unknown, configs: readonly string[]): Record<string, OrCeiling> | null {
  if (!isRecord(v) || !hasExactKeys(v, configs)) return null;
  const out: Record<string, OrCeiling> = {};
  for (const c of configs) {
    const z = v[c];
    if (!isElevation(z)) return null;
    out[c] = z;
  }
  return out;
}

const OBJECT_KEYS = ["id", "kind", "name", "w", "d", "h", "z"] as const;
const isDeckLink = (v: unknown): v is string | null => v === null || isValidId(v);

export function parseLayoutObject(v: unknown): LayoutObject | null {
  const k = isRecord(v) && typeof v.kind === "string" ? kindOf(v.kind) : null;
  // A stair has `reaches` and `startsAt` (each a deck ID or null) and furniture doesn't (stairs.10, .49), so the keys
  // depend on the kind; so do an `L` kind's `arms`, required on it and refused elsewhere (catalog.17).
  const stair = k !== null && k.stair !== null;
  const ell = k !== null && k.arms !== null;
  // `options` holds only options the kind takes, each true, never empty (library.10), so clients' rows can't differ.
  const options = isRecord(v) && k !== null && Object.hasOwn(v, "options") ? parseOptions(v.options, k.options) : undefined;
  const targeted = stair && isRecord(v) && Object.hasOwn(v, "riser"); // optional, so a saved stair gains no key (riser.11)
  // A stair with rails always has them, filled on load for an older file (guards.28): a flight by side (edges.06), a
  // spiral one; a rung ladder never has either.
  const shape = k === null ? null : railShape(k.id);
  const linked = isRecord(v) && Object.hasOwn(v, "linked"); // only `true`, and never on a kind in every layout (review.05)
  const keys = [...OBJECT_KEYS, ...(linked ? ["linked"] : []), ...(stair ? ["reaches", "startsAt"] : []), ...(targeted ? ["riser"] : []), ...(shape === "spiral" ? ["handrail"] : []), ...(shape === "flight" ? ["handrails"] : []), ...(ell ? ["arms"] : []), ...(options === undefined ? [] : ["options"])];
  if (!isRecord(v) || !k || !hasExactKeys(v, keys) || options === null) return null;
  if (linked && (v.linked !== true || inEveryLayout(k.id))) return null;
  const { id, kind, name, reaches, startsAt } = v;
  if (!isValidId(id) || typeof kind !== "string" || !isValidName(name)) return null;
  const configs = kindConfigs(k.id).map((c) => c.id);
  const [w, d, h, z] = [parseSizes(v.w, configs), parseSizes(v.d, configs), parseSizes(v.h, configs, isObjectHeight), parseElevations(v.z, configs)];
  if (!w || !d || !h || !z) return null;
  const arms = ell ? parseArms(v.arms) : undefined; // its bounds against w and d are validation's (validate.ts)
  if (arms === null) return null;
  const sized: LayoutObject = arms ? { id, kind, name, w, d, h, z, arms } : { id, kind, name, w, d, h, z };
  const opted: LayoutObject = options ? { ...sized, options } : sized;
  const object: LayoutObject = linked ? { ...opted, linked: true } : opted;
  if (!stair) return object;
  if (targeted && !isTargetRiser(v.riser)) return null;
  const riser = targeted && isTargetRiser(v.riser) ? { riser: v.riser } : {};
  if (shape === "spiral" && !isHandrailKind(v.handrail)) return null;
  const handrail = shape === "spiral" && isHandrailKind(v.handrail) ? { handrail: v.handrail } : {};
  const sides = shape === "flight" ? parseFlightRails(v.handrails) : undefined;
  if (sides === null) return null;
  const handrails = sides === undefined ? {} : { handrails: sides };
  return isDeckLink(reaches) && isDeckLink(startsAt) ? { ...object, reaches, startsAt, ...riser, ...handrail, ...handrails } : null;
}

/** A flight's rails: exactly a left and a right kind (edges.06). */
function parseFlightRails(v: unknown): FlightRails | null {
  if (!isRecord(v) || !hasExactKeys(v, ["left", "right"])) return null;
  const { left, right } = v;
  return isHandrailKind(left) && isHandrailKind(right) ? { left, right } : null;
}

/** Shape and range of one side's or hole's guard (edges.02): exactly a kind and a height of 0.30–1.10 m. */
export function parseGuardValue(v: unknown): GuardValue | null {
  if (!isRecord(v) || !hasExactKeys(v, ["kind", "height"])) return null;
  const { kind, height } = v;
  return isGuard(kind) && isGuardHeight(height) ? { kind, height } : null;
}
