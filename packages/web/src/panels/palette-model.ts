import { OBJECT_KINDS, isFurnitureSet, type PaletteCard, type PaletteGroup, type UiAction, type ViewModel } from "@fm/editor";

// The palette's rail and cards as plain data (library.02, .04), so tests need no DOM: the rail's groups and labels, the
// group this viewer last opened, and what a card sends and when it is pressed.

/** The last rail group, after the editor's object groups: floor finishes (finishes.08). */
export const FLOORS = "Floors";
/** The browser storage key for the group this viewer last opened. */
export const GROUP_KEY = "fm.paletteGroup";
const FIRST_GROUP = "Sleep";
/** Rail labels shorter than their group's name; the others show the name. */
const SHORT_LABEL: Readonly<Record<string, string>> = { "Sit and eat": "Sit & eat" };

/** The part of `Storage` the palette uses. */
export type GroupStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** The rail's groups, in order: the editor's object groups, then Floors. */
export function railGroups(palette: readonly PaletteGroup[]): string[] {
  return [...palette.map((g) => g.group), FLOORS];
}

export function railLabel(group: string): string {
  return SHORT_LABEL[group] ?? group;
}

/**
 * The group to show first: the stored one when it is still a rail group, else Sleep (or the first group). Storage may
 * be missing or throw (private windows, blocked site data), so it is only a convenience.
 */
export function readGroup(storage: () => GroupStorage | null, groups: readonly string[]): string {
  const stored = storedGroup(storage);
  if (stored !== null && groups.includes(stored)) return stored;
  return groups.includes(FIRST_GROUP) ? FIRST_GROUP : (groups[0] ?? FIRST_GROUP);
}

function storedGroup(storage: () => GroupStorage | null): string | null {
  try {
    return storage()?.getItem(GROUP_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Remembers the group for this viewer, silently when storage is missing or throws. */
export function writeGroup(storage: () => GroupStorage | null, group: string): void {
  try {
    storage()?.setItem(GROUP_KEY, group);
  } catch {
    // the group is just not remembered
  }
}

/** A preset card's preset label, which `pickPreset` and the size picker use (the card carries the preset's id). */
function presetLabel(card: PaletteCard): string | null {
  if (card.preset === null) return null;
  return OBJECT_KINDS.find((k) => k.id === card.kind)?.presets.find((p) => p.id === card.preset)?.label ?? null;
}

/** What a card's click sends: arm its kind, then, for a preset card, its preset (as quick add's `pickActions`). */
export function cardActions(card: PaletteCard): UiAction[] {
  if (isFurnitureSet(card.kind)) return [{ type: "pickSet", set: card.kind }];
  const arm: UiAction = { type: "pickKind", kind: card.kind };
  const label = presetLabel(card);
  return label === null ? [arm] : [arm, { type: "pickPreset", kind: card.kind, preset: label }];
}

/** A card is pressed while the Object tool is armed with its kind and, for a preset card, at its preset. */
export function cardPressed(card: PaletteCard, view: ViewModel): boolean {
  if (view.activeTool !== "object" || view.objectKind !== card.kind) return false;
  return card.preset === null || (view.sizePicker?.kind === card.kind && view.sizePicker.current === presetLabel(card));
}
