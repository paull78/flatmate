import { describe, expect, it } from "vitest";
import { execute, validateDocument, type Command, type Document } from "@fm/domain";
import { unwrap, type Point } from "@fm/protocol";
import { REST_TIMER } from "../src/plate";
import type { ObjectGhost } from "../src/tools/types";
import { clearRoomDoc, roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The red ghost's plate says what to do (sizing step 08; spec "Finding the drag", sizing.09, .15, .21 a): a second line,
// "Drag to draw it to size" for a plan reason, "Type a lower height" for a height reason on a kind with a Height field.
// roomDoc is 6 × 4 (inner faces x 0.1–5.9, y 0.1–3.9); the narrow room is 1.20 × 2.60 (inner x 0.1–1.3, y 0.1–2.7).

const DRAW = "Drag to draw it to size";
const HEIGHT = "Type a lower height";
const UNDER: Point = { x: 1.5, y: 2 };

/** `doc` with `cmds` applied, each checked to succeed: a fixture that quietly failed would test nothing. */
function withChecked(doc: Document, ...cmds: Command[]): Document {
  let d = doc;
  for (const cmd of cmds) {
    const r = execute(d, cmd);
    expect(r.ok, JSON.stringify(cmd)).toBe(true);
    d = unwrap(r).doc;
  }
  expect(validateDocument(d).ok).toBe(true);
  return d;
}
const hollowOver = (underside: number): Command => ({ type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.6, y: 2 }, w: 3, d: 3.8, top: underside + 0.12, solid: false });
const place = (opId: string, kind: string, at: Point): Command => ({ type: "placeObject", opId, state: "s0", object: { kind }, at, rotation: 0, deck: null });

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const texts = (shell: FakeShell): string[] => (shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));

/** Arms `kind` (or a set), moves to `at`, checks the ghost is red, and rests. */
function restOver(doc: Document, kind: string, at: Point, set = false): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui(set ? { type: "pickSet", set: kind } : { type: "pickKind", kind });
  shell.moveTo(at);
  expect(ghost(shell)?.fits, `${kind} at ${JSON.stringify(at)} should be red`).toBe(false);
  shell.fireTimer(REST_TIMER);
  return shell;
}

describe("the advice line (sizing step 08)", () => {
  it("AC-09: a bed in a 1.20 m room: the reason and `Drag to draw it to size`; a set there: the reason only", () => {
    const bed = restOver(clearRoomDoc(1.2, 2.6, "nb"), "bed", { x: 0.7, y: 1.4 });
    expect(bed.state.plate?.advice).toBe(DRAW);
    expect(texts(bed)).toEqual([bed.state.plate?.text, DRAW]);
    const set = restOver(clearRoomDoc(1.2, 2.6, "nb"), "bedAndNightstands", { x: 0.7, y: 1.4 }, true);
    expect(set.state.plate?.text).toBeTruthy();
    expect(set.state.plate?.advice).toBeUndefined();
    expect(texts(set)).toHaveLength(1);
  });

  it("AC-18: a wardrobe under a 1.40 underside: `Type a lower height`", () => {
    const shell = restOver(withChecked(roomDoc(), hollowOver(1.4)), "wardrobe", UNDER);
    expect(shell.state.plate?.advice).toBe(HEIGHT);
  });

  it("AC-20: a Murphy bed under a loft lower than it: the reason, no second line", () => {
    const shell = restOver(withChecked(roomDoc(), hollowOver(2.03)), "murphyBed", UNDER);
    expect(shell.state.plate?.text).toContain("Murphy bed");
    expect(shell.state.plate?.advice).toBeUndefined();
  });

  it("a wardrobe across a platform's edge: draw (it stays refused at the lowest height)", () => {
    const platform: Command = { type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.6, y: 2 }, w: 3, d: 3.8 };
    const shell = restOver(withChecked(roomDoc(), platform), "wardrobe", { x: 3.15, y: 2 });
    expect(shell.state.plate?.advice).toBe(DRAW);
  });

  it("a wardrobe over a coffee table: draw; under a wall cabinet hung at 1.40: height", () => {
    const table = restOver(withChecked(roomDoc(), place("t", "coffeeTable", { x: 4.5, y: 2.3 })), "wardrobe", { x: 4.5, y: 2.1 });
    expect(table.state.plate?.advice).toBe(DRAW);
    const cabinet = restOver(withChecked(roomDoc(), place("c", "wallCabinet", { x: 4.5, y: 2.3 })), "wardrobe", { x: 4.5, y: 2.1 });
    expect(cabinet.state.plate?.advice).toBe(HEIGHT);
  });

  it("a ghost outside every room: draw", () => {
    const shell = restOver(roomDoc(), "bed", { x: 9, y: 2 });
    expect(shell.state.plate?.advice).toBe(DRAW);
  });

  it("a red drawn ghost: no second line", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 0.5, y: 1 });
    shell.down({ x: 0.5, y: 1 });
    shell.moveTo({ x: -0.2, y: 1.3 });
    shell.moveTo({ x: -0.5, y: 1.6 });
    expect(ghost(shell)?.fits).toBe(false);
    shell.fireTimer(REST_TIMER);
    expect(shell.state.plate?.text).toBeTruthy();
    expect(shell.state.plate?.advice).toBeUndefined();
  });

  it("a stair kind with no edge caught, across a wall: draw", () => {
    const shell = restOver(roomDoc(), "stair", { x: 0.3, y: 2 });
    expect(shell.state.plate?.advice).toBe(DRAW);
  });

  it("the sticky plate after a refused click keeps the reason only; the toast is the reason", () => {
    const shell = FakeShell.withDocument(clearRoomDoc(1.2, 2.6, "nb"));
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.moveTo({ x: 0.7, y: 1.4 });
    shell.click({ x: 0.7, y: 1.4 });
    expect(shell.state.plate?.sticky).toBe(true);
    expect(shell.state.plate?.advice).toBeUndefined();
    expect(shell.view().toast).toBe(shell.state.plate?.text);
  });

  it("in a 400 px wide view both lines stay inside it", () => {
    const shell = FakeShell.withDocument(clearRoomDoc(1.2, 2.6, "nb"));
    shell.state = { ...shell.state, camera: { ...shell.state.camera, viewport: { width: 400, height: 800 } } };
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.moveTo({ x: 0.7, y: 1.4 });
    shell.fireTimer(REST_TIMER);
    const box = (shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? []).find((p) => p.kind === "polygon");
    if (!box || box.kind !== "polygon") throw new Error("no plate");
    const camera = shell.state.camera;
    const xs = box.points.map((p) => (p.x - camera.center.x) * camera.zoom + 200);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(400);
    expect(texts(shell)).toHaveLength(2);
  });
});
