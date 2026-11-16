import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError, topologyMessage } from "../errors";
import { LOGO_ID, type Document } from "../model";
import { diffPatch } from "../patch";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult } from "./types";

// The studio's logo (sheetset.21). Each command depends on the one row, so two people choosing one at once clash; each
// result is validated, so I24 refuses a bad row.

const deps: EntityKey[] = [{ table: "logos", id: LOGO_ID }];

/** Places or replaces the logo. The same logo again writes nothing, so it adds no undo step. */
export function setLogo(doc: Document, cmd: CommandOf<"setLogo">): CommandResult {
  const next: Document = { ...doc, logos: { [LOGO_ID]: { id: LOGO_ID, data: cmd.data, width: cmd.width, height: cmd.height } } };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

export function removeLogo(doc: Document): CommandResult {
  if (!doc.logos[LOGO_ID]) return err(domainError("notFound", "Logo not found"));
  const next: Document = { ...doc, logos: {} };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
