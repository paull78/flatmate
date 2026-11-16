import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import { fontMetrics, textWidth, type TextStyle } from "./fonts";
import { COLORS } from "./colors";
import type { PlanStyle } from "./plan-style";
import type { Primitive } from "./scene-types";

const LABEL_PAD_PX = 4;

/** The world box around a label centred at `at`: its font's width and height plus padding (screen px → metres). */
export function labelBox(text: string, at: Point, style: TextStyle, camera: Camera): { min: Point; max: Point } {
  const { ascent, descent } = fontMetrics(style.font);
  const hw = (textWidth(style.font, text, style.size) / 2 + LABEL_PAD_PX) / camera.zoom;
  const hh = (((ascent + descent) * style.size) / 2 + LABEL_PAD_PX / 2) / camera.zoom;
  return { min: { x: at.x - hw, y: at.y - hh }, max: { x: at.x + hw, y: at.y + hh } };
}

/**
 * The plate behind plan text (spec: editor): `lines` lines of text `width` drawing units wide centred on `centre`, with
 * the style's pad around it, one tag line per line. Room tags and deck labels share it (cleanup.05).
 */
export function plateBox(centre: Point, width: number, lines: number, tag: PlanStyle["tag"], zoom: number): { min: Point; max: Point } {
  const hw = (width / 2 + tag.pad) / zoom;
  const hh = ((lines * tag.line) / 2 + tag.pad / 2) / zoom;
  return { min: { x: centre.x - hw, y: centre.y - hh }, max: { x: centre.x + hw, y: centre.y + hh } };
}

type Box = { min: Point; max: Point };

/** Whether two world boxes share some area; boxes that only touch don't. */
export const boxesOverlap = (a: Box, b: Box): boolean => a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y;

/**
 * `at`, the centre of `box`, slid along the unit direction `u` the shorter way until the box clears `other`, a gap of
 * `gap` between them; as given when they don't overlap. Labels slide off a deck's label this way (stairwell.37).
 */
export function slideClear(at: Point, box: Box, other: Box, u: Point, gap: number): Point {
  if (!boxesOverlap(box, other)) return at;
  const half = (Math.abs(u.x) * (box.max.x - box.min.x) + Math.abs(u.y) * (box.max.y - box.min.y)) / 2;
  const along = (p: Point): number => p.x * u.x + p.y * u.y;
  const ends = [other.min, { x: other.max.x, y: other.min.y }, other.max, { x: other.min.x, y: other.max.y }].map(along);
  const t = along(at);
  const up = Math.max(...ends) + half + gap - t;
  const down = Math.min(...ends) - half - gap - t;
  const s = Math.abs(up) <= Math.abs(down) ? up : down;
  return { x: at.x + u.x * s, y: at.y + u.y * s };
}

/** A background box behind a label. */
export function textBox(text: string, at: Point, style: TextStyle, camera: Camera): Primitive {
  const { min, max } = labelBox(text, at, style, camera);
  return {
    kind: "polygon",
    points: [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }],
    holes: [],
    color: COLORS.background,
  };
}
