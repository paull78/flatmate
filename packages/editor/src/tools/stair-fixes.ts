import { dot, kindOf, shown, stairFits, stairOnEdge, stairRuleOf, stairShortfall, stairZonesFree, sub, type Document, type StairEdge, type StairEdgeShape, type StairParts, type StairRequest } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { visibleDoc } from "../document/open-document";
import type { EditorState } from "../state";
import { refusalText } from "../toast-text";
import { memoLast } from "../view/memo";
import { PALETTE_KINDS } from "../view/palette";
import { stairAsk, stairGhost } from "./stair-gesture";
import type { ObjectGhost, ObjectToolState, StairFix, StairOffer } from "./types";

// The fix chips for a stair that doesn't fit on its edge (stairdraw.13, spec "Hints and fixes"), and how short it is
// (stairdraw.19). Each chip is a whole stairOnEdge request, at the same point on the edge, that the commit's fit
// accepts, so a click places exactly what its hover previewed. Worked out only while the ghost is red, and memoised
// on the document and the request, so a pointer move over a green ghost costs nothing extra. Before click 1 the chips
// are live, from the ghost under the cursor; click 1 on a red straight flight pins them in the tool's state, and
// while the top is fixed only they show (stairdraw.48).
//
//   straight, red:  Make it an L (the side whose zones stay free, else the cursor's; else the other if it doesn't fit) · other kinds whose straight flight fits, with their run
//   an L, red:      Turn the other way · Keep it straight · other kinds that turn, as the same L

/** The side an L turns to, seen from the floor facing the edge. */
export type LSide = Exclude<StairEdgeShape, "straight">;

/** At most this many chips show. */
export const MAX_FIXES = 3;
/** The stair kinds in palette order: the order "other kinds" are offered in. */
const STAIR_KINDS: readonly string[] = PALETTE_KINDS.flatMap((g) => g.cards.map((c) => c.kind)).filter((id) => stairRuleOf(id) !== null);

const other = (side: LSide): LSide => (side === "l-left" ? "l-right" : "l-left");
const labelOf = (kind: string): string => kindOf(kind)?.label ?? kind;

/**
 * The fixes for `req`, a stair that doesn't fit, in the spec's order, at most MAX_FIXES, each fitting. "Make it an L"
 * prefers the side whose use zones stay free (stairdraw.60), else `side`, the cursor's.
 */
export function stairFixes(doc: Document, req: StairRequest, side: LSide): StairFix[] {
  const fixes: StairFix[] = [];
  const fitting = (r: StairRequest): StairParts | null => {
    const parts = stairOnEdge(doc, r);
    return parts.ok && stairFits(doc, parts.value, r.state).ok ? parts.value : null;
  };
  const offer = (r: StairRequest, label: string, detail?: (p: StairParts) => string): boolean => {
    if (fixes.length >= MAX_FIXES) return false;
    const parts = fitting(r);
    if (parts) fixes.push({ id: `${r.kind}/${r.shape}`, label, ...(detail ? { detail: detail(parts) } : {}), request: r });
    return parts !== null;
  };
  const zonesFree = (r: StairRequest): boolean => {
    const parts = fitting(r);
    return parts !== null && stairZonesFree(doc, parts, r.state);
  };
  const others = STAIR_KINDS.filter((k) => k !== req.kind);
  if (req.shape === "straight") {
    if (stairRuleOf(req.kind)?.turns) {
      // The side whose use zones stay free first, else the cursor's (stairdraw.60); the other side if that one doesn't fit.
      const first = [side, other(side)].find((s) => zonesFree({ ...req, shape: s })) ?? side;
      if (!offer({ ...req, shape: first }, "Make it an L")) offer({ ...req, shape: other(first) }, "Make it an L");
    }
    for (const kind of others) offer({ ...req, kind, shape: "straight" }, labelOf(kind), (p) => `${shown(p.flights[0]?.d ?? 0)} m`);
    return fixes;
  }
  offer({ ...req, shape: other(req.shape) }, "Turn the other way");
  offer({ ...req, shape: "straight" }, "Keep it straight");
  for (const kind of others) if (stairRuleOf(kind)?.turns) offer({ ...req, kind }, labelOf(kind), () => "L");
  return fixes;
}

/** The red stair the gesture shows: its request and the cursor's side; null unless an edge is caught and its ghost doesn't fit. */
function redStair(state: EditorState, tool: ObjectToolState): { doc: Document; req: StairRequest; side: LSide } | null {
  const { stair, ghost } = tool;
  const ask = stairAsk(state);
  if (!stair || !ghost || ghost.fits || !ask || !state.document) return null;
  const at = stair.phase === "fixed" ? stair.at : ghost.at; // before click 1, the hovered point (stairdraw.13)
  const shape = ghost.shape ?? "straight";
  const side = shape === "straight" ? cursorSide(stair.edge, at, stair.cursor) : shape;
  return { doc: visibleDoc(state.document), req: { ...ask, deck: stair.edge.deck, at, shape }, side };
}

/** The side of `at` the cursor lies on, along the edge: the right is `normal` turned a quarter counter-clockwise (shapeFor). */
function cursorSide(edge: StairEdge, at: Point, cursor: Point): LSide {
  return dot(sub(cursor, at), { x: -edge.normal.y, y: edge.normal.x }) < 0 ? "l-left" : "l-right";
}

const fixesMemo = memoLast((doc: Document, state: string, kind: string, surface: string | null, deck: string, x: number, y: number, shape: StairEdgeShape, side: LSide) =>
  stairFixes(doc, { state, kind, surface, deck, at: { x, y }, shape }, side),
);
const shortfallMemo = memoLast((doc: Document, state: string, kind: string, surface: string | null, deck: string, x: number, y: number, shape: StairEdgeShape) => {
  const parts = stairOnEdge(doc, { state, kind, surface, deck, at: { x, y }, shape });
  return parts.ok ? stairShortfall(doc, parts.value, state) : null;
});

/** The offer the gesture's red ghost makes, live, on its edge; null while it fits, no edge is caught or no fix fits. */
export function liveOffer(state: EditorState, tool: ObjectToolState): StairOffer | null {
  const red = redStair(state, tool);
  if (!red || !tool.stair) return null;
  const { doc, req, side } = red;
  const chips = fixesMemo(doc, req.state, req.kind, req.surface, req.deck, req.at.x, req.at.y, req.shape, side);
  return chips.length === 0 ? null : { prompt: redReason(state, tool), chips, edge: tool.stair.edge };
}

/** The chips the hint line shows: once the top is fixed the ones pinned at click 1, before it the live ones (stairdraw.48). */
export function shownOffer(state: EditorState, tool: ObjectToolState): StairOffer | null {
  return tool.stair?.phase === "fixed" ? tool.offer : liveOffer(state, tool);
}

/** Why the gesture's red ghost won't place: how short it is (stairdraw.19), else the words the click's refusal toasts. */
export function redReason(state: EditorState, tool: ObjectToolState): string {
  const red = redStair(state, tool);
  const refused = tool.ghost?.refused && state.document ? refusalText(tool.ghost.refused, visibleDoc(state.document), null) : "Doesn't fit";
  if (!red) return refused;
  const { doc, req } = red;
  const shortfall = shortfallMemo(doc, req.state, req.kind, req.surface, req.deck, req.at.x, req.at.y, req.shape);
  return shortfall && "short" in shortfall ? `Doesn't fit: ${shown(shortfall.short)} m short` : refused;
}

/** The ghost an offered fix chip previews: its stair, on the offer's edge, as the gesture's ghost would draw it. */
export function fixGhost(doc: Document, fix: StairFix, offer: StairOffer): ObjectGhost | null {
  const { state, kind, surface, at, shape } = fix.request;
  return stairGhost(doc, { state, kind, surface }, offer.edge, at, shape);
}
