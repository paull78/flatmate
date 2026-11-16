import { STAIR_EDGE_MESSAGES, deckLabel, deckView, kindOf, shown, stairGeometry, stairRuleOf, type Document } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import { liveOffer, redReason, shownOffer } from "../tools/stair-fixes";
import { shapeFor, stairAsk, turnsAt } from "../tools/stair-gesture";
import type { ObjectGhost, ObjectToolState, StairGesture } from "../tools/types";
import type { CommandChip } from "./view-model-types";

// The hint line's prompt while a stair kind is armed (spec "Hints and fixes", stairdraw.12): one per state of the
// gesture, all the stair's tool text in one place. A red ghost says how short it is (stairdraw.19), else the commit's
// refusal, as the click's toast would. Before click 1 its chips are live and the prompt asks for click 1. Click 1 on a
// red straight flight pins its offer: while the top is fixed the line shows that offer's prompt and chips, whatever
// the swing shows, so the chips don't move under a hand heading for them (stairdraw.13, .48).
//
//   no edge caught ──► hover (fits) ──click 1──► (can't turn there: placed) fixed: straight | doesn't turn | too low for an L | an L
//                       └ red: reason + "Click to fix the top"  ──click 1──► the pinned offer, fixed
//                       └ red, no fix: nothing fits                          └ no offer, a red L: its refusal

const NO_EDGE = "Move near a deck's edge to go up to it, or click to place a stair that reaches nothing";
const NOTHING_FITS = "Doesn't fit here: slide along the edge or try another edge";
const FIX_THE_TOP = "Click to fix the top, then pick a fix";

/** The prompt for the Object tool with a stair kind armed; null when the armed kind isn't a stair. */
export function stairHint(state: EditorState, tool: ObjectToolState): string | null {
  const hint = stairPrompt(state, tool);
  const numbers = hint !== null && tool.stair !== null && tool.ghost?.fits === true ? ghostNumbers(tool.ghost) : null;
  return numbers === null ? hint : `${hint} · ${numbers}`;
}

/**
 * What a ghost that fits will be (AC-09): "12 risers × 0.179 · going 0.28 · run 3.08". An L reads its whole count and the
 * going, its runs being two; a ladder its rungs; a spiral has no going or run to read.
 */
function ghostNumbers(ghost: ObjectGhost): string | null {
  const rule = stairRuleOf(ghost.kind);
  if (rule === null || ghost.h === undefined) return null;
  const whole = stairGeometry(rule, ghost.w, ghost.d, ghost.h, null);
  const flight = stairGeometry(rule, ghost.w, ghost.d, ghost.h - (ghost.base ?? 0), null); // an L's upper flight, from the landing
  const count = `${whole.risers} ${rule.shape === "ladder" ? "rungs" : "risers"} × ${shown(whole.riser, 3)}`;
  if (rule.shape === "spiral") return count;
  return ghost.l ? `${count} · going ${shown(flight.going, 2)}` : `${count} · going ${shown(flight.going, 2)} · run ${shown(flight.run, 2)}`;
}

function stairPrompt(state: EditorState, tool: ObjectToolState): string | null {
  const rule = stairRuleOf(state.objectKind);
  if (rule === null) return null;
  const doc = state.document ? visibleDoc(state.document) : null;
  const { stair, ghost } = tool;
  if (doc === null || stair === null || ghost === null) return NO_EDGE;
  if (stair.phase === "fixed" && tool.offer) return tool.offer.prompt;
  if (!ghost.fits) return redHint(state, tool, stair);
  switch (stair.phase) {
    case "hover": {
      const ask = stairAsk(state);
      const one = ask !== null && !turnsAt(doc, ask, stair.edge, ghost.at); // the ghost's at: its back's middle on the edge; one click places it (stairdraw.56, .58)
      return `Click to ${one ? "place it" : "start the stair"} here, up to the ${deckName(doc, stair.edge.deck)}`;
    }
    case "fixed":
      return fixedHint(stair, ghost, rule.turns, kindOf(state.objectKind)?.label ?? "This kind", stair.cursor);
    default:
      return assertNever(stair);
  }
}

/**
 * After click 1, with a ghost that fits: what click 2 places. A stair that can't turn there is here only while its
 * press is held (click 1 places it, stairdraw.56, .58): the release places it, and the line says why it stays straight.
 */
function fixedHint(stair: Extract<StairGesture, { phase: "fixed" }>, ghost: ObjectGhost, turns: boolean, kindLabel: string, cursor: Point): string {
  if (!turns) return `Release to place. ${STAIR_EDGE_MESSAGES.doesNotTurn(kindLabel)}. Esc cancels`;
  if (ghost.l) return `Click to place the L: two flights and a landing at +${shown(ghost.l.landing.top)}`;
  // The shape the cursor asks for, as for a kind that turns: an L drawn straight is one too low to turn (stairdraw.35).
  const asked = shapeFor(stair.edge, stair.at, cursor, true);
  if (asked !== "straight") return `Release to place. ${STAIR_EDGE_MESSAGES.tooLowToTurn(kindLabel)}. Esc cancels`;
  return "Click to place, or move sideways for an L. Esc cancels";
}

/** A red ghost's prompt with no pinned offer: hovering, its reason and a pointer to click 1, or that nothing fits; fixed, an L's refusal, or that nothing fits. */
function redHint(state: EditorState, tool: ObjectToolState, stair: StairGesture): string {
  switch (stair.phase) {
    case "hover": {
      const offer = liveOffer(state, tool);
      return offer ? `${offer.prompt}. ${FIX_THE_TOP}` : NOTHING_FITS;
    }
    case "fixed":
      return tool.ghost?.l ? redReason(state, tool) : NOTHING_FITS;
    default:
      return assertNever(stair);
  }
}

/** The hint line's fix chips (stairdraw.13, .48): live before click 1, pinned after it; none otherwise. */
export function stairChips(state: EditorState): readonly CommandChip[] {
  if (state.tool.name !== "object" || stairRuleOf(state.objectKind) === null) return [];
  return (shownOffer(state, state.tool.state)?.chips ?? []).map(({ id, label, detail }) => ({ id, label, ...(detail === undefined ? {} : { detail }) }));
}

function deckName(doc: Document, id: string): string {
  const deck = deckView(doc, id);
  return deck ? deckLabel(deck) : "deck";
}
