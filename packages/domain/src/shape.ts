import { isRecord, isWireId, MAX_NAME_CHARS } from "@fm/protocol";
import type { Point } from "@fm/protocol";
import { parseFinish, rowFinish, type Finish } from "./finishes";
import { SIDE_IDS, isOpeningKind, isSheer, type Sides } from "./kinds";
import {
  FLOOR_BASE, isOpeningWidth, type Ceiling, type Deck, type DeckHole, type Dimension, type DimensionEnd, type Joint, type LayoutState,
  type Logo, type Opening, type Placement, type ProjectField, type Underlay, type Wall, type ZoneLabel, WALL_FINISH_KEYS,
} from "./model";
import { MIN_ZONE_SIZE, SIDE_ZONE_KEYS, nullZones, type ZoneExtents } from "./use-zone";
import { parseGuardValue, parseLayoutObject } from "./shape-objects";
import { parseSheet } from "./shape-sheets";
import { FALLS, ROOF_SHAPES } from "./roof-shapes";

export { parseLayoutObject, parseSheet }; // their own modules (shape-objects.ts, shape-sheets.ts), re-exported so imports stay here

/**
 * A short ID from a plain alphabet (I8). Tables are plain objects keyed by ID, so an ID that names an
 * Object.prototype member ("constructor", "toString", "__proto__", …) is refused: looking it up would
 * find the inherited member, and storing "__proto__" would set the prototype instead of a key.
 */
export const isValidId = (v: unknown): v is string => isWireId(v);

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isValidName(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_NAME_CHARS;
}

/** Cuts a name to MAX_NAME_CHARS UTF-16 units, dropping a high surrogate whose pair was cut off. */
export function cutName(name: string): string {
  const cut = name.slice(0, MAX_NAME_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  return cut.length < name.length && last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Exactly these own keys: unknown fields are rejected, so a stored document holds only validated fields (spec: domain). */
export function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
}

export function parsePoint(v: unknown): Point | null {
  if (!isRecord(v) || !hasExactKeys(v, ["x", "y"])) return null;
  const { x, y } = v;
  return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : null;
}

export function parseJoint(v: unknown): Joint | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "x", "y"])) return null;
  const { id, x, y } = v;
  return isValidId(id) && isFiniteNumber(x) && isFiniteNumber(y) ? { id, x, y } : null;
}

/**
 * A wall's top is "ceiling", a finite number or a deck's ID (any other valid ID); its bounds are I17 and I21 (heights.10,
 * .37, pillars.23). Its base is "floor" or a deck's ID (FLOOR_BASE is a valid ID), `column` a boolean (pillars).
 */
export function parseWall(v: unknown): Wall | null {
  const keys = ["id", "a", "b", "thickness", "top", "base", "column"];
  if (!isRecord(v) || !keys.every((k) => Object.hasOwn(v, k))) return null;
  if (!Object.keys(v).every((k) => keys.includes(k) || WALL_FINISH_KEYS.some((f) => f === k))) return null;
  const { id, a, b, thickness, top, base, column } = v;
  const topOk = (isFiniteNumber(top) || (isValidId(top) && top !== FLOOR_BASE)) && isValidId(base) && typeof column === "boolean";
  if (!(isValidId(id) && isValidId(a) && isValidId(b) && isFiniteNumber(thickness) && topOk)) return null;
  const wall: Wall = { id, a, b, thickness, top, base, column };
  // A wall's finishes, flat optional fields (surfaces.33): their shape here, their rules in I8 (sidesProblem).
  for (const key of WALL_FINISH_KEYS) {
    if (!Object.hasOwn(v, key)) continue;
    const given = v[key];
    if (key === "lowerLeftHeight" || key === "lowerRightHeight") {
      if (!isFiniteNumber(given)) return null;
      wall[key] = given;
    } else {
      const finish = parseFinish(given);
      if (!finish) return null;
      wall[key] = finish;
    }
  }
  return wall;
}

const LABEL_KEYS = ["id", "at", "name", "finish", "walls", "wallsLower", "wallsLowerHeight"];

/**
 * Three optional stored fields of a walls default (inherit.01): two finishes and a height, their shape here, their rules
 * in I8 (`defaultProblem`); `undefined` when one is malformed.
 */
function defaultFields(v: Readonly<Record<string, unknown>>, keys: readonly [string, string, string]): { finish?: Finish; lower?: Finish; height?: number } | undefined {
  const [fKey, lKey, hKey] = keys;
  const out: { finish?: Finish; lower?: Finish; height?: number } = {};
  const [f, l, h] = [v[fKey], v[lKey], v[hKey]];
  if (f !== undefined) { const parsed = parseFinish(f); if (!parsed) return undefined; out.finish = parsed; }
  if (l !== undefined) { const parsed = parseFinish(l); if (!parsed) return undefined; out.lower = parsed; }
  if (h !== undefined) { if (!isFiniteNumber(h)) return undefined; out.height = h; }
  return out;
}

/**
 * A missing `finish` reads as null, so old rows and fixtures need no migration (finishes.24); its rules are I8's, as are
 * the walls default's (inherit.01).
 */
export function parseZoneLabel(v: unknown): ZoneLabel | null {
  if (!isRecord(v) || !["id", "at", "name"].every((k) => Object.hasOwn(v, k)) || !Object.keys(v).every((k) => LABEL_KEYS.includes(k))) return null;
  const { id, at, name } = v;
  const point = parsePoint(at);
  const finish = rowFinish(v);
  const walls = defaultFields(v, ["walls", "wallsLower", "wallsLowerHeight"]);
  if (finish === undefined || !walls || !isValidId(id) || !point || !isValidName(name)) return null;
  return {
    id, at: point, name, finish,
    ...(walls.finish ? { walls: walls.finish } : {}), ...(walls.lower ? { wallsLower: walls.lower } : {}),
    ...(walls.height !== undefined ? { wallsLowerHeight: walls.height } : {}),
  };
}

export function parseLayoutState(v: unknown): LayoutState | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "name", "order"])) return null;
  const { id, name, order } = v;
  return isValidId(id) && isValidName(name) && isFiniteNumber(order) ? { id, name, order } : null;
}

/** Exactly front, back, left and right, each a boolean, as a fresh object (smart.08); setZoneSides checks with it too. */
export function parseSides(v: unknown): Sides | null {
  if (!isRecord(v) || !hasExactKeys(v, SIDE_IDS)) return null;
  const { front, back, left, right } = v;
  return typeof front === "boolean" && typeof back === "boolean" && typeof left === "boolean" && typeof right === "boolean"
    ? { front, back, left, right }
    : null;
}

const MAX_ZONE_SIZE = 10; // metres, like an object's size

/**
 * Exactly the twelve zone keys, as a fresh object (furnish.21): per side all null, or a depth of 0.10 to 10 m and two
 * insets of 0 to 10 m, all finite. Whether the insets fit the side is not checked: reading clamps them (furnish.20).
 */
export function parseZoneExtents(v: unknown): ZoneExtents | null {
  const sides = SIDE_IDS.map((side) => SIDE_ZONE_KEYS[side]);
  if (!isRecord(v) || !hasExactKeys(v, sides.flat())) return null;
  const inset = (x: unknown): x is number => isFiniteNumber(x) && x >= 0 && x <= MAX_ZONE_SIZE;
  const out = nullZones();
  for (const [d, s, e] of sides) {
    const depth = v[d];
    const start = v[s];
    const end = v[e];
    if (depth === null && start === null && end === null) continue;
    if (!isFiniteNumber(depth) || depth < MIN_ZONE_SIZE || depth > MAX_ZONE_SIZE || !inset(start) || !inset(end)) return null;
    out[d] = depth;
    out[s] = start;
    out[e] = end;
  }
  return out;
}

/** A rotation in whole degrees, 0 to 359 (a placement's, a deck's). */
function isWholeDegrees(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v < 360;
}

/**
 * Shape only: whether `config` belongs to the object's kind needs the object, and whether `deck` names a deck needs
 * the decks, so I9 checks both.
 */
export function parsePlacement(v: unknown): Placement | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "object", "state", "at", "rotation", "config", "sides", "zones", "deck"])) return null;
  const { id, object, state, rotation, config, deck } = v;
  const at = parsePoint(v.at);
  const sides = parseSides(v.sides);
  const zones = parseZoneExtents(v.zones);
  const deckOk = deck === null || isValidId(deck);
  return isValidId(id) && isValidId(object) && isValidId(state) && at && isWholeDegrees(rotation) && isValidId(config) && sides && zones && deckOk
    ? { id, object, state, at, rotation, config, sides, zones, deck }
    : null;
}

/**
 * Shape only: the sizes, the top's bounds and where the deck may lie are I18 (decks.03). A deck named "ceiling" would
 * read as a wall's top at the ceiling (model.ts' WallTop), so it is refused; addDeck never makes one.
 */
export function parseDeck(v: unknown): Deck | null {
  const keys = ["id", "name", "at", "w", "d", "rotation", "top", "solid", "guardFront", "guardRight", "guardBack", "guardLeft"];
  const shapes = [["finish"], []].map((more) => [...keys, ...more]); // an older file's row may have no finish; its one guard is filled on load (fillDeckGuards)
  if (!isRecord(v) || !shapes.some((k) => hasExactKeys(v, k))) return null;
  const { id, name, w, d, rotation, top, solid } = v;
  const at = parsePoint(v.at);
  if (!isValidId(id) || id === "ceiling" || id === FLOOR_BASE || !isValidName(name) || !at || !isWholeDegrees(rotation) || typeof solid !== "boolean") return null;
  const finish = rowFinish(v); // its rules are I8's (deck-floors.04)
  if (finish === undefined || !isFiniteNumber(w) || !isFiniteNumber(d) || !isFiniteNumber(top)) return null;
  const [guardFront, guardRight, guardBack, guardLeft] = [v.guardFront, v.guardRight, v.guardBack, v.guardLeft].map(parseGuardValue);
  if (!guardFront || !guardRight || !guardBack || !guardLeft) return null;
  return { id, name, at, w, d, rotation, top, solid, finish, guardFront, guardRight, guardBack, guardLeft };
}

/** Shape only: the deck, the size and where the hole lies are I22 (stairwell.04, .20). */
export function parseDeckHole(v: unknown): DeckHole | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "deck", "at", "w", "d", "guard"])) return null;
  const { id, deck, w, d } = v;
  const at = parsePoint(v.at);
  const guard = parseGuardValue(v.guard);
  return isValidId(id) && isValidId(deck) && at && isFiniteNumber(w) && isFiniteNumber(d) && guard ? { id, deck, at, w, d, guard } : null;
}

/** Shape and the kind's width range; the wall and the offset are checked by I12 (spec: openings). */
export function parseOpening(v: unknown): Opening | null {
  const keys = ["id", "wall", "kind", "offset", "width", "side", "hinge", "glazed", "sill", "head"];
  if (!isRecord(v) || !keys.every((k) => Object.hasOwn(v, k))) return null;
  if (!Object.keys(v).every((k) => keys.includes(k) || k === "sheer" || k === "shutterBox")) return null; // a window's dressing (hangings.04)
  const { id, wall, kind, offset, width, side, hinge, glazed, sill, head, sheer, shutterBox } = v;
  if ((sheer !== undefined && !isSheer(sheer)) || (shutterBox !== undefined && shutterBox !== true)) return null;
  if (!isValidId(id) || !isValidId(wall) || !isFiniteNumber(offset) || !isFiniteNumber(width) || typeof glazed !== "boolean") return null;
  if (!isFiniteNumber(sill) || !isFiniteNumber(head)) return null;
  if (!isOpeningKind(kind)) return null;
  if (side !== "left" && side !== "right") return null;
  if (hinge !== "a" && hinge !== "b") return null;
  if (!isOpeningWidth(kind, width)) return null;
  return { id, wall, kind, offset, width, side, hinge, glazed, sill, head, ...(sheer === undefined ? {} : { sheer }), ...(shutterBox === undefined ? {} : { shutterBox }) };
}

/** Shape only: whether the key is known and the value fits its field is I14 (sheet.05). */
export function parseProjectField(v: unknown): ProjectField | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "value"])) return null;
  const { id, value } = v;
  return isValidId(id) && typeof value === "string" ? { id, value } : null;
}

/** An end anchored to a joint (its direction checked by I15) or a free point (dims.16). */
function parseDimensionEnd(v: unknown): DimensionEnd | null {
  if (!isRecord(v)) return null;
  if (hasExactKeys(v, ["x", "y"])) return parsePoint(v);
  if (!hasExactKeys(v, ["joint", "tx", "ty"])) return null;
  const { joint, tx, ty } = v;
  return isValidId(joint) && isFiniteNumber(tx) && isFiniteNumber(ty) ? { joint, tx, ty } : null;
}

/** Shape only: anchors, corner directions and the offset bound are I15. */
export function parseDimension(v: unknown): Dimension | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "a", "b", "offset"])) return null;
  const { id, offset } = v;
  const a = parseDimensionEnd(v.a);
  const b = parseDimensionEnd(v.b);
  return isValidId(id) && a && b && isFiniteNumber(offset) ? { id, a, b, offset } : null;
}

/** Shape only: the id, the JPEG mime, the size limits and the scale are I16 (import.16). */
export function parseUnderlay(v: unknown): Underlay | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "pictureId", "mime", "data", "width", "height", "at", "metresPerPixel", "scaled"])) return null;
  const { id, pictureId, mime, data, width, height, metresPerPixel, scaled } = v;
  const at = parsePoint(v.at);
  if (!isValidId(id) || !isValidId(pictureId) || typeof mime !== "string" || typeof data !== "string") return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || !isFiniteNumber(metresPerPixel) || typeof scaled !== "boolean") return null;
  return at ? { id, pictureId, mime, data, width, height, at, metresPerPixel, scaled } : null;
}

/** Shape only: the id, the first bytes and the size limits are I24. */
export function parseLogo(v: unknown): Logo | null {
  if (!isRecord(v) || !hasExactKeys(v, ["id", "data", "width", "height"])) return null;
  const { id, data, width, height } = v;
  return isValidId(id) && typeof data === "string" && isFiniteNumber(width) && isFiniteNumber(height) ? { id, data, width, height } : null;
}

const CEILING_KEYS = ["id", "height", "shape", "pitch", "falls", "overhang", "covering", "outside", "outsideLower", "outsideLowerHeight"];
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && list.some((x) => x === v);

/**
 * Shape only: an id and a height, and a roof's shape, pitch, falls and overhang when given (roofs.20); bounds are I17
 * (heights.28). A row without the roof's fields is a flat ceiling, as saved before the roofs cycle.
 */
export function parseCeiling(v: unknown): Ceiling | null {
  if (!isRecord(v) || !Object.keys(v).every((k) => CEILING_KEYS.includes(k))) return null;
  const { id, height, shape, pitch, falls, overhang } = v;
  const covering = v.covering === undefined ? undefined : parseFinish(v.covering); // its rules are I8's (surfaces step 11)
  if (covering === null) return null;
  const outside = defaultFields(v, ["outside", "outsideLower", "outsideLowerHeight"]); // the house's walls default (inherit.07)
  if (!outside) return null;
  if (!isValidId(id) || !isFiniteNumber(height)) return null;
  if (shape !== undefined && !isOneOf(ROOF_SHAPES, shape)) return null;
  if (falls !== undefined && !isOneOf(FALLS, falls)) return null;
  if ((pitch !== undefined && !isFiniteNumber(pitch)) || (overhang !== undefined && !isFiniteNumber(overhang))) return null;
  return {
    id, height,
    ...(shape === undefined ? {} : { shape }), ...(pitch === undefined ? {} : { pitch }),
    ...(falls === undefined ? {} : { falls }), ...(overhang === undefined ? {} : { overhang }),
    ...(covering === undefined ? {} : { covering }),
    ...(outside.finish ? { outside: outside.finish } : {}), ...(outside.lower ? { outsideLower: outside.lower } : {}),
    ...(outside.height !== undefined ? { outsideLowerHeight: outside.height } : {}),
  };
}
