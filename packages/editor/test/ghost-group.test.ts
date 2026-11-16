import { describe, expect, it } from "vitest";
import { boxOf, footprints, placementCentre, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { bed160x200, roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// Groups, R and refused places on the duplicate's ghost (ghost.02, ghost.03; AC-04, AC-05's turn, AC-06, AC-09).
// roomDoc: free floor x 0.1–5.9, y 0.1–3.9, layout s0 "Layout", zoom 80, step Auto (0.2 m). `at` is the middle of a
// piece's back edge. A desk is 1.2 × 0.6, a chair 0.45 × 0.45, a bed 1.6 × 2, a block 0.6 × 0.6. Every plain cursor
// sits a multiple of 0.2 m from the sources' centre, and except where a test says so no moved line comes within 0.125 m
// of another furniture line, so the snap step's offset is exact now and the guides of step 04 pick the same one.
// Off-grid offsets use Ctrl.
const place = (opId: string, kind: string, at: Point, rotation?: number): Command => ({
  type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at, ...(rotation === undefined ? {} : { rotation }),
});

/** A desk "dk" at (2, y): x 1.4–2.6, y y−0.6–y, centred on (2, y − 0.3). */
const deskDoc = (y: number): Document => withCommands(roomDoc(), place("dk", "desk", { x: 2, y }));
/** Chairs c1 (1, 1), c2 (1.5, 1), c3 (2, 1.5): centres (1, 0.775), (1.5, 0.775), (2, 1.275); box x 0.775–2.225, y 0.55–1.5, centred on (1.5, 1.025). */
const threeChairs = (): Document =>
  withCommands(roomDoc(), place("c1", "chair", { x: 1, y: 1 }), place("c2", "chair", { x: 1.5, y: 1 }), place("c3", "chair", { x: 2, y: 1.5 }));
/** deskDoc(1.0) and a bed "b" at (4.95, 3.15): x 4.15–5.75, y 1.15–3.15. */
const deskAndBed = (): Document => withCommands(deskDoc(1), place("b", "bed", { x: 4.95, y: 3.15 }), bed160x200("b/o0"));
const DESK = { x: 2, y: 0.7 };
const GROUP_AT = { x: 3.5, y: 3.025 };

function pickUpThree(shell: FakeShell): void {
  shell.click({ x: 1, y: 0.775 });
  shell.click({ x: 1.5, y: 0.775 }, { shift: true });
  shell.click({ x: 2, y: 1.275 }, { shift: true });
  shell.key("d", { meta: true });
}

const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const round = (v: number): number => +v.toFixed(6);
/** The overlay polygons in `color`, as rounded [minX, maxX, minY, maxY], sorted. */
const boxes = (shell: FakeShell, color: string): number[][] =>
  overlays(shell)
    .flatMap((p) => (p.kind === "polygon" && p.color === color ? [boxOf(p.points)] : []))
    .map((b) => [round(b.minX), round(b.maxX), round(b.minY), round(b.maxY)])
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0) || (a[3] ?? 0) - (b[3] ?? 0));
const placements = (shell: FakeShell): Placement[] => Object.values(shell.doc().placements).filter((p) => p.state === "s0");
/** The s0 placements not in `before`, sorted by at.x, then at.y. */
const fresh = (shell: FakeShell, before: Document): Placement[] =>
  placements(shell).filter((p) => before.placements[p.id] === undefined).sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y);
const kind = (shell: FakeShell): string | null => (shell.state.tool.name === "select" ? shell.state.tool.state.kind : null);
const selectedIds = (shell: FakeShell): string[] => shell.state.selection.map((r) => r.id).sort();
/** The one placement added since `before`. */
function onlyCopy(shell: FakeShell, before: Document): Placement {
  const added = fresh(shell, before);
  expect(added).toHaveLength(1);
  const [copy] = added;
  if (!copy) throw new Error("no copy");
  return copy;
}

describe("ghost R (AC-04)", () => {
  const presses: [number, Point, number][] = [
    [0, { x: 4, y: 3 }, 0],
    [1, { x: 3.7, y: 2.7 }, 90],
    [2, { x: 4, y: 2.4 }, 180],
    [3, { x: 4.3, y: 2.7 }, 270],
    [4, { x: 4, y: 3 }, 0],
  ];
  it.each(presses)("%i R presses: the desk's copy is at %o, rotation %i", (n, at, rotation) => {
    const shell = FakeShell.withDocument(deskDoc(1));
    const before = shell.doc();
    shell.click(DESK);
    shell.key("d", { meta: true });
    for (let i = 0; i < n; i++) shell.key("r");
    shell.moveTo({ x: 4, y: 2.7 }); // offset (2, 2)
    shell.click({ x: 4, y: 2.7 });
    const copy = onlyCopy(shell, before);
    expect(copy.at).toEqual(at);
    expect(copy.rotation).toBe(rotation);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("R turns the ghost at once and changes nothing in the document", () => {
    const shell = FakeShell.withDocument(deskDoc(1));
    shell.click(DESK);
    shell.key("d", { meta: true });
    shell.moveTo({ x: 4, y: 2.7 });
    const before = shell.doc();
    shell.key("r");
    expect(boxes(shell, COLORS.ghostFill)).toEqual([[3.7, 4.3, 2.1, 3.3]]);
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.doc().placements["dk/p0"]?.rotation).toBe(0);
    expect(kind(shell)).toBe("copying");
    shell.key("R", { shift: true });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([[3.4, 4.6, 2.4, 3.0]]);
    expect(shell.doc()).toBe(before);
  });

  it("once placed, R turns the copy as a selection", () => {
    const shell = FakeShell.withDocument(deskDoc(1));
    const before = shell.doc();
    shell.click(DESK);
    shell.key("d", { meta: true });
    shell.key("r");
    shell.click({ x: 4, y: 2.7 });
    shell.key("r");
    const copy = onlyCopy(shell, before);
    expect(copy.rotation).toBe(180);
    const c = placementCentre(shell.doc(), copy);
    expect(c?.x).toBeCloseTo(4, 3);
    expect(c?.y).toBeCloseTo(2.7, 3);
    expect(shell.state.undo.past).toHaveLength(2);
  });

  describe("near a wall the contact turn wins over R when it fits; Ctrl keeps R's angle; away again R shows", () => {
    // deskDoc(1.5): x 1.4–2.6, y 0.9–1.5, centre (2, 1.2).
    function turnedOnce(): { shell: FakeShell; before: Document } {
      const shell = FakeShell.withDocument(deskDoc(1.5));
      const before = shell.doc();
      shell.click({ x: 2, y: 1.2 });
      shell.key("d", { meta: true });
      shell.key("r");
      return { shell, before };
    }

    it("near the top wall the copy turns its back to the wall and lands flush", () => {
      // At 90 the footprint would span y 2.6–3.8, its side 0.1 m from the top face; turned to 0 and flush it spans y 3.3–3.9.
      const { shell, before } = turnedOnce();
      shell.moveTo({ x: 4, y: 3.2 });
      shell.click({ x: 4, y: 3.2 });
      const copy = onlyCopy(shell, before);
      expect(copy.at).toEqual({ x: 4, y: 3.9 });
      expect(copy.rotation).toBe(0);
    });

    it("with Ctrl R's angle is kept", () => {
      const { shell, before } = turnedOnce();
      shell.moveTo({ x: 4, y: 3.2 }, { ctrl: true });
      shell.click({ x: 4, y: 3.2 }, { ctrl: true });
      const copy = onlyCopy(shell, before);
      expect(copy.at).toEqual({ x: 3.7, y: 3.2 });
      expect(copy.rotation).toBe(90);
    });

    it("away from the wall again R's angle shows: the contact turn did not use up the press", () => {
      const { shell, before } = turnedOnce();
      shell.moveTo({ x: 4, y: 3.2 });
      shell.moveTo({ x: 4, y: 2.6 });
      shell.click({ x: 4, y: 2.6 });
      const copy = onlyCopy(shell, before);
      expect(copy.at).toEqual({ x: 3.7, y: 2.6 }); // footprint y 2.0–3.2
      expect(copy.rotation).toBe(90);
    });
  });

  it("a group never takes the parallel turn", () => {
    // Offset (3.6, 0): c3's copy ends 0.075 m from the right wall's face, where a lone chair would turn to 270.
    const shell = FakeShell.withDocument(threeChairs());
    const before = shell.doc();
    pickUpThree(shell);
    shell.moveTo({ x: 5.1, y: 1.025 });
    shell.click({ x: 5.1, y: 1.025 });
    expect(fresh(shell, before).map((p) => [p.at, p.rotation])).toEqual([
      [{ x: 4.6, y: 1 }, 0],
      [{ x: 5.1, y: 1 }, 0],
      [{ x: 5.6, y: 1.5 }, 0],
    ]);

    // The place is near a wall: c3 alone, copied by the same offset, turns its back to the right wall.
    const lone = FakeShell.withDocument(threeChairs());
    const alone = lone.doc();
    lone.click({ x: 2, y: 1.275 });
    lone.key("d", { meta: true });
    lone.moveTo({ x: 5.6, y: 1.275 });
    lone.click({ x: 5.6, y: 1.275 });
    expect(onlyCopy(lone, alone).rotation).toBe(270);
  });

  it("a group never takes its first piece's parallel turn either", () => {
    // A desk "ad" at (2, 1): x 1.4–2.6, y 0.4–1.0, and a chair "ch" at (2.825, 1): x 2.6–3.05, y 0.55–1.0. The desk
    // sorts first and its box is nearly the group's (x 1.4–3.05, y 0.4–1.0, centred on (2.225, 0.7)). Offset (2, −0.2):
    // the desk's copy ends 0.1 m from the bottom wall's face, where a lone desk turns to 180. With the guides on
    // (step 04), the copies' top edge, which steps to 0.8, aligns to the chair's own centre line at 0.775 (ghost.15);
    // still no turn.
    const doc = (): Document => withCommands(roomDoc(), place("ad", "desk", { x: 2, y: 1 }), place("ch", "chair", { x: 2.825, y: 1 }));
    const shell = FakeShell.withDocument(doc());
    const before = shell.doc();
    shell.click({ x: 2, y: 0.7 });
    shell.click({ x: 2.825, y: 0.775 }, { shift: true });
    shell.key("d", { meta: true });
    shell.moveTo({ x: 4.225, y: 0.5 });
    shell.click({ x: 4.225, y: 0.5 });
    expect(fresh(shell, before).map((p) => [p.at, p.rotation])).toEqual([
      [{ x: 4, y: 0.775 }, 0],
      [{ x: 4.825, y: 0.775 }, 0],
    ]);

    const lone = FakeShell.withDocument(doc());
    const alone = lone.doc();
    lone.click({ x: 2, y: 0.7 });
    lone.key("d", { meta: true });
    lone.moveTo({ x: 4, y: 0.5 });
    lone.click({ x: 4, y: 0.5 });
    expect(onlyCopy(lone, alone).rotation).toBe(180);
  });

  const groupTurns: [number, Point, Point, Point, number][] = [
    [1, { x: 3.525, y: 2.525 }, { x: 3.525, y: 3.025 }, { x: 3.025, y: 3.525 }, 90],
    [2, { x: 4, y: 3.05 }, { x: 3.5, y: 3.05 }, { x: 3, y: 2.55 }, 180],
    [3, { x: 3.475, y: 3.525 }, { x: 3.475, y: 3.025 }, { x: 3.975, y: 2.525 }, 270],
  ];
  // Turning about the mean of the centres would put c1's copy at (3.442, 2.442) with one press, and about c1's
  // centre at (2.775, 2.775).
  it.each(groupTurns)("a group turns about its bounding box centre (%i presses): the east piece ends at the north", (n, c1, c2, c3, rotation) => {
    const shell = FakeShell.withDocument(threeChairs());
    pickUpThree(shell);
    for (let i = 0; i < n; i++) shell.key("r");
    shell.moveTo(GROUP_AT);
    shell.click(GROUP_AT);
    const [first] = shell.state.selection;
    const opId = first?.id.split("/")[0] ?? "";
    const doc = shell.doc();
    const copies = ["p0", "p1", "p2"].map((p) => doc.placements[`${opId}/${p}`]);
    expect(copies.map((p) => p?.at)).toEqual([c1, c2, c3]);
    expect(copies.map((p) => p?.rotation)).toEqual([rotation, rotation, rotation]);
    const all = footprints(doc);
    const box = boxOf(["p0", "p1", "p2"].flatMap((p) => all.get(`${opId}/${p}`) ?? []));
    expect(Math.abs((box.minX + box.maxX) / 2 - GROUP_AT.x)).toBeLessThan(1e-9);
    expect(Math.abs((box.minY + box.maxY) / 2 - GROUP_AT.y)).toBeLessThan(1e-9);
    if (n === 1) {
      // AC-04: the east-most piece (c3) ends at the north.
      const ys = copies.map((p) => (p ? (placementCentre(doc, p)?.y ?? 0) : 0));
      expect(Math.max(...ys)).toBeCloseTo(3.525, 9);
      expect(ys[2]).toBeCloseTo(3.525, 9);
    }
  });
});

describe("group ghost (AC-09)", () => {
  it("three pieces: the ghost keeps the arrangement; a click commits one changeset of three copies, all selected", () => {
    const shell = FakeShell.withDocument(threeChairs());
    const before = shell.doc();
    pickUpThree(shell);
    shell.moveTo(GROUP_AT);
    expect(boxes(shell, COLORS.ghostFill)).toEqual([[2.775, 3.225, 2.55, 3.0], [3.275, 3.725, 2.55, 3.0], [3.775, 4.225, 3.05, 3.5]]);
    expect(boxes(shell, COLORS.invalidFill)).toEqual([]);
    expect(shell.doc()).toBe(before);
    shell.click(GROUP_AT);
    const added = fresh(shell, before);
    expect(added.map((p) => [p.at, p.rotation])).toEqual([
      [{ x: 3, y: 3 }, 0],
      [{ x: 3.5, y: 3 }, 0],
      [{ x: 4, y: 3.5 }, 0],
    ]);
    expect(Object.keys(shell.doc().objects).length - Object.keys(before.objects).length).toBe(3);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(selectedIds(shell)).toEqual(added.map((p) => p.id).sort());
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(threeChairs());
  });

  it("a selection that is not all furniture of the active layout picks up nothing", () => {
    const shell = FakeShell.withDocument(threeChairs());
    shell.click({ x: 1, y: 0.775 });
    // No click makes this selection (a Shift-click on a wall selects the wall alone, direct.02), so it is set here.
    const wall = Object.keys(shell.doc().walls)[0] ?? "";
    shell.state = { ...shell.state, selection: [...shell.state.selection, { table: "walls", id: wall }] };
    expect(shell.state.selection.map((r) => r.table)).toEqual(["placements", "walls"]);
    const before = shell.doc();
    shell.key("d", { meta: true });
    expect(kind(shell)).toBe("idle");
    expect(shell.view().toast).toBeNull();
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("shared: one submit with six rows; the copies stay selected while pending and after the ack", () => {
    const r = FakeRemote.open(threeChairs());
    pickUpThree(r.shell);
    r.shell.moveTo(GROUP_AT);
    r.shell.click(GROUP_AT);
    expect(r.submits()).toHaveLength(1);
    const puts = r.last().patch.puts;
    expect(puts).toHaveLength(6);
    expect(puts.filter((p) => p.table === "objects")).toHaveLength(3);
    expect(puts.filter((p) => p.table === "placements")).toHaveLength(3);
    const copies = puts.filter((p) => p.table === "placements").map((p) => p.entity.id).sort();
    expect(selectedIds(r.shell)).toEqual(copies);
    r.accept();
    expect(selectedIds(r.shell)).toEqual(copies);
  });
});

describe("refused ghost (AC-06)", () => {
  it("over a bed: the ghost and the bed are red; a click toasts the domain's reason and keeps both red", () => {
    const shell = FakeShell.withDocument(deskAndBed());
    shell.click(DESK);
    const before = shell.doc();
    shell.key("d", { meta: true });
    shell.moveTo({ x: 4, y: 2.7 });
    const red = [[3.4, 4.6, 2.4, 3.0], [4.15, 5.75, 1.15, 3.15]];
    expect(boxes(shell, COLORS.invalidFill)).toEqual(red);
    expect(boxes(shell, COLORS.ghostFill)).toEqual([]);
    shell.click({ x: 4, y: 2.7 });
    expect(shell.view().toast).toBe("Bed (0.00–1.00) and Desk (0.00–0.75) overlap in Layout");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(kind(shell)).toBe("copying");
    expect(shell.state.selection).toEqual([{ table: "placements", id: "dk/p0" }]);
    expect(boxes(shell, COLORS.invalidFill)).toEqual(red);

    shell.moveTo({ x: 2, y: 2.7 });
    expect(boxes(shell, COLORS.ghostFill)).toEqual([[1.4, 2.6, 2.4, 3.0]]);
    expect(boxes(shell, COLORS.invalidFill)).toEqual([]);
    shell.click({ x: 2, y: 2.7 });
    const copy = onlyCopy(shell, before);
    expect(copy.at).toEqual({ x: 2, y: 3 });
    expect(copy.rotation).toBe(0);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("every piece the ghost would hit is red", () => {
    // A block "k" at (3.85, 3.15): x 3.55–4.15, y 2.55–3.15, touching the bed.
    const shell = FakeShell.withDocument(withCommands(deskAndBed(), place("k", "block", { x: 3.85, y: 3.15 })));
    shell.click(DESK);
    shell.key("d", { meta: true });
    shell.moveTo({ x: 4, y: 2.7 });
    expect(boxes(shell, COLORS.invalidFill)).toEqual([[3.4, 4.6, 2.4, 3.0], [3.55, 4.15, 2.55, 3.15], [4.15, 5.75, 1.15, 3.15]]);
  });

  it("a group copy over its own original: that original is red, the others are not", () => {
    const shell = FakeShell.withDocument(threeChairs());
    pickUpThree(shell);
    shell.moveTo({ x: 2.0, y: 1.025 }, { ctrl: true }); // offset (0.5, 0): c1's copy lands exactly on c2
    // The three copies and c2's original (the same box as c1's copy); c1 and c3 are not red. blockedPlacements, which
    // leaves out the sources, would give 3.
    expect(boxes(shell, COLORS.invalidFill)).toEqual([
      [1.275, 1.725, 0.55, 1.0],
      [1.275, 1.725, 0.55, 1.0],
      [1.775, 2.225, 0.55, 1.0],
      [2.275, 2.725, 1.05, 1.5],
    ]);
    shell.click({ x: 2.0, y: 1.025 }, { ctrl: true });
    expect(shell.view().toast).toBe("Chair (0.00–0.90) and Chair (0.00–0.90) overlap in Layout");
    expect(shell.state.undo.past).toHaveLength(0);
    expect(kind(shell)).toBe("copying");
  });

  it("shared: a remote piece under the ghost turns it red; a click there submits nothing", () => {
    const r = FakeRemote.open(threeChairs());
    pickUpThree(r.shell);
    r.shell.moveTo(GROUP_AT);
    expect(boxes(r.shell, COLORS.invalidFill)).toEqual([]);
    // A bed at x 3.7–5.3, y 1.5–3.5: it touches none of the ghost's dependencies, so the ghost reruns.
    r.remote({ type: "placeObject", deck: null, opId: "bob", state: "s0", object: { kind: "bed" }, at: { x: 4.5, y: 3.5 } });
    r.remote(bed160x200("bob/o0"));
    expect(kind(r.shell)).toBe("copying");
    const red = [[2.775, 3.225, 2.55, 3.0], [3.275, 3.725, 2.55, 3.0], [3.7, 5.3, 1.5, 3.5], [3.775, 4.225, 3.05, 3.5]];
    expect(boxes(r.shell, COLORS.invalidFill)).toEqual(red);
    r.shell.moveTo(GROUP_AT);
    expect(boxes(r.shell, COLORS.invalidFill)).toEqual(red);
    r.shell.click(GROUP_AT);
    expect(r.shell.view().toast).toBe("Bed (0.00–1.00) and Chair (0.00–0.90) overlap in Layout");
    expect(r.submits()).toHaveLength(0);
    expect(kind(r.shell)).toBe("copying");
  });
});
