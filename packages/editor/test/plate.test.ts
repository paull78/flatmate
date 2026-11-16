import { describe, expect, it } from "vitest";
import { MESSAGES, type Command } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { worldToScreen, type Camera } from "../src/camera";
import { REST_MS, REST_TIMER } from "../src/plate";
import type { Effect } from "../src/ports/effects";
import { NO_MODS } from "../src/types";
import { COLORS } from "../src/view/colors";
import { textWidth } from "../src/view/fonts";
import { platePrimitives } from "../src/view/plate";
import type { Primitive } from "../src/view/scene-types";
import { LOFT_ROOM_LOFT, cabinDoc, loftRoomDoc, nightBedDoc, roomDoc, studioDoc, wallBetween, wallDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The plate after a refused press or release (clarity.02, .07, .08): the reason at the pointer, in `presence`, the
// last layer (clarity.13). `at` is the middle of a piece's back edge: a sofa at (3, 3) covers x 1.95–4.05, y 2.1–3.

const SOFA_SPOT = { x: 3, y: 2.5 };
const place = (opId: string, kind: string, at: Point, deck: string | null = null): Command => ({ type: "placeObject", linked: false, deck, opId, state: "s0", object: { kind }, at });
const sofaRoom = () => withCommands(roomDoc(), place("sofa", "sofa", { x: 3, y: 3 }));

const presence = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
const plateText = (shell: FakeShell): string | null => {
  for (const p of presence(shell)) if (p.kind === "text") return p.text;
  return null;
};

/** A click refused on release: a wardrobe armed and clicked on the sofa. */
function refusedClick(): FakeShell {
  const shell = FakeShell.withDocument(sofaRoom());
  shell.ui({ type: "pickKind", kind: "wardrobe" });
  shell.click(SOFA_SPOT);
  return shell;
}

const screenOf = (shell: FakeShell, world: Point): Point => worldToScreen(shell.state.camera, world);
const moveScreen = (shell: FakeShell, screen: Point): void => {
  shell.send({ type: "pointerMove", screen, mods: NO_MODS, button: 0 });
};

/** Every point the plate's primitives reach on screen, the text's ends included. */
function reach(primitives: readonly Primitive[], camera: Camera): Point[] {
  return primitives.flatMap((p): Point[] => {
    if (p.kind === "polygon") return p.points.map((q) => worldToScreen(camera, q));
    if (p.kind === "segment") return [worldToScreen(camera, p.a), worldToScreen(camera, p.b)];
    if (p.kind !== "text") return [];
    const c = worldToScreen(camera, p.at);
    const half = textWidth(p.font, p.text, p.size) / 2;
    return [{ x: c.x - half, y: c.y }, { x: c.x + half, y: c.y }];
  });
}

function expectInside(points: readonly Point[], width: number, height: number): void {
  expect(points.length).toBeGreaterThan(0);
  for (const p of points) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(width);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(height);
  }
}

describe("the plate after a refused click (clarity.02)", () => {
  it("a refused placing click shows the reason at the pointer", () => {
    const shell = refusedClick();
    const toast = shell.view().toast;
    expect(toast).toContain("Wardrobe");
    expect(plateText(shell)).toBe(toast);
    expect(shell.state.plate).toEqual({ text: toast, anchor: screenOf(shell, SOFA_SPOT), sticky: true });
    expect(shell.state.refused).toBeNull();
  });

  it("draws it white with a red border and red text, about 16 px below the pointer", () => {
    const shell = refusedClick();
    const prims = presence(shell);
    const box = prims.find((p) => p.kind === "polygon");
    expect(box).toMatchObject({ color: "#ffffff" });
    expect(prims.filter((p) => p.kind === "segment").map((p) => p.kind === "segment" && p.color)).toEqual(Array(4).fill(COLORS.invalid));
    expect(prims.find((p) => p.kind === "text")).toMatchObject({ color: COLORS.refusalText });
    const top = Math.min(...(box?.kind === "polygon" ? box.points.map((q) => worldToScreen(shell.state.camera, q).y) : []));
    expect(top - screenOf(shell, SOFA_SPOT).y).toBeCloseTo(16, 6);
  });

  it("the plate stays under 24 px and goes past it", () => {
    const shell = refusedClick();
    const a = screenOf(shell, SOFA_SPOT);
    moveScreen(shell, { x: a.x + 23, y: a.y });
    expect(plateText(shell)).not.toBeNull();
    moveScreen(shell, { x: a.x + 25, y: a.y });
    expect(shell.state.plate).toBeNull();
    expect(plateText(shell)).toBeNull();
  });

  it("measures from the anchor, so two 13 px moves clear it and a move back doesn't bring it back", () => {
    const shell = refusedClick();
    const a = screenOf(shell, SOFA_SPOT);
    moveScreen(shell, { x: a.x + 13, y: a.y });
    expect(shell.state.plate).not.toBeNull();
    moveScreen(shell, { x: a.x + 26, y: a.y });
    expect(shell.state.plate).toBeNull();
    moveScreen(shell, a);
    expect(shell.state.plate).toBeNull();
  });

  it("the next press or key clears it", () => {
    const pressed = refusedClick();
    expect(pressed.state.plate).not.toBeNull();
    pressed.down({ x: 3, y: 2.5 }); // the same spot: it's the press, not the distance
    expect(pressed.state.plate).toBeNull();
    const keyed = refusedClick();
    expect(keyed.state.plate).not.toBeNull();
    keyed.key("r");
    expect(keyed.state.plate).toBeNull();
  });

  const pressRefusals: [string, () => FakeShell, Point][] = [
    ["a wall click crossing a wall", () => {
      const shell = FakeShell.withDocument(wallDoc({ x: 1.5, y: -1 }, { x: 1.5, y: 1 }));
      shell.key("w");
      shell.click({ x: 0, y: 0 });
      return shell;
    }, { x: 3, y: 0 }],
    ["an opening over a door", () => {
      const room = roomDoc();
      const south = Object.values(room.walls).find((w) => room.joints[w.a]?.y === 0 && room.joints[w.b]?.y === 0);
      const shell = FakeShell.withDocument(withCommands(room, { type: "addOpening", opId: "d", wall: south?.id ?? "", kind: "swing", offset: 2.6 }));
      shell.key("d");
      return shell;
    }, { x: 3.2, y: 0.05 }],
    ["a duplicate on its original", () => {
      const shell = FakeShell.withDocument(studioDoc());
      shell.click({ x: 1.5, y: 2 });
      shell.key("d", { meta: true });
      return shell;
    }, { x: 1.5, y: 2 }],
  ];

  it.each(pressRefusals)("a release after a refusing press keeps the plate: %s", (_name, arrange, at) => {
    const shell = arrange();
    shell.moveTo(at);
    shell.down(at);
    const toast = shell.view().toast;
    expect(toast).not.toBeNull();
    expect(shell.state.plate).toEqual({ text: toast, anchor: screenOf(shell, at), sticky: true });
    shell.up(at);
    expect(shell.state.plate).toEqual({ text: toast, anchor: screenOf(shell, at), sticky: true });
  });

  it("a refused release sets it: a piece dragged onto another", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("a", "sofa", { x: 1.5, y: 3.5 }), place("b", "sofa", { x: 4.5, y: 3.5 })));
    const to = { x: 4.5, y: 3 };
    shell.drag({ x: 1.5, y: 3 }, to);
    expect(shell.view().toast).toContain("Sofa");
    expect(shell.state.plate).toEqual({ text: shell.view().toast, anchor: screenOf(shell, to), sticky: true });
  });

  const directRefusals: [string, () => FakeShell, string][] = [
    ["a piece placed where the viewed level has no floor", () => {
      const shell = FakeShell.withDocument(loftRoomDoc());
      shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
      shell.ui({ type: "pickKind", kind: "chair" });
      shell.click({ x: 5, y: 1 });
      return shell;
    }, "No floor at +2.15 here"],
    ["a piece dragged off the viewed level's floor", () => {
      const shell = FakeShell.withDocument(withCommands(loftRoomDoc(), place("c", "chair", { x: 2.5, y: 3 }, LOFT_ROOM_LOFT)));
      shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
      shell.drag({ x: 2.5, y: 2.8 }, { x: 5, y: 1 });
      return shell;
    }, "No floor at +2.15 here"],
    ["a hole cut in no deck", () => {
      const shell = FakeShell.withDocument(cabinDoc());
      shell.ui({ type: "pickTool", tool: "hole" });
      shell.click({ x: 2.8, y: 1 });
      return shell;
    }, MESSAGES.holeNoDeck],
    ["a finish laid off the viewed level's floor", () => {
      const shell = FakeShell.withDocument(loftRoomDoc());
      shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
      shell.ui({ type: "pickMotif", motif: "planks" });
      shell.click({ x: 5, y: 1 });
      return shell;
    }, "No floor at +2.15 here"],
  ];

  it.each(directRefusals)("a pointer refusal outside runCommand sets it too: %s", (_name, arrange, text) => {
    const shell = arrange();
    expect(shell.view().toast).toBe(text);
    expect(plateText(shell)).toBe(text);
  });

  it("a key refusal shows no plate: Delete on half a column", () => {
    const doc = withCommands(roomDoc(), { type: "placeColumn", opId: "k", at: { x: 3, y: 0 }, width: 0.3, depth: 0.3 });
    const shell = FakeShell.withDocument(doc);
    shell.moveTo({ x: 4, y: 0 });
    shell.state = { ...shell.state, selection: [{ table: "walls", id: "k/w1" }] };
    shell.key("Delete");
    expect(shell.view().toast).toContain("column");
    expect(shell.state.plate).toBeNull();
    expect(shell.state.refused).toBeNull();
    expect(plateText(shell)).toBeNull();
  });

  it("a Properties refusal shows no plate", () => {
    const doc = withCommands(nightBedDoc(), { type: "placeObject", linked: false, deck: null, opId: "d", state: "s0", object: { existing: "bed/o0" }, at: { x: 1.5, y: 3 } });
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 1.5, y: 2 });
    shell.ui({ type: "setField", fieldId: "width", value: "2.00" });
    expect(shell.view().toast).toBe("Bed (0.00–1.00) overlaps a wall in Night");
    expect(shell.state.plate).toBeNull();
    expect(shell.state.refused).toBeNull();
  });

  it("a refused command event, with a pointer on the canvas, shows no plate", () => {
    const shell = FakeShell.withDocument(sofaRoom());
    shell.moveTo({ x: 3, y: 2 });
    shell.command(place("w", "wardrobe", { x: 3, y: 3 }));
    expect(shell.view().toast).toContain("Wardrobe");
    expect(shell.state.plate).toBeNull();
    expect(shell.state.refused).toBeNull();
  });

  it("leaving the canvas and a ui event clear it", () => {
    const left = refusedClick();
    expect(left.state.plate).not.toBeNull();
    left.send({ type: "pointerLeave" });
    expect(left.state.plate).toBeNull();
    const clicked = refusedClick();
    expect(clicked.state.plate).not.toBeNull();
    clicked.ui({ type: "setFinishesOn", on: false });
    expect(clicked.state.plate).toBeNull();
  });

  it("a zoom doesn't move or clear it", () => {
    const shell = refusedClick();
    const before = shell.state.plate;
    expect(before).not.toBeNull();
    const onScreen = reach(presence(shell), shell.state.camera);
    const zoom = shell.state.camera.zoom;
    shell.wheel(0, -50, { ctrl: true });
    expect(shell.state.camera.zoom).toBeGreaterThan(zoom);
    expect(shell.state.plate).toEqual(before);
    const after = reach(presence(shell), shell.state.camera);
    after.forEach((p, i) => {
      expect(p.x).toBeCloseTo(onScreen[i]?.x ?? NaN, 6);
      expect(p.y).toBeCloseTo(onScreen[i]?.y ?? NaN, 6);
    });
  });

  it("a long reason ends in … inside the viewport, and the toast holds the whole text", () => {
    const shell = FakeShell.withDocument(sofaRoom());
    shell.send({ type: "viewportResized", size: { width: 300, height: 800 }, devicePixelRatio: 1 });
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.click(SOFA_SPOT);
    const text = plateText(shell);
    const toast = shell.view().toast ?? "";
    expect(text?.endsWith("…")).toBe(true);
    expect(toast.startsWith(text?.slice(0, -1) ?? "?")).toBe(true);
    expect(toast.endsWith("…")).toBe(false);
    expect(textWidth("inter", toast, 12)).toBeGreaterThan(300); // the fixture's reason does overflow
    expectInside(reach(presence(shell), shell.state.camera), 300, 800);
  });

  it("the toast lasts 6 s", () => {
    const shell = refusedClick();
    const toast = shell.view().toast;
    expect(toast).not.toBeNull();
    expect(shell.effectsOf("startTimer").at(-1)).toEqual({ type: "startTimer", timerId: "toast", ms: 6000 });
    shell.host.advance(5999);
    expect(shell.view().toast).toBe(toast);
    shell.host.advance(1);
    expect(shell.view().toast).toBeNull();
  });

  it("goes when the document leaves the project, and is never sent", () => {
    const r = FakeRemote.open(wallDoc({ x: 1.5, y: -1 }, { x: 1.5, y: 1 }));
    r.shell.key("w");
    r.shell.click({ x: 0, y: 0 });
    r.shell.click({ x: 3, y: 0 });
    expect(r.shell.state.plate).not.toBeNull();
    const toast = r.shell.state.plate?.text ?? "?";
    expect(JSON.stringify(r.shell.effects.filter((e) => e.type !== "render"))).not.toContain(toast);
    r.event({ type: "projectDeleted", projectId: "p1", generation: r.generation() });
    expect(r.shell.state.document).toBeNull();
    expect(r.shell.state.plate).toBeNull();
  });
});

// The plate on a rest (clarity.07): a pointer resting 150 ms on a red spot shows the reason; moving on takes it away.
describe("the plate on a rest (clarity.07)", () => {
  const armedRoom = (kind = "wardrobe"): FakeShell => {
    const shell = FakeShell.withDocument(sofaRoom());
    shell.ui({ type: "pickKind", kind });
    return shell;
  };
  const rest = (shell: FakeShell): void => {
    shell.host.advance(REST_MS);
    shell.fireTimer(REST_TIMER);
  };
  const restTimers = (effects: readonly Effect[]): Effect[] => effects.filter((e) => e.type === "startTimer" && e.timerId === REST_TIMER);
  /** What a release here would toast, worked out in a copy of the state, so the shell's own gesture goes on. */
  const toastOfClick = (shell: FakeShell, at: Point): string | null => {
    const copy = new FakeShell(shell.state, shell.host);
    copy.down(at);
    copy.up(at);
    return copy.view().toast;
  };

  it("no plate while the pointer keeps moving", () => {
    const shell = armedRoom();
    for (const x of [2.5, 2.7, 2.9, 3.1, 3.3]) {
      const before = shell.effects.length;
      shell.moveTo({ x, y: 2.5 });
      // Every move restarts the one timer (same id, web/src/adapters/timers.ts), so at 100 ms apart it never fires.
      expect(restTimers(shell.effects.slice(before))).toEqual([{ type: "startTimer", timerId: REST_TIMER, ms: 150 }]);
      shell.host.advance(100);
      expect(shell.state.plate).toBeNull();
    }
    expect(plateText(shell)).toBeNull();
  });

  it("a rest of 150 ms shows the plate", () => {
    const shell = armedRoom();
    shell.moveTo(SOFA_SPOT);
    expect(shell.state.plate).toBeNull();
    const toast = toastOfClick(shell, SOFA_SPOT); // "preview" and "id1" both sort before "sofa": the same order of names (clarity.13)
    rest(shell);
    expect(toast).toContain("Wardrobe");
    expect(plateText(shell)).toBe(toast);
    expect(shell.state.plate).toEqual({ text: toast, anchor: screenOf(shell, SOFA_SPOT), sticky: false, advice: "Drag to draw it to size" }); // sizing.09
    expect(shell.view().toast).toBeNull(); // a rest raises no toast
    expect(shell.state.refused).toBeNull();
  });

  it("a rest on a spot that fits shows none, and starts no timer", () => {
    const shell = armedRoom();
    shell.effects.length = 0;
    shell.moveTo({ x: 4.8, y: 1 });
    expect(restTimers(shell.effects)).toEqual([]);
    rest(shell);
    expect(shell.state.plate).toBeNull();
  });

  it("a normal drag starts no timer", () => {
    const shell = FakeShell.withDocument(sofaRoom());
    shell.effects.length = 0;
    shell.drag({ x: 3, y: 2.5 }, { x: 3.5, y: 2 });
    expect(shell.doc().placements["sofa/p0"]?.at).not.toEqual({ x: 3, y: 3 });
    expect(restTimers(shell.effects)).toEqual([]);
  });

  it("moving on takes a rest's plate away at once, under 24 px too", () => {
    const shell = armedRoom();
    shell.moveTo(SOFA_SPOT);
    rest(shell);
    const a = screenOf(shell, SOFA_SPOT);
    expect(shell.state.plate?.sticky).toBe(false);
    moveScreen(shell, { x: a.x + 1, y: a.y });
    expect(shell.state.plate).toBeNull();
    expect(plateText(shell)).toBeNull();
  });

  it("a sticky plate keeps the 24 px rule, and a rest doesn't replace it", () => {
    const shell = refusedClick();
    const sticky = shell.state.plate;
    expect(sticky?.sticky).toBe(true);
    const a = screenOf(shell, SOFA_SPOT);
    moveScreen(shell, { x: a.x + 10, y: a.y }); // still red, so its timer starts
    rest(shell);
    expect(shell.state.plate).toEqual(sticky);
  });

  it("a timer started before a refused click leaves the click's plate", () => {
    const shell = armedRoom();
    shell.moveTo(SOFA_SPOT);
    shell.down(SOFA_SPOT);
    shell.up(SOFA_SPOT);
    const sticky = shell.state.plate;
    expect(sticky?.sticky).toBe(true);
    rest(shell);
    expect(shell.state.plate).toEqual(sticky);
  });

  it("a late timer after the ghost stopped being red shows nothing", () => {
    const shell = armedRoom();
    shell.moveTo(SOFA_SPOT);
    shell.moveTo({ x: 4.8, y: 1 });
    rest(shell);
    expect(shell.state.plate).toBeNull();
  });

  it("a timer firing with no pointer shows nothing: a drag with the pointer gone from the canvas", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("a", "sofa", { x: 1.5, y: 3.5 }), place("b", "sofa", { x: 4.5, y: 3.5 })));
    shell.moveTo({ x: 1.5, y: 3 });
    shell.down({ x: 1.5, y: 3 });
    shell.moveTo({ x: 4.5, y: 3 });
    shell.send({ type: "pointerLeave" });
    rest(shell);
    expect(shell.state.plate).toBeNull();
  });

  it("a rest's plate goes when the ghost stops being red without a move: a pan", () => {
    const shell = armedRoom();
    shell.moveTo(SOFA_SPOT);
    rest(shell);
    expect(shell.state.plate).not.toBeNull();
    shell.wheel(0, 1.5 * shell.state.camera.zoom); // the world under the still pointer is now (3, 1), off the sofa
    const tool = shell.state.tool;
    expect(tool.name === "object" && tool.state.ghost?.fits).toBe(true);
    expect(shell.state.plate).toBeNull();
  });

  it("a middle-button pan over a red spot isn't a rest", () => {
    const shell = armedRoom();
    shell.moveTo(SOFA_SPOT);
    shell.down(SOFA_SPOT, {}, 1);
    const a = screenOf(shell, SOFA_SPOT);
    shell.effects.length = 0;
    moveScreen(shell, { x: a.x + 5, y: a.y });
    expect(restTimers(shell.effects)).toEqual([]);
    rest(shell);
    expect(shell.state.plate).toBeNull();
  });

  const SOUTH = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
  const twoWalls = (): FakeShell => FakeShell.withDocument(withCommands(wallDoc({ x: 0, y: 0 }, { x: 0, y: 2 }), { type: "addWall", opId: "v", from: { at: { x: 2, y: -1 } }, to: { at: { x: 2, y: 1 } } }));
  const loftRoom = (): FakeShell => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "addDeck", opId: "l", preset: "loft", at: { x: 3, y: 2 } }));
    shell.click({ x: 2.2, y: 2.5 }); // a deck drags once selected
    return shell;
  };
  const twoDoors = (): FakeShell => FakeShell.withDocument(withCommands(roomDoc(), { type: "addOpening", opId: "d", wall: SOUTH, kind: "swing", offset: 1 }, { type: "addOpening", opId: "e", wall: SOUTH, kind: "swing", offset: 3 }));
  const dragRefusals: [string, () => FakeShell, Point, Point][] = [
    ["a piece", () => FakeShell.withDocument(withCommands(roomDoc(), place("a", "sofa", { x: 1.5, y: 3.5 }), place("b", "sofa", { x: 4.5, y: 3.5 }))), { x: 1.5, y: 3 }, { x: 4.5, y: 3 }],
    ["a wall", () => FakeShell.withDocument(withCommands(wallDoc({ x: 0, y: -1 }, { x: 0, y: 1 }), { type: "addWall", opId: "h", from: { at: { x: 2, y: 0 } }, to: { at: { x: 4, y: 0 } } })), { x: 0, y: 0.5 }, { x: 3, y: 0.5 }],
    ["a joint", () => {
      const shell = twoWalls();
      shell.click({ x: 0, y: 1 }); // a joint's handle shows on its selected wall
      return shell;
    }, { x: 0, y: 2 }, { x: 4, y: 0 }],
    ["an opening", twoDoors, { x: 1.4, y: 0.05 }, { x: 3.4, y: 0.05 }],
    ["a deck", loftRoom, { x: 2.2, y: 2.5 }, { x: 5.2, y: 2.5 }],
  ];

  it.each(dragRefusals)("dragging %s to a refused place and resting shows its reason", (_name, arrange, from, to) => {
    const shell = arrange();
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo(to);
    const tool = shell.state.tool;
    expect(tool.name === "select" && tool.state.kind === "moving" && !tool.state.attempt.ok).toBe(true);
    rest(shell);
    const words = shell.state.plate?.text;
    expect(words).toBeTruthy();
    expect(shell.state.plate?.sticky).toBe(false);
    shell.up(to);
    expect(shell.view().toast).toBe(words);
    expect(shell.state.plate).toEqual({ text: words, anchor: screenOf(shell, to), sticky: true });
  });

  it("a piece dragged off the viewed level's floor says so on a rest", () => {
    const shell = FakeShell.withDocument(withCommands(loftRoomDoc(), place("c", "chair", { x: 2.5, y: 3 }, LOFT_ROOM_LOFT)));
    shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    shell.moveTo({ x: 2.5, y: 2.8 });
    shell.down({ x: 2.5, y: 2.8 });
    shell.moveTo({ x: 5, y: 1 });
    rest(shell);
    expect(shell.state.plate?.text).toBe("No floor at +2.15 here");
  });

  it("a piece placed where the viewed level has no floor says so on a rest", () => {
    const shell = FakeShell.withDocument(loftRoomDoc());
    shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    shell.ui({ type: "pickKind", kind: "chair" });
    shell.moveTo({ x: 5, y: 1 });
    rest(shell);
    expect(shell.state.plate?.text).toBe("No floor at +2.15 here");
  });

  const inLineColumn = (): FakeShell => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeColumn", opId: "c", at: { x: 2, y: 0 }, width: 0.3, depth: 0.3 }));
    shell.ui({ type: "setSnapStep", step: 0.01 });
    shell.click({ x: 2, y: 0 });
    shell.moveTo({ x: 2, y: 0 });
    shell.down({ x: 2, y: 0 });
    return shell;
  };

  it("a column on a wall's line that stops at its limit stays green and shows none", () => {
    const shell = inLineColumn();
    shell.moveTo({ x: 0.5, y: 0 });
    shell.effects.length = 0;
    shell.moveTo({ x: 0.1, y: 0 }); // past the limit: it stays at its last valid place (select-tool's stopsAtLimit)
    const tool = shell.state.tool;
    expect(tool.name === "select" && tool.state.kind === "moving" && tool.state.attempt.ok).toBe(true);
    expect(restTimers(shell.effects)).toEqual([]);
    rest(shell);
    expect(shell.state.plate).toBeNull();
  });

  it("a column's first move already past the limit is red, and shows why", () => {
    const shell = inLineColumn();
    shell.moveTo({ x: 0.1, y: 0 });
    rest(shell);
    expect(shell.state.plate?.text).toBe("A column needs at least 1 cm of wall on each side");
  });

  it("a drawn footprint held on a red spot shows the reason", () => {
    const shell = armedRoom();
    const from = { x: 2, y: 3.4 };
    const to = { x: 4, y: 2.4 };
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo(to);
    const tool = shell.state.tool;
    expect(tool.name === "object" && tool.state.pressing?.corner).toEqual(to);
    expect(tool.name).toBe("object");
    expect(tool.name === "object" && tool.state.ghost?.fits).toBe(false);
    rest(shell);
    const words = shell.state.plate?.text;
    expect(words).toContain("Wardrobe");
    shell.up(to);
    expect(shell.view().toast).toBe(words);
  });

  it("the words use the same opening subject as the release", () => {
    const shell = twoDoors();
    const from = { x: 1.4, y: 0.05 };
    const to = { x: 3.4, y: 0.05 };
    shell.moveTo(from);
    shell.down(from);
    shell.moveTo(to);
    rest(shell);
    expect(shell.state.plate?.text).toBe("This door would overlap a door on this wall");
    shell.up(to);
    expect(shell.view().toast).toBe("This door would overlap a door on this wall");
  });

  // A loft over x 0.1–1.9 catches on its right edge; a box across the band around y 3 runs into the stair (stair-hint.test.ts).
  const STAIR_TOP = { x: 2.6, y: 3.23 };
  const blockedStair = (): FakeShell => {
    const shell = FakeShell.withDocument(withCommands(
      roomDoc(),
      { type: "setCeiling", height: 3.2 },
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.8, name: "Loft" },
      { type: "placeObject", linked: false, opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 2.6, y: 3.2 }, rotation: 0, deck: null },
    ));
    shell.ui({ type: "setSnapStep", step: 0.1 });
    shell.ui({ type: "pickKind", kind: "stair" });
    return shell;
  };
  const caughtEdge = (shell: FakeShell): boolean => shell.state.tool.name === "object" && shell.state.tool.state.stair !== null;

  it("a stair gesture with an edge caught shows no plate on a rest", () => {
    const shell = blockedStair();
    shell.effects.length = 0;
    shell.moveTo(STAIR_TOP);
    expect(caughtEdge(shell)).toBe(true);
    expect(shell.state.tool.name).toBe("object");
    expect(shell.state.tool.name === "object" && shell.state.tool.state.ghost?.fits).toBe(false);
    expect(restTimers(shell.effects)).toEqual([]);
    rest(shell);
    expect(shell.state.plate).toBeNull();
  });

  it("a stair gesture's refused click 2 toasts and shows no plate (clarity.15)", () => {
    const shell = blockedStair();
    shell.click(STAIR_TOP);
    shell.click(STAIR_TOP);
    expect(caughtEdge(shell)).toBe(true);
    expect(shell.view().toast).toBe("Custom box (0.00–1.00) and Stair (0.00–2.15) overlap in Layout");
    expect(shell.state.plate).toBeNull();
    expect(shell.state.refused).toBeNull();
    expect(plateText(shell)).toBeNull();
  });

  it("a stair's press dragged past 4 px and refused on release shows no plate (clarity.15)", () => {
    const shell = blockedStair();
    shell.moveTo(STAIR_TOP);
    shell.down(STAIR_TOP);
    const away = { x: 2.6, y: 3.33 };
    shell.moveTo(away);
    shell.up(away);
    expect(caughtEdge(shell)).toBe(true);
    expect(shell.view().toast).not.toBeNull();
    expect(shell.state.plate).toBeNull();
  });

  it("a stair kind armed with no edge caught is a plain ghost and does show one", () => {
    const shell = armedRoom("stair");
    shell.moveTo(SOFA_SPOT);
    expect(caughtEdge(shell)).toBe(false);
    const toast = toastOfClick(shell, SOFA_SPOT);
    rest(shell);
    expect(toast).not.toBeNull();
    expect(shell.state.plate?.text).toBe(toast);
    shell.down(SOFA_SPOT);
    shell.up(SOFA_SPOT);
    expect(shell.state.plate).toEqual({ text: toast, anchor: screenOf(shell, SOFA_SPOT), sticky: true });
  });

  it("an arrow-key nudge shows no plate", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("a", "sofa", { x: 1.2, y: 3 })));
    shell.click({ x: 1.2, y: 2.5 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "a/p0" }]);
    for (let i = 0; i < 20; i++) shell.key("ArrowLeft");
    const tool = shell.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("nudging");
    expect(tool.name === "select" && tool.state.kind === "nudging" && tool.state.attempt.ok).toBe(false);
    shell.effects.length = 0;
    shell.moveTo({ x: 1.2, y: 2.5 });
    expect(restTimers(shell.effects)).toEqual([]);
    rest(shell);
    expect(shell.state.plate).toBeNull();
  });

  describe("in the other gestures (clarity.03)", () => {
    /** Rests where the shell is, then expects the plate to read `toast`, not sticky, and no toast of its own. */
    const expectRestShows = (shell: FakeShell, toast: string | null): void => {
      const before = shell.effects.length;
      expect(toast).toBeTruthy();
      rest(shell);
      expect(shell.state.plate?.text).toBe(toast);
      expect(shell.state.plate?.sticky).toBe(false);
      expect(shell.view().toast).toBeNull();
      expect(shell.effects.slice(before).filter((e) => e.type === "startTimer")).toEqual([]);
    };
    const expectStartsRest = (shell: FakeShell, move: () => void): void => {
      shell.effects.length = 0;
      move();
      expect(restTimers(shell.effects)).toHaveLength(1);
    };

    const crossed = { x: 3, y: 0 };
    const drawingAcross = (): FakeShell => {
      const shell = FakeShell.withDocument(wallDoc({ x: 1.5, y: -1 }, { x: 1.5, y: 1 }));
      shell.key("w");
      shell.click({ x: 0, y: 0 });
      return shell;
    };

    it("drawing a wall across a wall and resting shows the reason", () => {
      const shell = drawingAcross();
      expectStartsRest(shell, () => shell.moveTo(crossed));
      const tool = shell.state.tool;
      expect(tool.name === "wall" && tool.state.kind).toBe("drawing");
      expect(tool.name === "wall" && tool.state.kind === "drawing" && tool.state.preview?.ok).toBe(false);
      expectRestShows(shell, toastOfClick(shell, crossed));
    });

    it("a wall preview that fits starts no rest", () => {
      const shell = drawingAcross();
      shell.effects.length = 0;
      shell.moveTo({ x: 0, y: 3 });
      expect(restTimers(shell.effects)).toEqual([]);
      rest(shell);
      expect(shell.state.plate).toBeNull();
    });

    it("a refused wall click shows it", () => {
      const shell = drawingAcross();
      shell.click(crossed);
      const toast = shell.view().toast;
      expect(toast).toBeTruthy();
      expect(shell.state.plate).toEqual({ text: toast, anchor: screenOf(shell, crossed), sticky: true });
    });

    it("a wall dragged out across a wall is held red, then refused on release, in the same words", () => {
      const shell = FakeShell.withDocument(wallDoc({ x: 1.5, y: -1 }, { x: 1.5, y: 1 }));
      shell.key("w");
      shell.moveTo({ x: 0, y: 0 });
      shell.down({ x: 0, y: 0 });
      shell.moveTo(crossed);
      rest(shell);
      const words = shell.state.plate?.text;
      expect(words).toBeTruthy();
      shell.up(crossed);
      expect(shell.view().toast).toBe(words);
      expect(shell.state.plate).toEqual({ text: words, anchor: screenOf(shell, crossed), sticky: true });
    });

    const OVER_DOOR = { x: 3.2, y: 0.05 };
    const doorTool = (): FakeShell => {
      const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "addOpening", opId: "d", wall: SOUTH, kind: "swing", offset: 2.6 }));
      shell.key("d");
      return shell;
    };

    it("placing an opening over another and resting shows the reason", () => {
      const shell = doorTool();
      expectStartsRest(shell, () => shell.moveTo(OVER_DOOR));
      expectRestShows(shell, toastOfClick(shell, OVER_DOOR));
      expect(shell.state.plate?.text).toBe("This door would overlap a door on this wall");
    });

    it("an opening that fits starts no rest", () => {
      const shell = doorTool();
      shell.effects.length = 0;
      shell.moveTo({ x: 1, y: 0.05 });
      const tool = shell.state.tool;
      expect(tool.name === "opening" && tool.state.preview?.ok).toBe(true);
      expect(restTimers(shell.effects)).toEqual([]);
    });

    const ON_WALL_FACE = { x: 0.2, y: 2 };

    it("a column over a wall and resting shows the reason", () => {
      const shell = FakeShell.withDocument(roomDoc());
      shell.ui({ type: "setSnapStep", step: 0.1 });
      shell.key("c");
      expectStartsRest(shell, () => shell.moveTo(ON_WALL_FACE));
      expectRestShows(shell, toastOfClick(shell, ON_WALL_FACE));
      expect(shell.state.plate?.text).toBe("This column touches a wall");
    });

    it("a column ghost that fits starts no rest", () => {
      const shell = FakeShell.withDocument(roomDoc());
      shell.key("c");
      shell.effects.length = 0;
      shell.moveTo({ x: 3, y: 2 });
      expect(restTimers(shell.effects)).toEqual([]);
    });

    it("dragging a deck out over a wall and resting shows the reason", () => {
      const shell = FakeShell.withDocument(roomDoc());
      shell.key("k");
      const to = { x: 7, y: 3 };
      shell.moveTo({ x: 4, y: 1 });
      shell.down({ x: 4, y: 1 });
      expectStartsRest(shell, () => shell.moveTo(to));
      expectRestShows(shell, "Platform must lie over the building");
      shell.up(to);
      expect(shell.view().toast).toBe("Platform must lie over the building");
      expect(shell.state.plate).toEqual({ text: "Platform must lie over the building", anchor: screenOf(shell, to), sticky: true });
    });

    it("a deck dragged inside the room starts no rest", () => {
      const shell = FakeShell.withDocument(roomDoc());
      shell.key("k");
      shell.moveTo({ x: 1, y: 1 });
      shell.down({ x: 1, y: 1 });
      shell.effects.length = 0;
      shell.moveTo({ x: 3, y: 2 });
      expect(restTimers(shell.effects)).toEqual([]);
    });

    it("a deck hole with no deck under it words MESSAGES.holeNoDeck", () => {
      const shell = FakeShell.withDocument(cabinDoc());
      shell.ui({ type: "pickTool", tool: "hole" });
      const to = { x: 3.5, y: 1.5 };
      shell.moveTo({ x: 2.8, y: 1 });
      shell.down({ x: 2.8, y: 1 });
      expectStartsRest(shell, () => shell.moveTo(to));
      expectRestShows(shell, MESSAGES.holeNoDeck);
      shell.up(to);
      expect(shell.view().toast).toBe(MESSAGES.holeNoDeck);
    });

    /** Two sofas, the first selected and picked up as a duplicate ghost. */
    const OTHER_SOFA = { x: 4.5, y: 3 };
    const ghostUp = (): FakeShell => {
      const shell = FakeShell.withDocument(withCommands(roomDoc(), place("a", "sofa", { x: 1.5, y: 3.5 }), place("b", "sofa", { x: 4.5, y: 3.5 })));
      shell.click({ x: 1.5, y: 3 });
      shell.key("d", { meta: true });
      return shell;
    };

    it("a duplicate ghost on a piece and resting shows the reason", () => {
      const shell = ghostUp();
      expectStartsRest(shell, () => shell.moveTo(OTHER_SOFA));
      const tool = shell.state.tool;
      expect(tool.name === "select" && tool.state.kind).toBe("copying");
      expect(tool.name === "select" && tool.state.kind === "copying" && tool.state.attempt.ok).toBe(false);
      expectRestShows(shell, toastOfClick(shell, OTHER_SOFA));
      expect(shell.state.plate?.text).toContain("Sofa");
    });

    it("its refused press shows it", () => {
      const shell = ghostUp();
      shell.moveTo(OTHER_SOFA);
      shell.down(OTHER_SOFA);
      const toast = shell.view().toast;
      expect(toast).toContain("Sofa");
      expect(shell.state.plate).toEqual({ text: toast, anchor: screenOf(shell, OTHER_SOFA), sticky: true });
    });

    it("a duplicate ghost that fits starts no rest", () => {
      const shell = ghostUp();
      shell.moveTo(OTHER_SOFA);
      shell.effects.length = 0;
      shell.moveTo({ x: 3, y: 1 });
      const tool = shell.state.tool;
      expect(tool.name === "select" && tool.state.kind === "copying" && tool.state.attempt.ok).toBe(true);
      expect(restTimers(shell.effects)).toEqual([]);
      rest(shell);
      expect(shell.state.plate).toBeNull();
    });

    it("a duplicate ghost with nothing to try has no reason: its last refusal isn't kept for it", () => {
      const shell = ghostUp();
      shell.moveTo(OTHER_SOFA);
      const tool = shell.state.tool;
      if (tool.name !== "select" || tool.state.kind !== "copying") throw new Error("no ghost");
      shell.state = { ...shell.state, tool: { name: "select", state: { ...tool.state, sources: ["gone/p0"] } } }; // its piece gone from baseDoc
      shell.effects.length = 0;
      shell.moveTo({ x: OTHER_SOFA.x + 0.3, y: OTHER_SOFA.y });
      expect(restTimers(shell.effects)).toEqual([]);
      rest(shell);
      expect(shell.state.plate).toBeNull();
    });

    it("the Zone and Dimension tools, never red, show a plate only after a refused press", () => {
      const zone = FakeShell.withDocument(loftRoomDoc());
      zone.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
      zone.ui({ type: "pickMotif", motif: "planks" });
      const offFloor = { x: 5, y: 1 };
      zone.effects.length = 0;
      zone.moveTo(offFloor);
      expect(restTimers(zone.effects)).toEqual([]);
      rest(zone);
      expect(zone.state.plate).toBeNull();
      zone.down(offFloor);
      expect(zone.state.plate).toEqual({ text: "No floor at +2.15 here", anchor: screenOf(zone, offFloor), sticky: true });

      const dimension = FakeShell.withDocument(roomDoc());
      dimension.key("m");
      const at = { x: 3, y: 2 };
      dimension.effects.length = 0;
      dimension.moveTo(at);
      expect(restTimers(dimension.effects)).toEqual([]);
      rest(dimension);
      expect(dimension.state.plate).toBeNull();
      // Its stages refuse a short pair, so this end state is set by hand: only the commit's refusal can raise a plate.
      dimension.state = { ...dimension.state, tool: { name: "dimension", state: { kind: "offset", a: at, b: at, offset: 0.5 } } };
      dimension.down(at);
      expect(dimension.view().toast).toBe("Dimension too short");
      expect(dimension.state.plate).toEqual({ text: "Dimension too short", anchor: screenOf(dimension, at), sticky: true });
    });
  });
});

describe("platePrimitives (clarity.08)", () => {
  const camera: Camera = { center: { x: 3, y: 2 }, zoom: 80, viewport: { width: 400, height: 300 }, dpr: 1 };

  it.each<[string, Point]>([
    ["the bottom right corner", { x: 399, y: 299 }],
    ["the top left corner", { x: 0, y: 0 }],
    ["off the viewport after a resize", { x: 900, y: 900 }],
  ])("keeps the box inside the viewport at %s", (_name, anchor) => {
    expectInside(reach(platePrimitives("Bed (0.00–1.00) overlaps a wall", anchor, "refusal", camera), camera), 400, 300);
  });

  it("the note tone has an amber border and plain text", () => {
    const prims = platePrimitives("Lowered to 2.03", { x: 100, y: 100 }, "note", camera);
    expect(prims.find((p) => p.kind === "polygon")).toMatchObject({ color: "#ffffff" });
    expect(prims.find((p) => p.kind === "segment")).toMatchObject({ color: COLORS.warningLine });
    expect(prims.find((p) => p.kind === "text")).toMatchObject({ color: COLORS.text });
  });

  it("leaves a text that fits whole", () => {
    const prims = platePrimitives("Short", { x: 100, y: 100 }, "refusal", camera);
    expect(prims.find((p) => p.kind === "text")).toMatchObject({ text: "Short" });
  });
});
