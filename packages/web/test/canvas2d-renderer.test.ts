import { afterEach, describe, expect, it, vi } from "vitest";
import { COLORS, type ExportPage, type Primitive, type Scene, type SceneUnderlay } from "@fm/editor";
import { FakeShell, donutDoc, withCommands } from "@fm/editor/testing";
import { backingSize, createPictureCache, drawPrimitive, drawPrimitives, drawScene, drawTextOverlay, type DrawContext } from "../src/adapters/canvas2d-renderer";
import { drawPage } from "../src/adapters/rasterise";
import { cameraFixture, sceneFixture } from "./fixtures";

const f = (n: number): string => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);

/** Records drawing calls with the style in effect at each fill or stroke; an alpha other than 1 is recorded too. */
export class RecordingContext implements DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  font = "10px sans-serif";
  fontKerning: CanvasFontKerning = "auto";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  globalAlpha = 1;
  readonly calls: string[] = [];
  private dash: number[] = [];
  private readonly saved: number[] = [];
  private alpha(): string {
    return this.globalAlpha === 1 ? "" : ` alpha=${f(this.globalAlpha)}`;
  }

  beginPath(): void {
    this.calls.push("beginPath");
  }
  closePath(): void {
    this.calls.push("closePath");
  }
  moveTo(x: number, y: number): void {
    this.calls.push(`moveTo ${f(x)} ${f(y)}`);
  }
  lineTo(x: number, y: number): void {
    this.calls.push(`lineTo ${f(x)} ${f(y)}`);
  }
  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    this.calls.push(`arc ${f(x)} ${f(y)} ${f(r)} ${f(start)} ${f(end)} ${ccw ? "ccw" : "cw"}`);
  }
  fill(rule?: CanvasFillRule): void {
    this.calls.push(`fill ${String(this.fillStyle)}${rule === undefined ? "" : ` ${rule}`}${this.alpha()}`);
  }
  stroke(): void {
    this.calls.push(`stroke ${String(this.strokeStyle)} w=${f(this.lineWidth)} cap=${this.lineCap} dash=[${this.dash.join(",")}]${this.alpha()}`);
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push(
      `fillText "${text}" ${f(x)} ${f(y)} font=${this.font} kerning=${this.fontKerning} align=${this.textAlign} baseline=${this.textBaseline} color=${String(this.fillStyle)}${this.alpha()}`,
    );
  }
  setLineDash(segments: number[]): void {
    this.dash = [...segments];
  }
  save(): void {
    this.saved.push(this.globalAlpha);
    this.calls.push("save");
  }
  restore(): void {
    this.globalAlpha = this.saved.pop() ?? this.globalAlpha;
    this.calls.push("restore");
  }
  translate(x: number, y: number): void {
    this.calls.push(`translate ${f(x)} ${f(y)}`);
  }
  rotate(angle: number): void {
    this.calls.push(`rotate ${f(angle)}`);
  }
  scale(x: number, y: number): void {
    this.calls.push(`scale ${f(x)} ${f(y)}`);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`rect ${f(x)} ${f(y)} ${f(w)} ${f(h)}`);
  }
  clip(): void {
    this.calls.push("clip");
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect ${f(x)} ${f(y)} ${f(w)} ${f(h)} ${String(this.fillStyle)}`);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`clearRect ${f(x)} ${f(y)} ${f(w)} ${f(h)}`);
  }
  drawImage(_image: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    this.calls.push(`drawImage ${f(x)} ${f(y)} ${f(w)} ${f(h)} alpha=${f(this.globalAlpha)}`);
  }
}

function draw(p: Primitive): string[] {
  const ctx = new RecordingContext();
  drawPrimitive(ctx, p, cameraFixture);
  return ctx.calls;
}

describe("drawPrimitive", () => {
  it("strokes a segment with a world-scaled width", () => {
    const calls = draw({ kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0.5 }, width: { m: 0.2 }, color: "#111111", cap: "butt" });
    expect(calls).toEqual(["beginPath", "moveTo 100.00 50.00", "lineTo 200.00 0.00", "stroke #111111 w=20.00 cap=butt dash=[]"]);
  });

  it("strokes a dashed hairline with a screen width", () => {
    const calls = draw({
      kind: "segment",
      a: { x: 0, y: 0 },
      b: { x: 0, y: 1 },
      width: { px: 1 },
      color: "#2f6fed",
      cap: "round",
      dash: [4, 2],
    });
    expect(calls).toEqual(["beginPath", "moveTo 100.00 50.00", "lineTo 100.00 -50.00", "stroke #2f6fed w=1.00 cap=round dash=[4,2]"]);
  });

  it("does not leak a dash into the next segment", () => {
    const ctx = new RecordingContext();
    drawPrimitive(ctx, { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt", dash: [4, 2] }, cameraFixture);
    drawPrimitive(ctx, { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt" }, cameraFixture);
    expect(ctx.calls.at(-1)).toBe("stroke #000000 w=1.00 cap=butt dash=[]");
  });

  it("fills a polygon and skips degenerate ones", () => {
    const calls = draw({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], holes: [], color: "#eeeeee" });
    expect(calls).toEqual(["beginPath", "moveTo 100.00 50.00", "lineTo 200.00 50.00", "lineTo 100.00 -50.00", "closePath", "fill #eeeeee"]);
    expect(draw({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], holes: [], color: "#eeeeee" })).toEqual([]);
  });

  it("fills a polygon with a hole as one path, one subpath per ring, even-odd", () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const hole = [{ x: 0.25, y: 0.25 }, { x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 }, { x: 0.75, y: 0.25 }];
    const calls = draw({ kind: "polygon", points, holes: [hole], color: "#eeeeee" });
    // Holes with fewer than 3 points are skipped.
    expect(draw({ kind: "polygon", points, holes: [hole, [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }], []], color: "#eeeeee" })).toEqual(calls);
    expect(calls).toEqual([
      "beginPath",
      "moveTo 100.00 50.00",
      "lineTo 200.00 50.00",
      "lineTo 200.00 -50.00",
      "lineTo 100.00 -50.00",
      "closePath",
      "moveTo 125.00 25.00",
      "lineTo 125.00 -25.00",
      "lineTo 175.00 -25.00",
      "lineTo 175.00 25.00",
      "closePath",
      "fill #eeeeee evenodd",
    ]);
  });

  it("draws the donut's floor as two subpaths filled even-odd (AC-07)", () => {
    const shell = FakeShell.withDocument(withCommands(donutDoc(), { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Living", finish: null }));
    const fills = shell.scene().layers.find((l) => l.name === "zoneFills")?.primitives ?? [];
    expect(fills).toHaveLength(1);
    const [floor] = fills;
    if (!floor) throw new Error("no floor");
    const calls = draw(floor);
    expect(calls.filter((c) => c.startsWith("moveTo"))).toHaveLength(2);
    expect(calls.filter((c) => c === "closePath")).toHaveLength(2);
    expect(calls.at(-1)).toBe(`fill ${COLORS.zoneFill} evenodd`);
  });

  it("fills a disc with a screen radius", () => {
    const calls = draw({ kind: "disc", center: { x: 1, y: 0 }, radius: { px: 5 }, color: "#2f6fed" });
    expect(calls).toEqual(["beginPath", "arc 200.00 50.00 5.00 0.00 6.28 cw", "fill #2f6fed"]);
  });

  it("strokes a world arc counter-clockwise with flipped angles", () => {
    const calls = draw({ kind: "arc", center: { x: 0, y: 0 }, radius: 0.5, from: 0, to: Math.PI / 2, width: { px: 1 }, color: "#444444" });
    expect(calls).toEqual(["beginPath", "arc 100.00 50.00 50.00 0.00 -1.57 ccw", "stroke #444444 w=1.00 cap=butt dash=[]"]);
  });

  it("draws a bold or oblique text in that face of its font", () => {
    const drawn = (style: "bold" | "oblique") => draw({ kind: "text", text: "Kitchen", at: { x: 1, y: 0 }, size: 12, color: "#333333", align: "left", rotation: 0, font: "helvetica", style }).join(" ");
    expect(drawn("bold")).toContain("font=bold 12px Helvetica, Arial, sans-serif");
    expect(drawn("oblique")).toContain("font=italic 12px Helvetica, Arial, sans-serif");
  });

  it("draws upright text centred on its anchor with the UI font", () => {
    const calls = draw({ kind: "text", text: "Kitchen", at: { x: 1, y: 0 }, size: 12, color: "#333333", align: "center", rotation: 0, font: "inter" });
    expect(calls).toEqual([
      "save",
      "translate 200.00 50.00",
      `fillText "Kitchen" 0.00 0.00 font=12px Inter, sans-serif kerning=auto align=center baseline=middle color=#333333`,
      "restore",
    ]);
  });

  it("rotates text by the negated world angle", () => {
    const calls = draw({ kind: "text", text: "3.50", at: { x: 0, y: 0 }, size: 11, color: "#333333", align: "left", rotation: Math.PI / 2, font: "inter" });
    expect(calls.slice(0, 3)).toEqual(["save", "translate 100.00 50.00", "rotate -1.57"]);
  });
});

function withPrimitives(scene: Scene, byLayer: Partial<Record<string, Primitive[]>>): Scene {
  return { ...scene, layers: scene.layers.map((layer) => ({ ...layer, primitives: byLayer[layer.name] ?? [] })) };
}

describe("drawScene", () => {
  const gridLine: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#dddddd", cap: "butt" };
  const wall: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], holes: [], color: "#222222" };
  const cursor: Primitive = { kind: "disc", center: { x: 0, y: 0 }, radius: { px: 4 }, color: "#e67e22" };

  it("scales by dpr, fills the background, then draws layers in order", () => {
    const ctx = new RecordingContext();
    // Layers are listed out of their natural order to show that scene order, not input order, is what matters.
    drawScene(ctx, withPrimitives(sceneFixture(), { presence: [cursor], walls: [wall], grid: [gridLine] }), cameraFixture);
    expect(ctx.calls.slice(0, 3)).toEqual(["save", "scale 2.00 2.00", `fillRect 0.00 0.00 200.00 100.00 ${COLORS.background}`]);
    const gridAt = ctx.calls.indexOf("stroke #dddddd w=1.00 cap=butt dash=[]");
    const wallAt = ctx.calls.indexOf("fill #222222");
    const cursorAt = ctx.calls.indexOf("fill #e67e22");
    expect(gridAt).toBeGreaterThan(2);
    expect(wallAt).toBeGreaterThan(gridAt);
    expect(cursorAt).toBeGreaterThan(wallAt);
    expect(ctx.calls.at(-1)).toBe("restore");
  });

  it("draws the openings layer after the walls and the warnings before them (spec: layouts)", () => {
    const ctx = new RecordingContext();
    const gap: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], holes: [], color: COLORS.openingFloor };
    const warning: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], holes: [], color: "#ff9900" };
    drawScene(ctx, withPrimitives(sceneFixture(), { openings: [gap], walls: [wall], warnings: [warning] }), cameraFixture);
    const wallAt = ctx.calls.indexOf("fill #222222");
    expect(ctx.calls.indexOf(`fill ${COLORS.openingFloor}`)).toBeGreaterThan(wallAt);
    expect(ctx.calls.indexOf("fill #ff9900")).toBeLessThan(wallAt);
    expect(ctx.calls.indexOf("fill #ff9900")).toBeGreaterThan(2);
  });

  it("draws the dimensions layer after the tags and before the annotations", () => {
    const ctx = new RecordingContext();
    const plate: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], holes: [], color: "#aaaaaa" };
    const line: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#b3261e", cap: "butt" };
    const helper: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#0f766e", cap: "butt" };
    drawScene(ctx, withPrimitives(sceneFixture(), { annotations: [helper], dimensions: [line], tags: [plate] }), cameraFixture);
    const tagAt = ctx.calls.indexOf("fill #aaaaaa");
    const dimensionAt = ctx.calls.indexOf("stroke #b3261e w=1.00 cap=butt dash=[]");
    const annotationAt = ctx.calls.indexOf("stroke #0f766e w=1.00 cap=butt dash=[]");
    expect(tagAt).toBeGreaterThan(2);
    expect(dimensionAt).toBeGreaterThan(tagAt);
    expect(annotationAt).toBeGreaterThan(dimensionAt);
  });

  it("draws only the background for an empty scene", () => {
    const ctx = new RecordingContext();
    drawScene(ctx, sceneFixture(), cameraFixture);
    expect(ctx.calls).toEqual(["save", "scale 2.00 2.00", `fillRect 0.00 0.00 200.00 100.00 ${COLORS.background}`, "restore"]);
  });
});

describe("drawPrimitives batches strokes (finishes: thousands of floor joints per layer)", () => {
  const seg = (y: number, more: Partial<Extract<Primitive, { kind: "segment" }>> = {}): Primitive =>
    ({ kind: "segment", a: { x: 0, y }, b: { x: 1, y }, width: { px: 0.75 }, color: "#806040", cap: "butt", ...more });
  const drawAll = (ps: readonly Primitive[]): string[] => {
    const ctx = new RecordingContext();
    drawPrimitives(ctx, ps, cameraFixture);
    return ctx.calls;
  };

  it("strokes consecutive opaque, undashed segments of one colour, width and cap as one path", () => {
    expect(drawAll([seg(0), seg(0.1), seg(0.2)])).toEqual([
      "beginPath",
      "moveTo 100.00 50.00", "lineTo 200.00 50.00",
      "moveTo 100.00 40.00", "lineTo 200.00 40.00",
      "moveTo 100.00 30.00", "lineTo 200.00 30.00",
      "stroke #806040 w=0.75 cap=butt dash=[]",
    ]);
  });

  it("starts a new path at a change of colour, width, cap or kind", () => {
    const strokes = (ps: readonly Primitive[]): number => drawAll(ps).filter((c) => c.startsWith("stroke")).length;
    expect(strokes([seg(0), seg(0.1, { color: "#000000" }), seg(0.2)])).toBe(3);
    expect(strokes([seg(0), seg(0.1, { width: { px: 1 } }), seg(0.2)])).toBe(3);
    expect(strokes([seg(0), seg(0.1, { width: { m: 0.0075 } })])).toBe(2); // the same 0.75 px at zoom 100, but a different kind of width
    expect(strokes([seg(0), seg(0.1, { width: { m: 0.75 } })])).toBe(2); // the same number, a different kind
    expect(strokes([seg(0), seg(0.1, { cap: "round" })])).toBe(2);
    const disc: Primitive = { kind: "disc", center: { x: 0, y: 0 }, radius: { px: 4 }, color: "#806040" };
    expect(strokes([seg(0), disc, seg(0.2)])).toBe(2);
  });

  it("strokes translucent and dashed segments one by one, as before", () => {
    const one = (p: Primitive): string[] => draw(p);
    const translucent = [seg(0, { color: "#80604080" }), seg(0.1, { color: "#80604080" })];
    expect(drawAll(translucent)).toEqual(translucent.flatMap(one));
    const dashed = [seg(0, { dash: [4, 2] }), seg(0.1, { dash: [4, 2] })];
    expect(drawAll(dashed)).toEqual(dashed.flatMap(one));
  });

  it("drawScene batches within a layer, never across layers", () => {
    const ctx = new RecordingContext();
    drawScene(ctx, withPrimitives(sceneFixture(), { finishes: [seg(0), seg(0.1)], zoneFills: [seg(0.2)] }), cameraFixture);
    expect(ctx.calls.filter((c) => c === "beginPath")).toHaveLength(2);
  });
});

const BACKGROUND_ONLY = ["save", "scale 2.00 2.00", `fillRect 0.00 0.00 200.00 100.00 ${COLORS.background}`, "restore"];
// Its natural size is not the rect's: the draw must stretch to the rect (import.11).
const stubPicture = { width: 999, height: 7 } as ImageBitmap;

describe("drawScene underlay", () => {
  const gridLine: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#dddddd", cap: "butt" };
  // Taller than wide, its top-left off centre: a y flip, a swapped alpha or a natural-size draw all show.
  const underlay: SceneUnderlay = { pictureId: "p1", data: "QUFB", rect: { minX: 0.3, minY: -0.45, maxX: 0.5, maxY: 0.15 }, fade: 0.3 };

  it("draws after the background and before the grid, stretched to its rect at alpha 1 − fade", () => {
    const ctx = new RecordingContext();
    drawScene(ctx, withPrimitives({ ...sceneFixture(), underlay }, { grid: [gridLine] }), cameraFixture, stubPicture);
    expect(ctx.calls.slice(3, 6)).toEqual(["save", "drawImage 130.00 35.00 20.00 60.00 alpha=0.70", "restore"]);
    // Recorded with no alpha suffix, so at alpha 1: the fade stays off the layers drawn after the picture.
    expect(ctx.calls.indexOf("stroke #dddddd w=1.00 cap=butt dash=[]")).toBeGreaterThan(5);
  });

  it("skips the underlay until its picture is loaded", () => {
    const ctx = new RecordingContext();
    drawScene(ctx, { ...sceneFixture(), underlay }, cameraFixture, null);
    expect(ctx.calls).toEqual(BACKGROUND_ONLY);
  });

  it("draws nothing when the scene has no underlay", () => {
    const ctx = new RecordingContext();
    drawScene(ctx, sceneFixture(), cameraFixture, stubPicture);
    expect(ctx.calls).toEqual(BACKGROUND_ONLY);
  });

  it("an imported picture lands at the view's top-left and follows the camera (FakeShell)", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "importUnderlay", result: { ok: true, data: "QUFB", width: 300, height: 500 } });
    shell.ui({ type: "setUnderlayFade", fade: 0.25 });
    const image = (camera: typeof shell.state.camera): string | undefined => {
      const ctx = new RecordingContext();
      drawScene(ctx, shell.scene(), camera, stubPicture);
      return ctx.calls.find((c) => c.startsWith("drawImage"));
    };
    expect(image(shell.state.camera)).toBe("drawImage 0.00 0.00 240.00 400.00 alpha=0.75");
    // Top-left world (−4.5, 7) at 0.01 m/px: centring the camera on the origin moves it right and up (y flips).
    expect(image({ ...shell.state.camera, center: { x: 0, y: 0 } })).toBe("drawImage 240.00 -160.00 240.00 400.00 alpha=0.75");
  });
});

describe("createPictureCache", () => {
  const picture = (pictureId: string): SceneUnderlay => ({ pictureId, data: pictureId === "u1" ? "QUFB" : "QkJC", rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, fade: 0.5 });
  const setup = () => {
    const loads: { src: string; onLoad: () => void; image: string }[] = [];
    let ready = 0;
    const cache = createPictureCache(
      (src, onLoad) => {
        const image = `image ${loads.length + 1}`;
        loads.push({ src, onLoad, image });
        return image;
      },
      () => {
        ready++;
      },
    );
    const fire = (i: number): void => loads[i]?.onLoad();
    return { loads, cache, fire, ready: () => ready };
  };

  it("loads a picture once per pictureId and returns it only after it loads", () => {
    const { loads, cache, fire, ready } = setup();
    const u1 = picture("u1");
    expect(cache.get(u1)).toBeNull();
    expect(loads.map((l) => l.src)).toEqual(["data:image/jpeg;base64,QUFB"]);
    expect(cache.get(u1)).toBeNull();
    expect(loads).toHaveLength(1);
    fire(0);
    expect(ready()).toBe(1);
    expect(cache.get(u1)).toBe("image 1");
  });

  it("a new pictureId replaces the old one; a late load of the old one is ignored", () => {
    const { loads, cache, fire, ready } = setup();
    const u2 = picture("u2");
    cache.get(picture("u1"));
    expect(cache.get(u2)).toBeNull();
    expect(loads).toHaveLength(2);
    fire(0);
    expect(ready()).toBe(0);
    expect(cache.get(u2)).toBeNull();
    fire(1);
    expect(ready()).toBe(1);
    expect(cache.get(u2)).toBe("image 2");
  });

  it("keeps the picture while the underlay is hidden or removed", () => {
    const { loads, cache, fire } = setup();
    const u1 = picture("u1");
    cache.get(u1);
    fire(0);
    expect(cache.get(null)).toBeNull();
    // Undo of Remove brings back the same pictureId, so it is not decoded again.
    expect(cache.get(u1)).toBe("image 1");
    expect(loads).toHaveLength(1);
  });

  it("after dispose a load never calls onReady", () => {
    const { cache, fire, ready } = setup();
    cache.get(picture("u1"));
    cache.dispose();
    fire(0);
    expect(ready()).toBe(0);
  });
});

describe("drawTextOverlay", () => {
  it("scales by dpr, clears to transparent, then draws the texts in order", () => {
    const ctx = new RecordingContext();
    const texts: Primitive[] = [
      { kind: "text", text: "Kitchen", at: { x: 1, y: 0 }, size: 12, color: "#333333", align: "center", rotation: 0, font: "inter" },
      { kind: "text", text: "Bob", at: { x: 0, y: 0 }, size: 11, color: "#0090ff", align: "left", rotation: 0, font: "inter" },
    ];
    drawTextOverlay(ctx, texts, cameraFixture);
    expect(ctx.calls.slice(0, 3)).toEqual(["save", "scale 2.00 2.00", "clearRect 0.00 0.00 200.00 100.00"]);
    const fills = ctx.calls.filter((c) => c.startsWith("fillText"));
    expect(fills).toHaveLength(2);
    expect(fills[0]).toContain('"Kitchen" 0.00 0.00');
    expect(fills[1]).toContain('"Bob" 0.00 0.00');
    expect(ctx.calls.indexOf("translate 200.00 50.00")).toBeLessThan(ctx.calls.indexOf("translate 100.00 50.00"));
    expect(ctx.calls.at(-1)).toBe("restore");
    expect(ctx.calls.some((c) => c.startsWith("fillRect"))).toBe(false);
  });
});

describe("backingSize", () => {
  it("multiplies the CSS size by the device pixel ratio", () => {
    expect(backingSize(cameraFixture)).toEqual({ width: 400, height: 200 });
  });

  it("rounds and never returns zero", () => {
    expect(backingSize({ ...cameraFixture, viewport: { width: 201, height: 0 }, dpr: 1.5 })).toEqual({ width: 302, height: 1 });
  });
});

describe("a dash is one pair (render.05, AC-05)", () => {
  it("passes the pair to setLineDash as given", () => {
    for (const dash of [[6, 4], [1.2, 0.8]] as const) {
      const ctx = new RecordingContext();
      drawPrimitive(ctx, { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#000000", cap: "butt", dash }, cameraFixture);
      expect(ctx.calls.at(-1)).toBe(`stroke #000000 w=1.00 cap=butt dash=[${dash.join(",")}]`);
    }
  });
});

describe("text draws the font it names (render.15, AC-01)", () => {
  it("Inter or Helvetica, without kerning, so the drawn width is the measured one", () => {
    // A frame turns kerning off once, outside each text's save(): the setter per text cost about 0.8 ms a frame (render.29).
    for (const [font, family] of [["inter", "Inter, sans-serif"], ["helvetica", "Helvetica, Arial, sans-serif"]] as const) {
      const den: Primitive = { kind: "text", text: "Den", at: { x: 0, y: 0 }, size: 2.5, color: "#1a1a1a", align: "center", rotation: 0, font };
      const scene = withPrimitives(sceneFixture(), { tags: [den] });
      const ctx = new RecordingContext();
      drawScene(ctx, scene, cameraFixture);
      expect(ctx.calls.find((c) => c.startsWith("fillText"))).toContain(`font=2.5px ${family} kerning=none`);
      const overlay = new RecordingContext();
      drawTextOverlay(overlay, [den], cameraFixture);
      expect(overlay.calls.find((c) => c.startsWith("fillText"))).toContain(`font=2.5px ${family} kerning=none`);
    }
  });
});

describe("drawPage clips (sheetset.17)", () => {
  // 100 × 50 mm at 200 × 100 px: 2 px per mm, and the page's y up becomes the canvas's y down.
  const size = { w: 200, h: 100 };
  const clip = { rect: { x: 10, y: 5, w: 20, h: 10 }, from: 1, to: 3 };
  const RECT = ["save", "beginPath", "rect 20.00 70.00 40.00 20.00", "clip"];
  const seg = (y: number): Primitive => ({ kind: "segment", a: { x: 0, y }, b: { x: 10, y }, width: { px: 0.5 }, color: "#111111", cap: "butt" });
  const den: Primitive = { kind: "text", text: "Den", at: { x: 15, y: 10 }, size: 2.5, color: "#1a1a1a", align: "left", rotation: 0, font: "helvetica" };
  const draw = (primitives: Primitive[], clips?: ExportPage["clips"]): string[] => {
    const ctx = new RecordingContext();
    drawPage(ctx, { widthMm: 100, heightMm: 50, primitives, ...(clips ? { clips } : {}) }, size);
    return ctx.calls;
  };
  const between = (calls: readonly string[], from: string, to: string): readonly string[] => calls.slice(calls.indexOf(from), calls.indexOf(to));

  it("a clip saves, clips and restores around its primitives", () => {
    const calls = draw([seg(0), den, seg(10), seg(20)], [clip]);
    const start = calls.indexOf("save");
    expect(calls.slice(start, start + 4)).toEqual(RECT);
    expect(calls.lastIndexOf("restore")).toBeGreaterThan(calls.indexOf("clip"));
    // Before the clip: the first segment. After the restore: the last. Inside: the text and the middle segment.
    expect(calls.slice(0, start)).toEqual(["beginPath", "moveTo 0.00 100.00", "lineTo 20.00 100.00", "stroke #111111 w=1.00 cap=butt dash=[]"]);
    expect(calls.slice(calls.lastIndexOf("restore") + 1)).toEqual(["beginPath", "moveTo 0.00 60.00", "lineTo 20.00 60.00", "stroke #111111 w=1.00 cap=butt dash=[]"]);
  });

  it("text in a clip draws inside it, in the same pass", () => {
    const calls = draw([seg(0), den, seg(10), seg(20)], [clip]);
    const texts = calls.findIndex((c) => c.startsWith("fillText"));
    expect(texts).toBeGreaterThan(calls.indexOf("clip"));
    expect(texts).toBeLessThan(calls.lastIndexOf("restore"));
  });

  it("a stroke run doesn't reach across a clip's edges", () => {
    const calls = draw([seg(0), seg(10), seg(20), seg(30)], [clip]);
    expect(calls.filter((c) => c.startsWith("stroke"))).toHaveLength(3);
    expect(between(calls, "clip", "restore").filter((c) => c.startsWith("moveTo"))).toEqual(["moveTo 0.00 80.00", "moveTo 0.00 60.00"]);
  });

  it("a live drag's shift moves what's inside the clip, and neither the clip nor what's outside it", () => {
    const ctx = new RecordingContext();
    drawPage(ctx, { widthMm: 100, heightMm: 50, primitives: [seg(0), den, seg(10), seg(20)], clips: [clip] }, size, { x: 30, y: -8 });
    const { calls } = ctx;
    const inside = between(calls, "clip", "restore");
    expect(calls.slice(calls.indexOf("save"), calls.indexOf("clip") + 1)).toEqual(RECT); // the frame stays put
    expect(inside[1]).toBe("translate 30.00 -8.00"); // before anything inside draws
    expect(calls.filter((c) => c === "translate 30.00 -8.00")).toHaveLength(1);
    expect(calls.slice(calls.lastIndexOf("restore")).find((c) => c.startsWith("moveTo"))).toBe("moveTo 0.00 60.00"); // the page's last segment, unmoved
  });

  it("with no shift, a page draws as it does on paper", () => {
    expect(between(draw([seg(0), den, seg(10), seg(20)], [clip]), "clip", "restore")[1]).not.toMatch(/^translate/);
  });

  it("no clips draws as before, with no save or clip", () => {
    expect(draw([seg(0), seg(10)])).toEqual(["beginPath", "moveTo 0.00 100.00", "lineTo 20.00 100.00", "moveTo 0.00 80.00", "lineTo 20.00 80.00", "stroke #111111 w=1.00 cap=butt dash=[]"]);
  });
});

describe("drawPage with an image", () => {
  afterEach(() => vi.unstubAllGlobals());

  const translucent: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [], color: "#ff000080" };
  const page: ExportPage = { widthMm: 100, heightMm: 50, primitives: [translucent], images: [{ rect: { x: 20, y: 30, w: 40, h: 10 }, jpeg: "drawpage" }] };

  it("paints it y down, above the primitives, with no alpha left over, at the size asked for", () => {
    const onload: (() => void)[] = [];
    vi.stubGlobal("Image", class {
      set onload(f: () => void) {
        onload.push(f);
      }
      src = "";
    });
    const ctx = new RecordingContext();
    drawPage(ctx, page, { w: 1000, h: 500 });
    expect(ctx.calls.some((c) => c.startsWith("drawImage"))).toBe(false);
    for (const f of onload) f();
    const images = ctx.calls.filter((c) => c.startsWith("drawImage"));
    expect(images).toEqual(["drawImage 200.00 100.00 400.00 100.00 alpha=1.00"]); // from the top: 500 − (30 + 10) × 10
    // Decoded now: this draw needs no wait, and comes after what it lies above.
    const again = new RecordingContext();
    drawPage(again, page, { w: 100, h: 50 });
    expect(again.calls.at(-1)).toBe("drawImage 20.00 10.00 40.00 10.00 alpha=1.00");
    expect(onload).toHaveLength(1);
  });

  it("a page with none builds no picture, so a test with no DOM can draw it", () => {
    const ctx = new RecordingContext();
    drawPage(ctx, { ...page, images: [] }, { w: 100, h: 50 });
    drawPage(ctx, { widthMm: 100, heightMm: 50, primitives: [translucent] }, { w: 100, h: 50 });
    expect(ctx.calls.some((c) => c.startsWith("drawImage"))).toBe(false);
  });
});
