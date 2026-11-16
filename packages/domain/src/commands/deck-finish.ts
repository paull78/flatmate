import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError } from "../errors";
import { sameFinish } from "../finishes";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { isValidId } from "../shape";
import { checkedFinish } from "./labels";
import type { CommandOf, CommandResult } from "./types";

/**
 * Sets or clears a deck's finish (deck-floors.01, .04) with a label's checks; the deck row is its only dependency, as
 * the label is setFinish's, so a finish edit never waits on the pieces the deck carries.
 */
export function setDeckFinish(doc: Document, cmd: CommandOf<"setDeckFinish">): CommandResult {
  const deck = isValidId(cmd.deckId) ? doc.decks[cmd.deckId] : undefined;
  if (!deck) return err(domainError("notFound", "Deck not found"));
  const finish = checkedFinish(cmd.finish, "floor");
  if (!finish.ok) return finish;
  const deps: EntityKey[] = [{ table: "decks", id: cmd.deckId }];
  if (sameFinish(deck.finish, finish.value)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, decks: { ...doc.decks, [cmd.deckId]: { ...deck, finish: finish.value } } };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
