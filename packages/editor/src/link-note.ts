import { execute, inEveryLayout, type Command, type Document, type DomainError } from "@fm/domain";

// Layouts linked by default (review.06): a new piece that landed in its own layout only says so, naming the layout it
// didn't fit in. A refusal needs nothing: the domain's fit message already ends "in Night" (review.14). Built from the
// violations and the command, never the message (R-09).

/** The layout a placement belongs to: a stored one's, or for a copy the sync would add, `${object}/${state}`'s state. */
function stateOf(doc: Document, placementId: string): string | null {
  const stored = doc.placements[placementId]?.state;
  if (stored !== undefined) return stored;
  return Object.keys(doc.states).find((s) => placementId.endsWith(`/${s}`)) ?? null;
}

/** The name of the layout the refusal names when none of its placements is in `layout`, or null. */
function otherLayout(error: DomainError, doc: Document, layout: string | null): string | null {
  const states = error.violations.flatMap((v) => v.entities).filter((e) => e.table === "placements").map((e) => stateOf(doc, e.id));
  if (states.length === 0 || states.includes(layout)) return null;
  const other = states.find((s): s is string => s !== null);
  return other === undefined ? null : (doc.states[other]?.name ?? null);
}

/**
 * The note for a new piece that landed in the layout in view only, though it would have been linked (review.06):
 * "Only in Day: it doesn't fit in Night", or null. A placed object (placeObject without `linked`), a duplicate of a linked
 * piece, or a piece placed as one with one place; with one layout, or a kind always in every layout, there is none.
 */
export function placeNote(before: Document, after: Document, cmd: Command, layout: string | null): string | null {
  if (layout === null || Object.keys(before.states).length < 2) return null;
  const here = before.states[layout]?.name;
  if (here === undefined) return null;
  const alone = Object.values(after.objects).filter((o) => !before.objects[o.id] && o.linked !== true && !inEveryLayout(o.kind));
  if (alone.length === 0) return null;
  const meant =
    cmd.type === "placeObject" ? !("existing" in cmd.object) && cmd.linked === undefined
    : cmd.type === "duplicatePlacements" ? cmd.copies.some((c) => before.objects[before.placements[c.placementId]?.object ?? ""]?.linked === true)
    : cmd.type === "placePieces" ? cmd.remove === undefined && cmd.pieces.some((p) => p.placements.length === 1)
    : false;
  if (!meant) return null;
  const tried = cmd.type === "placeObject" ? execute(before, { ...cmd, linked: true }) : null;
  const named = tried !== null && !tried.ok ? otherLayout(tried.error, before, layout) : null;
  const others = Object.values(before.states).filter((s) => s.id !== layout);
  const other = named ?? (others.length === 1 ? (others[0]?.name ?? null) : null);
  return `Only in ${here}: it doesn't fit in ${other ?? "every layout"}`;
}
