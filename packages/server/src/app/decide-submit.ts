import { createHash } from "node:crypto";
import { applyStoredPatch, canonicalJson, failedExpectations, stampVersions } from "@fm/protocol";
import type { Changeset, RejectReason } from "@fm/protocol";
import type { ChangesetValidator, ProjectState } from "./ports";

export type SubmitDecision =
  | { kind: "reject"; reason: RejectReason }
  | { kind: "duplicate"; seq: number }
  | { kind: "accept"; next: ProjectState; seq: number };

/** Receipt fingerprint over the canonical submission payload, expectations included (spec §7.2). */
export function fingerprintOf(cs: Changeset): string {
  return createHash("sha256").update(canonicalJson({ patch: cs.patch, expect: cs.expect })).digest("hex");
}

/**
 * Spec §7.3 as a pure function. The changeset is already structurally valid (protocol parser).
 * Order: receipt (idempotency) → expectations (compare-and-set) → validation of the result → accept.
 */
export function decideSubmit(state: ProjectState, cs: Changeset, validator: ChangesetValidator): SubmitDecision {
  const fingerprint = fingerprintOf(cs);
  const receipt = state.receipts[cs.id];
  if (receipt) {
    return receipt.fingerprint === fingerprint
      ? { kind: "duplicate", seq: receipt.seq }
      : { kind: "reject", reason: { kind: "malformed", message: "Changeset ID reused with a different payload" } };
  }

  const failed = failedExpectations(state.versions, cs.expect);
  if (failed.length > 0) return { kind: "reject", reason: { kind: "conflict", entities: failed } };

  const doc = applyStoredPatch(state.doc, cs.patch);
  const verdict = validator.validate(doc);
  if (!verdict.ok) return { kind: "reject", reason: { kind: "invalid", violations: verdict.violations } };

  const seq = state.seq + 1;
  return {
    kind: "accept",
    seq,
    next: {
      meta: state.meta,
      seq,
      doc,
      versions: stampVersions(state.versions, cs.patch, cs.id),
      receipts: { ...state.receipts, [cs.id]: { seq, fingerprint } },
    },
  };
}
