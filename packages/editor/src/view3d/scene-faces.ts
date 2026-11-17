import { faces3d } from "./faces";
import { STYLE_3D, finishShades, type Style3d } from "./style";
import type { Face3d, View3d } from "./types";
import { wallSeams } from "./wall-seams";

/**
 * The shades the walls' finished sides draw in (`finishShades` of each side's finish and lower band): a wall face in
 * one of them is the wall's own, so a split wall with a finish loses its seam as a plain one does.
 */
function finishedShades(items: View3d["items"]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    if (item.item !== "wall" || !item.sides) continue;
    for (const side of [item.sides.left, item.sides.right]) {
      for (const finish of [side?.finish, side?.lower?.finish]) {
        if (!finish) continue;
        const shades = finishShades(finish.colour);
        out.add(shades.lit).add(shades.shaded);
      }
    }
  }
  return [...out];
}

/**
 * The house's faces in item order, unsorted (real3d.02): floors, the walls not hidden, decks and pieces, then the
 * roof when it is shown, and the trailer under it when it has one. A depth buffer hides what is behind, so nothing orders them. Never the ground:
 * `look` puts it first and the panel draws it from buffers of its own. The walls shown lose their seams (snags.10).
 */
export function sceneFaces(view: Pick<View3d, "items" | "hidden" | "trailer" | "roof">, style: Style3d = STYLE_3D): Face3d[] {
  const shown = view.items.filter((item) => !(item.item === "wall" && view.hidden.has(item.wall)));
  const house = wallSeams(shown.flatMap((item) => faces3d(item, style)), style, finishedShades(shown));
  return [...house, ...(view.roof ?? []), ...(view.trailer ?? [])]; // the roof when this viewer's switch is on (roofs.13)
}
