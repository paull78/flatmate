import { roofBox, roofOf, type Document, type Falls } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { memoLast } from "./memo";
import type { PlanStyle } from "./plan-style";
import type { Primitive } from "./scene-types";

// The roof on the plan (roofs.11, .37): overhead at every level and on paper, drawn with the decks' overheads. Its edge
// is a long dash at the walls' box plus the overhang, longer than the dash of pieces above the cut and decks' edges, as
// drafting gives the eaves a line of their own; a gable's ridge has the same dash and the word "Ridge" beside it; each
// slope has an arrow pointing down it with its pitch, as ISO 7519 marks a fall. Built from the domain's roof (roofBox,
// roofOf), never from its own formula.

/** The arrow's stem and head in metres: a drawing symbol, scaled with the plan like a stair's arrow. */
const STEM = 0.6;
const HEAD = 0.16;
const HEAD_HALF = 0.08;
const TEXT_OFF = 0.22; // the pitch's text, beside the stem's middle; "Ridge" above a ridge along x
const RIDGE_GAP = 0.12; // "Ridge"'s start, past a ridge along y

/** The unit vector pointing down a slope falling toward `falls`. */
const DOWN: Record<Falls, Point> = { "-y": { x: 0, y: -1 }, "+y": { x: 0, y: 1 }, "-x": { x: -1, y: 0 }, "+x": { x: 1, y: 0 } };
const OPPOSITE: Record<Falls, Falls> = { "-y": "+y", "+y": "-y", "-x": "+x", "+x": "-x" };

function arrow(mid: Point, down: Point, label: string, style: PlanStyle): Primitive[] {
  const { ink, line, textSize } = style.roof;
  const a = { x: mid.x - (down.x * STEM) / 2, y: mid.y - (down.y * STEM) / 2 };
  const tip = { x: mid.x + (down.x * STEM) / 2, y: mid.y + (down.y * STEM) / 2 };
  const back = { x: tip.x - down.x * HEAD, y: tip.y - down.y * HEAD };
  const side = { x: -down.y, y: down.x };
  const head = [tip, { x: back.x + side.x * HEAD_HALF, y: back.y + side.y * HEAD_HALF }, { x: back.x - side.x * HEAD_HALF, y: back.y - side.y * HEAD_HALF }];
  const at = { x: mid.x + side.x * TEXT_OFF, y: mid.y + side.y * TEXT_OFF };
  return [
    { kind: "segment", a, b: back, width: { px: line }, color: ink, cap: "butt" },
    { kind: "polygon", points: head, holes: [], color: ink },
    { kind: "text", text: label, at, size: textSize, color: ink, align: "center", rotation: 0, font: style.font },
  ];
}

/** The roof's drawn edge, the walls' box plus the overhang, or nothing under a flat ceiling: what a sheet or an image frames. */
export function roofEdge(doc: Document): Point[] {
  const roof = roofOf(doc);
  const box = roofBox(doc);
  if (roof.shape === "flat" || !box) return [];
  const o = roof.overhang;
  return [{ x: box.minX - o, y: box.minY - o }, { x: box.maxX + o, y: box.minY - o }, { x: box.maxX + o, y: box.maxY + o }, { x: box.minX - o, y: box.maxY + o }];
}

export const roofLines = memoLast((doc: Document, style: PlanStyle): readonly Primitive[] => {
  const roof = roofOf(doc);
  const box = roofBox(doc);
  if (roof.shape === "flat" || !box) return [];
  const { ink, line, dash, textSize } = style.roof;
  const o = roof.overhang;
  const corners = roofEdge(doc);
  const edge = corners.map((a, i): Primitive => ({ kind: "segment", a, b: corners[(i + 1) % 4] ?? a, width: { px: line }, color: ink, cap: "butt", dash }));
  const label = `${Number(roof.pitch.toFixed(1))}°`;
  // A quarter of the way along the slope's length, not the middle, where a room's tag sits (the hands-on run, roofs.28).
  const across = roof.falls === "-y" || roof.falls === "+y" ? { x: (box.maxX - box.minX) / 4, y: 0 } : { x: 0, y: (box.maxY - box.minY) / 4 };
  const mid = { x: (box.minX + box.maxX) / 2 - across.x, y: (box.minY + box.maxY) / 2 - across.y };
  if (roof.shape === "shed") return [...edge, ...arrow(mid, DOWN[roof.falls], label, style)];
  const alongX = roof.falls === "-y" || roof.falls === "+y";
  const ridge: Primitive = alongX
    ? { kind: "segment", a: { x: box.minX - o, y: mid.y }, b: { x: box.maxX + o, y: mid.y }, width: { px: line }, color: ink, cap: "butt", dash }
    : { kind: "segment", a: { x: mid.x, y: box.minY - o }, b: { x: mid.x, y: box.maxY + o }, width: { px: line }, color: ink, cap: "butt", dash };
  // The word a quarter of the way along from the far end, away from the arrows and the room's tag at the middle; beside a
  // vertical ridge it starts just past the line.
  const named: Primitive = alongX
    ? { kind: "text", text: "Ridge", at: { x: mid.x + 2 * across.x, y: mid.y + TEXT_OFF }, size: textSize, color: ink, align: "center", rotation: 0, font: style.font }
    : { kind: "text", text: "Ridge", at: { x: mid.x + RIDGE_GAP, y: mid.y + 2 * across.y }, size: textSize, color: ink, align: "left", rotation: 0, font: style.font };
  const quarter = (f: Falls): Point => {
    const d = DOWN[f];
    const half = alongX ? (box.maxY - box.minY) / 4 : (box.maxX - box.minX) / 4;
    return { x: mid.x + d.x * half, y: mid.y + d.y * half };
  };
  const sides: Falls[] = [roof.falls, OPPOSITE[roof.falls]];
  return [...edge, ridge, named, ...sides.flatMap((f) => arrow(quarter(f), DOWN[f], label, style))];
});

/**
 * The roof's lines with the decks' labels after them, in the layer over the walls and openings: a door's span drawn
 * over half an arrow reads as a stray shape (the user's review). The same array while both are, so the layer cache
 * keeps hitting (graphics.16).
 */
export const withRoof = memoLast((roof: readonly Primitive[], labels: readonly Primitive[]): readonly Primitive[] => (roof.length === 0 ? labels : [...roof, ...labels]));
