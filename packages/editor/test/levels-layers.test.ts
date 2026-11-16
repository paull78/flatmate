import { describe, expect, it } from "vitest";
import { deckView, quadCentre, swingZone, wallOutlines, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { decksLayer, deckLabelsLayer, overheadsLayer } from "../src/view/decks-layer";
import { objectsLayer, warningsLayer } from "../src/view/objects-layer";
import { openingsDetailed, openingsLayer, spanVisible } from "../src/view/openings-layer";
import { CANVAS_STYLE, pictureLayers, planPicture, PRESENTATION_STYLE, type PlanStyle } from "../src/view/picture";
import { planView } from "../src/levels";
import { floorView } from "../src/view/plan-view";
import type { LayerName, Primitive, Scene } from "../src/view/scene-types";
import { LAYER_ORDER } from "../src/view/scene";
import { ghostsLayer, wallsLayer } from "../src/view/walls-layer";
import { dimensionsLayer } from "../src/view/dimensions-layer";
import { tagsLayer, zoneFillsLayer } from "../src/view/zones-layer";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Drawing at an upper level (spec "Drawing at an upper level", levels.04, .18, .19; AC-03). At the loft (+2.15, cut
// 2.325 under 2.50) a thing whose top is at or below 2.15 is ghosted (walls, decks) or hidden (pieces, room fills,
// tags, dimensions); the loft itself draws filled with its label; warnings and the flip follow their piece.

const LOFT = "loft/k0";
const PARTITION = "part/w0";
const place = (opId: string, kind: string, at: Point, more: Partial<Extract<Command, { type: "placeObject" }>> = {}): Command =>
  ({ type: "placeObject", linked: false, deck: null, opId, state: "s0", object: { kind }, at, ...more });

/**
 * The studio: the 5.8 × 3.8 shell (roomDoc, ceiling 2.50) split at x = 2.5 by a 2.03 partition with a door at y
 * 2.6–3.4, under a Loft (top 2.15) at x 1.3–3.7, y 1.4–3.8. In the right room ("Living", L1): a sofa against the bottom
 * wall at x 3.55–5.65, y 0.1–1.0, whose front zone runs into the wall (a warning), and a 2.20 wardrobe beside the loft at
 * x 4.0–5.2, y 3.3–3.9. A dimension along the bottom.
 */
function studio(...more: Command[]): Document {
  return withCommands(
    roomDoc(),
    { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
    { type: "setWallTop", wallId: PARTITION, top: 2.03 },
    { type: "addOpening", opId: "door", wall: PARTITION, kind: "swing", offset: 2.6 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 },
    place("sofa", "sofa", { x: 4.6, y: 1 }),
    place("ward", "wardrobe", { x: 4.6, y: 3.9 }),
    { type: "setObjectSize", objectId: "ward/o0", w: 1.2, d: { standard: 0.6 }, h: { standard: 2.2 } },
    { type: "labelZone", id: "L1", at: { x: 4.5, y: 2.2 }, name: "Living", finish: null },
    { type: "addDimension", opId: "dim", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 },
    ...more,
  );
}

const atLoft = (doc: Document): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setViewedLevel", deck: LOFT });
  return shell;
};
const layer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];
/** The ghost walls' lines, then the walls: every wall primitive in drawing order (the ghosts layer comes first, levels.50). */
const wallsDrawn = (scene: Scene): readonly Primitive[] => [...layer(scene, "ghosts"), ...layer(scene, "walls")];
/** The primitives wholly inside a box. */
const near = (ps: readonly Primitive[], x0: number, x1: number, y0: number, y1: number): Primitive[] =>
  ps.filter((p) => {
    const pts = p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "text" ? [p.at] : p.kind === "disc" ? [p.center] : [p.center];
    return pts.every((q) => q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && q.y >= y0 - 1e-6 && q.y <= y1 + 1e-6);
  });
type Segment = Extract<Primitive, { kind: "segment" }>;
const segments = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const polygons = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p] : []));
const texts = (ps: readonly Primitive[]): string[] => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const px = (s: Segment): number => ("px" in s.width ? s.width.px : NaN);
const sofa = (ps: readonly Primitive[]) => near(ps, 3.55, 5.65, 0.1, 1.0);
const wardrobe = (ps: readonly Primitive[]) => near(ps, 4.0, 5.2, 3.3, 3.9);
/** A ring's edges as the walls and decks layers draw them: from each corner to the next. */
const same = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
const ringStarts = (ss: readonly Segment[], ring: readonly Point[]): Segment[] =>
  ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return ss.filter((s) => same(s.a, a) && same(s.b, b));
  });
/** Whether a wall is drawn filled: a polygon with its outline. */
const filled = (ps: readonly Primitive[], outline: readonly Point[] | undefined): boolean => polygons(ps).some((p) => p.points === outline);
const isGhost = (s: Segment): boolean => s.color === CANVAS_STYLE.ghost.line && px(s) === CANVAS_STYLE.ghost.width && s.dash === undefined;

describe("drawing at the loft (AC-03)", () => {
  it("at the loft: shell walls solid, the partition a ghost outline with no fill, the loft filled with \"Loft +2.15\", no sofa, the wardrobe drawn, no tag, area, dimension, zone fill or sofa warning", () => {
    const doc = studio();
    const floor = FakeShell.withDocument(doc).scene();
    // The fixture changes the answer: at the floor every one of these is drawn.
    expect(filled(layer(floor, "walls"), wallOutlines(doc).get(PARTITION))).toBe(true);
    expect(sofa(layer(floor, "objects")).length).toBeGreaterThan(0);
    expect(texts(layer(floor, "tags"))).toContain("Living");
    expect(layer(floor, "dimensions").length).toBeGreaterThan(0);
    expect(layer(floor, "zoneFills").length).toBeGreaterThan(0);
    expect(layer(floor, "warnings").length).toBeGreaterThan(0);

    const scene = atLoft(doc).scene();
    const walls = wallsDrawn(scene);
    for (const [id, outline] of wallOutlines(doc)) {
      if (id === PARTITION) continue;
      expect(filled(walls, outline), id).toBe(true);
      expect(ringStarts(segments(walls), outline).length).toBeGreaterThan(0);
      expect(ringStarts(segments(walls), outline).every((s) => s.color === CANVAS_STYLE.wall), id).toBe(true);
    }
    const partition = wallOutlines(doc).get(PARTITION) ?? [];
    expect(filled(walls, partition)).toBe(false);
    const edges = ringStarts(segments(walls), partition);
    expect(edges).toHaveLength(partition.length - 4); // less the two edges at each T-joint, under the shell (levels.31)
    expect(edges.every(isGhost)).toBe(true);

    const ring = deckView(doc, LOFT)?.ring;
    expect(polygons(layer(scene, "decks"))).toEqual([{ kind: "polygon", points: ring, holes: [], color: CANVAS_STYLE.deck.tint }]);
    expect(segments(layer(scene, "decks")).length).toBeGreaterThan(0);
    expect(segments(layer(scene, "decks")).every((s) => s.color === CANVAS_STYLE.deck.line.color && px(s) === CANVAS_STYLE.deck.line.width)).toBe(true);
    expect(texts(layer(scene, "deckLabels"))).toEqual(["Loft +2.15", "5.76 m²"]); // the area line (areas.10)
    expect(segments(layer(scene, "overheads")).filter((p) => p.dash !== undefined)).toEqual([]); // no dashed outline; the loft's rail is drawn

    const objects = layer(scene, "objects");
    expect(sofa(objects)).toEqual([]);
    expect(wardrobe(objects)).toEqual(wardrobe(layer(floor, "objects"))); // 0–2.20 reaches above the loft: drawn as today
    expect(wardrobe(objects).length).toBeGreaterThan(0);
    for (const name of ["dimensions", "zoneFills", "warnings"] as const) expect(layer(scene, name), name).toEqual([]);
    // No room tag: the tags slot holds only "Open to below" at a loft's level (edges.07).
    expect(texts(layer(scene, "tags")).every((t) => /^(Open to below|Open to|below)$/.test(t))).toBe(true);
  });

  it("the paper picture at the loft draws the same walls, decks, labels and pieces, and no tag or dimension", () => {
    const doc = studio();
    const shell = atLoft(doc);
    const view = planView(shell.state);
    if (!view) throw new Error("no view");
    const paper = planPicture(doc, view, PRESENTATION_STYLE, 20, true);
    expect(texts(paper.tags).every((t) => /^(Open to below|Open to|below)$/.test(t))).toBe(true); // no room tag (edges.07)
    expect(paper.dimensions).toEqual([]);
    expect(texts(paper.deckLabels)).toEqual(["Loft +2.15", "5.76 m²"]);
    expect(sofa(paper.objects)).toEqual([]);
    const partition = wallOutlines(doc).get(PARTITION) ?? [];
    expect(filled([...paper.ghosts, ...paper.walls], partition)).toBe(false);
    expect(ringStarts(segments(paper.ghosts), partition).length).toBeGreaterThan(0);
    expect(ringStarts(segments(paper.ghosts), partition).every((s) => s.color === PRESENTATION_STYLE.ghost.line && px(s) === PRESENTATION_STYLE.ghost.width)).toBe(true);
  });

  it("the \"under\" boundary: a half wall with its top at exactly 2.15 is a ghost at the loft, one at 2.151 is today's thin outline", () => {
    const doc = studio(
      { type: "addWall", opId: "at", from: { at: { x: 4, y: 2 } }, to: { at: { x: 5.5, y: 2 } } },
      { type: "setWallTop", wallId: "at/w0", top: 2.15 },
      { type: "addWall", opId: "up", from: { at: { x: 4, y: 2.8 } }, to: { at: { x: 5.5, y: 2.8 } } },
      { type: "setWallTop", wallId: "up/w0", top: 2.151 },
    );
    const walls = wallsDrawn(atLoft(doc).scene());
    const at = wallOutlines(doc).get("at/w0") ?? [];
    const up = wallOutlines(doc).get("up/w0") ?? [];
    expect(filled(walls, at)).toBe(false);
    expect(ringStarts(segments(walls), at).length).toBeGreaterThan(0);
    expect(ringStarts(segments(walls), at).every(isGhost)).toBe(true);
    expect(filled(walls, up)).toBe(false);
    const projected = ringStarts(segments(walls), up);
    expect(projected).toHaveLength(up.length);
    expect(projected.every((s) => s.color === CANVAS_STYLE.wall && px(s) === CANVAS_STYLE.projectionWidth)).toBe(true);
  });

  it("a platform at 0.45 draws as a ghost without its label at the loft", () => {
    // x 0.5–1.9, y 0.3–1.3: in the left room, clear of the loft.
    const doc = studio({ type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.2, y: 0.8 }, w: 1.4, d: 1 });
    const ring = deckView(doc, "plat/k0")?.ring ?? [];
    const floor = FakeShell.withDocument(doc).scene();
    expect(polygons(layer(floor, "decks")).some((p) => p.points === ring)).toBe(true);
    expect(texts(layer(floor, "deckLabels"))).toEqual(["Loft +2.15", "5.76 m²", "Platform +0.45", "1.40 m²"]);

    const scene = atLoft(doc).scene();
    expect(polygons(layer(scene, "decks")).some((p) => p.points === ring)).toBe(false);
    const edges = ringStarts(segments(layer(scene, "decks")), ring);
    expect(edges).toHaveLength(4);
    expect(edges.every(isGhost)).toBe(true);
    expect(texts(layer(scene, "deckLabels"))).toEqual(["Loft +2.15", "5.76 m²"]); // the area line (areas.10)
    expect(segments(layer(scene, "overheads")).filter((p) => p.dash !== undefined)).toEqual([]); // no dashed outline; the loft's rail is drawn
  });

  it("a lift bed at the ceiling (2.20–2.50) at the loft crosses the cut 2.325 and draws solid", () => {
    // x 3.9–5.6, y 0.8–2.9, up: 0.30 high against the ceiling.
    const doc = studio(
      place("lift", "liftBed", { x: 4.75, y: 2.9 }, { config: "up" }),
      { type: "setObjectSize", objectId: "lift/o0", w: 1.7, d: { up: 2.1, down: 2.1 }, h: { up: 0.3, down: 0.35 } },
    );
    const bed = (ps: readonly Primitive[]) => near(ps, 3.9, 5.6, 0.8, 2.9);
    const floor = bed(layer(FakeShell.withDocument(doc).scene(), "objects"));
    expect(polygons(floor)).toEqual([]); // wholly above the floor's cut 1.20: dashed
    expect(segments(floor).length).toBeGreaterThan(0);
    expect(segments(floor).every((s) => s.dash !== undefined)).toBe(true);
    const loft = bed(layer(atLoft(doc).scene(), "objects"));
    expect(polygons(loft)).toHaveLength(1);
    expect(segments(loft).some((s) => s.dash !== undefined)).toBe(false);
  });

  it("the Day/Night flip at the loft animates the loft's pieces only", () => {
    // A 0.30 box on the loft at x 2.0–2.6, y 2.0–2.6 in Layout, at x 1.5–2.1 in Night; the sofa moves 1 m in Night.
    const doc = studio(
      { type: "addState", opId: "n", name: "Night" },
      place("box", "block", { x: 4.6, y: 2.6 }),
      { type: "setObjectSize", objectId: "box/o0", w: 0.6, d: { standard: 0.6 }, h: { standard: 0.3 } },
      { type: "movePlacement", placementId: "box/p0", at: { x: 2.3, y: 2.6 }, rotation: 0, deck: LOFT },
      { type: "placeObject", linked: false, deck: LOFT, opId: "box2", state: "n/s0", object: { existing: "box/o0" }, at: { x: 1.8, y: 2.6 } },
      { type: "placeObject", linked: false, deck: null, opId: "sofa2", state: "n/s0", object: { existing: "sofa/o0" }, at: { x: 4.6, y: 2 } },
    );
    const flipAt = (shell: FakeShell) => {
      shell.ui({ type: "setActiveState", id: "n/s0" });
      shell.send({ type: "frame", now: 250 });
      expect(shell.state.flip).not.toBeNull();
      return layer(shell.scene(), "objects");
    };
    const floor = flipAt(FakeShell.withDocument(doc));
    expect(near(floor, 3.55, 5.65, 0.1, 2.0).length).toBeGreaterThan(0); // the sofa glides at the floor
    const loft = flipAt(atLoft(doc));
    expect(near(loft, 3.55, 5.65, 0.1, 2.0)).toEqual([]);
    expect(near(loft, 1.5, 2.6, 2.0, 2.6).length).toBeGreaterThan(0); // the box glides on the loft
    expect(wardrobe(loft).length).toBeGreaterThan(0); // fading out: Night has no wardrobe
  });

  it("the sofa's warning shows at the floor and goes with the sofa at the loft; the wardrobe's stays", () => {
    // A chair in front of the wardrobe (x 4.375–4.825, y 2.85–3.3) blocks its front zone; the chair (0.90) is under the loft.
    const doc = studio(place("chair", "chair", { x: 4.6, y: 3.3 }));
    const view = planView(atLoft(doc).state);
    if (!view) throw new Error("no view");
    expect(polygons(warningsLayer(doc, floorView(doc, "s0")))).toHaveLength(2);
    const loftWarnings = polygons(warningsLayer(doc, view));
    expect(loftWarnings).toHaveLength(1);
    expect(near(loftWarnings, 4.0, 5.2, 2.7, 3.3)).toHaveLength(1); // the wardrobe's front zone
  });

  it("a door swing blocked by a chair warns at the floor; at the loft the warning goes with the chair", () => {
    const base = studio();
    const [door] = Object.keys(base.openings);
    const swing = door ? swingZone(base, door) : null;
    const centre = swing ? quadCentre(swing) : null;
    if (!centre) throw new Error("no swing");
    // A 0.45 chair centred in the swing: its back edge 0.225 above the centre.
    const doc = withCommands(base, place("chair", "chair", { x: centre.x, y: centre.y + 0.225 }));
    expect(warningsLayer(doc, floorView(doc, "s0")).some((p) => p.kind === "polygon" && p.points === swingZone(doc, door ?? ""))).toBe(true);
    const view = planView(atLoft(doc).state);
    if (!view) throw new Error("no view");
    expect(warningsLayer(doc, view)).toEqual([]);
  });
});

/** Whether a point lies inside a polygon or within 1e-6 of its boundary. */
function covers(ring: readonly Point[], q: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1)));
    if (Math.hypot(a.x + t * ab.x - q.x, a.y + t * ab.y - q.y) < 1e-6) return true;
    if (a.y > q.y !== b.y > q.y && q.x < a.x + ((q.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}
const T_JOINTS: readonly Point[] = [{ x: 2.5, y: 0 }, { x: 2.5, y: 4 }]; // where the partition meets the shell

describe("the partition's T-joints with the shell at the loft (levels.31, .33)", () => {
  it("at the loft no ghost primitive is drawn after a solid wall fill that it overlaps", () => {
    const walls = wallsDrawn(atLoft(studio()).scene());
    let checked = 0;
    walls.forEach((ghost, i) => {
      if (ghost.kind !== "segment" || !isGhost(ghost)) return;
      // Inner points only: an edge may end on a wall face.
      const inner = [0.1, 0.25, 0.5, 0.75, 0.9].map((t) => ({ x: ghost.a.x + t * (ghost.b.x - ghost.a.x), y: ghost.a.y + t * (ghost.b.y - ghost.a.y) }));
      if (T_JOINTS.some((j) => [ghost.a, ghost.b].some((q) => Math.hypot(q.x - j.x, q.y - j.y) < 0.2))) checked++;
      for (const fill of polygons(walls.slice(0, i))) {
        expect(inner.some((q) => covers(fill.points, q)), `ghost ${JSON.stringify(ghost.a)}–${JSON.stringify(ghost.b)}`).toBe(false);
      }
    });
    expect(checked).toBeGreaterThan(0); // the partition's edges reach the joints
  });

  it("at the loft the shell's fill covers the T-joint with the ghost partition (no notch)", () => {
    const doc = studio();
    for (const [where, shell] of [["floor", FakeShell.withDocument(doc)], ["loft", atLoft(doc)]] as const) {
      const fills = polygons(layer(shell.scene(), "walls")).filter((p) => p.color === CANVAS_STYLE.wall);
      for (const j of T_JOINTS) {
        for (let i = 0; i <= 10; i++) {
          for (let k = 0; k <= 5; k++) {
            const q = { x: j.x - 0.2 + i * 0.0371, y: j.y - 0.09 + k * 0.0353 }; // the shell's body, 0.10 each side of its centre line
            expect(fills.some((f) => covers(f.points, q)), `${where} ${q.x.toFixed(3)}, ${q.y.toFixed(3)}`).toBe(true);
          }
        }
      }
    }
    // The shell's inner face runs on across the partition's end, at y 0.10 and 3.90, as a wall edge.
    const faces = segments(layer(atLoft(doc).scene(), "walls")).filter((s) => s.color === CANVAS_STYLE.wall && px(s) === CANVAS_STYLE.wallEdge);
    for (const y of [0.1, 3.9]) {
      const ends = [{ x: 2.4, y }, { x: 2.6, y }];
      expect(faces.some((s) => ends.every((e) => same(e, s.a) || same(e, s.b))), `face at ${y}`).toBe(true);
    }
  });

  it("at the loft a door on the 2.03 partition draws no span fill and no swing", () => {
    const doc = studio();
    const door = (ps: readonly Primitive[]) => near(ps, 1.6, 3.4, 2.5, 3.5); // the partition at x 2.5, the door at y 2.6–3.4
    const floor = door(layer(FakeShell.withDocument(doc).simpleScene(), "openings"));
    expect(polygons(floor)).toHaveLength(1);
    expect(floor.some((p) => p.kind === "arc")).toBe(true);
    expect(door(layer(atLoft(doc).scene(), "openings"))).toEqual([]);
  });
});

/** The shell's body around each T-joint, 0.10 each side of its centre line, sampled on a grid. */
function shellBody(fills: readonly { points: readonly Point[] }[], where: string): void {
  for (const j of T_JOINTS) {
    for (let i = 0; i <= 10; i++) {
      for (let k = 0; k <= 5; k++) {
        const q = { x: j.x - 0.2 + i * 0.0371, y: j.y - 0.09 + k * 0.0353 };
        expect(fills.some((f) => covers(f.points, q)), `${where} ${q.x.toFixed(3)}, ${q.y.toFixed(3)}`).toBe(true);
      }
    }
  }
}
/** Segments drawn at the projection width (a wall below the cut). */
const projected = (ps: readonly Primitive[]): Segment[] => segments(ps).filter((s) => px(s) === CANVAS_STYLE.projectionWidth);

describe("a wall below the cut at a T-joint with the shell (cleanup.04, .14; AC-03)", () => {
  it("at the floor a half wall (top 1.00) meeting the shell leaves no notch, with a face line and no outline across it", () => {
    const two = withCommands(
      roomDoc(),
      { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
      { type: "setWallTop", wallId: PARTITION, top: 1 },
      { type: "addWall", opId: "second", from: { at: { x: 4.5, y: 0 } }, to: { at: { x: 4.5, y: 4 } } },
    );
    const doc = withCommands(two, { type: "setWallTop", wallId: "second/w0", top: 1 }); // two half walls: each one's ends go
    const shell = FakeShell.withDocument(doc);
    const walls = layer(shell.scene(), "walls");
    shellBody(solidFills(walls), "floor");
    // The shell's inner face runs on across the partition's end, as a wall edge.
    const faces = solidLines(walls).filter((s) => px(s) === CANVAS_STYLE.wallEdge);
    for (const y of [0.1, 3.9]) {
      const ends = [{ x: 2.4, y }, { x: 2.6, y }];
      expect(faces.some((s) => ends.every((e) => same(e, s.a) || same(e, s.b))), `face at ${y}`).toBe(true);
    }
    // No projection-width line crosses the shell's body: inner points of each lie outside every solid fill.
    const fills = solidFills(walls);
    const across = projected(walls).filter((s) =>
      [0.25, 0.5, 0.75].some((t) => fills.some((f) => covers(f.points, { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) }) && !onBoundary(f.points, s))),
    );
    expect(across).toEqual([]);
    // Each half wall keeps only its two long sides as projection lines: its ends at the shell are the shares' edges.
    expect(projected(walls)).toHaveLength(4);
    expect(projected(walls).every((s) => Math.abs(s.b.y - s.a.y) > 3)).toBe(true);
  });

  it("the share takes the plain wall colour when the filled walls at the joint differ; their own colour when they agree", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
      { type: "setWallTop", wallId: PARTITION, top: 1 },
    );
    const bottom = Object.keys(doc.walls).filter((id) => {
      const w = doc.walls[id];
      const [a, b] = [w && doc.joints[w.a], w && doc.joints[w.b]];
      return a && b && a.y === 0 && b.y === 0;
    });
    expect(bottom).toHaveLength(2);
    const shareAt = (selected: string[]): string | undefined => {
      const shell = FakeShell.withDocument(doc);
      shell.state = { ...shell.state, selection: selected.map((id) => ({ table: "walls" as const, id })) };
      const q = { x: 2.5, y: 0.05 }; // inside the T's share, under both shell walls
      return [...polygons(layer(shell.scene(), "walls"))].reverse().find((p) => covers(p.points, q))?.color;
    };
    for (const one of bottom) expect(shareAt([one]), one).toBe(CANVAS_STYLE.wall);
    expect(shareAt(bottom)).toBe(COLORS.wallSelected);
    expect(shareAt([PARTITION])).toBe(CANVAS_STYLE.wall); // the half wall's own highlight stays off the shell
  });

  it("a wall below the cut keeps every edge where it meets a solid wall at an L or runs on from one", () => {
    // The half wall also meets the shell at a T (x 2, y 0), so its share there is drawn and the edge filter runs.
    const doc = withCommands(
      roomDoc(),
      { type: "addWall", opId: "h", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 2 } } },
      { type: "addWall", opId: "s", from: { at: { x: 2, y: 2 } }, to: { at: { x: 3, y: 2 } } },
    );
    const half = "h/w0"; // the split shell fragments are h/w1…
    const lowered = withCommands(doc, { type: "setWallTop", wallId: half, top: 1 });
    const outline = wallOutlines(lowered).get(half) ?? [];
    expect(outline.length).toBeGreaterThan(2);
    const walls = layer(FakeShell.withDocument(lowered).scene(), "walls");
    const edges = projected(walls);
    let kept = 0;
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length] ?? a;
      if (a.y < 0.15 && b.y < 0.15) return; // an end edge on the T's share at the shell
      if (a.y > 1.85 && b.y > 1.85) return; // the L's mitre, inside the fill the full wall takes (mitres.05)
      kept++;
      expect(edges.some((s) => same(s.a, a) && same(s.b, b)), `edge ${i}`).toBe(true);
    });
    expect(kept).toBeGreaterThanOrEqual(2); // the long sides
  });

  it("at an upper level a wall between the level and its cut takes its share at the T too", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
      { type: "setWallTop", wallId: PARTITION, top: 2.2 }, // the loft's cut is 2.325: "below" there
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4, y: 2 }, w: 1.6, d: 1.6 },
    );
    const walls = layer(atLoft(doc).scene(), "walls");
    shellBody(solidFills(walls), "loft");
  });
});

/** Whether segment s lies along one of the ring's edges (a face line on the fill's own boundary). */
function onBoundary(ring: readonly Point[], s: Segment): boolean {
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const cross = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return Math.abs(cross(s.a)) < 1e-9 && Math.abs(cross(s.b)) < 1e-9;
  });
}

const solidFills = (ps: readonly Primitive[]) => polygons(ps).filter((p) => p.color === CANVAS_STYLE.wall);
const solidLines = (ps: readonly Primitive[]): Segment[] => segments(ps).filter((s) => s.color === CANVAS_STYLE.wall);

describe("ghost joints with solid walls at the loft (levels.40)", () => {
  /** roomDoc split at x = 2.5 by a 2.03 partition; a Loft at x 3.3–5.3, y 1–3, clear of every wall. */
  function split(edit: (doc: Document) => Command[], loft: Point = { x: 4.3, y: 2 }): Document {
    const doc = withCommands(
      roomDoc(),
      { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
      { type: "setWallTop", wallId: PARTITION, top: 2.03 },
    );
    return withCommands(doc, ...edit(doc), { type: "addDeck", opId: "loft", preset: "loft", at: loft, w: 1.6, d: 1.2 });
  }
  const filledAt = (ps: readonly Primitive[], q: Point): boolean => solidFills(ps).some((f) => covers(f.points, q));

  /** Whether a solid face line joins p and q, either way round. */
  const faceLine = (ps: readonly Primitive[], p: Point, q: Point): boolean =>
    solidLines(ps).some((s) => px(s) === CANVAS_STYLE.wallEdge && ((same(s.a, p) && same(s.b, q)) || (same(s.a, q) && same(s.b, p))));

  it("› a full wall ending on a ghost partition (solid stem, ghost bar): it takes the joint, through to the bar's far face and no further (mitres.01)", () => {
    // The stem (0, 2)–(2.5, 2) meets the partition from the left; the partition's body right of its centre line is ghost.
    const doc = split(() => [{ type: "addWall", opId: "stem", from: { at: { x: 0, y: 2 } }, to: { at: { x: 2.5, y: 2 } } }]);
    const beyond: Point[] = [{ x: 2.53, y: 2 }, { x: 2.55, y: 2.01 }, { x: 2.55, y: 1.99 }, { x: 2.57, y: 2.005 }];
    const floor = layer(FakeShell.withDocument(doc).scene(), "walls");
    for (const q of beyond) expect(filledAt(floor, q), `floor ${JSON.stringify(q)}`).toBe(true); // the partition is solid there

    const walls = layer(atLoft(doc).scene(), "walls");
    for (const q of beyond) expect(filledAt(walls, q), `loft ${JSON.stringify(q)}`).toBe(true);
    expect(filledAt(walls, { x: 2.45, y: 2 })).toBe(true); // the stem still fills its own end
    expect(filledAt(walls, { x: 2.65, y: 2 })).toBe(false); // past the far face, nothing
    expect(filledAt(walls, { x: 2.5, y: 2.15 })).toBe(false); // beside the stem's width, nothing
    const past = solidLines(walls).filter((s) => [s.a, s.b].some((e) => e.x > 2.6 + 1e-6 && e.x < 2.7 && Math.abs(e.y - 2) < 0.2));
    expect(past).toEqual([]);
    expect(faceLine(walls, { x: 2.4, y: 2.1 }, { x: 2.6, y: 2.1 })).toBe(true); // the cut across the bar, each side of the stem
    expect(faceLine(walls, { x: 2.4, y: 1.9 }, { x: 2.6, y: 1.9 })).toBe(true);
  });

  it("› a ghost in line with a solid wall at a T: no fill spills into the ghost", () => {
    // The shell's bottom wall is a 2.03 ghost left of the partition, (0, 0)–(2.5, 0), and solid right of it.
    const doc = split((d) => [{ type: "setWallTop", wallId: wallBetween(d, { x: 0, y: 0 }, { x: 2.5, y: 0 }), top: 2.03 }]);
    const ghostSide: Point[] = [{ x: 2.47, y: 0 }, { x: 2.45, y: -0.05 }, { x: 2.45, y: 0.05 }, { x: 2.52, y: 0.08 }];
    const floor = layer(FakeShell.withDocument(doc).scene(), "walls");
    for (const q of ghostSide) expect(filledAt(floor, q), `floor ${JSON.stringify(q)}`).toBe(true);

    const walls = layer(atLoft(doc).scene(), "walls");
    for (const q of ghostSide) expect(filledAt(walls, q), `loft ${JSON.stringify(q)}`).toBe(false);
    expect(filledAt(walls, { x: 2.55, y: -0.05 })).toBe(true); // the solid half still fills to the joint
    const past = solidLines(walls).filter((s) => [s.a, s.b].some((e) => e.x < 2.5 - 1e-6 && e.x > 2.3 && Math.abs(e.y) < 0.15));
    expect(past).toEqual([]);
  });

  it("› a ghost in line with a solid wall at a T whose stem is solid: the ghost's share fills, so the solids' corner is a chamfer (a supported constraint)", () => {
    // The partition full height, the shell's bottom wall a 2.03 ghost left of it, (0, 0)–(2.5, 0), and solid right of it.
    const doc = split((d) => [
      { type: "setWallTop", wallId: PARTITION, top: "ceiling" },
      { type: "setWallTop", wallId: wallBetween(d, { x: 0, y: 0 }, { x: 2.5, y: 0 }), top: 2.03 },
    ]);
    const walls = layer(atLoft(doc).scene(), "walls");
    for (const q of [{ x: 2.47, y: 0 }, { x: 2.45, y: 0.03 }, { x: 2.48, y: -0.05 }]) expect(filledAt(walls, q), JSON.stringify(q)).toBe(true);
    expect(faceLine(walls, { x: 2.4, y: 0.1 }, { x: 2.5, y: -0.1 })).toBe(true); // the chamfer
    expect(filledAt(walls, { x: 2.42, y: -0.08 })).toBe(false); // short of the corner the faces would meet at
  });

  it("› a + joint with two ghosts side by side: their shares fill the solid L's square outer corner", () => {
    // Full walls north and east of (2.5, 2), ghosts south and west (2.03); the loft at x 3.5–5.1, y 0.4–1.6.
    const base = split(() => [
      { type: "addWall", opId: "x", from: { at: { x: 0, y: 2 } }, to: { at: { x: 2.5, y: 2 } } },
      { type: "addWall", opId: "x2", from: { at: { x: 2.5, y: 2 } }, to: { at: { x: 6, y: 2 } } },
    ], { x: 4.3, y: 1 });
    const doc = withCommands(base,
      { type: "setWallTop", wallId: wallBetween(base, { x: 2.5, y: 2 }, { x: 2.5, y: 4 }), top: "ceiling" },
      { type: "setWallTop", wallId: wallBetween(base, { x: 0, y: 2 }, { x: 2.5, y: 2 }), top: 2.03 },
    );
    const walls = layer(atLoft(doc).scene(), "walls");
    for (let i = 0; i <= 8; i++) {
      for (let k = 0; k <= 8; k++) {
        const q = { x: 2.41 + i * 0.0225, y: 1.91 + k * 0.0225 }; // the joint's square, inside its faces
        expect(filledAt(walls, q), JSON.stringify(q)).toBe(true);
      }
    }
    expect(faceLine(walls, { x: 2.4, y: 1.9 }, { x: 2.4, y: 2.1 })).toBe(true); // the north wall's west face, run on
    expect(faceLine(walls, { x: 2.4, y: 1.9 }, { x: 2.6, y: 1.9 })).toBe(true); // the east wall's south face, run on
  });

  it("› a + joint whose ghosts each sit between two solids fills like the studio's T: no notch and no hairline", () => {
    // Full walls west and east of (2.5, 2), the partition's halves north and south of it ghosts; the loft at x 3.5–5.1,
    // y 0.4–1.6. The studio's own T is the "T-joints with the shell" tests above, kept.
    const doc = split(() => [
      { type: "addWall", opId: "x", from: { at: { x: 0, y: 2 } }, to: { at: { x: 2.5, y: 2 } } },
      { type: "addWall", opId: "x2", from: { at: { x: 2.5, y: 2 } }, to: { at: { x: 6, y: 2 } } },
    ], { x: 4.3, y: 1 });
    const walls = wallsDrawn(atLoft(doc).scene());
    for (const q of [{ x: 2.5, y: 2.05 }, { x: 2.52, y: 2.07 }, { x: 2.5, y: 1.95 }, { x: 2.48, y: 1.93 }]) { // the ghosts' shares
      expect(filledAt(walls, q), JSON.stringify(q)).toBe(true);
    }
    walls.forEach((ghost, i) => {
      if (ghost.kind !== "segment" || !isGhost(ghost)) return;
      const inner = [0.1, 0.5, 0.9].map((t) => ({ x: ghost.a.x + t * (ghost.b.x - ghost.a.x), y: ghost.a.y + t * (ghost.b.y - ghost.a.y) }));
      for (const fill of solidFills(walls.slice(0, i))) expect(inner.some((q) => covers(fill.points, q))).toBe(false);
    });
  });

  it("› a ghost face running along part of a solid face: the solid's dark edge is drawn last", () => {
    // A 1.00 half wall at y 1.3, x 3–6 (a ghost at the loft) and a full wall at y 1.5, x 1.8–6: their faces share y 1.4.
    const doc = withCommands(
      roomDoc(),
      { type: "addWall", opId: "g", from: { at: { x: 6, y: 1.3 } }, to: { at: { x: 3, y: 1.3 } } },
      { type: "addWall", opId: "s", from: { at: { x: 6, y: 1.5 } }, to: { at: { x: 1.8, y: 1.5 } } },
      { type: "setWallTop", wallId: "g/w0", top: 1 },
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.2, y: 2.7 }, w: 1, d: 1 },
    );
    const along = segments(wallsDrawn(atLoft(doc).scene())).filter(
      (s) => Math.abs(s.a.y - 1.4) < 1e-6 && Math.abs(s.b.y - 1.4) < 1e-6 && Math.min(s.a.x, s.b.x) < 4.5 && Math.max(s.a.x, s.b.x) > 4.5,
    );
    expect(along.some(isGhost)).toBe(true); // the fixture changes the answer: both faces are drawn there
    const last = along[along.length - 1];
    expect(last?.color).toBe(CANVAS_STYLE.wall);
    expect(last && px(last)).toBe(CANVAS_STYLE.wallEdge);
  });
});

/** The scene's geometry in the order the WebGL renderer draws it: layer by layer, each layer's polygons, then segments, arcs, discs. */
const drawOrder = (scene: Scene): Primitive[] =>
  scene.layers.flatMap((l) => (["polygon", "segment", "arc", "disc"] as const).flatMap((kind) => l.primitives.filter((p) => p.kind === kind)));
/** The studio with a 0.90 × 1.20 bed (0.30 high) on the loft, right of the partition: x 2.7–3.6, y 2.6–3.8. */
const studioWithBed = (): Document =>
  studio(
    { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed", size: { w: 0.9, d: 1.2 } }, at: { x: 3.15, y: 3.2 } },
    { type: "setObjectSize", objectId: "bed/o0", w: 0.9, d: { standard: 1.2 }, h: { standard: 0.3 } },
    { type: "movePlacement", placementId: "bed/p0", at: { x: 3.15, y: 3.2 }, rotation: 0, deck: LOFT },
  );
const bed = (ps: readonly Primitive[]) => near(ps, 2.7, 3.6, 2.6, 3.8);

describe("ghosts under the level's decks (levels.50)", () => {
  it("› at the loft every ghost primitive is drawn before the loft's fill and the bed", () => {
    const doc = studioWithBed();
    expect(doc.placements["bed/p0"]?.deck).toBe(LOFT);
    const ring = deckView(doc, LOFT)?.ring;
    const shell = atLoft(doc);
    const view = planView(shell.state);
    if (!view) throw new Error("no view");
    const orders: [string, Primitive[], Primitive[]][] = [
      ["canvas", drawOrder(shell.scene()), bed(layer(shell.scene(), "objects"))],
      ["paper", pictureLayers(planPicture(doc, view, PRESENTATION_STYLE, 20, true)), bed(planPicture(doc, view, PRESENTATION_STYLE, 20, true).objects)],
    ];
    for (const [where, drawn, bedPrims] of orders) {
      const style = where === "canvas" ? CANVAS_STYLE : PRESENTATION_STYLE;
      const ghosts = drawn.flatMap((p, i) => (p.kind === "segment" && p.color === style.ghost.line && "px" in p.width && p.width.px === style.ghost.width ? [i] : []));
      expect(ghosts.length, where).toBeGreaterThan(0); // the partition's lines
      const loftFill = drawn.findIndex((p) => p.kind === "polygon" && p.points === ring);
      expect(loftFill, where).toBeGreaterThanOrEqual(0);
      expect(bedPrims.length, where).toBeGreaterThan(0);
      const firstBed = Math.min(...bedPrims.map((p) => drawn.indexOf(p)));
      expect(Math.max(...ghosts), where).toBeLessThan(loftFill);
      expect(Math.max(...ghosts), where).toBeLessThan(firstBed);
    }
  });

  it("› at the loft the shell is drawn after the ghosts and stays continuous at the T-joint", () => {
    const doc = studioWithBed();
    const scene = atLoft(doc).scene();
    const drawn = drawOrder(scene);
    const ghosts = drawn.flatMap((p, i) => (p.kind === "segment" && isGhost(p) ? [i] : []));
    const solid = drawn.flatMap((p, i) => (p.color === CANVAS_STYLE.wall ? [i] : []));
    expect(ghosts.length).toBeGreaterThan(0);
    expect(solid.length).toBeGreaterThan(0);
    expect(Math.max(...ghosts)).toBeLessThan(Math.min(...solid));
    // The ghosts' joint shares stay with the solid walls: the shell's fill covers each T-joint (no notch).
    const fills = solidFills(layer(scene, "walls"));
    for (const j of T_JOINTS) {
      for (let i = 0; i <= 10; i++) {
        for (let k = 0; k <= 5; k++) {
          const q = { x: j.x - 0.2 + i * 0.0371, y: j.y - 0.09 + k * 0.0353 };
          expect(fills.some((f) => covers(f.points, q)), `${q.x.toFixed(3)}, ${q.y.toFixed(3)}`).toBe(true);
        }
      }
    }
    expect(layer(scene, "ghosts").length).toBeGreaterThan(0);
    expect(layer(scene, "ghosts").every((p) => p.kind === "segment" && isGhost(p))).toBe(true); // lines only, no fill
  });

  it("› at the floor the picture's primitives are equal to before", () => {
    const doc = studioWithBed();
    /** The floor's walls as before this step: every wall's filled outline, then every outline's edges (spec: rendering). */
    const before = (style: PlanStyle): Primitive[] => {
      const outlines = [...wallOutlines(doc).values()];
      return [
        ...outlines.map((points): Primitive => ({ kind: "polygon", points, holes: [], color: style.wall })),
        ...outlines.flatMap((ring) => ring.map((a, i): Primitive => ({ kind: "segment", a, b: ring[(i + 1) % ring.length] ?? a, width: { px: style.wallEdge }, color: style.wall, cap: "round" }))),
      ];
    };
    const scene = FakeShell.withDocument(doc).scene();
    expect(layer(scene, "ghosts")).toEqual([]);
    expect(layer(scene, "walls")).toEqual(before(CANVAS_STYLE));
    const p = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true);
    expect(p.ghosts).toEqual([]);
    expect(p.walls).toEqual(before(PRESENTATION_STYLE));
    // The order before this step: decks, objects, overheads, walls, openings, deck labels, tags, dimensions.
    expect(pictureLayers(p)).toEqual([...p.decks, ...p.objects, ...p.overheads, ...p.walls, ...p.openings, ...p.deckLabels, ...p.tags, ...p.dimensions]);
  });

  it("› at the loft a pan keeps the ghosts and walls layers", () => {
    const shell = atLoft(studio());
    const before = shell.scene();
    expect(layer(before, "ghosts").length).toBeGreaterThan(0); // the fixture changes the answer: not the shared empty layer
    shell.wheel(40, 25);
    const after = shell.scene();
    expect(layer(after, "grid")).not.toBe(layer(before, "grid")); // the pan drew a new frame
    expect(layer(after, "ghosts")).toBe(layer(before, "ghosts"));
    expect(layer(after, "walls")).toBe(layer(before, "walls"));
  });
});

describe("the shell's openings at the loft (AC-04)", () => {
  /** The studio's east wall (6, 0)–(6, 4): a window at y 1.2–2.2, and a 0.90 door at y 2.5–3.4 whose swing reaches the wardrobe. */
  function withEastOpenings(): { doc: Document; east: string; door: string } {
    const base = studio();
    const east = Object.values(base.walls).find((w) => base.joints[w.a]?.x === 6 && base.joints[w.b]?.x === 6)?.id ?? "";
    const doc = withCommands(base,
      { type: "addOpening", opId: "win", wall: east, kind: "window", offset: 1.2, width: 1 },
      { type: "addOpening", opId: "ed", wall: east, kind: "swing", offset: 2.5, width: 0.9 },
    );
    const door = Object.values(doc.openings).find((o) => o.wall === east && o.kind === "swing")?.id ?? "";
    return { doc, east, door };
  }

  it("AC-04: at the loft the shell's door and window draw no symbol and no swing, and the wall draws solid across them; at the floor both draw as before", () => {
    const { doc, east, door } = withEastOpenings();
    const onEast = (ps: readonly Primitive[]) => near(ps, 4.9, 6.2, 1.1, 3.5);
    const floor = FakeShell.withDocument(doc).simpleScene();
    expect(polygons(onEast(layer(floor, "openings")))).toHaveLength(2); // a span each
    expect(onEast(layer(floor, "openings")).some((p) => p.kind === "arc")).toBe(true);
    expect(segments(onEast(layer(floor, "openings"))).length).toBeGreaterThan(0); // the glass line and the leaf
    expect(layer(floor, "warnings").some((p) => p.kind === "polygon" && p.points === swingZone(doc, door))).toBe(true);

    const scene = atLoft(doc).scene();
    expect(layer(scene, "openings")).toEqual([]);
    expect(filled(layer(scene, "walls"), wallOutlines(doc).get(east))).toBe(true);
    expect(wardrobe(layer(scene, "objects")).length).toBeGreaterThan(0); // the swing's blocker still shows…
    expect(layer(scene, "warnings").some((p) => p.kind === "polygon" && p.points === swingZone(doc, door))).toBe(false); // …its door doesn't
  });
});

describe("the shell's openings at a mid level (AC-04, levels.40)", () => {
  it("› at a level of 1.70 the shell's door and window are not drawn, nor the door's swing warning; at 1.69 they are", () => {
    // A solid deck in the left room (x 0.5–1.9, y 0.3–1.3) at 1.70 under 2.50: cut 2.10, the openings' heads (2.10) at
    // or below it. At 1.69 the cut is 2.095 and crosses them. The east wall (6, 0)–(6, 4): a window at y 1.2–2.2, a door
    // at y 2.5–3.4 whose swing reaches the wardrobe (0 to 2.20, shown at both levels).
    const east = (top: number) => {
      const base = withCommands(studio(), { type: "addDeck", opId: "mid", preset: "platform", at: { x: 1.2, y: 0.8 }, w: 1.4, d: 1, top });
      const wall = wallBetween(base, { x: 6, y: 0 }, { x: 6, y: 4 });
      const doc = withCommands(base,
        { type: "addOpening", opId: "win", wall, kind: "window", offset: 1.2, width: 1 },
        { type: "addOpening", opId: "ed", wall, kind: "swing", offset: 2.5, width: 0.9 },
      );
      const door = Object.values(doc.openings).find((o) => o.wall === wall && o.kind === "swing")?.id ?? "";
      const shell = FakeShell.withDocument(doc);
      shell.ui({ type: "setViewedLevel", deck: "mid/k0" });
      const view = planView(shell.state);
      const scene = shell.simpleScene();
      return {
        cut: view?.cut,
        openings: near(layer(scene, "openings"), 4.9, 6.2, 1.1, 3.5),
        warned: layer(scene, "warnings").some((p) => p.kind === "polygon" && p.points === swingZone(doc, door)),
        wardrobe: wardrobe(layer(scene, "objects")).length > 0,
      };
    };
    const at170 = east(1.7);
    expect(at170.cut).toBe(2.1);
    expect(at170.openings).toEqual([]);
    expect(at170.wardrobe).toBe(true); // the swing's blocker still shows…
    expect(at170.warned).toBe(false); // …its door doesn't
    const at169 = east(1.69);
    expect(at169.cut).toBe(2.095);
    expect(polygons(at169.openings)).toHaveLength(2); // a span each
    expect(at169.openings.some((p) => p.kind === "arc")).toBe(true); // the swing
    expect(at169.wardrobe).toBe(true);
    expect(at169.warned).toBe(true);
  });
});

describe("the floor level draws as before", () => {
  it("at the floor every layer equals the layer built for the floor view", () => {
    const doc = studio({ type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.2, y: 0.8 }, w: 1.4, d: 1 });
    const shell = FakeShell.withDocument(doc);
    const scene = shell.scene();
    const view = floorView(doc, "s0");
    expect(planView(shell.state)).toBe(view);
    const zoom = shell.state.camera.zoom;
    expect(layer(scene, "walls")).toBe(wallsLayer(doc, view.level, CANVAS_STYLE, "", null, "", null));
    expect(layer(scene, "ghosts")).toBe(ghostsLayer(doc, view.level, CANVAS_STYLE, "", null, "", null));
    expect(layer(scene, "decks")).toBe(decksLayer(doc, view.level, CANVAS_STYLE, "", ""));
    expect(layer(scene, "overheads")).toBe(overheadsLayer(doc, view.level, CANVAS_STYLE, "", null));
    expect(layer(scene, "deckLabels")).toBe(deckLabelsLayer(doc, view.level, CANVAS_STYLE, zoom));
    expect(layer(scene, "objects")).toBe(objectsLayer(doc, view, CANVAS_STYLE, "", zoom));
    expect(layer(scene, "warnings")).toBe(warningsLayer(doc, view));
    expect(layer(scene, "zoneFills")).toBe(zoneFillsLayer(doc, "", false, null, true));
    expect(layer(scene, "tags")).toBe(tagsLayer(doc, CANVAS_STYLE, zoom, "", "s0"));
    expect(layer(scene, "dimensions")).toBe(dimensionsLayer(doc, CANVAS_STYLE, zoom, "", null));
    expect(layer(scene, "openings")).toBe(openingsLayer(doc, view.level, CANVAS_STYLE, "", true, spanVisible(doc, CANVAS_STYLE, zoom), openingsDetailed(CANVAS_STYLE, zoom)));
    // At the floor the floor's decks draw as today: the platform filled, the loft dashed above the cut, both labelled.
    expect(polygons(layer(scene, "decks")).map((p) => p.points)).toEqual([deckView(doc, "plat/k0")?.ring]);
    expect(segments(layer(scene, "overheads"))).toHaveLength(4);
    expect(texts(layer(scene, "deckLabels"))).toEqual(["Loft +2.15", "5.76 m²", "Platform +0.45", "1.40 m²"]);
    expect([...layer(scene, "ghosts"), ...layer(scene, "walls"), ...layer(scene, "decks")].some((p) => p.color === CANVAS_STYLE.ghost.line)).toBe(false);
  });

  it("going up to the loft and back gives equal floor layers", () => {
    const doc = studio();
    const shell = FakeShell.withDocument(doc);
    const before = shell.scene();
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    const loft = shell.scene();
    expect(layer(loft, "walls")).not.toEqual(layer(before, "walls"));
    shell.ui({ type: "setViewedLevel", deck: null });
    const after = shell.scene();
    for (const l of before.layers) expect(layer(after, l.name), l.name).toEqual(l.primitives);
  });
});

// Ghost lines sit under solid wall fills at upper levels (tidy C7, levels.41, .51): the ghosts layer is drawn first, so
// a ghost edge lying inside a solid wall (parallel walls closer than their thickness) is covered by the fill.
describe("ghost lines are drawn before the solid fills (tidy C7, AC-17)", () => {
  it("the ghosts layer comes before zone fills, decks and walls on the canvas and on paper", () => {
    const at = (name: LayerName) => LAYER_ORDER.indexOf(name);
    for (const later of ["zoneFills", "decks", "walls"] as const) expect(at("ghosts")).toBeLessThan(at(later));
    const doc = studio();
    const view = planView(atLoft(doc).state);
    if (!view) throw new Error("no loft view");
    const picture = planPicture(doc, view, CANVAS_STYLE, 80, true);
    const order = pictureLayers(picture);
    const firstOf = (ps: readonly Primitive[]) => (ps[0] ? order.indexOf(ps[0]) : -1);
    expect(picture.ghosts.length).toBeGreaterThan(0);
    const last = picture.ghosts[picture.ghosts.length - 1];
    if (!last) throw new Error("no ghosts");
    const lastGhost = order.indexOf(last);
    for (const later of [picture.decks, picture.walls]) if (later.length > 0) expect(lastGhost).toBeLessThan(firstOf(later));
  });

  /** A full wall at y 1.5 and a 2.03 half wall at `y`, both across the room, viewed from a loft clear of them. */
  const parallel = (y: number): FakeShell =>
    atLoft(
      withCommands(
        roomDoc(),
        { type: "addWall", opId: "full", from: { at: { x: 0, y: 1.5 } }, to: { at: { x: 6, y: 1.5 } } },
        { type: "addWall", opId: "half", from: { at: { x: 0, y } }, to: { at: { x: 6, y } } },
        { type: "setWallTop", wallId: "half/w0", top: 2.03 },
        { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4.5, y: 3 }, w: 2, d: 1.5 },
      ),
    );
  /** For each ghost segment with an inner point inside a solid wall fill: the ghost's index and that fill's. */
  const ghostsInFills = (shell: FakeShell): { ghost: number; fill: number }[] => {
    const drawn = shell.scene().layers.flatMap((l) => l.primitives); // in the scene's own layer order
    const out: { ghost: number; fill: number }[] = [];
    drawn.forEach((g, i) => {
      if (g.kind !== "segment" || !isGhost(g)) return;
      const inner = [0.25, 0.5, 0.75].map((t) => ({ x: g.a.x + t * (g.b.x - g.a.x), y: g.a.y + t * (g.b.y - g.a.y) }));
      drawn.forEach((f, j) => {
        if (f.kind === "polygon" && f.color === CANVAS_STYLE.wall && inner.some((q) => covers(f.points, q))) out.push({ ghost: i, fill: j });
      });
    });
    return out;
  };

  it("walls 10 cm apart: a ghost edge lies inside a solid fill and is drawn before it", () => {
    const found = ghostsInFills(parallel(1.6));
    expect(found.length).toBeGreaterThan(0);
    for (const { ghost, fill } of found) expect(ghost).toBeLessThan(fill);
  });

  it("walls 30 cm apart: no ghost edge lies inside a fill", () => {
    expect(ghostsInFills(parallel(1.8))).toEqual([]);
  });
});
