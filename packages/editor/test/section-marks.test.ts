import { describe, expect, it } from "vitest";
import { emptyDocument, levelOf, sheetsOf, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { pagesOf, planSize, sheetBounds, sheetFitScale, sheetPages, sheetSet } from "../src/export/sheet";
import { toPage } from "../src/export/to-page";
import { textWidth } from "../src/view/fonts";
import { lookPicture } from "../src/view/look";
import { idsKey } from "../src/view/memo";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE, drawnBounds, markedBounds, pictureBounds, pictureLayers, planPicture, presentationStyle, type PlanStyle } from "../src/view/picture";
import { floorView, viewAt } from "../src/view/plan-view";
import type { LayerName, Primitive, Scene } from "../src/view/scene-types";
import { buildScene } from "../src/view/scene";
import { sectionMarksLayer } from "../src/view/section-marks-layer";
import { LOFT_ROOM_LOFT, labelledDoc, loftRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeHost, FakeShell } from "./fake-shell";

// A section's marks on the plan (spec "The marks", section.12, AC-03). `side: 1` looks to the left of a → b.
//
//   A  ▬▬▬ ─ ─ ─ ─ ─ ─ ▬▬▬  A
//       |               |
//       ▼               ▼     the arrows point at what the section sees

type Segment = Extract<Primitive, { kind: "segment" }>;
type Polygon = Extract<Primitive, { kind: "polygon" }>;
type Text = Extract<Primitive, { kind: "text" }>;

const ZOOM = 40;
const section = (a: Point, b: Point, side: 1 | -1 = 1): Command => ({ type: "addSection", a, b, side });
const ACROSS: Command = section({ x: 1, y: 2 }, { x: 5, y: 2 });

const marks = (doc: Document, style: PlanStyle = CANVAS_STYLE, zoom = ZOOM, selected = ""): readonly Primitive[] => sectionMarksLayer(doc, style, zoom, selected, false);
const segments = (ps: readonly Primitive[]): Segment[] => ps.filter((p): p is Segment => p.kind === "segment");
const polygons = (ps: readonly Primitive[]): Polygon[] => ps.filter((p): p is Polygon => p.kind === "polygon");
const texts = (ps: readonly Primitive[]): Text[] => ps.filter((p): p is Text => p.kind === "text");
const px = (s: Segment): number => ("px" in s.width ? s.width.px : NaN);
const sceneLayer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];

/** A line's own measures: metres along a → b from a, and across it, positive on the left. */
function ruler(a: Point, b: Point): { len: number; along: (p: Point) => number; across: (p: Point) => number } {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return {
    len,
    along: (p) => (p.x - a.x) * u.x + (p.y - a.y) * u.y,
    across: (p) => -(p.x - a.x) * u.y + (p.y - a.y) * u.x,
  };
}

/** The metres a primitive reaches at `zoom`: its points, and a text's box from its size and measured width. */
function reach(p: Primitive, zoom: number): Point[] {
  switch (p.kind) {
    case "segment":
      return [p.a, p.b];
    case "polygon":
      return [...p.points];
    case "text": {
      const hw = textWidth(p.font, p.text, p.size) / 2 / zoom;
      const hh = p.size / 2 / zoom;
      return [{ x: p.at.x - hw, y: p.at.y - hh }, { x: p.at.x + hw, y: p.at.y + hh }];
    }
    case "arc":
    case "disc":
      return [p.center];
  }
}

function expectInside(ps: readonly Primitive[], zoom: number, frame: { min: Point; max: Point }): void {
  expect(ps.length).toBeGreaterThan(0);
  for (const q of ps.flatMap((p) => reach(p, zoom))) {
    expect(q.x).toBeGreaterThanOrEqual(frame.min.x);
    expect(q.x).toBeLessThanOrEqual(frame.max.x);
    expect(q.y).toBeGreaterThanOrEqual(frame.min.y);
    expect(q.y).toBeLessThanOrEqual(frame.max.y);
  }
}

describe("the marks (AC-03)", () => {
  // A level line, one running backwards and a slanted one: "towards the seen side" can't hold by accident on all three.
  const LINES: [Point, Point][] = [[{ x: 1, y: 2 }, { x: 5, y: 2 }], [{ x: 5, y: 3 }, { x: 2, y: 3 }], [{ x: 0.5, y: 0.5 }, { x: 3.5, y: 4.5 }]];

  it("marks: an arrow at each end towards the seen side", () => {
    for (const [a, b] of LINES) {
      const { len, along, across } = ruler(a, b);
      for (const side of [1, -1] as const) {
        const ps = marks(withCommands(roomDoc(), section(a, b, side)));
        const heads = polygons(ps);
        expect(heads).toHaveLength(2);
        const tips = heads.map((h) => h.points.reduce((far, q) => (Math.abs(across(q)) > Math.abs(across(far)) ? q : far)));
        const over = tips.map((t) => along(t)).sort((x, y) => x - y); // one head over each end
        expect(over[0]).toBeCloseTo(0, 9);
        expect(over[1]).toBeCloseTo(len, 9);
        for (const h of heads) for (const q of h.points) expect(across(q) * side).toBeGreaterThan(0);
        const stems = segments(ps).filter((s) => px(s) === CANVAS_STYLE.mark.stemWidth);
        expect(stems).toHaveLength(2);
        for (const s of stems) {
          expect(across(s.a)).toBeCloseTo(0, 9);
          expect(across(s.b) * side).toBeCloseTo(CANVAS_STYLE.mark.stem / ZOOM, 9);
        }
      }
    }
  });

  it("flip swaps the arrows and nothing else", () => {
    const doc = withCommands(roomDoc(), ACROSS);
    const flipped = withCommands(doc, { type: "setSection", sectionId: "A", side: -1 });
    const { across } = ruler({ x: 1, y: 2 }, { x: 5, y: 2 });
    const sides = (d: Document): number[] => polygons(marks(d)).flatMap((h) => h.points.map((q) => Math.sign(across(q))));
    expect(new Set(sides(doc))).toEqual(new Set([1]));
    expect(new Set(sides(flipped))).toEqual(new Set([-1]));
    const fixed = (d: Document) => [...segments(marks(d)).filter((s) => px(s) !== CANVAS_STYLE.mark.stemWidth), ...texts(marks(d))];
    expect(fixed(flipped)).toEqual(fixed(doc));
  });

  it("marks: thick ends, a thin line and the letter at each end", () => {
    for (const style of [CANVAS_STYLE, PRESENTATION_STYLE, LOOK_STYLE]) {
      const { mark } = style;
      expect(mark.thick).toBeGreaterThan(mark.line);
      for (const [a, b] of LINES) {
        const { len, along, across } = ruler(a, b);
        const ps = marks(withCommands(roomDoc(), section(a, b)), style);
        const end = mark.end / ZOOM;

        const thick = segments(ps).filter((s) => px(s) === mark.thick);
        expect(thick).toHaveLength(2);
        const spans = thick.map((s) => [along(s.a), along(s.b)].sort((x, y) => x - y)).sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0));
        expect(spans[0]?.[0]).toBeCloseTo(0, 9);
        expect(spans[0]?.[1]).toBeCloseTo(end, 9);
        expect(spans[1]?.[0]).toBeCloseTo(len - end, 9);
        expect(spans[1]?.[1]).toBeCloseTo(len, 9);
        for (const s of thick) expect(s.dash).toBeUndefined();

        const thin = segments(ps).filter((s) => s.dash !== undefined);
        expect(thin).toHaveLength(1);
        const [line] = thin;
        if (!line) throw new Error("no line");
        expect(line.dash).toEqual(mark.dash);
        expect(px(line)).toBe(mark.line);
        expect(along(line.a)).toBeCloseTo(end, 9);
        expect(along(line.b)).toBeCloseTo(len - end, 9);
        for (const s of [...thick, line]) {
          expect(across(s.a)).toBeCloseTo(0, 9);
          expect(across(s.b)).toBeCloseTo(0, 9);
        }

        const letters = texts(ps);
        expect(letters.map((t) => t.text)).toEqual(["A", "A"]);
        const places = letters.map((t) => along(t.at)).sort((x, y) => x - y);
        expect(places[0]).toBeCloseTo(-mark.textGap / ZOOM, 9); // on the line's extension, past each end
        expect(places[1]).toBeCloseTo(len + mark.textGap / ZOOM, 9);
        for (const t of letters) {
          expect(across(t.at)).toBeCloseTo(0, 9);
          expect(t).toMatchObject({ size: mark.textSize, rotation: 0, align: "center", font: style.font, color: mark.ink });
        }
        expect(new Set(ps.map((p) => p.color))).toEqual(new Set([mark.ink]));
      }
    }
  });

  it("a section's letter is its own", () => {
    const doc = withCommands(roomDoc(), ACROSS, section({ x: 1, y: 1 }, { x: 5, y: 1 }));
    expect(texts(marks(doc)).map((t) => t.text)).toEqual(["A", "A", "B", "B"]);
  });

  it("thick ends never pass each other on a short line, which then has no thin line", () => {
    const doc = withCommands(roomDoc(), section({ x: 1, y: 2 }, { x: 1.5, y: 2 }));
    const zoom = 20; // 14 px is 0.7 m here, on a 0.5 m line
    const { mark } = CANVAS_STYLE;
    expect(mark.end / zoom).toBeGreaterThan(0.25); // the fixture changes the answer
    const ps = marks(doc, CANVAS_STYLE, zoom);
    expect(segments(ps).filter((s) => s.dash !== undefined)).toEqual([]);
    const thick = segments(ps).filter((s) => px(s) === mark.thick);
    expect(thick).toHaveLength(2);
    for (const s of thick) expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeCloseTo(0.25, 9);
  });

  it("a selected section draws in the selected colour, the others in ink, on the canvas's layer too", () => {
    const doc = withCommands(roomDoc(), ACROSS, section({ x: 1, y: 1 }, { x: 5, y: 1 }));
    const { mark } = CANVAS_STYLE;
    expect(mark.selected).not.toBe(mark.ink);
    const colourOf = (ps: readonly Primitive[], letter: string) => texts(ps).find((t) => t.text === letter)?.color;
    const direct = marks(doc, CANVAS_STYLE, ZOOM, idsKey(["B"]));
    expect([colourOf(direct, "A"), colourOf(direct, "B")]).toEqual([mark.ink, mark.selected]);
    expect(new Set(direct.slice(direct.length / 2).map((p) => p.color))).toEqual(new Set([mark.selected]));

    const shell = FakeShell.withDocument(doc);
    const scene = buildScene({ ...shell.state, selection: [{ table: "sections", id: "A" }, { table: "walls", id: "B" }] });
    const drawn = sceneLayer(scene, "marks");
    expect([colourOf(drawn, "A"), colourOf(drawn, "B")]).toEqual([mark.selected, mark.ink]);
  });

  it("paper takes the set's accent, as dimensions do", () => {
    const accent = "#0a7d3c";
    const doc = withCommands(roomDoc(), ACROSS, { type: "setProjectField", key: "accent", value: accent });
    const style = presentationStyle(doc);
    expect(style).not.toBe(PRESENTATION_STYLE); // the fixture changes the answer
    expect(new Set(marks(doc, style).map((p) => p.color))).toEqual(new Set([accent]));
  });
});

describe("a project with no sections", () => {
  it("a project with no sections gives the frozen plan", () => {
    // plan-unchanged.test.ts compares the picture with the committed snapshot; here, why nothing can differ.
    const empty = marks(roomDoc());
    expect(empty).toEqual([]);
    expect(marks(labelledDoc(), PRESENTATION_STYLE, 20, "x")).toBe(empty); // the shared array: the GPU encoder compares identity
    const doc = roomDoc();
    const picture = planPicture(doc, floorView(doc, "s0"), CANVAS_STYLE, ZOOM, true);
    expect(picture.marks).toBe(empty);
    expect(markedBounds(doc, "s0")).toEqual(pictureBounds(doc, "s0"));
  });

  it("deleting the last section gives the shared array back", () => {
    const empty = marks(roomDoc());
    const doc = withCommands(roomDoc(), ACROSS);
    expect(marks(doc).length).toBeGreaterThan(0);
    expect(marks(withCommands(doc, { type: "deleteEntities", ids: [{ table: "sections", id: "A" }] }))).toBe(empty);
  });

  it("the scene's layer keeps one array across edits, so no renderer uploads it", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const before = sceneLayer(shell.scene(), "marks");
    expect(before).toEqual([]);
    const edited = withCommands(roomDoc(), { type: "setCeiling", height: 3 });
    expect(sceneLayer(FakeShell.withDocument(edited).scene(), "marks")).toBe(before);
  });
});

describe("the scene's marks layer", () => {
  it("keeps its array over a pan and redraws on a zoom", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), ACROSS));
    const before = sceneLayer(shell.scene(), "marks");
    expect(before.length).toBeGreaterThan(0);
    shell.wheel(40, 25);
    expect(sceneLayer(shell.scene(), "marks")).toBe(before);
    shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom: shell.state.camera.zoom * 2 } };
    expect(sceneLayer(shell.scene(), "marks")).not.toBe(before);
  });

  it("marks draw at every level", () => {
    const doc = withCommands(loftRoomDoc(), ACROSS, { type: "addDimension", opId: "dim", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 });
    const floorShell = FakeShell.withDocument(doc);
    const loftShell = FakeShell.withDocument(doc);
    loftShell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    expect(sceneLayer(floorShell.scene(), "dimensions").length).toBeGreaterThan(0);
    expect(sceneLayer(loftShell.scene(), "dimensions")).toEqual([]); // really the upper level: its dimensions are hidden
    const atFloor = sceneLayer(floorShell.scene(), "marks");
    expect(atFloor.length).toBeGreaterThan(0);
    expect(sceneLayer(loftShell.scene(), "marks")).toEqual(atFloor);

    const paper = (level: ReturnType<typeof levelOf>) => planPicture(doc, viewAt("s0", level), PRESENTATION_STYLE, 20, true);
    const floor = paper(levelOf(doc, null));
    const loft = paper(levelOf(doc, LOFT_ROOM_LOFT));
    expect(loft.dimensions).toEqual([]);
    expect(floor.marks.length).toBeGreaterThan(0);
    expect(loft.marks).toEqual(floor.marks);
  });

  it("draw over the dimensions, last of the picture", () => {
    const doc = withCommands(roomDoc(), ACROSS, { type: "addDimension", opId: "dim", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, offset: -0.5 });
    const picture = planPicture(doc, floorView(doc, "s0"), PRESENTATION_STYLE, 20, true);
    expect(picture.dimensions.length).toBeGreaterThan(0);
    expect(picture.marks.length).toBeGreaterThan(0);
    const all = pictureLayers(picture);
    expect(all.slice(-picture.marks.length - picture.dimensions.length)).toEqual([...picture.dimensions, ...picture.marks]);
  });
});

// Past the walls every way: roomDoc's frame ends at x −0.6 to 6.6, y −0.6 to 4.6. C's arrows point away from the plan.
const FAR: readonly Command[] = [section({ x: -3, y: 2 }, { x: 9, y: 2 }), section({ x: 3, y: 7 }, { x: 3, y: -2 }), section({ x: 0, y: -3 }, { x: 6, y: -3 }, -1)];
const farDoc = (doc: Document = roomDoc()): Document => withCommands(doc, ...FAR);

function exported(doc: Document, format: "svg" | "png"): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "openExport" });
  shell.ui({ type: "download", format });
  return shell;
}

describe("what makes room for the marks", () => {
  it("PNG and look make room for a mark past the walls; a sheet's framing and fit don't move when a section is added", () => {
    const doc = farDoc();
    const plain = pictureBounds(doc, "s0");
    const frame = markedBounds(doc, "s0");
    expect(frame.min.x).toBeLessThan(plain.min.x);
    expect(frame.max.x).toBeGreaterThan(plain.max.x);
    expect(frame.min.y).toBeLessThan(plain.min.y);
    expect(frame.max.y).toBeGreaterThan(plain.max.y);
    expectInside(marks(doc, presentationStyle(doc), 10), 10, frame);

    const before = roomDoc();
    const opts = { projectName: "P", paper: "A4" as const, scale: "fit" as const, host: new FakeHost(), finishes: false };
    expect(sheetBounds(doc)).toEqual(sheetBounds(before));
    expect(planSize(doc)).toEqual(planSize(before));
    expect(sheetFitScale(doc, "A4")).toBe(sheetFitScale(before, "A4"));
    expect(drawnBounds(doc, "s0")).toEqual(drawnBounds(before, "s0"));
    const [was] = sheetPages(before, opts).pages;
    const [now] = sheetPages(doc, opts).pages;
    if (!was || !now) throw new Error("no page");
    const seen = new Set(now.primitives.map((p) => JSON.stringify(p)));
    expect(was.primitives.length).toBeGreaterThan(0);
    for (const p of was.primitives) expect(seen.has(JSON.stringify(p))).toBe(true); // nothing that was drawn moved
    expect(now.primitives.length).toBe(was.primitives.length + marks(doc, presentationStyle(doc), 10).length);
  });

  it("a section inside the frame leaves it as it was", () => {
    const doc = withCommands(roomDoc(), ACROSS);
    expect(markedBounds(doc, "s0")).toEqual(pictureBounds(doc, "s0"));
  });

  it("the frame takes the room on each side alone", () => {
    const base = pictureBounds(roomDoc(), "s0");
    const framed = (c: Command) => markedBounds(withCommands(roomDoc(), c), "s0");
    expect(framed(section({ x: -3, y: 2 }, { x: 1, y: 2 }))).toEqual({ min: { x: -3.5, y: base.min.y }, max: base.max });
    expect(framed(section({ x: 5, y: 2 }, { x: 9, y: 2 }))).toEqual({ min: base.min, max: { x: 9.5, y: base.max.y } });
    expect(framed(section({ x: 2, y: -3 }, { x: 2, y: 1 }))).toEqual({ min: { x: base.min.x, y: -3.5 }, max: base.max });
    expect(framed(section({ x: 2, y: 3 }, { x: 2, y: 7 }))).toEqual({ min: base.min, max: { x: base.max.x, y: 7.5 } });
  });
});

describe("where the marks print", () => {
  it("the SVG holds them, framed to take them in", () => {
    const doc = farDoc();
    const [save] = exported(doc, "svg").effectsOf("saveFile");
    if (save?.content.kind !== "svg") throw new Error("not an svg");
    const { primitives, frame } = save.content;
    const drawn = marks(doc, presentationStyle(doc), frame.zoom);
    expect(texts(primitives).filter((t) => t.text === "A")).toHaveLength(2);
    expect(primitives.slice(-drawn.length)).toEqual([...drawn]);
    expect({ min: frame.min, max: frame.max }).toEqual(markedBounds(doc, "s0"));
    expectInside(drawn, frame.zoom, frame);
  });

  it("the PNG's page holds them, and is larger for them", () => {
    const doc = farDoc();
    const [ask] = exported(doc, "png").effectsOf("rasterise");
    const [was] = exported(roomDoc(), "png").effectsOf("rasterise");
    if (!ask || !was) throw new Error("no raster");
    const { min, max } = markedBounds(doc, "s0");
    expect(ask.page.widthMm).toBeCloseTo((max.x - min.x) * 10, 9);
    expect(ask.page.widthMm).toBeGreaterThan(was.page.widthMm);
    expect(ask.page.heightMm).toBeGreaterThan(was.page.heightMm);
    const placed = marks(doc, presentationStyle(doc), 10).map((p) => toPage(p, 10, -min.x * 10, -min.y * 10));
    expect(ask.page.primitives.slice(-placed.length)).toEqual(placed);
    for (const p of placed) {
      for (const q of reach(p, 1)) {
        expect(q.x).toBeGreaterThanOrEqual(0);
        expect(q.x).toBeLessThanOrEqual(ask.page.widthMm);
        expect(q.y).toBeGreaterThanOrEqual(0);
        expect(q.y).toBeLessThanOrEqual(ask.page.heightMm);
      }
    }
  });

  it("look holds them under its rulers, framed to take them in", () => {
    const doc = farDoc();
    const look = lookPicture(doc, null);
    if ("refused" in look) throw new Error(look.refused);
    const drawn = marks(doc, LOOK_STYLE, look.frame.zoom);
    expect({ min: look.frame.min, max: look.frame.max }).toEqual(markedBounds(doc, null));
    expectInside(drawn, look.frame.zoom, look.frame);
    const i = look.primitives.findIndex((p) => p === drawn[0]);
    expect(i).toBeGreaterThan(0);
    expect(look.primitives.slice(i, i + drawn.length)).toEqual([...drawn]);
    expect(look.primitives.length).toBeGreaterThan(i + drawn.length); // the rulers stay on top
  });

  it("look has something to show with only a section", () => {
    const only = withCommands(emptyDocument(), section({ x: 0, y: 0 }, { x: 2, y: 0 }));
    const look = lookPicture(only, null);
    if ("refused" in look) throw new Error(look.refused);
    expect(texts(look.primitives).filter((t) => t.text === "A")).toHaveLength(2);
  });

  it("a plan sheet prints them inside its clip, and may crop them", () => {
    const doc = withCommands(roomDoc(), ACROSS);
    const [page] = sheetPages(doc, { projectName: "P", paper: "A4", scale: "fit", host: new FakeHost(), finishes: false }).pages;
    if (!page) throw new Error("no page");
    const clip = page.clips?.[0];
    if (!clip) throw new Error("no clip");
    const letters = page.primitives.flatMap((p, i) => (p.kind === "text" && p.text === "A" ? [i] : []));
    expect(letters).toHaveLength(2);
    for (const i of letters) expect(i).toBeLessThan(clip.to);
  });

  it("a cover and a compare sheet print them too", () => {
    const add = (opId: string, kind: "cover" | "compare", drawings: readonly { layout: string; deck: string | null }[]): Command => ({ type: "addSheet", opId, after: null, kind, title: "T", drawings });
    const doc = withCommands(roomDoc(), ACROSS, { type: "addState", opId: "n", name: "Night" }, add("c", "cover", [{ layout: "s0", deck: null }]), add("m", "compare", [{ layout: "s0", deck: null }, { layout: "n/s0", deck: null }]));
    const set = sheetSet(doc, { projectName: "P", paper: "A3", scale: 50, host: new FakeHost(), finishes: false });
    const letters = (id: string): number => {
      const sheet = sheetsOf(doc).find((s) => s.id === id);
      if (!sheet) throw new Error(`no sheet ${id}`);
      return pagesOf(doc, sheet, set).flatMap((p) => texts(p.primitives)).filter((t) => t.text === "A").length;
    };
    expect(letters("c/t0")).toBe(2);
    expect(letters("m/t0")).toBe(4); // two panes
  });
});

describe("the viewer's switch for section marks (section.59)", () => {
  const P_ = (x: number, y: number) => ({ x, y });
  const two: Command[] = [{ type: "addSection", a: P_(-1, 2), b: P_(7, 2), side: 1 }, { type: "addSection", a: P_(-1, 1), b: P_(7, 1), side: 1 }];
  const shellWithTwo = (): FakeShell => FakeShell.withDocument(withCommands(roomDoc(), ...two));
  const texts = (shell: FakeShell): string[] => sceneLayer(shell.scene(), "marks").flatMap((p) => (p.kind === "text" ? [p.text] : []));
  const off = (shell: FakeShell): void => shell.ui({ type: "setSectionMarks", on: false });

  it("is on at first, and the view offers it only with a section to hide", () => {
    expect(shellWithTwo().view().sectionMarks).toBe(true);
    expect(FakeShell.withDocument(roomDoc()).view().sectionMarks).toBeNull();
  });

  it("off hides the marks on screen", () => {
    const shell = shellWithTwo();
    expect(texts(shell)).toEqual(["A", "A", "B", "B"]);
    off(shell);
    expect(shell.view().sectionMarks).toBe(false);
    expect(sceneLayer(shell.scene(), "marks")).toEqual([]);
  });

  it("on shows them again", () => {
    const shell = shellWithTwo();
    off(shell);
    shell.ui({ type: "setSectionMarks", on: true });
    expect(texts(shell)).toEqual(["A", "A", "B", "B"]);
  });

  it("a hidden mark can't be hit or hovered", () => {
    const shell = shellWithTwo();
    off(shell);
    shell.moveTo(P_(3, 2));
    expect(shell.state.hover?.table).not.toBe("sections");
    shell.click(P_(3, 2));
    expect(shell.state.selection.some((r) => r.table === "sections")).toBe(false);
    expect(shell.view().sectionStrip).toBeNull();
  });

  it("the selected section stays drawn, alone, and deselecting hides it", () => {
    const shell = shellWithTwo();
    shell.click(P_(3, 2));
    off(shell);
    expect(texts(shell)).toEqual(["A", "A"]);
    expect(shell.view().sectionStrip?.section).toBe("A");
    shell.key("Escape");
    expect(sceneLayer(shell.scene(), "marks")).toEqual([]);
  });

  it("a frame's letter shows the section it selects", () => {
    const shell = shellWithTwo();
    shell.click(P_(3, 2));
    off(shell);
    shell.ui({ type: "showSection", section: "B" });
    expect(texts(shell)).toEqual(["B", "B"]);
  });

  it("picking the Section tool turns them on, by key or by button", () => {
    const byKey = shellWithTwo();
    off(byKey);
    byKey.key("s");
    expect(byKey.view().sectionMarks).toBe(true);
    const byButton = shellWithTwo();
    off(byButton);
    byButton.ui({ type: "pickTool", tool: "section" });
    expect(byButton.view().sectionMarks).toBe(true);
  });

  it("paper keeps them, and nothing is sent or undone", () => {
    const r = FakeRemote.open(withCommands(roomDoc(), ...two));
    const past = r.shell.state.undo.past.length;
    r.shell.ui({ type: "setSectionMarks", on: false });
    expect(r.submits()).toEqual([]);
    expect(r.shell.state.undo.past.length).toBe(past);
    const doc = r.shell.doc();
    const picture = planPicture(doc, viewAt("s0", levelOf(doc, null)), PRESENTATION_STYLE, 1, false);
    expect(picture.marks.length).toBeGreaterThan(0);
  });
});

describe("a sheet's tick for section marks (section.60)", () => {
  const SHEET = "p/t0";
  const letters = (doc: Document, id = SHEET): string[] => {
    const sheet = sheetsOf(doc).find((s) => s.id === id);
    if (!sheet) throw new Error("no sheet");
    const set = sheetSet(doc, { projectName: "Flat", paper: "A3", scale: 50, host: new FakeHost(), finishes: true });
    return pagesOf(doc, sheet, set).flatMap((page) => page.primitives.flatMap((p) => (p.kind === "text" && p.text === "A" ? [p.text] : [])));
  };
  const withKind = (kind: "plan" | "compare" | "cover", drawings: { layout: string; deck: null }[]): Document =>
    withCommands(roomDoc(), ACROSS, { type: "addState", opId: "n", name: "Night" }, { type: "addSheet", opId: "p", after: null, kind, title: "P", drawings });

  it.each([
    ["a plan", "plan", [{ layout: "s0", deck: null }], 2],
    ["a compare", "compare", [{ layout: "s0", deck: null }, { layout: "n/s0", deck: null }], 4],
    ["a cover", "cover", [{ layout: "s0", deck: null }], 2],
  ] as const)("%s sheet prints them by default, and leaves them off when asked", (_name, kind, drawings, count) => {
    const doc = withKind(kind, [...drawings]);
    expect(letters(doc)).toHaveLength(count);
    expect(letters(withCommands(doc, { type: "setSheet", sheetId: SHEET, marks: false }))).toEqual([]);
  });

  it("leaves everything else on the page where it was", () => {
    const doc = withKind("plan", [{ layout: "s0", deck: null }]);
    const off = withCommands(doc, { type: "setSheet", sheetId: SHEET, marks: false });
    const pages = (d: Document) => {
      const sheet = sheetsOf(d).find((s) => s.id === SHEET);
      if (!sheet) throw new Error("no sheet");
      return pagesOf(d, sheet, sheetSet(d, { projectName: "Flat", paper: "A3", scale: 50, host: new FakeHost(), finishes: true }));
    };
    const [on, without] = [pages(doc)[0], pages(off)[0]];
    const inkOf = PRESENTATION_STYLE.mark.ink;
    expect(without?.primitives.length).toBeLessThan(on?.primitives.length ?? 0);
    expect(without?.primitives).toEqual(expect.arrayContaining((on?.primitives ?? []).filter((p) => p.color !== inkOf && !(p.kind === "text" && p.text === "A")).slice(0, 40)));
  });

  it("the row says so, and a copy keeps it", () => {
    const doc = withCommands(withKind("plan", [{ layout: "s0", deck: null }]), { type: "setSheet", sheetId: SHEET, marks: false });
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "openExport" });
    expect(shell.view().sheetsView?.sheets.find((s) => s.id === SHEET)?.marks).toBe(false);
    shell.ui({ type: "duplicateSheet", id: SHEET });
    const copies = sheetsOf(shell.doc()).filter((s) => s.kind === "plan" && s.id !== SHEET && s.marks === false);
    expect(copies).toHaveLength(1);
  });
});
