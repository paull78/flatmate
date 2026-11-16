import { washerFaces } from "./appliance-faces";
import { clockFaces } from "./clock-faces";
import { plantFaces } from "./plant-faces";
import type { Style3d } from "./style";
import { tapFaces } from "./tap-faces";
import type { Face3d, PieceItem } from "./types";

/** A piece's own faces where its kind draws them instead of, or over, its parts (the plants, the clock, the washing machine: hangings; the sink's and the bathtub's taps: showcase), else null. */
export const ownFaces = (owner: string, item: PieceItem, style: Style3d): Face3d[] | null => plantFaces(owner, item, style) ?? clockFaces(owner, item, style) ?? washerFaces(owner, item, style) ?? tapFaces(owner, item, style);
