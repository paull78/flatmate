import { describe, expect, it } from "vitest";
import { deckRing, validateDocument, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ObjectGhost } from "../../src/tools/types";
import type { Primitive, Scene } from "../../src/view/scene-types";
import { roomDoc, withCommands } from "../builders";
import { FakeShell } from "../fake-shell";
import { COLORS } from "../../src/view/colors";

// The stair gesture, straight (stairdraw.06, .07, .10, .11, .18; spec "The gesture", "Catching an edge"): with a stair
// kind armed, the deck edge under the cursor's band catches the ghost; click 1 fixes the top on the edge, click 2 (or
// a press, drag and release) places it through placeStair. With no edge caught the Object tool is today's.
//
// The 6 × 4 room (inner faces x 0.1–5.9, y 0.1–3.9) under 3.20, with a Night layout (n/s0):
//   loftRoom()     the loft (loft/k0, "Loft", top 2.15) over x 0.1–1.9: only its right edge, x 1.9 from y 0.1 to 3.9, is free.
//   offGrid()  the loft over x 0.1–1.938 at +2.237: a Stair to it gets 12 risers and a 2.829 run, not its default 2.99.

const LOFT = "loft/k0";
const base: Command[] = [{ type: "setCeiling", height: 3.2 }, { type: "addState", opId: "n", name: "Night" }];
const loftRoom = (): Document => checked(withCommands(roomDoc(), ...base, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.8, name: "Loft" }));
const offGrid = (): Document =>
  checked(withCommands(roomDoc(), ...base, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.019, y: 2 }, w: 1.838, d: 3.8, top: 2.237, name: "Loft" }));

function checked(doc: Document): Document {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  return doc;
}
function shellOf(doc: Document, kind = "stair"): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.1 });
  shell.ui({ type: "pickKind", kind });
  return shell;
}
const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const phase = (shell: FakeShell): string | null => (shell.state.tool.name === "object" ? (shell.state.tool.state.stair?.phase ?? null) : null);
/** Every placement of `kind`, by layout. */
const placed = (shell: FakeShell, kind: string): Placement[] =>
  Object.values(shell.doc().placements).filter((p) => shell.doc().objects[p.object]?.kind === kind).sort((a, b) => a.state.localeCompare(b.state));
const layer = (scene: Scene, name: string): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];
const texts = (ps: readonly Primitive[]): string[] => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const segmentOn = (ps: readonly Primitive[], a: Point, b: Point): boolean =>
  ps.some((p) => p.kind === "segment" && Math.hypot(p.a.x - a.x, p.a.y - a.y) < 1e-9 && Math.hypot(p.b.x - b.x, p.b.y - b.y) < 1e-9);
/** What a stair placement was placed as: its pose, its size, its rise and what it reaches. */
function asPlaced(shell: FakeShell, p: Placement): { at: Point; rotation: number; w: number; d: number; h: number; reaches: string | null } {
  const o = shell.doc().objects[p.object];
  if (!o) throw new Error("no object");
  return { at: p.at, rotation: p.rotation, w: o.w[p.config] ?? NaN, d: o.d[p.config] ?? NaN, h: o.h[p.config] ?? NaN, reaches: o.reaches ?? null };
}
const asGhost = (g: ObjectGhost | null) => g && { at: g.at, rotation: g.rotation, w: g.w, d: g.d, h: g.h, reaches: g.reaches };

describe("hovering a deck's edge (AC-01)", () => {
  it("hovering the loft's band shows a ghost with 12 risers, back on the edge, labelled UP · 12 R, the edge tag Loft edge · 2.15", () => {
    const shell = shellOf(loftRoom());
    shell.moveTo({ x: 2.6, y: 2.03 });
    expect(phase(shell)).toBe("hover");
    expect(ghost(shell)).toMatchObject({ at: { x: 1.9, y: 2 }, rotation: 90, w: 0.9, d: 2.988, h: 2.15, reaches: LOFT, fits: true, surface: null });
    const scene = shell.scene();
    expect(texts(layer(scene, "overlays"))).toContain("UP · 12 R");
    expect(texts(layer(scene, "annotations"))).toContain("Loft edge · 2.15");
    expect(segmentOn(layer(scene, "overlays"), { x: 1.9, y: 0.1 }, { x: 1.9, y: 3.9 })).toBe(true); // the edge, highlighted
    // It slides along the edge with the cursor, flush to the end within 0.20 m.
    shell.moveTo({ x: 2.6, y: 0.65 });
    expect(ghost(shell)?.at).toEqual({ x: 1.9, y: 0.55 });
    // Out of the band, the ghost is today's: no tag, no label.
    shell.moveTo({ x: 5.3, y: 2 });
    expect(phase(shell)).toBeNull();
    expect(ghost(shell)?.h).toBeUndefined();
    expect(texts(layer(shell.scene(), "annotations"))).not.toContain("Loft edge · 2.15");
    expect(texts(layer(shell.scene(), "overlays"))).not.toContain("UP · 12 R");
  });

  it("at the off-grid loft the ghost is sized for its rise: 12 risers on a 2.829 run, at 2.237", () => {
    const shell = shellOf(offGrid());
    shell.moveTo({ x: 2.6, y: 2.03 });
    expect(ghost(shell)).toMatchObject({ at: { x: 1.938, y: 2 }, rotation: 90, d: 2.829, h: 2.237, reaches: LOFT, fits: true });
    expect(texts(layer(shell.scene(), "overlays"))).toContain("UP · 12 R");
    expect(texts(layer(shell.scene(), "annotations"))).toContain("Loft edge · 2.24");
  });
});

describe("placing it (AC-04, AC-06, AC-07)", () => {
  it("click, click places a stair equal to the ghost: pose, size, h, reaches; in every layout; one undo removes it", () => {
    const shell = shellOf(offGrid());
    shell.moveTo({ x: 2.6, y: 2.03 });
    const shown = asGhost(ghost(shell));
    shell.click({ x: 2.6, y: 2.03 });
    expect(phase(shell)).toBe("fixed");
    expect(placed(shell, "stair")).toEqual([]);
    shell.moveTo({ x: 3.4, y: 2.21 }); // straight out: the ghost stays where click 1 fixed it
    expect(asGhost(ghost(shell))).toEqual(shown);
    shell.click({ x: 3.4, y: 2.21 });
    const stairs = placed(shell, "stair");
    expect(stairs.map((p) => p.state)).toEqual(["n/s0", "s0"]);
    for (const p of stairs) expect(asPlaced(shell, p)).toEqual(shown);
    expect(shown).toEqual({ at: { x: 1.938, y: 2 }, rotation: 90, w: 0.9, d: 2.829, h: 2.237, reaches: LOFT });
    expect(phase(shell)).toBe("hover"); // back to hovering, for the next stair
    shell.key("z", { meta: true });
    expect(placed(shell, "stair")).toEqual([]);
  });

  it("press, drag, release equals the two clicks", () => {
    const clicks = shellOf(offGrid());
    clicks.click({ x: 2.6, y: 1.24 });
    clicks.click({ x: 3.9, y: 1.4 });
    const dragged = shellOf(offGrid());
    dragged.drag({ x: 2.6, y: 1.24 }, { x: 3.9, y: 1.4 });
    const one = placed(clicks, "stair").map((p) => asPlaced(clicks, p));
    expect(one).toHaveLength(2);
    expect(one[0]).toMatchObject({ at: { x: 1.938, y: 1.2 }, reaches: LOFT });
    expect(placed(dragged, "stair").map((p) => asPlaced(dragged, p))).toEqual(one);
  });

  it("Esc after click 1 goes back to hover and places nothing", () => {
    const shell = shellOf(loftRoom());
    shell.click({ x: 2.6, y: 2.03 });
    expect(phase(shell)).toBe("fixed");
    shell.key("Escape");
    expect(shell.state.tool.name).toBe("object");
    expect(phase(shell)).toBe("hover");
    expect(ghost(shell)).toMatchObject({ at: { x: 1.9, y: 2 }, reaches: LOFT });
    shell.moveTo({ x: 2.6, y: 1.24 }); // hovering again: the ghost slides, nothing was fixed
    expect(ghost(shell)?.at).toEqual({ x: 1.9, y: 1.2 });
    expect(placed(shell, "stair")).toEqual([]);
    shell.key("Escape"); // a second Esc leaves the tool, as today
    expect(shell.state.tool.name).toBe("select");
  });

  it("R while caught does nothing", () => {
    const shell = shellOf(loftRoom());
    shell.moveTo({ x: 2.6, y: 2.03 });
    const before = ghost(shell);
    shell.key("r");
    expect(ghost(shell)).toEqual(before);
    shell.click({ x: 2.6, y: 2.03 });
    shell.key("r");
    expect(ghost(shell)).toEqual(before);
    shell.key("Escape");
    // Off the band, with Ctrl keeping the start angle: R never turned it.
    shell.moveTo({ x: 5.3, y: 2 }, { ctrl: true });
    expect(ghost(shell)?.rotation).toBe(0);
  });
});

describe("with no edge caught (AC-10, stairdraw.07)", () => {
  it("with no edge caught the click and the drag to draw are today's", () => {
    // Today's: the same gestures in the room with no deck at all give the same stair, reaching nothing at its 2.15.
    const plain = (): Document => checked(withCommands(roomDoc(), ...base));
    const run = (doc: Document, gesture: (shell: FakeShell) => void) => {
      const shell = shellOf(doc);
      gesture(shell);
      return placed(shell, "stair").map((p) => asPlaced(shell, p));
    };
    const click = (shell: FakeShell): void => shell.click({ x: 5, y: 2 });
    const draw = (shell: FakeShell): void => shell.drag({ x: 5.1, y: 0.4 }, { x: 5.8, y: 3.5 });
    const clicked = run(loftRoom(), click);
    expect(clicked).toEqual(run(plain(), click));
    expect(clicked).toEqual([0, 1].map(() => ({ at: { x: 5, y: 3.495 }, rotation: 0, w: 0.9, d: 2.99, h: 2.15, reaches: null })));
    const drawn = run(loftRoom(), draw);
    expect(drawn).toEqual(run(plain(), draw));
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toMatchObject({ h: 2.15, reaches: null });
    expect(drawn[0]?.d).not.toBe(2.99); // drawn, not the default size
  });
});

describe("the ghost at the rise (AC-13, stairs.33)", () => {
  it("a stair to a 0.45 platform under a piece at 1.00 previews fitting and places", () => {
    // The platform (plat/k0) over x 0.1–1.3, y 0.1–3.9; a 0.60 deep shelf at +1.00 over x 1.3–2.3, y 2.6–3.2, in
    // front of the platform's edge where a 0.45 Stair (3 risers, a 0.60 run) goes.
    const doc = checked(
      withCommands(
        roomDoc(),
        ...base,
        { type: "addDeck", opId: "plat", preset: "platform", at: { x: 0.7, y: 2 }, w: 1.2, d: 3.8, name: "Platform" },
        { type: "placeObject", opId: "sh", state: "s0", object: { kind: "block", size: { w: 1, d: 0.6 } }, at: { x: 1.8, y: 3.2 }, rotation: 0, deck: null },
        { type: "setObjectSize", objectId: "sh/o0", w: 1, d: { standard: 0.6 }, h: { standard: 0.3 }, z: { standard: 1 } },
      ),
    );
    const shell = shellOf(doc);
    shell.moveTo({ x: 1.5, y: 2.93 });
    expect(ghost(shell)).toMatchObject({ at: { x: 1.3, y: 2.9 }, rotation: 90, d: 0.6, h: 0.45, reaches: "plat/k0", fits: true });
    shell.click({ x: 1.5, y: 2.93 }); // too low to turn: one click places it (stairdraw.58)
    expect(placed(shell, "stair").map((p) => asPlaced(shell, p))).toContainEqual({ at: { x: 1.3, y: 2.9 }, rotation: 90, w: 0.9, d: 0.6, h: 0.45, reaches: "plat/k0" });
  });
});

// The end snap on a short edge (stairdraw.59): a platform 1.20 × 1.20 in the room's left side, x 0.1–1.3, y 1.4–2.6;
// its right edge, x 1.3, is 1.20 long, so a 0.90 Stair's middle runs from y 1.85 to 2.15. At the default 80 px/m the
// end snap's 10 px is 0.125 m, so the middle of the edge is free; Ctrl turns the snaps off.
describe("sliding on a short edge (AC-02, stairdraw.59)", () => {
  const small = (): Document => checked(withCommands(roomDoc(), ...base, { type: "addDeck", opId: "plat", preset: "platform", at: { x: 0.7, y: 2 }, w: 1.2, d: 1.2, name: "Platform" }));

  it("a Stair can sit in the middle of a 1.20 edge, not only flush to an end", () => {
    const shell = shellOf(small());
    shell.moveTo({ x: 1.6, y: 2.0 }); // its sides 0.15 from each end, past the 0.125 m
    expect(ghost(shell)).toMatchObject({ at: { x: 1.3, y: expect.closeTo(2, 9) }, reaches: "plat/k0" });
    shell.moveTo({ x: 1.6, y: 2.2 }); // within 10 px of the end: flush
    expect(ghost(shell)?.at.y).toBeCloseTo(2.15, 9);
  });

  it("with Ctrl it slides to the centimetre, with no end snap", () => {
    const shell = shellOf(small());
    shell.moveTo({ x: 1.6, y: 2.03 }, { ctrl: true });
    expect(ghost(shell)?.at.y).toBeCloseTo(2.03, 9);
    shell.moveTo({ x: 1.6, y: 2.12 }, { ctrl: true });
    expect(ghost(shell)?.at.y).toBeCloseTo(2.12, 9);
  });
});

describe("guides and the caught edge (stairdraw.02)", () => {
  it("a furniture guide doesn't move a caught-edge ghost off its edge", () => {
    // A box whose left side is at x 1.95, 5 cm from the loft's edge. A Stair turned to 90 by R before it is caught,
    // centred at (3.425, 1.5), has its back at x 1.93: placed by contact, its back went flush on the edge and then the
    // box's guide pulled it to 1.95, off the edge (stairdraw.02). Caught, it stays on the edge.
    const doc = checked(
      withCommands(loftRoom(), { type: "placeObject", opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 2.25, y: 3.9 }, rotation: 0, deck: null }),
    );
    const shell = shellOf(doc);
    shell.moveTo({ x: 5.3, y: 2 });
    shell.key("r");
    shell.moveTo({ x: 3.425, y: 1.53 });
    expect(ghost(shell)).toMatchObject({ at: { x: 1.9, y: 1.5 }, rotation: 90, fits: true });
    shell.click({ x: 3.425, y: 1.53 });
    shell.click({ x: 3.425, y: 1.53 });
    expect(placed(shell, "stair")[0]?.at).toEqual({ x: 1.9, y: 1.5 });
  });
});

// The L (stairdraw.04, .05, .34; spec "The L"): from the loft's edge at (1.9, 2), the Stair's 12 risers split 6 and 6.
// Seen from the floor facing the edge (looking −x) the right is +y: swinging to y 3.0 turns right, to y 1.0 left.
describe("the swing and the L (AC-05, AC-06, AC-08)", () => {
  const TOP: Point = { x: 2.6, y: 2.03 };
  const RIGHT: Point = { x: 2.6, y: 3.0 };
  const LEFT: Point = { x: 2.6, y: 1.0 };
  const lOf = (g: ObjectGhost | null) => g?.l ?? null;
  const decksBut = (shell: FakeShell, keep: string) => Object.values(shell.doc().decks).filter((k) => k.id !== keep);
  /** The L the shell placed: per layout, the upper flight (reaching the loft) and the lower one (reaching the landing). */
  function placedL(shell: FakeShell) {
    const landings = decksBut(shell, LOFT);
    expect(landings).toHaveLength(1);
    const landing = landings[0];
    if (!landing) throw new Error("no landing");
    const flights = placed(shell, "stair");
    const upper = flights.filter((p) => shell.doc().objects[p.object]?.reaches === LOFT);
    const lower = flights.filter((p) => shell.doc().objects[p.object]?.reaches === landing.id);
    expect(upper.map((p) => p.state)).toEqual(["n/s0", "s0"]);
    expect(lower.map((p) => p.state)).toEqual(["n/s0", "s0"]);
    for (const p of upper) expect(shell.doc().objects[p.object]?.startsAt).toBe(landing.id);
    for (const p of lower) expect(shell.doc().objects[p.object]?.startsAt ?? null).toBeNull();
    const pose = (p: Placement) => {
      const { at, rotation, w, d, h } = asPlaced(shell, p);
      return { at, rotation, w, d, h };
    };
    return { upper: upper.map(pose), lower: lower.map(pose), landing: { at: landing.at, w: landing.w, d: landing.d, rotation: landing.rotation, top: landing.top, solid: landing.solid, name: landing.name } };
  }
  const ghostPose = (g: ObjectGhost | undefined) => g && { at: g.at, rotation: g.rotation, w: g.w, d: g.d, h: g.h };

  it("click, swing right, click places an L equal to its ghost: three parts, one undo removes all three, both flights in every layout", () => {
    const shell = shellOf(loftRoom());
    shell.click(TOP);
    shell.moveTo(RIGHT);
    const g = ghost(shell);
    const l = lOf(g);
    expect(g).toMatchObject({ shape: "l-right", at: { x: 1.9, y: 2 }, rotation: 90, reaches: LOFT, fits: true, h: 2.15, base: 1.075 });
    if (!g || !l) throw new Error("no L ghost");
    expect(l.lower).toMatchObject({ rotation: 180, h: 1.075, fits: true });
    expect(l.lower.at.y).toBeGreaterThan(2); // on the cursor's side
    expect(l.landing).toMatchObject({ w: 0.9, d: 0.9, rotation: 90, top: 1.075 });
    shell.click(RIGHT);
    const got = placedL(shell);
    for (const p of got.upper) expect(p).toEqual(ghostPose(g));
    for (const p of got.lower) expect(p).toEqual(ghostPose(l.lower));
    expect(got.landing).toEqual({ ...l.landing, solid: true, name: "Landing" });
    expect(phase(shell)).toBe("hover"); // back to hovering, for the next stair
    expect(ghost(shell)?.l).toBeUndefined();
    shell.key("z", { meta: true });
    expect(placed(shell, "stair")).toEqual([]);
    expect(decksBut(shell, LOFT)).toEqual([]);
  });

  it("› swinging left mirrors it", () => {
    const right = shellOf(loftRoom());
    right.click(TOP);
    right.click(RIGHT);
    const left = shellOf(loftRoom());
    left.click(TOP);
    left.moveTo(LEFT);
    expect(ghost(left)?.shape).toBe("l-left");
    left.click(LEFT);
    const r = placedL(right);
    const m = placedL(left);
    const mirror = (p: Point): Point => ({ x: p.x, y: Math.round((4 - p.y) * 1000) / 1000 }); // about y 2
    expect(m.upper).toEqual(r.upper);
    expect(m.landing).toEqual(r.landing);
    expect(m.lower).toEqual(r.lower.map((p) => ({ ...p, at: mirror(p.at), rotation: 0 })));
    expect(r.lower[0]?.rotation).toBe(180);
  });

  it("› press, swing, release gives the same L", () => {
    const clicks = shellOf(loftRoom());
    clicks.click(TOP);
    clicks.click(RIGHT);
    const dragged = shellOf(loftRoom());
    dragged.drag(TOP, RIGHT);
    expect(placedL(dragged)).toEqual(placedL(clicks));
  });

  it("› the L ghost draws both flights, 6 risers each, and the landing as a deck ghost, red where the L doesn't fit", () => {
    const shell = shellOf(loftRoom());
    shell.click(TOP);
    shell.moveTo(RIGHT);
    const landing = lOf(ghost(shell))?.landing;
    if (!landing) throw new Error("no landing");
    const ring = deckRing(landing);
    const overlays = layer(shell.scene(), "overlays");
    expect(texts(overlays).filter((t) => t === "UP · 6 R")).toHaveLength(2);
    const edgeColour = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" && p.dash && ring.some((q) => Math.hypot(q.x - p.a.x, q.y - p.a.y) < 1e-9) ? [p.color] : []));
    expect(edgeColour(overlays)).toHaveLength(4);
    expect(edgeColour(overlays)).not.toContain(COLORS.invalid);
    // Fixed near the edge's low end, swinging left runs the lower flight through the wall: the whole L goes red.
    shell.key("Escape");
    shell.click({ x: 2.6, y: 0.6 });
    shell.moveTo({ x: 2.6, y: -0.4 });
    const red = ghost(shell);
    expect(red).toMatchObject({ shape: "l-left", fits: false });
    expect(red?.l?.lower.fits).toBe(false);
    const redRing = red?.l ? deckRing(red.l.landing) : [];
    const redEdges = layer(shell.scene(), "overlays").flatMap((p) => (p.kind === "segment" && p.dash && redRing.some((q) => Math.hypot(q.x - p.a.x, q.y - p.a.y) < 1e-9) ? [p.color] : []));
    expect(redEdges).toEqual([COLORS.invalid, COLORS.invalid, COLORS.invalid, COLORS.invalid]);
    shell.click({ x: 2.6, y: -0.4 }); // click 2 on a red L places nothing, and stays fixed
    expect(placed(shell, "stair")).toEqual([]);
    expect(phase(shell)).toBe("fixed");
  });

  it("› with a ship's ladder, one click places the straight flight (AC-08, stairdraw.56)", () => {
    const shell = shellOf(loftRoom(), "shipsLadder");
    shell.moveTo({ x: 2.3, y: 2.03 });
    const straight = asGhost(ghost(shell));
    shell.click({ x: 2.3, y: 2.03 });
    const ladders = placed(shell, "shipsLadder");
    expect(ladders.map((p) => asPlaced(shell, p))).toEqual([straight, straight]);
    expect(decksBut(shell, LOFT)).toEqual([]);
    expect(phase(shell)).toBe("hover");
  });

  it("› a ship's ladder pressed and dragged sideways keeps the straight ghost; the release places it (AC-08)", () => {
    const shell = shellOf(loftRoom(), "shipsLadder");
    shell.moveTo({ x: 2.3, y: 2.03 });
    const straight = asGhost(ghost(shell));
    shell.down({ x: 2.3, y: 2.03 });
    shell.moveTo({ x: 2.3, y: 3.2 });
    expect(ghost(shell)).toMatchObject({ shape: "straight" });
    expect(ghost(shell)?.l).toBeUndefined();
    expect(asGhost(ghost(shell))).toEqual(straight);
    shell.up({ x: 2.3, y: 3.2 });
    expect(placed(shell, "shipsLadder").map((p) => asPlaced(shell, p))).toEqual([straight, straight]);
  });

  it("› a spiral places on one click, its entry-side zone in both layouts (AC-08, AC-14)", () => {
    const shell = shellOf(loftRoom(), "spiralStair");
    shell.moveTo({ x: 2.6, y: 2.03 });
    const round = asGhost(ghost(shell));
    shell.click({ x: 2.6, y: 2.03 });
    const spirals = placed(shell, "spiralStair");
    expect(spirals.map((p) => asPlaced(shell, p))).toEqual([round, round]);
    expect(spirals.map((p) => p.sides)).toEqual([spirals[0]?.sides, spirals[0]?.sides]);
    expect(Object.values(spirals[0]?.sides ?? {}).filter(Boolean)).toHaveLength(1); // one zone, on its entry side
  });

  it("› a red ship's ladder places nothing on click 1 and pins its chips (stairdraw.48, .56)", () => {
    // A box at x 2.7–3.3 across the ladder's 1.10 run from x 1.9; a rung ladder's 0.58 still fits.
    const doc = checked(withCommands(loftRoom(), { type: "placeObject", opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 3.0, y: 2 }, rotation: 0, deck: null }));
    const shell = shellOf(doc, "shipsLadder");
    shell.moveTo({ x: 2.3, y: 2.03 });
    expect(ghost(shell)?.fits).toBe(false);
    shell.click({ x: 2.3, y: 2.03 });
    expect(placed(shell, "shipsLadder")).toEqual([]);
    expect(phase(shell)).toBe("fixed");
    expect(shell.view().commandBar.chips.map((c) => c.id)).toContain("rungLadder/straight");
    shell.click({ x: 2.3, y: 2.03 }); // a later click is refused and keeps the chips (stairdraw.53)
    expect(placed(shell, "shipsLadder")).toEqual([]);
    expect(shell.view().commandBar.chips.map((c) => c.id)).toContain("rungLadder/straight");
  });

  it("› to a 0.45 platform an L is too low to turn: one click places the straight flight (stairdraw.58)", () => {
    const doc = checked(withCommands(roomDoc(), ...base, { type: "addDeck", opId: "plat", preset: "platform", at: { x: 0.7, y: 2 }, w: 1.2, d: 3.8, name: "Platform" }));
    const shell = shellOf(doc);
    shell.moveTo({ x: 1.5, y: 2.03 });
    const straight = asGhost(ghost(shell));
    expect(straight).toMatchObject({ at: { x: 1.3, y: 2 }, h: 0.45, reaches: "plat/k0" });
    shell.click({ x: 1.5, y: 2.03 });
    expect(placed(shell, "stair").map((p) => asPlaced(shell, p))).toEqual([straight, straight]);
    expect(phase(shell)).toBe("hover");
  });

  it("› to a 0.45 platform, pressed and dragged sideways, the ghost stays straight and the release places it", () => {
    const doc = checked(withCommands(roomDoc(), ...base, { type: "addDeck", opId: "plat", preset: "platform", at: { x: 0.7, y: 2 }, w: 1.2, d: 3.8, name: "Platform" }));
    const shell = shellOf(doc);
    shell.moveTo({ x: 1.5, y: 2.03 });
    const straight = asGhost(ghost(shell));
    shell.down({ x: 1.5, y: 2.03 });
    shell.moveTo({ x: 1.5, y: 3.0 });
    expect(ghost(shell)).toMatchObject({ shape: "straight" });
    shell.up({ x: 1.5, y: 3.0 });
    expect(placed(shell, "stair").map((p) => asPlaced(shell, p))).toEqual([straight, straight]);
  });
});

// The fix chips (AC-12, stairdraw.13, .43): a box at x 4.2–4.8, y 1.7–2.3 across the Stair's run from (1.9, 2) leaves
// 2.30 of free floor, so the Stair is 2.988 − 2.30 (less the 1 mm within which solids touch) = 0.69 short; its L
// (the landing ends at x 4.158) and the shorter kinds still fit. The chips are in the hint line, off the canvas.
describe("the fix chips (AC-12)", () => {
  const short = (): Document =>
    checked(withCommands(loftRoom(), { type: "placeObject", opId: "b", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 4.5, y: 2.3 }, rotation: 0, deck: null }));
  const TOP: Point = { x: 2.6, y: 2.03 };
  const preview = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.preview : null);
  const chips = (shell: FakeShell) => shell.view().commandBar.chips;
  const chipId = (shell: FakeShell, label: string): string => {
    const chip = chips(shell).find((c) => c.label === label);
    if (!chip) throw new Error(`no chip ${label}: ${JSON.stringify(chips(shell))}`);
    return chip.id;
  };
  const overlays = (shell: FakeShell): string[] => texts(layer(shell.scene(), "overlays"));
  const flightPose = (g: ObjectGhost | undefined | null) => g && { at: g.at, rotation: g.rotation, w: g.w, d: g.d, h: g.h };

  it("hovering a chip previews its stair; clicking places it in one edit; the armed kind stays Stair", () => {
    const shell = shellOf(short());
    shell.click(TOP);
    shell.moveTo({ x: 3.4, y: 2.03 }); // straight out, the cursor a little to the right (+y)
    shell.send({ type: "pointerLeave" }); // on the way to the hint line
    const frozen = ghost(shell);
    expect(frozen).toMatchObject({ at: { x: 1.9, y: 2 }, shape: "straight", fits: false });
    expect(phase(shell)).toBe("fixed");
    expect(shell.view().commandBar.prompt).toBe("Doesn't fit: 0.69 m short");
    expect(chips(shell)).toEqual([
      { id: "stair/l-right", label: "Make it an L" },
      { id: "storageStair/straight", label: "Storage stair", detail: "1.99 m" },
      { id: "shipsLadder/straight", label: "Ship's ladder", detail: "1.10 m" },
    ]);
    // Hovering the storage stair's chip draws it in the ghost's place: 10 risers, not the Stair's 12.
    shell.ui({ type: "chipHover", id: chipId(shell, "Storage stair") });
    expect(preview(shell)).toMatchObject({ kind: "storageStair", at: { x: 1.9, y: 2 }, rotation: 90, d: 1.992, h: 2.15, reaches: LOFT, fits: true });
    expect(overlays(shell)).toContain("UP · 10 R");
    expect(overlays(shell)).not.toContain("UP · 12 R");
    expect(chips(shell).map((c) => c.label)).toEqual(["Make it an L", "Storage stair", "Ship's ladder"]); // the chips stay put
    // Leaving the chip brings the frozen ghost back.
    shell.ui({ type: "chipHover", id: null });
    expect(preview(shell)).toBeNull();
    expect(ghost(shell)).toEqual(frozen);
    expect(overlays(shell)).toContain("UP · 12 R");
    // The L's chip previews the L, and clicking it places exactly that, in every layout, in one edit.
    const id = chipId(shell, "Make it an L");
    shell.ui({ type: "chipHover", id });
    const l = preview(shell);
    expect(l).toMatchObject({ kind: "stair", shape: "l-right", fits: true });
    expect(overlays(shell).filter((t) => t === "UP · 6 R")).toHaveLength(2);
    shell.ui({ type: "chipClick", id });
    const flights = placed(shell, "stair");
    expect(flights).toHaveLength(4);
    const pose = (p: Placement) => {
      const { at, rotation, w, d, h } = asPlaced(shell, p);
      return { at, rotation, w, d, h };
    };
    const reachesLoft = (p: Placement): boolean => shell.doc().objects[p.object]?.reaches === LOFT;
    expect(flights.filter(reachesLoft).map(pose)).toEqual([flightPose(l), flightPose(l)]);
    expect(flights.filter((p) => !reachesLoft(p)).map(pose)).toEqual([flightPose(l?.l?.lower), flightPose(l?.l?.lower)]);
    expect(Object.keys(shell.doc().decks)).toHaveLength(2); // the loft and the landing
    expect(shell.state.objectKind).toBe("stair");
    expect(phase(shell)).toBe("hover");
    expect(preview(shell)).toBeNull();
    shell.key("z", { meta: true }); // one undo removes all three parts
    expect(placed(shell, "stair")).toEqual([]);
    expect(Object.keys(shell.doc().decks)).toEqual([LOFT]);
  });

  it("› chips before click 1 place at the hovered point", () => {
    const shell = shellOf(short());
    shell.moveTo(TOP);
    expect(phase(shell)).toBe("hover");
    shell.send({ type: "pointerLeave" });
    expect(phase(shell)).toBe("hover");
    expect(ghost(shell)).toMatchObject({ at: { x: 1.9, y: 2 }, fits: false });
    shell.ui({ type: "chipClick", id: chipId(shell, "Storage stair") });
    const stairs = placed(shell, "storageStair");
    expect(stairs.map((p) => p.state)).toEqual(["n/s0", "s0"]);
    for (const p of stairs) expect(asPlaced(shell, p)).toEqual({ at: { x: 1.9, y: 2 }, rotation: 90, w: 0.6, d: 1.992, h: 2.15, reaches: LOFT });
    expect(shell.state.objectKind).toBe("stair");
    shell.key("z", { meta: true });
    expect(placed(shell, "storageStair")).toEqual([]);
  });

  it("› the pointer leaving keeps a caught gesture and its ghost frozen; with no edge caught the ghost goes, as today", () => {
    const shell = shellOf(loftRoom());
    shell.moveTo(TOP);
    const hovered = ghost(shell);
    shell.send({ type: "pointerLeave" });
    expect(shell.state.pointer).toBeNull();
    expect(phase(shell)).toBe("hover");
    expect(ghost(shell)).toEqual(hovered);
    expect(overlays(shell)).toContain("UP · 12 R");
    // Fixed and swung into an L, the prompt and the ghost stay those of the L.
    shell.click(TOP);
    shell.moveTo({ x: 2.6, y: 3.0 });
    const swung = ghost(shell);
    shell.send({ type: "pointerLeave" });
    expect(ghost(shell)).toEqual(swung);
    expect(shell.view().commandBar.prompt.replace(/ · \d+ (risers|rungs) × .*$/, "")).toBe("Click to place the L: two flights and a landing at +1.08");
    // Esc off the canvas goes back to hovering at the last cursor.
    shell.key("Escape");
    expect(phase(shell)).toBe("hover");
    expect(ghost(shell)?.at).toEqual({ x: 1.9, y: 3 });
    // Away from every edge, leaving drops the ghost.
    shell.moveTo({ x: 5.3, y: 2 });
    shell.send({ type: "pointerLeave" });
    expect(ghost(shell)).toBeNull();
    expect(phase(shell)).toBeNull();
  });

  it("› off the canvas, an L asked of a rise too low to turn keeps its prompt (the cursor is the gesture's, not the pointer's)", () => {
    const doc = checked(withCommands(roomDoc(), ...base, { type: "addDeck", opId: "plat", preset: "platform", at: { x: 0.7, y: 2 }, w: 1.2, d: 3.8, name: "Platform" }));
    const shell = shellOf(doc);
    shell.down({ x: 1.5, y: 2.03 }); // held: one click would place it (stairdraw.58)
    shell.moveTo({ x: 1.5, y: 3.0 });
    const asked = shell.view().commandBar.prompt;
    expect(asked).toMatch(/^Release to place\. Too low for an L: each flight needs two risers\. Esc cancels · /);
    shell.send({ type: "pointerLeave" });
    expect(shell.view().commandBar.prompt).toBe(asked);
  });
});
