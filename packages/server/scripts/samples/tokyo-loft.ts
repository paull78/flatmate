// A long, narrow Japanese apartment with a double-height living room and a loft you can stand in (brief 6 in
// recordings/prompts.md). Two ken wide (3.6 m clear) and six deep (11.0 m), the eel's bed (unagi no nedoko) of the
// Kyoto machiya in a concrete shell: glass at the balcony end, the wet rooms and the genkan at the corridor end, and
// storage, not walls, between the rooms where it can be. Windows on the south side only; the north wall is the
// corridor's.
//
//                                                                        front door
//   y 3.8 ┌──────────────open stair══════════════▶┬─counter range counter dish─┬───┤  ├─shoes┬─────────────┐
//         │                                      │          (hood)     washer │   Genkan    ┃ vanity  W/D │
//   big   │  armchair        rug                 │                             │             ┃pocket Laundry│
//   glass │           coffee table   sofa (faces │  island: sink + counter     ├─────wc door─┴──┬──bath door─┤ y 2.45
//   doors │  palm                     west)      │  three stools        fridge │  WC  │ Bath         │
//   y 0.2 └──fern──── tall slot ─────────────────┴──────── window ──── pantries┴──────┴── tub ───────┘
//        x 0.2                                  4.6                          7.8  8.5   9.6           11.2
//
// The loft over x 4.6–11.2 at 2.45 (2.33 under it, 2.75 over it, to the 5.2 m ceiling), a glass guard on its edge
// over the living room: a study with a 2.2 m desk looking out over the void, a double wall of books, the bedroom, and
// a walk-in closet behind a wall on the loft.
import { anchorAt, motifDefaults, rectangleRoom } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { SAMPLE_FINISHES as F, fixed, opening, piece, placementIn, raised, roomWalls } from "../seed-kit";
import type { Step } from "../seed-kit";

const L = "s0";
const LOFT = "loft/k0";
const LOFT_TOP = 2.45;
const UNDER_LOFT = 2.33; // the loft's underside, where the wet rooms' walls stop

const wall = (opId: string, from: Point, to: Point, extra: { base?: string; top?: number } = {}): Step => fixed({
  type: "addWall", opId, from: { at: from }, to: { at: to }, thickness: 0.1, ...extra,
});
/** A piece at a size of its own, centred at `centre`, `d` deep. */
const sized = (opId: string, kind: string, centre: Point, w: number, d: number, rotation: number, extra: { deck?: string; name?: string } = {}): Step => fixed({
  type: "placeObject", opId, state: L, object: { kind, size: { w, d }, ...(extra.name ? { name: extra.name } : {}) },
  at: anchorAt(centre, d, rotation), rotation, deck: extra.deck ?? null,
});
const onLoft = { deck: LOFT };
const FREE = { x: 2.3, y: 2.6 }; // open floor, where a raised piece is placed before it moves

export function tokyoLoftSteps(): Step[] {
  return [
    // The shell: 0.20 m walls, a flat 5.2 m ceiling.
    ...rectangleRoom({ x: 0.1, y: 0.1 }, 11.2, 3.8, "shell", 0.2).map(fixed),
    fixed({ type: "setCeiling", height: 5.2 }),
    // The wet rooms, under the loft: the WC and the bath off the genkan and the laundry.
    // The genkan's south wall runs on past the WC to the fridge column, closing the tall storage wall's end and giving
    // the WC's sliding door a wall to park on.
    wall("wet-north", { x: 7.8, y: 2.45 }, { x: 11.3, y: 2.45 }, { top: UNDER_LOFT }),
    wall("wc-west", { x: 8.5, y: 0.1 }, { x: 8.5, y: 2.45 }, { top: UNDER_LOFT }),
    wall("wc-east", { x: 9.6, y: 0.1 }, { x: 9.6, y: 2.45 }, { top: UNDER_LOFT }),
    wall("laundry-west", { x: 9.4, y: 2.45 }, { x: 9.4, y: 3.9 }, { top: UNDER_LOFT }),
    // The loft, with glass over the living room.
    fixed({ type: "addDeck", opId: "loft", preset: "loft", at: { x: 7.9, y: 2 }, w: 6.6, d: 3.6, top: LOFT_TOP, name: "Loft", guardLeft: { kind: "glass", height: 1.1 } }),
    // The walk-in closet's wall, standing on the loft.
    wall("closet-wall", { x: 9.75, y: 0.1 }, { x: 9.75, y: 3.9 }, { base: LOFT }),
    // Doors: the front door from the corridor; the WC's sliding door (hikido) parks on the genkan's side of the wall
    // west of it; the laundry's pocket door, at the south end of its wall in line with the bath's, runs into the wall
    // north of it, clear of the vanity; a folding door to the bath.
    opening("entry", "swing", { x: 8.5, y: 3.9 }, 0.85, { side: "left" }),
    opening("wc-door", "sliding", { x: 8.95, y: 2.45 }, 0.7, { side: "left", hinge: "a" }),
    opening("laundry-door", "pocket", { x: 9.4, y: 2.85 }, 0.65, { hinge: "b" }),
    opening("bath-door", "folding", { x: 10.05, y: 2.45 }, 0.7),
    opening("closet-door", "passage", { x: 9.75, y: 3.25 }, 0.8),
    // The balcony end: big sliding glass doors with a window over them, to the ceiling.
    opening("garden", "slidingGlass", { x: 0.1, y: 2 }, 3, { side: "left" }),
    opening("garden-over", "window", { x: 0.1, y: 2 }, 3, { sill: 2.8, head: 4.9 }),
    // The south side: a tall slot in the living room, the kitchen's window, the WC's and the bath's; on the loft, the
    // study's, the bedroom's two and the closet's.
    opening("w-slot", "window", { x: 2.4, y: 0.1 }, 0.9, { sill: 0.45, head: 4.6 }),
    opening("w-kitchen", "window", { x: 6.1, y: 0.1 }, 1.8, { sill: 1, head: 2.1 }),
    opening("w-wc", "window", { x: 9.05, y: 0.1 }, 0.5, { sill: 1.4, head: 2 }),
    opening("w-bath", "window", { x: 10.45, y: 0.1 }, 0.7, { sill: 1.2, head: 2 }),
    opening("w-study", "window", { x: 5.8, y: 0.1 }, 2, { sill: 3.25, head: 4.6 }), // over the cube shelf (showcase.04)
    opening("w-bed", "window", { x: 8, y: 0.1 }, 0.8, { sill: 3.45, head: 4.5, sheer: "glass" }), // over the headboard
    opening("w-bed2", "window", { x: 9.05, y: 0.1 }, 0.6, { sill: 3.3, head: 4.5 }),
    opening("w-closet", "window", { x: 10.25, y: 0.1 }, 0.5, { sill: 3.6, head: 4.4 }),
    // Rooms and floors: oak through the open room, tiles in the wet rooms, wide planks on the loft; the kitchen and
    // the genkan as areas of the open room.
    fixed({ type: "labelZone", id: "tokyo-living", at: { x: 2.4, y: 2 }, name: "Living room", finish: motifDefaults("planks") }),
    fixed({ type: "labelZone", id: "tokyo-wc", at: { x: 9.05, y: 1.2 }, name: "WC", finish: F.slate }),
    fixed({ type: "labelZone", id: "tokyo-bath", at: { x: 10.4, y: 1.2 }, name: "Bath", finish: F.slate }),
    fixed({ type: "labelZone", id: "tokyo-laundry", at: { x: 10.3, y: 3.1 }, name: "Laundry", finish: motifDefaults("largeTiles") }),
    // Finishes (surfaces, showcase.02): a flat in a concrete shell: warm sand plaster in the open room, the bath tiled to
    // 1.20 in large stone tiles on a slate floor, the WC in teal tiles to 1.20, the laundry grey. Under its flat ceiling it has no
    // roof and its outside is the building's.
    ...roomWalls("tokyo-living", F.sand),
    ...roomWalls("tokyo-bath", F.white, { finish: F.stone, height: 1.2 }),
    ...roomWalls("tokyo-wc", F.white, { finish: F.zellige, height: 1.2 }),
    ...roomWalls("tokyo-laundry", F.concrete),
    fixed({ type: "setDeckFinish", deckId: LOFT, finish: { ...motifDefaults("widePlanks"), colour: "#b9a688" } }),
    fixed({ type: "addArea", opId: "kitchen", at: { x: 6.225, y: 2 }, w: 3.25, d: 3.6, name: "Kitchen" }),
    fixed({ type: "addArea", opId: "genkan", at: { x: 8.625, y: 3.15 }, w: 1.55, d: 1.3, name: "Genkan" }),
    // Up to the loft: an open stair along the north wall, its top at the loft's edge.
    fixed({ type: "placeStair", opId: "stair", state: L, kind: "openStair", deck: LOFT, at: { x: 4.6, y: 3.35 }, shape: "straight", surface: null }),
    // The living room, facing the glass: a two-seat sofa with its back to the kitchen, leaving a 0.8 m way past it beside
    // the stair; a rug and a coffee table, an armchair by the glass, a palm and a fern.
    piece("sofa", L, "sofa", { x: 3.6, y: 1.35 }, 0.9, 270, { preset: "2 seats" }),
    piece("rug", L, "rug", { x: 2.3, y: 1.35 }, 1.4, 90, { preset: "200" }),
    sized("coffee", "coffeeTable", { x: 2.3, y: 1.35 }, 1.1, 0.6, 90),
    piece("armchair", L, "armchair", { x: 0.9, y: 2.3 }, 0.8, 90),
    piece("palm", L, "palm", { x: 0.96, y: 0.85 }, 1.2, 0, { preset: "120" }), // 0.16 m off the glass doors (showcase.04)
    piece("fern", L, "fern", { x: 1.9, y: 0.5 }, 0.6, 0, { preset: "60" }),
    // The kitchen along the north wall, a tall wall of fridge and pantries facing it from the WC's wall, and the island:
    // the sink and a counter, three stools on the living room's side.
    piece("counter1", L, "counter", { x: 5.15, y: 3.5 }, 0.6, 0, { preset: "90" }),
    piece("range", L, "range", { x: 5.9, y: 3.5 }, 0.6, 0, { preset: "60" }),
    piece("hood", L, "cookerHood", { x: 5.9, y: 3.55 }, 0.5, 0, { preset: "Chimney" }),
    piece("counter2", L, "counter", { x: 6.5, y: 3.5 }, 0.6, 0, { preset: "60" }),
    piece("dish", L, "dishwasher", { x: 7.1, y: 3.5 }, 0.6, 0, { preset: "60" }),
    piece("fridge", L, "fridge", { x: 8.125, y: 2.1 }, 0.65, 270, { preset: "Tall" }),
    piece("pantry1", L, "tallPantry", { x: 8.15, y: 1.4 }, 0.6, 270, { preset: "80" }),
    piece("pantry2", L, "tallPantry", { x: 8.15, y: 0.6 }, 0.6, 270, { preset: "80" }),
    piece("island-sink", L, "sinkUnit", { x: 5.5, y: 1.9 }, 0.6, 180, { preset: "120" }),
    piece("island-counter", L, "counter", { x: 6.4, y: 1.9 }, 0.6, 180, { preset: "60" }),
    piece("stool1", L, "stool", { x: 5.2, y: 1.3 }, 0.4, 0, { preset: "Counter" }),
    piece("stool2", L, "stool", { x: 5.8, y: 1.3 }, 0.4, 0, { preset: "Counter" }),
    piece("stool3", L, "stool", { x: 6.4, y: 1.3 }, 0.4, 0, { preset: "Counter" }),
    // The genkan: a tall shoe cabinet (getabako) on its east wall beside the front door, leaving the genkan open to the
    // kitchen, 1.3 m wide between the WC's wall and the north wall.
    sized("shoes", "wardrobe", { x: 9.15, y: 3.5 }, 0.6, 0.4, 270, { name: "Shoe cabinet" }),
    // The laundry (datsuijo): the stacked washer-dryer and the vanity. The WC and the bath.
    piece("washer", L, "washingMachine", { x: 10.85, y: 3.5 }, 0.6, 0, { preset: "Washer-dryer" }),
    piece("vanity", L, "vanityUnit", { x: 9.95, y: 3.55 }, 0.5, 0, { preset: "80" }),
    piece("wc", L, "toilet", { x: 9.05, y: 0.525 }, 0.65, 180, { preset: "Standard" }),
    piece("tub", L, "bathtub", { x: 10.425, y: 0.55 }, 0.7, 180, { preset: "150" }),
    piece("shower", L, "showerTray", { x: 10.8, y: 2 }, 0.8, 270, { preset: "80" }),
    // The loft. The study: a 2.2 m desk along the glass, two chairs pushed in under it, low shelves under the window
    // between them and the bookcases' zones (loft zones warn, loft.07), a fern on those shelves.
    sized("desk", "desk", { x: 5.075, y: 1.45 }, 2.2, 0.75, 90, onLoft),
    fixed({ type: "placeObject", opId: "chair1", state: L, object: { kind: "chair" }, at: anchorAt({ x: 5.4, y: 1 }, 0.5, 270), rotation: 270, deck: LOFT }),
    fixed({ type: "placeObject", opId: "chair2", state: L, object: { kind: "chair" }, at: anchorAt({ x: 5.4, y: 1.9 }, 0.5, 270), rotation: 270, deck: LOFT }),
    piece("cubes", L, "shelf", { x: 6.2, y: 0.395 }, 0.39, 180, { ...onLoft, preset: "Cube" }),
    // The fern stands on the cube shelf under the study's window, as the user put it in the showcase review; the shelf's
    // front zone is off.
    ...raised("loft-fern", L, "fern", FREE, { x: 6.212, y: 0.404 }, { w: 0.4, d: 0.4, h: 0.8 }, 0.77, 180, LOFT),
    (doc) => ({ type: "setZoneSides", placementId: placementIn(doc, "cubes/o0", L), sides: { front: false, back: false, left: false, right: false } }),
    // The wall of books between the study and the bedroom, facing the study; one more facing the bedroom past the bed's
    // head, where it can be reached.
    ...[0.6, 1.4, 2.2].map((y, i): Step => piece(`books-study${i}`, L, "shelf", { x: 7.15, y }, 0.3, 270, { ...onLoft, preset: "Bookcase" })),
    piece("books-bed2", L, "shelf", { x: 7.45, y: 2.2 }, 0.3, 90, { ...onLoft, preset: "Bookcase" }),
    // The bedroom: a double bed under the window, its head to the books, so its zone on the window side is off; the way
    // to the closet runs past its other side (the clearance walk).
    piece("bed", L, "bed", { x: 8.65, y: 0.95 }, 2.1, 90, { ...onLoft, preset: "Double" }),
    (doc) => ({ type: "setZoneSides", placementId: placementIn(doc, "bed/o0", L), sides: { front: false, back: false, left: false, right: true } }),
    // The walk-in closet: a 2.5 m wardrobe along the end wall and a chest of drawers.
    sized("wardrobe", "wardrobe", { x: 10.9, y: 1.5 }, 2.5, 0.6, 270, onLoft),
    piece("drawers", L, "drawers", { x: 10.95, y: 3.3 }, 0.5, 270, { ...onLoft, preset: "80" }),
    // Lived in (showcase.03): coat hooks in the genkan beside the laundry's door, a large poster behind the sofa, a canvas
    // high over the stair, a clock over the dishwasher, a rosette on the island; in the WC a mirror and a towel rail, in the
    // bath a mirror and a towel rail over the tub's head end; in the laundry a mirror over the vanity
    // (the bath door's swing and the washer's zone take its south wall).
    piece("hooks", L, "coatHooks", { x: 9.31, y: 2.85 }, 0.08, 270, { preset: "60" }),
    piece("poster", L, "picture", { x: 3.6, y: 0.215 }, 0.03, 180, { preset: "Large poster" }),
    ...raised("canvas", L, "picture", FREE, { x: 2.4, y: 3.78 }, { w: 0.6, d: 0.04, h: 0.6 }, 2.7, 0), // over the stair
    ...raised("clock", L, "clock", FREE, { x: 7.1, y: 3.775 }, { w: 0.3, d: 0.05, h: 0.3 }, 1.7, 0), // over the dishwasher
    ...raised("rosette", L, "rosette", FREE, { x: 6.45, y: 1.9 }, { w: 0.3, d: 0.3, h: 0.3 }, 0.9, 180), // on the island
    piece("wc-mirror", L, "mirror", { x: 8.565, y: 1.4 }, 0.03, 90, { preset: "Small" }),
    piece("wc-rail", L, "towelRail", { x: 9.5, y: 1.4 }, 0.1, 270, { preset: "Small" }),
    piece("bath-mirror", L, "mirror", { x: 9.665, y: 1.25 }, 0.03, 90, { preset: "Small" }),
    ...raised("bath-rail", L, "towelRail", FREE, { x: 9.88, y: 0.25 }, { w: 0.4, d: 0.1, h: 0.8 }, 0.85, 180), // over the tub's head end, clear of its tap and its window
    piece("laundry-mirror", L, "mirror", { x: 9.95, y: 3.785 }, 0.03, 0, { preset: "Small" }),
    // A section along the apartment, looking north: the double height, the stair, the kitchen, the loft's rooms.
    fixed({ type: "addSection", a: { x: -0.4, y: 1.75 }, b: { x: 11.8, y: 1.75 }, side: 1 }),
  ];
}
