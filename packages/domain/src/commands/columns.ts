import { err, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { columnOf } from "../column-checks";
import { MESSAGES, domainError, topologyMessage, type DomainError } from "../errors";
import { FLOOR_BASE, type Document, type Wall, type WallTop } from "../model";
import { diffPatch } from "../patch";
import { deckLabel, deckView, insideDeck } from "../queries/decks";
import { roundMm } from "../queries/footprints";
import { faceAt } from "../queries/zones";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import { deckRefs } from "../wall-ranges";
import { placeInLine, sizeRefusal, wallUnder } from "./column-line";
import { slideInLine } from "./column-slide";
import { validPoint } from "./object-helpers";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";

// The column commands (pillars.18, .19): the one writer of a column's geometry. A column is a wall row with `column`
// set: its joints a and b at its centre ∓ half its width along its rotation, its thickness its depth. Joints are not
// rounded (pillars.30). A centre in a wall's body places it into that wall's line (column-line.ts); elsewhere it stands
// free, on the floor in a room or on a deck. Validation makes every refusal of a well-formed size or contact (I20), and
// of a base or top (I17, I21).

/** A column as typed: its centre, width along its centreline, depth, and rotation in degrees counter-clockwise. */
type Shape = { at: Point; width: number; depth: number; rotation: number };

/** The shape, its fields checked for their types (commands arrive as JSON from MCP and the editor), or the refusal. */
function checked(s: Shape): Shape | string {
  if (!validPoint(s.at)) return "Invalid position";
  if (!isFiniteNumber(s.width) || !isFiniteNumber(s.depth)) return "Invalid size";
  if (!isFiniteNumber(s.rotation)) return "Invalid rotation";
  return s;
}

/** The unit vector at `deg` degrees, exact at quarter turns. */
function direction(deg: number): Point {
  const quarter = ((deg % 360) + 360) % 360;
  if (quarter === 0) return { x: 1, y: 0 };
  if (quarter === 90) return { x: 0, y: 1 };
  if (quarter === 180) return { x: -1, y: 0 };
  if (quarter === 270) return { x: 0, y: -1 };
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

/** The column's joints a and b: a at the negative end along its rotation. */
function ends(s: Shape): [Point, Point] {
  const u = direction(s.rotation);
  const half = s.width / 2;
  return [{ x: s.at.x - u.x * half, y: s.at.y - u.y * half }, { x: s.at.x + u.x * half, y: s.at.y + u.y * half }];
}

/** A typed top as stored: "ceiling", a height from the base kept to the millimetre, or an existing deck's ID. */
function topOf(doc: Document, top: unknown): WallTop | DomainError {
  if (top === "ceiling") return top;
  if (isFiniteNumber(top)) return roundMm(top);
  if (isValidId(top) && Object.hasOwn(doc.decks, top)) return top;
  return typeof top === "string" ? domainError("notFound", "Deck not found") : domainError("invalidInput", "Invalid height");
}

/**
 * Writes column row `wall` with the shape's depth and, unless `moved` is false, its joints from the shape; refuses a
 * size out of range (I20's text), or a centre in no room on the floor or off its deck, then validates. A free column
 * depends on its row, its joints, the walls of the room it stands in and the decks it references.
 */
function write(doc: Document, wall: Wall, s: Shape, moved: boolean): CommandResult {
  const sized = sizeRefusal(wall.id, s.width, s.depth);
  if (sized) return err(sized);
  const refs = deckRefs(wall);
  const deck = refs.base === null ? null : deckView(doc, refs.base);
  if (refs.base !== null && !deck) return err(domainError("notFound", "Deck not found"));
  const room = deck ? null : faceAt(doc, s.at);
  if (deck && !insideDeck(deck, [[s.at]])) return err(domainError("notInRoom", MESSAGES.columnOnDeck(deckLabel(deck))));
  if (!deck && !room) return err(domainError("notInRoom", MESSAGES.columnInRoom));
  const [a, b] = ends(s);
  const joints = moved ? { ...doc.joints, [wall.a]: { id: wall.a, ...a }, [wall.b]: { id: wall.b, ...b } } : doc.joints;
  const next: Document = { ...doc, joints, walls: { ...doc.walls, [wall.id]: { ...wall, thickness: s.depth } } };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  const deps: EntityKey[] = [
    { table: "walls", id: wall.id },
    { table: "joints", id: wall.a },
    { table: "joints", id: wall.b },
    ...(room?.wallIds ?? []).map((id): EntityKey => ({ table: "walls", id })),
    ...[refs.base, refs.top].flatMap((id): EntityKey[] => (id === null ? [] : [{ table: "decks", id }])),
  ];
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * Places a column: into the line of the wall with its base whose body holds its centre (its rotation, base and top then
 * the wall's), else free on `base` (the floor by default) up to `top` (the ceiling by default); row `${opId}/w0`, joints
 * `${opId}/j0` (a) and `${opId}/j1` (b).
 */
export function placeColumn(doc: Document, cmd: CommandOf<"placeColumn">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  const s = checked({ at: cmd.at, width: cmd.width, depth: cmd.depth, rotation: cmd.rotation ?? 0 });
  if (typeof s === "string") return err(domainError("invalidInput", s));
  const base: unknown = cmd.base ?? FLOOR_BASE; // commands arrive as JSON
  if (!isValidId(base) || (base !== FLOOR_BASE && !Object.hasOwn(doc.decks, base))) return err(domainError("notFound", "Deck not found"));
  const top = topOf(doc, cmd.top ?? "ceiling");
  if (typeof top === "object") return err(top);
  const line = wallUnder(doc, s.at, base);
  if (line !== null) return placeInLine(doc, cmd.opId, line, s);
  const id = `${cmd.opId}/w0`;
  return write(doc, { id, a: `${cmd.opId}/j0`, b: `${cmd.opId}/j1`, thickness: s.depth, top, base, column: true }, s, true);
}

/**
 * Sets a column's centre, width, depth, rotation or top; fields not given keep the column's values. Its joints are
 * rewritten only when the centre, width or rotation changes. A column in a wall's line slides along it (column-slide.ts)
 * and keeps its wall's top.
 */
export function setColumn(doc: Document, cmd: CommandOf<"setColumn">): CommandResult {
  const wall = isValidId(cmd.wallId) ? doc.walls[cmd.wallId] : undefined;
  if (!wall) return err(domainError("notFound", "Wall not found"));
  const column = columnOf(doc, wall.id);
  if (!column) return err(domainError("invalidInput", `Wall ${wall.id} is not a column`));
  const s = checked({ at: cmd.at ?? column.centre, width: cmd.width ?? column.width, depth: cmd.depth ?? column.depth, rotation: cmd.rotation ?? column.rotation });
  if (typeof s === "string") return err(domainError("invalidInput", s));
  const top = topOf(doc, cmd.top ?? wall.top);
  if (typeof top === "object") return err(top);
  if (column.line && top !== wall.top) return err(domainError("invalidInput", MESSAGES.columnKeepsWall));
  if (column.line) return slideInLine(doc, wall, column, column.line, s);
  const moved = s.at.x !== column.centre.x || s.at.y !== column.centre.y || s.width !== column.width || s.rotation !== column.rotation;
  if (!moved && s.depth === wall.thickness && top === wall.top) return ok({ doc, patch: diffPatch(doc, doc, [{ table: "walls", id: wall.id }]) });
  return write(doc, { ...wall, top }, s, moved);
}

