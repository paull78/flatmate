import { deckViews, orderedStates, type Document } from "@fm/domain";
import type { ProjectListing } from "@fm/protocol";
import type { EditorState } from "../state";
import { cardFrame3d } from "../view3d-state";
import { shellBounds } from "../view3d/camera3d";
import { pictureBounds, pictureLayers, planPicture } from "./picture";
import { CARD_STYLE } from "./card-look";
import { floorView } from "./plan-view";
import type { CardPicture, ProjectCard } from "./view-model-types";

// The project list's cards (cycle cards): a project's colour and its plan, drawn in the browser from its drawing (cards.02).

/** Pale colours at one lightness, none near a wood floor (cards.01). A project keeps one, picked from its id. */
export const CARD_COLOURS: readonly string[] = [
  "#fae3e7", "#fce3df", "#fae5d6", "#f0eacc", "#e5eed4", "#dfefde", "#d7f0e6", "#d5f0ef", "#d8eef7", "#dcecfb", "#e3e9fd", "#ebe6fa", "#f4e3f3", "#f9e2ec",
];
const FALLBACK = "#efefec";

/** FNV-1a over the id: the same colour on every client and every load. */
export function cardColour(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return CARD_COLOURS[(h >>> 0) % CARD_COLOURS.length] ?? FALLBACK;
}

/** The picture's long side in drawing units, as the preview's pictures; one image per card scales it down. */
const LONG_SIDE = 1100;

const hasNothing = (doc: Document): boolean => Object.keys(doc.walls).length === 0 && deckViews(doc).length === 0 && Object.keys(doc.placements).length === 0;

const pictures = new WeakMap<Document, Map<string, CardPicture>>();

/** The plan of `layout` at floor level with no text on it, kept per document and layout: the view model rebuilds on every event. */
export function cardPicture(doc: Document, layout: string | null): CardPicture | null {
  if (hasNothing(doc)) return null;
  const key = layout ?? "";
  const known = pictures.get(doc)?.get(key);
  if (known) return known;
  const { min, max } = pictureBounds(doc, layout);
  const zoom = LONG_SIDE / Math.max(max.x - min.x, max.y - min.y);
  const plan = planPicture(doc, floorView(doc, layout), CARD_STYLE, zoom, true);
  const picture: CardPicture = { primitives: pictureLayers({ ...plan, tags: [], dimensions: [], deckLabels: [], marks: [], roof: [] }), frame: { min, max, zoom } };
  const kept = pictures.get(doc) ?? new Map<string, CardPicture>();
  kept.set(key, picture);
  pictures.set(doc, kept);
  return picture;
}

/** Last edited first, with no date counting as newest: a project just created. The server's order, by name, breaks ties. */
const byRecent = (a: ProjectListing, b: ProjectListing): number => (b.editedAt ?? Infinity) - (a.editedAt ?? Infinity) || 0;

/** The list as cards, in the viewer's order. */
export function projectCards(state: EditorState): ProjectCard[] {
  const { projects, order, cards, hover, layouts: chosen, cardFlip } = state.workspace;
  const shownOrder = order === "recent" ? [...projects].sort(byRecent) : projects;
  return shownOrder.map((p) => {
    const base = { id: p.id, name: p.name, colour: cardColour(p.id), picture: null, canTurn: false, view3d: null, layouts: null };
    const drawing = Object.hasOwn(cards, p.id) ? cards[p.id] : undefined;
    if (!drawing) return { ...base, status: "unseen" };
    if (drawing.status !== "ready") return { ...base, status: drawing.status };
    const all = orderedStates(drawing.doc);
    const index = Math.max(0, all.findIndex((l) => l.id === (Object.hasOwn(chosen, p.id) ? chosen[p.id] : undefined)));
    const shown = all[index] ?? null;
    const layout = shown?.id ?? null;
    const picture = cardPicture(drawing.doc, layout);
    const flip = cardFlip?.id === p.id ? cardFlip : null;
    const view3d = hover?.id === p.id && layout !== null ? cardFrame3d(drawing.doc, layout, flip, hover.yaw, hover.tilt) : null;
    const layouts = shown !== null && all.length > 1 ? { name: shown.name, index, count: all.length } : null;
    return { ...base, status: picture ? "ready" : "empty", picture, canTurn: layout !== null && shellBounds(drawing.doc) !== null, view3d, layouts };
  });
}
