import type { CardOrder } from "@fm/editor";

// The list's order is this browser's own (cards.05), remembered as the palette remembers its group: a convenience, so blocked
// or broken storage just means Name.

const KEY = "fm.cardOrder";

type OrderStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function readCardOrder(storage: () => OrderStorage | null): CardOrder {
  try {
    return storage()?.getItem(KEY) === "recent" ? "recent" : "name";
  } catch {
    return "name";
  }
}

export function writeCardOrder(storage: () => OrderStorage | null, order: CardOrder): void {
  try {
    storage()?.setItem(KEY, order);
  } catch {
    // Not remembered: the choice still holds for this visit.
  }
}

/** This browser's storage, or null where there is none (no window, or access blocked). */
export function browserStorage(): OrderStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
