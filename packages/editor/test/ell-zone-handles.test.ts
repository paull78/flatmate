import { describe, expect, it } from "vitest";
import { rotateAbout, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { EditorState } from "../src/state";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import { zoneChips } from "../src/view/zone-chips";
import { localState, roomDoc, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// An `L` piece's front zone handles (catalog.11, .13; AC-04), at 80 px/m. A corner desk, arms 0.60, zone 0.80, in
// footprint space (x −w/2…w/2, y −d front … 0 back), the inner corner at (−w/2 + 0.6, −0.6):
//   2.40 × 2.00: the corner (−0.6, −0.6); left strip x −0.6…0.2, y −2.0…−0.6; back strip x −0.6…1.2, y −1.4…−0.6.
//     The union is an L band: the left depth handle on x 0.2 below the back strip (y −2.0…−1.4, middle −1.7), the back
//     one on y −1.4 right of the left strip (x 0.2…1.2, middle 0.7); end handles at (−0.2, −2.0) and (1.2, −1.0); the
//     "×" 80 px (1.0 m) out from the back inner edge through the back depth handle, at (0.7, −1.6).
//   1.60 × 1.20: the corner (−0.2, −0.6); the left strip (y −1.2…−0.6) lies inside the back strip (x −0.2…0.8,
//     y −1.4…−0.6): one depth handle at (0.3, −1.4), the back end handle at (0.8, −1.0), the "×" at (0.3, −1.6).

const ZOOM = 80;
const K: EntityRef = { table: "placements", id: "k/p0" };
const place = (at: Point, rotation: number): Command => ({ type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "cornerDesk" }, at, rotation });
const BIG: Command = { type: "setObjectSize", objectId: "k/o0", w: 2.4, d: { standard: 2 } };
const near = (p: Point) => ({ x: expect.closeTo(p.x, 9), y: expect.closeTo(p.y, 9) });

function selecting(doc: Document): EditorState {
  const s = localState(new FakeHost(), doc);
  return { ...s, selection: [K], camera: { ...s.camera, zoom: ZOOM } };
}
const zoneHandles = (state: EditorState, doc: Document) => handles(state, doc).filter((h) => h.kind === "zoneDepth" || h.kind === "zoneEnd");
/** Footprint-space points and directions of the desk anchored at `at`, turned `rotation`, in the world. */
const frame = (at: Point, rotation: number) => ({
  world: (x: number, y: number): Point => near(rotateAbout({ x: at.x + x, y: at.y + y }, at, rotation)),
  dir: (x: number, y: number): Point => near(rotateAbout({ x, y }, { x: 0, y: 0 }, rotation)),
});

describe("an L piece's front zone handles (AC-04)", () => {
  it.each([
    [0, { x: 3, y: 3.9 }], // x 1.8–4.2, y 1.9–3.9
    [90, { x: 0.1, y: 2 }], // its back on the left wall: x 0.1–2.1, y 0.8–3.2
  ])("2.40 × 2.00 at %i°: a depth handle on each strip's visible outer line, an end handle at each far end, the × beyond the back one", (rotation, at) => {
    const doc = withCommands(roomDoc(), place(at, rotation), BIG);
    const { world, dir } = frame(at, rotation);
    const state = selecting(doc);
    expect(zoneHandles(state, doc)).toEqual([
      { kind: "zoneDepth", placementId: "k/p0", side: "front", strip: 0, at: world(0.2, -1.7), normal: dir(1, 0), hittable: true },
      { kind: "zoneEnd", placementId: "k/p0", side: "front", strip: 0, end: "start", at: world(-0.2, -2), along: dir(0, 1), hittable: true },
      { kind: "zoneDepth", placementId: "k/p0", side: "front", strip: 1, at: world(0.7, -1.4), normal: dir(0, -1), hittable: true },
      { kind: "zoneEnd", placementId: "k/p0", side: "front", strip: 1, end: "end", at: world(1.2, -1), along: dir(1, 0), hittable: true },
    ]);
    expect(zoneChips(state, doc)).toEqual([
      { placementId: "k/p0", side: "front", on: true, at: world(0.7, -1.6) },
      ...["back", "left", "right"].map((side) => ({ placementId: "k/p0", side, on: false, at: expect.anything() })),
    ]);
  });

  it("1.60 × 1.20: the left strip lies inside the back strip: one depth handle and the back strip's end handle", () => {
    const doc = withCommands(roomDoc(), place({ x: 3, y: 3.9 }, 0));
    const { world, dir } = frame({ x: 3, y: 3.9 }, 0);
    const state = selecting(doc);
    expect(zoneHandles(state, doc)).toEqual([
      { kind: "zoneDepth", placementId: "k/p0", side: "front", strip: 1, at: world(0.3, -1.4), normal: dir(0, -1), hittable: true },
      { kind: "zoneEnd", placementId: "k/p0", side: "front", strip: 1, end: "end", at: world(0.8, -1), along: dir(1, 0), hittable: true },
    ]);
    expect(zoneChips(state, doc)[0]).toEqual({ placementId: "k/p0", side: "front", on: true, at: world(0.3, -1.6) });
  });

  it("a shallow zone seen from afar shows only its ×, kept 16 px along from the inner corner, clear of the left arm grip (catalog.38)", () => {
    // 0.70 × 1.12 at (3, 3.9): the corner (3.25, 3.3); front zone 0.10 deep, start 0.42: both strips 0.10 long. At
    // 100 px/m the × sits 26 px out from the back inner edge (y 3.04), level with the left arm grip at (3.25, 3.04);
    // the middle of the back strip's outer line is only 5 px along, so the × goes 16 px along, to x 3.41.
    const doc = withCommands(
      roomDoc(), place({ x: 3, y: 3.9 }, 0),
      { type: "setObjectSize", objectId: "k/o0", w: 0.7, d: { standard: 1.12 } },
      { type: "setZoneExtent", placementId: "k/p0", side: "front", extent: { depth: 0.1, start: 0.42, end: 0 } },
    );
    const s = selecting(doc);
    const state: EditorState = { ...s, camera: { ...s.camera, zoom: 100 } };
    expect(zoneHandles(state, doc)).toEqual([]);
    expect(zoneChips(state, doc)[0]?.at).toEqual(near({ x: 3.41, y: 3.04 }));
    expect(handles(state, doc).find((h) => h.kind === "armGrip" && h.arm === "left")?.at).toEqual(near({ x: 3.25, y: 3.04 }));
  });
});

describe("dragging an L piece's zone handles (AC-04)", () => {
  /** The 2.40 × 2.00 desk at (3, 3.9), selected by a click on its back arm. */
  function selected(...more: Command[]): FakeShell {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place({ x: 3, y: 3.9 }, 0), BIG, ...more));
    shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom: ZOOM } };
    shell.click({ x: 3, y: 3.6 });
    return shell;
  }
  const zones = (shell: FakeShell) => {
    const z = shell.doc().placements["k/p0"]?.zones;
    return [z?.frontDepth, z?.frontStart, z?.frontEnd];
  };
  /** Drags with Ctrl (to the cm, no snap) and returns the target while moving. */
  function drag(shell: FakeShell, from: Point, to: Point) {
    shell.moveTo(from, { ctrl: true });
    shell.down(from, { ctrl: true });
    shell.moveTo(to, { ctrl: true });
    const tool = shell.state.tool;
    const target = tool.name === "select" && tool.state.kind === "moving" ? tool.state.target : null;
    shell.up(to, { ctrl: true });
    return target;
  }

  it.each([
    ["left", { x: 3.2, y: 2.2 }, { x: 3.27, y: 2.2 }, 0],
    ["back", { x: 3.7, y: 2.5 }, { x: 3.7, y: 2.43 }, 1],
  ])("the %s strip's depth handle drags the one depth, once, in one undo step", (_, from, to, strip) => {
    const shell = selected();
    const past = shell.state.undo.past.length;
    expect(drag(shell, from, to)).toEqual({ kind: "zoneDepth", placementId: "k/p0", side: "front", strip });
    expect(shell.view().toast).toBeNull();
    expect(zones(shell)).toEqual([0.87, 0, 0]);
    expect(shell.state.undo.past).toHaveLength(past + 1);
    shell.key("z", { meta: true });
    expect(zones(shell)).toEqual([null, null, null]);
  });

  const trimmed: Command = { type: "setZoneExtent", placementId: "k/p0", side: "front", extent: { depth: 0.8, start: 0.3, end: 0.5 } };
  it.each([
    ["left strip's (start)", [], { x: 2.8, y: 1.9 }, { x: 2.8, y: 2.2 }, [0.8, 0.3, 0]],
    ["back strip's (end)", [], { x: 4.2, y: 2.9 }, { x: 3.9, y: 2.9 }, [0.8, 0, 0.3]],
    // Past the inner corner: the left strip keeps 0.10 of its 1.40, whatever the back strip's trim.
    ["left strip's, the back one trimmed,", [trimmed], { x: 2.8, y: 2.2 }, { x: 2.8, y: 3.5 }, [0.8, 1.3, 0.5]],
    ["back strip's, the left one trimmed,", [trimmed], { x: 3.7, y: 2.9 }, { x: 2, y: 2.9 }, [0.8, 0.3, 1.7]],
  ])("the %s end handle trims from its far end, in one undo step", (_, pre, from, to, expected) => {
    const shell = selected(...pre);
    const past = shell.state.undo.past.length;
    expect(drag(shell, from, to)?.kind).toBe("zoneEnd");
    expect(zones(shell)).toEqual(expected.map((v) => expect.closeTo(v, 12))); // a strip stopped at 0.10: 1.4 − 0.1 in floats
    expect(shell.state.undo.past).toHaveLength(past + 1);
  });

  it("the × turns the zone off in one undo step", () => {
    const shell = selected();
    const past = shell.state.undo.past.length;
    shell.click({ x: 3.7, y: 2.3 });
    expect(shell.doc().placements["k/p0"]?.sides.front).toBe(false);
    expect(shell.state.selection).toEqual([K]);
    expect(shell.state.undo.past).toHaveLength(past + 1);
    shell.key("z", { meta: true });
    expect(shell.doc().placements["k/p0"]?.sides.front).toBe(true);
  });

  it("the zone draws as one six-segment outline, and one amber ring when a piece stands in a strip", () => {
    const shell = selected({ type: "placeObject", deck: null, opId: "n", state: "s0", object: { kind: "nightstand" }, at: { x: 2.9, y: 2.4 } });
    const layer = (name: string) => shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
    expect(layer("overlays").filter((p) => p.kind === "segment" && p.color === COLORS.zoneOutline)).toHaveLength(6);
    const amber = layer("warnings").filter((p) => p.kind === "polygon" && p.color === COLORS.warning);
    expect(amber.map((p) => (p.kind === "polygon" ? p.points.length : 0))).toEqual([6]);
  });
});
