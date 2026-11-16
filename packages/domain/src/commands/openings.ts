import { err, ok } from "@fm/protocol";
import { newOpeningId } from "./created-ids";
import type { EntityKey } from "@fm/protocol";
import { domainError, topologyMessage } from "../errors";
import { OPENING_KINDS, dressingRefusal, isOpeningKind, isSheer, type OpeningKind, type Sheer } from "../kinds";
import { isOpeningWidth, type Document, type Opening } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { openingHeightsFor } from "../queries/openings";
import { defaultOpeningHeights, wallRange } from "../queries/vertical";
import { validateDocument } from "../validate";
import { lockWall } from "./column-lock";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult } from "./types";
import { shown } from "../format";

// Opening commands (spec: openings): doors and windows on walls, shared by every layout. Each result is validated, so
// I12 refuses an opening off its wall or over another one, with a message naming the opening.


/** The opening and what its fit depends on: its wall and the wall's joints (the length). */
function openingDeps(doc: Document, o: Opening): EntityKey[] {
  const wall = doc.walls[o.wall];
  return [
    { table: "openings", id: o.id },
    { table: "walls", id: o.wall },
    ...(wall ? [wall.a, wall.b].map((id): EntityKey => ({ table: "joints", id })) : []),
  ];
}

function widthMessage(kind: OpeningKind): string {
  const r = OPENING_KINDS[kind].width;
  return `${OPENING_KINDS[kind].label} width must be between ${shown(r.min)} and ${shown(r.max)} m`;
}

/** Checks the fields every opening command may set; null when they are fine. */
function fieldError(o: Opening): string | null {
  if (!isOpeningKind(o.kind)) return "Unknown opening kind";
  if (!isFiniteNumber(o.offset)) return "Invalid offset";
  if (!isOpeningWidth(o.kind, o.width)) return widthMessage(o.kind);
  if (o.side !== "left" && o.side !== "right") return "Invalid side";
  if (o.hinge !== "a" && o.hinge !== "b") return "Invalid hinge";
  if (typeof o.glazed !== "boolean") return "Invalid glazing";
  if (!isFiniteNumber(o.sill) || !isFiniteNumber(o.head)) return "Invalid height";
  if (o.sheer !== undefined && !isSheer(o.sheer)) return "Invalid sheer curtain";
  if ((o.sheer !== undefined || o.shutterBox !== undefined) && !OPENING_KINDS[o.kind].dressings) return dressingRefusal(o.kind);
  return null;
}


/**
 * `o` with its dressing as a command gives it (hangings.04): a sheer to the glass or the floor, "none" for none; a
 * shutter box true or false; absent fields stay. Fields set to none are left out of the row, never stored empty.
 */
function dressed(o: Opening, sheer: Sheer | "none" | undefined, shutterBox: boolean | undefined): Opening {
  const out: Opening = { ...o };
  if (sheer === "none") delete out.sheer;
  else if (sheer !== undefined) out.sheer = sheer;
  if (shutterBox === false) delete out.shutterBox;
  else if (shutterBox === true) out.shutterBox = true;
  return out;
}

function sameOpening(p: Opening, q: Opening): boolean {
  return p.wall === q.wall && p.kind === q.kind && p.offset === q.offset && p.width === q.width && p.side === q.side && p.hinge === q.hinge && p.glazed === q.glazed && p.sill === q.sill && p.head === q.head
    && p.sheer === q.sheer && p.shutterBox === q.shutterBox; // the dressing too, or setting it alone would change nothing (hangings.04)
}

function finish(doc: Document, before: Opening | undefined, after: Opening): CommandResult {
  const bad = fieldError(after);
  if (bad) return err(domainError("invalidInput", bad));
  const deps = openingDeps(doc, after);
  if (before && sameOpening(before, after)) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const next: Document = { ...doc, openings: { ...doc.openings, [after.id]: after } };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/**
 * A new opening `${opId}/d0`; width defaults to the kind's, side to left, hinge to a, glazed to false, and the sill and
 * head not given to the floor's defaults on its wall (sills.01, `defaultOpeningHeights`).
 */
export function addOpening(doc: Document, cmd: CommandOf<"addOpening">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  if (opIdUsed(doc, cmd.opId)) return err(domainError("invalidInput", "Operation ID already used"));
  if (!isValidId(cmd.wall) || !doc.walls[cmd.wall]) return err(domainError("notFound", "Wall not found"));
  const locked = lockWall(doc, cmd.wall); // no opening on a column (pillars.22)
  if (locked) return err(locked);
  if (!isOpeningKind(cmd.kind)) return err(domainError("invalidInput", "Unknown opening kind"));
  const range = wallRange(doc, cmd.wall);
  if (!range) return err(domainError("notFound", "Wall not found"));
  return finish(doc, undefined, dressed({
    id: newOpeningId(cmd.opId),
    wall: cmd.wall,
    kind: cmd.kind,
    offset: cmd.offset,
    width: cmd.width ?? OPENING_KINDS[cmd.kind].width.default,
    side: cmd.side ?? "left",
    hinge: cmd.hinge ?? "a",
    glazed: cmd.glazed ?? false,
    ...defaultOpeningHeights(OPENING_KINDS[cmd.kind].fromFloor, range.top - range.bottom),
    ...(cmd.sill === undefined ? {} : { sill: cmd.sill }),
    ...(cmd.head === undefined ? {} : { head: cmd.head }),
  }, cmd.sheer, cmd.shutterBox));
}

export function moveOpening(doc: Document, cmd: CommandOf<"moveOpening">): CommandResult {
  const o = isValidId(cmd.openingId) ? doc.openings[cmd.openingId] : undefined;
  if (!o) return err(domainError("notFound", "Opening not found"));
  return finish(doc, o, { ...o, offset: cmd.offset });
}

/**
 * Changes any of kind, width, side, hinge, glazed, sill and head; the fields a kind ignores are kept (spec: openings). A new kind with
 * no width clamps the width into the kind's range, keeping the opening's centre (openkinds.06); validation then refuses
 * a clamped opening that leaves its wall or meets another one. A width given outside the kind's range is refused.
 */
export function setOpening(doc: Document, cmd: CommandOf<"setOpening">): CommandResult {
  const o = isValidId(cmd.openingId) ? doc.openings[cmd.openingId] : undefined;
  if (!o) return err(domainError("notFound", "Opening not found"));
  const kind = cmd.kind ?? o.kind;
  const clamped = cmd.width === undefined && kind !== o.kind && isOpeningKind(kind) ? clampedSpan(o, kind) : { offset: o.offset, width: cmd.width ?? o.width };
  // Between a door or doorway and a window the head stays and the sill takes the new kind's (sills.07).
  const switched = isOpeningKind(kind) ? openingHeightsFor(o, kind) : o;
  // A kind that takes no dressing drops the window's (hangings.04): a window switched to a door loses its curtain.
  const keeps = isOpeningKind(kind) && OPENING_KINDS[kind].dressings;
  if (!keeps && isOpeningKind(kind) && ((cmd.sheer !== undefined && cmd.sheer !== "none") || cmd.shutterBox === true)) return err(domainError("invalidInput", dressingRefusal(kind))); // asked for, not dropped
  return finish(doc, o, dressed({
    ...o,
    kind,
    ...clamped,
    sill: cmd.sill ?? switched.sill,
    head: cmd.head ?? switched.head,
    side: cmd.side ?? o.side,
    hinge: cmd.hinge ?? o.hinge,
    glazed: cmd.glazed ?? o.glazed,
  }, keeps ? cmd.sheer : "none", keeps ? cmd.shutterBox : false));
}

/** `o`'s span with its width clamped into `kind`'s range and its centre kept, the offset to the micrometre. */
function clampedSpan(o: Opening, kind: OpeningKind): { offset: number; width: number } {
  const r = OPENING_KINDS[kind].width;
  const width = Math.min(r.max, Math.max(r.min, o.width));
  return { width, offset: Math.round((o.offset + (o.width - width) / 2) * 1e6) / 1e6 };
}

export function removeOpening(doc: Document, cmd: CommandOf<"removeOpening">): CommandResult {
  const o = isValidId(cmd.openingId) ? doc.openings[cmd.openingId] : undefined;
  if (!o) return err(domainError("notFound", "Opening not found"));
  const openings = { ...doc.openings };
  delete openings[o.id];
  const next: Document = { ...doc, openings };
  return ok({ doc: next, patch: diffPatch(doc, next, [{ table: "openings", id: o.id }]) });
}
