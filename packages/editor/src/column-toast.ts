import { namedViolation, type Command, type Violation } from "@fm/domain";

// Refusals in plain words (pillars.39, .50, ux-polish.36): the domain's column (I20), base and top (I21, the deck lock)
// and row height (I17) messages name rows by ID for Claude, and carry the same refusal in plain words for people.

/** Plain words for the violation the domain's message reports, when it carries them; else null. */
export function plainText(violations: Violation[], cmd: Command | null): string | null {
  const named = namedViolation(violations);
  // A new wall against a column: the wall is the subject, not the column.
  if (named?.invariant === "I20" && cmd?.type === "addWall" && named.entities.length === 2) return "A wall can't touch a column";
  if (named?.invariant === "I20" && cmd?.type === "addOpening") return "Doors and windows can't go on a column"; // the lock (pillars.22)
  return named?.plain ?? null;
}
