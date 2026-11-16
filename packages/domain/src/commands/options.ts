import { err, ok, type Result } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import { kindOf } from "../kinds";
import type { Document, LayoutObject, Placement } from "../model";
import { OPTION_REFUSALS, hasOption, isObjectOption, withOption, type ObjectOption } from "../options";
import { diffPatch } from "../patch";
import { isValidId } from "../shape";
import { key, placementsOf } from "./object-helpers";
import type { CommandOf, CommandResult } from "./types";

/**
 * Turns one option on or off for an object whose kind lists it (library.10), in every layout; the last one off removes
 * the key. Like a name it takes part in no invariant but the row's shape, which the kind's column settles here, so it
 * is not validated again. The option and `on` are checked, since MCP and the editor build commands from JSON.
 */
export function setOption(doc: Document, cmd: CommandOf<"setOption">): CommandResult {
  const object = isValidId(cmd.objectId) ? doc.objects[cmd.objectId] : undefined;
  if (!object) return err(domainError("notFound", "Object not found"));
  const option: unknown = cmd.option;
  if (!isObjectOption(option)) return err(domainError("invalidInput", "Unknown option"));
  const on: unknown = cmd.on;
  if (typeof on !== "boolean") return err(domainError("invalidInput", "Invalid option"));
  const changed = optionChange(object, option, on);
  if (!changed.ok) return changed;
  const deps = [key("objects", object.id)];
  if (hasOption(object, option) === on) return ok({ doc, patch: diffPatch(doc, doc, deps) });
  const withObject: Document = { ...doc, objects: { ...doc.objects, [object.id]: changed.value } };
  if (option !== "leftEntry") return ok({ doc: withObject, patch: diffPatch(doc, withObject, deps) });
  const out = entrySideMoved(withObject, object.id);
  return ok({ doc: out, patch: diffPatch(doc, out, [...deps, ...placementsOf(doc, object.id).map((id) => key("placements", id))]) });
}

/**
 * `doc` with the winder `objectId`'s entry side switched under its use zones (steps.39): in every layout, its left and
 * right zones swap, on or off and their stored extents as they are (both sides' insets count from the back corner),
 * so the entry keeps its zone; front and back stay. Called once per change of `leftEntry`, by setOption and setStair.
 */
export function entrySideMoved(doc: Document, objectId: string): Document {
  const placements = { ...doc.placements };
  for (const id of placementsOf(doc, objectId)) {
    const p = doc.placements[id];
    if (p) placements[id] = mirroredZones(p);
  }
  return { ...doc, placements };
}

function mirroredZones(p: Placement): Placement {
  const z = p.zones;
  return {
    ...p,
    sides: { ...p.sides, left: p.sides.right, right: p.sides.left },
    zones: { ...z, leftDepth: z.rightDepth, leftStart: z.rightStart, leftEnd: z.rightEnd, rightDepth: z.leftDepth, rightStart: z.leftStart, rightEnd: z.leftEnd },
  };
}

/**
 * The one writer of an option (steps.07): `object` with `option` on or off, refused when its kind doesn't list it.
 * setOption and setStair (a winder's entry, a ladder's hooks) both go through it.
 */
export function optionChange<T extends LayoutObject>(object: T, option: ObjectOption, on: boolean): Result<T, DomainError> {
  if (kindOf(object.kind)?.options.includes(option) !== true) return err(domainError("invalidInput", OPTION_REFUSALS[option]));
  return ok(withOption(object, option, on));
}
