import { MESSAGES, OPENING_KINDS, execute, finishIssue, givenColour, incidentWalls, lowerHeightProblem, newOpeningId, levelHeight, namedViolation, openingLabel, type Command, type Document, type DomainError, type Finish, type Level, type OpeningKind, type Violation } from "@fm/domain";

import { plainText } from "./column-toast";

// Refusal toasts in plain words (spec item 9, ux-polish.36). The domain's messages name openings and walls by ID,
// which Claude's MCP replies need; a person reads the kind and "this" instead. Other messages are unchanged. Built
// from the violations and the command, never from the message text (arch-review R-09).

/** The toast for a domain refusal of `cmd` on `doc` (the document it ran on). */
/** A same-row clash with another client's edit (sheetset's Data, cleanup.09). */
export const CLASH_TEXT = "Someone else changed this first";

export function refusalText(error: DomainError, doc: Document, cmd: Command | null): string {
  return splitText(error.violations, doc, cmd) ?? openingText(error.violations, doc, cmd) ?? plainText(error.violations, cmd) ?? finishText(cmd) ?? error.message;
}

/** What `cmd` on `doc` would toast, or null if it runs: a live ghost's words (clarity.07), so only when asked for. */
export function reasonOf(doc: Document, cmd: Command): string | null {
  const r = execute(doc, cmd);
  return r.ok ? null : refusalText(r.error, doc, cmd);
}

/**
 * A finish refused by any command that carries one: the domain names the field by its path for Claude ("finish.size must
 * be 0.10–0.40"); a person reads the field's name, "Size must be 0.10–0.40", built from the command's finishes
 * (finishes.48), and a lower band's height as "Height must be 0.10–3.00". Each command's finishes are tested in the order
 * the domain tests them: the finish, the band's finish, the band's height.
 */
function finishText(cmd: Command | null): string | null {
  for (const { finish, surface } of finishesOf(cmd)) {
    const issue = finish ? finishIssue({ ...finish, colour: givenColour(finish.colour) }, surface) : null;
    if (issue) return capital(`${issue.field} ${issue.rule}`);
  }
  const height = bandHeightOf(cmd);
  const problem = height === null || height.value === undefined ? null : lowerHeightProblem(height.value); // none given: the band keeps its own
  return problem === null ? null : capital(problem);
}

const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

type Given = { finish: Finish | null; surface: "floor" | "wall" | "roof" };

/** The finishes a command carries, each with the surface whose rules check it; none for a command without one. */
function finishesOf(cmd: Command | null): Given[] {
  if (cmd === null) return [];
  if (cmd.type === "setFinish" || cmd.type === "labelZone" || cmd.type === "setDeckFinish") return [{ finish: cmd.finish, surface: "floor" }];
  if (cmd.type === "setWallFinish" || cmd.type === "setRoomWallFinishes" || cmd.type === "setOutsideFinish") return [{ finish: cmd.finish, surface: "wall" }];
  if (cmd.type === "setWallSide") return [{ finish: cmd.finish, surface: "wall" }, { finish: cmd.lower, surface: "wall" }];
  if (cmd.type === "setRoofCovering") return [{ finish: cmd.finish, surface: "roof" }];
  return [];
}

/** A lower band's height where the command sets a band: the height the domain checks, given or not. */
function bandHeightOf(cmd: Command | null): { value: number | undefined } | null {
  if (cmd === null) return null;
  if (cmd.type === "setWallFinish" || cmd.type === "setRoomWallFinishes" || cmd.type === "setOutsideFinish") return cmd.part === "lower" && cmd.finish !== null ? { value: cmd.height } : null;
  if (cmd.type === "setWallSide") return cmd.lower !== null ? { value: cmd.height } : null;
  return null;
}

/**
 * The refusal of a single piece put down at an upper level with none of its decks under the piece's centre (spec
 * "Placing at a level", levels.16): the editor's own, sent nowhere.
 */
export function noFloorAt(level: Level): string {
  return `No floor at ${levelHeight(level)} here`;
}

/**
 * A new wall ending inside an opening, a column dropped or slid over one, a wall split inside one or a joint dropped
 * onto one: addWall, placeColumn, setColumn, splitWall and connectJoint name the opening in an I12 violation.
 */
function splitText(violations: Violation[], doc: Document, cmd: Command | null): string | null {
  const named = namedViolation(violations);
  const cuts = cmd?.type === "addWall" || cmd?.type === "placeColumn" || cmd?.type === "setColumn" || cmd?.type === "splitWall" || cmd?.type === "connectJoint";
  if (!cuts || named?.invariant !== "I12") return null;
  const id = named.entities.find((k) => k.table === "openings")?.id;
  const opening = id === undefined ? undefined : doc.openings[id];
  const kind = opening?.kind;
  if (kind === undefined) return null;
  // A dropped joint stranding a door on its own wall is a door that doesn't fit, not a split (openingText's words).
  if (cmd.type === "connectJoint" && opening && incidentWalls(doc, cmd.jointId).includes(opening.wall)) return null;
  const what = OPENING_KINDS[kind].pocket ? OPENING_KINDS[kind].label.toLowerCase() : label(kind); // the cut may be in the pocket (openkinds.16)
  if (cmd.type === "splitWall") return `A wall can't be split inside a ${what}`;
  return cmd.type === "addWall" || cmd.type === "connectJoint" ? `A wall can't end inside a ${what}` : `A column can't cover a ${what}`;
}

/** Plain words for the opening violation (I12) the domain's message reports, or null when it reports another one. */
export function openingText(violations: Violation[], doc: Document, cmd: Command | null): string | null {
  const named = namedViolation(violations); // the violation the domain's message reports
  if (!named || named.invariant !== "I12") return null;
  // An opening that doesn't fit its wall's height, or two stacked too close
  // (sills.02, .04): the domain's plain words, worked out on the document the command would make, so a lowered wall or
  // ceiling shows its new height.
  if (named.plain !== undefined) return named.plain;
  const ids = named.entities.flatMap((k) => (k.table === "openings" ? [k.id] : []));
  const subject = subjectOf(cmd);
  const own = ids.find((id) => id === subject) ?? ids.at(-1); // the domain's message names the later one first
  if (own === undefined) return null;
  const known = own === subject;
  const ownKind = kindOf(own, doc, cmd);
  if (ownKind === null) return MESSAGES.opening; // unreachable: `doc` and `cmd` hold every opening checked
  const name = `${known ? "This" : "A"} ${label(ownKind)}`;
  const other = ids.find((id) => id !== own);
  if (other !== undefined) {
    const otherKind = kindOf(other, doc, cmd);
    return otherKind === null ? MESSAGES.opening : `${name} would overlap a ${label(otherKind)} on ${known ? "this" : "its"} wall`;
  }
  return named.entities.some((k) => k.table === "walls") ? `${name} doesn't fit on its wall` : `${name} is on a missing wall`;
}

/** The opening the command adds or changes, if any. */
function subjectOf(cmd: Command | null): string | null {
  if (cmd?.type === "addOpening") return newOpeningId(cmd.opId);
  if (cmd?.type === "moveOpening" || cmd?.type === "setOpening") return cmd.openingId;
  return null;
}

/** The kind the opening would have after the command: a new one is not in `doc`, and setOpening may change it. */
function kindOf(id: string, doc: Document, cmd: Command | null): OpeningKind | null {
  if (cmd?.type === "addOpening" && id === newOpeningId(cmd.opId)) return cmd.kind;
  if (cmd?.type === "setOpening" && id === cmd.openingId && cmd.kind) return cmd.kind;
  return doc.openings[id]?.kind ?? null;
}

function label(kind: OpeningKind): string {
  return openingLabel(kind).toLowerCase();
}
