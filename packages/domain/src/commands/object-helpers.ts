import { err, isRecord, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { domainError, topologyMessage } from "../errors";
import { sortedIds } from "../graph";
import type { Document, Placement } from "../model";
import { diffPatch } from "../patch";
import { hasExactKeys, isFiniteNumber } from "../shape";
import type { ZoneExtent } from "../use-zone";
import { validateDocument } from "../validate";
import { syncDeps, syncLinkedCopies } from "./linked-copies";
import type { CommandResult } from "./types";

// Helpers shared by the furniture commands (objects.ts, group-objects.ts). Internal to commands.

export const key = (table: EntityKey["table"], id: string): EntityKey => ({ table, id });

/**
 * Validates `next` and builds the patch, or refuses with the fit message (layout-states.18). Stairs' copies follow the
 * one the command changed first (stairs.18), so every state's copy is checked and patched with it.
 */
export function finish(doc: Document, next: Document, deps: EntityKey[]): CommandResult {
  const synced = syncLinkedCopies(doc, next);
  const valid = validateDocument(synced);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: synced, patch: diffPatch(doc, synced, [...deps, ...syncDeps(next, synced)]) });
}

/** Whole degrees, normalised to 0 ≤ r < 360, or null. */
export function normaliseRotation(r: number): number | null {
  if (!isFiniteNumber(r) || !Number.isInteger(r)) return null;
  return ((r % 360) + 360) % 360;
}

export function validPoint(p: Point): boolean {
  return isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

export function placementsOf(doc: Document, objectId: string): string[] {
  return sortedIds(doc.placements).filter((id) => doc.placements[id]?.object === objectId);
}

/** The placement and what its fit depends on: the object (its size), the state and the deck it stands on (decks.15). */
export function placementDeps(p: Placement): EntityKey[] {
  return [key("placements", p.id), key("objects", p.object), key("states", p.state), ...(p.deck === null ? [] : [key("decks", p.deck)])];
}

/**
 * A surface given in a command: null (the floor) or an existing deck's ID, or undefined for anything else. Commands
 * arrive as JSON from MCP and the editor.
 */
export function givenSurface(doc: Document, deck: unknown): string | null | undefined {
  if (deck === null) return null;
  return typeof deck === "string" && Object.hasOwn(doc.decks, deck) ? deck : undefined;
}

/**
 * One command argument (setZoneExtent): exactly depth, start and end, each a finite number, as a fresh object. Shape
 * only: the command checks the limits against the side. Not `parseZoneExtents`, which reads a placement's stored
 * twelve-key row and checks its bounds.
 */
export function parseExtentArg(v: unknown): ZoneExtent | null {
  if (!isRecord(v) || !hasExactKeys(v, ["depth", "start", "end"])) return null;
  const { depth, start, end } = v;
  return isFiniteNumber(depth) && isFiniteNumber(start) && isFiniteNumber(end) ? { depth, start, end } : null;
}
