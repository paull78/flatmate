import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import type { Primitive } from "../src/view/scene-types";
import { bed160x200, roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// A bed centred on (1.5, 2) in Layout and on (3.5, 2) in Night: it moves 2 m.
const moving = () =>
  withCommands(
    roomDoc(),
    { type: "addState", opId: "n", name: "Night" },
    { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3 } },
    { type: "placeObject", linked: false, deck: null, opId: "b2", state: "n/s0", object: { existing: "bed/o0" }, at: { x: 3.5, y: 3 } },
    bed160x200("bed/o0"),
  );

const polygons = (shell: FakeShell): Extract<Primitive, { kind: "polygon" }>[] =>
  (shell.scene().layers.find((l) => l.name === "objects")?.primitives ?? []).flatMap((p) => (p.kind === "polygon" ? [p] : []));
const centreOf = (points: readonly Point[]): Point => {
  const a = points[0];
  const c = points[2];
  if (!a || !c) throw new Error("not a quad");
  return { x: +((a.x + c.x) / 2).toFixed(3), y: +((a.y + c.y) / 2).toFixed(3) };
};
const frame = (shell: FakeShell, now: number) => shell.send({ type: "frame", now });
const asksFrame = (effects: { type: string }[]) => effects.some((e) => e.type === "requestFrame");

describe("the flip (spec: layouts, layout-states.06, .20)", () => {
  it("tapping Night starts a flip and asks for frames; at 250 ms the bed is halfway, at 600 ms it is at its Night place and no frame is asked (AC-13)", () => {
    const shell = FakeShell.withDocument(moving());
    const tap = shell.send({ type: "ui", action: { type: "setActiveState", id: "n/s0" } });
    expect(asksFrame(tap)).toBe(true);
    expect(asksFrame(frame(shell, 250))).toBe(true);
    expect(polygons(shell).map((p) => centreOf(p.points))).toEqual([{ x: 2.5, y: 2 }]);
    expect(asksFrame(frame(shell, 600))).toBe(false);
    expect(shell.state.flip).toBeNull();
    expect(polygons(shell).map((p) => centreOf(p.points))).toEqual([{ x: 3.5, y: 2 }]);
  });

  it("turns along the shorter arc: 0° in Layout and 270° in Night is about 315° halfway (AC-21)", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "addState", opId: "n", name: "Night" },
      { type: "placeObject", linked: false, deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2.225 } },
      { type: "placeObject", linked: false, deck: null, opId: "c2", state: "n/s0", object: { existing: "c/o0" }, at: { x: 3.225, y: 2 }, rotation: 270 },
    );
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    frame(shell, 250);
    const [q] = polygons(shell);
    const a = q?.points[0];
    const b = q?.points[1];
    if (!a || !b) throw new Error("no footprint");
    const angle = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
    expect(angle).toBeCloseTo(315, 6);
  });

  it("a murphy bed folding down keeps its back on the wall the whole way: its size changes with the flip", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "addState", opId: "n", name: "Night" },
      { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 3, y: 3.9 } },
      { type: "placeObject", linked: false, deck: null, opId: "m2", state: "n/s0", object: { existing: "m/o0" }, at: { x: 3, y: 3.9 }, config: "down" },
    );
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    for (const now of [100, 250, 400]) {
      frame(shell, now);
      const [q] = polygons(shell);
      const ys = (q?.points ?? []).map((p) => +p.y.toFixed(9));
      expect(Math.max(...ys), `${now} ms`).toBe(3.9);
    }
    const [half] = (frame(shell, 250), polygons(shell));
    const ys = (half?.points ?? []).map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo((0.4 + 2.1) / 2, 9);
  });

  it("an object only in Layout fades out, one only in Night fades in", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "addState", opId: "n", name: "Night" },
      { type: "placeObject", linked: false, deck: null, opId: "a", state: "s0", object: { kind: "chair" }, at: { x: 1, y: 2 } },
      { type: "placeObject", linked: false, deck: null, opId: "b", state: "n/s0", object: { kind: "chair" }, at: { x: 5, y: 2 } },
    );
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    frame(shell, 250);
    const colours = polygons(shell).map((p) => p.color);
    expect(colours).toHaveLength(2);
    expect(colours.every((c) => /^#[0-9a-f]{8}$/.test(c))).toBe(true); // translucent while fading
    frame(shell, 600);
    expect(polygons(shell).map((p) => centreOf(p.points))).toEqual([{ x: 5, y: 1.775 }]);
  });

  it("a remote change during the flip ends it at the final places", () => {
    const r = FakeRemote.open(moving());
    r.shell.ui({ type: "setActiveState", id: "n/s0" });
    r.shell.send({ type: "frame", now: 100 });
    r.remote({ type: "renameState", stateId: "n/s0", name: "Sleep" });
    expect(r.shell.state.flip).toBeNull();
    expect(polygons(r.shell).map((p) => centreOf(p.points))).toEqual([{ x: 3.5, y: 2 }]);
  });

  it("tapping another layout mid-flip starts a new flip from the layout being shown", () => {
    const shell = FakeShell.withDocument(moving());
    shell.ui({ type: "setActiveState", id: "n/s0" });
    frame(shell, 250);
    shell.host.advance(250);
    shell.ui({ type: "setActiveState", id: "s0" });
    expect(shell.state.flip).toMatchObject({ from: "n/s0", to: "s0", startedAt: 250 });
    frame(shell, 1000);
    expect(polygons(shell).map((p) => centreOf(p.points))).toEqual([{ x: 1.5, y: 2 }]);
  });

  it("picking the layout already shown starts nothing", () => {
    const shell = FakeShell.withDocument(moving());
    expect(asksFrame(shell.send({ type: "ui", action: { type: "setActiveState", id: "s0" } }))).toBe(false);
    expect(shell.state.flip).toBeNull();
  });
});
