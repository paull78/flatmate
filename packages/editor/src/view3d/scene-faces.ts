import { faces3d } from "./faces";
import { STYLE_3D, type Style3d } from "./style";
import type { Face3d, View3d } from "./types";
import { wallSeams } from "./wall-seams";

/**
 * The house's faces in item order, unsorted (real3d.02): floors, the walls not hidden, decks and pieces, then the
 * roof when it is shown, and the trailer under it when it has one. A depth buffer hides what is behind, so nothing orders them. Never the ground:
 * `look` puts it first and the panel draws it from buffers of its own. The walls shown lose their seams (snags.10).
 */
export function sceneFaces(view: Pick<View3d, "items" | "hidden" | "trailer" | "roof">, style: Style3d = STYLE_3D): Face3d[] {
  const house = wallSeams(view.items.flatMap((item) => (item.item === "wall" && view.hidden.has(item.wall) ? [] : faces3d(item, style))), style);
  return [...house, ...(view.roof ?? []), ...(view.trailer ?? [])]; // the roof when this viewer's switch is on (roofs.13)
}
