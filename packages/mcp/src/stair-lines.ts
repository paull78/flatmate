import { assertNever } from "@fm/protocol";
import { deckView, placementRange, shown, sortedIds, stairBase, stairChecks, stairGeometry, stairRuleOf, stairTurn, WINDERS, type Document, type FlightRails, type HandrailKind, type StairGeometry, type StairRule } from "@fm/domain";
import { stairCheckText } from "@fm/editor";

// A stair's line in get_drawing (stairs.20, .29, .49): the deck it starts at, what it reaches and its derived numbers,
// and its warnings worded from the domain's structured checks, in the editor's one wording (stair-text.ts), as
// Properties shows them. The MCP computes no stair rule: the numbers are stairGeometry's and stairChecks', read from
// the first copy (copies agree, stairs.18), counted from where its steps begin (stairBase).

/**
 * "starts at Platform +1.08, reaches Loft +2.15, 6 risers of 0.178, going 0.274, run 1.37" (a spiral: "…, turn 270°,
 * diameter 1.60"), its rails (guards.28): a flight's left and right as you walk up, a spiral's one (edges.06), left out on a rung
 * ladder, which has none; and the failed checks, worded.
 */
export type StairLine = { line: string; handrail?: HandrailKind; handrails?: FlightRails; warnings: string[] };

/** A stair object's line, or null for furniture (and for a stair with no copy, which a valid drawing doesn't have). */
export function stairLine(doc: Document, objectId: string): StairLine | null {
  const object = doc.objects[objectId];
  const rule = object ? stairRuleOf(object.kind) : null;
  const first = sortedIds(doc.placements).find((id) => doc.placements[id]?.object === objectId);
  const p = first === undefined ? undefined : doc.placements[first];
  const range = first === undefined ? null : placementRange(doc, first);
  const base = first === undefined ? null : stairBase(doc, first);
  const [w, d] = p && object ? [object.w[p.config], object.d[p.config]] : [undefined, undefined];
  if (!object || !rule || !range || base === null || w === undefined || d === undefined) return null;
  const g = stairGeometry(rule, w, d, range.top - base, object.riser ?? null);
  const deck = typeof object.reaches === "string" ? deckView(doc, object.reaches) : null;
  const start = typeof object.startsAt === "string" ? deckView(doc, object.startsAt) : null;
  const reach = deck === null ? "reaches nothing" : `reaches ${deck.name} +${shown(deck.top)}`;
  const from = start === null ? "" : `starts at ${start.name} +${shown(start.top)}, `;
  const target = object.riser === undefined ? "" : `, target riser ${shown(object.riser)}`;
  const line = `${from}${reach}, ${g.risers} risers of ${shown(g.riser, 3)}${target}, ${pace(rule, g)}`;
  return { line, ...(object.handrail === undefined ? {} : { handrail: object.handrail }), ...(object.handrails === undefined ? {} : { handrails: { ...object.handrails } }), warnings: stairChecks(doc, objectId).filter((c) => !c.ok).map((c) => stairCheckText(doc, c)) };
}

/** How the steps advance: a flight's or a ladder's going and run, a spiral's turn and diameter (stairs.21). */
function pace(rule: StairRule, g: StairGeometry): string {
  switch (rule.shape) {
    case "flight":
    case "ladder":
      return `going ${shown(g.going, 3)}, run ${shown(g.run)}`;
    case "winder": // its straight treads' going (steps.04)
      return `${WINDERS} winders, going ${shown(g.going, 3)}, run ${shown(g.run)}`;
    case "spiral":
      return `turn ${shown(stairTurn(rule, g.treads), 0)}°, diameter ${shown(g.run)}`;
    default:
      return assertNever(rule.shape);
  }
}
