import type { Point } from "@fm/protocol";
import type { Box } from "../geometry";
import { EPS } from "../model";

/**
 * Faces bucketed by a coarse grid of their boxes (widened by EPS), so a point is tested only against the faces
 * whose box can hold it. A face covering too many cells is tested for every point instead.
 */
export type FaceIndex<T> = { faces: readonly T[]; cell: number; buckets: Map<string, number[]>; everywhere: number[] };

const MAX_CELLS_PER_FACE = 64;
/** Wider than the EPS of `onBoundary`, so rounding in the distance test cannot reach past the box. */
export const BOX_MARGIN = 2 * EPS;

export function indexFaces<T extends { readonly box: Box }>(faces: readonly T[]): FaceIndex<T> {
  const sizes = faces.map((f) => Math.max(f.box.maxX - f.box.minX, f.box.maxY - f.box.minY));
  const cell = Math.max(sizes.reduce((sum, s) => sum + s, 0) / Math.max(faces.length, 1), 1);
  const buckets = new Map<string, number[]>();
  const everywhere: number[] = [];
  faces.forEach((f, i) => {
    const x0 = Math.floor((f.box.minX - BOX_MARGIN) / cell);
    const x1 = Math.floor((f.box.maxX + BOX_MARGIN) / cell);
    const y0 = Math.floor((f.box.minY - BOX_MARGIN) / cell);
    const y1 = Math.floor((f.box.maxY + BOX_MARGIN) / cell);
    // Far from the origin (beyond 2^53 cells) x + 1 === x and the loop below would never end; NaN never compares.
    const fits = [x0, x1, y0, y1].every(Number.isSafeInteger) && (x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_CELLS_PER_FACE;
    if (!fits) {
      everywhere.push(i);
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(i);
        else buckets.set(key, [i]);
      }
    }
  });
  return { faces, cell, buckets, everywhere };
}

/** The faces whose widened box may hold p, in face order. */
export function facesNear<T>(index: FaceIndex<T>, p: Point): T[] {
  const near = index.buckets.get(`${Math.floor(p.x / index.cell)},${Math.floor(p.y / index.cell)}`) ?? [];
  const ids = index.everywhere.length === 0 ? near : [...near, ...index.everywhere].sort((a, b) => a - b);
  return ids.flatMap((i) => {
    const f = index.faces[i];
    return f === undefined ? [] : [f];
  });
}
