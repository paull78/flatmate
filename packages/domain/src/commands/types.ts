import type { Point, Result } from "@fm/protocol";
import type { DomainError } from "../errors";
import type { Document, EntityRef } from "../model";
import type { DomainPatch } from "../patch";

export type JointRef = { existing: string } | { at: Point };

export type Command =
  | { type: "addWall"; opId: string; from: JointRef; to: JointRef }
  | { type: "moveJoints"; moves: { jointId: string; to: Point }[] }
  | { type: "setWallLength"; wallId: string; length: number; keep: "a" | "b" }
  | { type: "labelZone"; id: string; at: Point; name: string }
  | { type: "renameZone"; id: string; name: string }
  | { type: "deleteEntities"; ids: EntityRef[] };

export type CommandOf<T extends Command["type"]> = Extract<Command, { type: T }>;
export type CommandResult = Result<{ doc: Document; patch: DomainPatch }, DomainError>;
