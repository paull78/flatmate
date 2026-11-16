import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document, type ObjectOptions } from "@fm/domain";
import { view3dItems } from "../../src/view3d/items";
import { lookScene3d } from "../../src/view3d/look3d";
import { appearanceOf } from "../../src/view3d/parts";
import { partSolids } from "../../src/view3d/parts/solids";
import type { Part } from "../../src/view3d/parts/types";
import { STYLE_3D } from "../../src/view3d/style";
import type { PieceItem } from "../../src/view3d/types";
import { roomDoc } from "../builders";

// "With computer" in 3D (AC-09, seating.12): a monitor panel about 0.35 m tall on a foot, a keyboard 0.02 m thick and
// a mouse, standing on the desk's top in the dark and metal slots, where the plan draws them. The local frame runs y
// from the front (−d/2) to the back (+d/2); the plan's footprint y (−d … 0) is the local y − d/2.

const ON: ObjectOptions = { computer: true }; // the object's options (library.10)
const OFF = {};
const EPS = 1e-9;

const boxes = (parts: readonly Part[]) => parts.flatMap((p) => (p.shape === "box" ? [p.at] : []));
/** The parts a computer adds: every part of the piece with it on that the plain piece hasn't, which keeps all of its own. */
function gearOf(kind: string, w: number, d: number, h: number): Part[] {
  const key = (p: Part) => JSON.stringify(p);
  const plain = appearanceOf(kind)("standard", w, d, h);
  const on = appearanceOf(kind)("standard", w, d, h, ON);
  const own = new Set(plain.map(key));
  expect(on.filter((p) => own.has(key(p)))).toEqual(plain);
  return on.filter((p) => !own.has(key(p)));
}

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const pieceIn = (doc: Document, placement: string): PieceItem | undefined =>
  view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece" && i.placement === placement);

describe("the computer in 3D (AC-09, seating.12)", () => {
  it("3D parts add a monitor, keyboard, mouse when on, on the desk's top in the dark and metal slots", () => {
    const gear = gearOf("desk", 1.2, 0.6, 0.75);
    expect(gear.length).toBeGreaterThanOrEqual(4);
    expect(new Set(gear.map((p) => p.slot))).toEqual(new Set(["dark", "metal"]));
    const at = boxes(gear);
    expect(at).toHaveLength(gear.length);
    expect(Math.min(...at.map((b) => b.z0))).toBeCloseTo(0.75, 9); // standing on the top
    const monitor = at.reduce((a, b) => (b.z1 - b.z0 > a.z1 - a.z0 ? b : a));
    expect(monitor.z1 - monitor.z0).toBeCloseTo(0.35, 2);
    expect([monitor.x0, monitor.x1, monitor.y0, monitor.y1]).toEqual([-0.275, 0.275, 0.3 - 0.13, 0.3 - 0.09].map((v) => expect.closeTo(v, 9)));
    const keyboard = at.find((b) => Math.abs(b.x1 - b.x0 - 0.44) < EPS);
    expect(keyboard && keyboard.z1 - keyboard.z0).toBeCloseTo(0.02, 9);
    expect(keyboard && (keyboard.y0 + keyboard.y1) / 2).toBeCloseTo(0.3 - 0.6 * 0.62, 9);
    expect(at.some((b) => Math.abs(b.x0 - 0.3) < EPS && Math.abs(b.x1 - 0.36) < EPS), "the mouse right of the keyboard").toBe(true);
  });

  it("no gear when off, nor for a kind without the column", () => {
    expect(appearanceOf("desk")("standard", 1.2, 0.6, 0.75, OFF)).toEqual(appearanceOf("desk")("standard", 1.2, 0.6, 0.75));
    expect(appearanceOf("chair")("standard", 0.45, 0.45, 0.9, ON)).toEqual(appearanceOf("chair")("standard", 0.45, 0.45, 0.9));
  });

  it("the gear lies on the desk's top, inside its plan, at 0.60–3 m wide and 0.40–1 m deep", () => {
    const bad: string[] = [];
    for (let w = 0.6; w <= 3 + EPS; w += 0.3) {
      for (let d = 0.4; d <= 1 + EPS; d += 0.1) {
        for (const b of boxes(gearOf("desk", w, d, 0.75))) {
          if (b.x0 < -w / 2 - EPS || b.x1 > w / 2 + EPS || b.y0 < -d / 2 - EPS || b.y1 > d / 2 + EPS || b.z0 < 0.75 - EPS) bad.push(`${w.toFixed(2)} × ${d.toFixed(2)}`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("the desk with chair puts the gear on its desk part's top", () => {
    const gear = gearOf("deskSet", 1.2, 0.7, 0.9);
    const desk = gearOf("desk", 1.2, 0.6, 0.75);
    expect(gear).toHaveLength(desk.length);
    // The desk part is the back 0.60 m: local y from −0.30 to 0.35, its top at 0.75.
    const shift = (b: { y0: number; y1: number }) => [b.y0 + 0.05, b.y1 + 0.05];
    expect(boxes(gear).map((b) => [b.y0, b.y1, b.z0])).toEqual(boxes(desk).map((b) => [...shift(b), b.z0].map((v) => expect.closeTo(v, 9))));
  });

  it("the computer still draws through options: the piece item carries the object's options, and its solids add the gear", () => {
    const off = ok(roomDoc(), { type: "placeObject", deck: null, opId: "t", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 3.9 } });
    const on = ok(off, { type: "setOption", objectId: "t/o0", option: "computer", on: true });
    const [a, b] = [pieceIn(off, "t/p0"), pieceIn(on, "t/p0")];
    if (!a || !b) throw new Error("the desk is in the scene");
    expect(a.options).toBeUndefined();
    expect(b.options).toEqual({ computer: true });
    expect(partSolids("o", b, STYLE_3D).length).toBe(partSolids("o", a, STYLE_3D).length + gearOf("desk", 1.2, 0.6, 0.75).length);
    // Claude's 3D look draws it too: each gear box adds its faces (six, less any its prism leaves out).
    const faces = (doc: Document) => {
      const scene = lookScene3d(doc, "s0", { yaw: 225, tilt: 35 });
      if ("refused" in scene) throw new Error(scene.refused);
      return scene.faces.filter((f) => f.owner === "piece/t/p0").length;
    };
    expect(faces(on)).toBeGreaterThan(faces(off));
  });
});
