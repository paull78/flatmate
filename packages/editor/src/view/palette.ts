import { FURNITURE_SETS, furnitureSet, setBox, setPoses, type FurnitureSet } from "../furniture-sets";
import { FAMILY_LABELS, MOTIFS, kindConfigs, kindOf, motifDefaults, motifsFor, shown, shownCm, type MotifId } from "@fm/domain";
import { finishGeometry } from "./finish/geometry";
import { MOTIF_DRAWINGS } from "./finish/motifs";
import { objectLook, placeSymbol } from "./furniture";
import { CANVAS_STYLE, pieceFill } from "./plan-style";
import type { Primitive } from "./scene-types";

// The palette's groups (spec: layouts groups; a group with no cards is hidden; ux-polish.10, furnish.19): which kinds, in
// which group, in which order. Editor data next to the symbols, so adding a kind means one symbol and one line here.

/**
 * A palette card (spec "The cards", library.04): a kind, or one of its presets, with its name, its size text, the
 * configuration its symbol shows and that configuration's width and depth.
 */
export type PaletteCard = { kind: string; preset: string | null; name: string; size: string; config: string; w: number; d: number };
export type PaletteGroup = { group: string; cards: PaletteCard[] };

const GROUPS: readonly { group: string; kinds: readonly string[] }[] = [
  { group: "Sleep", kinds: ["bed", "mattress", "liftBed", "loftBed", "murphyBed", "builtInTable", "sofaBed", "nightstand", "cot"] }, // the built-in desk: through Opens into
  { group: "Sit and eat", kinds: ["foldingTable", "extendingTable", "roundTable", "seatedDining", "seatedRound", "sofa", "armchair", "chair", "stool", "barTable", "bench", "coffeeTable", "cornerSofa"] },
  { group: "Work", kinds: ["desk", "deskSet", "cornerDesk"] },
  { group: "Kitchen", kinds: ["hobUnit", "range", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "tallPantry", "wallCabinet", "cookerHood", "cornerCounter"] },
  { group: "Bathroom", kinds: ["toilet", "bidet", "washbasin", "vanityUnit", "cornerBasin", "showerTray", "cornerShower", "bathtub", "washingMachine", "towelRail"] },
  { group: "Storage", kinds: ["wardrobe", "drawers", "storageChest", "shelf", "glassCabinet", "halfGlassCabinet", "tvUnit", "cornerWardrobe", "wallTv", "pegboard", "coatHooks", "coatStand"] },
  { group: "Sets", kinds: FURNITURE_SETS.map((s) => s.id) },
  { group: "Basic", kinds: ["block", "roundBlock", "cornerBlock", "plant", "palm", "fern", "rosette", "radiator", "wheelWell", "beam", "woodStove", "electricFireplace", "wallUnit", "rug", "roundRug", "picture", "mirror", "clock"] },
  { group: "Stairs", kinds: ["stair", "openStair", "storageStair", "storageSteps", "winderStair", "shipsLadder", "alternatingTread", "rungLadder", "spiralStair"] },
];

/** Tiles that would be a thin strip in their first configuration show the open one (ux-polish.32); placing is unchanged. */
const TILE_CONFIG: Readonly<Record<string, string>> = { murphyBed: "down", builtInTable: "down", foldingTable: "open" };
/** Tiles named other than their kind: the built-in unit tile places a built-in table (smart.04). */
const TILE_LABEL: Readonly<Record<string, string>> = { builtInTable: FAMILY_LABELS.builtIn };

/** A size as the card shows it, in metres through `shown` (cleanup.13): "1.80 × 1.10 m", or "Ø 1.48 m" for a round outline of equal sides. */
export function cardSize(kind: string, w: number, d: number): string {
  const round = kindOf(kind)?.outline === "round" && shownCm(w) === shownCm(d);
  return round ? `Ø ${shown(w)} m` : `${shown(w)} × ${shown(d)} m`;
}

/** A set's card: its name, and the size of its whole box. */
function setCard(set: FurnitureSet): PaletteCard {
  const { w, d } = setBox(set);
  return { kind: set.id, preset: null, name: set.label, size: cardSize(set.id, w, d), config: "standard", w, d };
}

/** A kind's one card at its default size, a set's card, or none for an unknown or retired kind (furnish.19). */
function kindCard(id: string): PaletteCard[] {
  const set = furnitureSet(id);
  if (set) return [setCard(set)];
  const kind = kindOf(id);
  const wanted = TILE_CONFIG[id];
  const configs = kindConfigs(id);
  const config = configs.find((c) => c.id === wanted) ?? configs[0];
  if (!kind || kind.retired || !config) return [];
  return [{ kind: id, preset: null, name: TILE_LABEL[id] ?? kind.label, size: cardSize(id, config.w, config.d), config: config.id, w: config.w, d: config.d }];
}

/** A card per preset when every preset of the kind counts seats (library.05, .11), else the kind's one card. */
function cardsOf(base: PaletteCard): PaletteCard[] {
  const presets = kindOf(base.kind)?.presets ?? [];
  if (presets.length === 0 || presets.some((p) => p.seats === undefined)) return [base];
  return presets.map((p) => {
    const d = p.d[base.config] ?? base.d;
    return { ...base, preset: p.id, name: `${base.name} · ${p.id}`, size: cardSize(base.kind, p.w, d), w: p.w, d };
  });
}

/** Each kind's one card at its default size, by group: quick add's rows and their symbols (quick add is per kind). */
export const PALETTE_KINDS: readonly PaletteGroup[] = GROUPS.map((g) => ({ group: g.group, cards: g.kinds.flatMap(kindCard) })).filter((g) => g.cards.length > 0);

/** Built once: a constant, so the ViewModel's palette keeps its identity between renders. */
export const PALETTE: readonly PaletteGroup[] = PALETTE_KINDS.map((g) => ({ group: g.group, cards: g.cards.flatMap(cardsOf) }));

const TILE_FRONT_PX = 1; // about two thirds of the canvas front edge
const tiles = new Map<string, readonly Primitive[]>(); // palette cards are constant: each card's look is built once

/** A card's symbol in footprint space: the canvas look with its fill, the front edge 1 px (a smaller drawing). */
export function tileLook(c: PaletteCard): readonly Primitive[] {
  const key = `${c.kind}/${c.config}/${c.w}/${c.d}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const s = CANVAS_STYLE;
  const look = (kind: string): Parameters<typeof objectLook>[4] => ({ fill: pieceFill(s, kind), line: s.objectLine, frontPx: TILE_FRONT_PX, linePx: s.objectLineWidth, detail: s.objectDetail, detailPx: s.objectDetailWidth });
  const set = furnitureSet(c.kind);
  if (set) {
    const pieces = setPoses(set, { x: 0, y: 0 }, 0).flatMap((p) => placeSymbol(objectLook(p.kind, p.config, p.w, p.d, look(p.kind)), p.at, 0));
    tiles.set(key, pieces);
    return pieces;
  }
  const built = objectLook(c.kind, c.config, c.w, c.d, { fill: pieceFill(s, c.kind), line: s.objectLine, frontPx: TILE_FRONT_PX, linePx: s.objectLineWidth, detail: s.objectDetail, detailPx: s.objectDetailWidth });
  tiles.set(key, built);
  return built;
}

/** A Floors tile (finishes.08): its motif, the domain's name and the floor it shows, w × d metres. */
export type FloorTile = { motif: MotifId; label: string; w: number; d: number };

const FLOOR_TILE_DEPTH = 1.2; // metres: about a plank's length
const FLOOR_TILE_REPEATS = { min: 3, max: 7 }; // line spacings across the depth: a few repeats, a mosaic's joints still apart
const FLOOR_TILE_ASPECT = 1.6; // the tile's symbol box, 64 × 40 px
const FLOOR_TILE_LINE_PX = 1;

/** The tile's depth: 1.2 m held to 3–7 of the motif's line spacings (a mosaic's tile is 0.175 m, large tiles' 1.8 m). */
function floorTile(motif: MotifId): FloorTile {
  const spacing = MOTIF_DRAWINGS[motif].spacing * motifDefaults(motif).size;
  const { min, max } = FLOOR_TILE_REPEATS;
  const d = spacing > 0 ? Math.min(Math.max(FLOOR_TILE_DEPTH, min * spacing), max * spacing) : FLOOR_TILE_DEPTH;
  return { motif, label: MOTIFS[motif].name, w: d * FLOOR_TILE_ASPECT, d };
}

/** The Floors group's tiles: the floor motifs in the domain's order (surfaces.03). A constant, so the ViewModel keeps its identity. */
export const FLOOR_TILES: readonly FloorTile[] = motifsFor("floor").map(floorTile);

const floorLooks = new Map<MotifId, readonly Primitive[]>(); // one look per motif, built on first use

/**
 * A Floors tile's swatch in footprint space (x ±w/2, y from −d to 0): the motif at its defaults over the tile's floor,
 * laid from (0,0) as on the plan. It calls `finishGeometry` directly, not the rooms' shared cache (finishes.41).
 */
export function floorTileLook(tile: FloorTile): readonly Primitive[] {
  const cached = floorLooks.get(tile.motif);
  if (cached) return cached;
  const { w, d } = tile;
  const ring = [{ x: -w / 2, y: -d }, { x: w / 2, y: -d }, { x: w / 2, y: 0 }, { x: -w / 2, y: 0 }];
  const g = finishGeometry(ring, [], motifDefaults(tile.motif));
  const built: Primitive[] = [
    { kind: "polygon", points: g.fill.points, holes: g.fill.holes, color: g.fill.color },
    ...g.shapes.map((s): Primitive => ({ kind: "polygon", points: s.points, holes: s.holes, color: s.color })),
    ...g.lines.map((l): Primitive => ({ kind: "segment", a: l.a, b: l.b, width: { px: FLOOR_TILE_LINE_PX }, color: l.color, cap: "butt" })),
  ];
  floorLooks.set(tile.motif, built);
  return built;
}
