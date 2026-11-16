import type { EntityKey } from "@fm/protocol";
import { deepEqual } from "@fm/protocol";
import { sortedIds } from "../graph";
import { isLinked, sharedOf } from "../linked";
import type { Document, Placement } from "../model";

// A linked piece stands in every layout (review.05): a stair (stairs.08, .18), a wheel well (trailer.12) or a beam
// (beams.04) always, and furniture marked `linked`. One placement per state, equal in the fields the object shares: pose
// and surface, and for a kind in every layout its sides and zones too; the configuration may differ. Commands edit one
// copy; this makes the others follow, in the same patch, and I19 checks the result. Its own module, so the object
// helpers and the stair commands both use it without a cycle.

/**
 * `next` after a command on `before`, with every linked object's copies in step: the copy the command changed (the
 * first by ID, or the first copy of a new object) gives its shared fields to the others; a state without a copy gets one,
 * as `${object}/${state}`, a copy of the source; a linked object that lost a copy while its state remains loses every
 * copy and the object.
 */
export function syncLinkedCopies(before: Document, next: Document): Document {
  let placements: Record<string, Placement> | null = null;
  let objects: Document["objects"] | null = null;
  for (const id of sortedIds(next.objects)) {
    const object = next.objects[id];
    if (!object || !isLinked(object)) continue;
    const copies = sortedIds(next.placements).flatMap((pid) => (next.placements[pid]?.object === id ? [next.placements[pid]] : [])).filter((p): p is Placement => p !== undefined);
    const lost = Object.values(before.placements).some((p) => p.object === id && Object.hasOwn(next.states, p.state) && !copies.some((c) => c.state === p.state));
    placements ??= { ...next.placements };
    if (lost || copies.length === 0) {
      for (const c of copies) delete placements[c.id];
      objects ??= { ...next.objects };
      delete objects[id];
      continue;
    }
    const shared = (p: Placement): Partial<Placement> => sharedOf(object, p);
    const source = copies.find((c) => !deepEqual(shared(c), shared(before.placements[c.id] ?? c))) ?? copies.find((c) => !before.placements[c.id]) ?? copies[0];
    if (!source) continue;
    for (const state of sortedIds(next.states)) {
      const copy = copies.find((c) => c.state === state);
      const merged: Placement = copy ? { ...copy, ...shared(source) } : { ...source, id: `${id}/${state}`, state };
      if (!copy || !deepEqual(copy, merged)) placements[merged.id] = merged;
    }
  }
  if (placements === null) return next;
  return { ...next, placements, objects: objects ?? next.objects };
}

/** The keys a sync touched: every placement and object whose row differs between `next` and `synced`. */
export function syncDeps(next: Document, synced: Document): EntityKey[] {
  const out: EntityKey[] = [];
  for (const id of new Set([...Object.keys(next.placements), ...Object.keys(synced.placements)])) if (next.placements[id] !== synced.placements[id]) out.push({ table: "placements", id });
  for (const id of Object.keys(next.objects)) if (next.objects[id] !== synced.objects[id]) out.push({ table: "objects", id });
  return out;
}
