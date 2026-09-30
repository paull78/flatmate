import { fromStored, validateDocument } from "@fm/domain";
import type { StoredDocument } from "@fm/protocol";
import type { ChangesetValidator } from "../app/ports";

/**
 * The server app's only view of floor-plan rules (spec §7.1): shape check, then invariants I1–I8.
 * Violations read "I5: ..." so the editor can map the invariant ID to a toast (invariantsMessage).
 */
export const domainValidator: ChangesetValidator = {
  validate(docAfter: StoredDocument) {
    const parsed = fromStored(docAfter);
    if (!parsed.ok) {
      return {
        ok: false,
        violations: [parsed.error.message, ...parsed.error.violations.map((v) => `${v.invariant}: ${v.message}`)],
      };
    }
    const result = validateDocument(parsed.value);
    if (!result.ok) return { ok: false, violations: result.error.map((v) => `${v.invariant}: ${v.message}`) };
    return { ok: true };
  },
};
