import type { EntityKey } from "@fm/protocol";
import { columnOf } from "./column-checks";
import { MESSAGES, rowWords, type Violation } from "./errors";
import { jointWalls, sortedIds } from "./graph";
import { FLOOR_BASE, type Document, type Wall } from "./model";
import { deckLabel, deckView, insideDeck, overHole, type DeckView } from "./queries/decks";
import { wallBodies } from "./queries/footprints";
import { isFloor, levelOf } from "./queries/levels";
import { cutHeight } from "./queries/vertical";
import { metres } from "./format";

// I21, a wall or column row's base and top references (pillars.05, .23), beside validate.ts as ceiling.ts holds I17
// (the rows' heights from their base). wallRange (queries/vertical.ts) turns the references into metres.

/** A refusal naming the row for Claude, and in plain words for people. */
type Problem = { message: string; plain: string };

/** The deck IDs a row references, as base and as top: the deck lock (pillars.23) and these checks read them. */
export function deckRefs(w: Pick<Wall, "base" | "top">): { base: string | null; top: string | null } {
  return { base: w.base === FLOOR_BASE ? null : w.base, top: typeof w.top === "string" && w.top !== "ceiling" ? w.top : null };
}

/** Why row `w` breaks I21, or null: the first of its base's, its top's and its line's problems. */
function rowProblem(doc: Document, w: Wall): Problem | null {
  const { name, kind } = rowWords(w.id, w.column);
  const both = (rest: string): Problem => ({ message: `${name} ${rest}`, plain: `A ${kind} ${rest}` });
  const missing = (rest: string): Problem => ({ message: `${name} ${rest}`, plain: MESSAGES.removed }); // after a race
  const body = wallBodies(doc).get(w.id);
  // A deck the row stands on or reaches up to is a level (levels.02), and the row's body lies on it within EPS.
  const onDeck = (deck: DeckView, verb: string): Problem | null => {
    if (isFloor(levelOf(doc, deck.id))) return both(`can't ${verb} ${deckLabel(deck)}: only a deck at or above the ${metres(cutHeight(doc))} m cut holds walls and columns`);
    if (!body || insideDeck(deck, [body])) return null;
    // On the rectangle but over a hole: a row on the deck stands over it, a post up to it reaches a hole (stairwell.18).
    if (!insideDeck({ ring: deck.ring, holes: [] }, [body]) || !overHole(deck, [body])) return both(`reaches past ${deckLabel(deck)}'s edge`);
    return both(`${verb === "stand on" ? "stands over" : "reaches up to"} a hole in ${deckLabel(deck)}`);
  };
  const refs = deckRefs(w);
  if (refs.base !== null) {
    const deck = deckView(doc, refs.base);
    const problem = deck ? onDeck(deck, "stand on") : missing("stands on a missing deck");
    if (problem) return problem;
  }
  const line = w.column ? (columnOf(doc, w.id)?.line ?? null) : null;
  if (refs.top !== null) {
    if (!w.column || line || refs.base !== null) return both("can't reach up to a deck; only a free column on the floor can");
    const deck = deckView(doc, refs.top);
    const problem = deck ? onDeck(deck, "reach up to") : missing("reaches up to a missing deck");
    if (problem) return problem;
  }
  if (line?.some((id) => doc.walls[id]?.base !== w.base || doc.walls[id]?.top !== w.top)) {
    return { message: `${name} keeps the base and top of its wall's line`, plain: MESSAGES.columnKeepsWall };
  }
  return null;
}

/**
 * I21 (pillars.05, .23): a row's base is the floor or a deck that is a level, and a row on a deck lies inside it; a
 * deck as top goes only with a free column on the floor, the deck a level and the column within it; a column in a
 * wall's line has its walls' base and top. One violation per row, by ID. Then one base per joint (pillars.09): every
 * row at a joint has the same base, one violation per joint, by ID, skipping joints of rows already refused.
 */
export function wallRangeViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const problem = w ? rowProblem(doc, w) : null;
    const entities: EntityKey[] = [{ table: "walls", id }];
    if (problem) out.push({ invariant: "I21", ...problem, entities });
  }
  const refused = new Set(out.flatMap((v) => v.entities.map((e) => e.id)));
  for (const [joint, walls] of [...jointWalls(doc)].sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) {
    if (walls.some((id) => refused.has(id)) || new Set(walls.map((id) => doc.walls[id]?.base)).size < 2) continue;
    const entities: EntityKey[] = [{ table: "joints", id: joint }, ...walls.map((id): EntityKey => ({ table: "walls", id }))];
    out.push({ invariant: "I21", message: `Walls at joint ${joint} stand on different bases`, plain: MESSAGES.oneBasePerJoint, entities });
  }
  return out;
}
