import { LOGO_LONG_SIDE, MAX_LOGO_DATA_CHARS, MAX_UNDERLAY_DATA_CHARS, UNDERLAY_LONG_SIDE } from "@fm/protocol";

// A picture's re-encode budget (import.14, sheetset.21): a JPEG's size is known only after encoding, so the import adapter
// encodes, measures and asks for the next attempt. Pure: the adapter passes the encoder in.

/** One encode: the picture's long side in pixels and the JPEG quality. */
export type Attempt = { longSide: number; quality: number };

const START_QUALITY = 0.85;
const LOW_QUALITY = 0.6;
const SHRINK = 0.8;

/** What a picture may come to: its first long side, its cap in base64 characters, and the shortest long side worth trying. */
export type Budget = { longSide: number; maxChars: number; leastSide: number };
export const UNDERLAY_BUDGET: Budget = { longSide: UNDERLAY_LONG_SIDE, maxChars: MAX_UNDERLAY_DATA_CHARS, leastSide: 1000 };
export const LOGO_BUDGET: Budget = { longSide: LOGO_LONG_SIDE, maxChars: MAX_LOGO_DATA_CHARS, leastSide: 200 };

/**
 * The attempt after `previous` produced `encodedChars` base64 characters. It returns `previous` itself when that
 * fits (the stop signal). Over the cap, quality steps once to 0.6, then the long side shrinks by floor(×0.8); below
 * the budget's least side it gives up. `null` starts at the long-side cap.
 */
export function nextAttempt(previous: Attempt | null, encodedChars: number, budget: Budget = UNDERLAY_BUDGET): Attempt | "giveUp" {
  if (previous === null) return { longSide: budget.longSide, quality: START_QUALITY };
  if (encodedChars <= budget.maxChars) return previous;
  if (previous.quality > LOW_QUALITY) return { longSide: previous.longSide, quality: LOW_QUALITY };
  const longSide = Math.floor(previous.longSide * SHRINK);
  return longSide < budget.leastSide ? "giveUp" : { longSide, quality: previous.quality };
}

/** The encode size: the natural size fitted to `longSide` in whole pixels, never upscaled, never 0. */
export function targetSize(natural: { width: number; height: number }, longSide: number): { width: number; height: number } {
  const long = Math.max(natural.width, natural.height);
  if (long <= longSide) return { width: natural.width, height: natural.height };
  const fit = (side: number): number => (side === long ? longSide : Math.max(1, Math.round((side * longSide) / long)));
  return { width: fit(natural.width), height: fit(natural.height) };
}

/** Encodes until an attempt fits the cap; "tooLarge" once the long side would drop below the budget's least side. */
export async function encodeWithinBudget(encode: (a: Attempt) => Promise<string>, budget: Budget = UNDERLAY_BUDGET): Promise<{ data: string; attempt: Attempt } | "tooLarge"> {
  let attempt = nextAttempt(null, 0, budget);
  while (attempt !== "giveUp") {
    const data = await encode(attempt);
    const next = nextAttempt(attempt, data.length, budget);
    if (next === attempt) return { data, attempt };
    attempt = next;
  }
  return "tooLarge";
}
