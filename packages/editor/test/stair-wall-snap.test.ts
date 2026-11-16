import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, stairEdges, type Command, type Document, type Placement } from "@fm/domain";
import { wallSides } from "../src/tools/stair-gesture";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A straight flight's long side snaps flush to a wall face within 0.30 m while drawing (AC-08). The room is 8 × 3; the
// loft's east edge at x 3.6 runs y 0.1–2.9; a partition along y 2 from x 5 to the east wall stands in the flight's way,
// its faces at y 1.9 and 2.1. A 0.90 stair's middle goes flush at y 1.45 south of it, y 2.55 north.

const LOFT = "loft/k0";
function room(...more: Command[]): Document {
  return withCommands(
    emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 3, "r"),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.5 }, w: 3.5, d: 2.8 },
    ...more,
  );
}
const PARTITION: Command = { type: "addWall", opId: "p", from: { at: { x: 5, y: 2 } }, to: { at: { x: 7.9, y: 2 } } };

function shellOn(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickKind", kind: "stair" });
  return shell;
}
const ghostAt = (shell: FakeShell) => {
  if (shell.state.tool.name !== "object") throw new Error("not the Object tool");
  return shell.state.tool.state.ghost;
};
const stairPlacement = (shell: FakeShell): Placement => {
  const d = shell.doc();
  const p = Object.values(d.placements).find((q) => d.objects[q.object]?.kind === "stair");
  if (!p) throw new Error("no stair");
  return p;
};

describe("wallSides", () => {
  const edge = (doc: Document) => {
    const e = stairEdges(doc, null, 0.9).find((x) => x.deck === LOFT && x.normal.x === 1);
    if (!e) throw new Error("no edge");
    return e;
  };
  const y = (doc: Document, t: number): number => {
    const e = edge(doc);
    const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    return e.a.y + ((e.b.y - e.a.y) / len) * t;
  };

  it("offers the two places flush with a wall across the flight's run", () => {
    const doc = room(PARTITION);
    const places = wallSides(doc, edge(doc), 3, 0.9).map((t) => y(doc, t)).sort((a, b) => a - b);
    expect(places.some((v) => Math.abs(v - 1.45) < 1e-6)).toBe(true);
    expect(places.some((v) => Math.abs(v - 2.55) < 1e-6)).toBe(true);
  });

  it("ignores a wall beyond the run, and one across it", () => {
    const short = room(PARTITION);
    expect(wallSides(short, edge(short), 1, 0.9).filter((t) => [1.45, 2.55].some((v) => Math.abs(y(short, t) - v) < 1e-6))).toEqual([]);
    const across = room({ type: "addWall", opId: "x", from: { at: { x: 7, y: 0.1 } }, to: { at: { x: 7, y: 2.9 } } });
    expect(wallSides(across, edge(across), 3, 0.9).filter((t) => { const v = y(across, t); return v > 0.7 && v < 2.3; })).toEqual([]);
  });

  it("ignores a wall turned to the run", () => {
    const base = room();
    const before = wallSides(base, edge(base), 3, 0.9).length;
    const turned = room({ type: "addWall", opId: "t", from: { at: { x: 5, y: 0.8 } }, to: { at: { x: 6.5, y: 2.2 } } });
    expect(wallSides(turned, edge(turned), 3, 0.9)).toHaveLength(before);
  });

  it("ignores a wall standing on a loft", () => {
    const doc = room({ type: "addWall", opId: "lw", base: LOFT, top: 0.6, from: { at: { x: 1, y: 1.5 } }, to: { at: { x: 3, y: 1.5 } } });
    const e = edge(doc);
    const places = wallSides(doc, { ...e, normal: { x: -1, y: 0 } }, 3, 0.9).map((t) => y(doc, t));
    expect(places.some((v) => Math.abs(v - 1.05) < 0.11)).toBe(false);
  });
});

describe("drawing a flight beside a wall (AC-08)", () => {
  it("lands flush 0.25 m away, not 0.35 m away; the deck's edge stays what it hangs from", () => {
    const shell = shellOn(room(PARTITION));
    shell.moveTo({ x: 4, y: 1.2 });
    expect(ghostAt(shell)?.at).toEqual({ x: 3.6, y: expect.closeTo(1.45, 6) });
    shell.moveTo({ x: 4, y: 1.1 });
    expect(ghostAt(shell)?.at.x).toBe(3.6);
    expect(ghostAt(shell)?.at.y).not.toBeCloseTo(1.45, 2);
  });

  it("with no wall there, the same cursor follows the step", () => {
    const shell = shellOn(room());
    shell.moveTo({ x: 4, y: 1.2 });
    expect(ghostAt(shell)?.at.y).not.toBeCloseTo(1.45, 2);
  });

  it("Ctrl takes it off", () => {
    const shell = shellOn(room(PARTITION));
    shell.moveTo({ x: 4, y: 1.22 }, { ctrl: true });
    expect(ghostAt(shell)?.at.y).toBeCloseTo(1.22, 6);
  });

  it("places what the ghost showed, flush on the partition's face", () => {
    const shell = shellOn(room(PARTITION));
    shell.moveTo({ x: 4, y: 1.2 });
    shell.click({ x: 4, y: 1.2 });
    shell.click({ x: 4, y: 1.2 });
    expect(stairPlacement(shell).at).toEqual({ x: 3.6, y: expect.closeTo(1.45, 6) });
  });
});

describe("an L from a top flush on a wall (AC-08, riser.17)", () => {
  it("turning away from the wall, its landing's outer side lies on the wall's face", () => {
    // Room for the lower flight: 8 × 5, the loft's east edge at x 3.6, the partition along y 3.8, its south face y 3.70.
    const doc = withCommands(
      emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 8, 5, "r"),
      { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 2.5 }, w: 3.5, d: 4.8 },
      { type: "addWall", opId: "p", from: { at: { x: 5, y: 3.8 } }, to: { at: { x: 7.9, y: 3.8 } } },
    );
    const shell = shellOn(doc);
    shell.moveTo({ x: 4, y: 3 });
    shell.click({ x: 4, y: 3 }); // the top at y 3.25, flush on the partition's south face
    shell.moveTo({ x: 4.2, y: 2.3 }); // sideways, south: away from the partition
    const g = ghostAt(shell);
    expect(g?.fits).toBe(true);
    const landing = g?.l?.landing;
    if (!landing) throw new Error("not an L");
    expect(landing.at.y + landing.d / 2).toBeCloseTo(3.7, 6);
    shell.click({ x: 4.2, y: 2.3 });
    const deck = Object.values(shell.doc().decks).find((d) => d.id !== LOFT);
    if (!deck) throw new Error("no landing placed");
    expect(deck.at.y + deck.d / 2).toBeCloseTo(3.7, 6);
  });
});
