import { describe, expect, it } from "vitest";
import { studioDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// studioDoc plus two 0.45 m chairs in Layout (s0), centred on (4, 2.775) and (5, 2.775); the bed is centred on
// (1.5, 2); the right wall is at x 6; (3, 0.5) is free floor. "Night" is n/s0.
const groupDoc = () =>
  withCommands(
    studioDoc(),
    { type: "placeObject", linked: false, deck: null, opId: "c1", state: "s0", object: { kind: "chair" }, at: { x: 4, y: 3 } },
    { type: "placeObject", linked: false, deck: null, opId: "c2", state: "s0", object: { kind: "chair" }, at: { x: 5, y: 3 } },
  );
const BED = { x: 1.5, y: 2 };
const C1 = { x: 4, y: 2.775 };
const C2 = { x: 5, y: 2.775 };
const RIGHT_WALL = { x: 6, y: 2 };
const piece = (id: string) => ({ table: "placements", id });
const ids = (shell: FakeShell) => shell.state.selection.map((r) => r.id);

/** The bed and both chairs selected, by a click and two Shift-clicks. */
function selectThree(): FakeShell {
  const shell = FakeShell.withDocument(groupDoc());
  shell.click(BED);
  shell.click(C1, { shift: true });
  shell.click(C2, { shift: true });
  return shell;
}

function selectTwo(): FakeShell {
  const shell = FakeShell.withDocument(groupDoc());
  shell.click(BED);
  shell.click(C1, { shift: true });
  return shell;
}

/** Shared mode, with the bed and both chairs selected. */
function remoteThree(): FakeRemote {
  const r = FakeRemote.open(groupDoc());
  r.shell.click(BED);
  r.shell.click(C1, { shift: true });
  r.shell.click(C2, { shift: true });
  return r;
}

describe("multi-entry selection (spec: tools, direct.07)", () => {
  it("Shift-click adds a piece and a second Shift-click removes it (AC-06)", () => {
    const shell = selectThree();
    expect(shell.state.selection).toEqual([piece("bed/p0"), piece("c1/p0"), piece("c2/p0")]);
    shell.click(C1, { shift: true });
    expect(shell.state.selection).toEqual([piece("bed/p0"), piece("c2/p0")]);
  });

  it("clicking a wall replaces a furniture selection with the wall; Shift-click on a wall adds it to the group (straight.09)", () => {
    const plain = selectThree();
    plain.click(RIGHT_WALL);
    expect(plain.state.selection.map((r) => r.table)).toEqual(["walls"]);
    const shell = selectThree();
    shell.click(RIGHT_WALL, { shift: true });
    expect(shell.state.selection).toHaveLength(4);
    expect(shell.state.selection.at(-1)?.table).toBe("walls");
    shell.click(C1, { shift: true });
    expect(shell.state.selection).toHaveLength(3);
    expect(shell.state.selection).not.toContainEqual(piece("c1/p0"));
  });

  it("Esc clears a group selection (AC-06)", () => {
    const shell = selectThree();
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
  });

  it("a plain press on a piece of a group keeps the group until release, then collapses to it", () => {
    const shell = selectThree();
    shell.moveTo(C1);
    shell.down(C1);
    expect(shell.state.selection).toHaveLength(3);
    shell.up(C1);
    expect(shell.state.selection).toEqual([piece("c1/p0")]);
  });

  it("a press on a group piece that cannot drag (offline) and is released far away keeps the group", () => {
    const r = remoteThree();
    r.disconnect(); // edits are blocked, so the press never becomes a drag
    r.shell.moveTo(C1);
    r.shell.down(C1);
    r.shell.moveTo({ x: 4, y: 1.5 });
    r.shell.up({ x: 4, y: 1.5 });
    expect(r.shell.state.selection).toEqual([piece("bed/p0"), piece("c1/p0"), piece("c2/p0")]);
  });

  it("a piece deleted remotely during the press does not come back with the click selection", () => {
    const r = FakeRemote.open(groupDoc());
    r.shell.click(BED);
    r.shell.click(C1, { shift: true });
    r.shell.moveTo(C1);
    r.shell.down(C1, { shift: true }); // the click selection is [bed/p0]
    r.remote({ type: "deleteEntities", ids: [{ table: "placements", id: "bed/p0" }] });
    r.shell.up(C1);
    expect(r.shell.state.selection).toEqual([]);
  });

  it("a Shift+drag on a selected piece does not toggle it off", () => {
    const shell = selectTwo();
    shell.drag(C1, { x: 4, y: 2.3 }, { shift: true });
    expect(ids(shell)).toContain("c1/p0");
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("Properties of a group show its count and no fields (AC-09)", () => {
    const three = selectThree();
    expect(three.view().properties).toEqual({ kind: "group", count: 3 });
    expect(three.view().rooms).toBeNull();
    expect(three.view().projectFields).toBeNull();
    const two = selectTwo();
    expect(two.view().properties).toEqual({ kind: "group", count: 2 });
    two.click(C1, { shift: true });
    expect(two.view().properties.kind).toBe("object");
  });

  it("setField with a group selected changes nothing", () => {
    const shell = selectThree();
    const before = shell.doc();
    shell.ui({ type: "setField", fieldId: "name", value: "Stool" });
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.view().toast).toBeNull();
  });

  it("Delete removes the whole group as one changeset; one undo restores it", () => {
    const shell = selectThree();
    shell.key("Delete");
    expect(shell.doc().placements).toEqual({});
    expect(shell.doc().objects).toEqual({});
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(Object.keys(shell.doc().placements)).toHaveLength(3);
    expect(shell.doc().placements["bed/p0"]?.at).toEqual({ x: 1.5, y: 3 });
  });

  it("switching layout clears a furniture selection, not a wall selection", () => {
    const shell = selectTwo();
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(shell.state.selection).toEqual([]);
    shell.click(RIGHT_WALL);
    shell.ui({ type: "setActiveState", id: "s0" });
    expect(shell.state.selection).toHaveLength(1);
    expect(shell.state.selection[0]?.table).toBe("walls");
  });

  it("the presence sent for a layout switch carries the cleared selection", () => {
    const r = remoteThree();
    r.shell.clearEffects();
    r.shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(r.shell.effectsOf("presence").map((e) => e.selection)).toEqual([[]]);
  });

  it("adding a layout clears a furniture selection", () => {
    const shell = selectTwo();
    shell.ui({ type: "addState" });
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().states.find((s) => s.active)?.name).toBe("Layout 3");
  });

  it("a piece deleted by a command drops out of the group", () => {
    const shell = selectThree();
    shell.command({ type: "deleteEntities", ids: [{ table: "placements", id: "c1/p0" }] });
    expect(shell.state.selection).toEqual([piece("bed/p0"), piece("c2/p0")]);
  });
});
