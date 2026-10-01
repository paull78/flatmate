import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@fm/protocol";
import { clientMessageFor, serverMessageEvent } from "../src/ports/wire";

const changeset = { id: "c1", patch: { puts: [], deletes: [{ table: "joints" as const, id: "j1" }] }, expect: [{ table: "joints" as const, id: "j1", lastCs: "c0" }] };

describe("wire mappings (one translation for every shell)", () => {
  it("turns workspace replies into workspace events", () => {
    const meta = { id: "p1", name: "Apartment" };
    expect(serverMessageEvent({ type: "projects", requestId: "r1", items: [meta] })).toEqual({
      type: "workspaceEvent", event: { type: "projects", requestId: "r1", items: [meta] },
    });
    expect(serverMessageEvent({ type: "projectCreated", requestId: "r2", meta })).toEqual({
      type: "workspaceEvent", event: { type: "created", requestId: "r2", meta },
    });
    expect(serverMessageEvent({ type: "error", requestId: null, message: "Message is not JSON" })).toEqual({
      type: "workspaceEvent", event: { type: "failed", requestId: null, message: "Message is not JSON" },
    });
  });

  it("passes identity, project and presence messages through as server events", () => {
    const messages: ServerMessage[] = [
      { type: "welcome", clientId: "tab1", color: "#e5484d" },
      { type: "openFailed", projectId: "p1", generation: "g1", message: "Unknown project" },
      { type: "projectDeleted", projectId: "p1", generation: "g1" },
      { type: "ack", projectId: "p1", generation: "g1", changesetId: "c1", seq: 3 },
      { type: "presenceLeft", projectId: "p1", generation: "g1", clientId: "bob" },
    ];
    for (const m of messages) expect(serverMessageEvent(m)).toEqual({ type: "serverEvent", event: m });
  });

  it("turns effects into client messages", () => {
    expect(clientMessageFor({ type: "workspace", op: { type: "list", requestId: "r1" } })).toEqual({ type: "listProjects", requestId: "r1" });
    expect(clientMessageFor({ type: "workspace", op: { type: "create", requestId: "r2", name: "Apartment" } })).toEqual({
      type: "createProject", requestId: "r2", name: "Apartment",
    });
    expect(clientMessageFor({ type: "workspace", op: { type: "delete", requestId: "r3", projectId: "p1" } })).toEqual({
      type: "deleteProject", requestId: "r3", projectId: "p1",
    });
    expect(clientMessageFor({ type: "workspace", op: { type: "open", projectId: "p1", generation: "g1" } })).toEqual({
      type: "openProject", projectId: "p1", generation: "g1",
    });
    expect(clientMessageFor({ type: "submit", projectId: "p1", generation: "g1", changeset })).toEqual({
      type: "submit", projectId: "p1", generation: "g1", changeset,
    });
    expect(clientMessageFor({ type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1, y: 2 }, selection: [] })).toEqual({
      type: "presence", projectId: "p1", generation: "g1", cursor: { x: 1, y: 2 }, selection: [],
    });
  });
});
