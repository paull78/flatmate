import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import { COLORS } from "../src/view/colors";
import { sceneDocument } from "../src/view/scene";
import { bed160x200, roomDoc, studioDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// studioDoc: bed/p0 in s0, anchor (1.5, 3), x 0.7–2.3, y 1–3, centred on (1.5, 2); the room's inner faces are at
// x 0.1 and 5.9, y 0.1 and 3.9. nearWall: the bed anchored at (0.92, 3), its left edge 2 cm from the face at 0.1.
// pair: nearWall plus the chair ch/p0 spanning x 3.775–4.225, y 2.55–3, centred on (4, 2.775).
const nearWall = () => withCommands(
  roomDoc(),
  { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 2, y: 3 } },
  bed160x200("bed/o0"),
  { type: "movePlacement", placementId: "bed/p0", at: { x: 0.92, y: 3 }, rotation: 0 },
);
const pair = () => withCommands(nearWall(), { type: "placeObject", deck: null, opId: "ch", state: "s0", object: { kind: "chair" }, at: { x: 4, y: 3 } });
const BED = { x: 1.5, y: 2 };
const NEAR_BED = { x: 1.3, y: 2 };
const CHAIR = { x: 4, y: 2.775 };
const piece = (id: string) => ({ table: "placements", id });

const at = (doc: Document | null, id = "bed/p0"): Point | undefined => doc?.placements[id]?.at;
const preview = (shell: FakeShell, id = "bed/p0") => at(sceneDocument(shell.state), id);

function kind(shell: FakeShell): string {
  const t = shell.state.tool;
  return t.name === "select" ? t.state.kind : t.name;
}

function run(shell: FakeShell) {
  const t = shell.state.tool;
  return t.name === "select" && t.state.kind === "nudging" ? t.state : null;
}

function nudgeTimers(shell: FakeShell) {
  return shell.effectsOf("startTimer").filter((e) => e.timerId === "nudge");
}

function overlays(shell: FakeShell) {
  return shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
}

/** The local editor with the bed selected. */
function bedSelected(doc: Document = studioDoc(), click: Point = BED): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(click);
  return shell;
}

/** A run of n ArrowRight presses, then the timer after 400 ms: a committed run. */
function commitRun(shell: FakeShell, presses = 1): void {
  for (let i = 0; i < presses; i++) shell.key("ArrowRight");
  shell.host.advance(400);
  shell.fireTimer("nudge");
}

describe("nudge run (AC-10)", () => {
  it("three ArrowRight presses preview 3 cm at once and commit once 400 ms after the last press", () => {
    const shell = bedSelected();
    shell.clearEffects();
    shell.key("ArrowRight");
    shell.host.advance(100);
    shell.key("ArrowRight");
    shell.host.advance(100);
    shell.key("ArrowRight");
    expect(preview(shell)?.x).toBeCloseTo(1.53, 6);
    expect(at(shell.doc())?.x).toBe(1.5);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(nudgeTimers(shell)).toEqual([0, 1, 2].map(() => ({ type: "startTimer", timerId: "nudge", ms: 400 })));
    shell.host.advance(200); // t = 400: 200 ms after the last press
    shell.clearEffects();
    shell.fireTimer("nudge");
    expect(shell.state.undo.past).toHaveLength(0);
    expect(nudgeTimers(shell)).toEqual([{ type: "startTimer", timerId: "nudge", ms: 200 }]);
    shell.host.advance(200); // t = 600
    shell.fireTimer("nudge");
    expect(at(shell.doc())?.x).toBeCloseTo(1.53, 6);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(kind(shell)).toBe("idle");
    expect(shell.state.selection).toEqual([piece("bed/p0")]);
    shell.key("z", { meta: true });
    expect(at(shell.doc())?.x).toBe(1.5);
  });

  it("Shift+ArrowRight moves 10 cm; ArrowUp moves +y and ArrowDown −y", () => {
    const shell = bedSelected();
    shell.key("ArrowRight", { shift: true });
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(at(shell.doc())?.x).toBeCloseTo(1.6, 6);
    shell.key("ArrowUp");
    shell.key("ArrowUp");
    shell.key("ArrowDown");
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(at(shell.doc())?.y).toBeCloseTo(3.01, 6);
    expect(at(shell.doc())?.x).toBeCloseTo(1.6, 6);
  });

  it("a press that would push the piece into a wall stays at its last valid place and shows red", () => {
    const shell = bedSelected(nearWall(), NEAR_BED);
    shell.key("ArrowLeft");
    shell.key("ArrowLeft");
    shell.key("ArrowLeft");
    expect(preview(shell)?.x).toBeCloseTo(0.9, 6);
    expect(run(shell)?.attempt.ok).toBe(false);
    const drawn = overlays(shell);
    expect(drawn.filter((p) => p.kind === "polygon")).toHaveLength(1);
    expect(drawn.filter((p) => p.kind === "disc" && p.color !== COLORS.warningLine && p.color !== COLORS.warningMark)).toHaveLength(0); // no grips; the bed's standing warning keeps its mark
    const xs = drawn.flatMap((p) => (p.kind === "polygon" ? p.points.map((q) => q.x) : []));
    expect(Math.min(...xs)).toBeCloseTo(0.09, 6); // the refused place (−3 cm), not the last valid one
    shell.key("ArrowRight"); // from the last valid offset (−2 cm), not the refused one (−3 cm)
    expect(preview(shell)?.x).toBeCloseTo(0.91, 6);
    expect(run(shell)?.attempt.ok).toBe(true);
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(at(shell.doc())?.x).toBeCloseTo(0.91, 6);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a group nudges as one changeset; one refused piece holds the whole group", () => {
    const shell = bedSelected(pair(), NEAR_BED);
    shell.click(CHAIR, { shift: true });
    expect(shell.state.selection).toEqual([piece("bed/p0"), piece("ch/p0")]);
    shell.key("ArrowDown");
    shell.key("ArrowDown");
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(at(shell.doc())?.y).toBeCloseTo(2.98, 6);
    expect(at(shell.doc(), "ch/p0")?.y).toBeCloseTo(2.98, 6);
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { meta: true });
    expect(at(shell.doc())?.y).toBe(3);
    expect(at(shell.doc(), "ch/p0")?.y).toBe(3);
    shell.key("ArrowLeft");
    shell.key("ArrowLeft");
    shell.key("ArrowLeft"); // the bed would cross the face at 0.1
    expect(run(shell)?.attempt.ok).toBe(false);
    expect(preview(shell, "ch/p0")?.x).toBeCloseTo(3.98, 6);
    expect(preview(shell)?.x).toBeCloseTo(0.9, 6);
  });

  it("arrows do nothing without selected furniture or outside the Select tool", () => {
    const cases: [string, (shell: FakeShell) => void][] = [
      ["nothing selected", () => {}],
      ["a wall selected", (shell) => shell.click({ x: 0, y: 2 })],
      ["the Object tool", (shell) => { shell.click(BED); shell.ui({ type: "pickKind", kind: "chair" }); }],
    ];
    for (const [name, setup] of cases) {
      const shell = FakeShell.withDocument(studioDoc());
      setup(shell);
      const before = shell.doc();
      shell.clearEffects();
      shell.key("ArrowRight");
      expect(shell.doc(), name).toBe(before);
      expect(nudgeTimers(shell), name).toEqual([]);
      expect(run(shell), name).toBeNull();
    }
  });

  it("Esc cancels the run", () => {
    const shell = bedSelected();
    shell.key("ArrowRight");
    shell.key("ArrowRight");
    shell.key("Escape");
    expect(kind(shell)).toBe("idle");
    expect(shell.state.selection).toEqual([piece("bed/p0")]);
    expect(preview(shell)?.x).toBe(1.5);
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(shell.state.undo.past).toHaveLength(0);
    expect(at(shell.doc())?.x).toBe(1.5);
  });

  it.each([
    ["Cmd+Z", (shell: FakeShell) => shell.key("z", { meta: true })],
    ["the Undo button", (shell: FakeShell) => shell.ui({ type: "undo" })],
  ])("%s cancels the run without undoing the edit before it", (_name, undo) => {
    const shell = bedSelected();
    commitRun(shell);
    expect(at(shell.doc())?.x).toBeCloseTo(1.51, 6);
    shell.key("ArrowRight");
    undo(shell);
    expect(kind(shell)).toBe("idle");
    expect(at(shell.doc())?.x).toBeCloseTo(1.51, 6);
    expect(preview(shell)?.x).toBeCloseTo(1.51, 6);
    expect(shell.state.undo.past).toHaveLength(1);
    undo(shell);
    expect(at(shell.doc())?.x).toBe(1.5);
  });

  it("Ctrl+Shift+Z and the Redo button cancel the run too", () => {
    for (const redo of [(s: FakeShell) => s.key("Z", { ctrl: true, shift: true }), (s: FakeShell) => s.ui({ type: "redo" })]) {
      const shell = bedSelected();
      commitRun(shell);
      expect(at(shell.doc())?.x).toBeCloseTo(1.51, 6);
      shell.key("z", { meta: true });
      shell.key("ArrowRight");
      expect(kind(shell)).toBe("nudging");
      redo(shell);
      expect(kind(shell)).toBe("idle");
      expect(at(shell.doc())?.x).toBe(1.5); // cancelled, not redone
      expect(shell.state.undo.future).toHaveLength(1);
    }
  });

  it.each<[string, (shell: FakeShell) => void]>([
    ["a click", (shell) => shell.click({ x: 2.31, y: 2 })], // inside the preview only
    ["a tool letter", (shell) => shell.key("w")],
    ["a tool button", (shell) => shell.ui({ type: "pickTool", tool: "wall" })],
    ["a command event", (shell) => { shell.command({ type: "addState", opId: "x", name: "X" }); }],
    ["Delete", (shell) => shell.key("Delete")],
    ["Alt+ArrowRight", (shell) => shell.key("ArrowRight", { alt: true })], // not a nudge
    ["Cmd+ArrowRight", (shell) => shell.key("ArrowRight", { meta: true })],
  ])("%s commits the run first", (name, trigger) => {
    const shell = bedSelected();
    shell.key("ArrowRight");
    shell.key("ArrowRight");
    trigger(shell);
    const first = shell.state.undo.past[0];
    expect(first?.patch.puts.some((p) => p.table === "placements" && p.entity.id === "bed/p0")).toBe(true);
    if (name === "Delete") {
      expect(at(shell.doc())).toBeUndefined();
      expect(shell.state.undo.past).toHaveLength(2);
      shell.key("z", { meta: true });
    }
    expect(at(shell.doc())?.x).toBeCloseTo(1.52, 6);
    if (name === "a click") expect(shell.state.selection).toEqual([piece("bed/p0")]);
  });

  it.each<[string, (shell: FakeShell) => void]>([
    ["the pointer moving", (shell) => shell.moveTo({ x: 3, y: 0.5 })],
    ["the wheel", (shell) => { shell.wheel(0, 50); }],
    ["a middle-button press", (shell) => { shell.down({ x: 3, y: 0.5 }, {}, 1); shell.up({ x: 3, y: 0.5 }, {}, 1); }],
    ["a Shift keydown", (shell) => shell.key("Shift", { shift: true })],
    ["a toast timer", (shell) => shell.fireTimer("toast")],
    ["an animation frame", (shell) => { shell.send({ type: "frame", now: shell.host.now() }); }],
  ])("%s keeps the run", (_name, trigger) => {
    const shell = bedSelected();
    shell.key("ArrowRight");
    shell.key("ArrowRight");
    trigger(shell);
    expect(kind(shell)).toBe("nudging");
    expect(shell.state.undo.past).toHaveLength(0);
    expect(preview(shell)?.x).toBeCloseTo(1.52, 6);
  });

  it("a stale nudge timer with no run is ignored", () => {
    const shell = bedSelected();
    shell.key("ArrowRight");
    shell.key("Escape");
    const before = shell.doc();
    shell.clearEffects();
    shell.fireTimer("nudge");
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.effectsOf("startTimer")).toEqual([]);
  });
});

/** Shared mode, with the bed selected. */
function remoteBed(): FakeRemote {
  const r = FakeRemote.open(studioDoc());
  r.shell.click(BED);
  return r;
}

const chairAt = (opId: string, state: string, x: number): Command => ({ type: "placeObject", deck: null, opId, state, object: { kind: "chair" }, at: { x, y: 3 } });

describe("nudge run, shared document", () => {
  it("the run is one submit; undo after the ack reverts it", () => {
    const r = remoteBed();
    r.shell.key("ArrowRight");
    r.shell.key("ArrowRight");
    r.shell.key("ArrowRight");
    expect(r.submits()).toHaveLength(0);
    r.shell.host.advance(400);
    r.shell.fireTimer("nudge");
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.shell.state.undo.past.at(-1)?.status).toBe("usable");
    expect(at(r.shell.doc())?.x).toBeCloseTo(1.53, 6);
    r.shell.key("z", { meta: true });
    r.accept();
    expect(at(r.shell.doc())?.x).toBe(1.5);
  });

  it("no run starts while an edit is in flight", () => {
    const r = remoteBed();
    r.shell.key("r");
    const turn = r.last();
    r.shell.key("ArrowRight");
    expect(kind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(nudgeTimers(r.shell)).toEqual([]);
    r.accept(turn);
    r.shell.key("ArrowRight");
    expect(kind(r.shell)).toBe("nudging");
  });

  it("the timer re-arms while an edit is in flight, then commits", () => {
    // White-box: no normal path reaches this guard, since a run starts only when edits can commit and the run is the
    // only edit it can make; the in-flight document is put back under the run by hand.
    const r = remoteBed();
    r.shell.key("r");
    const blocked = r.shell.state.document;
    r.accept();
    const settled = r.shell.state.document;
    const turnedX = at(r.shell.doc())?.x ?? NaN;
    r.shell.key("ArrowRight");
    r.shell.state = { ...r.shell.state, document: blocked };
    r.shell.host.advance(400);
    const armed = nudgeTimers(r.shell).length;
    r.shell.fireTimer("nudge");
    expect(r.submits()).toHaveLength(1);
    expect(nudgeTimers(r.shell).slice(armed)).toEqual([{ type: "startTimer", timerId: "nudge", ms: 400 }]);
    expect(kind(r.shell)).toBe("nudging");
    r.shell.state = { ...r.shell.state, document: settled };
    r.shell.host.advance(400);
    r.shell.fireTimer("nudge");
    expect(r.submits()).toHaveLength(2);
    expect(at(r.shell.doc())?.x).toBeCloseTo(turnedX + 0.01, 6);
  });

  it("Delete during a run commits the run and then waits for the server", () => {
    const r = remoteBed();
    r.shell.key("ArrowRight");
    r.shell.key("Delete");
    expect(r.submits()).toHaveLength(1);
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(at(r.shell.doc())?.x).toBeCloseTo(1.51, 6);
  });

  it("a remote write to a nudged piece cancels the run", () => {
    const r = remoteBed();
    r.shell.key("ArrowRight");
    r.remote({ type: "movePlacement", placementId: "bed/p0", at: { x: 1.5, y: 2.5 }, rotation: 0 });
    expect(kind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.host.advance(400);
    r.shell.fireTimer("nudge");
    expect(r.submits()).toHaveLength(0);
    expect(at(r.shell.doc())).toEqual({ x: 1.5, y: 2.5 });
  });

  it("an unrelated remote change reruns the run; a rerun that no longer fits falls back to no move, red", () => {
    const r = remoteBed();
    r.shell.key("ArrowRight");
    r.shell.key("ArrowRight");
    r.shell.key("ArrowRight");
    r.remote(chairAt("bob", "n/s0", 4.5));
    expect(kind(r.shell)).toBe("nudging");
    expect(run(r.shell)?.baseDoc.placements["bob/p0"]).toBeDefined();
    expect(preview(r.shell)?.x).toBeCloseTo(1.53, 6);

    const f = remoteBed();
    f.shell.key("ArrowRight");
    f.shell.key("ArrowRight");
    f.shell.key("ArrowRight");
    f.remote(chairAt("bob", "s0", 2.535)); // left edge 2.31: clear of the bed at rest, inside its +3 cm place
    expect(kind(f.shell)).toBe("nudging");
    expect(preview(f.shell)?.x).toBe(1.5);
    expect(run(f.shell)?.attempt.ok).toBe(false);
    expect(overlays(f.shell).filter((p) => p.kind === "polygon")).toHaveLength(2); // the refused bed and Bob's chair
    f.shell.key("ArrowLeft"); // the fallback reset the offset to 0, so this is −1 cm
    expect(preview(f.shell)?.x).toBeCloseTo(1.49, 6);
    f.shell.host.advance(400);
    f.shell.fireTimer("nudge");
    expect(f.submits()).toHaveLength(1);

    const g = remoteBed(); // the fallback alone commits nothing
    g.shell.key("ArrowRight");
    g.shell.key("ArrowRight");
    g.shell.key("ArrowRight");
    g.remote(chairAt("bob", "s0", 2.535));
    g.shell.host.advance(400);
    g.shell.fireTimer("nudge");
    expect(g.submits()).toHaveLength(0);
  });

  it("going offline cancels the run", () => {
    const r = remoteBed();
    r.shell.key("ArrowRight");
    r.disconnect();
    expect(kind(r.shell)).toBe("idle");
    expect(r.shell.view().toast).toBe(CONNECTION_LOST);
  });
});
