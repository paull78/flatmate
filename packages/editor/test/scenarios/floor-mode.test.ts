import { describe, expect, it } from "vitest";
import { motifDefaults } from "@fm/domain";
import { dividedRoomDoc } from "../builders";
import { FakeShell } from "../fake-shell";

// The Floor mode (finishes.19, AC-07): a Floors tile arms a motif, each click lays it in a room, one undo per click.

describe("Floor mode scenario (AC-07, AC-01)", () => {
  it("arm planks, click two rooms, undo once: one room keeps planks and the mode stays armed", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    shell.ui({ type: "pickMotif", motif: "planks" });
    expect(shell.view().commandBar.prompt).toBe("Click a floor to lay Planks");
    shell.moveTo({ x: 1.5, y: 2 });
    shell.click({ x: 1.5, y: 2 });
    shell.moveTo({ x: 4.5, y: 2 });
    shell.click({ x: 4.5, y: 2 });
    const finished = () => Object.values(shell.doc().zoneLabels).map((l) => [l.name, l.finish]);
    expect(finished()).toEqual(expect.arrayContaining([["Room 1", motifDefaults("planks")], ["Room 2", motifDefaults("planks")]]));
    expect(finished()).toHaveLength(2);
    shell.ui({ type: "undo" });
    expect(finished()).toEqual([["Room 1", motifDefaults("planks")]]);
    expect(shell.view().floors.armed).toBe("planks");
    shell.click({ x: 4.5, y: 2 }); // the mode is still armed: the room gets planks again
    expect(finished()).toHaveLength(2);
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
    expect(shell.view().floors.armed).toBeNull();
  });
});
