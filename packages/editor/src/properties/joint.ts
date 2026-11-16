import { isStraightJoint, kinkAngle, shown, type Command, type Document } from "@fm/domain";
import { reasonOf } from "../toast-text";
import { field, type FieldCommand, type Properties } from "./fields";

// A joint's Properties: its position, read-only (it moves by dragging), and on a straight joint (two walls in line, or
// up to 1° out of line) Join walls (straight.05): the same as Delete there. Where the join would be refused, the action
// is disabled and the reason shows under it.

/** Joints with two walls at most this far out of line offer Join walls (disabled, with the angle as the reason). */
const NEAR_STRAIGHT_DEG = 1;

/** The command Join walls sends: Delete on the joint, which the domain joins (straight.05). */
export function joinCommand(jointId: string): Command {
  return { type: "deleteEntities", ids: [{ table: "joints", id: jointId }] };
}

/** Whether the joint is straight or nearly so: two walls, in line or within 1° of it. */
function joinable(doc: Document, jointId: string): boolean {
  const kink = kinkAngle(doc, jointId);
  return kink !== null && (isStraightJoint(doc, jointId) || kink <= NEAR_STRAIGHT_DEG);
}

export function jointFields(doc: Document, jointId: string): Properties {
  const j = doc.joints[jointId];
  if (!j) return { kind: "none" };
  const fields = [field("Joint", "x", "X", shown(j.x), "m"), field("Joint", "y", "Y", shown(j.y), "m")];
  if (joinable(doc, jointId)) {
    const reason = reasonOf(doc, joinCommand(jointId));
    fields.push({ ...field("Joint", "join", "", "Join walls", null, reason !== null), action: true });
    if (reason !== null) fields.push({ ...field("Joint", "join.reason", "", reason, null), hint: true });
  }
  return { kind: "joint", fields };
}

/** Join walls sends the delete; the position fields are read-only. */
export function jointFieldCommand(jointId: string, fieldId: string): FieldCommand {
  return fieldId === "join" ? joinCommand(jointId) : null;
}
