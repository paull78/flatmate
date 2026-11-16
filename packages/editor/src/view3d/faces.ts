import { guardFaces } from "./guard-faces";
import { openingFaces } from "./opening-faces";
import { ccw, prism, slabPrism } from "./prism";
import { partSolids } from "./parts/solids";
import { ownFaces } from "./own-faces";
import { stairFaces } from "./stair-faces";
import { STYLE_3D, type Style3d } from "./style";
import { withPattern } from "./pattern-faces";
import type { Face3d, Item3d, WallItem } from "./types";
import { wallFaces } from "./wall-faces";
import { assertNever } from "@fm/protocol";
import { underCeiling } from "./ceiling-clip";

export type { Face3d } from "./types";

/** An item's stable key: its table and id. */
export function itemKey(item: Item3d): string {
  switch (item.item) {
    case "floor": return `floor/${item.room}`;
    case "wall": return `wall/${item.wall}`;
    case "piece": return `piece/${item.placement}`;
    case "deck": return `deck/${item.deck}`;
    case "guard": return `guard/${item.key}`;
    default: return assertNever(item);
  }
}

/** A wall's joint caps (studio.10): each its share of the joint as a prism from the shorter wall's top to this wall's. */
export function capFaces(owner: string, item: WallItem, style: Style3d = STYLE_3D): Face3d[] {
  return item.caps.flatMap((cap) => prism(owner, cap.ring, cap.bottom, item.top, style.wall));
}

/**
 * An item's faces, in any order (real3d.09): a floor flat at 0.00 in its finish's colour, its pattern's lines and
 * shapes `patternLift` above it (finishes.12, shown.04);
 * a wall or deck as its prism (heights.06, decks.07), a stair as its steps, furniture as its parts (parts.09), a wall
 * with its openings (heights.69) and its joint caps (studio.10). No horizontal bottom face: the camera always looks
 * down. A stair tells itself from furniture here, by its kind's stair rule.
 */
export function faces3d(item: Item3d, style: Style3d = STYLE_3D): Face3d[] {
  switch (item.item) {
    case "floor": {
      const floor: Face3d = { points: ccw(item.ring).map((p) => ({ ...p, z: 0 })), holes: item.holes.map((h) => h.map((p) => ({ ...p, z: 0 }))), color: item.color ?? style.floor, owner: itemKey(item) };
      return withPattern(floor, item, style.patternLift);
    }
    case "wall": {
      const solid = [...wallFaces(itemKey(item), item, style), ...capFaces(itemKey(item), item, style)];
      return [...(item.planes ? underCeiling(solid, item.planes, item.top) : solid), ...openingFaces(itemKey(item), item, style)];
    }
    case "piece":
      return stairFaces(itemKey(item), item, item.selected ? style.selected : style.stair, style.glass) ?? ownFaces(itemKey(item), item, style) ?? partSolids(itemKey(item), item, style).flatMap((p) => p.faces);

    case "deck": {
      // A finished deck's top takes its finish, its pattern 1 mm above; selected, it stays blue (deck-floors.07).
      if (item.selected || item.finish === null) return slabPrism(itemKey(item), item, item.selected ? style.selected : style.deck);
      const faces = slabPrism(itemKey(item), item, { ...style.deck, top: item.finish.color });
      const sides = faces.length - item.fills.length; // the tops come last, a turned deck with a hole across it having two
      const finish = item.finish;
      return [...faces.slice(0, sides), ...faces.slice(sides).flatMap((top) => withPattern(top, finish, item.top + style.patternLift))];
    }
    case "guard":
      return guardFaces(itemKey(item), item, style);
    default:
      return assertNever(item);
  }
}

