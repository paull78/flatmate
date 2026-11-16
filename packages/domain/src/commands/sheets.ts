import { deepEqual, err, ok } from "@fm/protocol";
import type { EntityKey, Result } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import { SHEET_SLOTS, flatDrawings, sheetDrawings, type Document, type Sheet } from "../model";
import { diffPatch } from "../patch";
import { sheetsOf } from "../queries/sheets";
import { isValidId, isValidName, parseSheet } from "../shape";
import { sheetKindProblem, sheetProblem } from "../validate-sheets";
import { MAX_OP_ID_LENGTH, opIdUsed } from "./op-ids";
import type { CommandOf, CommandResult, SheetFields } from "./types";

// Sheet commands (sheetset.02). Each row is a small edit on its own, so different sheets both land and one sheet clashes.
// The exception is the first edit to an automatic list, which writes every row: `withRows` adds what the list came from.

const NOT_FOUND = err(domainError("notFound", "Sheet not found"));
const refused = (message: string): CommandResult => err(domainError("invalidInput", message));

/** A command that changes nothing: no rows, so an automatic list stays automatic. */
const unchanged = (doc: Document): CommandResult => ok({ doc, patch: diffPatch(doc, doc, []) });

/**
 * `rows` as the whole table. Equal IDs clash through their writes alone, as every first edit writes `auto/0` (sharedCommit
 * expects every write), so the layouts and decks are for a first edit racing a change to what the list was worked out from.
 */
function withRows(doc: Document, rows: readonly Sheet[], dependencies: readonly EntityKey[] = []): CommandResult {
  const automatic = Object.keys(doc.sheets).length === 0;
  const deps: EntityKey[] = !automatic ? [...dependencies] : [
    ...dependencies,
    ...Object.keys(doc.states).map((id): EntityKey => ({ table: "states", id })),
    ...sheetsOf(doc).flatMap((s) => sheetDrawings(s).flatMap((d): EntityKey[] => (d.deck === null ? [] : [{ table: "decks", id: d.deck }]))),
  ];
  const next: Document = { ...doc, sheets: Object.fromEntries(rows.map((s) => [s.id, s])) };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** `sheet` with the fields given, or why not. Its `order` and `id` stay. */
function withFields(doc: Document, sheet: Sheet, fields: Partial<SheetFields>): Result<Sheet, DomainError> {
  const refuse = (message: string): Result<Sheet, DomainError> => err(domainError("invalidInput", message));
  const kind = fields.kind ?? sheet.kind;
  // A flat row holds four, so more is refused from the list itself.
  const tooMany = fields.drawings && fields.drawings.length > SHEET_SLOTS.length ? sheetKindProblem(kind, fields.drawings.length) : null;
  if (tooMany) return refuse(tooMany);
  const next: Sheet = {
    id: sheet.id,
    kind,
    order: sheet.order,
    inPdf: fields.inPdf ?? sheet.inPdf,
    title: fields.title ?? sheet.title,
    scale: fields.scale === undefined ? sheet.scale : fields.scale,
    split: fields.split ?? sheet.split,
    cx: fields.cx ?? sheet.cx,
    cy: fields.cy ?? sheet.cy,
    finishes: fields.finishes ?? sheet.finishes,
    marks: fields.marks ?? sheet.marks,
    drawings: fields.drawings ? flatDrawings(fields.drawings) : sheet.drawings,
    text: fields.text ?? sheet.text,
    size: fields.size ?? sheet.size,
    section: fields.section === undefined ? sheet.section : fields.section,
  };
  if (!isValidName(next.title)) return refuse("Name too long");
  if (!parseSheet(next)) return refuse("Invalid sheet");
  const problem = sheetProblem(doc, next);
  return problem ? refuse(problem) : ok(next);
}

/**
 * `rest` with `sheet` at `index`. Its order goes halfway between its neighbours, so only its row changes and an edit to
 * another sheet still lands. With no number between them, or a tie left by two clients placing at once, all renumber.
 */
function placedAt(rest: readonly Sheet[], sheet: Sheet, index: number): Sheet[] {
  const before = rest[index - 1]?.order;
  const after = rest[index]?.order;
  const order = before === undefined ? (after === undefined ? 0 : after - 1) : after === undefined ? before + 1 : (before + after) / 2;
  if ((before === undefined || order > before) && (after === undefined || order < after)) return [...rest, { ...sheet, order }];
  return [...rest.slice(0, index), sheet, ...rest.slice(index)].map((s, i) => ({ ...s, order: i }));
}

/** A new sheet `${opId}/t0`, after the one given, or at the end; `first` puts it at the head, as a new cover goes (sheetset.70). */
export function addSheet(doc: Document, cmd: CommandOf<"addSheet">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return refused("Invalid operation ID");
  if (opIdUsed(doc, cmd.opId)) return refused("Operation ID already used");
  const list = sheetsOf(doc);
  const after = cmd.first === true ? -1 : cmd.after === null ? list.length - 1 : list.findIndex((s) => s.id === cmd.after);
  if (cmd.first !== true && cmd.after !== null && after < 0) return NOT_FOUND;
  const blank: Sheet = { id: `${cmd.opId}/t0`, kind: cmd.kind, order: 0, inPdf: true, title: "", scale: null, split: "auto", cx: 0, cy: 0, finishes: true, marks: true, drawings: flatDrawings([]), text: "", size: "normal", section: null };
  const sheet = withFields(doc, blank, cmd);
  if (!sheet.ok) return sheet;
  return withRows(doc, placedAt(list, sheet.value, after + 1), [{ table: "sheets", id: sheet.value.id }]);
}

/** The fields given on one sheet. Depends only on that row, as `setProjectField` does. */
export function setSheet(doc: Document, cmd: CommandOf<"setSheet">): CommandResult {
  const list = sheetsOf(doc);
  const sheet = list.find((s) => s.id === cmd.sheetId);
  if (!sheet) return NOT_FOUND;
  const next = withFields(doc, sheet, cmd);
  if (!next.ok) return next;
  if (deepEqual(next.value, sheet)) return unchanged(doc);
  return withRows(doc, list.map((s) => (s.id === sheet.id ? next.value : s)), [{ table: "sheets", id: sheet.id }]);
}

/** Removes a sheet. The last stays, as the last layout does: no rows would read as the automatic list. */
export function deleteSheet(doc: Document, cmd: CommandOf<"deleteSheet">): CommandResult {
  const list = sheetsOf(doc);
  if (!list.some((s) => s.id === cmd.sheetId)) return NOT_FOUND;
  if (list.length <= 1) return refused("A project keeps at least one sheet");
  return withRows(doc, list.filter((s) => s.id !== cmd.sheetId), [{ table: "sheets", id: cmd.sheetId }]);
}

/** Moves a sheet so that `index` is its place in the list. */
export function moveSheet(doc: Document, cmd: CommandOf<"moveSheet">): CommandResult {
  const list = sheetsOf(doc);
  const from = list.findIndex((s) => s.id === cmd.sheetId);
  const sheet = list[from];
  if (!sheet) return NOT_FOUND;
  if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= list.length) return refused("That place isn't in the list");
  if (cmd.index === from) return unchanged(doc);
  return withRows(doc, placedAt(list.filter((s) => s.id !== sheet.id), sheet, cmd.index), [{ table: "sheets", id: sheet.id }]);
}

/** Every sheet ticked or cleared, in one step (All and None). */
export function setSheetsInPdf(doc: Document, cmd: CommandOf<"setSheetsInPdf">): CommandResult {
  const list = sheetsOf(doc);
  if (list.every((s) => s.inPdf === cmd.on)) return unchanged(doc);
  return withRows(doc, list.map((s) => ({ ...s, inPdf: cmd.on })));
}
