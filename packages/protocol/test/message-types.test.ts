import { describe, expect, it } from "vitest";
import { assertNever, MAX_MESSAGE_BYTES, type ClientMessage, type RejectReason, type ServerMessage } from "../src/index";

// One label per ServerMessage variant: adding a variant without a case fails `pnpm check` (typecheck).
function describeServerMessage(m: ServerMessage): string {
  switch (m.type) {
    case "welcome":
      return `welcome ${m.clientId}`;
    case "projects":
      return `projects ${m.items.length}`;
    case "projectCreated":
      return `projectCreated ${m.meta.id}`;
    case "error":
      return `error ${m.message}`;
    case "snapshot":
      return `snapshot ${m.projectId}@${m.seq}`;
    case "openFailed":
      return `openFailed ${m.projectId}/${m.generation}`;
    case "changes":
      return `changes ${m.seq}`;
    case "ack":
      return `ack ${m.changesetId}`;
    case "rejected":
      return `rejected ${m.changesetId}`;
    case "presence":
      return `presence ${m.clientId}`;
    case "presenceLeft":
      return `presenceLeft ${m.clientId}`;
    default:
      return assertNever(m);
  }
}

describe("message types", () => {
  it("caps messages at 1 MB (spec §7.2)", () => {
    expect(MAX_MESSAGE_BYTES).toBe(1_000_000);
  });

  it("type-checks a rejection and a hello (compile-time contract)", () => {
    const reason: RejectReason = { kind: "conflict", entities: [{ table: "joints", id: "j1" }] };
    const rejected: ServerMessage = { type: "rejected", projectId: "p1", generation: "g1", changesetId: "c1", reason };
    const hello: ClientMessage = { type: "hello", clientId: "tab1", name: "Alice" };
    // @ts-expect-error openProject uses projectId, not id
    const wrongOpen: ClientMessage = { type: "openProject", id: "p1", generation: "g1" };
    expect([rejected.type, hello.type, wrongOpen.type]).toEqual(["rejected", "hello", "openProject"]);
  });

  it("ties a failed open to the project and generation it answers", () => {
    const failed: ServerMessage = { type: "openFailed", projectId: "p1", generation: "g2", message: "unknown project" };
    expect(failed).toEqual({ type: "openFailed", projectId: "p1", generation: "g2", message: "unknown project" });
  });

  it("switches exhaustively over server messages", () => {
    expect(describeServerMessage({ type: "welcome", clientId: "tab1", color: "#f00" })).toBe("welcome tab1");
    expect(describeServerMessage({ type: "openFailed", projectId: "p1", generation: "g2", message: "unknown project" })).toBe(
      "openFailed p1/g2",
    );
  });
});
