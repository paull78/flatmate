import { DECK_SIDES, type Deck, type DeckSide } from "../model";

// A deck's sides as people see them (edges.05): named by where each faces on the plan now, so turning a deck renames
// its sides while each keeps its guard. Stored sides are front, right, back, left in the deck's own frame (model.ts).

/** Where a side faces on the plan, y up: the names people and Claude use. */
export const PLAN_SIDES = ["upper", "right", "lower", "left"] as const;
export type PlanSide = (typeof PLAN_SIDES)[number];

/** The plan names counter-clockwise from the one an unturned deck's front faces (−y): front, right, back, left. */
const AROUND: readonly PlanSide[] = ["lower", "right", "upper", "left"];

/**
 * How many quarter turns the deck's rotation (whole degrees 0–359, counter-clockwise) is nearest: 45° still counts as
 * none, 46° as one, so each side gets a different name at every angle.
 */
function quarters(rotation: number): number {
  return Math.floor((((rotation % 360) + 360) % 360 + 44) / 90) % 4;
}

/** A side's name on the plan now. */
export function sideName(deck: Pick<Deck, "rotation">, side: DeckSide): PlanSide {
  return AROUND[(DECK_SIDES.indexOf(side) + quarters(deck.rotation)) % 4] ?? "lower";
}

/** The stored side a plan name is now. */
export function sideAt(deck: Pick<Deck, "rotation">, name: PlanSide): DeckSide {
  return DECK_SIDES.find((s) => sideName(deck, s) === name) ?? "front";
}

export function isPlanSide(v: unknown): v is PlanSide {
  return PLAN_SIDES.some((s) => s === v);
}
