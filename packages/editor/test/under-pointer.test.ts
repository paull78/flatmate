import { describe, expect, it } from "vitest";
import { placementCentre, type Command, type Document, type EntityRef } from "@fm/domain";
import { cabinDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// What's under the pointer (AC-06, riser.20): the right button, or a Ctrl-click, lists what the viewed level can select
// there. Hover marks a row, a click selects it, Esc or a press elsewhere closes it. It never starts during a gesture.

const LOFT = "loft/k0";
const box = (opId: string, x: number, y: number, w = 1, d = 1): Command => ({ type: "placeObject", opId, state: "s0", object: { kind: "block", size: { w, d, h: 0.5 } }, at: { x, y }, rotation: 0, deck: null });
const shellWith = (...cmds: Command[]): FakeShell => FakeShell.withDocument(withCommands(roomDoc(), ...cmds));
const centre = (d: Document, id: string): { x: number; y: number } => {
  const p = d.placements[id];
  const c = p ? placementCentre(d, p) : null;
  if (!c) throw new Error(`no ${id}`);
  return c;
};
const rightClick = (s: FakeShell, p: { x: number; y: number }): void => {
  s.moveTo(p);
  s.down(p, {}, 2);
  s.up(p, {}, 2);
};
const rows = (s: FakeShell): string[] => s.view().underPointer?.rows.map((r) => r.label) ?? [];
const row = (s: FakeShell, label: string): EntityRef => {
  const r = s.view().underPointer?.rows.find((x) => x.label === label);
  if (!r) throw new Error(`no row ${label}`);
  return r.ref;
};

describe("opening the list", () => {
  it("over a stair in a hole it lists the stair, the hole and the deck, in the order a click reaches them", () => {
    const doc = withCommands(cabinDoc(),
      { type: "addDeckHole", opId: "big", deck: LOFT, at: { x: 1.1, y: 2.3 }, w: 1, d: 0.9 },
      box("st", 1.1, 2.6, 0.6, 0.6),
    );
    const s = FakeShell.withDocument(doc);
    rightClick(s, { x: 1.1, y: 2.3 });
    expect(rows(s)).toEqual(["Custom box", "Hole", "Loft"]);
  });

  it("over a real stair hanging in a hole: the stair, the hole and the deck", () => {
    const s = FakeShell.withDocument(withCommands(cabinDoc(), { type: "addDeckHole", opId: "big", deck: LOFT, at: { x: 1.05, y: 1.05 }, w: 1.7, d: 1.7 }));
    s.ui({ type: "pickKind", kind: "spiralStair" });
    for (const x of [3, 2.5, 2, 1.5, 1.05]) s.moveTo({ x, y: x === 1.05 ? 1.5 : 1 });
    s.click({ x: 1.05, y: 1.5 });
    s.key("Escape");
    s.ui({ type: "pickTool", tool: "select" });
    rightClick(s, { x: 1.05, y: 1.2 });
    expect(rows(s)).toEqual(["Spiral stair", "Hole", "Loft"]);
  });

  it("over two stacked pieces, a wall's body and a room, each has its row", () => {
    const s = shellWith(box("a", 3, 2), { type: "placeObject", opId: "r", state: "s0", object: { kind: "rug" }, at: { x: 3, y: 2 }, rotation: 0, deck: null });
    rightClick(s, centre(s.doc(), "a/p0"));
    expect(rows(s)).toEqual(expect.arrayContaining(["Custom box", "Rug"]));
    rightClick(s, { x: 3, y: 0 });
    expect(rows(s)).toEqual(["Wall"]);
  });

  it("at the loft it offers only what that level can select, not the piece on the floor under it", () => {
    const s = FakeShell.withDocument(withCommands(cabinDoc(), box("st", 1.1, 2, 0.6, 0.6)));
    s.ui({ type: "setViewedLevel", deck: LOFT });
    rightClick(s, { x: 1.1, y: 1.7 });
    expect(rows(s)).toEqual(["Loft"]);
  });

  it("over a section's mark it offers the section, by its letter", () => {
    const a = { x: 3, y: 0.5 };
    const s = shellWith({ type: "addSection", a, b: { x: 3, y: 3.5 }, side: 1 });
    rightClick(s, a);
    expect(rows(s)[0]).toBe("Section A");
  });

  it("on an empty spot no list opens", () => {
    const s = shellWith();
    rightClick(s, { x: 20, y: 20 });
    expect(s.view().underPointer).toBeNull();
  });

  it("selects nothing and changes nothing by opening", () => {
    const s = shellWith(box("a", 3, 2));
    const before = s.doc();
    rightClick(s, centre(before, "a/p0"));
    expect(s.state.selection).toEqual([]);
    expect(s.doc()).toBe(before);
  });

  it("sits where the pointer is, on screen", () => {
    const s = shellWith(box("a", 3, 2));
    const p = centre(s.doc(), "a/p0");
    rightClick(s, p);
    expect(s.view().underPointer?.at).toEqual(s.state.pointer?.screen);
  });

  it("a Ctrl-click opens it too; its press has selected the top piece, as any press does, and the rows offer the rest", () => {
    const s = shellWith(box("a", 3, 2));
    const p = centre(s.doc(), "a/p0");
    s.moveTo(p);
    s.down(p, { ctrl: true });
    s.up(p, { ctrl: true });
    expect(rows(s)).toEqual(["Custom box"]);
    expect(s.view().underPointer?.rows[0]?.selected).toBe(true);
  });

  it("a Ctrl-click on a bare floor opens it too, though a press there starts a box", () => {
    const s = shellWith({ type: "labelZone", id: "l", at: { x: 3, y: 2 }, name: "Studio", finish: null });
    s.moveTo({ x: 1, y: 1 });
    s.down({ x: 1, y: 1 }, { ctrl: true });
    s.up({ x: 1, y: 1 }, { ctrl: true });
    expect(rows(s)).toEqual(["Studio"]);
  });

  it("a Ctrl-drag still moves the piece, with no snap and no list", () => {
    const s = shellWith(box("a", 3, 2));
    const p = centre(s.doc(), "a/p0");
    s.moveTo(p);
    s.down(p, { ctrl: true });
    s.moveTo({ x: p.x + 0.513, y: p.y }, { ctrl: true });
    s.up({ x: p.x + 0.513, y: p.y }, { ctrl: true });
    expect(s.view().underPointer).toBeNull();
    expect(centre(s.doc(), "a/p0").x).toBeCloseTo(p.x + 0.513, 3); // off the grid: Ctrl's bypass
  });

  it("does nothing during a drag or with another tool armed", () => {
    const s = shellWith(box("a", 3, 2));
    const p = centre(s.doc(), "a/p0");
    s.moveTo(p);
    s.down(p);
    s.moveTo({ x: p.x + 0.2, y: p.y }); // still over the piece
    expect(s.state.tool).toMatchObject({ name: "select", state: { kind: "moving" } });
    s.send({ type: "pointerUp", screen: s.state.pointer?.screen ?? { x: 0, y: 0 }, mods: { shift: false, alt: false, ctrl: false, meta: false }, button: 2 });
    expect(s.view().underPointer).toBeNull();
    const t = shellWith(box("a", 3, 2));
    t.ui({ type: "pickTool", tool: "wall" });
    rightClick(t, centre(t.doc(), "a/p0"));
    expect(t.view().underPointer).toBeNull();
  });
});

describe("using the list", () => {
  const open = (): FakeShell => {
    const s = shellWith(box("a", 3, 2), { type: "placeObject", opId: "r", state: "s0", object: { kind: "rug" }, at: { x: 3, y: 2 }, rotation: 0, deck: null });
    rightClick(s, centre(s.doc(), "a/p0"));
    return s;
  };

  it("a click selects the row and closes the list", () => {
    const s = open();
    const ref = row(s, "Rug");
    s.ui({ type: "pickUnderPointer", ref });
    expect(s.state.selection).toEqual([ref]);
    expect(s.view().underPointer).toBeNull();
  });

  it("hover marks the row in the scene, as a selection does, and leaves the selection alone", () => {
    const s = open();
    const plain = JSON.stringify(s.scene());
    s.ui({ type: "hoverUnderPointer", ref: row(s, "Custom box") });
    expect(JSON.stringify(s.scene())).not.toBe(plain);
    expect(s.state.selection).toEqual([]);
    s.ui({ type: "hoverUnderPointer", ref: null });
    expect(JSON.stringify(s.scene())).toBe(plain);
  });

  it("Esc closes it, and only it", () => {
    const s = open();
    s.key("Escape");
    expect(s.view().underPointer).toBeNull();
    expect(s.state.tool.name).toBe("select");
  });

  it("a press on the canvas closes it and doesn't start a drag or change the selection", () => {
    const s = open();
    const p = { x: 1, y: 1 };
    s.moveTo(p);
    s.down(p);
    expect(s.view().underPointer).toBeNull();
    expect(s.state.tool).toMatchObject({ name: "select", state: { kind: "idle" } });
    s.up(p);
    expect(s.state.selection).toEqual([]);
  });

  it("the wheel closes it, since the plan moves out from under it", () => {
    const s = open();
    s.wheel(0, -100);
    expect(s.view().underPointer).toBeNull();
  });

  it("a row whose piece a collaborator deleted goes", () => {
    const s = open();
    s.command({ type: "deleteEntities", ids: [{ table: "placements", id: "a/p0" }] });
    expect(rows(s)).toEqual(["Rug"]);
    s.command({ type: "deleteEntities", ids: [{ table: "placements", id: "r/p0" }] });
    expect(s.view().underPointer).toBeNull();
  });
});
