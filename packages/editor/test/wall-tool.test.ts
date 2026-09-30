import { describe, expect, it } from "vitest";
import { MESSAGES } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { jointAt, wallBetween, wallDoc } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

function wall(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "wall") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

const wallCount = (shell: FakeShell) => Object.keys(shell.doc().walls).length;

function drawing(): FakeShell {
  const shell = FakeShell.local();
  shell.key("w");
  shell.click({ x: 0, y: 0 });
  return shell;
}

describe("wall tool (spec §5.5)", () => {
  it("starts a chain on the first click without adding a wall", () => {
    const shell = drawing();
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 0 }, chainStart: { x: 0, y: 0 }, value: "" });
    expect(wallCount(shell)).toBe(0);
  });

  it("adds a wall per click and continues from its end; a local document never pauses", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    expect(wallCount(shell)).toBe(1);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, chainStart: { x: 0, y: 0 } });
    expect(shell.state.undo.past.map((e) => e.status)).toEqual(["usable"]);
  });

  it("places a typed length along the Shift-constrained cursor direction", () => {
    const shell = drawing();
    shell.moveTo({ x: 3, y: 0.3 }, { shift: true });
    shell.type("6");
    shell.key("Enter");
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 6, y: 0 }, value: "" });
  });

  it("without Shift, uses the raw snapped cursor direction", () => {
    const shell = drawing();
    shell.moveTo({ x: 3, y: 4 });
    shell.type("5");
    shell.key("Enter");
    jointAt(shell.doc(), { x: 3, y: 4 }); // 5 m along (0.6, 0.8)
  });

  it("snaps to 15° rays from the origin and places a typed length exactly along the ray (§5.8)", () => {
    const shell = drawing();
    shell.moveTo({ x: 2, y: 0.6 }); // 16.7°, 0.062 m off the 15° ray
    expect(shell.state.snap?.kind).toBe("angle");
    shell.type("3");
    shell.key("Enter");
    const end = { x: 3 * Math.cos(Math.PI / 12), y: 3 * Math.sin(Math.PI / 12) };
    wallBetween(shell.doc(), { x: 0, y: 0 }, end);
  });

  it("snaps to the foot of the perpendicular on a wall, not before the first point (§5.8)", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 4 }, { x: 6, y: 4 }));
    shell.key("w");
    shell.moveTo({ x: 2.05, y: 3.95 });
    expect(shell.state.snap?.kind).toBe("onWall"); // idle: no origin yet
    shell.click({ x: 2, y: 0 });
    shell.moveTo({ x: 2.05, y: 3.95 });
    expect(shell.state.snap).toMatchObject({ kind: "perpendicular", point: { x: 2, y: 4 } });
  });

  it("edits the typed value with Backspace", () => {
    const shell = drawing();
    shell.type("65");
    shell.key("Backspace");
    expect(shell.view().commandBar).toEqual({ prompt: "Next point or length", value: "6", unit: "m" });
  });

  it("finishes the chain on an empty Enter", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    shell.key("Enter");
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(wallCount(shell)).toBe(1);
  });

  it("confirms with Space like Enter", () => {
    const shell = drawing();
    shell.moveTo({ x: 1, y: 0.1 }, { shift: true });
    shell.type("2");
    shell.key(" ");
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2, y: 0 });
  });

  it("closes the chain when the first joint is clicked", () => {
    const shell = drawing();
    for (const p of [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }]) shell.click(p);
    expect(wallCount(shell)).toBe(4);
    expect(Object.keys(shell.doc().joints)).toHaveLength(4);
    expect(wall(shell)).toEqual({ kind: "idle" });
  });

  it("leaves the tool unchanged and shows a toast when addWall is rejected", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 6, y: 0 }));
    shell.key("w");
    shell.click({ x: 1, y: 0 });
    shell.click({ x: 5, y: 0 }); // collinear with the existing wall
    expect(wallCount(shell)).toBe(1);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 1, y: 0 } });
    expect(shell.view().toast).toBe(MESSAGES.overlap);
  });

  it("refuses a length that is not a positive number", () => {
    const shell = drawing();
    shell.moveTo({ x: 1, y: 0.1 });
    shell.type(".");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a length in metres");
    expect(wallCount(shell)).toBe(0);
  });

  it("previews the new wall with its live length, and draws an invalid preview red", () => {
    const shell = drawing();
    shell.moveTo({ x: 2, y: 0.05 });
    const scene = shell.scene();
    const layer = (name: string) => scene.layers.find((l) => l.name === name)?.primitives ?? [];
    expect(layer("walls").some((p) => p.kind === "polygon" && p.color === COLORS.preview)).toBe(true);
    expect(layer("annotations").some((p) => p.kind === "text" && p.text.startsWith("2.00 m"))).toBe(true);

    const blocked = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 6, y: 0 }));
    blocked.key("w");
    blocked.click({ x: 1, y: 0 });
    blocked.moveTo({ x: 5, y: 0 });
    const overlays = blocked.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
    expect(overlays.some((p) => p.kind === "segment" && p.color === COLORS.invalid && "m" in p.width)).toBe(true);
  });

  it("ends the chain on Esc but keeps its walls; a second Esc returns to Select", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    shell.key("Escape");
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(wallCount(shell)).toBe(1);
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("prompts for the next step in the command bar", () => {
    const shell = FakeShell.local();
    shell.key("w");
    expect(shell.view().commandBar.prompt).toBe("First point");
    shell.click({ x: 0, y: 0 });
    expect(shell.view().commandBar.prompt).toBe("Next point or length");
  });
});

describe("wall tool: routing carried over from wave 6 (spec §5.4)", () => {
  it("ignores a right-button press", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.down({ x: 0, y: 0 }, {}, 2);
    expect(wall(shell)).toEqual({ kind: "idle" });
  });

  it("types a length along the direction to the cursor's world point after a wheel pan", () => {
    const shell = drawing();
    shell.moveTo({ x: 3, y: 0 });
    shell.wheel(0, -320); // pans 4 m at zoom 80: the still cursor is now over (3, 4)
    shell.type("6");
    shell.key("Enter");
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 3.6, y: 4.8 });
  });

  it("drops the chain on an applied undo and rebuilds the snap at the unmoved cursor", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    expect(shell.view().snap).toEqual({ kind: "endpoint", at: { x: 2, y: 0 } });
    shell.key("z", { meta: true });
    expect(wallCount(shell)).toBe(0);
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(shell.view().snap).toEqual({ kind: "grid", at: { x: 2, y: 0 } });
  });
});

describe("wall tool: further §5.5 rules", () => {
  it("places points on the press, before any release", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.down({ x: 0, y: 0 });
    shell.moveTo({ x: 2, y: 0 });
    shell.down({ x: 2, y: 0 });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2, y: 0 });
  });

  it("snaps clicked points, and places them raw while Ctrl is held", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.click({ x: 0.03, y: -0.02 }); // within 10 px of the grid point (0, 0)
    shell.click({ x: 2.03, y: 0.07 }, { ctrl: true });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2.03, y: 0.07 });
  });

  it("refuses a zero length", () => {
    const shell = drawing();
    shell.moveTo({ x: 1, y: 0 });
    shell.type("0");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a length in metres");
    expect(wallCount(shell)).toBe(0);
  });

  it("keeps the typed value when the typed wall is rejected", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 6, y: 0 }));
    shell.key("w");
    shell.click({ x: 1, y: 0 });
    shell.moveTo({ x: 4, y: 0 });
    shell.type("2");
    shell.key("Enter"); // (1, 0) → (3, 0) overlaps the existing wall
    expect(shell.view().toast).toBe(MESSAGES.overlap);
    expect(wallCount(shell)).toBe(1);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 1, y: 0 }, value: "2" });
  });

  it("does not close the chain when a typed length lands on its first joint", () => {
    const shell = drawing();
    shell.click({ x: 3, y: 0 });
    shell.click({ x: 3, y: 4 });
    shell.moveTo({ x: 0, y: 0 });
    shell.type("5");
    shell.key("Enter");
    expect(wallCount(shell)).toBe(3);
    expect(Object.keys(shell.doc().joints)).toHaveLength(3);
    expect(wall(shell)).toMatchObject({ kind: "drawing", chainStart: { x: 0, y: 0 }, value: "" });
  });

  it("previews from the new origin to the cursor right after a typed placement", () => {
    const shell = drawing();
    shell.moveTo({ x: 0, y: 4 });
    shell.type("2");
    shell.key("Enter");
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 2 }, preview: { ok: true, from: { x: 0, y: 2 }, to: { x: 0, y: 4 } } });
  });

  // Review fix: each test below kills a named mutant.
  it("places a click at the clicked point and clears a typed value", () => {
    const shell = drawing();
    shell.type("3");
    shell.click({ x: 2, y: 0 });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, value: "" });
  });

  it("clears the snap glyph on Esc", () => {
    const shell = drawing();
    shell.moveTo({ x: 2, y: 0 });
    expect(shell.state.snap).not.toBeNull();
    shell.key("Escape");
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(shell.state.snap).toBeNull();
  });

  // Wave 7 code review: each test below is red on the reviewed code or kills a named mutant.
  it("refuses a typed length while the cursor rests on the origin", () => {
    const shell = drawing(); // the cursor is still on the origin
    shell.type("5");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Move the cursor to set a direction");
    expect(wallCount(shell)).toBe(0);
  });

  it("refuses a typed length exactly when there is no preview: cursor within 1 mm of the origin", () => {
    const shell = drawing();
    shell.moveTo({ x: 0.0005, y: 0 }, { ctrl: true }); // raw cursor 0.5 mm from the origin
    expect(wall(shell)).toMatchObject({ kind: "drawing", preview: null });
    shell.type("3");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Move the cursor to set a direction");
    expect(wallCount(shell)).toBe(0);
  });

  it("ignores a click on the chain's last point: no wall, no toast, value and preview kept", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    shell.type("3");
    const before = wall(shell);
    shell.click({ x: 2, y: 0 });
    expect(wall(shell)).toEqual(before);
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 2, y: 0 }, value: "3" });
    expect(wallCount(shell)).toBe(1);
    expect(shell.state.toast).toBeNull();

    const first = drawing();
    first.click({ x: 0, y: 0 }); // the chain's first point is also its last
    expect(wall(first)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 0 } });
    expect(first.state.toast).toBeNull();
  });
});

describe("wall tool: drag from the first point draws one wall (§5.5, U1)", () => {
  const hasPreview = (shell: FakeShell) =>
    shell.scene().layers.some((l) => l.primitives.some((p) => "color" in p && p.color === COLORS.preview));

  it("press at a joint, drag, release: one wall, the chain ends, no preview left", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 0, y: 3 }));
    shell.key("w");
    shell.drag({ x: 0, y: 0 }, { x: 3, y: 0 });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(wallCount(shell)).toBe(2);
    expect(wall(shell)).toEqual({ kind: "idle" });
    expect(hasPreview(shell)).toBe(false);
  });

  it("on a shared document: one submit, idle (not paused), and the wall settles on accepted", () => {
    const r = FakeRemote.open();
    r.shell.key("w");
    r.shell.drag({ x: 0, y: 0 }, { x: 3, y: 0 });
    expect(r.submits()).toHaveLength(1);
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    r.accept();
    expect(r.shell.state.undo.past.map((e) => e.status)).toEqual(["usable"]);
    wallBetween(r.shell.doc(), { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(wall(r.shell)).toEqual({ kind: "idle" });
  });

  it("a press released within 4 px is a click: the next click chains as before", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.moveTo({ x: 0, y: 0 });
    shell.down({ x: 0, y: 0 });
    shell.up({ x: 3 / shell.state.camera.zoom, y: 0 }); // 3 px
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 0 }, dragFrom: null });
    expect(wallCount(shell)).toBe(0);
    shell.click({ x: 3, y: 0 });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 3, y: 0 }, chainStart: { x: 0, y: 0 } });
  });

  it("a release past 4 px that snaps back onto the first point is a click, not a too-short wall", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.moveTo({ x: 0, y: 0 });
    shell.down({ x: 0, y: 0 });
    shell.up({ x: 5 / shell.state.camera.zoom, y: 0 }); // 5 px of hand jitter; the 0.2 m grid snaps it back to (0, 0)
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 0 }, dragFrom: null });
    expect(shell.view().toast).toBeNull();
    shell.click({ x: 3, y: 0 });
    wallBetween(shell.doc(), { x: 0, y: 0 }, { x: 3, y: 0 });
  });

  it("a refused drag shows a toast, ends idle and submits nothing", () => {
    const r = FakeRemote.open(wallDoc({ x: 1.5, y: -1 }, { x: 1.5, y: 1 }));
    r.shell.key("w");
    r.shell.drag({ x: 0, y: 0 }, { x: 3, y: 0 }); // crosses the wall at x = 1.5
    expect(r.shell.view().toast).toBe(MESSAGES.crossing);
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.submits()).toHaveLength(0);
    expect(wallCount(r.shell)).toBe(1);
  });

  it("mid-chain, a press-drag-release places on the press and the chain goes on", () => {
    const shell = drawing();
    shell.click({ x: 2, y: 0 });
    shell.drag({ x: 2, y: 2 }, { x: 4, y: 2 });
    expect(wallCount(shell)).toBe(2);
    wallBetween(shell.doc(), { x: 2, y: 0 }, { x: 2, y: 2 });
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 2, y: 2 }, chainStart: { x: 0, y: 0 } });
  });

  it("measures the threshold at the current zoom: after a zoom out, a 3 px move is still a click", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.moveTo({ x: 0, y: 0 });
    shell.down({ x: 0, y: 0 });
    const before = shell.state.camera.zoom;
    shell.wheel(0, 100 * Math.log(2), { ctrl: true }); // zoom at the cursor, halved
    expect(shell.state.camera.zoom).toBeCloseTo(before / 2);
    const release = { x: 3 / shell.state.camera.zoom, y: 0 }; // 3 px now, 6 px at the press's zoom
    shell.moveTo(release, { ctrl: true });
    shell.up(release, { ctrl: true });
    expect(wall(shell)).toMatchObject({ kind: "drawing", origin: { x: 0, y: 0 }, dragFrom: null });
    expect(wallCount(shell)).toBe(0);
  });

  it("a drag survives a remote move that does not touch the chain", () => {
    const r = FakeRemote.open(wallDoc({ x: 5, y: 5 }, { x: 7, y: 5 }));
    r.shell.key("w");
    r.shell.moveTo({ x: 0, y: 0 });
    r.shell.down({ x: 0, y: 0 });
    r.shell.moveTo({ x: 1.5, y: 0 });
    r.remote({ type: "moveJoints", moves: [{ jointId: jointAt(r.doc, { x: 7, y: 5 }), to: { x: 7, y: 6 } }] });
    r.shell.moveTo({ x: 3, y: 0 });
    r.shell.up({ x: 3, y: 0 });
    expect(wall(r.shell)).toEqual({ kind: "idle" });
    expect(r.submits()).toHaveLength(1);
    wallBetween(r.shell.doc(), { x: 0, y: 0 }, { x: 3, y: 0 });
  });

  it("a release with no press in the wall tool does nothing", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.up({ x: 1, y: 0 });
    expect(wall(shell)).toEqual({ kind: "idle" });
    const mid = drawing();
    mid.click({ x: 2, y: 0 });
    const before = wall(mid);
    mid.up({ x: 4, y: 0 });
    expect(wall(mid)).toEqual(before);
    expect(wallCount(mid)).toBe(1);
  });
});
