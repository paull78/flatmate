import { MESSAGES, deckViews, distance, execute, type Command, type DeckPreset, type Document, type EntityRef } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { runCommand } from "../commit";
import { visibleDoc } from "../document/open-document";
import type { PointerInput } from "../ports/events";
import type { Host } from "../ports/host";
import { footprintCorner, roundCm } from "../snapping/drawn-footprint";
import { switchTool, viewedLevelOn, type EditorState, type Step } from "../state";
import type { SnapResult } from "../types";
import { refuse } from "../toast";
import { reasonOf } from "../toast-text";
import { DRAG_THRESHOLD_PX } from "./hit-test";
import { PREVIEW_OP, type DeckToolState } from "./types";

/**
 * The Deck tool (spec "The Deck tool and editing", decks.06, .13): a press dragged past 4 px draws an axis-aligned
 * deck, both corners snapped to wall face corners, else onto faces, else the cm (Ctrl: the cm only), previewed red
 * where `addDeck` would refuse it; a click adds the default 2.00 × 1.40 centred on the pointer, to the cm. Either
 * release adds the bar's preset (Platform or Loft) and selects the new deck; the tool stays. A refused release toasts.
 * It works from the floor. Cutting a hole in a deck is the Hole tool (hole-tool.ts, smalls.12).
 */
export function deckPointer(state: EditorState, tool: DeckToolState, e: PointerInput, host: Host): Step {
  const preset = state.deckPreset;
  return pressPointer(state, tool, e, host, {
    wrap: withDeck,
    drawn: (_doc, a, b, opId) => drawnDeck(preset, a, b, opId),
    clicked: (_doc, _press, world, opId) => clickedDeck(preset, world, opId),
    mark: () => null,
  });
}

/**
 * What a press makes: a deck, a hole or a named area. `drawn` and `clicked` give null with nothing to make it in, which
 * is refused with `nothing` (a hole's text by default). The Zone tool (areas.06, .15) also gives `draws`, its size rule in
 * place of the 4 px one, under which the release is its own `click` (labelling a room); `corner`, a further snap of each
 * corner; and `added`, what a release added, to select.
 */
export type PressMaker = {
  wrap(state: EditorState, tool: DeckToolState): EditorState;
  drawn(doc: Document, a: Point, b: Point, opId: string, ctrl: boolean): Command | null;
  clicked(doc: Document, press: Point, world: Point, opId: string): Command | null;
  mark(doc: Document, a: Point, b: Point, ctrl: boolean): SnapResult | null;
  draws?(a: Point, b: Point): boolean;
  click?(state: EditorState, pressWorld: Point, host: Host): Step;
  corner?(doc: Document, p: Point, ctrl: boolean): Point;
  added?(doc: Document, opId: string): EntityRef[];
  then?(state: EditorState): EditorState; // after a release added something: the Zone tool goes back to Select (areas.41)
  nothing?: string;
};

/** The decks and holes a release named `opId` added. */
function addedDecks(doc: Document, opId: string): EntityRef[] {
  const ids = (d: { id: string }): boolean => d.id.startsWith(`${opId}/`);
  return deckViews(doc).flatMap((d): EntityRef[] => [...(ids(d) ? [{ table: "decks" as const, id: d.id }] : []), ...d.holes.filter(ids).map((h) => ({ table: "deckHoles" as const, id: h.id }))]);
}

/** The press both tools share: past 4 px it draws, with its corners snapped; a release adds what it made and selects it. */
export function pressPointer(state: EditorState, tool: DeckToolState, e: PointerInput, host: Host, m: PressMaker): Step {
  const world = state.pointer?.world ?? null;
  const doc = state.document ? visibleDoc(state.document) : null;
  if (world === null || doc === null) return { state, effects: [] };
  const level = viewedLevelOn(state, doc);
  const snapped = (p: Point): Point => footprintCorner(doc, state.camera, state.snapSettings.tolerancePx, p, e.mods.ctrl, level);
  const corner = (p: Point): Point => (m.corner ? m.corner(doc, snapped(p), e.mods.ctrl) : snapped(p));
  switch (e.type) {
    case "pointerDown":
      return { state: m.wrap(state, { kind: "pressing", pressWorld: world, start: corner(world), current: null, ok: true }), effects: [] };
    case "pointerMove": {
      if (tool.kind !== "pressing") return { state, effects: [] };
      const current = corner(world);
      if (m.draws ? !m.draws(tool.start, current) : !beyondClick(state, tool, world)) {
        return m.draws ? { state: m.wrap({ ...state, snap: null }, { ...tool, current: null, ok: true }), effects: [] } : { state, effects: [] };
      }
      const cmd = m.drawn(doc, tool.start, current, PREVIEW_OP, e.mods.ctrl);
      const ok = cmd !== null && execute(doc, cmd).ok;
      return { state: m.wrap({ ...state, snap: m.mark(doc, tool.start, current, e.mods.ctrl) }, { ...tool, current, ok }), effects: [] };
    }
    case "pointerUp": {
      if (tool.kind !== "pressing") return { state, effects: [] };
      const end = corner(world);
      const drawing = m.draws ? m.draws(tool.start, end) : beyondClick(state, tool, world);
      const idle = m.wrap({ ...state, snap: null }, { kind: "idle" });
      if (!drawing && m.click) return m.click(idle, tool.pressWorld, host);
      const opId = host.newId();
      const cmd = drawing ? m.drawn(doc, tool.start, end, opId, e.mods.ctrl) : m.clicked(doc, tool.start, world, opId);
      if (cmd === null) return refuse(idle, m.nothing ?? MESSAGES.holeNoDeck, host); // a hole in no deck
      const out = runCommand(idle, cmd, host);
      // What it added is in the visible document only if the command went through (a pending one included).
      const after = out.state.document ? visibleDoc(out.state.document) : null;
      const added = after ? (m.added ?? addedDecks)(after, opId) : [];
      if (added.length === 0) return { state: out.state, effects: out.effects };
      const selected = { ...out.state, selection: added };
      return { state: m.then ? m.then(selected) : selected, effects: out.effects };
    }
    default:
      return assertNever(e.type);
  }
}

/** Esc drops a press; with none, it picks the Select tool. */
export function deckEscape(state: EditorState, tool: DeckToolState): EditorState {
  return tool.kind === "pressing" ? withDeck(state, { kind: "idle" }) : switchTool(state, "select");
}

/** The deck being drawn, for the overlay: its ring and whether it would be accepted; null unless a drag is drawing. */
export function deckDraft(state: EditorState): { ring: Point[]; ok: boolean } | null {
  const tool = state.tool;
  if (tool.name !== "deck" || tool.state.kind !== "pressing" || tool.state.current === null) return null;
  const { start, current, ok } = tool.state;
  return { ring: [start, { x: current.x, y: start.y }, current, { x: start.x, y: current.y }], ok };
}

/** Why the deck a drag draws is refused, in the toast's words; null when it isn't. */
export function deckReason(state: EditorState, start: Point, current: Point): string | null {
  const doc = state.document ? visibleDoc(state.document) : null;
  return doc ? reasonOf(doc, drawnDeck(state.deckPreset, start, current, PREVIEW_OP)) : null;
}

/** A press is drawing once the pointer has passed 4 px from it (the Object tool's rule), even if it comes back. */
export function beyondClick(state: EditorState, tool: Extract<DeckToolState, { kind: "pressing" }>, world: Point): boolean {
  return tool.current !== null || distance(world, tool.pressWorld) * state.camera.zoom > DRAG_THRESHOLD_PX;
}

/** The rectangle between two corners, along the world axes; the domain keeps it to the millimetre. */
function drawnDeck(preset: DeckPreset, a: Point, b: Point, opId: string): Command {
  const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { type: "addDeck", opId, preset, at, w: Math.abs(b.x - a.x), d: Math.abs(b.y - a.y) };
}

/** The default size (addDeck's) centred on the pointer, to the cm, as the Object tool's ghost. */
function clickedDeck(preset: DeckPreset, world: Point, opId: string): Command {
  return { type: "addDeck", opId, preset, at: { x: roundCm(world.x), y: roundCm(world.y) } };
}

function withDeck(state: EditorState, tool: DeckToolState): EditorState {
  return { ...state, tool: { name: "deck", state: tool } };
}
