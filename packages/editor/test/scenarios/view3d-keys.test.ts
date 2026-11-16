import { describe, expect, it } from "vitest";
import { roomDoc, withCommands } from "../builders";
import { FakeRemote } from "../fake-remote";
import { FakeShell } from "../fake-shell";

// The 3D view's per-viewer state and keys (heights.18, .19, AC-12, AC-13): 3 shows or hides it, ⇧3 switches corner
// and split, [ and ] turn it; never synced or undone; the render effect carries it only while open.

const lastRender = (shell: FakeShell) => shell.effectsOf("render").at(-1);
const MENU = [
  { value: "", label: "None" }, { value: "interior", label: "Interior" }, { value: "outside", label: "Outside" }, { value: "wheels", label: "On wheels" }, { value: "grid", label: "Grid" },
];
const pick = (shell: FakeShell, value: string): void => shell.ui({ type: "setSheetSetting", key: "surroundings", value });

describe("the 3D view's keys", () => {
  it("3 opens and closes, ⇧3 switches corner and split, ] turns four times back to 0, [ turns back", () => {
    const shell = FakeShell.withDocument(roomDoc());
    expect(shell.state.view3d).toEqual({ open: false, size: "corner", yaw: 225, tilt: 35, roof: false });
    shell.key("3");
    expect(shell.state.view3d.open).toBe(true);
    shell.key("3", { shift: true });
    expect(shell.state.view3d.size).toBe("split");
    shell.key("3", { shift: true });
    expect(shell.state.view3d.size).toBe("corner");
    const yaws: number[] = [];
    for (let i = 0; i < 4; i++) {
      shell.key("]");
      yaws.push(shell.state.view3d.yaw);
    }
    expect(yaws).toEqual([315, 45, 135, 225]); // a quarter turn each, back to the south-west
    shell.key("[");
    expect(shell.state.view3d.yaw).toBe(135);
    expect(shell.state.view3d.tilt).toBe(35);
    shell.key("3");
    expect(shell.state.view3d.open).toBe(false);
  });

  it("[ with Alt turns too (Italian Mac layouts); ⇧3 typed as # or £ switches the size", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("3");
    shell.key("]", { alt: true });
    expect(shell.state.view3d.yaw).toBe(315);
    shell.key("#", { shift: true });
    expect(shell.state.view3d.size).toBe("split");
    shell.key("£", { shift: true });
    expect(shell.state.view3d.size).toBe("corner");
    shell.key("3", { meta: true });
    expect(shell.state.view3d.open).toBe(true); // Cmd+3 is not ours
  });

  it("typing 3 in a length field doesn't open the view", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("w");
    shell.click({ x: 1, y: 1 });
    shell.moveTo({ x: 2, y: 1 });
    shell.type("3");
    expect(shell.state.view3d.open).toBe(false);
  });

  it("the panel's buttons: toggle, size and turn as UI actions", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "toggle3d" });
    shell.ui({ type: "set3dSize", size: "split" });
    shell.ui({ type: "turn3d", by: -1 });
    expect(shell.state.view3d).toEqual({ open: true, size: "split", yaw: 135, tilt: 35, roof: false });
    expect(shell.view().view3d).toEqual({ open: true, size: "split", yaw: 135, tilt: 35, roof: false, outside: true, layout: "Layout", surroundings: { value: "", options: MENU, canEdit: true } });
  });

  it("the render effect carries the 3D view only when open; drawing a wall updates its items", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("v");
    expect(lastRender(shell)?.view3d).toBeNull();
    shell.key("3");
    const open = lastRender(shell)?.view3d;
    expect(open?.angles).toEqual({ yaw: 225, tilt: 35 });
    expect(open?.size).toBe("corner");
    const walls = (open?.scene.items ?? []).filter((i) => i.item === "wall").length;
    expect(open?.scene.hidden.size).toBe(2);
    shell.key("w");
    shell.click({ x: 3, y: 0 });
    shell.click({ x: 3, y: 4 });
    shell.key("Escape");
    expect((lastRender(shell)?.view3d?.scene.items ?? []).filter((i) => i.item === "wall").length).toBeGreaterThan(walls);
  });

  it("a deck selected on the plan draws selected in the 3D view (decks.07)", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 } }));
    shell.key("3");
    const deck = () => (lastRender(shell)?.view3d?.scene.items ?? []).find((i) => i.item === "deck");
    expect(deck()).toMatchObject({ deck: "l/k0", selected: false });
    shell.click({ x: 2.2, y: 2.5 });
    expect(shell.state.selection).toEqual([{ table: "decks", id: "l/k0" }]);
    expect(deck()).toMatchObject({ deck: "l/k0", selected: true });
  });

  it("undo doesn't touch the 3D view, and a remote client's 3D state is its own", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("3");
    shell.key("]");
    shell.key("w");
    shell.click({ x: 3, y: 0 });
    shell.click({ x: 3, y: 4 });
    shell.key("Escape");
    shell.key("z", { meta: true });
    expect(shell.state.view3d).toEqual({ open: true, size: "corner", yaw: 315, tilt: 35, roof: false });
    const other = FakeShell.withDocument(roomDoc());
    expect(other.state.view3d.open).toBe(false);
  });
});

// The header's surroundings menu (surroundings.06, .15, AC-06): the value comes from the drawing, so every viewer sees
// the same; a pick is setSheetSetting, which works with something selected, where setField does nothing.
describe("the 3D panel's surroundings menu", () => {
  it("the view model carries the current value, the five options and whether it can edit", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "setProjectField", key: "surroundings", value: "grid" }));
    expect(shell.view().view3d?.surroundings).toEqual({ value: "grid", options: MENU, canEdit: true });
    const r = FakeRemote.open(roomDoc());
    expect(r.shell.view().view3d?.surroundings).toEqual({ value: "", options: MENU, canEdit: true });
    pick(r.shell, "outside");
    expect(r.shell.view().view3d?.surroundings).toEqual({ value: "outside", options: MENU, canEdit: false }); // out, unanswered
  });

  it("a pick with something selected is one undoable edit, and undo restores it", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "setProjectField", key: "surroundings", value: "interior" }));
    shell.key("3");
    shell.click({ x: 3, y: 0 });
    expect(shell.state.selection.length).toBe(1);
    const interior = lastRender(shell)?.view3d?.scene.background;
    pick(shell, "outside");
    expect(shell.view().view3d?.surroundings.value).toBe("outside");
    expect(lastRender(shell)?.view3d?.scene.background).toMatch(/^#/); // the picture follows: Outside's sky
    expect(lastRender(shell)?.view3d?.scene.background).not.toBe(interior);
    expect(shell.state.selection.length).toBe(1);
    shell.key("z", { meta: true });
    expect(shell.view().view3d?.surroundings.value).toBe("interior");
    shell.key("z", { meta: true, shift: true });
    expect(shell.view().view3d?.surroundings.value).toBe("outside");
    pick(shell, "");
    expect(shell.doc().projectFields["surroundings"]).toBeUndefined(); // None is no row
    shell.key("z", { meta: true });
    expect(shell.view().view3d?.surroundings.value).toBe("outside");
  });

  it("choosing None on an untouched project is no edit", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const before = shell.state.document;
    pick(shell, "");
    expect(shell.view().canUndo).toBe(false);
    expect(shell.state.document).toBe(before);
    expect(shell.view().toast).toBeNull();
  });
});
