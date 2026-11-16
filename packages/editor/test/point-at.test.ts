import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import { roomDoc } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// A cursor moved by a shell with no pointer (MCP, cleanup step 10): the pointAt event sets the pointer and tells the
// others, without hover or tool logic, unlike a pointerMove.

const ON_WALL = { x: 3, y: 0 }; // on roomDoc's bottom wall: a pointerMove here hovers it

describe("the pointAt event", () => {
  it("moves the cursor without hover or tool side effects", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const tool = shell.state.tool;
    shell.send({ type: "pointAt", world: ON_WALL });
    expect(shell.state.pointer?.world).toEqual(ON_WALL);
    expect(shell.state.hover).toBeNull();
    expect(shell.state.tool).toEqual(tool);
    shell.moveTo(ON_WALL); // the control: a pointerMove there hovers the wall
    expect(shell.state.hover).not.toBeNull();
  });

  it("emits presence with the exact point while connected, and nothing in local mode", () => {
    const remote = FakeRemote.open(roomDoc());
    const effects = remote.shell.send({ type: "pointAt", world: { x: 1.23456789, y: 2 } });
    expect(effects.flatMap((e) => (e.type === "presence" ? [e.cursor] : []))).toEqual([{ x: 1.23456789, y: 2 }]);
    expect(FakeShell.withDocument(roomDoc()).send({ type: "pointAt", world: ON_WALL }).filter((e) => e.type === "presence")).toEqual([]);
  });

  it("an edit after pointAt leaves hover empty", () => {
    const remote = FakeRemote.open(roomDoc());
    remote.shell.send({ type: "pointAt", world: ON_WALL });
    const wall: Command = { type: "addWall", opId: "pa", from: { at: { x: 1, y: 1 } }, to: { at: { x: 1, y: 3 } } };
    remote.shell.send({ type: "command", command: wall });
    expect(remote.shell.state.hover).toBeNull();
  });
});
