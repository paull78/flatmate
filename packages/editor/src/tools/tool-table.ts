import type { ToolName } from "../types";
import type { ToolState } from "./types";

/**
 * A tool's row: `floorOnly` tools build what is edited at the floor level, so picking one there views the floor (levels.07);
 * the Wall and Column tools also work at a deck's level, building on the deck (pillars.09, .23).
 */
type ToolEntry = { tool: ToolName; label: string; key: string; floorOnly: boolean };

/**
 * The tools in the order the UI shows them, with their names and shortcut keys (spec: tools): `keys.ts` reads the keys,
 * the ViewModel lists them for the floating bar and the Properties empty state (arch-review R-01).
 */
export const TOOLS: readonly ToolEntry[] = [
  { tool: "select", label: "Select", key: "V", floorOnly: false },
  { tool: "wall", label: "Wall", key: "W", floorOnly: false },
  { tool: "zone", label: "Zone", key: "Z", floorOnly: true },
  { tool: "object", label: "Object", key: "O", floorOnly: false },
  { tool: "opening", label: "Opening", key: "D", floorOnly: false }, // at every level (sills.06)
  { tool: "dimension", label: "Dimension", key: "M", floorOnly: true },
  { tool: "section", label: "Section", key: "S", floorOnly: true },
  { tool: "column", label: "Column", key: "C", floorOnly: false },
  { tool: "deck", label: "Deck", key: "K", floorOnly: true },
  { tool: "hole", label: "Hole", key: "H", floorOnly: false },
];

/** The Scale tool (import.13): picked only from the Underlay section, so it has no key and no floating-bar button. */
export const SCALE_TOOL: ToolEntry = { tool: "scale", label: "Scale", key: "", floorOnly: true };

/**
 * Whether the tool as it stands builds only at the floor: its row's `floorOnly`, except the Zone tool's Floor mode,
 * which lays a finish on a deck at any level (deck-floors.02).
 */
export function floorOnlyNow(tool: ToolState): boolean {
  return tool.name === "zone" && tool.state.motif !== null ? false : toolEntry(tool.name).floorOnly;
}

/** A tool's row: the bar's tools, then Scale. */
export function toolEntry(name: ToolName): ToolEntry {
  return TOOLS.find((t) => t.tool === name) ?? (name === SCALE_TOOL.tool ? SCALE_TOOL : { tool: name, label: name, key: "", floorOnly: false });
}
