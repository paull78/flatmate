import { describe, expect, it } from "vitest";
import { emptyDocument, execute, motifDefaults, unwrap, type Command, type Document } from "@fm/domain";
import { DEFAULT_ANGLES, shellBounds } from "../../src/view3d/camera3d";
import { hiddenWalls } from "../../src/view3d/hidden";
import { view3dItems } from "../../src/view3d/items";
import { lookScene3d } from "../../src/view3d/look3d";
import { sceneFaces } from "../../src/view3d/scene-faces";
import { STYLE_3D } from "../../src/view3d/style";
import { labelledDoc, roomDoc, wallBetween, withCommands } from "../builders";

// Claude's look in 3D (heights.20, .32, decks.07; real3d.11): the editor gives the faces, the camera and the caption;
// the MCP draws them with raster3d.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

describe("lookScene3d", () => {
  it("lists a deck's faces: the loft's top in the deck colour at its corners; carries the bounds and the angles", () => {
    const doc = ok(roomDoc(), { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 } });
    const scene = lookScene3d(doc, "s0", DEFAULT_ANGLES);
    if ("refused" in scene) throw new Error(scene.refused);
    const bounds = shellBounds(doc);
    if (!bounds) throw new Error("no bounds");
    expect(scene.angles).toEqual(DEFAULT_ANGLES);
    expect(scene.bounds).toEqual(bounds);
    expect(scene.background).toBe(STYLE_3D.background);
    expect(scene.edge).toBe(STYLE_3D.edge);
    const corners = [{ x: 2, y: 1.3 }, { x: 4, y: 1.3 }, { x: 4, y: 2.7 }, { x: 2, y: 2.7 }];
    const atCorners = (pts: readonly { x: number; y: number; z: number }[]) => pts.length === 4 && corners.every((c) => pts.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 1e-9 && Math.abs(p.z - 2.15) < 1e-9));
    expect(scene.faces.filter((f) => f.color === STYLE_3D.deck.top && atCorners(f.points))).toHaveLength(1);
    expect(scene.caption).toMatch(/^3D view of Layout, yaw 225°, tilt 35°/);
  });

  it("picks the state: the lift bed's faces are high by Day and low at Night", () => {
    const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", linked: false, deck: null, opId, state: "s0", object: { kind }, at: { x, y } });
    const doc = ok(roomDoc(), place("t", "desk", 3, 3.9), place("l", "liftBed", 3, 3.9), { type: "addState", opId: "n", name: "Night" },
      { type: "placeObject", linked: false, deck: null, opId: "l2", state: "n/s0", object: { existing: "l/o0" }, at: { x: 3, y: 3.9 }, config: "down" });
    const bedTop = (state: string): number => {
      const scene = lookScene3d(doc, state, DEFAULT_ANGLES);
      if ("refused" in scene) throw new Error(scene.refused);
      return Math.max(...scene.faces.filter((f) => f.owner.startsWith("piece/l")).flatMap((f) => f.points.map((p) => p.z)));
    };
    expect(bedTop("s0")).toBeGreaterThan(bedTop("n/s0"));
  });

  it("hides the walls facing the camera's side: from the north-east, the north and east walls", () => {
    const doc = roomDoc();
    const scene = lookScene3d(doc, "s0", { yaw: 45, tilt: 35 });
    if ("refused" in scene) throw new Error(scene.refused);
    const north = wallBetween(doc, { x: 0, y: 4 }, { x: 6, y: 4 });
    const east = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const owners = new Set(scene.faces.map((f) => f.owner));
    expect([owners.has(`wall/${north}`), owners.has(`wall/${east}`)]).toEqual([false, false]);
    expect(owners.size).toBeGreaterThan(2);
  });

  it("refuses a tilt outside its range, with the range; takes the yaw round the circle (AC-07)", () => {
    for (const tilt of [9.9, 90.1, -35]) expect(lookScene3d(roomDoc(), "s0", { yaw: 225, tilt })).toEqual({ refused: "The tilt is 10 to 90 degrees" });
    const scene = lookScene3d(roomDoc(), "s0", { yaw: -135, tilt: 35 });
    expect("refused" in scene ? scene.refused : scene.angles).toEqual({ yaw: 225, tilt: 35 });
  });

  it("refuses without walls and for an unknown state", () => {
    expect(lookScene3d(emptyDocument(), "s0", DEFAULT_ANGLES)).toEqual({ refused: "Nothing to look at in 3D yet: draw some walls" });
    expect(lookScene3d(roomDoc(), "nope", DEFAULT_ANGLES)).toEqual({ refused: "No layout state has the id nope" });
  });

  it("draws finishes (look has no switch): a planks room's floor face in its colour with its lines", () => {
    const doc = ok(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("planks") });
    const scene = lookScene3d(doc, "s0", DEFAULT_ANGLES);
    if ("refused" in scene) throw new Error(scene.refused);
    const floor = scene.faces.find((f) => f.owner.startsWith("floor/") && f.color === motifDefaults("planks").colour);
    expect(floor?.lines?.length).toBeGreaterThan(10);
  });

  const CAPTION = "3D view of Layout, yaw 225°, tilt 35°; shell walls facing the camera are hidden, the ceiling is not drawn";
  const surroundings = (doc: Document, value: string): Document => withCommands(doc, { type: "setProjectField", key: "surroundings", value });

  it("no row: lookScene3d's faces, bounds and background equal today's (AC-01)", () => {
    const doc = ok(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "t", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 3.6 } });
    for (const d of [doc, surroundings(surroundings(doc, "outside"), "")]) {
      const scene = lookScene3d(d, "s0", DEFAULT_ANGLES);
      if ("refused" in scene) throw new Error(scene.refused);
      expect(scene.faces).toEqual(sceneFaces({ items: view3dItems(d, "s0", null, new Set(), true), hidden: hiddenWalls(d, 225) }));
      expect(scene.bounds).toEqual(shellBounds(d));
      expect([scene.background, scene.edge, scene.caption]).toEqual([STYLE_3D.background, STYLE_3D.edge, CAPTION]);
    }
  });

  it("Outside: the house's faces as they were with the ground's added, the bounds pulled to 0.88, the sky, and the caption naming Outside (AC-05)", () => {
    const none = lookScene3d(roomDoc(), "s0", DEFAULT_ANGLES);
    const scene = lookScene3d(surroundings(roomDoc(), "outside"), "s0", DEFAULT_ANGLES);
    if ("refused" in scene || "refused" in none) throw new Error("refused");
    const ground = scene.faces.filter((f) => f.owner.startsWith("ground/"));
    expect(ground.length).toBeGreaterThan(0);
    expect(scene.faces).toEqual([...ground, ...none.faces]); // the ground first, as the panel draws it
    expect(scene.bounds).toEqual({ ...none.bounds, pull: 0.88 });
    expect([scene.background, scene.edge]).toEqual(["#eef3f5", STYLE_3D.edge]);
    expect(scene.caption.startsWith(CAPTION)).toBe(true);
    expect(scene.caption).toMatch(/Outside/);
    expect(none.caption).not.toMatch(/Outside|surroundings/i);
  });
});
