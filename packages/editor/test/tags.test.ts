import { describe, expect, it } from "vitest";
import { convexOverlap, emptyDocument, execute, fitShapes, interiorPoint, levelOf, onFloor, rectangleRoom, unwrap, wallBodies, zones, type Command, type Document, type Zone } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { DEFAULT_ZOOM, MIN_ZOOM, type Camera } from "../src/camera";
import { deckLabelBox, labelledDecks } from "../src/view/deck-label";
import { plateBox } from "../src/view/labels";
import { textWidth } from "../src/view/fonts";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { TAG_SPOTS } from "../src/view/tag-spot";
import type { Primitive } from "../src/view/scene-types";
import { areaFieldText, formatArea, roomTagLayout, tagAt, tagLayout, zoneOfLabel } from "../src/view/tags";
import { bed160x200, donutDoc, labelledDoc, narrowRoomDoc, roomDoc, studioDoc, withCommands, withOrphan } from "./builders";
import { FakeShell } from "./fake-shell";

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };
/** A tag line's width in canvas px: Inter at 12 px, from the core's table (render.15). */
const tagPx = (text: string): number => textWidth(CANVAS_STYLE.font, text, CANVAS_STYLE.tag.size);

describe("tag layouts are cached (spec: editor, P2)", () => {
  it("returns the same layout for the same document and zoom, also after a pan", () => {
    const doc = labelledDoc();
    const first = tagLayout(doc, "L1", camera, null);
    expect(first).not.toBeNull();
    expect(tagLayout(doc, "L1", camera, null)).toBe(first);
    const panned: Camera = { ...camera, center: { x: 40, y: -7 } };
    expect(tagLayout(doc, "L1", panned, null)).toBe(first);
  });

  it("lays out again after a zoom, or on a new document, even an equal copy (cached per document, render.15)", () => {
    const doc = labelledDoc();
    const first = tagLayout(doc, "L1", camera, null);
    const zoomed = tagLayout(doc, "L1", { ...camera, zoom: camera.zoom * 2 }, null);
    expect(zoomed).not.toBe(first);
    expect(zoomed?.max.x).toBeLessThan(first?.max.x ?? 0); // same text, half the world size
    const again = tagLayout(doc, "L1", camera, null);
    expect(tagLayout(labelledDoc(), "L1", camera, null)).not.toBe(again);
    const copy = tagLayout(JSON.parse(JSON.stringify(doc)), "L1", camera, null);
    expect(copy).not.toBe(again);
    expect(copy).toEqual(again);
  });

  it("a renamed label gets a new layout (its document is a new value)", () => {
    const doc = labelledDoc();
    const before = tagLayout(doc, "L1", camera, null);
    const renamed = unwrap(execute(doc, { type: "renameZone", id: "L1", name: "A much longer room name" })).doc;
    const after = tagLayout(renamed, "L1", camera, null);
    expect(after?.lines[0]?.text).toBe("A much longer room name");
    expect(after).not.toBe(before);
  });
});

describe("zone tags (spec: walls-rooms)", () => {
  it("formats areas with two decimals", () => {
    expect(formatArea(10.64)).toBe("10.64 m²");
    expect(formatArea(9.9400001)).toBe("9.94 m²");
  });

  it("lays out the name, the size and the area, sized with Inter's widths (export.09)", () => {
    const tag = tagLayout(labelledDoc(), "L1", camera, null);
    if (!tag) throw new Error("no tag");
    expect(tag.lines.map((l) => l.text)).toEqual(["Room 1", "2.80 × 3.80 m", "10.64 m²"]);
    // Lines are 16 px apart: +16, 0, −16 px = +0.2, 0, −0.2 m at 80 px/m around the label point (1.5, 2).
    expect(tag.lines[0].at.x).toBe(1.5);
    expect(tag.lines[0].at.y).toBeCloseTo(2.2, 9);
    expect(tag.lines[1]?.at.y).toBeCloseTo(2, 9);
    expect(tag.lines[2]?.at.y).toBeCloseTo(1.8, 9);
    // The widest line is "2.80 × 3.80 m", 80.21 px in Inter at 12 px (the others: "Room 1" 40.88, "10.64 m²" 50.29).
    // Half-width (40.10 + 4) px = 0.5513 m; half-height (24 + 2) px = 0.325 m.
    expect(tagPx("2.80 × 3.80 m")).toBeGreaterThan(Math.max(tagPx("Room 1"), tagPx("10.64 m²")));
    const hw = (tagPx("2.80 × 3.80 m") / 2 + 4) / 80;
    expect(hw).toBeCloseTo(0.5513, 4);
    expect(tag.min.x).toBeCloseTo(1.5 - hw, 9);
    expect(tag.max.x).toBeCloseTo(1.5 + hw, 9);
    expect(tag.min.y).toBeCloseTo(1.675, 9);
    expect(tag.max.y).toBeCloseTo(2.325, 9);
  });

  it("says when the area is unavailable, and when no walls enclose a label", () => {
    // The 0.15 m closet holds its tag (102.1 px wide, "Area unavailable" + padding) only zoomed in: 150 px at 1000 px/m.
    expect(tagLayout(narrowRoomDoc(), "L1", { ...camera, zoom: 1000 }, null)?.lines[1]?.text).toBe("Area unavailable");
    expect(tagLayout(withOrphan(labelledDoc()), "L9", camera, null)?.lines[1]?.text).toBe("no enclosing walls");
    expect(tagLayout(labelledDoc(), "missing", camera, null)).toBeNull();
    expect(tagLayout(labelledDoc(), "constructor", camera, null)).toBeNull(); // not an inherited Object member
  });

  it("gives the properties panel the domain's reason for an unavailable area", () => {
    expect(areaFieldText(zoneOfLabel(labelledDoc(), "L1"))).toBe("10.64 m²");
    expect(areaFieldText(zoneOfLabel(narrowRoomDoc(), "L1"))).toBe("Area unavailable: unsupported geometry");
    expect(areaFieldText(zoneOfLabel(withOrphan(labelledDoc()), "L9"))).toBe("no enclosing walls");
  });

  it("hit-tests tags by the same box they are drawn with", () => {
    const doc = withOrphan(labelledDoc());
    expect(tagAt(doc, { x: 1.5, y: 2 }, camera, null)).toBe("L1");
    expect(tagAt(doc, { x: 8.5, y: 6.1 }, camera, null)).toBe("L9"); // "no enclosing walls" makes the orphan tag wide
    expect(tagAt(doc, { x: 1.5, y: 2.35 }, camera, null)).toBeNull(); // just above L1's tag
    expect(tagAt(doc, { x: 1, y: 3 }, camera, null)).toBeNull(); // floor, not tag
  });
});

/** A 3 × 3 m room (centreline ring (0,0)–(3,3)) labelled "Den" (L1) at its centre; clear area 2.8 × 2.8 = 7.84 m². */
function denDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 3, 3, "den")) doc = unwrap(execute(doc, cmd)).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 1.5 }, name: "Den", finish: null })).doc;
}

/** denDoc plus a 12 × 10 m room at (10,0)–(22,10) labelled "Hall" (L2) at its centre; clear area 11.8 × 9.8 m². */
function denAndHallDoc(): Document {
  let doc = denDoc();
  for (const cmd of rectangleRoom({ x: 10, y: 0 }, 12, 10, "hall")) doc = unwrap(execute(doc, cmd)).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 16, y: 5 }, name: "Hall", finish: null })).doc;
}

function zoomedShell(doc: Document, zoom: number, center: Point): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom, center } };
  return shell;
}

/** The tags layer (spec: editor: zone tags have their own layer). */
const annotations = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "tags")?.primitives ?? [];
const tagTexts = (shell: FakeShell) => annotations(shell).flatMap((p) => (p.kind === "text" ? [p] : []));
const plates = (shell: FakeShell) => annotations(shell).flatMap((p) => (p.kind === "polygon" ? [p] : []));

// Tag text is Inter at 12 px, from the core's table (render.15). Boxes, in pixels:
//   Den, all lines:  max("Den" 22.7, "2.80 × 2.80 m" 80.1, "7.84 m²" 44.6) + 2 × 4 pad = 88.1 wide, 3 × 16 + 4 = 52 tall.
//   Den, no size:    44.6 + 8 = 52.6 wide, 2 × 16 + 4 = 36 tall.
//   Den, name only:  22.7 + 8 = 30.7 wide, 16 + 4 = 20 tall.
// The room's clear floor is 2.8 m square, and holds a box while its wider side is under 2.8 m on screen:
//   all lines above 88.1 / 2.8 = 31.5 px/m; name and area above 18.8 px/m; name only above 11.0 px/m; nothing below.
// So zoom 80 (default) shows every line, 15 the name only, 7 nothing.
//   Hall, all lines: max("Hall" 21.5, "11.80 × 9.80 m" 82.7, "115.64 m²" 54.7) + 8 = 90.7 px: at 7 px/m 12.96 m, wider
//   than its 11.8 m clear floor, so the size line drops; name and area, 62.7 × 36 px = 8.96 × 5.14 m, fit.
//   Lost (orphan), both lines: "no enclosing walls" 104.5 + 8 = 112.5 px: always shown.
const NAME_ONLY_ZOOM = 15;
const HIDDEN_ZOOM = 7;

describe("zone tags fit their room (spec: editor)", () => {
  it("shows every line when the whole tag fits inside the room", () => {
    const shell = zoomedShell(denDoc(), DEFAULT_ZOOM, { x: 1.5, y: 1.5 });
    expect(tagTexts(shell).map((t) => t.text)).toEqual(["Den", "2.80 × 2.80 m", "7.84 m²"]);
    expect(plates(shell)).toHaveLength(1);
  });

  it("shows only the name, centred on the label point on a one-line plate, when only that fits", () => {
    const shell = zoomedShell(denDoc(), NAME_ONLY_ZOOM, { x: 1.5, y: 1.5 });
    const texts = tagTexts(shell);
    expect(texts.map((t) => t.text)).toEqual(["Den"]);
    expect(texts[0]?.at).toEqual({ x: 1.5, y: 1.5 });
    // "Den" is 22.75 px: half-width (11.37 + 4) px / 15 = 1.0249 m; half-height (8 + 2) px / 15 = 0.66667 m.
    const plate = plates(shell);
    expect(plate).toHaveLength(1);
    const pts = plate[0]?.points ?? [];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const hw = (tagPx("Den") / 2 + 4) / 15;
    expect(hw).toBeCloseTo(1.0249, 4);
    expect(Math.min(...xs)).toBeCloseTo(1.5 - hw, 9);
    expect(Math.max(...xs)).toBeCloseTo(1.5 + hw, 9);
    expect(Math.min(...ys)).toBeCloseTo(1.5 - 10 / 15, 9);
    expect(Math.max(...ys)).toBeCloseTo(1.5 + 10 / 15, 9);
    const tag = tagLayout(shell.doc(), "L1", shell.state.camera, null);
    expect(tag?.lines.map((l) => l.text)).toEqual(["Den"]);
  });

  it("hides the tag when not even the name fits: not drawn, not a click target, the floor still selects the zone", () => {
    const shell = zoomedShell(denDoc(), HIDDEN_ZOOM, { x: 1.5, y: 1.5 });
    expect(annotations(shell)).toEqual([]);
    expect(tagLayout(shell.doc(), "L1", shell.state.camera, null)).toBeNull();
    expect(tagAt(shell.doc(), { x: 1.5, y: 1.5 }, shell.state.camera, null)).toBeNull();
    shell.click({ x: 1.5, y: 1.5 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  });

  it("keeps a big room's tag while a small room's tag is hidden at the same zoom", () => {
    const shell = zoomedShell(denAndHallDoc(), HIDDEN_ZOOM, { x: 11, y: 5 });
    expect(tagTexts(shell).map((t) => t.text)).toEqual(["Hall", "115.64 m²"]); // the wide size line drops first (export.34)
    expect(plates(shell)).toHaveLength(1);
  });

  it("always shows both lines of an orphan label", () => {
    const shell = zoomedShell(withOrphan(emptyDocument()), MIN_ZOOM, { x: 8, y: 6 });
    expect(tagTexts(shell).map((t) => t.text)).toEqual(["Lost", "no enclosing walls"]);
    expect(tagAt(shell.doc(), { x: 8, y: 6 }, shell.state.camera, null)).toBe("L9");
  });
});

// Ring = Apartment A around Core C (donutDoc): the floor is x 0.1–9.9, y 0.1–7.9 minus the core's footprint
// x 3.4–6.6, y 2.4–5.6. Inter boxes at 12 px, in pixels: "Living" 33.79, "66.20 m²" 52.42, pad 4, line 16.
//   Name and area: half-box (30.21, 18). Name only: (20.90, 10).
describe("tags in rooms with holes (AC-08)", () => {
  const living = (doc: Document, at: Point): Document => withCommands(doc, { type: "labelZone", id: "L1", at, name: "Living", finish: null });
  const texts = (doc: Document, zoom: number): string[] => tagLayout(doc, "L1", { zoom }, null)?.lines.map((l) => l.text) ?? [];

  it("a labelled ring room's tag shows name and area, no size line", () => {
    expect(texts(living(donutDoc(), { x: 1.5, y: 4 }), 80)).toEqual(["Living", "66.20 m²"]);
  });

  it("a tag whose corners reach a core's wall body drops to the name", () => {
    // At (3.1, 4), name and area: x 2.72–3.48, two corners in the core's footprint (from 3.4) though outside its
    // outline (3.5). Name only: x 2.84–3.36, on the floor.
    expect(texts(living(donutDoc(), { x: 3.1, y: 4 }), 80)).toEqual(["Living"]);
  });

  it("a tag over a small column keeps its lines when its four corners are on the floor (holes.10), then moves off its walls (tidy.13)", () => {
    // Column K: 0.6 × 0.6 m centred at (5, 4), 0.10 m walls, footprint x 4.65–5.35, y 3.65–4.35.
    const doc = living(withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 10, 8, "apt"), ...rectangleRoom({ x: 4.7, y: 3.7 }, 0.6, 0.6, "col", 0.1)), { x: 5, y: 4.5 });
    const zone = zoneOfLabel(doc, "L1");
    if (!zone || zone.area === null) throw new Error("no area");
    const tag = tagLayout(doc, "L1", { zoom: 20 }, null);
    if (!tag) throw new Error("no tag");
    // At the point the box (x 3.52–6.48: "75.95 m²" is 51.12 px, so half-width (25.56 + 4) / 20 = 1.478 m; y 3.6–5.4)
    // holds the whole footprint, so both lines show; it overlaps the column's wall bodies, so it moves up 0.75 m, to
    // touch the footprint's top (y 4.35): sideways would take 2 m.
    expect(tag.lines.map((l) => l.text)).toEqual(["Living", formatArea(zone.area)]);
    expect(tag.min.x).toBeCloseTo(5 - (tagPx(formatArea(zone.area)) / 2 + 4) / 20, 9);
    expect(tag.min.x).toBeCloseTo(3.522, 3);
    expect(tag.min.y).toBeCloseTo(4.35, 9);
    expect(tag.max.y).toBeCloseTo(6.15, 9);
  });

  it("an unlabelled furnished ring room's tag starts inside the ring", () => {
    const doc = withCommands(donutDoc(), { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3 } }, bed160x200("bed/o0"));
    const apt: Zone | undefined = zones(doc).find((z) => z.holes.length > 0);
    if (!apt) throw new Error("no ring room");
    const tag = roomTagLayout(doc, apt, { zoom: 80 }, "s0");
    if (!tag) throw new Error("no tag");
    expect(tag.lines.map((l) => l.text)).toEqual(["66.20 m² · free 63.0 m²"]);
    // The centroid (5, 4) is on the core; the widest span through y = 4 is a tie, the left one x 0.1–3.4 wins.
    const at = tag.lines[0].at;
    expect(at.x).toBeCloseTo(1.75, 6);
    expect(at.y).toBeCloseTo(4, 6);
    expect(onFloor(apt, at)).toBe(true);
  });

  it("an unlabelled furnished tag whose corner reaches a column's footprint is hidden", () => {
    // Column K: 0.3 × 0.3 m centred at (2.75, 4.25), 0.10 m walls, footprint x 2.55–2.95, y 4.05–4.45, on the floor.
    const doc = withCommands(donutDoc(), ...rectangleRoom({ x: 2.6, y: 4.1 }, 0.3, 0.3, "col", 0.1), { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3 } }, bed160x200("bed/o0"));
    const apt: Zone | undefined = zones(doc).find((z) => z.holes.length === 2);
    if (!apt) throw new Error("no ring room");
    // The point is still (1.75, 4); "66.04 m² · free 62.8 m²" is 134.21 px, so the box x 0.861–2.639, y 3.875–4.125
    // has its corner (2.639, 4.125) in the footprint.
    const at = interiorPoint(apt);
    expect(at?.x).toBeCloseTo(1.75, 6);
    expect(at?.y).toBeCloseTo(4, 6);
    expect(1.75 + (tagPx("66.04 m² · free 62.8 m²") / 2 + 4) / 80).toBeCloseTo(2.639, 3);
    expect(onFloor(apt, { x: 2.639, y: 4.125 })).toBe(false);
    expect(roomTagLayout(doc, apt, { zoom: 80 }, "s0")).toBeNull();
  });
});

// Room tags keep off furniture (C4, tidy.13): Inter widths at 12 px, canvas style. A spot is free when the box's four
// corners are on the floor and it overlaps no piece of the layout, deck label box or wall body (touching allowed).
describe("room tags keep off furniture (C4)", () => {
  const studio = (): Document => withCommands(studioDoc(), { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Studio", finish: null });
  const centre = (tag: { min: Point; max: Point } | null): Point => {
    if (!tag) throw new Error("no tag");
    return { x: (tag.min.x + tag.max.x) / 2, y: (tag.min.y + tag.max.y) / 2 };
  };
  const ring = ({ min, max }: { min: Point; max: Point }): Point[] => [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];
  const piecesOf = (doc: Document, layout: string): (readonly Point[])[] => [...fitShapes(doc)].filter(([id]) => doc.placements[id]?.state === layout).map(([, r]) => r);
  const overlapsAny = (box: { min: Point; max: Point }, rings: readonly (readonly Point[])[]): boolean => rings.some((r) => convexOverlap(ring(box), r));
  const block = (opId: string, at: Point, w: number, d: number): Command[] => [
    { type: "placeObject", deck: null, opId, state: "s0", object: { kind: "block" }, at },
    { type: "setObjectSize", objectId: `${opId}/o0`, w, d: { standard: d } },
  ];
  const walls = (pts: Point[], prefix: string): Command[] => pts.map((p, i) => ({ type: "addWall", opId: `${prefix}${i}`, from: { at: p }, to: { at: pts[(i + 1) % pts.length] ?? p } }));
  const expectCentre = (tag: { min: Point; max: Point } | null, x: number, y: number): void => {
    const c = centre(tag);
    expect(c.x).toBeCloseTo(x, 9);
    expect(c.y).toBeCloseTo(y, 9);
  };

  it("tries 197 spots out to 2 m: the point, then by distance, up before down, left before right", () => {
    expect(TAG_SPOTS).toHaveLength(197);
    expect(TAG_SPOTS.slice(0, 9)).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 0.25 }, { x: -0.25, y: 0 }, { x: 0.25, y: 0 }, { x: 0, y: -0.25 },
      { x: -0.25, y: 0.25 }, { x: 0.25, y: 0.25 }, { x: -0.25, y: -0.25 }, { x: 0.25, y: -0.25 },
    ]);
    expect(Math.max(...TAG_SPOTS.map((d) => Math.hypot(d.x, d.y)))).toBe(2);
  });

  it("a tag that overlaps nothing keeps today's box (AC-01)", () => {
    // "5.80 × 3.80 m" 80.01 px: half-box (40.00 + 4, 24 + 2) px = (0.5501, 0.325) m around (3, 2); the walls are 0.9 m
    // away. The width is an exact binary fraction (13655 font units × 12 / 2048), so the box is too.
    const doc = withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Living", finish: null });
    for (const layout of [null, "s0"]) {
      const tag = tagLayout(doc, "L1", { zoom: 80 }, layout);
      if (!tag) throw new Error("no tag");
      expect(tag.min.x).toBeCloseTo(2.44993896484375, 12);
      expect(tag.min.y).toBeCloseTo(1.675, 12);
      expect(tag.max.x).toBeCloseTo(3.55006103515625, 12);
      expect(tag.max.y).toBeCloseTo(2.325, 12);
      expect(tag.lines.map((l) => [l.text, l.at.x, l.at.y])).toEqual([
        ["Living", 3, 2 + 16 / 80],
        ["5.80 × 3.80 m", 3, 2],
        ["22.04 m²", 3, 2 - 16 / 80],
      ]);
    }
  });

  it("the studio tag moves up off the bed in Day (AC-02)", () => {
    // Box (0.872, 0.325) half-size; the bed covers x 0.7–2.3, y 1–3. Clearing it sideways takes 1.75 m; up 1.5 m (box from
    // y 3.175, under the top wall's face at 3.9) ties with down 1.5 m (box to y 0.825), and up wins.
    const doc = studio();
    const tag = tagLayout(doc, "L1", { zoom: 80 }, "s0");
    if (!tag) throw new Error("no tag");
    expectCentre(tag, 1.5, 3.5);
    expect(overlapsAny(tag, piecesOf(doc, "s0"))).toBe(false);
    expect(tag.lines.map((l) => l.text)).toEqual(["Studio", "5.80 × 3.80 m", "22.04 m² · free 18.8 m²"]);
    expect(tag.lines.map((l) => l.at.x)).toEqual([1.5, 1.5, 1.5]);
    expect(tag.lines[0].at.y).toBeCloseTo(3.7, 9);
    expect(tag.lines[1]?.at.y).toBeCloseTo(3.5, 9);
    expect(tag.lines[2]?.at.y).toBeCloseTo(3.3, 9);
  });

  it("in the empty Night layout the studio tag stays; switching the layout moves it (AC-02)", () => {
    expectCentre(tagLayout(studio(), "L1", { zoom: 80 }, "n/s0"), 1.5, 2);
    const shell = zoomedShell(studio(), 80, { x: 3, y: 2 });
    const nameAt = (): Point | undefined => tagTexts(shell).find((t) => t.text === "Studio")?.at;
    expect(nameAt()?.y).toBeCloseTo(3.7, 9);
    shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(nameAt()?.y).toBeCloseTo(2.2, 9);
  });

  it("with no free spot the tag stays at its point (AC-03)", () => {
    // At zoom 16 the name alone ("Studio" 36.17 px) is a 2.76 × 1.25 m box: too tall to pass above or below the bed
    // (y 1–3) in the 3.8 m room, and clearing it sideways takes 2.25 m, past the 2 m of spots. (At zoom 20 the box is
    // 2.21 m wide, and 2 m to the right clears the bed.)
    const tag = tagLayout(studio(), "L1", { zoom: 16 }, "s0");
    expect(tag?.lines.map((l) => l.text)).toEqual(["Studio"]);
    expectCentre(tag, 1.5, 2);
    expect(tag?.lines[0].at).toEqual({ x: 1.5, y: 2 });
  });

  it("a round table's corner gap doesn't move the tag; a square block does (AC-04)", () => {
    // The widest line is "22.04 m² · free 21.2 m²" (131.30 px) with the block, "… 21.4 m²" (131.74 px) with the table:
    // box x 2.129–3.871 (3.873 with the table), y 1.675–2.325. Both pieces span x 3.77–4.67, y 2.225–3.125: the box's
    // corner (3.87, 2.325) is inside the block but 0.493 m from the table's centre (4.22, 2.675), outside its 0.45 m
    // circle. Off the block: up 0.25 m still overlaps it; left 0.25 m (box to x 3.621) is clear.
    const dining = (...cmds: Command[]): Document => withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Dining", finish: null }, ...cmds);
    const table = dining({ type: "placeObject", deck: null, opId: "t", state: "s0", object: { kind: "roundTable" }, at: { x: 4.22, y: 3.125 } });
    expectCentre(tagLayout(table, "L1", { zoom: 80 }, "s0"), 3, 2);
    expectCentre(tagLayout(dining(...block("t", { x: 4.22, y: 3.125 }, 0.9, 0.9)), "L1", { zoom: 80 }, "s0"), 2.75, 2);
  });

  it("in an L-shaped room a spot with a corner off the floor is skipped (AC-05)", () => {
    // Floor: x 0.1–5.9, y 0.1–1.9 and x 0.1–2.9 up to y 4.9; the wall bodies leave the square x 2.9–3, y 1.9–2 at the
    // inner corner uncovered. "Hall" at (2.08, 1.45): "18.84 m² · free 18.0 m²" is 129.18 px, box half-size (0.857, 0.225),
    // x 1.223–2.937. A block x 2.8–3.7, y 0.5–1.4 covers its right end. Up 0.25 m clears it but puts the corner
    // (2.937, 1.925) in that square, off the floor though on no wall body; left 0.25 m (box to x 2.687) is the next free spot.
    const doc = withCommands(
      emptyDocument(),
      ...walls([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 5 }, { x: 0, y: 5 }], "l"),
      { type: "labelZone", id: "L1", at: { x: 2.08, y: 1.45 }, name: "Hall", finish: null },
      ...block("t", { x: 3.25, y: 1.4 }, 0.9, 0.9),
    );
    const tag = tagLayout(doc, "L1", { zoom: 80 }, "s0");
    expect(tag?.lines.map((l) => l.text)).toEqual(["Hall", "18.84 m² · free 18.0 m²"]);
    expectCentre(tag, 1.83, 1.45);
    const zone = zoneOfLabel(doc, "L1");
    if (!zone) throw new Error("no room");
    const hw = (tagPx("18.84 m² · free 18.0 m²") / 2 + 4) / 80;
    const up = { min: { x: 2.08 - hw, y: 1.475 }, max: { x: 2.08 + hw, y: 1.925 } };
    expect(up.max.x).toBeCloseTo(2.937, 3);
    expect(onFloor(zone, up.max)).toBe(false);
    expect(overlapsAny(up, [...wallBodies(doc).values()])).toBe(false);
  });

  it("a moved tag overlaps no wall body: a U-shaped notch and a wall stub (AC-05)", () => {
    // U: floor x 0.1–5.9, y 0.1–1.9 plus two arms up to y 3.9, x 0.1–1.9 and 4.1–5.9; the notch's bodies span x 1.9–4.1
    // from y 1.9. At zoom 60 "Hall" (widest line "17.64 m² · free 17.5 m²", 127.48 px) is a 2.258 × 0.6 m box around
    // (3, 1.4), x 1.871–4.129; a 0.4 m block x 4.0–4.4, y 0.9–1.3 covers its right end. Up 0.25 m clears the block with
    // all four corners on the floor, in the arms, but crosses the notch's wall; left 0.25 m (box to x 3.879) is free.
    const u = withCommands(
      emptyDocument(),
      ...walls([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }], "u"),
      { type: "labelZone", id: "L1", at: { x: 3, y: 1.4 }, name: "Hall", finish: null },
      ...block("t", { x: 4.2, y: 1.3 }, 0.4, 0.4),
    );
    const uTag = tagLayout(u, "L1", { zoom: 60 }, "s0");
    if (!uTag) throw new Error("no tag");
    expectCentre(uTag, 2.75, 1.4);
    expect(overlapsAny(uTag, [...wallBodies(u).values()])).toBe(false);
    // Stub: the sample room's floor ignores a fin from the top wall down to (3, 2.5), body x 2.9–3.1. "Living" at (3, 3),
    // box half-size (0.550, 0.325), sits on it; 0.75 m to either side clears it and left comes first.
    const stub = withCommands(roomDoc(), { type: "addWall", opId: "st", from: { at: { x: 3, y: 4 } }, to: { at: { x: 3, y: 2.5 } } }, { type: "labelZone", id: "L1", at: { x: 3, y: 3 }, name: "Living", finish: null });
    const stubTag = tagLayout(stub, "L1", { zoom: 80 }, null);
    if (!stubTag) throw new Error("no tag");
    expectCentre(stubTag, 2.25, 3);
    expect(overlapsAny(stubTag, [...wallBodies(stub).values()])).toBe(false);
  });

  it("a tag over a deck label moves off it (AC-06, canvas)", () => {
    // The loft's label hangs from (1.42, 3.68), 0.12 m inside its top-left corner (1.3, 3.8).
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 }, { type: "labelZone", id: "L1", at: { x: 2, y: 3.4 }, name: "Living", finish: null });
    const deck = labelledDecks(doc, levelOf(doc, null))[0];
    if (!deck) throw new Error("no deck label");
    const label = deckLabelBox(deck, CANVAS_STYLE, 80);
    const tag = tagLayout(doc, "L1", { zoom: 80 }, null);
    if (!tag) throw new Error("no tag");
    expect(overlapsAny(plateBox({ x: 2, y: 3.4 }, tagPx("5.80 × 3.80 m"), 3, CANVAS_STYLE.tag, 80), [ring(label)])).toBe(true);
    // The two-line label box (areas.10) x 1.37–2.18, y 3.28–3.73. Up leaves the floor; down 0.5 m (box to y 3.225) clears it.
    expectCentre(tag, 2, 2.9);
    expect(overlapsAny(tag, [ring(label)])).toBe(false);
  });

  it("an unlabelled furnished room's tag moves the same way (AC-07)", () => {
    // One line "22.04 m² · free 18.8 m²" (131.51 px), half-box (0.872, 0.125), at the interior point (3, 2): clearing
    // the bed (to x 2.3) takes 0.25 m to the right; up or down it would take 1.25 m.
    const doc = studioDoc();
    const zone = zones(doc)[0];
    if (!zone) throw new Error("no room");
    const tag = roomTagLayout(doc, zone, { zoom: 80 }, "s0");
    expectCentre(tag, 3.25, 2);
    expect(tag?.lines[0].at.x).toBeCloseTo(3.25, 9);
    expect(tag?.lines[0].at.y).toBeCloseTo(2, 9);
    if (!tag) throw new Error("no tag");
    expect(overlapsAny(tag, piecesOf(doc, "s0"))).toBe(false);
  });

  it("an orphan's tag never moves; tagAt hits the moved box and not the old one (AC-07)", () => {
    // "no enclosing walls" 104.47 px: half-width (52.24 + 4) / 80 = 0.703 m, so the orphan's box at (6.2, 2) covers the
    // right wall's body (x 5.9–6.1).
    const orphan = tagLayout(withOrphan(roomDoc(), "L9", { x: 6.2, y: 2 }), "L9", { zoom: 80 }, null);
    expect(orphan?.min.x).toBeCloseTo(6.2 - (tagPx("no enclosing walls") / 2 + 4) / 80, 9);
    expect(orphan?.min.x).toBeCloseTo(5.497, 3);
    expectCentre(orphan, 6.2, 2);
    const view: Camera = { ...camera, zoom: 80 };
    const doc = studio();
    expect(tagAt(doc, { x: 1.5, y: 3.5 }, view, "s0")).toBe("L1");
    expect(tagAt(doc, { x: 1.5, y: 2 }, view, "s0")).toBeNull();
    expect(tagAt(doc, { x: 1.5, y: 2 }, view, "n/s0")).toBe("L1");
  });

  it("the cache returns the same moved layout object on repeat", () => {
    const doc = studio();
    const first = tagLayout(doc, "L1", { zoom: 80 }, "s0");
    expectCentre(first, 1.5, 3.5);
    expect(tagLayout(doc, "L1", { zoom: 80 }, "s0")).toBe(first);
    const furnished = studioDoc();
    const zone = zones(furnished)[0];
    if (!zone) throw new Error("no room");
    const room = roomTagLayout(furnished, zone, { zoom: 80 }, "s0");
    expectCentre(room, 3.25, 2);
    expect(roomTagLayout(furnished, zone, { zoom: 80 }, "s0")).toBe(room);
  });
});

// The step 06 reviews (tidy.25): two skeptics found a moved tag clipping a turned room's inner corner, a zoom step the
// cache had to rebuild obstacles for, and three of the four floor corners untested.
describe("tag spots: the review cases (tidy.25)", () => {
  const roomWalls = (pts: Point[]): Command[] => pts.map((p, i) => ({ type: "addWall", opId: `r${i}`, from: { at: p }, to: { at: pts[(i + 1) % pts.length] ?? p } }));
  const pieceAt = (at: Point, w: number, d: number): Command[] => [
    { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "block" }, at },
    { type: "setObjectSize", objectId: "b/o0", w, d: { standard: d } },
  ];
  const ring = ({ min, max }: { min: Point; max: Point }): Point[] => [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];

  it("in an L room turned 45°, a moved tag doesn't take in the inner corner's joint", () => {
    const turn = (p: Point): Point => ({ x: 5 + (p.x - p.y) * Math.SQRT1_2, y: (p.x + p.y) * Math.SQRT1_2 });
    const L = [{ x: 0, y: 0 }, { x: 4.5, y: 0 }, { x: 4.5, y: 1.6 }, { x: 1.8, y: 1.6 }, { x: 1.8, y: 4 }, { x: 0, y: 4 }].map(turn);
    // A label at (4.84, 1.6) with a 0.4 m block on it moved, before the fix, to (4.84, 2.1): four corners on the floor,
    // no wall body touched, 0.0039 m² of the box on the walls' mitred corner.
    const doc = withCommands(emptyDocument(), ...roomWalls(L), { type: "labelZone", id: "L1", at: { x: 4.84, y: 1.6 }, name: "Hall", finish: null }, ...pieceAt({ x: 4.84, y: 1.8 }, 0.4, 0.4));
    const tag = tagLayout(doc, "L1", { zoom: 80 }, "s0");
    const zone = zoneOfLabel(doc, "L1");
    if (!tag || !zone) throw new Error("no tag");
    const c = { x: (tag.min.x + tag.max.x) / 2, y: (tag.min.y + tag.max.y) / 2 };
    expect(Math.hypot(c.x - 4.84, c.y - 2.1)).toBeGreaterThan(0.1); // not the clipping spot
    if (Math.hypot(c.x - 4.84, c.y - 1.6) < 1e-9) return; // no free spot: it stays on its point
    const floorCorners = zone.floor ?? [];
    expect(floorCorners.filter((p) => p.x > tag.min.x && p.x < tag.max.x && p.y > tag.min.y && p.y < tag.max.y)).toEqual([]);
    expect(ring(tag).every((p) => onFloor(zone, p))).toBe(true);
  });

  it("a zoom step on the same document gives the tag a fresh cache gives (deck label boxes depend on zoom)", () => {
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 }, { type: "labelZone", id: "L1", at: { x: 2, y: 3.4 }, name: "Living", finish: null });
    let zoom = 40;
    for (let i = 0; i < 20; i++, zoom *= 1.1) {
      expect(tagLayout(doc, "L1", { zoom }, null), `zoom ${zoom.toFixed(1)}`).toEqual(tagLayout(JSON.parse(JSON.stringify(doc)), "L1", { zoom }, null));
    }
  });

  it("the L room mirrored: the spot with its top-left corner off the floor is skipped", () => {
    const doc = withCommands(
      emptyDocument(),
      ...roomWalls([{ x: 6, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 5 }, { x: 6, y: 5 }]),
      { type: "labelZone", id: "L1", at: { x: 3.92, y: 1.45 }, name: "Hall", finish: null },
      ...pieceAt({ x: 2.75, y: 1.4 }, 0.9, 0.9),
    );
    // The AC-05 L room mirrored about x = 3: box x 3.063–4.777; up 0.25 m puts its top-left corner (3.063, 1.925) in
    // the uncovered square x 3–3.1, y 1.9–2; left still overlaps the block (to x 3.2); right 0.25 m is free.
    const tag = tagLayout(doc, "L1", { zoom: 80 }, "s0");
    if (!tag) throw new Error("no tag");
    expect((tag.min.x + tag.max.x) / 2).toBeCloseTo(4.17, 9);
    expect((tag.min.y + tag.max.y) / 2).toBeCloseTo(1.45, 9);
  });
});
