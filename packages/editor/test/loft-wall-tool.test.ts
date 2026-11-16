import { describe, expect, it } from "vitest";
import { incidentWalls, levelOf, wallEnds, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "../src/snapping/contact";
import { viewedLevel } from "../src/state";
import { ON_FLOOR, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The Wall tool at a deck's level (spec "Walls on a loft", pillars.08, .09; AC-09): walls based on the viewed level's
// deck, snapping only to joints and walls of that base, ending flush on the face of a wall of another base. At the
// floor, snaps ignore walls on a deck. Joints of loft walls are selected and dragged at the loft's level only.
//
// The fixture: roomDoc's 6 × 4 shell (inner faces x 0.1–5.9, y 0.1–3.9) under a 3.05 ceiling, a hollow Loft at 2.15
// against the west and north faces (x 0.1–2.5, y 1.5–3.9), and a 0.10 floor partition from the south wall (1.5, 0)
// to a free end under the loft at (1.5, 2.5), 2.03 high (up to the loft's underside).

const LOFT = "loft/k0";
const PARTITION = "p/w0";
const KNEE = "k/w0";

function flushLoftDoc(): Document {
  return withCommands(roomDoc(),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.3, y: 2.7 }, w: 2.4, d: 2.4 },
    { type: "addWall", opId: "p", from: { at: { x: 1.5, y: 0 } }, to: { at: { x: 1.5, y: 2.5 } }, thickness: 0.1, top: 2.03 });
}

/** The fixture with a loft wall K from (1.0, 3.0) to (2.0, 3.0). */
const kneeDoc = (): Document =>
  withCommands(flushLoftDoc(), { type: "addWall", opId: "k", from: { at: { x: 1, y: 3 } }, to: { at: { x: 2, y: 3 } }, thickness: 0.1, base: LOFT });

function shellAt(doc: Document, loft: boolean): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.01 });
  if (loft) shell.ui({ type: "setViewedLevel", deck: LOFT });
  return shell;
}

function wallTool(doc: Document, loft: boolean): FakeShell {
  const shell = shellAt(doc, loft);
  shell.key("w");
  expect(shell.view().activeTool).toBe("wall");
  expect(viewedLevel(shell.state)?.height).toBe(loft ? 2.15 : 0);
  return shell;
}

function wallState(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "wall") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

/** The chain's origin while drawing. */
function origin(shell: FakeShell): Point | undefined {
  const t = wallState(shell);
  return t.kind === "drawing" ? t.origin : undefined;
}

const newWalls = (before: Document, after: Document): string[] => Object.keys(after.walls).filter((id) => !before.walls[id]);
const close = (p: Point | undefined, q: Point): void => {
  expect(p?.x).toBeCloseTo(q.x, 9);
  expect(p?.y).toBeCloseTo(q.y, 9);
};

describe("the Wall tool at the loft's level", () => {
  it("draws a wall based on the loft; drawn into the shell it ends flush on the inner face, as its ghost showed", () => {
    const shell = wallTool(flushLoftDoc(), true);
    const before = shell.doc();
    shell.click({ x: 1, y: 3 });
    shell.moveTo({ x: 1, y: 3.97 }); // in the north wall's body (y 3.9–4.1)
    close(shell.state.snap?.point, { x: 1, y: 3.9 });
    const t = wallState(shell);
    const preview = t.kind === "drawing" ? t.preview : null;
    if (!preview?.ok) throw new Error("no valid preview");
    const [ghost, ...more] = newWalls(before, preview.doc);
    expect(more).toEqual([]);
    const ghostEnds = ghost ? wallEnds(preview.doc, ghost) : null;
    close(ghostEnds?.b, { x: 1, y: 3.9 });

    shell.click({ x: 1, y: 3.97 });
    const [id, ...others] = newWalls(before, shell.doc());
    expect(others).toEqual([]); // the shell wall is not split
    expect(shell.doc().walls[id ?? ""]).toEqual(expect.objectContaining({ base: LOFT, top: "ceiling" }));
    const ends = wallEnds(shell.doc(), id ?? "");
    close(ends?.a, { x: 1, y: 3 });
    close(ends?.b, ghostEnds?.b ?? { x: 0, y: 0 });
    // The chain goes on from the flushed end, so the next wall starts at the same joint.
    close(origin(shell), { x: 1, y: 3.9 });
  });

  it("a typed length into the shell ends flush, and the chain goes on from the flushed end", () => {
    const shell = wallTool(flushLoftDoc(), true);
    const before = shell.doc();
    shell.click({ x: 2, y: 3 });
    shell.moveTo({ x: 2, y: 3.5 });
    shell.type("1");
    shell.key("Enter");
    const [id] = newWalls(before, shell.doc());
    close(wallEnds(shell.doc(), id ?? "")?.b, { x: 2, y: 3.9 });
    close(origin(shell), { x: 2, y: 3.9 });
  });

  it("doesn't snap to the floor partition's joint or body under the loft, and doesn't join it", () => {
    const shell = wallTool(flushLoftDoc(), true);
    shell.moveTo({ x: 1.52, y: 2.52 });
    expect(shell.state.snap).toMatchObject({ kind: "grid", point: { x: 1.52, y: 2.52 } });
    shell.moveTo({ x: 1.53, y: 2 });
    expect(shell.state.snap?.kind).not.toBe("onWall");
    const before = shell.doc();
    shell.click({ x: 1.5, y: 2.5 });
    shell.click({ x: 2.2, y: 2.5 });
    const [id] = newWalls(before, shell.doc());
    expect(shell.doc().walls[id ?? ""]?.base).toBe(LOFT);
    const partitionEnd = shell.doc().walls[PARTITION]?.b ?? "";
    expect(incidentWalls(shell.doc(), partitionEnd)).toEqual([PARTITION]);
  });

  it("snaps to a loft wall's joint", () => {
    const shell = wallTool(kneeDoc(), true);
    shell.moveTo({ x: 1.02, y: 3.02 });
    expect(shell.state.snap).toMatchObject({ kind: "endpoint", point: { x: 1, y: 3 } });
  });
});

describe("the Wall tool at the floor", () => {
  it("doesn't snap to a loft wall's joint or body", () => {
    const shell = wallTool(kneeDoc(), false);
    shell.moveTo({ x: 1.02, y: 3.02 });
    expect(shell.state.snap).toMatchObject({ kind: "grid", point: { x: 1.02, y: 3.02 } });
    shell.moveTo({ x: 1.5, y: 3.03 });
    expect(shell.state.snap?.kind).not.toBe("onWall");
  });

  it("still snaps to the floor partition's joint", () => {
    const shell = wallTool(flushLoftDoc(), false);
    shell.moveTo({ x: 1.52, y: 2.52 });
    expect(shell.state.snap).toMatchObject({ kind: "endpoint", point: { x: 1.5, y: 2.5 } });
  });
});

describe("a loft wall's joints and drags", () => {
  const kneeA = (doc: Document): string => doc.walls[KNEE]?.a ?? "";

  it("at the loft's level a click on its joint selects the joint, and a drag moves it, not onto the partition's end", () => {
    const shell = shellAt(kneeDoc(), true);
    const joint = kneeA(shell.doc());
    shell.click({ x: 1, y: 3 });
    expect(shell.state.selection).toEqual([{ table: "joints", id: joint }]);
    shell.drag({ x: 1, y: 3 }, { x: 1.52, y: 2.52 });
    expect(shell.doc().joints[joint]).toEqual(expect.objectContaining({ x: 1.52, y: 2.52 }));
    expect(viewedLevel(shell.state)?.height).toBe(2.15);
  });

  it("at the loft's level a drag of the wall moves both its joints", () => {
    const shell = shellAt(kneeDoc(), true);
    shell.click({ x: 1.5, y: 3 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: KNEE }]);
    shell.drag({ x: 1.5, y: 3 }, { x: 1.5, y: 2.8 });
    const ends = wallEnds(shell.doc(), KNEE);
    close(ends?.a, { x: 1, y: 2.8 });
    close(ends?.b, { x: 2, y: 2.8 });
  });

  it("at the floor a click on its joint doesn't select the joint", () => {
    const shell = shellAt(kneeDoc(), false);
    shell.click({ x: 1, y: 3 });
    expect(shell.state.selection.some((r) => r.table === "joints")).toBe(false);
  });

  it("at the floor the partition's joints stay selectable, at the loft's level they don't", () => {
    const floor = shellAt(flushLoftDoc(), false);
    const end = floor.doc().walls[PARTITION]?.b ?? "";
    floor.click({ x: 1.5, y: 2.5 });
    expect(floor.state.selection).toEqual([{ table: "joints", id: end }]);
    const loft = shellAt(flushLoftDoc(), true);
    loft.click({ x: 1.5, y: 2.5 });
    expect(loft.state.selection.some((r) => r.table === "joints")).toBe(false);
  });
});

describe("a piece's contact with a loft wall", () => {
  // A 0.40 × 0.40 piece centred at (1.2, 2.7): its back (y 2.9) 0.05 from K's face (y 2.95), clear of the partition.
  const flushWalls = (level: string | null): readonly string[] => {
    const doc = kneeDoc();
    const at = levelOf(doc, level);
    return contactPlace(doc, "s0", { w: 0.4, d: 0.4 }, { x: 1.2, y: 2.7 }, 0, { tolerance: 0.125, free: false, riser: null, heights: ON_FLOOR, surface: level, land: false, level: at }).flushWalls;
  };

  it("at the floor a piece under the loft doesn't go flush with the loft wall above it", () => {
    expect(flushWalls(null)).toEqual([]);
  });

  it("at the loft's level a piece on the loft goes flush with it", () => {
    expect(flushWalls(LOFT)).toEqual([KNEE]);
  });
});
