import { assertNever, err, ok } from "@fm/protocol";
import { domainError } from "../errors";
import type { Document } from "../model";
import { isValidId } from "../shape";
import { addWall } from "./add-wall";
import { deleteEntities } from "./delete-entities";
import { labelZone, renameZone } from "./labels";
import { moveJoints } from "./move-joints";
import { setWallLength } from "./set-wall-length";
import type { Command, CommandResult } from "./types";

/**
 * Runs a command against a document without modifying it. For a valid input document (I1–I8) and a
 * command of the `Command` type, the result is a valid document or an error; malformed JSON commands
 * are not shape-checked here. A command that changes nothing returns an empty patch and the input
 * document itself; callers skip it.
 */
export function execute(doc: Document, cmd: Command): CommandResult {
  // One message ("Invalid ID") for malformed IDs from any command; each command also checks its own
  // lookups. Documents are plain objects: an ID such as "constructor" would find an inherited member.
  if (!commandIds(cmd).every(isValidId)) return err(domainError("invalidInput", "Invalid ID"));
  const result = run(doc, cmd);
  if (!result.ok) return result;
  const { patch } = result.value;
  return patch.puts.length === 0 && patch.deletes.length === 0 ? ok({ doc, patch }) : result;
}

function run(doc: Document, cmd: Command): CommandResult {
  switch (cmd.type) {
    case "addWall": return addWall(doc, cmd);
    case "moveJoints": return moveJoints(doc, cmd);
    case "setWallLength": return setWallLength(doc, cmd);
    case "labelZone": return labelZone(doc, cmd);
    case "renameZone": return renameZone(doc, cmd);
    case "deleteEntities": return deleteEntities(doc, cmd);
    default: return assertNever(cmd);
  }
}

/** Every entity ID the command names. addWall's opId is not one: addWall checks it with its own message. */
function commandIds(cmd: Command): string[] {
  switch (cmd.type) {
    case "addWall": return [cmd.from, cmd.to].flatMap((r) => ("existing" in r ? [r.existing] : []));
    case "moveJoints": return cmd.moves.map((m) => m.jointId);
    case "setWallLength": return [cmd.wallId];
    case "labelZone": return [cmd.id];
    case "renameZone": return [cmd.id];
    case "deleteEntities": return cmd.ids.map((r) => r.id);
    default: return assertNever(cmd);
  }
}
