import { describe, expect, it } from "vitest";
import { footprints, type Command } from "@fm/domain";
import { bed160x200, clearRoomDoc, nightBedDoc, roomDoc, studioDoc, underlayDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// studioDoc: a bed in Layout anchored at (1.5, 3), x 0.7–2.3, y 1–3, centred on (1.5, 2); inner faces at 0.1 and 5.9 / 3.9.
const both = () => withCommands(studioDoc(), { type: "placeObject", linked: false, deck: null, opId: "b2", state: "n/s0", object: { existing: "bed/o0" }, at: { x: 4.5, y: 3 } });

describe("objects with the Select tool (spec: layouts)", () => {
  it("a click on an object selects its placement in the active layout", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.click({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "bed/p0" }]);
  });

  it("dragging an object clear commits one move; dragging it into a wall draws it red and release reverts it (AC-02)", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.drag({ x: 1.5, y: 2 }, { x: 2.5, y: 2 });
    expect(shell.doc().placements["bed/p0"]?.at).toEqual({ x: 2.5, y: 3 });
    expect(shell.state.undo.past).toHaveLength(1);
    const before = shell.doc();
    shell.moveTo({ x: 2.5, y: 2 });
    shell.down({ x: 2.5, y: 2 });
    shell.moveTo({ x: 5.5, y: 2 });
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind).toBe("moving");
    expect(t.name === "select" && t.state.kind === "moving" && t.state.attempt.ok).toBe(false);
    const red = (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).filter((p) => p.kind === "polygon");
    expect(red).toHaveLength(1);
    shell.up({ x: 5.5, y: 2 });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("Bed (0.00–1.00) overlaps a wall in Layout");
  });

  it("R rotates the selected object by 90° about its centre, in the active layout only (AC-08)", () => {
    const shell = FakeShell.withDocument(both());
    shell.click({ x: 1.5, y: 2 });
    shell.key("r");
    expect(shell.doc().placements["bed/p0"]?.rotation).toBe(90);
    expect(centre(shell, "bed/p0")).toEqual({ x: 1.5, y: 2 });
    expect(shell.doc().placements["b2/p0"]?.rotation).toBe(0);
  });

  it("Delete on an object placed in two layouts removes it from the active one; placed in one, removes the object (AC-10)", () => {
    const shell = FakeShell.withDocument(both());
    shell.click({ x: 1.5, y: 2 });
    shell.key("Delete");
    expect(Object.keys(shell.doc().placements)).toEqual(["b2/p0"]);
    expect(Object.keys(shell.doc().objects)).toEqual(["bed/o0"]);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.click({ x: 4.5, y: 2 });
    shell.key("Delete");
    expect(shell.doc().objects).toEqual({});
  });

  it("dragging a wall onto a bed placed only in Night, while in Layout, draws red, reverts and names the bed and Night (AC-09)", () => {
    const shell = FakeShell.withDocument(nightBedDoc());
    const before = shell.doc();
    shell.click({ x: 6, y: 2 }); // the right wall
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 5.4, y: 2 });
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind).toBe("moving");
    expect(t.name === "select" && t.state.kind === "moving" && t.state.attempt.ok).toBe(false);
    shell.up({ x: 5.4, y: 2 });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("Bed (0.00–1.00) overlaps a wall in Night");
  });

  it("a wall drag stranding a placement in the active layout draws that placement red", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 5, y: 3 } }, bed160x200("bed/o0")));
    shell.click({ x: 6, y: 2 });
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 5.4, y: 2 });
    const red = (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).filter((p) => p.kind === "polygon");
    expect(red).toHaveLength(1);
  });
});

describe("contact plus fit, back to the wall (earlier AC-15/AC-29, furnish.16)", () => {
  // A bed centred on (3, 2), turned 10° through the angle field (which keeps the centre): its lowest corner is
  // 1.124 m below its centre.
  const tilted = (): FakeShell => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3 } }, bed160x200("bed/o0")));
    shell.click({ x: 3, y: 2 });
    shell.ui({ type: "setField", fieldId: "angle", value: "10" });
    shell.key("Escape");
    return shell;
  };

  it("with snapping on, a tilted bed whose front corner comes within 10 px of a wall face turns its back to it and lands flush (furnish.16)", () => {
    const shell = tilted();
    expect(centre(shell, "bed/p0")).toEqual({ x: 3, y: 2 });
    shell.drag({ x: 3, y: 2 }, { x: 3, y: 1.2 }); // turned 10° its lowest corner would be 0.024 m inside the wall
    expect(shell.doc().placements["bed/p0"]).toMatchObject({ at: { x: 3, y: 0.1 }, rotation: 180 }); // back edge on the face
    expect(centre(shell, "bed/p0")).toEqual({ x: 3, y: 1.1 });
  });

  it("with Ctrl (snapping off) it keeps its angle", () => {
    const shell = tilted();
    shell.drag({ x: 3, y: 2 }, { x: 3, y: 1.25 }, { ctrl: true }); // lowest corner 0.026 m above the face: close, but clear
    expect(shell.doc().placements["bed/p0"]?.rotation).toBe(10);
    const c = centre(shell, "bed/p0");
    expect([c.x, c.y].map((v) => +v.toFixed(2))).toEqual([3, 1.25]);
  });

  it("a desk dragged with its front towards the bottom wall ends turned 180°, its back to the wall, with no warning (AC-29)", () => {
    // Anchored at (3, 0.9): y 0.3–0.9, front facing the wall, its use zone across the wall.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 0.9 } }));
    const warnings = () => (shell.scene().layers.find((l) => l.name === "warnings")?.primitives ?? []).filter((p) => p.kind === "polygon").length;
    expect(warnings()).toBe(1);
    shell.drag({ x: 3, y: 0.6 }, { x: 3, y: 0.4 });
    expect(shell.doc().placements["d/p0"]).toMatchObject({ at: { x: 3, y: 0.1 }, rotation: 180 });
    expect(warnings()).toBe(0);
  });

  it("AC-04: a Select drag in a 1.20 m room never turns the single bed, and lands it flush in the head corner", () => {
    // Faces x 0.1 / 1.3, y 0.1 / 2.7; the Single bed 1.00 × 2.10 anchored at (0.68, 2.45): x 0.18–1.18, centre (0.68, 1.4).
    const narrow = (): FakeShell =>
      FakeShell.withDocument(withCommands(clearRoomDoc(1.2, 2.6, "nb"), { type: "placeObject", linked: false, deck: null, opId: "nb", state: "s0", object: { kind: "bed", preset: "Single" }, at: { x: 0.68, y: 2.45 } }));
    const shell = narrow();
    const before = shell.doc();
    shell.moveTo({ x: 0.68, y: 1.4 });
    shell.down({ x: 0.68, y: 1.4 });
    shell.moveTo({ x: 0.78, y: 1.4 }); // the step's centre 0.88 crosses the right face by 0.08; turned, the bed would not fit
    const t = shell.state.tool;
    const attempt = t.name === "select" && t.state.kind === "moving" ? t.state.attempt : null;
    expect(attempt?.ok).toBe(false);
    expect(attempt?.tried).toEqual({ kind: "place", at: { x: 0.88, y: 2.45 }, rotation: 0, deck: null });
    shell.up({ x: 0.78, y: 1.4 });
    expect(shell.doc()).toBe(before);

    const head = narrow();
    head.drag({ x: 0.68, y: 1.4 }, { x: 0.68, y: 1.6 }); // the back 0.05 m from the head wall, the left side 0.08 m from its wall
    expect(head.doc().placements["nb/p0"]).toMatchObject({ at: { x: 0.6, y: 2.7 }, rotation: 0 });
    const quad = footprints(head.doc()).get("nb/p0") ?? [];
    expect(Math.min(...quad.map((p) => p.x))).toBeCloseTo(0.1, 6);
    expect(Math.max(...quad.map((p) => p.y))).toBeCloseTo(2.7, 6);
    expect(head.state.undo.past).toHaveLength(1);
  });

  it("the turn's fit ignores the dragged piece's own place", () => {
    // A wardrobe at x 0.3–1.5, y 1.7–2.3, centre (0.9, 2), dragged 0.2 m left: its left side lands on the face, and
    // turned to 90 (x 0.1–0.7, y 1.4–2.6) it covers its own old place, which doesn't count.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 0.9, y: 2.3 } }));
    shell.drag({ x: 0.9, y: 2 }, { x: 0.7, y: 2 });
    expect(shell.doc().placements["w/p0"]).toMatchObject({ at: { x: 0.1, y: 2 }, rotation: 90 });
  });

  it("a turn whose piece would overlap other furniture is refused: the piece keeps its angle", () => {
    // As below, the wardrobe dragged to x 0.83 would turn to 90 onto the left face (x 0.1–0.7, y 1.4–2.6); a block at
    // x 0.1–0.7, y 2.5–3.1 is in the way.
    const shell = FakeShell.withDocument(withCommands(roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 3, y: 2.3 } },
      { type: "placeObject", linked: false, deck: null, opId: "k", state: "s0", object: { kind: "block" }, at: { x: 0.4, y: 3.1 } }));
    shell.drag({ x: 3, y: 2 }, { x: 0.83, y: 2 });
    expect(shell.doc().placements["w/p0"]).toMatchObject({ at: { x: 0.8, y: 2.3 }, rotation: 0 });
  });

  it("while a plan picture shows, the 1 cm step decides the turn: a drag 0.13 m from the left face does not turn (furnish.23)", () => {
    // A wardrobe 1.2 × 0.6 centred on (3, 2). Dragged to x 0.83: the 0.2 m grid's centre 0.8 puts its left side 0.10 m
    // from the face (it turns to 90); the 1 cm step keeps 0.83, 0.13 m away (it doesn't).
    const wardrobe: Command = { type: "placeObject", linked: false, deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 3, y: 2.3 } };
    const grid = FakeShell.withDocument(withCommands(roomDoc(), wardrobe));
    grid.drag({ x: 3, y: 2 }, { x: 0.83, y: 2 });
    expect(grid.doc().placements["w/p0"]).toMatchObject({ at: { x: 0.1, y: 2 }, rotation: 90 });
    const tracing = FakeShell.withDocument(underlayDoc(withCommands(roomDoc(), wardrobe)));
    tracing.drag({ x: 3, y: 2 }, { x: 0.83, y: 2 });
    expect(tracing.doc().placements["w/p0"]).toMatchObject({ at: { x: 0.83, y: 2.3 }, rotation: 0 });
  });
});

/** The centre of a placement's footprint, to the millimetre. */
function centre(shell: FakeShell, id: string): { x: number; y: number } {
  const quad = footprints(shell.doc()).get(id) ?? [];
  const a = quad[0];
  const c = quad[2];
  if (!a || !c) throw new Error(`no footprint for ${id}`);
  return { x: +((a.x + c.x) / 2).toFixed(3) + 0, y: +((a.y + c.y) / 2).toFixed(3) + 0 };
}
