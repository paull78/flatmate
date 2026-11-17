import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError } from "../errors";
import { sortedIds } from "../graph";
import type { Document, LayoutState, Placement } from "../model";
import { diffPatch } from "../patch";
import { isValidId, isValidName } from "../shape";
import { isLinked } from "../linked";
import { finish } from "./object-helpers";
import { withoutPlacements } from "./objects";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import { sheetsInStep } from "./sheets-strip";
import type { CommandOf, CommandResult } from "./types";

// Layout-state commands (spec: layouts). States hold placements only; walls and rooms are shared, so a rename, a copy
// or a delete never changes fit and needs no validation beyond its own fields; addState validates.

const stateKey = (id: string): EntityKey => ({ table: "states", id });

function nextOrder(doc: Document): number {
  return Math.max(-1, ...Object.values(doc.states).map((s) => s.order)) + 1;
}

function checkNew(doc: Document, opId: string, name: string): string | null {
  if (!isValidId(opId) || opId.length > MAX_OP_ID_LENGTH) return "Invalid operation ID";
  if (opIdUsed(doc, opId)) return "Operation ID already used";
  if (!isValidName(name)) return "Name too long";
  return null;
}

/**
 * A state `${opId}/s0`, after the last one, holding only what stands in every layout: each linked piece, stair, beam and
 * wheel well (stairs.18) as the first layout by order has it, configuration, sides and zones included, as
 * `${object}/${state}`. A part of a valid layout, so it fits; the result is validated all the same (knownbugs AC-01).
 */
export function addState(doc: Document, cmd: CommandOf<"addState">): CommandResult {
  const problem = checkNew(doc, cmd.opId, cmd.name);
  if (problem) return err(domainError("invalidInput", problem));
  const state: LayoutState = { id: `${cmd.opId}/s0`, name: cmd.name, order: nextOrder(doc) };
  const first = sortedIds(doc.states).map((id) => doc.states[id]).reduce<LayoutState | undefined>((a, b) => (a === undefined || (b !== undefined && b.order < a.order) ? b : a), undefined);
  const placements = { ...doc.placements };
  const deps: EntityKey[] = [stateKey(state.id), ...(first ? [stateKey(first.id)] : [])];
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    const object = p ? doc.objects[p.object] : undefined;
    if (!p || !object || p.state !== first?.id || !isLinked(object)) continue;
    deps.push({ table: "placements", id });
    const copy: Placement = { ...p, id: `${object.id}/${state.id}`, state: state.id, at: { ...p.at }, sides: { ...p.sides }, zones: { ...p.zones } };
    placements[copy.id] = copy;
  }
  return finish(doc, { ...doc, states: { ...doc.states, [state.id]: state }, placements }, deps);
}

/**
 * A new state `${opId}/s0` holding a copy of every placement of `from`, as `${opId}/p0`, `p1`… in object-ID order
 * (so every client derives the same IDs). Copies fit, because the source's placements do and walls are shared.
 */
export function copyState(doc: Document, cmd: CommandOf<"copyState">): CommandResult {
  const problem = checkNew(doc, cmd.opId, cmd.name);
  if (problem) return err(domainError("invalidInput", problem));
  const from = isValidId(cmd.from) ? doc.states[cmd.from] : undefined;
  if (!from) return err(domainError("notFound", "Layout not found"));
  const state: LayoutState = { id: `${cmd.opId}/s0`, name: cmd.name, order: nextOrder(doc) };
  const sources = sortedIds(doc.placements)
    .map((id) => doc.placements[id])
    .filter((p): p is Placement => p !== undefined && p.state === from.id)
    .sort((a, b) => (a.object < b.object ? -1 : a.object > b.object ? 1 : 0));
  const placements = { ...doc.placements };
  sources.forEach((p, i) => {
    const id = `${cmd.opId}/p${i}`;
    placements[id] = { ...p, id, state: state.id, at: { ...p.at }, sides: { ...p.sides }, zones: { ...p.zones } };
  });
  const deps: EntityKey[] = [stateKey(from.id), stateKey(state.id), ...sources.map((p): EntityKey => ({ table: "placements", id: p.id }))];
  const next: Document = { ...doc, states: { ...doc.states, [state.id]: state }, placements };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

export function renameState(doc: Document, cmd: CommandOf<"renameState">): CommandResult {
  const state = isValidId(cmd.stateId) ? doc.states[cmd.stateId] : undefined;
  if (!state) return err(domainError("notFound", "Layout not found"));
  if (!isValidName(cmd.name)) return err(domainError("invalidInput", "Name too long"));
  const deps = [stateKey(state.id)];
  if (state.name === cmd.name) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, states: { ...doc.states, [state.id]: { ...state, name: cmd.name } } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** Removes a state, its placements, every object left with no placement and its sheets' drawings; the last state stays (I9). */
export function deleteState(doc: Document, cmd: CommandOf<"deleteState">): CommandResult {
  const state = isValidId(cmd.stateId) ? doc.states[cmd.stateId] : undefined;
  if (!state) return err(domainError("notFound", "Layout not found"));
  if (Object.keys(doc.states).length <= 1) return err(domainError("invalidInput", "A drawing keeps at least one layout"));
  const deps: EntityKey[] = [stateKey(state.id)];
  const gone = new Set(sortedIds(doc.placements).filter((id) => doc.placements[id]?.state === state.id));
  const states = { ...doc.states };
  delete states[state.id];
  const next = sheetsInStep(doc, withoutPlacements({ ...doc, states }, gone, deps), deps);
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
