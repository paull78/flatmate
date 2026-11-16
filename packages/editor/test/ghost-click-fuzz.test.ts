import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, lowerable, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ObjectGhost } from "../src/tools/types";
import { nichesDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The ghost is the click (principle 1; sizing step 04, sizing.04): whatever way a new piece is sized, by a typed size
// or a drawn footprint, a green ghost is placed and a red one isn't. roomDoc is 6 × 4 (inner faces x 0.1–5.9,
// y 0.1–3.9); nichesDoc has a wardrobe niche and a bed alcove. Zoom 80: 4 px is 0.05 m.

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const placedCount = (shell: FakeShell): number => Object.keys(shell.doc().placements).length;

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

describe("an `L` piece sized while placing (AC-14)", () => {
  it("AC-14: a Corner sofa drawn 0.80 × 0.80, and one typed 0.80 × 0.80: the ghost is green and the click places it", () => {
    const drawn = FakeShell.withDocument(roomDoc());
    drawn.ui({ type: "pickKind", kind: "cornerSofa" });
    drawn.moveTo({ x: 2, y: 2 });
    drawn.down({ x: 2, y: 2 });
    drawn.moveTo({ x: 2.4, y: 2.4 });
    drawn.moveTo({ x: 2.8, y: 2.8 });
    expect(ghost(drawn)).toMatchObject({ w: 0.8, d: 0.8, fits: true });
    drawn.up({ x: 2.8, y: 2.8 });
    expect(placedCount(drawn)).toBe(1);
    expect(drawn.view().toast).toBeNull();

    const typed = FakeShell.withDocument(roomDoc());
    typed.ui({ type: "pickKind", kind: "cornerSofa" });
    typed.ui({ type: "setArmedSize", kind: "cornerSofa", width: "0.8", depth: "0.8" });
    typed.moveTo({ x: 3, y: 2 });
    expect(ghost(typed)).toMatchObject({ w: 0.8, d: 0.8, fits: true });
    typed.click({ x: 3, y: 2 });
    expect(placedCount(typed)).toBe(1);
    expect(typed.view().toast).toBeNull();
  });

  it("a Corner desk drawn 0.15 × 0.15 is red, and its release places nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "cornerDesk" });
    shell.moveTo({ x: 2, y: 2 });
    shell.down({ x: 2, y: 2 });
    shell.moveTo({ x: 2.15, y: 2.15 });
    expect(ghost(shell)).toMatchObject({ fits: false });
    shell.up({ x: 2.15, y: 2.15 });
    expect(placedCount(shell)).toBe(0);
  });
});

describe("fuzz: the ghost is the click, however a new piece is sized", () => {
  it("300 seeded cases over every placeable kind but sets, typed or drawn, in two rooms", () => {
    const rand = rng(41);
    const pickOf = <T,>(xs: readonly T[]): T => {
      const v = xs[Math.floor(rand() * xs.length)];
      if (v === undefined) throw new Error("empty pick");
      return v;
    };
    const cmIn = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
    const kinds = OBJECT_KINDS.filter((k) => !k.retired);
    const docs: readonly [string, () => Document][] = [["room", roomDoc], ["niches", nichesDoc]];
    const failures: string[] = [];
    for (let i = 0; i < 300; i++) {
      const kind = pickOf(kinds);
      const [docName, makeDoc] = pickOf(docs);
      const shell = FakeShell.withDocument(makeDoc());
      shell.ui({ type: "pickKind", kind: kind.id });
      const drawn = kind.stair !== null || rand() < 0.5; // a stair kind takes no typed size
      const w = cmIn(0.1, 3);
      const d = cmIn(0.1, 3);
      const p: Point = { x: cmIn(0.2, 5.8), y: cmIn(0.2, 3.8) };
      const tag = `#${i} ${kind.id} ${drawn ? "drawn" : "typed"} ${w} × ${d} at (${p.x}, ${p.y}) in ${docName}`;
      const before = placedCount(shell);
      if (drawn) {
        const q = { x: p.x + (rand() < 0.5 ? w : -w), y: p.y + (rand() < 0.5 ? d : -d) };
        shell.moveTo(p);
        shell.down(p);
        shell.moveTo({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        shell.moveTo(q);
        const g = ghost(shell);
        shell.up(q);
        const placed = placedCount(shell) - before;
        if (!g) failures.push(`${tag}: no ghost`);
        else if (g.fits !== (placed === 1)) failures.push(`${tag}: ghost ${g.fits ? "green" : "red"}, placed ${placed}, toast ${shell.view().toast}`);
      } else {
        shell.ui({ type: "setArmedSize", kind: kind.id, width: String(w), depth: String(d) });
        shell.moveTo(p);
        const g = ghost(shell);
        shell.click(p);
        const placed = placedCount(shell) - before;
        if (!g) failures.push(`${tag}: no ghost`);
        else if (g.fits !== (placed === 1)) failures.push(`${tag}: ghost ${g.fits ? "green" : "red"}, placed ${placed}, toast ${shell.view().toast}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("fuzz: the ghost is the click with a typed height (sizing step 06)", () => {
  it("200 seeded cases over the kinds that may be lowered, under a loft or in the open, clicked or drawn", () => {
    const rand = rng(43);
    const pickOf = <T,>(xs: readonly T[]): T => {
      const v = xs[Math.floor(rand() * xs.length)];
      if (v === undefined) throw new Error("empty pick");
      return v;
    };
    const cmIn = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
    const kinds = OBJECT_KINDS.filter((k) => !k.retired && lowerable(k.id));
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const kind = pickOf(kinds);
      const top = cmIn(1.2, 2.4);
      const loft: Command = { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.6, y: 2 }, w: 3, d: 3.8, top, solid: false };
      const shell = FakeShell.withDocument(withCommands(roomDoc(), loft));
      shell.ui({ type: "pickKind", kind: kind.id });
      const h = cmIn(0.01, 3);
      shell.ui({ type: "setArmedSize", kind: kind.id, height: String(h) });
      const p: Point = { x: cmIn(0.4, 5.6), y: cmIn(0.4, 3.6) };
      const drawn = rand() < 0.3;
      const tag = `#${i} ${kind.id} h ${h} under a deck at ${top} ${drawn ? "drawn" : "clicked"} at (${p.x}, ${p.y})`;
      const before = placedCount(shell);
      if (drawn) {
        const q = { x: p.x + 0.6, y: p.y + 0.4 };
        shell.moveTo(p);
        shell.down(p);
        shell.moveTo({ x: p.x + 0.3, y: p.y + 0.2 });
        shell.moveTo(q);
        const g = ghost(shell);
        shell.up(q);
        const placed = placedCount(shell) - before;
        if (!g) failures.push(`${tag}: no ghost`);
        else if (g.fits !== (placed === 1)) failures.push(`${tag}: ghost ${g.fits ? "green" : "red"}, placed ${placed}, toast ${shell.view().toast}`);
      } else {
        shell.moveTo(p);
        const g = ghost(shell);
        shell.click(p);
        const placed = placedCount(shell) - before;
        if (!g) failures.push(`${tag}: no ghost`);
        else if (g.fits !== (placed === 1)) failures.push(`${tag}: ghost ${g.fits ? "green" : "red"}, placed ${placed}, toast ${shell.view().toast}`);
        else if (placed === 1) {
          const o = Object.values(shell.doc().objects).at(-1);
          const want = g.lowered?.h ?? h;
          if (o?.h["standard"] !== want && o && Object.values(o.h)[0] !== want) failures.push(`${tag}: placed h ${JSON.stringify(o.h)}, wanted ${want}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("fuzz: the ghost is the click with R turns while drawing (sizing step 10)", () => {
  it("200 seeded drawn cases over every placeable kind but sets, with 0 to 3 turns, in two rooms", () => {
    const rand = rng(47);
    const pickOf = <T,>(xs: readonly T[]): T => {
      const v = xs[Math.floor(rand() * xs.length)];
      if (v === undefined) throw new Error("empty pick");
      return v;
    };
    const cmIn = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
    const kinds = OBJECT_KINDS.filter((k) => !k.retired);
    const docs: readonly [string, () => Document][] = [["room", roomDoc], ["niches", nichesDoc]];
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const kind = pickOf(kinds);
      const [docName, makeDoc] = pickOf(docs);
      const shell = FakeShell.withDocument(makeDoc());
      shell.ui({ type: "pickKind", kind: kind.id });
      const p: Point = { x: cmIn(0.2, 5.8), y: cmIn(0.2, 3.8) };
      const q: Point = { x: p.x + (rand() < 0.5 ? 1 : -1) * cmIn(0.1, 2.5), y: p.y + (rand() < 0.5 ? 1 : -1) * cmIn(0.1, 2.5) };
      const turns = Math.floor(rand() * 4);
      const tag = `#${i} ${kind.id} from (${p.x}, ${p.y}) to (${q.x}, ${q.y}), R×${turns} in ${docName}`;
      const before = placedCount(shell);
      shell.moveTo(p);
      shell.down(p);
      shell.moveTo({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      shell.moveTo(q);
      for (let t = 0; t < turns; t++) shell.key("r");
      const g = ghost(shell);
      shell.up(q);
      const placed = placedCount(shell) - before;
      if (!g) failures.push(`${tag}: no ghost`);
      else if (g.fits !== (placed === 1)) failures.push(`${tag}: ghost ${g.fits ? "green" : "red"}, placed ${placed}, toast ${shell.view().toast}`);
      else if (placed === 1) {
        const added = Object.values(shell.doc().placements).at(-1);
        if (added && (added.rotation !== g.rotation || added.at.x !== g.at.x || added.at.y !== g.at.y)) failures.push(`${tag}: ghost at ${JSON.stringify([g.at, g.rotation])}, placed ${JSON.stringify([added.at, added.rotation])}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
