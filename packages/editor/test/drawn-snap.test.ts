import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ObjectGhost } from "../src/tools/types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Drawn corners catch other pieces (sizing step 13; spec "While a footprint is drawn", sizing.10, .34, .35). roomDoc is
// 6 × 4 (inner faces x 0.1–5.9, y 0.1–3.9); zoom 80, so the 10 px tolerance is 0.125 m. A fridge is 0.60 × 0.65.

const place = (opId: string, kind: string, at: Point, rotation = 0, state = "s0"): Command => ({ type: "placeObject", linked: false, opId, state, object: { kind }, at, rotation, deck: null });
const doc = (...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, roomDoc());
const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
/** A fridge against the back wall, its back at y 3.9: x 3.7–4.3, y 3.25–3.9. */
const fridgeAt = (x: number, id = "f"): Command => place(id, "fridge", { x, y: 3.9 });

function draw(d: Document, kind: string, a: Point, b: Point, ctrl = false): { g: ObjectGhost | null; placed: number; shell: FakeShell } {
  const shell = FakeShell.withDocument(d);
  shell.ui({ type: "pickKind", kind });
  const before = Object.keys(shell.doc().placements).length;
  shell.moveTo(a, { ctrl });
  shell.down(a, { ctrl });
  shell.moveTo({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { ctrl });
  shell.moveTo(b, { ctrl });
  const g = ghost(shell);
  shell.up(b, { ctrl });
  return { g, placed: Object.keys(shell.doc().placements).length - before, shell };
}
const right = (g: ObjectGhost | null) => (g ? g.at.x + (g.rotation % 180 === 0 ? g.w : g.d) / 2 : Number.NaN);
const left = (g: ObjectGhost | null) => (g ? g.at.x - (g.rotation % 180 === 0 ? g.w : g.d) / 2 : Number.NaN);

describe("drawn corners catch pieces (sizing step 13)", () => {
  it("AC-10: a counter from the back wall towards a fridge, released 8 cm short of its side, lands flush and fits; with Ctrl it stays at the pointer", () => {
    const r = draw(doc(fridgeAt(4)), "counter", { x: 2.03, y: 3.87 }, { x: 3.62, y: 3.3 });
    expect(r.g?.fits).toBe(true);
    expect(right(r.g)).toBeCloseTo(3.7, 6);
    expect(r.placed).toBe(1);
    const free = draw(doc(fridgeAt(4)), "counter", { x: 2.03, y: 3.87 }, { x: 3.62, y: 3.3 }, true);
    expect(right(free.g)).toBeCloseTo(3.62, 6);
  });

  it("between two pieces against a wall both corners catch, and the piece fills the gap to the mm", () => {
    const r = draw(doc(fridgeAt(4), fridgeAt(2, "g")), "counter", { x: 2.38, y: 3.87 }, { x: 3.63, y: 3.31 }); // fridges x 1.7–2.3 and 3.7–4.3
    expect(r.g?.fits).toBe(true);
    expect(r.g?.w).toBeCloseTo(1.4, 6);
    expect(r.placed).toBe(1);
  });

  it("a wall face and a piece's side both within the tolerance on one axis: the wall wins", () => {
    // A partition at x 3 (faces 2.9 / 3.1) to y 2; a fridge whose left side is 3.15, 5 cm past the face.
    const d = doc({ type: "addWall", opId: "div", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 2 } } }, place("f", "fridge", { x: 3.45, y: 3.9 }));
    expect(left(draw(d, "counter", { x: 3.12, y: 1.9 }, { x: 4, y: 1.3 }).g)).toBeCloseTo(3.1, 6);
  });

  it("a rug, a piece in another layout and a turned piece offer nothing", () => {
    const rug = draw(doc(place("r", "rug", { x: 4, y: 2.5 })), "counter", { x: 1, y: 2.45 }, { x: 2.96, y: 1.9 }); // rug x 3–5
    expect(right(rug.g)).toBeCloseTo(2.96, 6);
    const night = doc({ type: "addState", opId: "n", name: "Night" }, place("f", "fridge", { x: 4, y: 3.9 }, 0, "n/s0"));
    expect(right(draw(night, "counter", { x: 2.03, y: 3.87 }, { x: 3.62, y: 3.3 }).g)).toBeCloseTo(3.62, 6);
    const turned = draw(doc(place("f", "fridge", { x: 4, y: 2 }, 30)), "counter", { x: 2, y: 2.2 }, { x: 3.62, y: 1.7 });
    expect(right(turned.g)).toBeCloseTo(3.62, 6);
  });

  it("just inside and just outside the tolerance (0.125 m at zoom 80)", () => {
    expect(right(draw(doc(fridgeAt(4)), "counter", { x: 2.03, y: 3.87 }, { x: 3.58, y: 3.3 }).g)).toBeCloseTo(3.7, 6); // 0.12 short
    expect(right(draw(doc(fridgeAt(4)), "counter", { x: 2.03, y: 3.87 }, { x: 3.57, y: 3.3 }).g)).toBeCloseTo(3.57, 6); // 0.13 short
  });

  it("a corner beside a piece but beyond its span (more than the tolerance) doesn't catch its side", () => {
    // The fridge spans y 3.25–3.9; a corner at y 2.9 is 0.35 below it.
    expect(right(draw(doc(fridgeAt(4)), "counter", { x: 2, y: 2.4 }, { x: 3.62, y: 2.9 }).g)).toBeCloseTo(3.62, 6);
  });

  it("an `L` piece offers its outline's lines: a corner catches the inner edge of a corner desk's arm", () => {
    // A corner desk 1.60 × 1.20 against the back wall at x 3: x 2.2–3.8, y 2.7–3.9, arms 0.60; its left arm's inner edge is x 2.8.
    const d = doc(place("k", "cornerDesk", { x: 3, y: 3.9 }));
    const r = draw(d, "counter", { x: 2.86, y: 2.65 }, { x: 3.6, y: 2.1 });
    expect(left(r.g)).toBeCloseTo(2.8, 6);
  });

  it("fuzz (seeded): with pieces about, the drawn ghost is the click, and a snapped ghost never overlaps the piece it caught", () => {
    let seed = 53;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const cm = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
    const failures: string[] = [];
    for (let i = 0; i < 150; i++) {
      const d = doc(fridgeAt(cm(0.5, 5.5)), place("t", "coffeeTable", { x: cm(1, 5), y: cm(0.8, 2.6) }, rand() < 0.3 ? 90 : 0));
      const a = { x: cm(0.2, 5.8), y: cm(0.2, 3.8) };
      const b = { x: cm(0.2, 5.8), y: cm(0.2, 3.8) };
      if (Math.abs(a.x - b.x) < 0.2 || Math.abs(a.y - b.y) < 0.2) continue;
      const r = draw(d, "counter", a, b);
      const tag = `#${i} from ${JSON.stringify(a)} to ${JSON.stringify(b)}`;
      if (!r.g) failures.push(`${tag}: no ghost`);
      else if (r.g.fits !== (r.placed === 1)) failures.push(`${tag}: ghost ${r.g.fits ? "green" : "red"}, placed ${r.placed}, toast ${r.shell.view().toast}`);
    }
    expect(failures).toEqual([]);
  });
});
