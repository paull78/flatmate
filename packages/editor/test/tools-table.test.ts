import { describe, expect, it } from "vitest";
import { SCALE_TOOL, TOOLS } from "../src/tools/tool-table";
import type { ToolName } from "../src/types";
import { cabinDoc, roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// One tool table (arch-review R-01): key handling, the ViewModel's tool list and the web floating bar read it.
describe("the tool table", () => {
  it("names every tool once", () => {
    const all: Record<Exclude<ToolName, "scale">, true> = { select: true, wall: true, zone: true, object: true, opening: true, dimension: true, section: true, column: true, deck: true, hole: true };
    expect(TOOLS.map((t) => t.tool).sort()).toEqual(Object.keys(all).sort());
  });

  it("marks the building tools floor only (levels.07), but Wall, Column and Opening work at a deck's level (pillars.09, .23, sills.06)", () => {
    const floorOnly: Record<ToolName, boolean> = { select: false, wall: false, zone: true, object: false, opening: false, dimension: true, section: true, column: false, deck: true, hole: false, scale: true };
    expect(Object.fromEntries([...TOOLS, SCALE_TOOL].map((t) => [t.tool, t.floorOnly]))).toEqual(floorOnly);
  });

  it.each(TOOLS.map((t) => [t.tool, t.key] as const))("%s switches on its key %s", (tool, key) => {
    const shell = FakeShell.withDocument(cabinDoc()); // with a deck, so the Hole tool has something to cut
    shell.key(tool === "select" ? "w" : "v"); // start somewhere else
    shell.key(key.toLowerCase());
    expect(shell.view().activeTool).toBe(tool);
  });

  it("the ViewModel lists the table's tools in order, with labels and keys (AC-09)", () => {
    const shell = FakeShell.withDocument(cabinDoc());
    expect(shell.view().tools).toEqual(TOOLS.map((t) => ({ tool: t.tool, label: t.label, key: t.key })));
  });

  it("Scale is off the table: no key, no bar button, still pickable (import.13)", () => {
    expect(TOOLS.some((t) => t.tool === "scale")).toBe(false);
    const shell = FakeShell.withDocument(roomDoc());
    expect(shell.view().tools.map((t) => t.tool)).not.toContain("scale");
    shell.ui({ type: "pickTool", tool: "scale" });
    expect(shell.view().activeTool).toBe("scale");
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      const fresh = FakeShell.withDocument(roomDoc());
      fresh.key(letter);
      expect(fresh.view().activeTool, letter).not.toBe("scale");
    }
  });
});
