import type { Document } from "./model";

/**
 * Caches a query by document identity: documents are immutable values, so a result stays right for as long as its
 * document lives. Results are shared by every caller, so read-only.
 */
export function memo<T>(fn: (doc: Document) => T): (doc: Document) => T {
  const cache = new WeakMap<Document, T>();
  return (doc) => {
    const hit = cache.get(doc);
    if (hit !== undefined) return hit;
    const value = fn(doc);
    cache.set(doc, value);
    return value;
  };
}
