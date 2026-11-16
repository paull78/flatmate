import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError, topologyMessage } from "../errors";
import { distance } from "../geometry";
import { MIN_DIMENSION, type Dimension, type Document } from "../model";
import { diffPatch } from "../patch";
import { dimensionEnd } from "../queries/dimensions";
import { isValidId } from "../shape";
import { validateDocument } from "../validate";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";

// Placed dimension commands (dims): a dimension depends only on its own row (dims.21), so a remote corner drag never
// cancels a local offset drag. Each result is validated, so I15 refuses an offset out of bounds.

const dimKey = (id: string): EntityKey => ({ table: "dimensions", id });

function finish(doc: Document, d: Dimension): CommandResult {
  const next: Document = { ...doc, dimensions: { ...doc.dimensions, [d.id]: d } };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, [dimKey(d.id)]) });
}

/** A new dimension `${opId}/m0` from a to b; the domain decides each end (dims.16). */
export function addDimension(doc: Document, cmd: CommandOf<"addDimension">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  const { a, b, offset } = cmd;
  if (![a.x, a.y, b.x, b.y, offset].every(Number.isFinite)) return err(domainError("invalidInput", "Invalid dimension"));
  if (distance(a, b) < MIN_DIMENSION) return err(domainError("invalidInput", "Dimension too short"));
  return finish(doc, { id: `${cmd.opId}/m0`, a: dimensionEnd(doc, a), b: dimensionEnd(doc, b), offset });
}

export function setDimensionOffset(doc: Document, cmd: CommandOf<"setDimensionOffset">): CommandResult {
  const d = isValidId(cmd.id) ? doc.dimensions[cmd.id] : undefined;
  if (!d) return err(domainError("notFound", "Dimension not found"));
  if (!Number.isFinite(cmd.offset)) return err(domainError("invalidInput", "Invalid offset"));
  if (cmd.offset === d.offset) return ok({ doc, patch: diffPatch(doc, doc, [dimKey(d.id)]) });
  return finish(doc, { ...d, offset: cmd.offset });
}
