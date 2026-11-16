import { describe, expect, it } from "vitest";
import { emptyDocument, levelOf, MOTIFS, motifDefaults, type Document } from "@fm/domain";
import { lookPicture } from "../src/view/look";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, pictureBounds, pictureLayers, planPicture } from "../src/view/picture";
import { COLORS } from "../src/view/colors";
import type { LayerName, Primitive, Scene } from "../src/view/scene-types";
import { labelledDoc, roomDoc, studioDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";
import { floorView, viewAt } from "../src/view/plan-view";

// The plan picture (export.01, spec Architecture): a document in a layout, drawn from the document alone, with a
// style. The canvas takes its document layers from the same builders (AC-01, arch-review L1).

/** roomDoc (6 × 4) with a labelled room, a swing door on the bottom wall, a bed in the Layout state and a 3 m dimension. */
function furnishedDoc(): Document {
  const doc = roomDoc();
  return withCommands(
    doc,
    { type: "labelZone", id: "L1", at: { x: 4, y: 2 }, name: "Studio", finish: null },
    { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 4.5 },
    { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3.85 } },
    { type: "addDimension", opId: "m1", a: { x: 0.5, y: 1 }, b: { x: 3.5, y: 1 }, offset: 0.5 },
  );
}

const layer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];
const colors = (ps: readonly Primitive[]): Set<string> => new Set(ps.map((p) => p.color));

describe("the plan picture (AC-01)", () => {
  it("the canvas Scene's walls, openings, objects, tags and dimensions layers are the arrays planPicture builds with CANVAS_STYLE", () => {
    const shell = FakeShell.withDocument(furnishedDoc());
    const scene = shell.scene();
    const picture = planPicture(shell.doc(), floorView(shell.doc(), "s0"), CANVAS_STYLE, shell.state.camera.zoom, true);
    expect(picture.objects.length).toBeGreaterThan(0);
    expect(picture.openings.length).toBeGreaterThan(0);
    expect(picture.tags.length).toBeGreaterThan(0);
    expect(layer(scene, "walls")).toBe(picture.walls);
    expect(layer(scene, "openings")).toBe(picture.openings);
    expect(layer(scene, "objects")).toBe(picture.objects);
    expect(layer(scene, "tags")).toBe(picture.tags);
    expect(picture.dimensions.length).toBeGreaterThan(0);
    expect(layer(scene, "dimensions")).toBe(picture.dimensions);
  });

  it("needs no editor state: a document, a layout, a style and a zoom", () => {
    const picture = planPicture(furnishedDoc(), floorView(furnishedDoc(), "s0"), PRESENTATION_STYLE, 20, true);
    expect(pictureLayers(picture).length).toBe(picture.ghosts.length + picture.decks.length + picture.objects.length + picture.overheads.length + picture.walls.length + picture.openings.length + picture.deckLabels.length + picture.tags.length + picture.dimensions.length);
    const texts = picture.tags.flatMap((p) => (p.kind === "text" ? [p.text] : []));
    expect(texts[0]).toBe("Studio");
  });

  it("pictureLayers lists decks before objects", () => {
    const doc = withCommands(furnishedDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.5, y: 2.8 } });
    const picture = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true);
    expect(picture.decks.length).toBeGreaterThan(0);
    expect(picture.objects.length).toBeGreaterThan(0);
    const all = pictureLayers(picture);
    expect(all.slice(0, picture.decks.length)).toEqual(picture.decks);
    expect(all.slice(picture.decks.length, picture.decks.length + picture.objects.length)).toEqual(picture.objects);
    expect(picture.decks.some((p) => p.kind === "text")).toBe(false);
  });

  it("pictureLayers lists deck labels after openings and before tags", () => {
    const doc = withCommands(furnishedDoc(), { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.5, y: 2.8 } });
    const p = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true);
    expect(p.deckLabels).toEqual([expect.objectContaining({ kind: "text", text: "Loft +2.15", align: "left" }), expect.objectContaining({ kind: "text", text: "2.80 m²", align: "left" })]);
    expect(p.openings.length).toBeGreaterThan(0);
    expect(p.tags.length).toBeGreaterThan(0);
    const before = p.decks.length + p.objects.length + p.overheads.length + p.walls.length + p.openings.length;
    expect(pictureLayers(p).slice(before, before + p.deckLabels.length + p.tags.length)).toEqual([...p.deckLabels, ...p.tags]);
  });

  it("a desk under a loft: the loft's dashed outline comes after the desk, before the walls (overhead lines on top)", () => {
    const doc = withCommands(
      furnishedDoc(),
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.5, y: 2.8 } }, // x 3.5–5.5, y 2.1–3.5
      { type: "placeObject", linked: false, deck: null, opId: "desk", state: "s0", object: { kind: "desk" }, at: { x: 4.5, y: 3.5 } },
    );
    const picture = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true);
    const all = pictureLayers(picture);
    const dashed = all.flatMap((p, i) => (p.kind === "segment" && p.dash !== undefined && p.color === PRESENTATION_STYLE.deck.line.color ? [i] : []));
    expect(dashed).toHaveLength(4);
    const desk = picture.objects.filter((p) => p.kind === "polygon" || p.kind === "segment").map((p) => all.indexOf(p));
    expect(desk.length).toBeGreaterThan(0);
    expect(Math.min(...dashed)).toBeGreaterThan(Math.max(...desk));
    const firstWall = picture.walls[0];
    if (!firstWall) throw new Error("no walls");
    expect(Math.max(...dashed)).toBeLessThan(all.indexOf(firstWall));
    expect(all.slice(picture.decks.length + picture.objects.length, picture.decks.length + picture.objects.length + picture.overheads.length)).toEqual(picture.overheads);
  });

  it("look includes decks, and the first layout's pieces (mcp.03)", () => {
    const doc = withCommands(furnishedDoc(), { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.5, y: 2.8 } });
    const look = lookPicture(doc, null);
    if ("refused" in look) throw new Error(look.refused);
    expect(look.primitives).toContainEqual(expect.objectContaining({ kind: "text", text: "Loft +2.15", color: LOOK_STYLE.deck.label.color }));
    expect(look.primitives.filter((p) => p.kind === "segment" && p.dash !== undefined && p.color === LOOK_STYLE.deck.line.color)).toHaveLength(4);
    // The first layout's pieces (mcp.03, in place of import.07's none): every primitive of the bed at look's zoom.
    const bed = planPicture(doc, floorView(doc, "s0"), LOOK_STYLE, look.frame.zoom, false).objects;
    expect(bed.length).toBeGreaterThan(0);
    for (const p of bed) expect(look.primitives).toContainEqual(p);
  });

  it("pictureLayers puts dimensions after tags", () => {
    const last = pictureLayers(planPicture(furnishedDoc(), floorView(furnishedDoc(), "s0"), PRESENTATION_STYLE, 20, true)).at(-1);
    expect(last).toMatchObject({ kind: "text", text: "3.00" });
  });

  it("the presentation style draws no room fills and no session marks, and the canvas furniture greys (AC-13)", () => {
    const all = pictureLayers(planPicture(furnishedDoc(), floorView(furnishedDoc(), "s0"), PRESENTATION_STYLE, 20, true));
    const used = colors(all);
    for (const c of [COLORS.zoneFill, COLORS.zoneFillSelected, COLORS.wallSelected, COLORS.warning, COLORS.warningLine, COLORS.warningMark, COLORS.warningGlyph, COLORS.background, COLORS.zoneOutline, COLORS.chip, COLORS.chipOff, COLORS.chipOffHover]) {
      expect(used.has(c)).toBe(false);
    }
    expect(used.has(PRESENTATION_STYLE.wall)).toBe(true);
    expect(used.has(PRESENTATION_STYLE.objectLine)).toBe(true);
    expect(used.has(PRESENTATION_STYLE.objectFill)).toBe(true);
    expect(colors(planPicture(furnishedDoc(), floorView(furnishedDoc(), "s0"), PRESENTATION_STYLE, 20, true).dimensions)).toEqual(new Set([PRESENTATION_STYLE.dim.ink]));
  });

  it("the presentation style's line widths are its own, never the canvas pixels", () => {
    const picture = planPicture(furnishedDoc(), floorView(furnishedDoc(), "s0"), PRESENTATION_STYLE, 20, true);
    const pxWidths = new Set(pictureLayers(picture).flatMap((p) => ("width" in p && "px" in p.width ? [p.width.px] : [])));
    expect(pxWidths.has(CANVAS_STYLE.objectLineWidth)).toBe(false);
    expect(pxWidths.has(CANVAS_STYLE.objectFront)).toBe(false);
    expect(picture.dimensions.some((p) => "width" in p)).toBe(true);
    const sizes = new Set([...picture.tags, ...picture.dimensions].flatMap((p) => (p.kind === "text" ? [p.size] : [])));
    expect([...sizes]).toEqual([PRESENTATION_STYLE.tag.size]);
    expect(PRESENTATION_STYLE.dim.textSize).toBe(PRESENTATION_STYLE.tag.size);
  });

  it("pictureBounds covers the walls and the layout's objects, plus the margin", () => {
    const b = pictureBounds(furnishedDoc(), "s0");
    // roomDoc's walls are 0.2 m thick on the lines 0..6 × 0..4; the margin is 0.5 m.
    expect(b.min.x).toBeCloseTo(-0.6, 6);
    expect(b.min.y).toBeCloseTo(-0.6, 6);
    expect(b.max.x).toBeCloseTo(6.6, 6);
    expect(b.max.y).toBeCloseTo(4.6, 6);
  });

  it("pictureBounds takes in dimension lines, not only measured points", () => {
    // a (6, 0) is a joint centre; a→b runs along u = (0.6, 0.8), so offset −1 moves the line by (0.8, −0.6):
    // its ends are (6.8, −0.6) and (9.8, 3.4).
    const doc = withCommands(roomDoc(), { type: "addDimension", opId: "m", a: { x: 6, y: 0 }, b: { x: 9, y: 4 }, offset: -1 });
    const b = pictureBounds(doc, "s0");
    expect(b.min.x).toBeCloseTo(-0.6, 6);
    expect(b.min.y).toBeCloseTo(-1.1, 6);
    expect(b.max.x).toBeCloseTo(10.3, 6);
    expect(b.max.y).toBeCloseTo(4.6, 6);
  });
});

describe("the margin version (sheetset.10)", () => {
  it("PNG, SVG and look keep their margin", () => {
    // Walls, then a 0.5 m margin: a door swinging into the room doesn't change it.
    const doc = roomDoc();
    const south = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const inward = withCommands(doc, { type: "addOpening", opId: "d", wall: south, kind: "swing", offset: 2, width: 0.9, side: "left" });
    const b = pictureBounds(inward, "s0");
    expect(b.min.x).toBeCloseTo(-0.6, 6);
    expect(b.min.y).toBeCloseTo(-0.6, 6);
    expect(b.max.x).toBeCloseTo(6.6, 6);
    expect(b.max.y).toBeCloseTo(4.6, 6);
    expect(pictureBounds(emptyDocument(), null)).toEqual({ min: { x: -0.5, y: -0.5 }, max: { x: 0.5, y: 0.5 } });
  });

  it("a door swinging out through a wall stays in the frame, with its margin (fixes AC-12)", () => {
    const doc = roomDoc();
    const south = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const outward = withCommands(doc, { type: "addOpening", opId: "d", wall: south, kind: "swing", offset: 2, width: 0.9, side: "right" });
    const b = pictureBounds(outward, "s0");
    expect(b.min.y).toBeLessThanOrEqual(-0.88 - 0.5 + 1e-6); // the leaf's tip reaches y -0.88: 0.9 less two frames
    expect(b.max.y).toBeCloseTo(4.6, 6);
  });

  it("every level's picture keeps the floor's one frame, so two levels' images line up", () => {
    const doc = roomDoc();
    const south = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const outward = withCommands(doc, { type: "addOpening", opId: "d", wall: south, kind: "swing", offset: 2, width: 0.9, side: "right" });
    const deck = withCommands(outward, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 3, y: 2 }, w: 2, d: 2, top: 2.15 });
    expect(pictureBounds(deck, "s0").min.y).toBeCloseTo(pictureBounds(outward, "s0").min.y, 6);
  });
});

describe("live distances on paper (AC-12, export.01)", () => {
  it("live distances stay out of the plan picture and the objects layer", () => {
    const doc = withCommands(
      studioDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "blk", state: "s0", object: { kind: "block" }, at: { x: 4.3, y: 2.3 } },
      { type: "placeObject", linked: false, deck: null, opId: "nb", state: "n/s0", object: { kind: "block" }, at: { x: 3.7, y: 2.3 } },
    );
    const shell = FakeShell.withDocument(doc);
    shell.moveTo({ x: 1.5, y: 2 });
    shell.down({ x: 1.5, y: 2 });
    shell.moveTo({ x: 2.5, y: 2 }); // held: the bed at x 1.7–3.3
    const scene = shell.scene();
    const cm = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "text" && p.text.endsWith(" cm"));
    expect(layer(scene, "annotations")).toContainEqual(expect.objectContaining({ kind: "text", text: "160 cm", color: COLORS.helper }));
    expect(colors(layer(scene, "objects")).has(COLORS.helper)).toBe(false);
    expect(cm(layer(scene, "objects"))).toEqual([]);
    const paper = pictureLayers(planPicture(shell.doc(), floorView(shell.doc(), "s0"), PRESENTATION_STYLE, 20, true));
    expect(colors(paper).has(COLORS.helper)).toBe(false);
    expect(cm(paper)).toEqual([]);
  });
});

describe("tags on paper (export.31)", () => {
  it("draw no plate, so furniture under a label stays whole", () => {
    const doc = withCommands(furnishedDoc(), { type: "addState", opId: "x", name: "Other" });
    const tags = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true).tags;
    expect(tags.some((p) => p.kind === "polygon")).toBe(false);
    expect(tags.some((p) => p.kind === "text")).toBe(true);
  });
});

/** labelledDoc's Room 1 (L1, x 0.1–2.9) in planks and Room 2 (L2, x 3.1–5.9) in mosaic, each with the motif's defaults. */
function finishedRooms(): Document {
  return withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("planks") }, { type: "setFinish", id: "L2", finish: motifDefaults("mosaic") });
}

describe("the floors layer on paper (AC-12, finishes.10)", () => {
  it("floors is the first layer; empty with finishes \"without\"; empty in LOOK_STYLE", () => {
    const doc = finishedRooms();
    const view = floorView(doc, "s0");
    const p = planPicture(doc, view, PRESENTATION_STYLE, 20, true);
    expect(colors(p.floors).has(MOTIFS.planks.colour)).toBe(true);
    expect(colors(p.floors).has(MOTIFS.mosaic.colour)).toBe(true);
    expect(pictureLayers(p).slice(0, p.floors.length)).toEqual(p.floors);
    expect(pictureLayers(p).length).toBe(p.floors.length + p.ghosts.length + p.decks.length + p.objects.length + p.overheads.length + p.walls.length + p.openings.length + p.deckLabels.length + p.tags.length + p.dimensions.length);
    expect(planPicture(doc, view, PRESENTATION_STYLE, 20, false).floors).toEqual([]);
    expect(planPicture(doc, view, LOOK_STYLE, 20, true).floors).toEqual([]);
  });

  it("at an upper level (the loft) the picture draws no floors, even With, in either style (levels.04)", () => {
    const doc = withCommands(finishedRooms(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.5, y: 2 } });
    const loft = viewAt("s0", levelOf(doc, "loft/k0"));
    expect(loft.level.cut).toBeGreaterThan(2); // the loft's cut, not the floor's
    expect(planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true).floors.length).toBeGreaterThan(0);
    for (const style of [PRESENTATION_STYLE, CANVAS_STYLE]) expect(planPicture(doc, loft, style, 20, true).floors).toEqual([]);
  });

  it("the canvas Scene's finishes layer is the array planPicture builds with CANVAS_STYLE (one memoised layer, finishes.41)", () => {
    const shell = FakeShell.withDocument(finishedRooms());
    const scene = shell.scene();
    const picture = planPicture(shell.doc(), floorView(shell.doc(), "s0"), CANVAS_STYLE, shell.state.camera.zoom, true);
    expect(picture.floors.length).toBeGreaterThan(0);
    expect(layer(scene, "finishes")).toBe(picture.floors);
  });

  it("at 1:100 (10 mm/m) the mosaic at 0.025 draws no lines and the planks do (AC-06 paper)", () => {
    const doc = finishedRooms();
    const lines = (zoom: number) => planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, zoom, true).floors.flatMap((q) => (q.kind === "segment" ? [q] : []));
    const inRoom1 = (ss: ReturnType<typeof lines>) => ss.filter((s) => s.a.x < 3 && s.b.x < 3);
    const inRoom2 = (ss: ReturnType<typeof lines>) => ss.filter((s) => s.a.x > 3 && s.b.x > 3);
    expect(inRoom1(lines(10)).length).toBeGreaterThan(0); // planks 0.20 × 10 = 2 mm apart
    expect(inRoom2(lines(10))).toEqual([]); // mosaic 0.025 × 10 = 0.25 mm, under 0.8
    expect(inRoom2(lines(40)).length).toBeGreaterThan(0); // 1 mm apart at 1:25: the threshold, not the motif, hides them
    const fills = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 10, true).floors.filter((q) => q.kind === "polygon");
    expect(colors(fills).has(MOTIFS.mosaic.colour)).toBe(true); // its colour alone
  });
});
