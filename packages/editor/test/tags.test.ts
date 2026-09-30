import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { DEFAULT_ZOOM, MIN_ZOOM, type Camera } from "../src/camera";
import type { Primitive } from "../src/view/scene-types";
import { areaFieldText, formatArea, tagAt, tagLayout, zoneOfLabel } from "../src/view/tags";
import { labelledDoc, narrowRoomDoc, withOrphan } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };
const host = new FakeHost();

describe("tag layouts are cached (spec §5.9, P2)", () => {
  it("returns the same layout for the same document, zoom and Host, also after a pan", () => {
    const doc = labelledDoc();
    const first = tagLayout(doc, "L1", camera, host);
    expect(first).not.toBeNull();
    expect(tagLayout(doc, "L1", camera, host)).toBe(first);
    const panned: Camera = { ...camera, center: { x: 40, y: -7 } };
    expect(tagLayout(doc, "L1", panned, host)).toBe(first);
  });

  it("lays out again after a zoom, on a new document, or with another Host", () => {
    const doc = labelledDoc();
    const first = tagLayout(doc, "L1", camera, host);
    const zoomed = tagLayout(doc, "L1", { ...camera, zoom: camera.zoom * 2 }, host);
    expect(zoomed).not.toBe(first);
    expect(zoomed?.max.x).toBeLessThan(first?.max.x ?? 0); // same text, half the world size
    expect(tagLayout(labelledDoc(), "L1", camera, host)).not.toBe(first);
    expect(tagLayout(doc, "L1", camera, new FakeHost())).not.toBe(tagLayout(doc, "L1", camera, host));
  });

  it("a renamed label gets a new layout (its document is a new value)", () => {
    const doc = labelledDoc();
    const before = tagLayout(doc, "L1", camera, host);
    const renamed = unwrap(execute(doc, { type: "renameZone", id: "L1", name: "A much longer room name" })).doc;
    const after = tagLayout(renamed, "L1", camera, host);
    expect(after?.lines[0]?.text).toBe("A much longer room name");
    expect(after).not.toBe(before);
  });
});

describe("zone tags (spec §3.6)", () => {
  it("formats areas with two decimals", () => {
    expect(formatArea(10.64)).toBe("10.64 m²");
    expect(formatArea(9.9400001)).toBe("9.94 m²");
  });

  it("lays out the name above the area, sized with the host's text metrics", () => {
    const tag = tagLayout(labelledDoc(), "L1", camera, host);
    if (!tag) throw new Error("no tag");
    expect(tag.lines.map((l) => l.text)).toEqual(["Room 1", "10.64 m²"]);
    // Lines are 16 px apart: ±8 px = ±0.1 m at 80 px/m around the label point (1.5, 2).
    expect(tag.lines[0].at.x).toBe(1.5);
    expect(tag.lines[0].at.y).toBeCloseTo(2.1, 9);
    expect(tag.lines[1]?.at.y).toBeCloseTo(1.9, 9);
    // The wider line is "10.64 m²": 8 characters × 0.6 × 12 px = 57.6 px.
    // Half-width (28.8 + 4) px = 0.41 m; half-height (16 + 2) px = 0.225 m.
    expect(tag.min.x).toBeCloseTo(1.09, 9);
    expect(tag.max.x).toBeCloseTo(1.91, 9);
    expect(tag.min.y).toBeCloseTo(1.775, 9);
    expect(tag.max.y).toBeCloseTo(2.225, 9);
  });

  it("says when the area is unavailable, and when no walls enclose a label", () => {
    // The 0.15 m closet holds its tag (123.2 px wide, "Area unavailable" + padding) only zoomed in: 150 px at 1000 px/m.
    expect(tagLayout(narrowRoomDoc(), "L1", { ...camera, zoom: 1000 }, host)?.lines[1]?.text).toBe("Area unavailable");
    expect(tagLayout(withOrphan(labelledDoc()), "L9", camera, host)?.lines[1]?.text).toBe("no enclosing walls");
    expect(tagLayout(labelledDoc(), "missing", camera, host)).toBeNull();
    expect(tagLayout(labelledDoc(), "constructor", camera, host)).toBeNull(); // not an inherited Object member
  });

  it("gives the properties panel the domain's reason for an unavailable area", () => {
    expect(areaFieldText(zoneOfLabel(labelledDoc(), "L1"))).toBe("10.64 m²");
    expect(areaFieldText(zoneOfLabel(narrowRoomDoc(), "L1"))).toBe("Area unavailable: unsupported geometry");
    expect(areaFieldText(zoneOfLabel(withOrphan(labelledDoc()), "L9"))).toBe("no enclosing walls");
  });

  it("hit-tests tags by the same box they are drawn with", () => {
    const doc = withOrphan(labelledDoc());
    expect(tagAt(doc, { x: 1.5, y: 2 }, camera, host)).toBe("L1");
    expect(tagAt(doc, { x: 8.5, y: 6.1 }, camera, host)).toBe("L9"); // "no enclosing walls" makes the orphan tag wide
    expect(tagAt(doc, { x: 1.5, y: 2.3 }, camera, host)).toBeNull(); // just above L1's tag
    expect(tagAt(doc, { x: 1, y: 3 }, camera, host)).toBeNull(); // floor, not tag
  });
});

/** A 3 × 3 m room (centreline ring (0,0)–(3,3)) labelled "Den" (L1) at its centre; clear area 2.8 × 2.8 = 7.84 m². */
function denDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 3, 3, "den")) doc = unwrap(execute(doc, cmd)).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 1.5 }, name: "Den" })).doc;
}

/** denDoc plus a 12 × 10 m room at (10,0)–(22,10) labelled "Hall" (L2) at its centre; clear area 11.8 × 9.8 m². */
function denAndHallDoc(): Document {
  let doc = denDoc();
  for (const cmd of rectangleRoom({ x: 10, y: 0 }, 12, 10, "hall")) doc = unwrap(execute(doc, cmd)).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 16, y: 5 }, name: "Hall" })).doc;
}

function zoomedShell(doc: Document, zoom: number, center: Point): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom, center } };
  return shell;
}

/** The tags layer (spec §5.9: zone tags have their own layer). */
const annotations = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "tags")?.primitives ?? [];
const tagTexts = (shell: FakeShell) => annotations(shell).flatMap((p) => (p.kind === "text" ? [p] : []));
const plates = (shell: FakeShell) => annotations(shell).flatMap((p) => (p.kind === "polygon" ? [p] : []));

// FakeHost text is 0.6 × 12 px = 7.2 px per character. Boxes, in pixels:
//   Den, both lines: max("Den" 21.6, "7.84 m²" 50.4) + 2 × 4 pad = 58.4 wide, 2 × (16 + 2) = 36 tall.
//   Den, name only:  21.6 + 8 = 29.6 wide, 16 + 2 × 2 = 20 tall.
// The 3 m room holds a box while its wider side is under 3 m on screen:
//   both lines above 58.4 / 3 = 19.5 px/m; name only above 29.6 / 3 = 9.9 px/m; nothing below that.
// So zoom 80 (default) shows both lines, 15 the name only, 8 nothing.
//   Hall, both lines: max("Hall" 28.8, "115.64 m²" 64.8) + 8 = 72.8 × 36 px: fits 12 × 10 m above 72.8 / 12 = 6.1 px/m.
//   Lost (orphan), both lines: "no enclosing walls" 129.6 + 8 = 137.6 px: always shown.
const NAME_ONLY_ZOOM = 15;
const HIDDEN_ZOOM = 8;

describe("zone tags fit their room (spec §5.9)", () => {
  it("shows both lines when the whole tag fits inside the room", () => {
    const shell = zoomedShell(denDoc(), DEFAULT_ZOOM, { x: 1.5, y: 1.5 });
    expect(tagTexts(shell).map((t) => t.text)).toEqual(["Den", "7.84 m²"]);
    expect(plates(shell)).toHaveLength(1);
  });

  it("shows only the name, centred on the label point on a one-line plate, when only that fits", () => {
    const shell = zoomedShell(denDoc(), NAME_ONLY_ZOOM, { x: 1.5, y: 1.5 });
    const texts = tagTexts(shell);
    expect(texts.map((t) => t.text)).toEqual(["Den"]);
    expect(texts[0]?.at).toEqual({ x: 1.5, y: 1.5 });
    // Half-width (10.8 + 4) px / 15 = 0.98667 m; half-height (8 + 2) px / 15 = 0.66667 m.
    const plate = plates(shell);
    expect(plate).toHaveLength(1);
    const pts = plate[0]?.points ?? [];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(1.5 - 14.8 / 15, 9);
    expect(Math.max(...xs)).toBeCloseTo(1.5 + 14.8 / 15, 9);
    expect(Math.min(...ys)).toBeCloseTo(1.5 - 10 / 15, 9);
    expect(Math.max(...ys)).toBeCloseTo(1.5 + 10 / 15, 9);
    const tag = tagLayout(shell.doc(), "L1", shell.state.camera, shell.host);
    expect(tag?.lines.map((l) => l.text)).toEqual(["Den"]);
  });

  it("hides the tag when not even the name fits: not drawn, not a click target, the floor still selects the zone", () => {
    const shell = zoomedShell(denDoc(), HIDDEN_ZOOM, { x: 1.5, y: 1.5 });
    expect(annotations(shell)).toEqual([]);
    expect(tagLayout(shell.doc(), "L1", shell.state.camera, shell.host)).toBeNull();
    expect(tagAt(shell.doc(), { x: 1.5, y: 1.5 }, shell.state.camera, shell.host)).toBeNull();
    shell.click({ x: 1.5, y: 1.5 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  });

  it("keeps a big room's tag while a small room's tag is hidden at the same zoom", () => {
    const shell = zoomedShell(denAndHallDoc(), HIDDEN_ZOOM, { x: 11, y: 5 });
    expect(tagTexts(shell).map((t) => t.text)).toEqual(["Hall", "115.64 m²"]);
    expect(plates(shell)).toHaveLength(1);
  });

  it("always shows both lines of an orphan label", () => {
    const shell = zoomedShell(withOrphan(emptyDocument()), MIN_ZOOM, { x: 8, y: 6 });
    expect(tagTexts(shell).map((t) => t.text)).toEqual(["Lost", "no enclosing walls"]);
    expect(tagAt(shell.doc(), { x: 8, y: 6 }, shell.state.camera, shell.host)).toBe("L9");
  });
});
