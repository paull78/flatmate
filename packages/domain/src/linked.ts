import { inEveryLayout } from "./kinds";
import type { LayoutObject, Placement } from "./model";

// Which objects are linked across layouts and what their copies share (review.05), for the sync (commands/linked-copies.ts)
// and I19 (stair-links.ts).

/** Whether `object` keeps one copy per layout, in step. */
export function isLinked(object: Pick<LayoutObject, "kind" | "linked">): boolean {
  return inEveryLayout(object.kind) || object.linked === true;
}

/** The fields an object's copies share: pose and surface, and for a kind in every layout its sides and zones (review.05). */
export function sharedOf(object: Pick<LayoutObject, "kind">, p: Placement): Partial<Placement> {
  const pose = { at: p.at, rotation: p.rotation, deck: p.deck };
  return inEveryLayout(object.kind) ? { ...pose, sides: p.sides, zones: p.zones } : pose;
}
