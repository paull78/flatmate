import { err, ok } from "@fm/protocol";
import type { EntityKey, Point } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage } from "../errors";
import type { Document, Section } from "../model";
import { diffPatch } from "../patch";
import { roundMm } from "../queries/footprints";
import { nextSectionLetter } from "../queries/sections";
import { parsePoint } from "../shape";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult } from "./types";

// Section commands (section.09). Each depends on its own row only: no rule reads anything else, and the letter being the
// row's ID makes two people taking one an ordinary clash. Commands arrive as JSON from MCP and the editor.

const deps = (id: string): EntityKey[] => [{ table: "sections", id }];

/** The row kept to the millimetre, or the refusal's text. The rest of what a section must be is I25. */
function cleanRow(row: Section): Section | string {
  const a = parsePoint(row.a);
  const b = parsePoint(row.b);
  if (!a || !b) return "Invalid position";
  const side: unknown = row.side;
  if (side !== 1 && side !== -1) return "A section looks to one side of its line: 1 or -1";
  const depth: unknown = row.depth;
  if (depth !== null && (typeof depth !== "number" || !Number.isFinite(depth))) return "Invalid depth";
  const mm = ({ x, y }: Point): Point => ({ x: roundMm(x), y: roundMm(y) });
  return { id: row.id, a: mm(a), b: mm(b), side, depth: depth === null ? null : roundMm(depth) };
}

function withRow(doc: Document, row: Section): CommandResult {
  const clean = cleanRow(row);
  if (typeof clean === "string") return err(domainError("invalidInput", clean));
  const next: Document = { ...doc, sections: { ...doc.sections, [row.id]: clean } };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps(row.id)) });
}

/** A section under the first letter with no row in this document, looking at the whole drawing unless given a depth. */
export function addSection(doc: Document, cmd: CommandOf<"addSection">): CommandResult {
  const id = nextSectionLetter(doc);
  if (id === undefined) return err(domainError("invalid", MESSAGES.sectionsFull));
  return withRow(doc, { id, a: cmd.a, b: cmd.b, side: cmd.side, depth: cmd.depth ?? null });
}

/** Sets any of a section's fields; the rest keep their values. A `depth` of null is whole, so only undefined keeps it. */
export function setSection(doc: Document, cmd: CommandOf<"setSection">): CommandResult {
  const row = doc.sections[cmd.sectionId];
  if (!row) return err(domainError("notFound", "Section not found"));
  return withRow(doc, { ...row, a: cmd.a ?? row.a, b: cmd.b ?? row.b, side: cmd.side ?? row.side, depth: cmd.depth === undefined ? row.depth : cmd.depth });
}
