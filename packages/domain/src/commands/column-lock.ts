import type { EntityKey } from "@fm/protocol";
import { MESSAGES, domainError, type DomainError } from "../errors";
import { incidentWalls } from "../graph";
import type { Document } from "../model";

// The lock (pillars.18, .22): a column's geometry has one writer, the column commands. Every wall command that would
// change a column row, or move or join a joint a column touches, is refused here, naming the column.

/** The refusal naming column `id`; its I20 violation lets the editor and MCP point at the column. */
export function columnLocked(id: string): DomainError {
  const message = MESSAGES.columnLocked(id);
  const entities: EntityKey[] = [{ table: "walls", id }];
  return domainError("invalid", message, [{ invariant: "I20", message, entities, plain: MESSAGES.columnLockedPlain }]);
}

/** A wall that crosses or touches column `column`: I20's text, refused before the wall checks name no column. */
export function columnTouched(column: string, wall: string): DomainError {
  const message = MESSAGES.columnTouches(column, wall);
  const entities: EntityKey[] = [{ table: "walls", id: column }, { table: "walls", id: wall }];
  return domainError("invalid", message, [{ invariant: "I20", message, entities, plain: MESSAGES.columnTouchesPlain }]);
}

/** The column whose row ends at joint `jointId` (the first by ID), or null. */
export function columnAtJoint(doc: Document, jointId: string): string | null {
  return incidentWalls(doc, jointId).find((w) => doc.walls[w]?.column) ?? null;
}

/** The refusal when wall row `wallId` is a column, or null (a missing row is left to the command). */
export function lockWall(doc: Document, wallId: string): DomainError | null {
  return doc.walls[wallId]?.column ? columnLocked(wallId) : null;
}

/** The refusal when any of these joints is a column's, or null. */
export function lockJoints(doc: Document, jointIds: readonly string[]): DomainError | null {
  for (const j of jointIds) {
    const column = columnAtJoint(doc, j);
    if (column !== null) return columnLocked(column);
  }
  return null;
}
