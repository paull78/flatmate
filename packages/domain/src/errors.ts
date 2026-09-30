import type { EntityKey } from "@fm/protocol";

export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8";
export type Violation = { invariant: InvariantId; message: string; entities: EntityKey[] };
export type DomainErrorKind =
  | "notFound" | "invalidInput" | "overlap" | "crossing" | "tooShort" | "topology" | "invalid" | "notInRoom" | "format";
export type DomainError = { kind: DomainErrorKind; message: string; violations: Violation[] };

// User-facing toast texts (spec §8).
export const MESSAGES = {
  tooShort: "Wall too short",
  crossing: "Walls can't cross",
  overlap: "Walls can't overlap",
  jointsMerge: "Joints can't overlap",
  splitTooShort: "Intersection would create a wall shorter than 1 cm",
  notInRoom: "Click inside a room",
  invalid: "Invalid drawing",
} as const;

export function domainError(kind: DomainErrorKind, message: string, violations: Violation[] = []): DomainError {
  return { kind, message, violations };
}

// The toast for a move or resize whose result breaks an invariant (spec §3.4).
export function topologyMessage(violations: Violation[]): string {
  return invariantsMessage(new Set(violations.map((v) => v.invariant))) ?? MESSAGES.invalid;
}

/**
 * The toast for a set of broken invariants, or null when none has one.
 * Takes plain strings so the editor can map ids parsed from a server rejection ("I5: walls cross").
 */
export function invariantsMessage(ids: ReadonlySet<string>): string | null {
  if (ids.has("I5") || ids.has("I6") || ids.has("I7")) return MESSAGES.crossing;
  if (ids.has("I2")) return MESSAGES.tooShort;
  if (ids.has("I4")) return MESSAGES.jointsMerge;
  return null;
}
