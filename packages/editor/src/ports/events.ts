import type { Command } from "@fm/domain";
import type { Point, ProjectMeta, ServerMessage } from "@fm/protocol";
import type { Mods, Size, ToolName } from "../types";

// What React panels send; tests send the same (spec §5.2).
export type UiAction =
  | { type: "createProject"; name: string }
  | { type: "openProject"; id: string }
  | { type: "showProjectList" }
  | { type: "deleteProject"; id: string }
  | { type: "pickTool"; tool: ToolName }
  | { type: "setField"; fieldId: string; value: string }
  | { type: "undo" }
  | { type: "redo" };

export type WorkspaceEvent =
  | { type: "projects"; requestId: string; items: ProjectMeta[] }
  | { type: "created"; requestId: string; meta: ProjectMeta }
  | { type: "failed"; requestId: string | null; message: string };

export type ServerEvent =
  | Extract<ServerMessage, { type: "welcome" | "snapshot" | "openFailed" | "projectDeleted" | "changes" | "ack" | "rejected" | "presence" | "presenceLeft" }>
  | { type: "connection"; state: "open" | "closed" };

export type Event =
  | { type: "pointerDown" | "pointerMove" | "pointerUp"; screen: Point; mods: Mods; button: 0 | 1 | 2 }
  | { type: "wheel"; screen: Point; deltaX: number; deltaY: number; mods: Mods }
  | { type: "key"; key: string; mods: Mods } // KeyboardEvent.key, except digits and "." taken from the physical key code (spec §5.4)
  | { type: "ui"; action: UiAction }
  | { type: "timerFired"; timerId: string }
  | { type: "workspaceEvent"; event: WorkspaceEvent }
  | { type: "saveResult"; writeId: string; ok: boolean; error?: string } // X1: ignored
  | { type: "serverEvent"; event: ServerEvent }
  | { type: "viewportResized"; size: Size; devicePixelRatio: number }
  | { type: "command"; command: Command }; // a domain command from a shell without pointer input (MCP, spec §12)

export type PointerInput = Extract<Event, { type: "pointerDown" | "pointerMove" | "pointerUp" }>;
