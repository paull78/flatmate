import { isRecord } from "@fm/protocol";
import { railFor, startRail } from "./commands/stairs";
import { railShape } from "./kinds";
import { sameRails, type Document, type HandrailKind, type LayoutObject } from "./model";
import { stairRise } from "./queries/stairs";

// A stair saved before the handrail setting gets it once on load, by the rule a new stair follows (`railFor`, guards.md).
// The rule needs the document's geometry, and the parser refuses a stair without rails, so the load has two halves: the
// fill before parsing gives such a stair a placeholder (serialize.ts), and `withLoadRails` replaces it after parsing.

/** The IDs of the stair rows with rails by kind and neither rails field: the ones the load chooses for. */
export function stairsWithoutRails(json: Record<string, unknown>): string[] {
  const { objects } = json;
  if (!isRecord(objects)) return [];
  return Object.entries(objects).flatMap(([id, o]) =>
    isRecord(o) && typeof o.kind === "string" && railShape(o.kind) !== null && !Object.hasOwn(o, "handrail") && !Object.hasOwn(o, "handrails") ? [id] : []);
}

const firstPlacement = (doc: Document, objectId: string) => Object.keys(doc.placements).sort().map((id) => doc.placements[id]).find((p) => p?.object === objectId);

/**
 * The rail a stair placed by `placeStair` would have got: an L's two flights are one stair, so the rule reads the deck
 * its upper flight reaches, where that flight's top arrives, and the rise from the surface its lower flight stands on.
 * A stair reaching nothing goes by its own height (`startRail`).
 */
function loadRail(doc: Document, object: LayoutObject): HandrailKind {
  const all = Object.values(doc.objects);
  const top = (typeof object.reaches === "string" ? all.find((o) => o.startsAt === object.reaches) : undefined) ?? object;
  const bottom = (typeof object.startsAt === "string" ? all.find((o) => o.reaches === object.startsAt) : undefined) ?? object;
  if (typeof top.reaches !== "string" || !Object.hasOwn(doc.decks, top.reaches)) return startRail(doc, object);
  const arrives = firstPlacement(doc, top.id);
  const stands = firstPlacement(doc, bottom.id);
  return railFor(doc, top.reaches, arrives?.at ?? null, stands ? stairRise(doc, top.reaches, stands.deck) : null);
}

/** `doc` with the rails of the stairs in `ids` chosen by the rule; other rows, and an ID that is no stair with rails, as they were. */
export function withLoadRails(doc: Document, ids: readonly string[]): Document {
  if (ids.length === 0) return doc;
  const objects = { ...doc.objects };
  for (const id of ids) {
    const object = doc.objects[id];
    const shape = object ? railShape(object.kind) : null;
    if (!object || shape === null) continue;
    const kind = loadRail(doc, object);
    objects[id] = shape === "spiral" ? { ...object, handrail: kind } : { ...object, handrails: sameRails(kind) };
  }
  return { ...doc, objects };
}
