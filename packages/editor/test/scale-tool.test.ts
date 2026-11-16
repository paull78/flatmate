import { describe, expect, it } from "vitest";
import { UNDERLAY_ID, type Command, type Document, type Underlay } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { screenToWorld, worldToScreen } from "../src/camera";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The Scale tool (import.02, .13; AC-03, AC-09): two unsnapped clicks and a typed distance send one scaleUnderlay.
// UNDER's picture is 1000 × 700 px at 0.01 m/px with its top-left at (-1.37, 4.21): x −1.37…8.63, y −2.79…4.21.
// A is picture pixel (130.5, 77.25); B = A + (2.4, −3.2) is pixel (370.5, 397.25), 400 px away on a slanted line.

const P = (x: number, y: number): Point => ({ x, y });
const placeUnder: Command = { type: "placeUnderlay", pictureId: "pic-1", data: "/9j/4AAQSkZJRg-marker", width: 1000, height: 700, at: P(-1.37, 4.21) };
const UNDER = withCommands(roomDoc(), placeUnder);
const A = P(-0.065, 3.4375);
const B = P(2.335, 0.2375);

function row(doc: Document): Underlay {
  const u = doc.underlays[UNDERLAY_ID];
  if (!u) throw new Error("no underlay row");
  return u;
}

const pixelOf = (u: Underlay, p: Point): Point => ({ x: (p.x - u.at.x) / u.metresPerPixel, y: (u.at.y - p.y) / u.metresPerPixel });

const tool = (shell: FakeShell) => {
  const t = shell.state.tool;
  return t.name === "scale" ? t.state : null;
};
const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const prompt = (shell: FakeShell): string => shell.view().commandBar.prompt;

/** UNDER at zoom 113 centred on (0.9, 1.6), as tags.test.ts sets the camera, with the Scale tool picked. */
function armed(doc: Document = UNDER): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom: 113, center: P(0.9, 1.6) } };
  shell.ui({ type: "pickTool", tool: "scale" });
  return shell;
}

/** A, B and the distance typed, waiting for Enter. */
function typing(value = "5"): FakeShell {
  const shell = armed();
  shell.click(A);
  shell.click(B);
  shell.type(value);
  return shell;
}

function expectPoint(p: Point | undefined, q: Point, digits = 9): void {
  expect(p?.x).toBeCloseTo(q.x, digits);
  expect(p?.y).toBeCloseTo(q.y, digits);
}

describe("the Scale tool (import.13)", () => {
  it("two clicks 400 px apart and 5 give 0.0125 m/px, scaled, about the first point (AC-03)", () => {
    const shell = typing("5");
    const before = row(shell.doc());
    const camera = shell.state.camera;
    const firstScreen = worldToScreen(camera, A);
    const walls = shell.doc().walls;
    const joints = shell.doc().joints;
    shell.key("Enter");
    const u = row(shell.doc());
    expect(u.metresPerPixel).toBeCloseTo(0.0125, 12);
    expect(u.scaled).toBe(true);
    expectPoint(u.at, P(-1.69625, 4.403125));
    const px = pixelOf(u, A);
    expect(px.x).toBeCloseTo(130.5, 6);
    expect(px.y).toBeCloseTo(77.25, 6);
    expect(worldToScreen(shell.state.camera, A)).toEqual(firstScreen);
    expect(shell.state.camera).toEqual(camera);
    const rect = shell.scene().underlay?.rect;
    expect(rect?.minX).toBeCloseTo(-1.69625, 9);
    expect(rect?.maxX).toBeCloseTo(10.80375, 9);
    expect(rect?.minY).toBeCloseTo(-4.346875, 9);
    expect(rect?.maxY).toBeCloseTo(4.403125, 9);
    expect(shell.doc().walls).toEqual(walls);
    expect(shell.doc().joints).toEqual(joints);
    expect([u.pictureId, u.data, u.width, u.height]).toEqual([before.pictureId, before.data, before.width, before.height]);
  });

  it("one Undo restores the previous row exactly; Redo re-applies it (AC-03)", () => {
    const shell = typing("5");
    const before = row(shell.doc());
    const past = shell.state.undo.past.length;
    shell.key("Enter");
    expect(shell.state.undo.past.length).toBe(past + 1);
    const scaled = row(shell.doc());
    shell.key("z", { ctrl: true });
    expect(row(shell.doc())).toEqual(before);
    expect(before.metresPerPixel).toBe(0.01);
    expect(before.scaled).toBe(false);
    shell.key("z", { ctrl: true, shift: true });
    expect(row(shell.doc())).toEqual(scaled);
  });

  it("the tool and the command store the same row (AC-09)", () => {
    const viaTool = typing("5");
    viaTool.key("Enter");
    const viaCommand = FakeShell.withDocument(UNDER);
    viaCommand.command({ type: "scaleUnderlay", a: A, b: B, distance: 5 });
    const t = row(viaTool.doc());
    const c = row(viaCommand.doc());
    expect([t.pictureId, t.mime, t.data, t.width, t.height, t.scaled]).toEqual([c.pictureId, c.mime, c.data, c.width, c.height, c.scaled]);
    expectPoint(t.at, c.at);
    expect(t.metresPerPixel).toBeCloseTo(c.metresPerPixel, 9);
  });

  it("clicks never snap", () => {
    const shell = armed();
    const near = P(0.06, 3.95); // 0.078 m from joint (0, 4): 8.8 px at zoom 113, inside the 10 px tolerance
    shell.moveTo(near);
    expect(shell.view().snap).toBeNull();
    shell.down(near);
    shell.up(near);
    expect(shell.view().snap).toBeNull();
    const t = tool(shell);
    expect(t?.kind).toBe("second");
    expectPoint(t?.kind === "second" ? t.a : undefined, near);
    shell.moveTo(B);
    expect(shell.view().snap).toBeNull();
    shell.click(B);
    expect(shell.view().snap).toBeNull();
  });

  it("the rubber band and the marks", () => {
    const shell = armed();
    const C = P(1.7, -0.4);
    shell.click(A);
    shell.moveTo(C);
    const band = overlays(shell);
    const segments = band.flatMap((p) => (p.kind === "segment" ? [p] : []));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ width: { px: 1 }, cap: "butt", dash: [4, 3] });
    expectPoint(segments[0]?.a, A);
    expectPoint(segments[0]?.b, C);
    const discs = band.flatMap((p) => (p.kind === "disc" ? [p] : []));
    expect(discs).toHaveLength(1);
    expect(discs[0]?.radius).toEqual({ px: 3 });
    expectPoint(discs[0]?.center, A);

    shell.send({ type: "pointerLeave" });
    expect(overlays(shell)).toEqual([]);

    shell.click(B);
    const typed = () => {
      const ps = overlays(shell);
      const segs = ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
      expect(segs).toHaveLength(1);
      expectPoint(segs[0]?.a, A);
      expectPoint(segs[0]?.b, B);
      const marks = ps.flatMap((p) => (p.kind === "disc" ? [p.center] : []));
      expect(marks).toHaveLength(2);
      expectPoint(marks[0], A);
      expectPoint(marks[1], B);
    };
    shell.moveTo(C);
    typed();
    shell.send({ type: "pointerLeave" });
    typed(); // the typing stage still draws A→B
  });

  it("prompts, value field and cursor", () => {
    const shell = armed();
    const vm = shell.view();
    expect(vm.commandBar.prompt).toBe("Click the first point on the picture");
    expect(vm.cursor).toBe("crosshair");
    expect(vm.toolHelp).toEqual({ tool: "scale", label: "Scale", key: "", hint: "Click the first point on the picture" });
    shell.click(A);
    expect(prompt(shell)).toBe("Click the second point");
    shell.click(B);
    expect(prompt(shell)).toBe("Real distance between the points");
    shell.type("5.2");
    expect(shell.view().commandBar).toEqual({ prompt: "Real distance between the points", value: "5.2", unit: "m", chips: [] });
    shell.key("Backspace");
    expect(shell.view().commandBar.value).toBe("5.");
    expect(shell.view().cursor).toBe("crosshair");
  });

  it("a bad distance toasts and keeps the points", () => {
    const shell = typing("0");
    const past = shell.state.undo.past.length;
    const stage = tool(shell);
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a distance in metres");
    expect(tool(shell)).toEqual(stage);
    shell.state = { ...shell.state, toast: null };
    shell.key("Backspace");
    shell.type(".");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Can't read .");
    expect(tool(shell)).toMatchObject({ kind: "typing", value: "." });
    shell.state = { ...shell.state, toast: null };
    shell.key("Backspace");
    const empty = tool(shell);
    shell.key("Enter");
    expect(tool(shell)).toEqual(empty);
    expect(empty?.kind).toBe("typing");
    expect(shell.view().toast).toBeNull();
    expect(shell.state.undo.past.length).toBe(past);
    expect(row(shell.doc()).scaled).toBe(false);
  });

  it("a second click within 4 px of A is ignored; a third click is ignored", () => {
    const shell = armed();
    shell.click(A);
    shell.click(P(A.x + 0.03, A.y)); // 3.4 px at zoom 113
    expect(tool(shell)?.kind).toBe("second");
    shell.click(B);
    shell.type("5");
    const stage = tool(shell);
    shell.click(P(4, -1));
    expect(tool(shell)).toEqual(stage);
    expect(stage?.kind).toBe("typing");
  });

  it("Escape cancels, a second Escape picks Select", () => {
    const shell = typing("5");
    const before = row(shell.doc());
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("scale");
    expect(tool(shell)).toEqual({ kind: "idle" });
    expect(row(shell.doc())).toEqual(before);
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");

    const second = armed();
    second.click(A);
    second.key("Escape");
    expect(tool(second)).toEqual({ kind: "idle" });
  });

  it("success returns to Select", () => {
    const shell = typing("5");
    shell.key("Enter");
    expect(shell.view().activeTool).toBe("select");
  });

  it("a scale that changes nothing still returns to Select, with no entry and no toast", () => {
    // At the default camera these points survive world → screen → world exactly, so k is exactly 1 on a scaled row.
    const shell = FakeShell.withDocument(UNDER);
    shell.command({ type: "scaleUnderlay", a: P(0, 0), b: P(4, 0), distance: 4 });
    const before = row(shell.doc());
    expect(before.scaled).toBe(true);
    const past = shell.state.undo.past.length;
    shell.ui({ type: "pickTool", tool: "scale" });
    shell.click(P(0, 0));
    shell.click(P(4, 0));
    shell.type("4");
    expect(tool(shell)).toEqual({ kind: "typing", a: P(0, 0), b: P(4, 0), value: "4" });
    shell.key("Enter");
    expect(shell.view().activeTool).toBe("select");
    expect(shell.state.undo.past.length).toBe(past);
    expect(shell.view().toast).toBeNull();
    expect(row(shell.doc())).toEqual(before);
  });

  it("with no underlay the clicks do nothing", () => {
    const shell = armed(roomDoc());
    expect(prompt(shell)).toBe("Choose a picture first");
    const past = shell.state.undo.past.length;
    shell.click(A);
    shell.click(B);
    expect(tool(shell)).toEqual({ kind: "idle" });
    shell.type("5");
    shell.key("Enter");
    expect(shell.state.undo.past.length).toBe(past);
    expect(shell.view().toast).toBeNull();
    expect(shell.doc().underlays).toEqual({});
  });
});

describe("the Scale tool and other edits (CRITIC 5)", () => {
  /** A server-mode editor on UNDER with the Scale tool and A clicked. */
  function remoteSecond(): FakeRemote {
    const r = FakeRemote.open(UNDER);
    r.shell.ui({ type: "pickTool", tool: "scale" });
    r.shell.click(A);
    return r;
  }

  const remoteWrites: [string, Command][] = [
    ["scaleUnderlay", { type: "scaleUnderlay", a: P(0, 0), b: P(1, 0), distance: 2 }],
    ["removeUnderlay", { type: "removeUnderlay" }],
    ["placeUnderlay", { type: "placeUnderlay", pictureId: "pic-2", data: "/9j/bob", width: 640, height: 480, at: P(0, 0) }],
  ];

  it.each(remoteWrites)("a remote %s cancels a half-done scale; a remote wall does not", (_name, cmd) => {
    const r = remoteSecond();
    r.remote({ type: "addWall", opId: "bob-op", from: { at: P(10, 10) }, to: { at: P(12, 10) } });
    const t = tool(r.shell);
    expect(t?.kind).toBe("second");
    expectPoint(t?.kind === "second" ? t.a : undefined, A);
    expect(r.shell.view().toast).toBeNull();
    r.shell.click(B);
    r.shell.type("5");
    expect(tool(r.shell)?.kind).toBe("typing");
    r.remote(cmd);
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.key("Enter");
    expect(r.submits()).toEqual([]);
  });

  it("a remote write to the row leaves an idle Scale tool quiet", () => {
    const r = FakeRemote.open(UNDER);
    r.shell.ui({ type: "pickTool", tool: "scale" });
    r.remote({ type: "scaleUnderlay", a: P(0, 0), b: P(1, 0), distance: 2 });
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBeNull();
  });

  it("a blocked scale keeps A, B and the value; Enter sends it once the server answers", () => {
    const r = FakeRemote.open(UNDER);
    const scale = () => {
      r.shell.ui({ type: "pickTool", tool: "scale" });
      r.shell.click(A);
      r.shell.click(B);
      r.shell.type("5");
      r.shell.key("Enter");
    };
    scale();
    expect(r.submits()).toHaveLength(1); // pending
    scale();
    expect(r.shell.view().toast).toBe("Waiting for server");
    const t = tool(r.shell);
    expect(t).toMatchObject({ kind: "typing", value: "5" });
    expectPoint(t?.kind === "typing" ? t.a : undefined, A);
    expectPoint(t?.kind === "typing" ? t.b : undefined, B);
    r.accept();
    r.shell.key("Enter");
    expect(r.submits()).toHaveLength(2);
    expect(r.shell.view().activeTool).toBe("select");
  });

  it("a rejected own import drops a scale clicked on the new picture", () => {
    const r = FakeRemote.open(UNDER);
    r.shell.ui({ type: "pickTool", tool: "scale" });
    r.shell.ui({ type: "importUnderlay", result: { ok: true, data: "/9j/other", width: 640, height: 900 } });
    expect(r.submits()).toHaveLength(1); // pending
    r.shell.click(A);
    r.shell.click(B);
    r.shell.type("5");
    r.reject();
    expect(row(r.shell.doc()).pictureId).toBe("pic-1");
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe("Someone else changed this first");
    r.shell.key("Enter");
    expect(r.submits()).toHaveLength(1);
  });

  it("a snapshot or lost connection drops a half-done scale", () => {
    const r = remoteSecond();
    r.snapshot();
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);

    const off = remoteSecond();
    off.disconnect();
    expect(tool(off.shell)).toEqual({ kind: "idle" });
    expect(off.shell.view().toast).toBe(CONNECTION_LOST);

    const quiet = FakeRemote.open(UNDER);
    quiet.shell.ui({ type: "pickTool", tool: "scale" });
    quiet.snapshot();
    expect(quiet.shell.view().toast).toBeNull();
    quiet.disconnect();
    expect(quiet.shell.view().toast).toBeNull();
  });

  it("a local import or remove resets the tool", () => {
    const shell = typing("5");
    shell.ui({ type: "importUnderlay", result: { ok: true, data: "/9j/other", width: 640, height: 900 } });
    expect(shell.view().activeTool).toBe("scale");
    expect(tool(shell)).toEqual({ kind: "idle" });
    expect(row(shell.doc())).toMatchObject({ data: "/9j/other", scaled: false, metresPerPixel: 0.01 });

    const other = armed();
    other.click(A);
    other.ui({ type: "removeUnderlay" });
    expect(tool(other)).toEqual({ kind: "idle" });
    expect(prompt(other)).toBe("Choose a picture first");

    const refused = armed();
    refused.click(A);
    refused.ui({ type: "importUnderlay", result: { ok: false, reason: "unreadable" } });
    expect(tool(refused)).toEqual({ kind: "idle" });
  });
});

/** mulberry32, copied from packages/domain/test/helpers.ts: editor tests don't import domain test helpers. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("seeded fuzz (AC-09)", () => {
  it("tool equals command, first point fixed (200 runs)", () => {
    const SEED = 0x5ca1e;
    const next = rng(SEED);
    const between = (lo: number, hi: number) => lo + (hi - lo) * next();
    const whole = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
    let runs = 0;
    for (let i = 0; runs < 200; i += 1) {
      const at = P(between(-20, 20), between(-20, 20));
      const doc = withCommands(roomDoc(), { type: "placeUnderlay", pictureId: "pic-f", data: "/9j/fuzz", width: whole(50, 2000), height: whole(50, 2000), at });
      const zoom = between(20, 400);
      const center = P(between(-10, 10), between(-10, 10));
      const sa = P(between(20, 1180), between(20, 780));
      const sb = P(between(20, 1180), between(20, 780));
      const typed = between(0.05, 60).toFixed(3);
      if (Math.hypot(sb.x - sa.x, sb.y - sa.y) <= 5) continue; // the tool ignores a second press within 4 px of A
      runs += 1;
      const label = `seed ${SEED} run ${i}`;
      const viaTool = FakeShell.withDocument(doc);
      viaTool.state = { ...viaTool.state, camera: { ...viaTool.state.camera, zoom, center } };
      const a = screenToWorld(viaTool.state.camera, sa);
      const b = screenToWorld(viaTool.state.camera, sb);
      const before = row(doc);
      viaTool.ui({ type: "pickTool", tool: "scale" });
      viaTool.click(a);
      viaTool.click(b);
      viaTool.type(typed);
      viaTool.key("Enter");
      const viaCommand = FakeShell.withDocument(doc);
      viaCommand.command({ type: "scaleUnderlay", a, b, distance: Number(typed) });
      const t = row(viaTool.doc());
      const c = row(viaCommand.doc());
      expect(c.scaled, label).toBe(true);
      expect(t.scaled, label).toBe(true);
      expect(Math.abs(t.metresPerPixel - c.metresPerPixel) / c.metresPerPixel, label).toBeLessThan(1e-9);
      expect(Math.hypot(t.at.x - c.at.x, t.at.y - c.at.y), label).toBeLessThan(1e-9 * Math.max(1, Math.hypot(c.at.x, c.at.y)));
      const p0 = pixelOf(before, a);
      const p1 = pixelOf(t, a);
      expect(Math.hypot(p1.x - p0.x, p1.y - p0.y), label).toBeLessThan(1e-6);
      expect(viaTool.doc().walls, label).toEqual(doc.walls);
    }
  });
});
