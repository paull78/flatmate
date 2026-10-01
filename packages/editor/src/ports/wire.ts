import { assertNever, type ClientMessage, type ServerMessage } from "@fm/protocol";
import type { Effect } from "./effects";
import type { Event } from "./events";

// Shells translate the protocol with these two functions (web adapter, sync tests). Pure, so they live in the core.

export type ServerEffect = Extract<Effect, { type: "workspace" | "submit" | "presence" }>;

export function serverMessageEvent(msg: ServerMessage): Event {
  switch (msg.type) {
    case "projects":
      return { type: "workspaceEvent", event: { type: "projects", requestId: msg.requestId, items: msg.items } };
    case "projectCreated":
      return { type: "workspaceEvent", event: { type: "created", requestId: msg.requestId, meta: msg.meta } };
    case "error":
      return { type: "workspaceEvent", event: { type: "failed", requestId: msg.requestId, message: msg.message } };
    case "welcome":
    case "snapshot":
    case "openFailed":
    case "projectDeleted":
    case "changes":
    case "ack":
    case "rejected":
    case "presence":
    case "presenceLeft":
      return { type: "serverEvent", event: msg };
    default:
      return assertNever(msg);
  }
}

export function clientMessageFor(effect: ServerEffect): ClientMessage {
  switch (effect.type) {
    case "workspace": {
      const op = effect.op;
      switch (op.type) {
        case "list":
          return { type: "listProjects", requestId: op.requestId };
        case "create":
          return { type: "createProject", requestId: op.requestId, name: op.name };
        case "delete":
          return { type: "deleteProject", requestId: op.requestId, projectId: op.projectId };
        case "open":
          return { type: "openProject", projectId: op.projectId, generation: op.generation };
        default:
          return assertNever(op);
      }
    }
    case "submit":
      return { type: "submit", projectId: effect.projectId, generation: effect.generation, changeset: effect.changeset };
    case "presence":
      return { type: "presence", projectId: effect.projectId, generation: effect.generation, cursor: effect.cursor, selection: effect.selection };
    default:
      return assertNever(effect);
  }
}
