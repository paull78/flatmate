import type { Locator, Page } from "@playwright/test";
import { OBJECT_KINDS, PALETTE_KINDS } from "@fm/editor";

// The palette's rail and cards (library.02): one group's cards show at a time, so a spec picks the group on the rail
// before it clicks a card.

/** The rail group whose cards include `kind`. */
export function groupOfKind(kind: string): string {
  const group = PALETTE_KINDS.find((g) => g.cards.some((c) => c.kind === kind))?.group;
  if (group === undefined) throw new Error(`${kind} is in no palette group`);
  return group;
}

/** Shows a rail group's cards (Floors included). */
export async function showGroup(page: Page, group: string): Promise<void> {
  await page.locator(`.palette-rail-button[data-group="${group}"]`).click();
}

/** The id of the preset card at the kind's default size, or null for a kind with one card. */
function defaultPreset(kind: string): string | null {
  const presets = OBJECT_KINDS.find((k) => k.id === kind)?.presets ?? [];
  if (presets.length === 0 || presets.some((p) => p.seats === undefined)) return null;
  const w = PALETTE_KINDS.flatMap((g) => g.cards).find((c) => c.kind === kind)?.w;
  return presets.find((p) => w !== undefined && Math.abs(p.w - w) < 1e-9)?.id ?? null;
}

/** A kind's card: the one at `preset`, or else at the kind's default size. */
export function card(page: Page, kind: string, preset?: string): Locator {
  const id = preset ?? defaultPreset(kind);
  return page.locator(id === null ? `.palette-card[data-kind="${kind}"]` : `.palette-card[data-kind="${kind}"][data-preset="${id}"]`);
}

/** Arms a kind from its card: its group on the rail, then the card (as `card`). */
export async function pickCard(page: Page, kind: string, preset?: string): Promise<void> {
  await showGroup(page, groupOfKind(kind));
  await card(page, kind, preset).click();
}

/** The pressed cards (an armed kind's card, or the armed motif's) in the group shown. */
export const armedCards = (page: Page): Locator => page.locator('.palette-card[aria-pressed="true"]');
