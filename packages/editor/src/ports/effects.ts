import type { Changeset, EntityKey, Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { Scene } from "../view/scene-types";
import type { ViewModel } from "../view/view-model";

// Async work the core asks the shell to do (spec §5.2). Results come back as events.
export type WorkspaceOp =
  | { type: "list"; requestId: string }
  | { type: "create"; requestId: string; name: string }
  | { type: "delete"; requestId: string; projectId: string }
  | { type: "open"; projectId: string; generation: string };

export type Effect =
  | { type: "render"; scene: Scene; view: ViewModel; camera: Camera } // the shell never reads editor state
  | { type: "workspace"; op: WorkspaceOp }
  | { type: "saveSnapshot"; projectId: string; writeId: string; content: string } // X1: declared, never emitted
  | { type: "submit"; projectId: string; generation: string; changeset: Changeset }
  | { type: "presence"; projectId: string; generation: string; cursor: Point | null; selection: EntityKey[] }
  | { type: "startTimer"; timerId: string; ms: number }
  | { type: "cancelTimer"; timerId: string };
