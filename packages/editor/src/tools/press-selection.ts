import type { EntityRef } from "@fm/domain";
import type { Hit } from "./hit-test";

/**
 * The selection a Select press sets at once (`now`), and the one a click, a release without a drag, sets
 * (`onClick`, null to keep `now`). A selection is one entity, or one or more placements (direct.02, direct.07):
 * Shift toggles furniture (the first of a stack, heights.16), any other hit selects that thing alone, and a press on
 * a selected piece keeps the selection so it can be dragged (direct.19). A click on the one selected piece where
 * others lie under it in plan picks the next of the stack, then a hole under them (riser.20), and back round (heights.33):
 * the selection is the cycle's place. A click on the selected area's body goes on to what's under it there (areas.38).
 */
/**
 * `wall`: the hit is a wall that can join a group (not a column); `members`: the selection as a group's members, none
 * when it holds anything that can't be grouped (straight.09: walls group with each other and with furniture).
 */
export function pressSelection(
  current: EntityRef[], hit: Hit, shift: boolean, wall = false, members: EntityRef[] = current.every((r) => r.table === "placements") ? current : [],
): { now: EntityRef[]; onClick: EntityRef[] | null } {
  // A handle keeps its wall or piece selected, so its drag works; a click on a wall's joint handle selects that joint
  // (straight.42): the one way to reach the joint between two pieces of a wall, to join them.
  if (hit.handle !== null) return { now: current, onClick: hit.handle.kind === "joint" ? [{ table: "joints", id: hit.handle.jointId }] : null };
  if (hit.ref.table === "deckHoles" && hit.stack?.[0] !== undefined && !shift) return { now: [hit.ref], onClick: [{ table: "placements", id: hit.stack[0] }] }; // round from the hole (riser.20)
  const openings = hit.openings ?? [];
  if (hit.ref.table === "openings" && openings.length > 1 && !shift && current.some((r) => sameRef(r, hit.ref))) { // stacked: the next one up (sills.26)
    const next = openings[(openings.indexOf(hit.ref.id) + 1) % openings.length] ?? hit.ref.id;
    return { now: [hit.ref], onClick: [{ table: "openings", id: next }] };
  }
  if (hit.ref.table === "areas" && hit.under !== undefined && !shift) return { now: [hit.ref], onClick: [hit.under] }; // the selected area's body: a click goes on to what's under it (areas.38)
  if (hit.ref.table !== "placements" && !wall) return { now: [hit.ref], onClick: null };
  const stack = wall ? [hit.ref.id] : (hit.stack ?? [hit.ref.id]);
  const ref: EntityRef = shift && !wall ? { table: "placements", id: stack[0] ?? hit.ref.id } : hit.ref;
  const furniture = members;
  const selected = furniture.some((r) => sameRef(r, ref));
  if (shift && !selected) return { now: [...furniture, ref], onClick: null };
  if (shift) return { now: furniture, onClick: furniture.filter((r) => !sameRef(r, ref)) };
  if (selected && furniture.length > 1) return { now: furniture, onClick: [ref] };
  if (!wall && selected && (stack.length > 1 || hit.hole !== undefined)) {
    const after = stack[stack.indexOf(ref.id) + 1];
    if (after === undefined && hit.hole !== undefined) return { now: [ref], onClick: [{ table: "deckHoles", id: hit.hole }] }; // past the last piece (riser.20)
    return { now: [ref], onClick: [{ table: "placements", id: after ?? stack[0] ?? ref.id }] };
  }
  return { now: [ref], onClick: null };
}

function sameRef(a: EntityRef, b: EntityRef): boolean {
  return a.table === b.table && a.id === b.id;
}
