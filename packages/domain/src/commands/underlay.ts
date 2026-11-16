import { err, ok } from "@fm/protocol";
import type { EntityKey } from "@fm/protocol";
import { domainError, topologyMessage } from "../errors";
import { PROVISIONAL_METRES_PER_PIXEL, UNDERLAY_ID, UNDERLAY_MIME, type Document, type Underlay } from "../model";
import { diffPatch } from "../patch";
import { coversArea } from "../underlay";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult } from "./types";

// The plan underlay's commands (import.13, .15, .16). Each depends on the one row, so a concurrent second drop, or a
// scale racing a replace, fails its expectation on the server. Each result is validated, so I16 refuses a bad row.

const deps: EntityKey[] = [{ table: "underlays", id: UNDERLAY_ID }];

function finish(doc: Document, row: Underlay): CommandResult {
  const next: Document = { ...doc, underlays: { [UNDERLAY_ID]: row } };
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}

/** Places or replaces the picture, fresh: unscaled at the provisional scale (import.15). The domain sets both. */
export function placeUnderlay(doc: Document, cmd: CommandOf<"placeUnderlay">): CommandResult {
  return finish(doc, {
    id: UNDERLAY_ID, pictureId: cmd.pictureId, mime: UNDERLAY_MIME, data: cmd.data, width: cmd.width, height: cmd.height,
    at: { x: cmd.at.x, y: cmd.at.y }, metresPerPixel: PROVISIONAL_METRES_PER_PIXEL, scaled: false,
  });
}

/** Sets the scale so plan points a and b, as picture points, lie `distance` apart; a stays where it is (import.13). */
export function scaleUnderlay(doc: Document, cmd: CommandOf<"scaleUnderlay">): CommandResult {
  const u = doc.underlays[UNDERLAY_ID];
  if (!u) return err(domainError("notFound", "Underlay not found"));
  const { a, b, distance } = cmd;
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return err(domainError("invalidInput", "Invalid scale points"));
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(len)) return err(domainError("invalidInput", "Invalid scale points"));
  if (len < 1e-9) return err(domainError("invalidInput", "Scale points must be apart"));
  if (!Number.isFinite(distance) || distance <= 0) return err(domainError("invalidInput", "Distance must be more than 0"));
  const k = distance / len;
  const metresPerPixel = u.metresPerPixel * k;
  const at = { x: a.x + (u.at.x - a.x) * k, y: a.y + (u.at.y - a.y) * k };
  if (u.scaled && metresPerPixel === u.metresPerPixel && at.x === u.at.x && at.y === u.at.y) {
    return ok({ doc, patch: diffPatch(doc, doc, deps) });
  }
  const next: Underlay = { ...u, at, metresPerPixel, scaled: true };
  // An overflowing or underflowing scale would fail I8 or I16 with a generic toast; refuse it with a reason instead.
  if (!coversArea(next)) return err(domainError("invalidInput", "Scale out of range"));
  return finish(doc, next);
}

export function removeUnderlay(doc: Document): CommandResult {
  if (!doc.underlays[UNDERLAY_ID]) return err(domainError("notFound", "Underlay not found"));
  const next: Document = { ...doc, underlays: {} };
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
