// The refreeze check (studio.06, .12): when a step refreezes real3d AC-16 pictures, every pixel that changed must lie
// near the faces the step meant to change. The mask is those faces drawn alone, so it covers them wherever they'd show.

/**
 * The pixels of `after` that differ from `before` by more than `tolerance` on some channel and lie farther than
 * `reach` px (in x and y) from every set cell of `mask`. Both pictures are `size` square RGBA; `mask` holds one cell per pixel.
 */
export function changedOutsideMask(before: Uint8Array, after: Uint8Array, mask: Uint8Array, size: number, tolerance = 8, reach = 2): { x: number; y: number }[] {
  const near = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (x + dx >= 0 && y + dy >= 0 && x + dx < size && y + dy < size) near[(y + dy) * size + x + dx] = 1;
        }
      }
    }
  }
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < size * size; k++) {
    const changed = [0, 1, 2].some((c) => Math.abs((before[4 * k + c] ?? 0) - (after[4 * k + c] ?? 0)) > tolerance);
    if (changed && !near[k]) out.push({ x: k % size, y: Math.floor(k / size) });
  }
  return out;
}

/** Whether two pictures differ anywhere by more than `tolerance` on some channel. */
export function differs(before: Uint8Array, after: Uint8Array, tolerance = 8): boolean {
  for (let i = 0; i < after.length; i += 4) if ([0, 1, 2].some((c) => Math.abs((before[i + c] ?? 0) - (after[i + c] ?? 0)) > tolerance)) return true;
  return false;
}
