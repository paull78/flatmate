// The 28 ft house with two lofts (samples.01, brief 2 in recordings/prompts.md), designed in the sample review
// (review.02) in place of the 24 ft: longer, wood floors, a bathtub, a kitchen with a bar and stools, a TV and books.
//
//   y 2.45 ┌──────────┬───────────────────────────────────────────────┬─────────────────────┐
//          │ washer-  │ship's ladder   TV unit, shelf over it    ladder│ bar table + stools   │  main loft x 0.10–2.40
//          │ dryer  vanity  ↑                                         │                      │  (Double), top 2.15
//          │ tub      pocket   Living room       rug                  │   Kitchen            │  guest loft x 7.20–8.43
//          │          │ door                                          │                      │  (Small double), top 2.15,
//          │ (window) toilet cabinet   door  plant  sofa (3 seats)    │ range sink counter fridge  a 0.40 m railing on its
//   y 0.10 └──────────┴───────╱╱──────────────────────────────────────┴─────────────────────┘  open edge
//         x 0.10     2.00     2.35–3.15        4.20–5.80            6.10                8.43
//
// A gable roof along the length, 2.80 at the eaves and 3.35 at the ridge; wood planks in the living room, large tiles in
// the bathroom, grey wide planks on both lofts. On wheels, three axles.
import { motifDefaults, rectangleRoom } from "@fm/domain";
import { SAMPLE_FINISHES as F, outsideWalls, fixed, opening, piece, raised, roomWalls, wallThrough } from "../seed-kit";
import type { Step } from "../seed-kit";

const L = "s0";
const BIG = "loftW/k0";
const SMALL = "loftE/k0";
const X = 8.43; // the inside's east face
const FREE = { x: 3.2, y: 1.4 }; // open floor, where a raised piece is placed before it moves

export function twoLofts28ftSteps(): Step[] {
  return [
    ...rectangleRoom({ x: 0.05, y: 0.05 }, 8.43, 2.45, "shell", 0.1).map(fixed),
    fixed({ type: "setCeiling", shape: "gable", height: 2.8, highSide: 3.35, falls: "-y" }),
    fixed({ type: "addWall", opId: "part", from: { at: { x: 2.05, y: 0.05 } }, to: { at: { x: 2.05, y: 2.5 } }, thickness: 0.1 }),
    (doc) => ({ type: "setWallTop", wallId: wallThrough(doc, { x: 2.05, y: 1.2 }).wall, top: 2.03 }),
    fixed({ type: "addDeck", opId: "loftW", preset: "loft", at: { x: 1.25, y: 1.275 }, w: 2.3, d: 2.35, name: "Main loft" }),
    fixed({ type: "addDeck", opId: "loftE", preset: "loft", at: { x: (7.2 + X) / 2, y: 1.275 }, w: X - 7.2, d: 2.35, name: "Guest loft", guardLeft: { kind: "railing", height: 0.4 } }),
    // Doors.
    opening("entry", "swing", { x: 2.75, y: 0.05 }, 0.8, { side: "right" }),
    opening("bath", "pocket", { x: 2.05, y: 1.3 }, 0.7, { side: "right", head: 1.93 }),
    // Windows: both gable ends at loft level, the bathroom's over the tub, a two-leaf over the sofa, one over the sink,
    // a wide one over the bar.
    opening("w-west-loft", "window", { x: 0.05, y: 1.275 }, 0.8, { sill: 2.4, head: 2.85 }), // over the mattress's top (showcase.04)
    opening("w-bath", "window", { x: 0.05, y: 0.95 }, 0.6, { sill: 1.2, head: 1.8 }),
    opening("w-sofa", "twoLeaf", { x: 5, y: 0.05 }, 1.6, { sill: 1, head: 2.1, sheer: "glass" }), // a sill-length sheer over the sofa
    opening("w-sink", "window", { x: 7.1, y: 0.05 }, 0.6, { sill: 1.1, head: 1.9 }),
    opening("w-bar", "window", { x: 7.83, y: 2.5 }, 1, { sill: 1.1, head: 1.9 }),
    opening("w-east-loft", "window", { x: 8.48, y: 1.275 }, 0.6, { sill: 2.4, head: 2.85 }),
    // Rooms, floors and the kitchen's area: oak planks through the house, large tiles in the bathroom, grey oak on the lofts.
    fixed({ type: "labelZone", id: "lofts28-bath", at: { x: 1.05, y: 1.3 }, name: "Bathroom", finish: F.slate }),
    fixed({ type: "labelZone", id: "lofts28-living", at: { x: 4.2, y: 1.5 }, name: "Living room", finish: motifDefaults("planks") }),
    // Finishes (surfaces, showcase.02): larch boards outside, clay walls in the living room, the bathroom in sage subway
    // tiles to 1.20 on a slate floor, a standing-seam roof.
    outsideWalls(F.larch), // the house's outside walls (inherit.07)
    ...roomWalls("lofts28-living", F.clay),
    ...roomWalls("lofts28-bath", F.white, { finish: F.subwaySage, height: 1.2 }),
    fixed({ type: "setRoofCovering", finish: motifDefaults("standingSeam") }),
    fixed({ type: "setDeckFinish", deckId: BIG, finish: { ...motifDefaults("widePlanks"), colour: "#a99c8a" } }),
    fixed({ type: "setDeckFinish", deckId: SMALL, finish: { ...motifDefaults("widePlanks"), colour: "#a99c8a" } }),
    fixed({ type: "addArea", opId: "kitchen", at: { x: (6.1 + X) / 2, y: 1.275 }, w: X - 6.1, d: 2.35, name: "Kitchen" }),
    // Up to the lofts: a ship's ladder to the main loft, a rung ladder to the guest loft, both from the north wall.
    fixed({ type: "placeStair", opId: "stair", state: L, kind: "shipsLadder", deck: BIG, at: { x: 2.4, y: 2.15 }, shape: "straight", surface: null }),
    fixed({ type: "placeStair", opId: "ladder", state: L, kind: "rungLadder", deck: SMALL, at: { x: 7.2, y: 2.2 }, shape: "straight", surface: null }),
    piece("bed", L, "mattress", { x: 1.15, y: 1.275 }, 2, 0, { deck: BIG, preset: "Double" }),
    piece("guestbed", L, "mattress", { x: 7.815, y: 1.275 }, 2, 0, { deck: SMALL, preset: "Small double" }),
    // The bathroom: a tub along the end wall, the washer-dryer beyond it, the vanity and the toilet facing each other.
    piece("tub", L, "bathtub", { x: 0.475, y: 0.95 }, 0.75, 90, { preset: "170 × 75" }),
    piece("washer", L, "washingMachine", { x: 0.4, y: 2.15 }, 0.6, 90, { preset: "Washer-dryer" }),
    piece("vanity", L, "vanityUnit", { x: 1.7, y: 2.2 }, 0.5, 0, { preset: "60" }),
    piece("wc", L, "toilet", { x: 1.75, y: 0.425 }, 0.65, 180, { preset: "Standard" }),
    // The living room: a half-glass cabinet by the door, a three-seat sofa under the two-leaf window, the TV across from it with
    // books on wall shelves over it, a rug between.
    piece("books", L, "halfGlassCabinet", { x: 2.25, y: 0.5 }, 0.3, 90, { preset: "80" }), // under the loft's slab (2.03)
    piece("plant", L, "plant", { x: 3.55, y: 0.35 }, 0.4, 0, { preset: "40" }),
    piece("sofa", L, "sofa", { x: 5, y: 0.55 }, 0.9, 180, { preset: "3 seats" }),
    piece("rug", L, "rug", { x: 5, y: 1.45 }, 1.4, 0, { preset: "200" }),
    piece("tv", L, "tvUnit", { x: 5.02, y: 2.25 }, 0.4, 0, { preset: "120" }),
    piece("shelf1", L, "shelf", { x: 5.02, y: 2.325 }, 0.25, 0, { preset: "Wall shelf" }),
    // The kitchen along the south wall, a counter-height bar with two stools under the north window, below the guest loft.
    piece("range", L, "range", { x: 6.4, y: 0.4 }, 0.6, 180, { preset: "60" }),
    piece("hood", L, "cookerHood", { x: 6.4, y: 0.35 }, 0.5, 180, { preset: "Chimney" }),
    piece("sink", L, "sinkUnit", { x: 7.1, y: 0.4 }, 0.6, 180, { preset: "80" }),
    piece("counter", L, "counter", { x: 7.65, y: 0.4 }, 0.6, 180, { preset: "30" }),
    piece("fridge", L, "fridge", { x: 8.13, y: 0.425 }, 0.65, 180, { preset: "Tall" }),
    piece("bar", L, "barTable", { x: 7.83, y: 2.15 }, 0.6, 0, { preset: "Counter height" }),
    piece("stool1", L, "stool", { x: 7.55, y: 2.15 }, 0.4, 0, { preset: "Counter" }),
    piece("stool2", L, "stool", { x: 8.12, y: 2.15 }, 0.4, 0, { preset: "Counter" }),
    // Lived in (showcase.03): coat hooks by the door over the plant, two small frames either side of the window over the
    // sofa (the ladders' zones take the north wall), a canvas by the TV, a clock over the TV's shelf, rosettes on the counter, the washer-dryer and the main loft; in the bathroom a mirror
    // over the vanity and a towel rail at the tub's end, over its rim.
    piece("hooks", L, "coatHooks", { x: 3.5, y: 0.14 }, 0.08, 180, { preset: "60" }),
    ...raised("frame-w", L, "picture", FREE, { x: 4.07, y: 0.115 }, { w: 0.2, d: 0.03, h: 0.3 }, 1.35, 180), // either side of the window, behind the sofa
    ...raised("frame-e", L, "picture", FREE, { x: 5.93, y: 0.115 }, { w: 0.2, d: 0.03, h: 0.3 }, 1.35, 180),
    piece("canvas", L, "picture", { x: 6.12, y: 2.43 }, 0.04, 0, { preset: "Canvas" }),
    ...raised("clock", L, "clock", FREE, { x: 5.02, y: 2.425 }, { w: 0.3, d: 0.05, h: 0.3 }, 1.9, 0), // over the shelf
    ...raised("rosette", L, "rosette", FREE, { x: 7.65, y: 0.3 }, { w: 0.3, d: 0.3, h: 0.3 }, 0.9, 180), // on the counter
    ...raised("rosette-bath", L, "rosette", FREE, { x: 0.4, y: 2.15 }, { w: 0.3, d: 0.3, h: 0.3 }, 1.7, 0), // on the washer-dryer (a vanity's height is its tap's)
    piece("rosette-loft", L, "rosette", { x: 2.15, y: 0.4 }, 0.3, 0, { deck: BIG, preset: "30" }),
    piece("mirror", L, "mirror", { x: 1.7, y: 2.435 }, 0.03, 0, { preset: "Bathroom" }),
    ...raised("rail", L, "towelRail", FREE, { x: 0.15, y: 1.53 }, { w: 0.5, d: 0.1, h: 0.8 }, 0.85, 90), // on the west wall over the tub's side, clear of its tap and its window
    // A section along the house, looking north: both lofts, the ship's ladder, the TV wall and the bar.
    fixed({ type: "addSection", a: { x: -0.3, y: 1.7 }, b: { x: 8.85, y: 1.7 }, side: 1 }),
    fixed({ type: "setProjectField", key: "surroundings", value: "wheels" }),
    fixed({ type: "setProjectField", key: "trailerAxles", value: "3" }),
  ];
}
