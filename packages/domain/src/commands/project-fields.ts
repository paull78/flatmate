import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError } from "../errors";
import type { Document } from "../model";
import { diffPatch } from "../patch";
import { projectFieldOf, projectFieldProblem } from "../project-fields";
import type { CommandOf, CommandResult } from "./types";

/** Sets a title block field (sheet.02, .05); "" removes its row. Depends only on that row, so fields never conflict. */
export function setProjectField(doc: Document, cmd: CommandOf<"setProjectField">): CommandResult {
  const field = projectFieldOf(cmd.key);
  if (!field) return err(domainError("invalidInput", `Unknown project field ${cmd.key}`));
  const problem = cmd.value === "" ? null : projectFieldProblem(field, cmd.value);
  if (problem !== null) return err(domainError("invalidInput", problem));
  const deps: EntityKey[] = [{ table: "projectFields", id: field.key }];
  const current = doc.projectFields[field.key]?.value ?? "";
  if (cmd.value === current) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const projectFields = { ...doc.projectFields };
  if (cmd.value === "") delete projectFields[field.key];
  else projectFields[field.key] = { id: field.key, value: cmd.value };
  const next: Document = { ...doc, projectFields };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
