import { describe, expect, it } from "vitest";
import { emptyDocument, execute, sectionsOf, unwrap, type Command, type Document, type Section } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ExportPage } from "../src/ports/effects";
import { textWidth } from "../src/view/fonts";
import { LOOK_LONG_SIDE, type LookPicture } from "../src/view/look";
import { lookSection } from "../src/view/look-section";
import type { Primitive } from "../src/view/scene-types";
import { nightBedDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Claude's section (AC-11): the strip's picture, for a named layout, with its own room for what the picture's edges hold.

const P = (x: number, y: number): Point => ({ x, y });
const THROUGH_BED: Command = { type: "addSection", a: P(-1, 2), b: P(7, 2), side: 1 };

function look(doc: Document, letter = "A", layout = "s0"): LookPicture {
  const picture = lookSection(doc, letter, layout);
  if ("refused" in picture) throw new Error(picture.refused);
  return picture;
}

/** A primitive's kind, colour and text, which don't change with the scale. */
function fixed(p: Primitive): string {
  switch (p.kind) {
    case "text": return `text ${p.text} ${p.color}`;
    case "segment": case "polygon": case "disc": case "arc": return `${p.kind} ${p.color}`;
  }
}

const polygons = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "polygon" ? [p] : []));

/** Every polygon's points within the box of them all, so pictures at two scales read the same. */
function shapes(ps: readonly Primitive[]): number[] {
  const points = polygons(ps).flatMap((p) => [...p.points, ...p.holes.flat()]);
  const [xs, ys] = [points.map((q) => q.x), points.map((q) => q.y)];
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const [w, h] = [Math.max(...xs) - minX, Math.max(...ys) - minY];
  return points.flatMap((q) => [(q.x - minX) / w, (q.y - minY) / h]);
}

function stripOf(doc: Document, layout: "day" | "night"): ExportPage {
  const shell = FakeShell.withDocument(doc);
  if (layout === "night") shell.ui({ type: "setActiveState", id: "n/s0" });
  shell.click(P(3, 2));
  const strip = shell.view().sectionStrip;
  if (!strip) throw new Error("no strip");
  return strip.page({ w: 1200, h: 208 });
}

describe("lookSection", () => {
  const doc = withCommands(nightBedDoc(), THROUGH_BED);

  for (const [layout, id] of [["day", "s0"], ["night", "n/s0"]] as const) {
    it(`draws the strip's primitives for ${layout}, in the strip's order`, () => {
      const strip = stripOf(doc, layout).primitives;
      const { primitives: all } = look(doc, "A", id);
      const primitives = all.slice(0, -1); // the strip's title is in its bar; Claude's is the last thing drawn
      expect(all.at(-1)).toMatchObject({ kind: "text", text: expect.stringMatching(/^A–A · /) });
      expect(polygons(primitives).length).toBeGreaterThan(3);
      expect(primitives.map(fixed)).toEqual(strip.map(fixed));
      const [mine, theirs] = [shapes(primitives), shapes(strip)];
      expect(mine.length).toBe(theirs.length);
      mine.forEach((v, i) => expect(v).toBeCloseTo(theirs[i] ?? NaN, 6));
    });
  }

  it("the two layouts differ: the bed is in Night's only", () => {
    expect(polygons(look(doc, "A", "n/s0").primitives).length).toBeGreaterThan(polygons(look(doc, "A", "s0").primitives).length);
  });

  it("names the section, the layout, which end is on the left, the width and the scale", () => {
    const { caption, frame } = look(doc, "A", "n/s0");
    expect(caption).toBe(`A–A · Night · a on the left · 8.00 m wide · y up from the floor · ${(1 / frame.zoom).toPrecision(3)} m per look pixel`);
    const flipped = withCommands(nightBedDoc(), { ...THROUGH_BED, side: -1 });
    expect(look(flipped).caption).toContain("A–A · Layout · b on the left ·");
  });

  it("refuses an unknown letter and an unknown layout, by name", () => {
    expect(lookSection(doc, "Q", "s0")).toEqual({ refused: "No section has the id Q" });
    expect(lookSection(doc, "constructor", "s0")).toEqual({ refused: "No section has the id constructor" });
    expect(lookSection(doc, "A", "nope")).toEqual({ refused: "No layout state has the id nope" });
    expect(lookSection(doc, "A", "constructor")).toEqual({ refused: "No layout state has the id constructor" });
  });

  describe("the frame", () => {
    const row = (doc: Document): Section => {
      const [s] = sectionsOf(doc);
      if (!s) throw new Error("no section");
      return s;
    };
    const room = (height: number, length: number): Document => withCommands(roomDoc(), { type: "setCeiling", height }, { type: "addSection", a: P(-1, 2), b: P(-1 + length, 2), side: 1 });

    for (const [height, length] of [[2.5, 8], [2.5, 0.5], [10, 0.5], [10, 40], [2.5, 400]] as const) {
      it(`holds everything, its long side at the look's size, for a ${height} m ceiling and a ${length} m line`, () => {
        const d = room(height, length);
        expect(row(d).depth).toBeNull();
        const { primitives, frame } = look(d);
        const { min, max, zoom } = frame;
        expect(Math.max((max.x - min.x) * zoom, (max.y - min.y) * zoom)).toBeCloseTo(LOOK_LONG_SIDE, 6);
        const texts = primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
        expect(texts.length).toBeGreaterThanOrEqual(3); // the title and at least two heights
        for (const t of texts) {
          const width = textWidth(t.font, t.text, t.size) / zoom;
          expect(t.at.x, t.text).toBeGreaterThanOrEqual(min.x);
          expect(t.at.x + width, t.text).toBeLessThanOrEqual(max.x);
          expect(t.at.y - t.size / 2 / zoom, t.text).toBeGreaterThanOrEqual(min.y);
          expect(t.at.y + t.size / 2 / zoom, t.text).toBeLessThanOrEqual(max.y);
        }
      });
    }

    it("the picture's shapes, the bands included, stop short of every edge, for a stroke's width at least", () => {
      const { primitives, frame } = look(room(2.5, 8));
      const points = polygons(primitives).flatMap((p) => p.points);
      expect(points.length).toBeGreaterThan(8);
      const clear = 4 / frame.zoom;
      for (const q of points) {
        expect(q.x).toBeGreaterThanOrEqual(frame.min.x + clear);
        expect(q.x).toBeLessThanOrEqual(frame.max.x - clear);
        expect(q.y).toBeGreaterThanOrEqual(frame.min.y + clear);
        expect(q.y).toBeLessThanOrEqual(frame.max.y - clear);
      }
    });
  });

  it("a section of a project with no walls still has a picture: its bands and heights", () => {
    const empty = unwrap(execute(emptyDocument(), { type: "addSection", a: P(0, 0), b: P(2, 0), side: -1 })).doc;
    expect(look(empty).primitives.filter((p) => p.kind === "polygon").length).toBeGreaterThan(0);
  });
});
