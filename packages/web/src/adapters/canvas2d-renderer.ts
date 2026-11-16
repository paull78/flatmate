import { COLORS, FONT_FAMILY, worldToScreen, type Camera, type PageClip, type Primitive, type Scene, type SceneUnderlay, type Width } from "@fm/editor";
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
  fontKerning: CanvasFontKerning;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  fill(fillRule?: CanvasFillRule): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/** Screen-constant hairlines ({ px }) versus world-scaled widths ({ m }). */
function widthPx(width: Width, camera: Camera): number {
  return "px" in width ? width.px : width.m * camera.zoom;
}

/** Draws one primitive in CSS pixels. World y points up: angles are negated on screen. */
export function drawPrimitive(ctx: DrawContext, p: Primitive, camera: Camera): void {
  switch (p.kind) {
    case "segment":
      strokeSegments(ctx, p, [p], camera);
      return;
    case "polygon": {
      if (p.points.length < 3) return;
      // One path, one subpath per ring; holes are cut out by the even-odd rule, whatever their winding.
      ctx.beginPath();
      for (const ring of [p.points, ...p.holes]) {
        const [first, ...rest] = ring.map((q) => worldToScreen(camera, q));
        if (first === undefined || rest.length < 2) continue;
        ctx.moveTo(first.x, first.y);
        for (const q of rest) ctx.lineTo(q.x, q.y);
        ctx.closePath();
      }
      ctx.fillStyle = p.color;
      if (p.holes.length > 0) ctx.fill("evenodd");
      else ctx.fill();
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
      ctx.font = `${p.style === "bold" ? "bold " : p.style === "oblique" ? "italic " : ""}${p.size}px ${FONT_FAMILY[p.font]}`;
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

type Segment = Extract<Primitive, { kind: "segment" }>;

/** Strokes `segments` as one path, a subpath each, in `style`'s colour, width, cap and dash. */
function strokeSegments(ctx: DrawContext, style: Segment, segments: readonly Segment[], camera: Camera): void {
  ctx.beginPath();
  for (const p of segments) {
    const a = worldToScreen(camera, p.a);
    const b = worldToScreen(camera, p.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = widthPx(style.width, camera);
  ctx.lineCap = style.cap;
  ctx.setLineDash(style.dash ? [...style.dash] : []);
  ctx.stroke();
}

/** An opaque (`#rrggbb`, render.12), undashed segment: several such stroked as one path look as if stroked one by one. */
function batchable(p: Primitive): p is Segment {
  return p.kind === "segment" && p.dash === undefined && p.color.length === 7;
}

function sameWidth(a: Width, b: Width): boolean {
  return "px" in a ? "px" in b && a.px === b.px : "m" in b && a.m === b.m;
}

function sameStroke(a: Segment, b: Segment): boolean {
  return a.color === b.color && a.cap === b.cap && sameWidth(a.width, b.width);
}

/**
 * Draws primitives in order, stroking each run of batchable segments of one colour, width and cap with one stroke: a
 * floor pattern is thousands of joints in one colour (finishes). Only antialiasing where two of a run cross or meet
 * can differ from stroking them one by one.
 */
export function drawPrimitives(ctx: DrawContext, primitives: readonly Primitive[], camera: Camera): void {
  let run: Segment[] = [];
  const flush = (): void => {
    const [head] = run;
    if (head) strokeSegments(ctx, head, run, camera);
    run = [];
  };
  for (const p of primitives) {
    if (batchable(p)) {
      const [head] = run;
      if (head && !sameStroke(head, p)) flush();
      run.push(p);
      continue;
    }
    flush();
    drawPrimitive(ctx, p, camera);
  }
  flush();
}

/**
 * Draws primitives in order, each clip's range inside its rect (sheetset.17): slicing also ends a stroke run at its edges.
 * `shift`, canvas pixels, moves what's inside and not the rect: a framing drag, before it's let go.
 */
export function drawClipped(ctx: DrawContext, primitives: readonly Primitive[], clips: readonly PageClip[], camera: Camera, shift: { x: number; y: number } | null = null): void {
  let drawn = 0;
  for (const { rect, from, to } of clips) {
    drawPrimitives(ctx, primitives.slice(drawn, from), camera);
    const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y + rect.h });
    ctx.save();
    ctx.beginPath();
    ctx.rect(topLeft.x, topLeft.y, rect.w * camera.zoom, rect.h * camera.zoom);
    ctx.clip();
    if (shift) ctx.translate(shift.x, shift.y);
    drawPrimitives(ctx, primitives.slice(from, to), camera);
    ctx.restore();
    drawn = to;
  }
  drawPrimitives(ctx, primitives.slice(drawn), camera);
}

/**
 * One frame in CSS pixels: dpr scale, background, the underlay once its `picture` has loaded, then layers in scene
 * order. The picture is stretched to its rect, never drawn at its natural size (import.11); its rows run toward −y,
 * so its top-left is the rect's (minX, maxY).
 */
export function drawScene(ctx: DrawContext, scene: Scene, camera: Camera, picture: CanvasImageSource | null = null): void {
  ctx.save();
  ctx.scale(camera.dpr, camera.dpr);
  ctx.fontKerning = "none"; // once a frame (render.29)
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, camera.viewport.width, camera.viewport.height);
  const underlay = scene.underlay;
  if (underlay !== null && picture !== null) {
    const { minX, minY, maxX, maxY } = underlay.rect;
    const topLeft = worldToScreen(camera, { x: minX, y: maxY });
    ctx.save(); // keeps the alpha off the layers
    ctx.globalAlpha = 1 - underlay.fade;
    ctx.drawImage(picture, topLeft.x, topLeft.y, (maxX - minX) * camera.zoom, (maxY - minY) * camera.zoom);
    ctx.restore();
  }
  for (const layer of scene.layers) drawPrimitives(ctx, layer.primitives, camera);
  ctx.restore();
}

/**
 * Under WebGL or WebGPU: the Canvas2D canvas becomes a transparent overlay that shows only text, above all geometry
 * (spec: rendering). Clears it, then draws the text primitives in scene order.
 */
export function drawTextOverlay(ctx: DrawContext, texts: readonly Primitive[], camera: Camera): void {
  ctx.save();
  ctx.scale(camera.dpr, camera.dpr);
  ctx.fontKerning = "none"; // once a frame (render.29)
  ctx.clearRect(0, 0, camera.viewport.width, camera.viewport.height);
  for (const p of texts) drawPrimitive(ctx, p, camera);
  ctx.restore();
}

/** Resizes a canvas's backing store to `size`, only when it differs (a resize clears the canvas). */
export function fitCanvas(canvas: HTMLCanvasElement, size: { width: number; height: number }): void {
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
}

/** Backing-store size for crisp output on high-DPI screens. */
export function backingSize(camera: Camera): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(camera.viewport.width * camera.dpr)),
    height: Math.max(1, Math.round(camera.viewport.height * camera.dpr)),
  };
}

type PictureCache<T> = { get(u: SceneUnderlay | null): T | null; dispose(): void };
type PictureEntry<T> = { pictureId: string; image: T | null; ready: boolean };

/**
 * The underlay's decoded picture, one entry keyed by pictureId (import.11). `get` returns it once loaded; a new id
 * starts a new load and a late load of the old one is ignored. `get(null)` keeps the entry, so showing it again or
 * an Undo of Remove (same pictureId) doesn't decode again. `onReady` asks for a redraw; never after `dispose`.
 */
export function createPictureCache<T>(load: (src: string, onLoad: () => void) => T, onReady: () => void): PictureCache<T> {
  let entry: PictureEntry<T> | null = null;
  let disposed = false;
  return {
    get(u) {
      if (u === null) return null;
      if (entry === null || entry.pictureId !== u.pictureId) {
        const current: PictureEntry<T> = { pictureId: u.pictureId, image: null, ready: false };
        entry = current;
        // The web can't import the domain's UNDERLAY_MIME; I16 guarantees stored pictures are JPEG.
        current.image = load(`data:image/jpeg;base64,${u.data}`, () => {
          if (disposed || entry !== current) return;
          current.ready = true;
          onReady();
        });
      }
      return entry.ready ? entry.image : null;
    },
    dispose() {
      disposed = true;
    },
  };
}

/** Canvas2D renderer: keeps the latest scene and draws it once per animation frame. */
export function createCanvas2DRenderer(canvas: HTMLCanvasElement, onFrame?: OnFrame): Renderer {
  // Not `alpha: false`: under WebGL the same canvas is the transparent text overlay, and a canvas keeps the
  // attributes of its first getContext call. drawScene paints an opaque background, so nothing shows through.
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Canvas 2D context unavailable");
  let pending: { scene: Scene; camera: Camera } | null = null;
  // The last drawn frame, redrawn when the underlay's picture finishes decoding (draw clears `pending`).
  let last: { scene: Scene; camera: Camera } | null = null;
  let frame: number | null = null;
  let disposed = false;

  const draw = (): void => {
    frame = null;
    if (pending === null) return;
    const { scene, camera } = pending;
    last = pending;
    pending = null;
    const started = performance.now();
    const size = backingSize(camera);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    drawScene(ctx, scene, camera, pictures.get(scene.underlay));
    onFrame?.(performance.now() - started, scene);
  };
  // A decode error never calls onload, so the underlay just stays undrawn. After dispose a late onload must never
  // paint this opaque frame over WebGL.
  const pictures = createPictureCache(
    (src, onLoad) => {
      const img = new Image();
      img.onload = onLoad;
      img.src = src;
      return img;
    },
    () => {
      if (disposed || last === null) return;
      pending ??= last;
      if (frame === null) frame = requestAnimationFrame(draw);
    },
  );

  return {
    render(scene, camera) {
      pending = { scene, camera };
      if (frame === null) frame = requestAnimationFrame(draw);
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      disposed = true;
      pictures.dispose();
      frame = null;
      pending = null;
      last = null;
    },
  };
}
