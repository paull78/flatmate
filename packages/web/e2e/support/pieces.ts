import { expect, type Page } from "@playwright/test";
import { clickAt, type WorldPoint } from "./canvas";
import { canvasOf, waitSaved } from "./app-driver";
import { storedDocument } from "./stored";

// Stored furniture and wall chains for the furnish e2e specs (steps 09 and 15): server mode, read back from the server.

export type Piece = { kind: string; w: number; d: number; at: WorldPoint; rotation: number };

/** Every stored placement, with its object's kind and its sizes in the placement's configuration. */
export async function pieces(project: string): Promise<Piece[]> {
  const doc = await storedDocument(project);
  return Object.values(doc.placements).map((p): Piece => {
    const object = typeof p.object === "string" ? doc.objects[p.object] : undefined;
    const { config, at, rotation } = p;
    if (object === undefined || typeof config !== "string" || typeof rotation !== "number") throw new Error("malformed placement");
    if (typeof at !== "object" || at === null || !("x" in at) || !("y" in at) || typeof at.x !== "number" || typeof at.y !== "number") {
      throw new Error("malformed placement");
    }
    const { kind, w, d } = object;
    if (typeof kind !== "string" || typeof w !== "object" || w === null || typeof d !== "object" || d === null) throw new Error("malformed object");
    const width: unknown = Reflect.get(w, config);
    const depth: unknown = Reflect.get(d, config);
    if (typeof width !== "number" || typeof depth !== "number") throw new Error("malformed object sizes");
    return { kind, w: width, d: depth, at: { x: at.x, y: at.y }, rotation };
  });
}

export const wallCount = async (project: string): Promise<number> => Object.keys((await storedDocument(project)).walls).length;

/**
 * A chain of walls through `points` with the Wall tool. After each click from the second on, waits until the stored
 * wall count has grown by `added[i - 1]`: server mode holds one outstanding edit (spec: collaboration). A segment adds 1 wall; a stub
 * whose first point lies on a wall body adds 2 (the split, plus the stub).
 */
export async function drawChain(page: Page, project: string, points: WorldPoint[], added: number[]): Promise<void> {
  const canvas = canvasOf(page);
  let want = await wallCount(project);
  await page.keyboard.press("w");
  for (const [i, p] of points.entries()) {
    await clickAt(page, canvas, p);
    if (i === 0) continue;
    want += added[i - 1] ?? 1;
    await expect.poll(() => wallCount(project)).toBe(want);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitSaved(page);
}
