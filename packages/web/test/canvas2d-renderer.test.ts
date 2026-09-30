import { describe, expect, it } from "vitest";
import { COLORS, UI_FONT, type Primitive, type Scene } from "@fm/editor";
import { backingSize, drawPrimitive, drawScene, drawTextOverlay, type DrawContext } from "../src/adapters/canvas2d-renderer";
import { cameraFixture, sceneFixture } from "./fixtures";

const f = (n: number): string => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);

/** Records drawing calls with the style in effect at each fill or stroke. */
export class RecordingContext implements DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  font = "10px sans-serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  readonly calls: string[] = [];
  private dash: number[] = [];

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
  fill(): void {
    this.calls.push(`fill ${String(this.fillStyle)}`);
  }
  stroke(): void {
    this.calls.push(`stroke ${String(this.strokeStyle)} w=${f(this.lineWidth)} cap=${this.lineCap} dash=[${this.dash.join(",")}]`);
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push(
      `fillText "${text}" ${f(x)} ${f(y)} font=${this.font} align=${this.textAlign} baseline=${this.textBaseline} color=${String(this.fillStyle)}`,
    );
  }
  setLineDash(segments: number[]): void {
    this.dash = [...segments];
  }
  save(): void {
    this.calls.push("save");
  }
  restore(): void {
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
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect ${f(x)} ${f(y)} ${f(w)} ${f(h)} ${String(this.fillStyle)}`);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`clearRect ${f(x)} ${f(y)} ${f(w)} ${f(h)}`);
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
    const calls = draw({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], color: "#eeeeee" });
    expect(calls).toEqual(["beginPath", "moveTo 100.00 50.00", "lineTo 200.00 50.00", "lineTo 100.00 -50.00", "closePath", "fill #eeeeee"]);
    expect(draw({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: "#eeeeee" })).toEqual([]);
  });

  it("fills a disc with a screen radius", () => {
    const calls = draw({ kind: "disc", center: { x: 1, y: 0 }, radius: { px: 5 }, color: "#2f6fed" });
    expect(calls).toEqual(["beginPath", "arc 200.00 50.00 5.00 0.00 6.28 cw", "fill #2f6fed"]);
  });

  it("strokes a world arc counter-clockwise with flipped angles", () => {
    const calls = draw({ kind: "arc", center: { x: 0, y: 0 }, radius: 0.5, from: 0, to: Math.PI / 2, width: { px: 1 }, color: "#444444" });
    expect(calls).toEqual(["beginPath", "arc 100.00 50.00 50.00 0.00 -1.57 ccw", "stroke #444444 w=1.00 cap=butt dash=[]"]);
  });

  it("draws upright text centred on its anchor with the UI font", () => {
    const calls = draw({ kind: "text", text: "Kitchen", at: { x: 1, y: 0 }, size: 12, color: "#333333", align: "center", rotation: 0 });
    expect(calls).toEqual([
      "save",
      "translate 200.00 50.00",
      `fillText "Kitchen" 0.00 0.00 font=12px ${UI_FONT} align=center baseline=middle color=#333333`,
      "restore",
    ]);
  });

  it("rotates text by the negated world angle", () => {
    const calls = draw({ kind: "text", text: "3.50", at: { x: 0, y: 0 }, size: 11, color: "#333333", align: "left", rotation: Math.PI / 2 });
    expect(calls.slice(0, 3)).toEqual(["save", "translate 100.00 50.00", "rotate -1.57"]);
  });
});

function withPrimitives(scene: Scene, byLayer: Partial<Record<string, Primitive[]>>): Scene {
  return { layers: scene.layers.map((layer) => ({ ...layer, primitives: byLayer[layer.name] ?? [] })) };
}

describe("drawScene", () => {
  const gridLine: Primitive = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: { px: 1 }, color: "#dddddd", cap: "butt" };
  const wall: Primitive = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], color: "#222222" };
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

  it("draws only the background for an empty scene", () => {
    const ctx = new RecordingContext();
    drawScene(ctx, sceneFixture(), cameraFixture);
    expect(ctx.calls).toEqual(["save", "scale 2.00 2.00", `fillRect 0.00 0.00 200.00 100.00 ${COLORS.background}`, "restore"]);
  });
});

describe("drawTextOverlay", () => {
  it("scales by dpr, clears to transparent, then draws the texts in order", () => {
    const ctx = new RecordingContext();
    const texts: Primitive[] = [
      { kind: "text", text: "Kitchen", at: { x: 1, y: 0 }, size: 12, color: "#333333", align: "center", rotation: 0 },
      { kind: "text", text: "Bob", at: { x: 0, y: 0 }, size: 11, color: "#0090ff", align: "left", rotation: 0 },
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
