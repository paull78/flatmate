import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Touch to turn for an `L` (catalog.42, step 16; AC-03): an `ell` piece's back and left sides are both outer sides, so a
// left side touching a wall face only straightens the piece and snaps it flush, never turns it; a plain piece's left
// side still turns to the back (furnish.16), and the corner snap still turns the L into each room corner (furnish.18).
// roomDoc: 6 × 4 m, inner faces x 0.1 / 5.9, y 0.1 / 3.9; zoom 80, so the tolerance is 0.125 m.

const place = (opId: string, kind: string, at: Point, rotation = 0): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at, rotation });
/** The hands-on desk: 2.40 × 2.00, arms 0.60. */
const bigDesk = (at: Point, rotation: number): Document =>
  withCommands(roomDoc(), place("k", "cornerDesk", at, rotation), { type: "setObjectSize", objectId: "k/o0", w: 2.4, d: { standard: 2 } });
const placed = (shell: FakeShell, id: string) => shell.doc().placements[id];

describe("an L's left side on a wall is a back: dragged along it, it keeps its turn", () => {
  it("at 0° along the left wall, 0.40 m below the top wall, its left side stays flush on x 0.1", () => {
    // Anchored at (1.3, 3.5): x 0.1–2.5, y 1.5–3.5; the left arm x 0.1–0.7.
    const shell = FakeShell.withDocument(bigDesk({ x: 1.3, y: 3.5 }, 0));
    shell.drag({ x: 0.4, y: 2.5 }, { x: 0.4, y: 1.9 });
    const p = placed(shell, "k/p0");
    expect(p?.rotation, JSON.stringify(p)).toBe(0);
    expect(p?.at.x).toBeCloseTo(1.3, 9);
    expect(p?.at.y).toBeLessThan(3.2);
  });

  it("at 90° along the bottom wall (its left side facing down), 0.40 m off the left wall, it stays flush on y 0.1", () => {
    // Anchored at (0.5, 1.3): x 0.5–2.5, y 0.1–2.5; the left arm y 0.1–0.7.
    const shell = FakeShell.withDocument(bigDesk({ x: 0.5, y: 1.3 }, 90));
    shell.drag({ x: 1.5, y: 0.4 }, { x: 2.1, y: 0.4 });
    const p = placed(shell, "k/p0");
    expect(p?.rotation, JSON.stringify(p)).toBe(90);
    expect(p?.at.y).toBeCloseTo(1.3, 9);
    expect(p?.at.x).toBeGreaterThan(0.8);
  });

  it("a little off the wall and a little askew, it straightens and snaps flush, keeping its turn", () => {
    const shell = FakeShell.withDocument(bigDesk({ x: 1.4, y: 3.5 }, 2)); // at 2°, its nearest left corner on x 0.2007
    shell.drag({ x: 0.5, y: 2.5 }, { x: 0.5, y: 1.9 });
    const p = placed(shell, "k/p0");
    expect(p?.rotation, JSON.stringify(p)).toBe(0);
    expect(p?.at.x).toBeCloseTo(1.3, 9);
  });
});

describe("a plain desk's left side on a wall still turns to its back (furnish.16)", () => {
  it("a 1.20 × 0.60 desk dragged with its left side along the left wall turns to 90°, its back flush", () => {
    // Anchored at (0.7, 2.6): x 0.1–1.3, y 2.0–2.6, its left side on the left wall.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("d", "desk", { x: 0.7, y: 2.6 })));
    shell.drag({ x: 0.7, y: 2.3 }, { x: 0.7, y: 1.9 });
    const p = placed(shell, "d/p0");
    expect(p?.rotation, JSON.stringify(p)).toBe(90);
    expect(p?.at.x).toBeCloseTo(0.1, 9);
  });
});

describe("the corner snap still turns the L into each room corner, from any start angle (furnish.18)", () => {
  type Corner = { name: string; c: Point; rotation: number; inward: Point };
  const CORNERS: readonly Corner[] = [
    { name: "TL", c: { x: 0.1, y: 3.9 }, rotation: 0, inward: { x: 1, y: -1 } },
    { name: "BL", c: { x: 0.1, y: 0.1 }, rotation: 90, inward: { x: 1, y: 1 } },
    { name: "BR", c: { x: 5.9, y: 0.1 }, rotation: 180, inward: { x: -1, y: 1 } },
    { name: "TR", c: { x: 5.9, y: 3.9 }, rotation: 270, inward: { x: -1, y: -1 } },
  ];
  const W = 1.6;
  const D = 1.2;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

  for (const k of CORNERS) {
    for (const start of [0, 90, 180, 270]) {
      it(`${k.name} from ${start}°`, () => {
        const shell = FakeShell.withDocument(roomDoc());
        shell.ui({ type: "pickKind", kind: "cornerDesk" });
        const t = shell.state.tool;
        if (t.name !== "object") throw new Error("not the Object tool");
        shell.state = { ...shell.state, tool: { name: "object", state: { ...t.state, rotation: start } } };
        // The ghost's centre 0.03 m inside both faces at the start angle.
        const [hx, hy] = start % 180 === 0 ? [W / 2, D / 2] : [D / 2, W / 2];
        shell.moveTo({ x: r3(k.c.x + k.inward.x * (hx + 0.03)), y: r3(k.c.y + k.inward.y * (hy + 0.03)) });
        const a = (k.rotation * Math.PI) / 180;
        const ghost = shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null;
        expect(ghost, JSON.stringify(ghost)).toMatchObject({ rotation: k.rotation, at: { x: r3(k.c.x + (W / 2) * Math.cos(a)), y: r3(k.c.y + (W / 2) * Math.sin(a)) }, fits: true });
      });
    }
  }
});
