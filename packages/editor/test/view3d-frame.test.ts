import { describe, expect, it } from "vitest";
import { cardFrame3d, view3dFrame } from "../src/view3d-state";
import { shellBounds } from "../src/view3d/camera3d";
import { lookScene3d } from "../src/view3d/look3d";
import { STYLE_3D } from "../src/view3d/style";
import { motifDefaults, type Command } from "@fm/domain";
import { labelledDoc, studioDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The 3D frame keeps its identity while nothing it shows changes (graphics step 03, AC-04): the renderers skip a frame
// they have drawn (step 04), so a new object must mean a new picture and an unchanged picture the same object.

/** The studio (a bed centred at (1.5, 2) by Day, its back edge at y = 3), the 3D view open, the pointer over the floor. */
function open3d(): FakeShell {
  const s = FakeShell.withDocument(studioDoc());
  s.key("3");
  s.moveTo({ x: 4.5, y: 1 });
  return s;
}

function frameOf(s: FakeShell) {
  const f = view3dFrame(s.state);
  if (f === null) throw new Error("the 3D view should be open");
  return f;
}

describe("the 3D frame keeps its identity (graphics step 03, AC-04)", () => {
  it("is the same object across a pan and a zoom", () => {
    const s = open3d();
    const before = frameOf(s);
    s.wheel(40, 25);
    expect(frameOf(s)).toBe(before);
    s.wheel(0, -40, { ctrl: true });
    expect(frameOf(s)).toBe(before);
  });

  it("is the same object across hover and a drag's preview, and new after the release", () => {
    const s = open3d();
    const before = frameOf(s);
    s.moveTo({ x: 0, y: 2 }); // over the left wall
    expect(frameOf(s)).toBe(before);
    s.key("v");
    s.moveTo({ x: 1.5, y: 2 });
    s.down({ x: 1.5, y: 2 });
    const pressed = frameOf(s); // the press selects the bed: a new picture (it draws selected)
    s.moveTo({ x: 2, y: 2 });
    s.moveTo({ x: 2.5, y: 1.8 });
    expect(frameOf(s)).toBe(pressed); // the preview lives in the Scene's document, not the 3D view's
    s.up({ x: 2.5, y: 1.8 });
    const released = frameOf(s);
    expect(released).not.toBe(pressed);
    expect(released.scene.items.some((i) => i.item === "piece" && Math.abs(i.centre.x - 2.5) < 1e-9)).toBe(true);
  });

  it("is the same object for a new but equal selection array", () => {
    const s = open3d();
    s.key("v");
    s.click({ x: 1.5, y: 2 });
    const selected = frameOf(s);
    expect(selected.scene.items.some((i) => i.item === "piece" && i.selected)).toBe(true);
    s.state = { ...s.state, selection: [...s.state.selection].reverse() };
    expect(frameOf(s)).toBe(selected);
  });

  it("is a new object after an edit, a selection change, a turn, a size change and a flip step", () => {
    const s = open3d();
    let last = frameOf(s);
    const changed = (what: string): void => {
      const next = frameOf(s);
      expect(next, what).not.toBe(last);
      last = next;
    };
    s.command({ type: "movePlacement", placementId: "bed/p0", at: { x: 2, y: 3 }, rotation: 0 });
    changed("an edit");
    s.key("v");
    s.click({ x: 2, y: 2 });
    changed("a selection");
    s.key("]");
    changed("a turn");
    s.key("#");
    changed("a size change");
    s.ui({ type: "setActiveState", id: "n/s0" });
    changed("the flip's start");
    s.host.advance(100);
    s.send({ type: "frame", now: s.host.now() });
    changed("a flip step");
  });

  it("is the same object after the view is hidden and shown again", () => {
    const s = open3d();
    const before = frameOf(s);
    s.key("3");
    expect(view3dFrame(s.state)).toBeNull();
    s.key("3");
    expect(frameOf(s)).toBe(before);
  });

  it("is a new object when only the layout, or only one end of a flip, changes", () => {
    const s = open3d();
    const day = frameOf(s);
    s.state = { ...s.state, activeState: "n/s0" };
    const night = frameOf(s);
    expect(night).not.toBe(day);
    s.state = { ...s.state, activeState: "s0", flip: { from: "s0", to: "n/s0", t: 0.5, startedAt: 0 } };
    const flipping = frameOf(s);
    s.state = { ...s.state, flip: { from: "n/s0", to: "n/s0", t: 0.5, startedAt: 0 } };
    const fromChanged = frameOf(s);
    expect(fromChanged).not.toBe(flipping);
    s.state = { ...s.state, flip: { from: "n/s0", to: "s0", t: 0.5, startedAt: 0 } };
    expect(frameOf(s)).not.toBe(fromChanged);
  });

  it("is null while the view is closed", () => {
    const s = FakeShell.withDocument(studioDoc());
    expect(view3dFrame(s.state)).toBeNull();
  });
});

describe("the scene keeps its identity while only the camera turns (real3d.11)", () => {
  /** The view's yaw set directly, as the orbit will (step 08). */
  const atYaw = (s: FakeShell, yaw: number): void => {
    s.state = { ...s.state, view3d: { ...s.state.view3d, yaw } };
  };

  it("a new yaw that hides no other wall keeps the scene; one that crosses a wall's edge-on angle gives a new one", () => {
    const s = open3d();
    atYaw(s, 200);
    const scene = frameOf(s).scene;
    atYaw(s, 260); // still between west (180) and south (270): the same two walls hidden
    expect(frameOf(s).scene).toBe(scene);
    expect(frameOf(s).angles.yaw).toBe(260);
    atYaw(s, 280); // past south's edge-on angle: the east wall's side now faces the camera
    expect(frameOf(s).scene).not.toBe(scene);
  });

  it("a new tilt keeps the scene and gives a new frame", () => {
    const s = open3d();
    const before = frameOf(s);
    s.state = { ...s.state, view3d: { ...s.state.view3d, tilt: 60 } };
    expect(frameOf(s).scene).toBe(before.scene);
    expect(frameOf(s)).not.toBe(before);
  });
});

describe("a full orbit builds a scene only per hide crossing (real3d.11, AC-11)", () => {
  it("over a 360° drag in 2° steps, the distinct scenes are 1 + the times the hidden walls changed", () => {
    const s = open3d();
    const scenes = new Set<unknown>();
    let crossings = 0;
    let hidden = "";
    for (let step = 0; step <= 180; step++) {
      if (step > 0) s.ui({ type: "orbit3d", dx: 5, dy: 0 }); // 2° a step
      const f = frameOf(s);
      const key = [...f.scene.hidden].sort().join(",");
      if (step > 0 && key !== hidden) crossings++;
      hidden = key;
      scenes.add(f.scene);
    }
    expect(crossings).toBe(4); // a rectangle: its hidden pair changes at 0°, 90°, 180° and 270°
    expect(scenes.size).toBe(1 + crossings);
  });
});

describe("the surroundings reach the panel's scene, never a card's (surroundings step 04, AC-02, AC-07)", () => {
  const surroundings = (value: string): Command => ({ type: "setProjectField", key: "surroundings", value });
  const outside = surroundings("outside");

  it("a surroundings edit gives a new scene and frame, and a repeat keeps it", () => {
    const s = open3d();
    const none = frameOf(s);
    expect(none.scene.ground).toBeUndefined();
    s.command(outside);
    const set = frameOf(s);
    expect(set).not.toBe(none);
    expect(set.scene).not.toBe(none.scene);
    expect(set.scene.ground?.length).toBeGreaterThan(0);
    expect(set.scene.background).toBe("#eef3f5");
    expect(set.scene.bounds.pull).toBe(0.88);
    expect(frameOf(s)).toBe(set);
    s.command(outside); // the same value again: no edit, the same picture
    expect(frameOf(s)).toBe(set);
    s.command(surroundings(""));
    const cleared = frameOf(s);
    expect(cleared.scene).not.toBe(set.scene);
    expect([cleared.scene.ground, cleared.scene.background]).toEqual([undefined, undefined]);
    expect(cleared.scene.bounds).toStrictEqual(shellBounds(s.doc()));
  });

  it("with None, the panel frames the walls' box as before this cycle: no pull, no bottom (AC-01)", () => {
    const s = open3d();
    // Against shellBounds, not an earlier frame: a pull at None would be in both frames alike.
    expect(frameOf(s).scene.bounds).toStrictEqual(shellBounds(s.doc()));
  });

  it("a new scene over the same walls keeps the ground: a flip's frames, a selection, an edit that moves no wall", () => {
    const s = FakeShell.withDocument(withCommands(studioDoc(), outside));
    s.key("3");
    const first = frameOf(s).scene;
    const ground = first.ground;
    expect(ground?.length).toBeGreaterThan(0);
    for (const t of [0.25, 0.5]) {
      s.state = { ...s.state, flip: { from: "s0", to: "n/s0", t, startedAt: 0 } };
      expect(frameOf(s).scene, `flip at ${t}`).not.toBe(first);
      expect(frameOf(s).scene.ground, `flip at ${t}`).toBe(ground);
    }
    s.state = { ...s.state, flip: null };
    s.key("v");
    s.click({ x: 1.5, y: 2 }); // selects the bed
    expect(frameOf(s).scene.items.some((i) => i.item === "piece" && i.selected)).toBe(true);
    expect(frameOf(s).scene.ground).toBe(ground);
    s.drag({ x: 1.5, y: 2 }, { x: 2.5, y: 1.8 }); // moves it: an edit, the walls as they were
    expect(frameOf(s).scene.items.some((i) => i.item === "piece" && Math.abs(i.centre.x - 2.5) < 1e-9)).toBe(true);
    expect(frameOf(s).scene.ground).toBe(ground);
    s.command({ type: "setCeiling", height: 2.8 }); // a taller box: a new frame sphere, a new ground
    expect(frameOf(s).scene.ground).not.toBe(ground);
  });

  it("the panel and look frame the same box, ground and background, with and without surroundings (AC-10)", () => {
    for (const [name, doc] of [["None", studioDoc()], ["Outside", withCommands(studioDoc(), outside)]] as const) {
      const s = FakeShell.withDocument(doc);
      s.key("3");
      const panel = frameOf(s).scene;
      const look = lookScene3d(s.doc(), "s0", { yaw: s.state.view3d.yaw, tilt: s.state.view3d.tilt });
      if ("refused" in look) throw new Error(look.refused);
      expect(look.bounds, name).toStrictEqual(panel.bounds);
      expect(look.background, name).toBe(panel.background ?? STYLE_3D.background);
      expect(look.faces.filter((f) => f.owner.startsWith("ground/")), name).toEqual(panel.ground ?? []);
    }
  });

  it("the same doc object gives the panel ground and a card none, and the two scenes differ", () => {
    const s = FakeShell.withDocument(withCommands(studioDoc(), outside));
    s.key("3");
    const doc = s.doc();
    const { yaw, tilt } = s.state.view3d;
    // In turn, as a test can (the app never draws both in one state): the shared memo must not hand one the other's scene.
    for (let round = 0; round < 2; round++) {
      const panel = frameOf(s).scene;
      const card = cardFrame3d(doc, "s0", null, yaw, tilt)?.scene;
      expect(panel.ground?.length, `panel, round ${round}`).toBeGreaterThan(0);
      expect(card?.ground, `card, round ${round}`).toBeUndefined();
      expect(card?.background).toBeUndefined();
      expect(card).not.toBe(panel);
      expect(card?.bounds).not.toEqual(panel.bounds);
    }
  });
});

describe("the Finishes switch reaches the 3D scene (finishes.09, AC-11)", () => {
  it("on, a finished room's floor carries its colour; off, a new scene with the plain floor; the same value keeps the scene", () => {
    const s = FakeShell.withDocument(withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("planks") }));
    s.key("3");
    const colours = () => frameOf(s).scene.items.flatMap((i) => (i.item === "floor" ? [i.color] : []));
    const on = frameOf(s).scene;
    expect(colours()).toContain(motifDefaults("planks").colour);
    s.state = { ...s.state, finishesOn: false };
    const off = frameOf(s).scene;
    expect(off).not.toBe(on);
    expect(colours().length).toBeGreaterThan(0);
    expect(colours().every((c) => c === null)).toBe(true);
    s.state = { ...s.state, finishesOn: false };
    expect(frameOf(s).scene).toBe(off);
  });
});
