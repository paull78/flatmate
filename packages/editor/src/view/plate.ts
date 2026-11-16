import { deckLabel, deckView, footprintQuad, shown as metres, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { screenToWorld, worldToScreen, type Camera } from "../camera";
import type { EditorState } from "../state";
import { typedHeight } from "../tools/armed-size";
import type { ObjectGhost } from "../tools/types";
import { COLORS } from "./colors";
import { CHROME_FONT, textWidth } from "./fonts";
import { ringEdges } from "./rings";
import type { Color, Primitive } from "./scene-types";

export type PlateTone = "refusal" | "note";

const TONES: Record<PlateTone, { line: Color; text: Color }> = {
  refusal: { line: COLORS.invalid, text: COLORS.refusalText },
  note: { line: COLORS.warningLine, text: COLORS.text },
};

const SIZE = 12;
const HEIGHT_PX = 22;
const LINE_PX = 16; // a second line's added height (sizing.09)
const PAD_PX = 8;
const BELOW_PX = 16; // below the pointer, clear of the cursor (clarity.08)
const MARGIN_PX = 4; // from the viewport's edge, so the border stays on screen
const ELLIPSIS = "…";
const LABEL_SIZE = 11; // a typed height's label: smaller than a plate's words, with no box (sizing.30)
const LABEL_GAP_PX = 6; // its gap from the ghost's side
const LABEL_PAD_PX = 3; // its white backing's margin round the words, so lines under it don't cross them

const fits = (text: string, room: number): boolean => textWidth(CHROME_FONT, text, SIZE) <= room;

/** The text whole if it fits in `room` px, else cut to end in "…": text primitives draw one line (clarity.08). */
function clipped(text: string, room: number): string {
  if (fits(text, room)) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && !fits(`${chars.join("").trimEnd()}${ELLIPSIS}`, room)) chars.pop();
  return `${chars.join("").trimEnd()}${ELLIPSIS}`;
}

const within = (v: number, size: number, length: number): number => Math.max(MARGIN_PX, Math.min(v, length - MARGIN_PX - size));

/**
 * A plate centred under a screen point, kept inside the viewport: a white box, a thin border and its words, and an
 * optional second line, the advice, in the note's dark text (sizing.09); in world coordinates like every primitive.
 * Under WebGL, text beneath it shows through (clarity.12).
 */
export function platePrimitives(text: string, anchor: Point, tone: PlateTone, camera: Camera, advice?: string): Primitive[] {
  const { width, height } = camera.viewport;
  const room = width - 2 * (MARGIN_PX + PAD_PX);
  const shown = clipped(text, room);
  const second = advice === undefined ? null : clipped(advice, room);
  const w = Math.max(textWidth(CHROME_FONT, shown, SIZE), second === null ? 0 : textWidth(CHROME_FONT, second, SIZE)) + 2 * PAD_PX;
  const h = HEIGHT_PX + (second === null ? 0 : LINE_PX);
  const x = within(anchor.x - w / 2, w, width);
  const y = within(anchor.y + BELOW_PX, h, height);
  const world = (sx: number, sy: number): Point => screenToWorld(camera, { x: sx, y: sy });
  const ring = [world(x, y), world(x + w, y), world(x + w, y + h), world(x, y + h)];
  const { line, text: color } = TONES[tone];
  const words = (t: string, sy: number, c: Color): Primitive => ({ kind: "text", text: t, at: world(x + w / 2, sy), size: SIZE, color: c, align: "center", rotation: 0, font: CHROME_FONT });
  return [
    { kind: "polygon", points: ring, holes: [], color: COLORS.field },
    ...ringEdges(ring, line, 1, "round"),
    words(shown, y + HEIGHT_PX / 2, color),
    ...(second === null ? [] : [words(second, y + HEIGHT_PX / 2 + LINE_PX, TONES.note.text)]),
  ];
}

/** The words on a lowered ghost's plate (clarity.06): the armed height named "default" for a preset's, "typed" for a typed one (sizing.17). */
function loweredWords(doc: Document, { h, from, under }: NonNullable<ObjectGhost["lowered"]>, typed: boolean): string {
  const deck = under === null ? null : deckView(doc, under);
  return `H ${metres(h)} m · ${typed ? "typed" : "default"} ${metres(from)} · under ${deck ? deckLabel(deck) : "the ceiling"}`;
}

/**
 * The Object tool's note at the pointer, with no rest, never red (clarity.06, sizing.17): a shortened ghost's height
 * on a plate, else a typed height that differs from the armed preset's as a small amber label with no box, so a custom
 * height is never placed unseen and doesn't crowd the pointer (sizing.30). None for a set, a stair's preview, or with
 * no pointer. A refusal's plate takes its place once it is up (the scene's order).
 */
export function notePlate(state: EditorState, doc: Document): Primitive[] {
  const tool = state.tool.name === "object" ? state.tool.state : null;
  const ghost = tool?.preview ? null : tool?.ghost;
  if (!ghost || !state.pointer || state.objectSet !== null) return [];
  const typed = typedHeight(state);
  if (ghost.lowered) return platePrimitives(loweredWords(doc, ghost.lowered, typed !== null), state.pointer.screen, "note", state.camera);
  if (typed === null || ghost.drawn) return []; // a drawn ghost's label carries the typed height (sizing.31)
  return typedLabel(`H ${metres(typed)} m`, ghost, state.camera);
}

/**
 * The typed height's label beside the ghost, clear of its lines and the cursor: right of its box at mid-height, or
 * left of it near the view's right edge, on a white backing just round the words, with no border (sizing.30).
 */
function typedLabel(text: string, ghost: ObjectGhost, camera: Camera): Primitive[] {
  const box = footprintQuad(ghost.at, ghost.w, ghost.d, ghost.rotation).map((p) => worldToScreen(camera, p));
  const xs = box.map((p) => p.x);
  const ys = box.map((p) => p.y);
  const right = Math.max(...xs) + LABEL_GAP_PX;
  const fitsRight = right + textWidth(CHROME_FONT, text, LABEL_SIZE) <= camera.viewport.width - MARGIN_PX;
  const sx = fitsRight ? right : Math.min(...xs) - LABEL_GAP_PX;
  const sy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const tw = textWidth(CHROME_FONT, text, LABEL_SIZE);
  const left = (fitsRight ? sx : sx - tw) - LABEL_PAD_PX;
  const half = LABEL_SIZE / 2 + LABEL_PAD_PX;
  const world = (x: number, y: number): Point => screenToWorld(camera, { x, y });
  const back = [world(left, sy - half), world(left + tw + 2 * LABEL_PAD_PX, sy - half), world(left + tw + 2 * LABEL_PAD_PX, sy + half), world(left, sy + half)];
  return [
    { kind: "polygon", points: back, holes: [], color: COLORS.field },
    { kind: "text", text, at: world(sx, sy), size: LABEL_SIZE, color: TONES.note.line, align: fitsRight ? "left" : "right", rotation: 0, font: CHROME_FONT },
  ];
}
