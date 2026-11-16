import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { sheetPages } from "../src/export/sheet";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, pictureLayers, planPicture } from "../src/view/picture";
import { lookPicture } from "../src/view/look";
import { CHROME_FONT } from "../src/view/fonts";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";

// Text names its font (render.06, .15; AC-01): the canvas and look styles draw Inter, paper Helvetica, chrome text
// CHROME_FONT.

function labelled(): Document {
  const doc = roomDoc();
  return withCommands(
    doc,
    { type: "labelZone", id: "L1", at: { x: 4, y: 2 }, name: "Studio", finish: null },
    { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 4.5 },
    { type: "addDimension", opId: "m", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 },
  );
}

const fonts = (ps: readonly Primitive[]): string[] => [...new Set(ps.flatMap((p) => (p.kind === "text" ? [p.font] : [])))];
const texts = (ps: readonly Primitive[]): number => ps.filter((p) => p.kind === "text").length;

describe("text names its font (AC-01)", () => {
  it("the canvas style and chrome draw Inter", () => {
    const shell = FakeShell.withDocument(labelled());
    shell.key("v");
    shell.click({ x: 6, y: 2 }); // a wall: its helper labels are chrome text
    const ps = shell.scene().layers.flatMap((l) => l.primitives);
    expect(texts(ps)).toBeGreaterThan(2);
    expect(fonts(ps)).toEqual([CHROME_FONT]);
    expect(CANVAS_STYLE.font).toBe("inter");
  });

  it("the presentation style draws Helvetica, the sheet's title block too", () => {
    const doc = labelled();
    const picture = pictureLayers(planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true));
    expect(texts(picture)).toBeGreaterThan(1);
    expect(fonts(picture)).toEqual(["helvetica"]);
    const page = sheetPages(doc, { projectName: "Flat", paper: "A4", scale: "fit", host: new FakeHost(), finishes: true })?.pages[0];
    if (!page) throw new Error("no page");
    expect(texts(page.primitives)).toBeGreaterThan(5);
    expect(fonts(page.primitives)).toEqual(["helvetica"]);
  });

  it("look draws Inter, its rulers included", () => {
    const r = lookPicture(labelled(), null);
    if ("refused" in r) throw new Error(r.refused);
    expect(texts(r.primitives)).toBeGreaterThan(3);
    expect(fonts(r.primitives)).toEqual(["inter"]);
    expect(LOOK_STYLE.font).toBe("inter");
  });
});
