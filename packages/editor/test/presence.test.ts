import { describe, expect, it } from "vitest";
import { roomDoc } from "./builders";
import { FakeRemote } from "./fake-remote";

function presenceLayer(r: FakeRemote) {
  return r.shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
}

describe("presence in the scene (spec §7.6)", () => {
  it("draws each remote cursor with its name in the collaborator's colour", () => {
    const r = FakeRemote.open(roomDoc());
    r.event({ type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090ff", cursor: { x: 1, y: 2 }, selection: [] });
    const layer = presenceLayer(r);
    expect(layer).toContainEqual({ kind: "disc", center: { x: 1, y: 2 }, radius: { px: 5 }, color: "#0090ff" });
    expect(layer.some((p) => p.kind === "text" && p.text === "Bob" && p.color === "#0090ff")).toBe(true);
  });

  it("draws nothing for a collaborator without a cursor", () => {
    const r = FakeRemote.open(roomDoc());
    r.event({ type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090ff", cursor: null, selection: [] });
    expect(presenceLayer(r)).toEqual([]);
  });
});
