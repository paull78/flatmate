import { describe, expect, it } from "vitest";
import { footprintQuad, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { drawnFootprint } from "../src/snapping/drawn-footprint";
import type { ObjectGhost } from "../src/tools/types";
import { nichesDoc, roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// R turns a footprint being drawn (sizing step 10; spec "While a footprint is drawn", sizing.07): a quarter turn
// counter-clockwise inside the same rectangle, over both facing rules, for that drag only. roomDoc is 6 × 4 (inner
// faces x 0.1–5.9, y 0.1–3.9); nichesDoc has a wardrobe niche (back wall at y 3.9, x 1.1–2.3) and a bed alcove.

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const placed = (shell: FakeShell) => Object.values(shell.doc().placements).map((p) => ({ at: p.at, rotation: p.rotation, object: shell.doc().objects[p.object] }));
const corners = (g: ObjectGhost) => footprintQuad(g.at, g.w, g.d, g.rotation).map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).sort();

function drawing(doc: Document, kind: string, a: Point, b: Point): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind });
  shell.moveTo(a);
  shell.down(a);
  shell.moveTo({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  shell.moveTo(b);
  return shell;
}

describe("R turns the drawn piece (sizing step 10)", () => {
  it("AC-04: 1.20 × 0.60 in open floor, one R: W 0.60 × D 1.20 in the same rectangle; the release places it turned", () => {
    const shell = drawing(roomDoc(), "wardrobe", { x: 2, y: 2 }, { x: 3.2, y: 1.4 });
    const before = ghost(shell);
    if (!before) throw new Error("no ghost");
    expect(before).toMatchObject({ w: 1.2, d: 0.6 });
    shell.key("r");
    const after = ghost(shell);
    if (!after) throw new Error("no ghost");
    expect(after).toMatchObject({ w: 0.6, d: 1.2, rotation: (before.rotation + 90) % 360 });
    expect(corners(after)).toEqual(corners(before));
    shell.up({ x: 3.2, y: 1.4 });
    expect(placed(shell)).toEqual([expect.objectContaining({ rotation: after.rotation, object: expect.objectContaining({ w: { standard: 0.6 }, d: { standard: 1.2 } }) })]);
  });

  it("four R presses come back to the first facing; two put the back on the opposite side", () => {
    const shell = drawing(roomDoc(), "wardrobe", { x: 2, y: 2 }, { x: 3.2, y: 1.4 });
    const first = ghost(shell)?.rotation ?? -1;
    shell.key("r");
    shell.key("r");
    expect(ghost(shell)?.rotation).toBe((first + 180) % 360);
    shell.key("r");
    shell.key("r");
    expect(ghost(shell)?.rotation).toBe(first);
  });

  it("AC-05: in the wardrobe niche the back starts on its back wall; one R puts it on a side wall, and the release places that", () => {
    const shell = drawing(nichesDoc(), "wardrobe", { x: 1.13, y: 3.87 }, { x: 2.27, y: 3.33 });
    expect(ghost(shell)).toMatchObject({ rotation: 0, w: 1.2, d: 0.6 });
    shell.key("r");
    expect(ghost(shell)).toMatchObject({ rotation: 90, w: 0.6, d: 1.2 });
    shell.up({ x: 2.27, y: 3.33 });
    expect(placed(shell)).toEqual([expect.objectContaining({ rotation: 90 })]);
  });

  it("after a press beside a wall (the press ghost turned by contact) R still turns the drawn piece", () => {
    const shell = drawing(roomDoc(), "wardrobe", { x: 0.2, y: 2 }, { x: 1.4, y: 1.4 });
    const first = ghost(shell)?.rotation ?? -1;
    shell.key("r");
    expect(ghost(shell)?.rotation).toBe((first + 90) % 360);
  });

  it("AC-06: R turns a red drawn ghost, and a bed across the alcove turns green", () => {
    const shell = drawing(nichesDoc(), "bed", { x: 3.13, y: 0.13 }, { x: 3.98, y: 2.07 });
    const first = ghost(shell)?.rotation ?? -1;
    shell.key("r");
    expect(ghost(shell)?.rotation).toBe((first + 90) % 360);
    const red = drawing(roomDoc(), "wardrobe", { x: 0.5, y: 1 }, { x: -0.5, y: 1.6 });
    expect(ghost(red)?.fits).toBe(false);
    const r0 = ghost(red)?.rotation ?? -1;
    red.key("r");
    expect(ghost(red)?.rotation).toBe((r0 + 90) % 360);
  });

  it("the turn ends with the drag: after the release the click ghost has the angle it had before the press", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 3, y: 2 });
    const clickAngle = ghost(shell)?.rotation;
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3.6, y: 1.7 });
    shell.moveTo({ x: 4.2, y: 1.4 });
    shell.key("r");
    shell.up({ x: 4.2, y: 1.4 });
    shell.moveTo({ x: 3, y: 3 });
    expect(ghost(shell)?.rotation).toBe(clickAngle);
    expect(shell.state.tool.name === "object" && shell.state.tool.state.rotation).toBe(0);
  });

  it("Esc mid-drag: the tool is Select, and the later release places nothing", () => {
    const shell = drawing(roomDoc(), "wardrobe", { x: 2, y: 2 }, { x: 3.2, y: 1.4 });
    shell.key("r");
    shell.key("Escape");
    expect(shell.state.tool.name).toBe("select");
    shell.up({ x: 3.2, y: 1.4 });
    expect(placed(shell)).toEqual([]);
  });

  it("R before any drag still turns the click ghost's start angle", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 3, y: 2 });
    shell.key("r");
    expect(ghost(shell)?.rotation).toBe(90);
  });

  it("R during a set's press still turns the set", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickSet", set: "bedAndNightstands" });
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3.5, y: 2.4 });
    const before = ghost(shell)?.rotation ?? -1;
    shell.key("r");
    expect(ghost(shell)?.rotation).toBe((before + 90) % 360);
  });

  it("a spiral stair's drawn box stays square under R", () => {
    const shell = drawing(roomDoc(), "spiralStair", { x: 2, y: 2 }, { x: 3.4, y: 1.0 });
    shell.key("r");
    const g = ghost(shell);
    expect(g?.w).toBe(g?.d);
  });

  it("drawnFootprint: for each rule rotation and 0 to 3 turns, `at` is the middle of the turned back edge, to the mm", () => {
    const doc = roomDoc();
    const a = { x: 2, y: 1 };
    const b = { x: 3.2, y: 1.6 };
    for (const start of [0, 90, 180, 270]) {
      for (const turns of [0, 1, 2, 3]) {
        const f = drawnFootprint(doc, a, b, start, undefined, turns);
        expect(f.rotation).toBe((start + 90 * turns) % 360);
        const quad = footprintQuad(f.at, f.w, f.d, f.rotation);
        const xs = quad.map((p) => p.x).sort((p, q) => p - q);
        const ys = quad.map((p) => p.y).sort((p, q) => p - q);
        expect([xs[0], xs[3], ys[0], ys[3]].map((v) => Math.round((v ?? 0) * 1000) / 1000)).toEqual([2, 3.2, 1, 1.6]); // the same rectangle
      }
    }
  });
});
