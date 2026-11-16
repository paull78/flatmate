// The sheet list's keyboard and drop (sheetset.13): pure, as web tests have no DOM (layout-states.38).

export type SheetKeyAction = { type: "focus"; index: number } | { type: "move"; index: number } | { type: "delete" } | { type: "select" };

type RowKey = { key: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean };

/** What a key does on the row at `index`. Null leaves it alone: ⌘Z is the view's, and so is an arrow past either end. */
export function sheetKey(e: RowKey, index: number, count: number): SheetKeyAction | null {
  if (e.metaKey || e.ctrlKey) return null;
  if (e.key === "Delete" || e.key === "Backspace") return { type: "delete" };
  if (e.key === "Enter" || e.key === " ") return { type: "select" };
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return null;
  const to = index + (e.key === "ArrowUp" ? -1 : 1);
  if (to < 0 || to >= count) return null;
  return { type: e.altKey ? "move" : "focus", index: to };
}

/** What a key does in the Add sheet menu: the arrows go round the items it can focus. */
export function menuKey(key: string, index: number, count: number): { type: "focus"; index: number } | { type: "close" } | null {
  if (key === "Escape") return { type: "close" };
  if (key === "ArrowDown") return { type: "focus", index: (index + 1) % count };
  if (key === "ArrowUp") return { type: "focus", index: (index - 1 + count) % count };
  return null;
}

/** A drop before or after `target`, as the moved sheet's place in the list once moved. */
export function dropIndex(ids: readonly string[], moved: string, target: string, after: boolean): number {
  return ids.filter((id) => id !== moved).indexOf(target) + (after ? 1 : 0);
}
