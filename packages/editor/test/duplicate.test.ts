import { describe, expect, it } from "vitest";
import { boxOf, emptyDocument, execute, rectangleRoom, roundMm, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Event } from "../src/ports/events";
import type { SelectToolState } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, studioDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// roomDoc: 6 × 4 m, free floor x 0.1–5.9, y 0.1–3.9. `at` is the middle of a piece's back edge: at rotation 0 the
// footprint runs from at.y − d to at.y. A bed is 1.6 × 2, a chair 0.45 × 0.45. studioDoc: bed/p0 in s0 at (1.5, 3),
// x 0.7–2.3, y 1–3, centre (1.5, 2), and an empty Night layout n/s0. The camera is at zoom 80 with the step on Auto,
// so the ghost moves by multiples of 0.2 m from the original (ghost.01, ghost.06).
const BED = { x: 1.5, y: 2 };
const BED_BOX = { minX: 0.7, maxX: 2.3, minY: 1, maxY: 3 };
const place = (opId: string, kind: string, at: Point, rotation?: number): Command => ({
  type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at, ...(rotation === undefined ? {} : { rotation }),
});

const placements = (shell: FakeShell): Placement[] => Object.values(shell.doc().placements).filter((p) => p.state === "s0");
const piece = (id: string) => ({ table: "placements", id });
/** The placements added since `before`, sorted by ID. */
const fresh = (shell: FakeShell, before: Document): Placement[] =>
  placements(shell).filter((p) => before.placements[p.id] === undefined).sort((a, b) => (a.id < b.id ? -1 : 1));
const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const round = (v: number): number => +v.toFixed(6);
/** The overlay polygons in `color`, as rounded boxes, sorted. */
const boxes = (shell: FakeShell, color: string) =>
  overlays(shell)
    .flatMap((p) => (p.kind === "polygon" && p.color === color ? [boxOf(p.points)] : []))
    .map((b) => ({ minX: round(b.minX), maxX: round(b.maxX), minY: round(b.minY), maxY: round(b.maxY) }))
    .sort((a, b) => a.minX - b.minX || a.minY - b.minY);
const ghost = (shell: FakeShell): Extract<SelectToolState, { kind: "copying" }> | null => {
  const tool = shell.state.tool;
  return tool.name === "select" && tool.state.kind === "copying" ? tool.state : null;
};
const ghostOf = (shell: FakeShell) => {
  const t = shell.state.tool;
  if (t.name !== "select" || t.state.kind !== "copying") throw new Error("no ghost");
  return { offset: t.state.offset, turn: t.state.turn, ok: t.state.attempt.ok };
};
const expectOffset = (shell: FakeShell, x: number, y: number, digits = 9) => {
  expect(ghostOf(shell).offset.x).toBeCloseTo(x, digits);
  expect(ghostOf(shell).offset.y).toBeCloseTo(y, digits);
};
const kind = (shell: FakeShell): string | null => (shell.state.tool.name === "select" ? shell.state.tool.state.kind : null);

function bedSelected(doc: Document = studioDoc(), click: Point = BED): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(click);
  return shell;
}

/** The bed selected and picked up with Cmd+D; `before` is the document then. */
function copying(doc: Document = studioDoc(), click: Point = BED): { shell: FakeShell; before: Document } {
  const shell = bedSelected(doc, click);
  const before = shell.doc();
  shell.key("d", { meta: true });
  return { shell, before };
}

function expectNoGhost(shell: FakeShell): void {
  expect(boxes(shell, COLORS.ghostFill)).toEqual([]);
  expect(boxes(shell, COLORS.invalidFill)).toEqual([]);
}

describe("the duplicate ghost (ghost.01)", () => {
  it("Cmd+D picks up a ghost of the bed centred on the cursor; the document does not change (AC-01)", () => {
    const { shell, before } = copying();
    expect(kind(shell)).toBe("copying");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.selection).toEqual([piece("bed/p0")]);
    expect(ghost(shell)?.offset).toEqual({ x: 0, y: 0 });
    // The zero move's: the first try, over the original, is refused.
    expect(ghost(shell)?.attempt.dependencies).toEqual([
      { table: "objects", id: "bed/o0" }, { table: "placements", id: "bed/p0" }, { table: "states", id: "s0" },
    ]);
    expect(boxes(shell, COLORS.invalidFill)).toContainEqual(BED_BOX);
    expect(boxes(shell, COLORS.ghostFill)).toEqual([]);
    expect(handles(shell.state, shell.doc())).toEqual([]); // no grips on the original while the ghost is up

    shell.moveTo({ x: 3.93, y: 2.07 }); // raw (2.43, 0.07): the step gives (2.4, 0); whole centimetres would give 2.43
    expect(ghost(shell)?.offset).toEqual({ x: 2.4, y: 0 });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 3.1, maxX: 4.7, minY: 1, maxY: 3 }]);
    expect(boxes(shell, COLORS.invalidFill)).toEqual([]);
    expect(shell.doc()).toBe(before);

    shell.moveTo({ x: 3.55, y: 2.62 });
    expect(ghost(shell)?.offset).toEqual({ x: 2, y: 0.6 });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 2.7, maxX: 4.3, minY: 1.6, maxY: 3.6 }]);
  });

  it("Cmd+D with the cursor away from the piece starts the ghost on the cursor (AC-01)", () => {
    const shell = bedSelected();
    const before = shell.doc();
    shell.moveTo({ x: 4.1, y: 2 });
    shell.key("d", { meta: true });
    expect(ghost(shell)?.offset).toEqual({ x: 2.6, y: 0 });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 3.3, maxX: 4.9, minY: 1, maxY: 3 }]);
    expect(boxes(shell, COLORS.invalidFill)).toEqual([]);
    expect(shell.doc()).toBe(before);
  });

  it("Ctrl+D picks up the same ghost", () => {
    const shell = bedSelected();
    shell.key("d", { ctrl: true });
    expect(kind(shell)).toBe("copying");
    expect(boxes(shell, COLORS.invalidFill)).toContainEqual(BED_BOX);
  });

  it("ui duplicate picks up the same ghost as Cmd+D", () => {
    const shell = bedSelected();
    shell.ui({ type: "duplicate" });
    expect(kind(shell)).toBe("copying");
    shell.click({ x: 4.1, y: 2 });
    expect(placements(shell).map((p) => p.at)).toContainEqual({ x: 4.1, y: 3 });
  });

  it("a click where the ghost fits places one copy at its place, selects it and ends the ghost (AC-02)", () => {
    const { shell, before } = copying();
    shell.click({ x: 4.1, y: 2 }); // offset (2.6, 0): the copy covers x 3.3–4.9, y 1–3
    expect(placements(shell)).toHaveLength(2);
    const copy = shell.doc().placements["id1/p0"];
    expect(copy).toMatchObject({ at: { x: 4.1, y: 3 }, rotation: 0, config: "standard", state: "s0" });
    const object = shell.doc().objects[copy?.object ?? ""];
    expect(copy?.object).toBe("id1/o0");
    expect(object).toMatchObject({ kind: "bed", name: "Bed" });
    expect(object?.w).toEqual(before.objects["bed/o0"]?.w);
    expect(object?.d).toEqual(before.objects["bed/o0"]?.d);
    expect(shell.doc().placements["bed/p0"]).toBe(before.placements["bed/p0"]);
    expect(shell.state.selection).toEqual([piece("id1/p0")]);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(kind(shell)).toBe("idle");
    expectNoGhost(shell);
    expect(shell.view().properties.kind).toBe("object");
  });

  it("the offset is a whole number of snap steps from the original: an off-grid bed keeps its millimetres (ghost.06)", () => {
    // x 0.434–2.034, centre (1.234, 2). A raw 2.866 m steps to 2.8. Centring exactly on the cursor would give 4.1,
    // whole centimetres 4.104, an absolute 0.2 lattice 4.0 or 4.2.
    const { shell } = copying(withCommands(roomDoc(), place("bed", "bed", { x: 1.234, y: 3 })), { x: 1.234, y: 2 });
    shell.click({ x: 4.1, y: 2 });
    expect(shell.doc().placements[shell.state.selection[0]?.id ?? ""]?.at).toEqual({ x: 4.034, y: 3 });
  });

  it("the copy keeps the original's rotation (AC-02)", () => {
    // Turned 90°: x 1–3, y 0.4–2.0, centre (2, 1.2).
    const { shell } = copying(withCommands(roomDoc(), place("bed", "bed", { x: 1, y: 1.2 }, 90)), { x: 2, y: 1.2 });
    shell.click({ x: 4.4, y: 1.2 });
    const copy = shell.doc().placements[shell.state.selection[0]?.id ?? ""];
    expect(copy?.at).toEqual({ x: 3.4, y: 1.2 }); // x 3.4–5.4, y 0.4–2.0
    expect(copy?.rotation).toBe(90);
  });

  it("one undo removes the copy (AC-02)", () => {
    const { shell } = copying();
    shell.click({ x: 4.1, y: 2 });
    shell.key("z", { meta: true });
    expect(placements(shell)).toHaveLength(1);
    expect(shell.doc()).toEqual(studioDoc());
    expect(shell.state.selection).toEqual([]);
    expect(kind(shell)).toBe("idle");
  });

  it("a click where the copy does not fit toasts why, changes nothing and keeps the ghost", () => {
    const { shell, before } = copying();
    shell.click(BED);
    expect(shell.view().toast).toBe("Bed (0.00–1.00) and Bed (0.00–1.00) overlap in Layout");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(kind(shell)).toBe("copying");
    shell.click({ x: 4.1, y: 2 });
    expect(shell.state.undo.past).toHaveLength(1);
    expect(placements(shell).map((p) => p.at)).toContainEqual({ x: 4.1, y: 3 });
  });

  it("in a room where no side of the piece is free, the ghost places the copy elsewhere (AC-03)", () => {
    // c1 x 0.1–0.55, y 0.1–0.55 in the corner; c2 on its right (x 0.55–1.0), c3 above it (y 0.55–1.0).
    const doc = withCommands(roomDoc(), place("c1", "chair", { x: 0.325, y: 0.55 }), place("c2", "chair", { x: 0.775, y: 0.55 }), place("c3", "chair", { x: 0.325, y: 1 }));
    // The old rule's four sides: two hit a chair and two hit a wall.
    for (const [dx, dy] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) {
      const at = { x: roundMm(0.325 + (dx ?? 0)), y: roundMm(0.55 + (dy ?? 0)) };
      expect(execute(doc, { type: "duplicatePlacements", opId: "t", copies: [{ placementId: "c1/p0", at, rotation: 0 }] }).ok).toBe(false);
    }
    const { shell } = copying(doc, { x: 0.325, y: 0.325 });
    shell.click({ x: 3.325, y: 2.325 }); // offset (3, 2)
    expect(placements(shell)).toHaveLength(4);
    const [ref] = shell.state.selection;
    expect(shell.state.selection).toHaveLength(1);
    expect(shell.doc().placements[ref?.id ?? ""]?.at).toEqual({ x: 3.325, y: 2.55 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("Esc drops the ghost and changes nothing; the original stays selected (AC-07)", () => {
    const { shell, before } = copying();
    shell.moveTo({ x: 4.1, y: 2 });
    shell.key("Escape");
    expect(kind(shell)).toBe("idle");
    expectNoGhost(shell);
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.selection).toEqual([piece("bed/p0")]);
  });

  const cancels: [string, Event][] = [
    ["Cmd+Z", { type: "key", key: "z", mods: { shift: false, ctrl: false, alt: false, meta: true } }],
    ["Ctrl+Z", { type: "key", key: "z", mods: { shift: false, ctrl: true, alt: false, meta: false } }],
    ["Shift+Cmd+Z", { type: "key", key: "z", mods: { shift: true, ctrl: false, alt: false, meta: true } }],
    ["the Undo button", { type: "ui", action: { type: "undo" } }],
    ["the Redo button", { type: "ui", action: { type: "redo" } }],
  ];
  it.each(cancels)("%s drops the ghost and undoes nothing (AC-07)", (_name, event) => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.command(place("ch1", "chair", { x: 5, y: 3.5 }));
    shell.command(place("ch2", "chair", { x: 5, y: 2.5 }));
    shell.key("z", { meta: true });
    expect([shell.state.undo.past.length, shell.state.undo.future.length]).toEqual([1, 1]);
    shell.click(BED);
    const before = shell.doc();
    shell.key("d", { meta: true });
    shell.moveTo({ x: 4.1, y: 2 });
    shell.send(event);
    expect(kind(shell)).toBe("idle");
    expectNoGhost(shell);
    expect(shell.doc()).toBe(before);
    expect([shell.state.undo.past.length, shell.state.undo.future.length]).toEqual([1, 1]);
    expect(shell.view().toast).toBeNull();
  });

  const tools: [string, (shell: FakeShell) => void][] = [
    ["W key", (s) => s.key("w")],
    ["V key", (s) => s.key("v")],
    ["pickTool wall", (s) => s.ui({ type: "pickTool", tool: "wall" })],
    ["pickKind chair", (s) => s.ui({ type: "pickKind", kind: "chair" })],
  ];
  it.each(tools)("%s: another tool drops the ghost (AC-07)", (_name, act) => {
    const { shell, before } = copying();
    shell.moveTo({ x: 4.1, y: 2 });
    act(shell);
    expect(ghost(shell)).toBeNull();
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expectNoGhost(shell); // the Object tool's own ghost is null until the next pointer move
  });

  it("switching layout drops the ghost (AC-07)", () => {
    const { shell, before } = copying();
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(kind(shell)).toBe("idle");
    expect(shell.state.activeState).toBe("n/s0");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.selection).toEqual([]);
  });

  it("a second Cmd+D, Ctrl+D or ui duplicate is ignored; the ghost stays where it was (ghost.06 D3)", () => {
    const { shell, before } = copying();
    shell.moveTo({ x: 3.93, y: 2.07 });
    shell.key("d", { meta: true });
    shell.key("d", { ctrl: true });
    shell.ui({ type: "duplicate" });
    expect(kind(shell)).toBe("copying");
    expect(ghost(shell)?.offset).toEqual({ x: 2.4, y: 0 });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 3.1, maxX: 4.7, minY: 1, maxY: 3 }]);
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.view().toast).toBeNull();
    // Only an ignored event keeps a turn (ghost.10): turned 90°, the bed covers x 2.9–4.9, y 1.2–2.8.
    shell.key("r");
    shell.key("d", { meta: true });
    shell.key("d", { ctrl: true });
    shell.ui({ type: "duplicate" });
    expect(ghost(shell)?.turn).toBe(90);
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 2.9, maxX: 4.9, minY: 1.2, maxY: 2.8 }]);
    shell.click({ x: 4.1, y: 2 });
    expect(placements(shell)).toHaveLength(2);
  });

  it.each(["Delete", "Backspace", "ArrowRight"])("%s keeps the ghost and does nothing", (key) => {
    const { shell, before } = copying();
    shell.key(key);
    expect(kind(shell)).toBe("copying");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    shell.click({ x: 4.1, y: 2 });
    expect(placements(shell)).toHaveLength(2);
  });

  it("another UI action or command drops the ghost, then runs", () => {
    const deleted = copying().shell;
    deleted.ui({ type: "deleteSelection" });
    expect(kind(deleted)).toBe("idle");
    expect(placements(deleted)).toHaveLength(0);
    expect(deleted.state.undo.past).toHaveLength(1);

    const placed = copying().shell;
    placed.command(place("ch", "chair", { x: 5, y: 3.5 }));
    expect(kind(placed)).toBe("idle");
    expect(placements(placed)).toHaveLength(2);
  });

  it("a wheel pan moves the world under the still cursor; the ghost follows the cursor's new world point", () => {
    const { shell, before } = copying();
    shell.moveTo({ x: 3.5, y: 2 });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 2.7, maxX: 4.3, minY: 1, maxY: 3 }]);
    shell.wheel(0, -32); // a plain wheel pans: the camera centre moves up 32 / 80 = 0.4 m
    expect(shell.state.pointer?.world.x).toBeCloseTo(3.5, 9);
    expect(shell.state.pointer?.world.y).toBeCloseTo(2.4, 9);
    expect(kind(shell)).toBe("copying");
    expect(ghost(shell)?.offset).toEqual({ x: 2, y: 0.4 });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 2.7, maxX: 4.3, minY: 1.4, maxY: 3.4 }]);
    expect(boxes(shell, COLORS.invalidFill)).toEqual([]);
    expect(shell.doc()).toBe(before);
  });

  it("Cmd+D during a nudge run commits the run first, then picks up the moved bed", () => {
    const shell = bedSelected();
    shell.key("ArrowRight");
    shell.key("d", { meta: true });
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.doc().placements["bed/p0"]?.at.x).toBeCloseTo(1.51, 6);
    expect(kind(shell)).toBe("copying");
    expect(ghost(shell)?.offset).toEqual({ x: 0, y: 0 }); // the raw −0.01 steps to 0, with no −0
    shell.click({ x: 4.1, y: 2 }); // offset 2.6 from the centre 1.51
    expect(shell.doc().placements[shell.state.selection[0]?.id ?? ""]?.at).toEqual({ x: 4.11, y: 3 });
    expect(shell.state.undo.past).toHaveLength(2);
  });

  it("a group's ghost moves its pieces together; copies are numbered in sorted source order (smoke; AC-09 is step 03)", () => {
    // Chairs at (1, 2.225) and (2, 2.225): x 0.775–1.225 and 1.775–2.225, y 1.775–2.225; box centre (1.5, 2).
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("c1", "chair", { x: 1, y: 2.225 }), place("c2", "chair", { x: 2, y: 2.225 })));
    shell.click({ x: 2, y: 2 });
    shell.click({ x: 1, y: 2 }, { shift: true });
    shell.key("d", { meta: true });
    shell.click({ x: 3.5, y: 3 }); // offset (2, 1)
    expect(shell.doc().placements["id1/p0"]).toMatchObject({ at: { x: 3, y: 3.225 }, rotation: 0 }); // c1's copy
    expect(shell.doc().placements["id1/p1"]).toMatchObject({ at: { x: 4, y: 3.225 }, rotation: 0 });
    expect(shell.state.selection).toEqual([piece("id1/p0"), piece("id1/p1")]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  describe("does nothing without furniture selected", () => {
    function expectNothing(shell: FakeShell): void {
      const before = shell.doc();
      shell.key("d", { meta: true });
      expect(shell.doc()).toBe(before);
      expect(shell.state.undo.past).toHaveLength(0);
      expect(shell.view().toast).toBeNull();
      expect(kind(shell)).not.toBe("copying");
    }

    it("nothing selected", () => {
      expectNothing(FakeShell.withDocument(studioDoc()));
    });

    it("a wall selected", () => {
      const shell = FakeShell.withDocument(studioDoc());
      shell.click({ x: 3, y: 0 });
      expect(shell.state.selection.map((r) => r.table)).toEqual(["walls"]);
      expectNothing(shell);
    });

    it("the Object tool active", () => {
      const shell = bedSelected();
      shell.ui({ type: "pickTool", tool: "object" });
      // picking a tool clears the selection, so the empty-selection rule covers it (direct.39)
      expect(shell.state.selection).toEqual([]);
      expectNothing(shell);
    });

    it("in the middle of a drag", () => {
      const shell = FakeShell.withDocument(studioDoc());
      shell.down(BED);
      shell.moveTo({ x: 2, y: 2 });
      expectNothing(shell);
    });
  });
});

describe("packed room (AC-03, AC-11)", () => {
  const triggers: [string, (shell: FakeShell) => void][] = [
    ["Cmd+D", (s) => s.key("d", { meta: true })],
    ["ui duplicate", (s) => s.ui({ type: "duplicate" })],
  ];
  it.each(triggers)("one piece with no side free: %s picks up a ghost, no toast", (_name, trigger) => {
    // Free floor x 0.1–2.1, y 0.1–2.5; the bed spans x 0.3–1.9, y 0.4–2.4, so a step of its width or depth on
    // every side reaches a wall.
    const shell = FakeShell.withDocument(withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 2.2, 2.6), place("bed", "bed", { x: 1.1, y: 2.4 })));
    shell.click({ x: 1.1, y: 1.4 });
    expect(shell.state.selection).toEqual([piece("bed/p0")]);
    const before = shell.doc();
    trigger(shell);
    expect(shell.view().toast).toBeNull();
    expect(kind(shell)).toBe("copying");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.selection).toEqual([piece("bed/p0")]);
  });

  it("a group with no side free: Cmd+D picks up a ghost, no toast, and the copies go elsewhere in the room", () => {
    // In the corner: c1 x 0.1–0.55, y 0.1–0.55; c2 on its right (x 0.55–1.0); c3 above c1 (y 0.55–1.0); c4 right of
    // c2 (x 1.0–1.45). The group c1 + c2 has the box x 0.1–1.0, y 0.1–0.55, centred on (0.55, 0.325).
    const doc = withCommands(
      roomDoc(),
      place("c1", "chair", { x: 0.325, y: 0.55 }),
      place("c2", "chair", { x: 0.775, y: 0.55 }),
      place("c3", "chair", { x: 0.325, y: 1 }),
      place("c4", "chair", { x: 1.225, y: 0.55 }),
    );
    // The old rule's four sides, a step of the box's width or height: right hits c4, left the wall, up c3, down the wall.
    const sides: [Point, Point][] = [
      [{ x: 1.225, y: 0.55 }, { x: 1.675, y: 0.55 }],
      [{ x: -0.575, y: 0.55 }, { x: -0.125, y: 0.55 }],
      [{ x: 0.325, y: 1 }, { x: 0.775, y: 1 }],
      [{ x: 0.325, y: 0.1 }, { x: 0.775, y: 0.1 }],
    ];
    for (const [a, b] of sides) {
      const copies = [{ placementId: "c1/p0", at: a, rotation: 0 }, { placementId: "c2/p0", at: b, rotation: 0 }];
      expect(execute(doc, { type: "duplicatePlacements", opId: "t", copies }).ok).toBe(false);
    }
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 0.325, y: 0.325 });
    shell.click({ x: 0.775, y: 0.325 }, { shift: true });
    expect(shell.state.selection).toEqual([piece("c1/p0"), piece("c2/p0")]);
    const before = shell.doc();
    shell.key("d", { meta: true });
    expect(shell.view().toast).toBeNull();
    expect(kind(shell)).toBe("copying");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);

    // Raw delta (3, 2) from the box centre: whole snap steps. Far from the walls and more than the guide tolerance
    // from every chair's edges and centre lines; the copies span x 3.1–4.0, y 2.1–2.55.
    shell.moveTo({ x: 3.55, y: 2.325 });
    shell.click({ x: 3.55, y: 2.325 });
    const copies = fresh(shell, before);
    expect(copies.map((p) => p.id)).toEqual(["id1/p0", "id1/p1"]);
    expect(copies.map((p) => p.at)).toEqual([{ x: 3.325, y: 2.55 }, { x: 3.775, y: 2.55 }]);
    expect(copies.map((p) => p.rotation)).toEqual([0, 0]);
    expect([...shell.state.selection].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([piece("id1/p0"), piece("id1/p1")]);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(kind(shell)).toBe("idle");
    expect(shell.view().toast).toBeNull();
  });
});

describe("the duplicate ghost in a shared document (ghost.01)", () => {
  function sharedCopying(): FakeRemote {
    const r = FakeRemote.open(studioDoc());
    r.shell.click(BED);
    r.shell.key("d", { meta: true });
    return r;
  }

  it("shared: the ghost sends nothing; the click submits one changeset with both rows; the copy stays selected", () => {
    const r = sharedCopying();
    r.shell.moveTo({ x: 4.1, y: 2 });
    expect(r.submits()).toHaveLength(0);
    r.shell.click({ x: 4.1, y: 2 });
    expect(r.submits()).toHaveLength(1);
    expect([...new Set(r.last().patch.puts.map((p) => p.table))].sort()).toEqual(["objects", "placements"]);
    const [ref] = r.shell.state.selection;
    expect(r.shell.state.selection).toHaveLength(1);
    expect(r.shell.doc().placements[ref?.id ?? ""]?.at).toEqual({ x: 4.1, y: 3 });
    r.accept();
    expect(r.shell.state.selection).toEqual([ref]);
  });

  it("shared: Cmd+D while an edit is in flight shows the blocked toast and picks up nothing", () => {
    const r = sharedCopying();
    r.shell.click({ x: 4.1, y: 2 });
    r.shell.key("d", { meta: true });
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(kind(r.shell)).toBe("idle");
    expect(r.submits()).toHaveLength(1);
  });

  it("shared: a remote change to an original cancels the ghost, even before the first move", () => {
    const r = sharedCopying(); // red over the bed: only the zero move's dependencies
    r.remote({ type: "movePlacement", placementId: "bed/p0", at: { x: 1.5, y: 3.5 }, rotation: 0 });
    expect(kind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe("Drawing changed remotely");
    expect(r.submits()).toHaveLength(0);
  });

  it("shared: a remote change elsewhere reruns the ghost on the new drawing", () => {
    const r = sharedCopying();
    r.shell.moveTo({ x: 4.1, y: 2 });
    expect(boxes(r.shell, COLORS.ghostFill)).toEqual([{ minX: 3.3, maxX: 4.9, minY: 1, maxY: 3 }]);
    r.remote(place("c", "chair", { x: 4.5, y: 2.225 })); // x 4.275–4.725, y 1.775–2.225: inside the ghost
    expect(kind(r.shell)).toBe("copying");
    expect(r.shell.view().toast).toBeNull();
    expect(boxes(r.shell, COLORS.invalidFill)).toContainEqual({ minX: 3.3, maxX: 4.9, minY: 1, maxY: 3 });
    expect(boxes(r.shell, COLORS.ghostFill)).toEqual([]);
    r.shell.moveTo({ x: 3.3, y: 2.6 }); // offset (1.8, 0.6)
    expect(boxes(r.shell, COLORS.ghostFill)).toEqual([{ minX: 2.5, maxX: 4.1, minY: 1.6, maxY: 3.6 }]);
    r.shell.click({ x: 3.3, y: 2.6 });
    expect(r.submits()).toHaveLength(1);
    expect(r.shell.doc().placements[r.shell.state.selection[0]?.id ?? ""]?.at).toEqual({ x: 3.3, y: 3.6 });
  });

  it("shared: losing the connection drops the ghost", () => {
    const r = sharedCopying();
    r.disconnect();
    expect(kind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe("Connection lost: editing resumes when it returns");
  });
});

describe("Duplicate button start (AC-08, ghost.03)", () => {
  // A desk is 1.2 × 0.6. oneDesk: desk/p0 at x 1.4–2.6, y 1.7–2.3, centre (2, 2). twoDesks: d1 at x 1.0–2.2 and d2
  // at x 3.8–5.0, both y 1.3–1.9; their box is x 1.0–5.0, centre (3.0, 1.6). The desk is selected at PRESS, 0.4 m off
  // its centre, so a pick-up measured from the press would show (direct.47). pointerLeave is what the canvas sends
  // when the mouse goes to the panel.
  const PRESS = { x: 2.4, y: 2 };
  const DESK_BOX = { minX: 1.4, maxX: 2.6, minY: 1.7, maxY: 2.3 };
  const oneDesk = () => withCommands(roomDoc(), place("desk", "desk", { x: 2, y: 2.3 }));
  const twoDesks = () => withCommands(roomDoc(), place("d1", "desk", { x: 1.6, y: 1.9 }), place("d2", "desk", { x: 4.4, y: 1.9 }));

  /** oneDesk selected at PRESS, the mouse gone to the panel, then Properties' Duplicate; `before` is the document then. */
  function buttonStart(): { shell: FakeShell; before: Document } {
    const shell = FakeShell.withDocument(oneDesk());
    shell.click(PRESS);
    shell.send({ type: "pointerLeave" });
    const before = shell.doc();
    shell.ui({ type: "duplicate" });
    return { shell, before };
  }

  it("the button picks up the ghost over the original while the pointer is off the canvas", () => {
    const { shell, before } = buttonStart();
    expectOffset(shell, 0, 0);
    expect(ghostOf(shell).turn).toBe(0);
    expect(ghostOf(shell).ok).toBe(false); // the copy overlaps the desk (AC-06)
    expect(boxes(shell, COLORS.invalidFill)).toEqual([DESK_BOX, DESK_BOX]); // the ghost, and its original drawn red
    expect(boxes(shell, COLORS.ghostFill)).toEqual([]);
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.selection).toEqual([piece("desk/p0")]);
  });

  it("the first move centres it on the cursor, as a Cmd+D ghost does", () => {
    const { shell } = buttonStart();
    shell.moveTo({ x: 4, y: 2.6 }); // the copy's bottom edge (2.3) on the desk's top edge: guide and grid agree
    expectOffset(shell, 2, 0.6);
    expect(ghostOf(shell).ok).toBe(true);
    expect(boxes(shell, COLORS.ghostFill)).toEqual([{ minX: 3.4, maxX: 4.6, minY: 2.3, maxY: 2.9 }]);

    const keyed = FakeShell.withDocument(oneDesk());
    keyed.click(PRESS);
    keyed.key("d", { meta: true });
    keyed.moveTo({ x: 4, y: 2.6 });
    expect(ghostOf(keyed)).toEqual(ghostOf(shell));
  });

  it("a click after the button places one copy, selected, one undo step", () => {
    const { shell } = buttonStart();
    shell.click({ x: 4, y: 2.6 }); // the press commits
    expect(placements(shell)).toHaveLength(2);
    const copy = shell.doc().placements["id1/p0"];
    expect(copy?.at).toEqual({ x: 4, y: 2.9 });
    expect(copy?.rotation).toBe(0);
    expect(shell.state.selection).toEqual([piece("id1/p0")]);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(kind(shell)).toBe("idle");
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(oneDesk());
  });

  it("off the grid with Ctrl: the ghost centres on the cursor, not on the press", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.click({ x: 2.1, y: 2.6 }); // inside the bed, off its centre (1.5, 2)
    shell.send({ type: "pointerLeave" });
    shell.ui({ type: "duplicate" });
    expectOffset(shell, 0, 0);
    // From the press it would be (1.83, −0.53); rounded to the step, (2.4, 0).
    shell.moveTo({ x: 3.93, y: 2.07 }, { ctrl: true });
    expectOffset(shell, 2.43, 0.07, 3); // the copy spans x 3.13–4.73, y 1.07–3.07
    expect(ghostOf(shell).ok).toBe(true);
  });

  it("Cmd+D with the pointer off the canvas also starts over the original (one rule: no pointer, nothing to centre on)", () => {
    const shell = FakeShell.withDocument(oneDesk());
    shell.click(PRESS);
    shell.send({ type: "pointerLeave" });
    shell.key("d", { meta: true });
    expectOffset(shell, 0, 0);
  });

  it("the button with the pointer still on the canvas centres on it, as Cmd+D does", () => {
    const shell = FakeShell.withDocument(oneDesk());
    shell.click(PRESS);
    shell.ui({ type: "duplicate" });
    // Raw (0.4, 0), a whole step; the copy's x lines (1.8, 2.4, 3.0) are 0.2 or more from the desk's, so no guide.
    expectOffset(shell, 0.4, 0);
  });

  it("R before the pointer arrives turns the ghost in place; Esc then drops it", () => {
    const { shell, before } = buttonStart();
    shell.key("r"); // reruns at attempt.cursor, the centre here; 1.3 m from the nearest wall, so no parallel turn
    expectOffset(shell, 0, 0);
    expect(ghostOf(shell).turn).toBe(90);
    expect(boxes(shell, COLORS.invalidFill)).toEqual([DESK_BOX, { minX: 1.7, maxX: 2.3, minY: 1.4, maxY: 2.6 }]);
    shell.key("Escape");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.selection).toEqual([piece("desk/p0")]);
    expect(kind(shell)).toBe("idle");
    expectNoGhost(shell);
  });

  it("a second Duplicate while the ghost is up changes nothing (ghost.06 D3)", () => {
    const { shell, before } = buttonStart();
    shell.moveTo({ x: 4, y: 2.6 });
    shell.send({ type: "pointerLeave" });
    shell.ui({ type: "duplicate" });
    expect(kind(shell)).toBe("copying");
    expectOffset(shell, 2, 0.6);
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.view().toast).toBeNull();
  });

  it("a group: the button starts its ghost over the originals; a click places both copies as one changeset", () => {
    const shell = FakeShell.withDocument(twoDesks());
    shell.click({ x: 1.6, y: 1.6 });
    shell.click({ x: 4.4, y: 1.6 }, { shift: true });
    shell.send({ type: "pointerLeave" });
    shell.ui({ type: "duplicate" });
    expectOffset(shell, 0, 0);
    const left = { minX: 1, maxX: 2.2, minY: 1.3, maxY: 1.9 };
    const right = { minX: 3.8, maxX: 5, minY: 1.3, maxY: 1.9 };
    expect(boxes(shell, COLORS.invalidFill)).toEqual([left, left, right, right]); // both copies and both originals
    shell.click({ x: 3, y: 2.6 }); // offset (0, 1.0)
    expect(placements(shell)).toHaveLength(4);
    expect(shell.doc().placements["id1/p0"]).toMatchObject({ at: { x: 1.6, y: 2.9 }, rotation: 0 });
    expect(shell.doc().placements["id1/p1"]).toMatchObject({ at: { x: 4.4, y: 2.9 }, rotation: 0 });
    expect(shell.state.selection).toEqual([piece("id1/p0"), piece("id1/p1")]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("shared document: a button start submits nothing; the click submits one patch with the copy, selected while pending (direct.26)", () => {
    const r = FakeRemote.open(oneDesk());
    r.shell.click(PRESS);
    r.shell.send({ type: "pointerLeave" });
    r.shell.ui({ type: "duplicate" });
    expect(r.submits()).toHaveLength(0);
    r.shell.click({ x: 4, y: 2.6 });
    expect(r.submits()).toHaveLength(1);
    expect([...new Set(r.last().patch.puts.map((p) => p.table))].sort()).toEqual(["objects", "placements"]);
    const [ref] = r.shell.state.selection;
    expect(r.shell.state.selection).toHaveLength(1);
    expect(r.shell.doc().placements[ref?.id ?? ""]?.at).toEqual({ x: 4, y: 2.9 });
    r.accept();
    expect(r.shell.state.selection).toEqual([ref]);
  });
});
