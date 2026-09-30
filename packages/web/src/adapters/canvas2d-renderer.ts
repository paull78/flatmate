import { COLORS, UI_FONT, worldToScreen, type Camera, type Primitive, type Scene, type Width } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import type { OnFrame, Renderer } from "./renderer";

/** The subset of CanvasRenderingContext2D the renderer uses; tests pass a recording fake. */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

/** Screen-constant hairlines ({ px }) versus world-scaled widths ({ m }). */
export function widthPx(width: Width, camera: Camera): number {
  return "px" in width ? width.px : width.m * camera.zoom;
}

/** Draws one primitive in CSS pixels. World y points up: angles are negated on screen. */
export function drawPrimitive(ctx: DrawContext, p: Primitive, camera: Camera): void {
  switch (p.kind) {
    case "segment": {
      const a = worldToScreen(camera, p.a);
      const b = worldToScreen(camera, p.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = widthPx(p.width, camera);
      ctx.lineCap = p.cap;
      ctx.setLineDash(p.dash ?? []);
      ctx.stroke();
      return;
    }
    case "polygon": {
      const [first, ...rest] = p.points.map((q) => worldToScreen(camera, q));
      if (first === undefined || rest.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const q of rest) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      return;
    }
    case "arc": {
      const c = worldToScreen(camera, p.center);
      ctx.beginPath();
      ctx.arc(c.x, c.y, p.radius * camera.zoom, -p.from, -p.to, true);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = widthPx(p.width, camera);
      ctx.lineCap = "butt";
      ctx.setLineDash([]);
      ctx.stroke();
      return;
    }
    case "disc": {
      const c = worldToScreen(camera, p.center);
      ctx.beginPath();
      ctx.arc(c.x, c.y, widthPx(p.radius, camera), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      return;
    }
    case "text": {
      const at = worldToScreen(camera, p.at);
      ctx.save();
      ctx.translate(at.x, at.y);
      if (p.rotation !== 0) ctx.rotate(-p.rotation);
      ctx.font = `${p.size}px ${UI_FONT}`;
      ctx.textAlign = p.align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
      return;
    }
    default:
      assertNever(p);
  }
}

/** One frame in CSS pixels: dpr scale, background, then layers in scene order. */
export function drawScene(ctx: DrawContext, scene: Scene, camera: Camera): void {
  ctx.save();
  ctx.scale(camera.dpr, camera.dpr);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, camera.viewport.width, camera.viewport.height);
  for (const layer of scene.layers) {
    for (const p of layer.primitives) drawPrimitive(ctx, p, camera);
  }
  ctx.restore();
}

/**
 * WebGL mode: the Canvas2D canvas becomes a transparent overlay that shows only text, above all geometry
 * (spec §6.1). Clears it, then draws the text primitives in scene order.
 */
export function drawTextOverlay(ctx: DrawContext, texts: readonly Primitive[], camera: Camera): void {
  ctx.save();
  ctx.scale(camera.dpr, camera.dpr);
  ctx.clearRect(0, 0, camera.viewport.width, camera.viewport.height);
  for (const p of texts) drawPrimitive(ctx, p, camera);
  ctx.restore();
}

/** Backing-store size for crisp output on high-DPI screens. */
export function backingSize(camera: Camera): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(camera.viewport.width * camera.dpr)),
    height: Math.max(1, Math.round(camera.viewport.height * camera.dpr)),
  };
}

/** Canvas2D renderer: keeps the latest scene and draws it once per animation frame. */
export function createCanvas2DRenderer(canvas: HTMLCanvasElement, onFrame?: OnFrame): Renderer {
  // Not `alpha: false`: under WebGL the same canvas is the transparent text overlay, and a canvas keeps the
  // attributes of its first getContext call. drawScene paints an opaque background, so nothing shows through.
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Canvas 2D context unavailable");
  let pending: { scene: Scene; camera: Camera } | null = null;
  let frame: number | null = null;

  const draw = (): void => {
    frame = null;
    if (pending === null) return;
    const { scene, camera } = pending;
    pending = null;
    const started = performance.now();
    const size = backingSize(camera);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    drawScene(ctx, scene, camera);
    onFrame?.(performance.now() - started, scene);
  };

  return {
    render(scene, camera) {
      pending = { scene, camera };
      if (frame === null) frame = requestAnimationFrame(draw);
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    },
  };
}
