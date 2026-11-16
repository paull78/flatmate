import { describe, expect, it } from "vitest";
import type { Command } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The frames under the plan (spec "The strip", AC-15, AC-16): this viewer's dock, holding the section and 3D in split.
//
//   ┌─────── plan ───────┐   height: the dock's share of the stage's height
//   ├──────┬─────────────┤   sectionShare: the section's share of the dock's width, wherever it sits
//   │  A–A │     3D      │   sectionFirst: which sits on the left
//   └──────┴─────────────┘

const P = (x: number, y: number): Point => ({ x, y });
const ADD: Command = { type: "addSection", a: P(-1, 2), b: P(7, 2), side: 1 };
const shell = (): FakeShell => FakeShell.withDocument(withCommands(roomDoc(), ADD));
const frames = (s: FakeShell) => s.view().frames;
const openSection = (s: FakeShell): void => s.ui({ type: "showSection", section: "A" });

describe("what's in the dock", () => {
  it("nothing at first", () => {
    expect(frames(shell())).toMatchObject({ docked: false, side: false });
  });

  it("a section alone", () => {
    const s = shell();
    openSection(s);
    expect(frames(s)).toMatchObject({ docked: true, side: false });
  });

  it("3D in split alone", () => {
    const s = shell();
    s.ui({ type: "set3dSize", size: "split" });
    expect(frames(s)).toMatchObject({ docked: true, side: false });
  });

  it("the two side by side", () => {
    const s = shell();
    openSection(s);
    s.ui({ type: "set3dSize", size: "split" });
    expect(frames(s)).toMatchObject({ docked: true, side: true });
  });

  it("3D in its corner isn't in the dock, with or without a section", () => {
    const s = shell();
    s.ui({ type: "set3dSize", size: "corner" });
    expect(frames(s)).toMatchObject({ docked: false, side: false });
    openSection(s);
    expect(frames(s)).toMatchObject({ docked: true, side: false });
  });

  it("3D closed in split leaves the dock", () => {
    const s = shell();
    s.ui({ type: "set3dSize", size: "split" });
    s.ui({ type: "toggle3d" });
    expect(frames(s)).toMatchObject({ docked: false, side: false });
  });
});

describe("the dock's height", () => {
  it("starts at 46% of the stage", () => {
    expect(frames(shell()).height).toBe(0.46);
  });

  it("follows a drag", () => {
    const s = shell();
    s.ui({ type: "setDockHeight", height: 0.3 });
    expect(frames(s).height).toBe(0.3);
  });

  it.each([[-1, 0], [2, 1]])("%d stays in range", (asked, got) => {
    const s = shell();
    s.ui({ type: "setDockHeight", height: asked });
    expect(frames(s).height).toBe(got);
  });

  it("Larger gives 74%, and again gives back the height it had", () => {
    const s = shell();
    s.ui({ type: "setDockHeight", height: 0.3 });
    s.ui({ type: "toggleLargerDock" });
    expect(frames(s)).toMatchObject({ height: 0.74, larger: true });
    s.ui({ type: "toggleLargerDock" });
    expect(frames(s)).toMatchObject({ height: 0.3, larger: false });
  });

  it("a drag from Larger starts from where it's dragged to", () => {
    const s = shell();
    s.ui({ type: "toggleLargerDock" });
    s.ui({ type: "setDockHeight", height: 0.6 });
    expect(frames(s)).toMatchObject({ height: 0.6, larger: false });
  });

  it("a reset goes back to 46%, from a drag or from Larger", () => {
    const s = shell();
    s.ui({ type: "setDockHeight", height: 0.3 });
    s.ui({ type: "toggleLargerDock" });
    s.ui({ type: "resetDockHeight" });
    expect(frames(s)).toMatchObject({ height: 0.46, larger: false });
  });
});

describe("the two frames' widths and places", () => {
  it("the section starts on the left with 56% of the width", () => {
    expect(frames(shell())).toMatchObject({ sectionFirst: true, sectionShare: 0.56 });
  });

  it("swap exchanges their places, and each keeps its width", () => {
    const s = shell();
    s.ui({ type: "setDockShare", sectionShare: 0.7 });
    s.ui({ type: "swapFrames" });
    expect(frames(s)).toMatchObject({ sectionFirst: false, sectionShare: 0.7 });
    s.ui({ type: "swapFrames" });
    expect(frames(s)).toMatchObject({ sectionFirst: true, sectionShare: 0.7 });
  });

  it.each([[0, 0.2], [1, 0.8], [0.5, 0.5]])("a share of %d gives %d", (asked, got) => {
    const s = shell();
    s.ui({ type: "setDockShare", sectionShare: asked });
    expect(frames(s).sectionShare).toBe(got);
  });
});

describe("the frames belong to this viewer", () => {
  it("none of it is sent, or undone", () => {
    const r = FakeRemote.open(withCommands(roomDoc(), ADD));
    const past = r.shell.state.undo.past.length;
    r.shell.ui({ type: "setDockHeight", height: 0.3 });
    r.shell.ui({ type: "toggleLargerDock" });
    r.shell.ui({ type: "resetDockHeight" });
    r.shell.ui({ type: "setDockShare", sectionShare: 0.3 });
    r.shell.ui({ type: "swapFrames" });
    expect(r.submits()).toEqual([]);
    expect(r.shell.state.undo.past.length).toBe(past);
  });
});

describe("the title bars' words", () => {
  it("name the layout on both, and the letter on the section's", () => {
    const s = shell();
    openSection(s);
    s.ui({ type: "toggle3d" });
    expect(s.view().view3d?.layout).toBe("Layout");
    expect(s.view().sectionStrip).toMatchObject({ label: "A–A", layout: "Layout" });
  });
});
