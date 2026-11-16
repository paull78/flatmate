import { TABLE_NAMES } from "@fm/protocol";
import type { Document } from "../model";

/**
 * Created IDs are `${opId}/<letter><n>`. IDs are capped at 128 characters (`isValidId`); a 120-character opId leaves
 * 8 for the suffix, enough for `/p999999`.
 */
export const MAX_OP_ID_LENGTH = 120;

/** Whether any row in any table already carries an ID derived from `opId` (every table: arch-review R-08). */
export function opIdUsed(doc: Document, opId: string): boolean {
  const prefix = `${opId}/`;
  return TABLE_NAMES.some((t) => Object.keys(doc[t]).some((id) => id.startsWith(prefix)));
}
