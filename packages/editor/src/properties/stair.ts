import type { Point } from "@fm/protocol";
import { convexOverlap, footprintQuad, type HoleView, configsOf, deckViews, hasHandrails, isHandrailKind, placementRange, recommendedRun, roundMm, shown, stairBase, stairChecks, stairGeometry, type Command, type Document, type LayoutObject, type Placement, type StairCheck, type StairRule } from "@fm/domain";
import { deckTitle } from "../view/deck-label";
import { stairCheckLabel, stairCheckText } from "../view/stair-text";
import type { Field } from "../view/view-model-types";
import { field, holeRows, numberField, parseNumber, withOptions, type FieldCommand } from "./fields";

// A stair's Stair section (stairs.15, .20, AC-11), in place of Size and Height: width and run (a spiral's diameter),
// Reaches (the decks and Nothing), Starts at (read-only, stairs.49), the rise (typed only when it reaches nothing and
// starts at its surface), Fit run, the target riser (riser.10), the derived risers, the going and slope, Handrail (Railing or
// Glass, on a stair with rails, guards.28) and the domain's checks as ticks and warnings. Every number comes from the domain's queries;
// this module only formats them, with the one display format.

const SECTION = "Stair";
const NOTHING = "nothing"; // never a deck's ID, which always holds a "/" (`${opId}/k0`)
const HANDRAIL_OPTIONS = [{ value: "railing", label: "Railing" }, { value: "glass", label: "Glass" }, { value: "none", label: "None" }];

/** The rise: what the stair's steps span, from where they begin to the placement's top (heights.27, stairs.49). */
function riseOf(doc: Document, p: Placement): number {
  const range = placementRange(doc, p.id);
  return range ? range.top - (stairBase(doc, p.id) ?? range.bottom) : 0;
}

/** "Starts at Platform +1.08", read-only, when the stair starts at a deck's edge (stairs.49); else nothing. */
function startsAtField(doc: Document, object: LayoutObject): Field[] {
  const deck = typeof object.startsAt === "string" ? deckViews(doc).find((d) => d.id === object.startsAt) : undefined;
  return deck ? [field(SECTION, "startsAt", "Starts at", deckTitle(deck), null)] : [];
}

/** The decks a stair may reach: every deck but the one it stands on, which it can't reach. */
const reachable = (doc: Document, p: Placement) => deckViews(doc).filter((d) => d.id !== p.deck);

/** The holes a stair's footprint overlaps, by deck: what it rises through (riser.20). */
function holesThrough(doc: Document, quad: readonly Point[]): HoleView[] {
  return deckViews(doc).flatMap((deck) => deck.holes.filter((h) => convexOverlap(h.ring, quad)));
}

export function stairFields(doc: Document, p: Placement, object: LayoutObject, rule: StairRule): Field[] {
  const w = object.w[p.config] ?? 0;
  const d = object.d[p.config] ?? 0;
  const rise = riseOf(doc, p);
  const linked = typeof object.reaches === "string" || typeof object.startsAt === "string"; // its rise follows a deck
  const spiral = rule.shape === "spiral";
  const target = object.riser ?? null;
  const g = stairGeometry(rule, w, d, rise, target);
  const reaches = { ...field(SECTION, "reaches", "Reaches", object.reaches ?? NOTHING, null, false), select: true };
  const options = [...reachable(doc, p).map((deck) => ({ value: deck.id, label: deckTitle(deck) })), { value: NOTHING, label: "Nothing" }];
  return [
    numberField(SECTION, "width", spiral ? "Diameter" : "Width", shown(w), "m", 0.01),
    ...(spiral ? [] : [numberField(SECTION, "depth", "Run", shown(d), "m", 0.01)]),
    { ...reaches, options },
    ...holeRows(SECTION, "Through", holesThrough(doc, footprintQuad(p.at, w, d, p.rotation))),
    ...startsAtField(doc, object),
    linked ? field(SECTION, "rise", "Rise", shown(rise), "m") : numberField(SECTION, "rise", "Rise", shown(rise), "m", 0.01),
    ...(spiral ? [] : [{ ...field(SECTION, "fitRun", "Fit run", shown(recommendedRun(rule, rise, target, w)), "m", shown(recommendedRun(rule, rise, target, w)) === shown(d)), action: true }]),
    { ...field(SECTION, "targetRiser", rule.shape === "ladder" ? "Target spacing" : "Target riser", target === null ? "" : shown(target), "m", false), placeholder: shown(rule.maxRiser) },
    field(SECTION, "risers", "Risers", `${g.risers} × ${shown(g.riser, 3)}`, null),
    spiral ? field(SECTION, "going", "Going", shown(g.going, 3), "m") : numberField(SECTION, "going", "Going", shown(g.going, 3), "m", 0.01),
    ...(spiral ? [] : [field(SECTION, "slope", "Slope", shown((Math.atan(g.riser / g.going) * 180) / Math.PI, 1), "°")]),
    // A flight's rails by side, as you walk up; a spiral's one (edges.06).
    ...(hasHandrails(rule) && object.handrails !== undefined ? [
      withOptions(field(SECTION, "handrailLeft", "Left handrail", object.handrails.left, null, false), HANDRAIL_OPTIONS),
      withOptions(field(SECTION, "handrailRight", "Right handrail", object.handrails.right, null, false), HANDRAIL_OPTIONS),
    ] : []),
    ...(hasHandrails(rule) && object.handrail !== undefined ? [withOptions(field(SECTION, "handrail", "Handrail", object.handrail, null, false), HANDRAIL_OPTIONS)] : []),
    ...stairChecks(doc, object.id).map((c) => checkField(doc, c)),
  ];
}

/**
 * `reaches` links the stair to an offered deck, or to nothing; `rise` sets its height in every configuration while it
 * reaches nothing; `handrail` sets a spiral's Railing, Glass or None, `handrailLeft` and `handrailRight` a flight's sides; `fitRun` sets every configuration's run to the kind's recommended
 * run for the rise, to the millimetre, the width unchanged. Null for another field.
 */
export function stairFieldCommand(doc: Document, p: Placement, object: LayoutObject, rule: StairRule, fieldId: string, value: string): FieldCommand | undefined {
  const w = object.w[p.config] ?? 0;
  const every = (v: number): Record<string, number> => Object.fromEntries(configsOf(object).map((c) => [c.id, v]));
  switch (fieldId) {
    case "reaches": {
      if (value === NOTHING) return { type: "setStairReaches", objectId: object.id, deck: null };
      return reachable(doc, p).some((d) => d.id === value) ? { type: "setStairReaches", objectId: object.id, deck: value } : null;
    }
    case "rise": {
      if (typeof object.reaches === "string" || typeof object.startsAt === "string") return null; // read-only, as shown
      const n = parseNumber(value);
      return Number.isFinite(n) ? { type: "setObjectSize", objectId: object.id, w, d: {}, h: every(n) } : "notANumber";
    }
    case "targetRiser": {
      if (value.trim() === "") return { type: "setStair", objectId: object.id, riser: null };
      const n = parseNumber(value);
      return Number.isFinite(n) ? { type: "setStair", objectId: object.id, riser: n } : "notANumber";
    }
    case "going": {
      const n = parseNumber(value);
      return Number.isFinite(n) ? { type: "setStair", objectId: object.id, going: n } : "notANumber";
    }
    case "handrail":
      return isHandrailKind(value) ? { type: "setStair", objectId: object.id, handrail: value } : null; // a value no choice offers is ignored
    case "handrailLeft":
      return isHandrailKind(value) ? { type: "setStair", objectId: object.id, handrailLeft: value } : null;
    case "handrailRight":
      return isHandrailKind(value) ? { type: "setStair", objectId: object.id, handrailRight: value } : null;
    case "fitRun":
      return { type: "setObjectSize", objectId: object.id, w, d: every(roundMm(recommendedRun(rule, riseOf(doc, p), object.riser ?? null, w))) } satisfies Command;
    default:
      return undefined;
  }
}

/** "Riser 0.215 m (0.178–0.305 wanted)", "Going 0.167 m (0.221 wanted)", "Doesn't reach the Loft": one read-only row each, a tick or a warning. */
function checkField(doc: Document, c: StairCheck): Field {
  return { ...field(SECTION, `check.${c.id}`, stairCheckLabel(c), stairCheckText(doc, c), null), check: c.ok ? "ok" : "warning" };
}
