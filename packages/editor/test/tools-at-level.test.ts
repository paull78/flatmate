import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import type { UiAction } from "../src/ports/events";
import { pruneSelection, viewedLevel } from "../src/state";
import type { ToolName } from "../src/types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Tools at a level (spec "Selecting at a level", second paragraph; levels.07; AC-06): picking a building tool at an
// upper level, by key or button, views the floor and starts the tool; Select and Object stay at the viewed level, and
// so do Wall and Column, which build on the level's deck (spec "The Column tool", "Walls on a loft", pillars.21).

const LOFT = "m/k0";
const loftDoc = (): Document => withCommands(roomDoc(), { type: "addDeck", opId: "m", preset: "loft", at: { x: 1.2, y: 2.5 } });
const height = (shell: FakeShell): number | undefined => viewedLevel(shell.state)?.height;

function atLoft(): FakeShell {
  const shell = FakeShell.withDocument(loftDoc());
  shell.ui({ type: "setViewedLevel", deck: LOFT });
  expect(height(shell)).toBe(2.15);
  return shell;
}

const BUILDING_KEYS: readonly (readonly [ToolName, string])[] = [
  ["zone", "Z"],
  ["dimension", "M"],
  ["deck", "K"],
  ["section", "S"],
];

const BUILDING_BUTTONS: readonly (readonly [string, UiAction, ToolName])[] = [
  ["Zone", { type: "pickTool", tool: "zone" }, "zone"],
  ["Dimension", { type: "pickTool", tool: "dimension" }, "dimension"],
  ["Deck", { type: "pickTool", tool: "deck" }, "deck"],
  ["Deck's Loft preset", { type: "pickDeckPreset", preset: "loft" }, "deck"],
  ["Section", { type: "pickTool", tool: "section" }, "section"],
  ["Scale", { type: "pickTool", tool: "scale" }, "scale"],
];

describe("tools at a level", () => {
  it.each(BUILDING_KEYS)("at the loft, %s's key %s views the floor with the tool active", (tool, key) => {
    const shell = atLoft();
    shell.key(key.toLowerCase());
    expect(shell.view().activeTool).toBe(tool);
    expect(height(shell)).toBe(0);
    expect(shell.state.viewedDeck).toBeNull();
  });

  it.each(BUILDING_BUTTONS)("at the loft, the %s button views the floor with the tool active", (_name, action, tool) => {
    const shell = atLoft();
    shell.ui(action);
    expect(shell.view().activeTool).toBe(tool);
    expect(height(shell)).toBe(0);
    expect(shell.state.viewedDeck).toBeNull();
  });

  it.each([["wall", "W"], ["column", "C"], ["opening", "D"]] as const)("%s's key %s keeps the loft with the tool active (Opening: sills.06)", (tool, key) => {
    const shell = atLoft();
    shell.key(key.toLowerCase());
    expect(shell.view().activeTool).toBe(tool);
    expect(height(shell)).toBe(2.15);
  });

  it.each(["wall", "column", "opening"] as const)("the %s button keeps the loft", (tool) => {
    const shell = atLoft();
    shell.ui({ type: "pickTool", tool });
    expect(shell.view().activeTool).toBe(tool);
    expect(height(shell)).toBe(2.15);
  });

  it("the Opening's Window kind button keeps the loft with the tool active (sills.06)", () => {
    const shell = atLoft();
    shell.ui({ type: "pickOpeningKind", kind: "window" });
    expect(shell.view().activeTool).toBe("opening");
    expect(height(shell)).toBe(2.15);
  });

  it("O keeps the loft with the Object tool", () => {
    const shell = atLoft();
    shell.key("o");
    expect(shell.view().activeTool).toBe("object");
    expect(height(shell)).toBe(2.15);
  });

  it("the Object button and a palette kind keep the loft", () => {
    const shell = atLoft();
    shell.ui({ type: "pickTool", tool: "object" });
    expect(shell.view().activeTool).toBe("object");
    expect(height(shell)).toBe(2.15);
    shell.ui({ type: "pickKind", kind: "bed" });
    expect(shell.view().activeTool).toBe("object");
    expect(height(shell)).toBe(2.15);
  });

  it("V keeps the loft and its selection", () => {
    const shell = atLoft();
    shell.click({ x: 1.2, y: 2.5 }); // the loft's top
    expect(shell.state.selection).toEqual([{ table: "decks", id: LOFT }]);
    shell.key("v");
    shell.ui({ type: "pickTool", tool: "select" });
    expect(shell.view().activeTool).toBe("select");
    expect(height(shell)).toBe(2.15);
    expect(shell.state.selection).toEqual([{ table: "decks", id: LOFT }]);
  });

  it("Escape keeps the loft", () => {
    const shell = atLoft();
    shell.key("o");
    shell.key("Escape");
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
    expect(height(shell)).toBe(2.15);
  });

  // The other direction: build at the floor holds when the view moves up with a building tool already active.
  it.each(BUILDING_KEYS)("%s's key %s at the floor, then Page Up, drops to Select at the loft", (tool, key) => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.key(key.toLowerCase());
    expect(shell.view().activeTool).toBe(tool);
    shell.key("PageUp");
    expect(height(shell)).toBe(2.15);
    expect(shell.view().activeTool).toBe("select");
  });

  it("the Scale tool at the floor, then the strip's loft row, drops to Select", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.ui({ type: "pickTool", tool: "scale" });
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(shell.view().activeTool).toBe("select");
  });

  it("W at the floor, then Page Up, keeps the Wall tool at the loft: two clicks beside the loft draw no wall", () => {
    const shell = FakeShell.withDocument(loftDoc());
    const walls = Object.keys(shell.doc().walls).length;
    shell.key("w");
    shell.key("PageUp");
    expect(height(shell)).toBe(2.15);
    expect(shell.view().activeTool).toBe("wall");
    shell.click({ x: 4, y: 1 });
    shell.click({ x: 4, y: 3 });
    shell.key("Escape");
    expect(Object.keys(shell.doc().walls)).toHaveLength(walls);
  });

  it("a Platform picked at the floor, then the loft row: a click leaves only what the loft can select", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.ui({ type: "pickDeckPreset", preset: "platform" });
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.click({ x: 4.5, y: 1.5 });
    expect(shell.state.selection).toEqual(pruneSelection(shell.state).selection);
  });

  it("Z at the floor, then Page Up: a click leaves only what the loft can select", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.key("z");
    shell.key("PageUp");
    shell.click({ x: 4.5, y: 1.5 });
    expect(shell.state.selection).toEqual(pruneSelection(shell.state).selection);
  });

  it("O at the floor, then Page Up, keeps the Object tool", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.key("o");
    shell.key("PageUp");
    expect(height(shell)).toBe(2.15);
    expect(shell.view().activeTool).toBe("object");
  });

  it("W at the floor, then viewing a platform's deck (part of the floor level), keeps the Wall tool", () => {
    const doc = withCommands(loftDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.5, y: 1.5 } });
    const shell = FakeShell.withDocument(doc);
    shell.key("w");
    shell.ui({ type: "setViewedLevel", deck: "p/k0" });
    expect(height(shell)).toBe(0);
    expect(shell.view().activeTool).toBe("wall");
  });
});
