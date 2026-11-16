import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { shellBounds } from "../../src/view3d/camera3d";
import { hiddenWalls } from "../../src/view3d/hidden";
import { view3dItems } from "../../src/view3d/items";
import { appearanceOf } from "../../src/view3d/parts";
import { sceneFaces } from "../../src/view3d/scene-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { View3d } from "../../src/view3d/types";
import { roomDoc } from "../builders";
import { turnAngles } from "./visible";

// The scene's faces (real3d.02): every item's faces, unordered, hidden walls left out; the checks the painter's tests
// made that aren't about order (selection, slots, hidden walls, shaped outlines).

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } });

function view(doc: Document, turn = 0, selection: ReadonlySet<string> = new Set()): View3d {
  const bounds = shellBounds(doc);
  if (!bounds) throw new Error("no walls");
  return { items: view3dItems(doc, "s0", null, selection, false), bounds, hidden: hiddenWalls(doc, turnAngles(turn).yaw) };
}

describe("sceneFaces", () => {
  it("selected pieces use the selection blue; others their parts' slot shades", () => {
    const doc = ok(roomDoc(), place("t", "desk", 3, 3.9), place("l", "liftBed", 3, 3.9));
    const faces = sceneFaces(view(doc, 0, new Set(["l/p0"])));
    const colours = (owner: string) => new Set(faces.filter((f) => f.owner === owner).map((f) => f.color));
    const blue = [STYLE_3D.selected.top, STYLE_3D.selected.lit, STYLE_3D.selected.shaded];
    expect(colours("piece/l/p0").size).toBeGreaterThan(0);
    expect([...colours("piece/l/p0")].every((c) => blue.includes(c))).toBe(true);
    const slots = appearanceOf("desk")("standard", 1.2, 0.6, 0.75).flatMap((p) => [p.slot, ...(p.panels ?? []).map((q) => q.slot)]);
    const allowed = new Set(slots.flatMap((slot) => Object.values(STYLE_3D.slots[slot])));
    expect([...colours("piece/t/p0")].every((c) => allowed.has(c))).toBe(true);
  });

  it("hidden walls produce no faces; the others do, at every turn", () => {
    for (const turn of [0, 1, 2, 3] as const) {
      const v = view(roomDoc(), turn);
      const owners = new Set(sceneFaces(v).map((f) => f.owner));
      for (const w of Object.keys(roomDoc().walls)) expect(owners.has(`wall/${w}`), `${w} at ${turn}`).toBe(!v.hidden.has(w));
      expect(v.hidden.size).toBe(2);
    }
  });

  it("a shaped piece draws its outline, not its bounding box", () => {
    const faces = sceneFaces(view(ok(roomDoc(), place("r", "roundTable", 3, 3.9))));
    const top = Math.max(...faces.filter((f) => f.owner === "piece/r/p0").map((f) => f.points.length));
    expect(top).toBeGreaterThan(8);
  });

  it("lists the house only: a scene's ground is left to its owners (look3d, the renderer's own buffers)", () => {
    const v = view(roomDoc());
    const styled: View3d = { ...v, ground: [{ points: [{ x: 0, y: 0, z: -0.005 }, { x: 1, y: 0, z: -0.005 }, { x: 1, y: 1, z: -0.005 }], holes: [], color: "#b9c9a3", owner: "ground/plate", outline: false }] };
    expect(sceneFaces(styled)).toEqual(sceneFaces(v));
  });

  it("lists the floor, the decks and every piece", () => {
    const doc = ok(roomDoc(), { type: "addDeck", opId: "k", preset: "platform", at: { x: 4.5, y: 2 }, w: 2.4, d: 2.2 }, place("t", "desk", 1.5, 3.6));
    const owners = new Set(sceneFaces(view(doc)).map((f) => f.owner));
    expect([...owners].some((o) => o.startsWith("floor/"))).toBe(true);
    expect(owners.has("deck/k/k0")).toBe(true);
    expect(owners.has("piece/t/p0")).toBe(true);
  });
});
