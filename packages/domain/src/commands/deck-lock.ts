import { MESSAGES, domainError, rowWords, type DomainError } from "../errors";
import { sortedIds } from "../graph";
import type { Document } from "../model";
import { deckLabel } from "../queries/decks";
import { deckRefs } from "../wall-ranges";

// The deck lock (pillars.05, .23): a deck that a wall or column row references, as its base or its top, keeps its
// place, size and turn and stays, as decks.13 keeps a deck carrying pieces from turning. Raising, lowering and `solid`
// move the rows' ends with it, and validation decides.

/**
 * The refusal when a row other than those in `going` (deleted by the same command) references deck `deckId`, naming
 * the first by ID for Claude and in plain words for people ("A column stands on Loft; move it first"), or null.
 */
export function lockDeck(doc: Document, deckId: string, going: ReadonlySet<string> = new Set()): DomainError | null {
  const deck = doc.decks[deckId];
  if (!deck) return null;
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const refs = w && !going.has(id) ? deckRefs(w) : null;
    if (!w || !refs || (refs.base !== deckId && refs.top !== deckId)) continue;
    const { name, kind } = rowWords(id, w.column);
    const top = refs.base !== deckId;
    const message = MESSAGES.deckHolds(name, deckLabel(deck), top);
    const plain = MESSAGES.deckHolds(`A ${kind}`, deckLabel(deck), top);
    return domainError("invalid", message, [{ invariant: "I21", message, plain, entities: [{ table: "decks", id: deckId }, { table: "walls", id }] }]);
  }
  return null;
}
