import { describe, expect, it } from "vitest";
import { rotateAbout, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { EditorState } from "../src/state";
import { hitTest } from "../src/tools/hit-test";
import { handles, type Handle } from "../src/view/handles";
import { localState, roomDoc, withCommands } from "./builders";
import { FakeHost } from "./fake-shell";

// An `L` piece's grips (catalog.12, step 07): the back and left side grips on their sides' middles, the right grip on
// the middle of the back arm's right end, the front grip on the middle of the left arm's front end, the rotation grip
// 24 px beyond the front grip, and an arm grip on the middle of each arm's inner edge, its normal into the empty
// quarter. The corner desk is 1.60 × 1.20 with arms 0.60. In footprint space (x −0.8…0.8, y −1.2 front … 0 back) the
// empty quarter is x −0.2…0.8, y −1.2…−0.6.

const ZOOM = 80;
const place = (at: Point, rotation: number): Command => ({ type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "cornerDesk" }, at, rotation });
const near = (p: Point) => ({ x: expect.closeTo(p.x, 9), y: expect.closeTo(p.y, 9) });

function selecting(doc: Document, selection: EntityRef[]): EditorState {
  const s = localState(new FakeHost(), doc);
  return { ...s, selection, camera: { ...s.camera, zoom: ZOOM } };
}

/** The grips expected for the desk anchored at `at`, turned `rotation`: footprint-space spots placed in the world. */
function expected(at: Point, rotation: number) {
  const world = (x: number, y: number): Point => near(rotateAbout({ x: at.x + x, y: at.y + y }, at, rotation));
  const dir = (x: number, y: number): Point => near(rotateAbout({ x, y }, { x: 0, y: 0 }, rotation));
  const id = "k/p0";
  return [
    { kind: "side", placementId: id, side: "right", at: world(0.8, -0.3), normal: dir(1, 0), hittable: true },
    { kind: "side", placementId: id, side: "left", at: world(-0.8, -0.6), normal: dir(-1, 0), hittable: true },
    { kind: "side", placementId: id, side: "front", at: world(-0.5, -1.2), normal: dir(0, -1), hittable: true },
    { kind: "side", placementId: id, side: "back", at: world(0, 0), normal: dir(0, 1), hittable: true },
    { kind: "rotate", placementId: id, at: world(-0.5, -1.2 - 24 / ZOOM), hittable: true },
    { kind: "armGrip", placementId: id, arm: "back", at: world(0.3, -0.6), normal: dir(0, -1), hittable: true },
    { kind: "armGrip", placementId: id, arm: "left", at: world(-0.2, -0.9), normal: dir(1, 0), hittable: true },
  ];
}

/** Whether `p` lies strictly inside the empty quarter of the desk anchored at `at`, turned `rotation`. */
function inQuarter(p: Point, at: Point, rotation: number): boolean {
  const local = rotateAbout(p, at, -rotation);
  const x = local.x - at.x;
  const y = local.y - at.y;
  return x > -0.2 + 1e-6 && x < 0.8 - 1e-6 && y > -1.2 + 1e-6 && y < -0.6 - 1e-6;
}

const grips = (hs: readonly Handle[]) => hs.filter((h) => h.kind === "side" || h.kind === "rotate" || h.kind === "armGrip");

describe("an L piece's grips (catalog.12)", () => {
  it.each([
    [0, { x: 3, y: 3.9 }], // x 2.2–3.8, y 2.7–3.9
    [90, { x: 0.1, y: 2 }], // its back on the left wall: x 0.1–1.3, y 1.2–2.8
  ])("at %i°: side grips at the arm ends, rotation beyond the front grip, arm grips on the inner edges, none in the empty quarter", (rotation, at) => {
    const doc = withCommands(roomDoc(), place(at, rotation));
    const hs = grips(handles(selecting(doc, [{ table: "placements", id: "k/p0" }]), doc));
    expect(hs).toEqual(expected(at, rotation));
    expect(hs.filter((h) => inQuarter(h.at, at, rotation))).toEqual([]);
  });

  it("a hit near an arm grip, on the piece's body, picks the arm grip", () => {
    const doc = withCommands(roomDoc(), place({ x: 3, y: 3.9 }, 0));
    const state = selecting(doc, [{ table: "placements", id: "k/p0" }]);
    expect(hitTest(state, { x: 3.3, y: 3.33 })?.handle).toEqual({ kind: "armGrip", placementId: "k/p0", arm: "back" });
    expect(hitTest(state, { x: 2.77, y: 3 })?.handle).toEqual({ kind: "armGrip", placementId: "k/p0", arm: "left" });
    expect(hitTest(state, { x: 3, y: 3.6 })?.handle).toBeNull(); // the back arm's body itself
  });
});
