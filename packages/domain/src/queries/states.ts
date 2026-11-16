import type { Document, LayoutState } from "../model";

/** Layout states in switcher order: by `order`, then by id (cleanup step 11: the switcher, the sheet, MCP and look). */
export function orderedStates(doc: Document): LayoutState[] {
  return Object.values(doc.states).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
