import { FLOOR_BASE, columnOf, columnTakes, deckLabel, deckView, roundMm, wallRange, type Command, type Document, shown } from "@fm/domain";
import { levelDecksOver } from "../tools/column-refs";
import type { Field } from "../view/view-model-types";
import { formatArea } from "../view/tags";
import { field, numberField, parseNumber, withOptions, type FieldCommand, type Properties } from "./fields";

// A column's Properties (spec "Properties", pillars.14, .23): Width, Depth and Angle, each typed value one setColumn
// about its centre; Base, read-only (set by the level it was placed at); Top, a choice of Ceiling, a level deck over a
// free floor column, or Height, with the Height from the base, typed when Top is Height; and the floor it takes off its
// rooms (`columnTakes`: in a wall's line only the part proud of it), read-only. No grips: a column is sized and turned
// by typing. The domain refuses a size out of range, with its text. In a wall's line Angle, Base and Top are the
// wall's, read-only.

const SECTION = "Column";
/** Top's choices other than a deck: never a deck's ID, which always holds a "/" (`${opId}/k0`). */
const CEILING = "ceiling";
const HEIGHT = "height";

export function columnFields(doc: Document, wallId: string): Properties {
  const column = columnOf(doc, wallId);
  if (!column) return { kind: "none" };
  const angle = angleText(column.rotation);
  return {
    kind: "column",
    fields: [
      numberField(SECTION, "width", "Width", shown(column.width), "m", 0.01),
      numberField(SECTION, "depth", "Depth", shown(column.depth), "m", 0.01),
      column.line ? field(SECTION, "angle", "Angle", angle, "°") : numberField(SECTION, "angle", "Angle", angle, "°", 1),
      ...verticalFields(doc, wallId, column.line !== null),
      field(SECTION, "takes", "Takes", formatArea(columnTakes(doc, wallId) ?? 0), null),
    ],
  };
}

/** The command a typed field gives; none for Angle or Top in a wall's line, which follow the wall. */
export function columnFieldCommand(doc: Document, wallId: string, fieldId: string, value: string): FieldCommand {
  const inLine = (columnOf(doc, wallId)?.line ?? null) !== null;
  switch (fieldId) {
    case "width":
      return typed(value, (width) => ({ type: "setColumn", wallId, width }));
    case "depth":
      return typed(value, (depth) => ({ type: "setColumn", wallId, depth }));
    case "angle":
      return inLine ? null : typed(value, (rotation) => ({ type: "setColumn", wallId, rotation }));
    case "top":
      return inLine ? null : topCommand(doc, wallId, value);
    case "height":
      return inLine ? null : typed(value, (top) => ({ type: "setColumn", wallId, top }));
    default:
      return null;
  }
}

/** Base, Top and Height: the row's references, as `wallRange` reads them. */
function verticalFields(doc: Document, wallId: string, inLine: boolean): Field[] {
  const w = doc.walls[wallId];
  const range = wallRange(doc, wallId);
  if (!w || !range) return [];
  const base = w.base === FLOOR_BASE ? "Floor" : deckName(doc, w.base);
  const top = w.top === "ceiling" ? CEILING : typeof w.top === "number" ? HEIGHT : w.top;
  const options = topOptions(doc, wallId);
  const height = shown(range.top - range.bottom);
  const topField = inLine
    ? field(SECTION, "top", "Top", options.find((o) => o.value === top)?.label ?? deckName(doc, top), null)
    : { ...withOptions(field(SECTION, "top", "Top", top, null, false), options), select: true };
  return [
    field(SECTION, "base", "Base", base, null),
    topField,
    !inLine && top === HEIGHT ? numberField(SECTION, "height", "Height", height, "m", 0.01) : field(SECTION, "height", "Height", height, "m"),
  ];
}

/**
 * Top's choices: Ceiling, then, for a column on the floor, the level decks over its centre and the one it reaches up to,
 * then Height. A column on a deck reaches the ceiling or a height above it (pillars.23).
 */
function topOptions(doc: Document, wallId: string): { value: string; label: string }[] {
  const w = doc.walls[wallId];
  const centre = columnOf(doc, wallId)?.centre;
  const over = w?.base === FLOOR_BASE && centre ? levelDecksOver(doc, centre).map((d) => d.id) : [];
  const current = w && typeof w.top === "string" && w.top !== "ceiling" && !over.includes(w.top) ? [w.top] : [];
  const decks = [...current, ...over].map((id) => ({ value: id, label: deckName(doc, id) }));
  return [{ value: CEILING, label: "Ceiling" }, ...decks, { value: HEIGHT, label: "Height" }];
}

/** Top chosen: the ceiling, a deck offered, or Height, which keeps the column's height as a number (decks.56). */
function topCommand(doc: Document, wallId: string, value: string): Command | null {
  const w = doc.walls[wallId];
  const range = wallRange(doc, wallId);
  if (!w || !range) return null;
  if (value === HEIGHT) return typeof w.top === "number" ? null : { type: "setColumn", wallId, top: roundMm(range.top - range.bottom) };
  if (value === CEILING) return { type: "setColumn", wallId, top: "ceiling" };
  return topOptions(doc, wallId).some((o) => o.value === value) ? { type: "setColumn", wallId, top: value } : null;
}

function deckName(doc: Document, id: string): string {
  const deck = deckView(doc, id);
  return deck ? deckLabel(deck) : id;
}

/** The angle in degrees counter-clockwise to a tenth, 0 to under 360: a turned column's joints are unrounded (pillars.30). */
function angleText(rotation: number): string {
  const tenths = Math.round(rotation * 10) % 3600;
  return String(tenths / 10);
}

/** A typed number's command, or "notANumber". */
function typed(value: string, command: (v: number) => Command): FieldCommand {
  const v = parseNumber(value);
  return Number.isFinite(v) ? command(v) : "notANumber";
}
