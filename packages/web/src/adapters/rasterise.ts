import type { Camera, Event as EditorEvent, ExportPage, PageClip, Primitive, Width } from "@fm/editor";
import { assertNever } from "@fm/protocol";
import { drawClipped, type DrawContext } from "./canvas2d-renderer";
import { createPageImages } from "./page-images";

// PNG export (export.18): the editor asks for a page (millimetres, y up) drawn at a pixel size; this adapter draws it
// with the Canvas2D renderer on an offscreen canvas, white behind, and answers with the PNG as a Blob, an opaque
// handle the editor passes on to saveFile.

/** The page in pixels, and a camera of one pixel per unit whose y axis flips the page's y up to the canvas's y down. */
export function pixelPage(page: ExportPage, size: { w: number; h: number }): { primitives: Primitive[]; clips: PageClip[]; camera: Camera } {
  const k = size.w / page.widthMm;
  const width = (w: Width): Width => ("px" in w ? { px: w.px * k } : { px: w.m * k });
  const at = (p: { x: number; y: number }) => ({ x: p.x * k, y: p.y * k });
  const primitives = page.primitives.map((p): Primitive => {
    switch (p.kind) {
      case "segment":
        return { ...p, a: at(p.a), b: at(p.b), width: width(p.width), ...(p.dash ? { dash: [p.dash[0] * k, p.dash[1] * k] as const } : {}) };
      case "polygon":
        return { ...p, points: p.points.map(at), holes: p.holes.map((h) => h.map(at)) };
      case "arc":
        return { ...p, center: at(p.center), radius: p.radius * k, width: width(p.width) };
      case "disc":
        return { ...p, center: at(p.center), radius: width(p.radius) };
      case "text":
        return { ...p, at: at(p.at), size: p.size * k };
      default:
        return assertNever(p);
    }
  });
  const clips = (page.clips ?? []).map(({ rect, from, to }): PageClip => ({ rect: { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k }, from, to }));
  return { primitives, clips, camera: { center: { x: size.w / 2, y: size.h / 2 }, zoom: 1, viewport: { width: size.w, height: size.h }, dpr: 1 } };
}

const paintImages = createPageImages((src, onLoad) => {
  const img = new Image();
  img.onload = onLoad; // a decode error never calls it, so the image just stays undrawn
  img.src = src;
  return img;
});

/**
 * Draws a page at `size` pixels on any 2D context, its clips included, with what's inside them moved by `shift`, if any.
 * Its images may paint later, when decoded (`page-images.ts`). Only sheets have any, and a PNG prints the plan alone, so
 * the rasteriser's `toBlob` right after this misses nothing.
 */
export function drawPage(ctx: DrawContext, page: ExportPage, size: { w: number; h: number }, shift: { x: number; y: number } | null = null): void {
  const { primitives, clips, camera } = pixelPage(page, size);
  ctx.fontKerning = "none"; // text as wide as the core measured it, set once (render.15, .29)
  drawClipped(ctx, primitives, clips, camera, shift);
  const k = size.w / page.widthMm;
  paintImages(ctx, page.images ?? [], (r) => ({ x: r.x * k, y: size.h - (r.y + r.h) * k, w: r.w * k, h: r.h * k }));
}

/** Draws pages on an offscreen canvas and dispatches `rasterised` with the PNG Blob. */
export function createRasteriser(dispatch: (e: EditorEvent) => void): (requestId: string, page: ExportPage, size: { w: number; h: number }) => void {
  return (requestId, page, size) => {
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.w, size.h);
    drawPage(ctx, page, size);
    canvas.toBlob((blob) => {
      if (blob !== null) dispatch({ type: "rasterised", requestId, image: blob });
    }, "image/png");
  };
}
