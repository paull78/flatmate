import { describe, expect, it } from "vitest";
import type { Command, Document, EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { EditorState } from "../src/state";
import { idleTool } from "../src/tools/types";
import { handles } from "../src/view/handles";
import { jointAt, localState, roomDoc, sofaBed200, wallBetween, withCommands } from "./builders";
import { FakeHost } from "./fake-shell";

const near = (x: number, y: number) => ({ x: expect.closeTo(x, 9), y: expect.closeTo(y, 9) });
const at = (p: Point | undefined) => (p ? { x: +p.x.toFixed(9), y: +p.y.toFixed(9) } : null);

/** The Select tool, idle, at `zoom` with `selection` on `doc`. */
function selecting(doc: Document, selection: EntityRef[], zoom = 80): EditorState {
  const s = localState(new FakeHost(), doc);
  return { ...s, selection, camera: { ...s.camera, zoom } };
}

const piece = (id: string): EntityRef => ({ table: "placements", id });
const sofa: Command = { type: "placeObject", linked: false, deck: null, opId: "sofa", state: "s0", object: { kind: "sofaBed" }, at: { x: 2, y: 3 } };
const chair: Command = { type: "placeObject", linked: false, deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2.25 } };

// One handle list for drawing and hit-testing (arch-review R-07): a selected wall's two joints, drawn and hittable,
// endpoint a fixed; a selected joint, drawn but not hittable; only the first selected wall is hittable. One selected
// piece of furniture in the Select tool has four side grips and a rotation grip (direct.03, AC-01).
describe("handles", () => {
  const doc = roomDoc();
  const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
  const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
  const a = doc.walls[bottom]?.a ?? "";
  const b = doc.walls[bottom]?.b ?? "";

  it("a selected wall: both joints, a fixed, both hittable", () => {
    expect(handles(selecting(doc, [{ table: "walls", id: bottom }]), doc)).toEqual([
      { kind: "joint", joint: a, at: { x: doc.joints[a]?.x, y: doc.joints[a]?.y }, fixed: true, hittable: true },
      { kind: "joint", joint: b, at: { x: doc.joints[b]?.x, y: doc.joints[b]?.y }, fixed: false, hittable: true },
    ]);
  });

  it("a selected joint: drawn, not hittable", () => {
    const corner = jointAt(doc, { x: 6, y: 4 });
    expect(handles(selecting(doc, [{ table: "joints", id: corner }]), doc)).toEqual([{ kind: "joint", joint: corner, at: { x: 6, y: 4 }, fixed: false, hittable: false }]);
  });

  it("a group of walls shows no joint handles: a press on it drags the group (straight.09)", () => {
    const hs = handles(selecting(doc, [{ table: "walls", id: bottom }, { table: "walls", id: right }]), doc);
    expect(hs).toEqual([]);
  });

  it("nothing for a zone label", () => {
    expect(handles(selecting(doc, [{ table: "zoneLabels", id: "L1" }]), doc)).toEqual([]);
  });

  it("one selected placement in the Select tool: four side grips on the side midpoints, a rotation grip 24 px beyond the front edge, then its zone handles", () => {
    const d = withCommands(doc, sofa, sofaBed200("sofa/o0")); // x 1–3, y 2.1–3
    expect(handles(selecting(d, [piece("sofa/p0")]), d)).toEqual([
      { kind: "side", placementId: "sofa/p0", side: "right", at: near(3, 2.55), normal: near(1, 0), hittable: true },
      { kind: "side", placementId: "sofa/p0", side: "left", at: near(1, 2.55), normal: near(-1, 0), hittable: true },
      { kind: "side", placementId: "sofa/p0", side: "front", at: near(2, 2.1), normal: near(0, -1), hittable: true },
      { kind: "side", placementId: "sofa/p0", side: "back", at: near(2, 3), normal: near(0, 1), hittable: true },
      { kind: "rotate", placementId: "sofa/p0", at: near(2, 1.8), hittable: true },
      // The front zone, 0.5 m = 40 px deep and 160 px long: its depth handle 40 px out, 16 px from the rotation grip;
      // its end handles halfway across, 20 px out, 80 px along from the grip.
      { kind: "zoneDepth", placementId: "sofa/p0", side: "front", at: near(2, 1.6), normal: near(0, -1), hittable: true },
      { kind: "zoneEnd", placementId: "sofa/p0", side: "front", end: "start", at: near(1, 1.85), along: near(1, 0), hittable: true },
      { kind: "zoneEnd", placementId: "sofa/p0", side: "front", end: "end", at: near(3, 1.85), along: near(1, 0), hittable: true },
    ]);
  });

  it("a small object's grips sit 8 px outside its edges", () => {
    const d = withCommands(doc, chair); // x 2.775–3.225, y 1.8–2.25
    const grips = (zoom: number) => handles(selecting(d, [piece("chair/p0")], zoom), d).flatMap((h) => (h.kind === "side" ? [[h.side, at(h.at)]] : []));
    expect(grips(50)).toEqual([ // 22.5 px < 32 on both axes
      ["right", { x: 3.385, y: 2.025 }],
      ["left", { x: 2.615, y: 2.025 }],
      ["front", { x: 3, y: 1.64 }],
      ["back", { x: 3, y: 2.41 }],
    ]);
    expect(grips(80)[0]).toEqual(["right", { x: 3.225, y: 2.025 }]); // 36 px ≥ 32: on the edge
  });

  it("per axis: a folded folding table (1.2 × 0.15) at zoom 80 keeps its left/right grips on the edges and moves front/back 0.1 m out", () => {
    const d = withCommands(doc, { type: "placeObject", linked: false, deck: null, opId: "t", state: "s0", object: { kind: "foldingTable" }, at: { x: 3, y: 2 } }); // x 2.4–3.6, y 1.85–2
    const grips = handles(selecting(d, [piece("t/p0")]), d).flatMap((h) => (h.kind === "side" ? [[h.side, at(h.at)]] : []));
    expect(grips).toEqual([
      ["right", { x: 3.6, y: 1.925 }],
      ["left", { x: 2.4, y: 1.925 }],
      ["front", { x: 3, y: 1.75 }],
      ["back", { x: 3, y: 2.1 }],
    ]);
  });

  it("no grips for a group, another layout's placement, another tool, or a drag in progress", () => {
    const d = withCommands(doc, sofa, { ...chair, at: { x: 4.5, y: 1.5 } });
    expect(handles(selecting(d, [piece("sofa/p0"), piece("chair/p0")]), d)).toEqual([]);
    const two = withCommands(
      roomDoc(),
      { type: "addState", opId: "n", name: "Night" },
      sofa,
      { type: "placeObject", linked: false, deck: null, opId: "s2", state: "n/s0", object: { existing: "sofa/o0" }, at: { x: 4, y: 2 } },
    );
    expect(handles(selecting(two, [piece("s2/p0")]), two)).toEqual([]); // the active layout is s0
    expect(handles({ ...selecting(d, [piece("sofa/p0")]), tool: idleTool("object") }, d)).toEqual([]);
    const s = selecting(d, [piece("sofa/p0")]);
    const moving: EditorState = {
      ...s,
      tool: {
        name: "select",
        state: {
          kind: "moving", turn: 0, target: { kind: "placement", placementId: "sofa/p0" }, pressWorld: { x: 2, y: 2.55 }, baseDoc: d,
          attempt: { ok: true, doc: d, cursor: { x: 2, y: 2.55 }, tried: { kind: "none" }, blocked: [], dependencies: [], guides: [] },
        },
      },
    };
    expect(handles(moving, d)).toEqual([]);
  });

  it("grips stay while a selected piece is pressed, before the drag starts", () => {
    const d = withCommands(doc, sofa);
    const s = selecting(d, [piece("sofa/p0")]);
    const pressing: EditorState = {
      ...s,
      tool: { name: "select", state: { kind: "pressing", pressWorld: { x: 2, y: 2.55 }, target: { kind: "placement", placementId: "sofa/p0" }, clickSelection: null } },
    };
    expect(handles(pressing, d)).toHaveLength(8); // the default sofa bed (2.1 × 0.9): five grips and three front-zone handles
  });
});
