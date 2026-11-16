import { describe, expect, it } from "vitest";
import { deckView, emptyDocument, levelOf, motifDefaults, wallOutlines, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { createLocalDocument } from "../src/document/local-document";
import { exportFileName } from "../src/export/panel";
import { boundsCentre } from "../src/export/fit";
import { drawingArea, orientationFor } from "../src/export/paper";
import { planSize, sheetBounds, sheetFitScale } from "../src/export/sheet";
import { toPage } from "../src/export/to-page";
import { planView } from "../src/levels";
import { pictureBounds, pictureLayers, planPicture } from "../src/view/picture";
import { floorView, viewAt, type PlanView } from "../src/view/plan-view";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { labelledDoc, roomDoc, withCommands, withoutSheetFinishes } from "./builders";
import { FakeShell } from "./fake-shell";

// Export: its button, and what the sheets view saves (spec Behaviour "Starting an export", export.04, .18, .19; AC-05, AC-07).

describe("Export in the floating bar (AC-05)", () => {
  it("is disabled without walls, and says why", () => {
    const shell = FakeShell.withDocument(emptyDocument());
    expect(shell.view().export).toEqual({ available: false, reason: "Draw some walls first" });
  });

  it("is available once the drawing has walls", () => {
    const shell = FakeShell.withDocument(roomDoc());
    expect(shell.view().export).toEqual({ available: true, reason: null });
  });

  it("opening the view on an empty drawing does nothing", () => {
    const shell = FakeShell.withDocument(emptyDocument());
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView).toBeNull();
  });
});

describe("saving from the sheets view (AC-04)", () => {
  it("SVG saves the active layout's plan in the presentation style, named after the project", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "svg" });
    const [save] = shell.effectsOf("saveFile");
    expect(save?.name).toBe("Untitled.svg");
    expect(save?.content.kind).toBe("svg");
    if (save?.content.kind !== "svg") return;
    expect(save.content.frame.zoom).toBe(10); // one unit is a millimetre at 1:100
    expect(save.content.frame.min).toEqual({ x: -0.6, y: -0.6 });
    const colors = new Set(save.content.primitives.map((p) => p.color));
    expect(colors.has(PRESENTATION_STYLE.wall)).toBe(true);
    expect(shell.view().sheetsView).not.toBeNull(); // the view stays open after saving
  });

  it("the finishes choice is kept for the drawing during the session, and another drawing starts fresh", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "openExport" });
    shell.ui({ type: "setExport", field: "finishes", value: "without" });
    shell.ui({ type: "closeExport" });
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.finishes).toBe("without");
    expect(shell.state.exportChoices["local"]).toEqual({ finishes: "without" });
    shell.state = { ...shell.state, document: createLocalDocument({ id: "other", name: "Other" }, "g2", roomDoc()) };
    expect(shell.state.exportChoices["other"]).toBeUndefined();
  });
});

/** A long straight wall from (0, 0): a plan `length` metres wide and about a metre deep. */
const longWall = (length: number) => withCommands(roomDoc(), { type: "addWall", opId: "far", from: { at: { x: 6, y: 0 } }, to: { at: { x: length, y: 0 } } });

describe("the PDF (AC-04, AC-09, AC-13)", () => {
  it("nothing fits: it still saves, clipped at the smallest scale (sheetset.17)", () => {
    const shell = FakeShell.withDocument(longWall(58)); // about 59 m: 295 mm at 1:200, wider than A4 left of the column (217)
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.canSave).toBe(true);
    expect(shell.view().sheetsView?.sheets[0]?.scale).toBe(200);
    expect(shell.view().sheetsView?.status).toBe("1 shows part of the plan");
    shell.ui({ type: "download", format: "pdf" });
    expect(shell.effectsOf("saveFile")).toHaveLength(1);
  });

  it("a Greek room name shows the characters warning; an accented Latin one does not", () => {
    const greek = FakeShell.withDocument(withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Κουζίνα", finish: null }));
    greek.ui({ type: "openExport" });
    expect(greek.view().sheetsView?.warning).toBe("Some names use characters the PDF can't show");
    const italian = FakeShell.withDocument(withCommands(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Cucina è", finish: null }));
    italian.ui({ type: "openExport" });
    expect(italian.view().sheetsView?.warning).toBeNull();
  });

  it("Save PDF saves one page per layout", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "addState", opId: "n", name: "Night" }));
    shell.ui({ type: "openExport" });
    shell.ui({ type: "setSheetSetting", key: "paper", value: "A3" });
    shell.ui({ type: "setSheetSetting", key: "generalScale", value: "50" });
    shell.ui({ type: "download", format: "pdf" });
    const [save] = shell.effectsOf("saveFile");
    expect(save?.name).toBe("Untitled.pdf");
    if (save?.content.kind !== "pdf") throw new Error("not a pdf");
    expect(save.content.pages).toHaveLength(2);
    expect(save.content.pages[0]?.widthMm).toBe(420); // A3 landscape
  });
});

describe("Finishes: With / Without (AC-12, finishes.10)", () => {
  const PLANKS = motifDefaults("planks");
  const finished = (): Document => withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish: PLANKS });
  /** The planks' base colour in what each format hands the shell: the saved SVG or PDF, the PNG's page to rasterise. */
  function exported(format: "pdf" | "svg" | "png", finishes?: "without"): boolean {
    const shell = FakeShell.withDocument(finishes !== undefined && format === "pdf" ? withoutSheetFinishes(finished()) : finished());
    shell.ui({ type: "openExport" });
    if (finishes !== undefined && format !== "pdf") shell.ui({ type: "setExport", field: "finishes", value: finishes });
    shell.ui({ type: "download", format });
    const content = shell.effectsOf("saveFile")[0]?.content;
    const primitives =
      format === "png" ? (shell.effectsOf("rasterise")[0]?.page.primitives ?? []) : content?.kind === "svg" ? content.primitives : content?.kind === "pdf" ? content.pages.flatMap((p) => p.primitives) : [];
    expect(primitives.length).toBeGreaterThan(0);
    return primitives.some((p) => p.color === PLANKS.colour);
  }

  it("defaults to with, for every format, and the download draws the floors", () => {
    for (const format of ["pdf", "svg", "png"] as const) expect(exported(format), format).toBe(true);
  });

  it("without travels to the images through this viewer's choice, and to the PDF through each sheet", () => {
    for (const format of ["pdf", "svg", "png"] as const) expect(exported(format, "without"), format).toBe(false);
  });

  it("the viewer's choice leaves the PDF alone", () => {
    const shell = FakeShell.withDocument(finished());
    shell.ui({ type: "setExport", field: "finishes", value: "without" });
    shell.ui({ type: "download", format: "pdf" });
    const [save] = shell.effectsOf("saveFile");
    if (save?.content.kind !== "pdf") throw new Error("not a pdf");
    expect(save.content.pages.flatMap((p) => p.primitives).some((p) => p.color === PLANKS.colour)).toBe(true);
  });
});

describe("PNG (export.18, AC-06)", () => {
  it("Download with PNG asks the shell for a 3,000 px raster of the presentation picture", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "png" });
    const [ask] = shell.effectsOf("rasterise");
    expect(ask?.size.w).toBe(3000); // the plan is wider than tall: 7.2 × 5.2 m framed
    expect(ask?.size.h).toBe(Math.round((3000 * 5.2) / 7.2));
    expect(ask?.page.widthMm).toBeCloseTo(72, 9);
    const colors = new Set(ask?.page.primitives.map((p) => p.color));
    for (const c of ["#2563eb", "#f59e0b55", "#dce8f7aa"]) expect(colors.has(c)).toBe(false); // no selection, warnings or room fills
    expect(shell.effectsOf("saveFile")).toEqual([]);
  });

  it("the raster with the pending id is saved as <project>.png; a stale one is ignored", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "png" });
    const requestId = shell.effectsOf("rasterise")[0]?.requestId ?? "";
    const image = { fake: "png bytes" };
    shell.send({ type: "rasterised", requestId: "stale", image });
    expect(shell.effectsOf("saveFile")).toEqual([]);
    shell.send({ type: "rasterised", requestId, image });
    expect(shell.effectsOf("saveFile")).toEqual([{ type: "saveFile", name: "Untitled.png", content: { kind: "image", image } }]);
    shell.send({ type: "rasterised", requestId, image }); // answered twice: saved once
    expect(shell.effectsOf("saveFile")).toHaveLength(1);
  });
});

describe("decks in the SVG (decks.07, AC-08)", () => {
  it("the SVG download draws a loft as a dashed outline and labels it", () => {
    const doc = withCommands(roomDoc(), { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.5, y: 2.8 } });
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "openExport" });
    shell.ui({ type: "download", format: "svg" });
    const [save] = shell.effectsOf("saveFile");
    if (save?.content.kind !== "svg") throw new Error("not an svg");
    const dashed = save.content.primitives.filter((p) => p.kind === "segment" && p.dash !== undefined && p.color === PRESENTATION_STYLE.deck.line.color);
    expect(dashed).toHaveLength(4);
    expect(dashed.every((p) => p.kind === "segment" && p.dash?.join() === PRESENTATION_STYLE.deck.dash.join())).toBe(true);
    expect(save.content.primitives).toContainEqual(expect.objectContaining({ kind: "text", text: "Loft +2.15", size: PRESENTATION_STYLE.deck.label.size }));
  });
});

describe("dimensions in the SVG and PNG (AC-10)", () => {
  it("the SVG frame and PNG page take in the dimension", () => {
    // roomDoc's bottom outer face measured right to left, its line 1 m below the wall at y −1.1.
    const doc = withCommands(roomDoc(), { type: "addDimension", opId: "m", a: { x: 6.1, y: -0.1 }, b: { x: -0.1, y: -0.1 }, offset: 1 });
    const svg = FakeShell.withDocument(doc);
    svg.ui({ type: "openExport" });
    svg.ui({ type: "download", format: "svg" });
    const [save] = svg.effectsOf("saveFile");
    if (save?.content.kind !== "svg") throw new Error("not an svg");
    expect(save.content.frame.min.x).toBeCloseTo(-0.6, 9);
    expect(save.content.frame.min.y).toBeCloseTo(-1.6, 9);
    expect(save.content.primitives).toContainEqual(expect.objectContaining({ kind: "text", text: "6.20", color: PRESENTATION_STYLE.accent }));
    const png = FakeShell.withDocument(doc);
    png.ui({ type: "openExport" });
    png.ui({ type: "download", format: "png" });
    const [ask] = png.effectsOf("rasterise");
    expect(ask?.page.heightMm).toBeCloseTo(62, 9);
    expect(ask?.page.widthMm).toBeCloseTo(72, 9);
  });
});

// Exports at a level (spec "Exports", levels.12; AC-11): PNG and SVG draw the viewed level with the active layout, the
// PDF's plan pages stay at the floor unless a loft has pieces of its own.

const LOFT = "loft/k0";
const PARTITION = "part/w0";
const place = (opId: string, kind: string, at: Point): Command => ({ type: "placeObject", linked: false, deck: null, opId, state: "s0", object: { kind }, at });

/**
 * The studio: roomDoc's shell (ceiling 2.50) split at x = 2.5 by a 2.03 partition with a door, under a Loft (top 2.15)
 * at x 1.3–3.7, y 1.4–3.8; a sofa at x 3.55–5.65, y 0.1–1.0; a room tag, a dimension and a Night layout.
 */
function studio(): Document {
  return withCommands(
    roomDoc(),
    { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
    { type: "setWallTop", wallId: PARTITION, top: 2.03 },
    { type: "addOpening", opId: "door", wall: PARTITION, kind: "swing", offset: 2.6 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 },
    place("sofa", "sofa", { x: 4.6, y: 1 }),
    { type: "labelZone", id: "L1", at: { x: 4.5, y: 2.2 }, name: "Living", finish: null },
    { type: "addDimension", opId: "dim", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 },
    { type: "addState", opId: "n", name: "Night" },
  );
}

const exporting = (doc: Document, deck: string | null): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setViewedLevel", deck });
  shell.ui({ type: "openExport" });
  return shell;
};
const svgAt = (doc: Document, deck: string | null): readonly Primitive[] => {
  const shell = exporting(doc, deck);
  shell.ui({ type: "download", format: "svg" });
  const [save] = shell.effectsOf("saveFile");
  if (save?.content.kind !== "svg") throw new Error("not an svg");
  return save.content.primitives;
};
const pdfAt = (doc: Document, deck: string | null) => {
  const shell = exporting(doc, deck);
  shell.ui({ type: "download", format: "pdf" });
  const [save] = shell.effectsOf("saveFile");
  if (save?.content.kind !== "pdf") throw new Error("not a pdf");
  return save.content.pages;
};
type Segment = Extract<Primitive, { kind: "segment" }>;
const segments = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const texts = (ps: readonly Primitive[]): string[] => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
const same = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
/** The segments drawn along a ring's edges, from each corner to the next. */
const ringEdges = (ps: readonly Primitive[], ring: readonly Point[]): Segment[] =>
  ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return segments(ps).filter((s) => same(s.a, a) && same(s.b, b));
  });
const filled = (ps: readonly Primitive[], ring: readonly Point[]): boolean => ps.some((p) => p.kind === "polygon" && p.points === ring);
/** The primitives wholly inside the sofa's footprint, x 3.55–5.65, y 0.1–1.0. */
const sofa = (ps: readonly Primitive[]): Primitive[] =>
  ps.filter((p) => {
    const pts = p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : p.kind === "text" ? [p.at] : [p.center];
    return pts.every((q) => q.x >= 3.55 - 1e-6 && q.x <= 5.65 + 1e-6 && q.y >= 0.1 - 1e-6 && q.y <= 1.0 + 1e-6);
  });

describe("exports at a level (AC-11)", () => {
  it("AC-11: at the loft the SVG holds the loft fill and the ghosted partition and no sofa", () => {
    const doc = studio();
    const ring = deckView(doc, LOFT)?.ring ?? [];
    const partition = wallOutlines(doc).get(PARTITION) ?? [];
    const tint = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "polygon" && p.color === PRESENTATION_STYLE.deck.tint && p.points === ring);
    // The fixture changes the answer: at the floor the loft is a dashed outline, the partition filled, the sofa drawn.
    const floor = svgAt(doc, null);
    expect(tint(floor)).toEqual([]);
    expect(filled(floor, partition)).toBe(true);
    expect(sofa(floor).length).toBeGreaterThan(0);
    expect(texts(floor)).toContain("Living");

    const loft = svgAt(doc, LOFT);
    expect(tint(loft)).toHaveLength(1);
    expect(filled(loft, partition)).toBe(false);
    const edges = ringEdges(loft, partition);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((s) => s.color === PRESENTATION_STYLE.ghost.line && "px" in s.width && s.width.px === PRESENTATION_STYLE.ghost.width)).toBe(true);
    expect(sofa(loft)).toEqual([]);
    // No room tag, area or dimension at an upper level; "Open to below" in each room the loft covers in part (edges.07).
    expect(texts(loft).filter((t) => !/^(Open to below|Open to|below)$/.test(t))).toEqual(["Loft +2.15", "5.76 m²"]); // the loft's area line (areas.10)
    expect(texts(loft).filter((t) => /^(Open to below|Open to)$/.test(t))).toHaveLength(2);
  });

  it("a loft with a piece of its own gets a PDF page at its level, with Open to below (edges AC-10)", () => {
    const doc = withCommands(studio(), { type: "placeObject", linked: false, deck: LOFT, opId: "m", state: "s0", object: { kind: "mattress" }, at: { x: 2.5, y: 3.7 } });
    const pages = pdfAt(doc, null);
    expect(pages.some((pg) => texts(pg.primitives).some((t) => t === "Open to below" || t === "Open to"))).toBe(true);
    expect(texts(pages[0]?.primitives ?? []).some((t) => t === "Open to below" || t === "Open to")).toBe(false); // the floor's page has none
  });

  it("the loft SVG draws the partition's ghost lines before the loft's tint", () => {
    const doc = studio();
    const ring = deckView(doc, LOFT)?.ring ?? [];
    const partition = wallOutlines(doc).get(PARTITION) ?? [];
    const loft = svgAt(doc, LOFT);
    const tint = loft.findIndex((p) => p.kind === "polygon" && p.color === PRESENTATION_STYLE.deck.tint && p.points === ring);
    const ghosts = ringEdges(loft, partition).map((s) => loft.indexOf(s));
    expect(tint).toBeGreaterThanOrEqual(0);
    expect(ghosts.length).toBeGreaterThan(0);
    expect(Math.max(...ghosts)).toBeLessThan(tint);
  });

  it("the PNG's picture is the loft view", () => {
    const doc = studio();
    const shell = exporting(doc, LOFT);
    const view = planView(shell.state);
    if (!view) throw new Error("no view");
    const { min } = pictureBounds(doc, "s0"); // the frame is the floor's: the same box at every level
    const expected = pictureLayers(planPicture(doc, view, PRESENTATION_STYLE, 10, true)).map((p) => toPage(p, 10, -min.x * 10, -min.y * 10));
    shell.ui({ type: "download", format: "png" });
    const [ask] = shell.effectsOf("rasterise");
    expect(ask?.page.primitives).toEqual(expected);
    expect(ask?.page.widthMm).toBeCloseTo(72, 9);
    const floor = exporting(doc, null);
    floor.ui({ type: "download", format: "png" });
    expect(floor.effectsOf("rasterise")[0]?.page.primitives).not.toEqual(expected); // the floor's picture differs
  });

  it("the PDF bytes are equal whether the viewer is at the floor or the loft", () => {
    // Compared as the sheet's pages: the shell's writer (toPdf) is a function of the pages alone. Each shell has its own
    // FakeHost, whose clock starts at the same time.
    const doc = studio();
    const floor = pdfAt(doc, null);
    const loft = pdfAt(doc, LOFT);
    expect(floor).toHaveLength(2);
    expect(loft).toEqual(floor);
    expect(texts(floor[0]?.primitives ?? [])).toContain("Living"); // the floor's plan, with its room tag
  });

  it("AC-11: viewing the loft, the PDF's plan is the floor's picture", () => {
    // The first page starts with its plan: Day's floor picture at the fit scale, centred in A4's drawing area, and its
    // clip ends there. Placed here from the sheet's own sizes, so a sheet drawn at another level can't match it.
    const doc = studio();
    const shell = exporting(doc, LOFT);
    shell.ui({ type: "download", format: "pdf" });
    const [save] = shell.effectsOf("saveFile");
    if (save?.content.kind !== "pdf") throw new Error("not a pdf");
    const page = save.content.pages[0]?.primitives ?? [];
    const scale = sheetFitScale(doc, "A4");
    if (scale === null) throw new Error("the studio does not fit A4");
    const k = 1000 / scale;
    const size = planSize(doc);
    const area = drawingArea("A4", orientationFor(size, "A4"));
    const centre = boundsCentre(sheetBounds(doc));
    const dx = area.x + area.w / 2 - centre.x * k;
    const dy = area.y + area.h / 2 - centre.y * k;
    const placed = (view: PlanView) => pictureLayers(planPicture(doc, view, PRESENTATION_STYLE, k, true)).map((p) => toPage(p, k, dx, dy));
    const floor = placed(floorView(doc, "s0"));
    expect(placed(viewAt("s0", levelOf(doc, LOFT)))).not.toEqual(floor); // the fixture changes the answer
    expect(page.slice(0, floor.length)).toEqual(floor);
    expect(save.content.pages[0]?.clips?.[0]).toMatchObject({ from: 0, to: floor.length });
  });

  it("with the view open, at the floor or the loft, the canvas keeps its view from frame to frame and the page is not rebuilt", () => {
    // A page takes the floor's view of its layout: it must not cost the canvas its view, nor the page its cache, on
    // every frame (levels.26).
    for (const deck of [null, LOFT]) {
      const shell = exporting(studio(), deck);
      const firstPage = () => shell.view().sheetsView?.sheets[0]?.pages()[0];
      shell.scene();
      const page = firstPage();
      const view = planView(shell.state);
      shell.scene();
      expect(planView(shell.state), String(deck)).toBe(view);
      expect(firstPage(), String(deck)).toBe(page);
    }
  });

  it("a PDF with a loft sheet of its own, drawn while viewing the loft in another layout, keeps the canvas's view (levels.26)", () => {
    const doc = withCommands(
      studio(),
      { type: "setCeiling", height: 3.5 },
      { type: "placeObject", linked: false, deck: LOFT, opId: "bed", state: "n/s0", object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 2.5, y: 2.6 } },
    );
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "setViewedLevel", deck: LOFT }); // the canvas at Day's loft, the PDF's loft sheet at Night's
    const view = planView(shell.state);
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.sheets.flatMap((s) => s.pages())).toHaveLength(3); // builds the pages
    shell.ui({ type: "download", format: "pdf" });
    const [save] = shell.effectsOf("saveFile");
    if (save?.content.kind !== "pdf") throw new Error("not a pdf");
    expect(save.content.pages).toHaveLength(3);
    expect(planView(shell.state)).toBe(view);
  });

  it("at the loft the PNG and SVG draw the active layout: a bed on the loft only at Night shows only in Night", () => {
    const doc = withCommands(
      studio(),
      { type: "setCeiling", height: 3.5 }, // room for the bed on the loft
      { type: "placeObject", linked: false, deck: LOFT, opId: "bed", state: "n/s0", object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 2.5, y: 2.6 } },
    );
    if (doc.objects["bed/o0"] === undefined) throw new Error("the bed was refused");
    const at = (layout: string, format: "png" | "svg") => {
      const shell = FakeShell.withDocument(doc);
      shell.ui({ type: "setActiveState", id: layout });
      shell.ui({ type: "setViewedLevel", deck: LOFT });
      shell.ui({ type: "openExport" });
      shell.ui({ type: "download", format });
      const [save] = shell.effectsOf("saveFile");
      const [ask] = shell.effectsOf("rasterise");
      return { content: save?.content.kind === "svg" ? save.content.primitives : ask?.page.primitives };
    };
    for (const format of ["png", "svg"] as const) {
      const day = at("s0", format);
      const night = at("n/s0", format);
      expect(day.content, format).toBeDefined();
      expect(night.content, format).not.toEqual(day.content);
      expect((night.content?.length ?? 0) > (day.content?.length ?? 0), format).toBe(true); // the bed adds to Night's picture
    }
  });

  it("viewing another level keeps a sheet's page: it is drawn at the floor", () => {
    const shell = exporting(studio(), null);
    const firstPage = () => shell.view().sheetsView?.sheets[0]?.pages()[0];
    const page = firstPage();
    expect(page).toMatchObject({ widthMm: 297 });
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(firstPage()).toBe(page);
    shell.ui({ type: "setViewedLevel", deck: null });
    expect(firstPage()).toBe(page);
  });

  it("at the loft, building a sheet's page leaves the canvas its view", () => {
    const shell = FakeShell.withDocument(studio());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.scene();
    const view = planView(shell.state);
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.sheets[0]?.pages()[0]).toMatchObject({ widthMm: 297 }); // the sheet, built now
    shell.ui({ type: "download", format: "pdf" });
    expect(shell.effectsOf("saveFile")).toHaveLength(1);
    expect(planView(shell.state)).toBe(view);
  });
});

describe("exportFileName", () => {
  it("keeps the project name, replaces characters files can't hold, and names an unnamed project", () => {
    expect(exportFileName("My flat", "svg")).toBe("My flat.svg");
    expect(exportFileName('A/B:C*D?"E<F>G|H\\I', "pdf")).toBe("A-B-C-D--E-F-G-H-I.pdf");
    expect(exportFileName("   ", "png")).toBe("Untitled.png");
  });
});
