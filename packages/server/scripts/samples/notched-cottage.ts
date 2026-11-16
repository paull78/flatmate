// The notched cottage (samples.01, brief 4 in recordings/prompts.md), designed in its seed (samples.20), with the garden
// door and the wood stove moved here from the 24 ft house (samples.21).
//
//   y 5.35 ┌──────────────────────────┬──────────────────────────────┐
//          │ bed (head west)   wardrobe│ fridge sink range+hood counter│  Kitchen
//          │ nightstand     Bedroom    │                              │
//   y 3.15 ├──────────────┬──door─────┤  dining table for four       ║  Dining      gable roof, ridge along x:
//          │ shower   basin    Hall    │  (three collar ties over)    ║ garden door  2.40 at the eaves, 3.60 at the ridge
//          │ toilet Shower room        │                              ║ + window over
//   y 1.75 └──────┬───────┴─passage───┘  stove   sofa, AC over it    │  Living
//          notch  ║ double door, vestibule                            │
//   y 0.25        └────────────────────────────────────────────────────┘
//         x 0.25 1.75     2.05      3.05                            5.75
//
// One level on a foundation, 0.25 m outside walls, 0.10 m inside walls. The double door opens from the entry in
// the notch into the main room, an open passage leads to a short hall, and the hall opens into the bedroom and the
// shower room. The main room has three named areas. Shown with the outside ground.
import { anchorAt, motifDefaults } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { SAMPLE_FINISHES as F, outsideWalls, fixed, opening, piece, placementIn, raised, roomWalls } from "../seed-kit";
import type { Step } from "../seed-kit";

const L = "s0"; // the one layout
const FREE = { x: 4.4, y: 4 }; // open floor, where a raised piece is placed before it moves

// The outside walls' centre lines, 0.25 m thick: 6.0 × 5.6 m outside with a 1.5 × 1.5 m notch at the south-west corner.
const OUTLINE: Point[] = [
  { x: 1.625, y: 0.125 }, { x: 5.875, y: 0.125 }, { x: 5.875, y: 5.475 },
  { x: 0.125, y: 5.475 }, { x: 0.125, y: 1.625 }, { x: 1.625, y: 1.625 },
];
const outline = (): Step[] => OUTLINE.map((from, i) => fixed({
  type: "addWall", opId: `shell-${i + 1}`, from: { at: from }, to: { at: OUTLINE[(i + 1) % OUTLINE.length] ?? from }, thickness: 0.25,
}));
const wall = (opId: string, from: Point, to: Point): Step => fixed({ type: "addWall", opId, from: { at: from }, to: { at: to }, thickness: 0.1 });
const beam = (opId: string, x: number): Step => fixed({
  type: "placeObject", opId, state: L, object: { kind: "beam", preset: "Collar tie", size: { w: 2.4, d: 0.1 } }, at: anchorAt({ x, y: 2.8 }, 0.1, 90), rotation: 90, deck: null,
});

export function notchedCottageSteps(): Step[] {
  return [
    // The L outline, the gable roof, then the inside walls: the vestibule's, the main room's, the bedroom's and the hall's.
    ...outline(),
    fixed({ type: "setCeiling", shape: "gable", height: 2.4, highSide: 3.6, falls: "-y" }),
    wall("entry-wall", { x: 1.625, y: 1.625 }, { x: 3.05, y: 1.625 }),
    wall("main-wall", { x: 3.05, y: 1.625 }, { x: 3.05, y: 5.475 }),
    wall("bed-wall", { x: 0.125, y: 3.15 }, { x: 3.05, y: 3.15 }),
    wall("hall-wall", { x: 2.05, y: 1.625 }, { x: 2.05, y: 3.15 }),
    // Doors and windows; the garden door slides, a fixed window stacked over it.
    opening("entry", "double", { x: 1.625, y: 0.875 }, 1.2, { side: "left" }),
    opening("hall", "passage", { x: 2.55, y: 1.625 }, 0.7),
    opening("bed-door", "swing", { x: 2.55, y: 3.15 }, 0.7, { side: "right", hinge: "b" }),
    opening("shower-door", "pocket", { x: 2.05, y: 2.7 }, 0.7, { side: "right", hinge: "a" }), // a pocket door: the bedroom's swings into the same hall (showcase.30)
    opening("garden", "slidingGlass", { x: 5.875, y: 1.8 }, 1.6, { side: "left" }),
    opening("garden-over", "window", { x: 5.875, y: 1.8 }, 1.6, { sill: 2.2, head: 2.6 }),
    opening("w-entry", "window", { x: 2.4, y: 0.125 }, 0.6, { sill: 1, head: 2 }), // fixed: a casement's leaf would meet the double door's
    opening("w-living", "casement", { x: 5.45, y: 0.125 }, 0.5, { sill: 1, head: 2 }),
    opening("w-sink", "casement", { x: 4.1, y: 5.475 }, 0.6, { sill: 1.1, head: 2 }),
    opening("w-bed", "twoLeaf", { x: 1.3, y: 5.475 }, 1, { sill: 1.1, head: 2.2, sheer: "glass" }),
    opening("w-shower", "window", { x: 1.15, y: 1.625 }, 0.5, { sill: 1.5, head: 2 }),
    // The rooms, and the main room's three areas.
    // Wood planks through the main room, the hall and the bedroom; tiles in the shower room (review.04).
    fixed({ type: "labelZone", id: "cottage-main", at: { x: 3.7, y: 1.5 }, name: "Main room", finish: motifDefaults("planks") }),
    fixed({ type: "labelZone", id: "cottage-bed", at: { x: 1.3, y: 4.3 }, name: "Bedroom", finish: motifDefaults("planks") }),
    fixed({ type: "labelZone", id: "cottage-shower", at: { x: 1, y: 2.4 }, name: "Shower room", finish: F.terracotta }), // square tiles, as the review set (review.24)
    fixed({ type: "labelZone", id: "cottage-hall", at: { x: 2.55, y: 2.4 }, name: "Hall", finish: motifDefaults("planks") }),
    // Finishes (surfaces, showcase.02): wood board and batten outside, sand walls in the main room and the hall, sky in the
    // bedroom, white subway tiles to 1.20 on a terracotta floor in the shower room, a roof of clay tiles.
    outsideWalls(F.battenWood), // the house's outside walls (inherit.07)
    ...roomWalls("cottage-main", F.sand),
    ...roomWalls("cottage-bed", F.sky),
    ...roomWalls("cottage-hall", F.sand),
    ...roomWalls("cottage-shower", F.white, { finish: F.subway, height: 1.2 }),
    fixed({ type: "setRoofCovering", finish: motifDefaults("roofTiles") }),
    fixed({ type: "addArea", opId: "kitchen", at: { x: 4.425, y: 4.5 }, w: 2.65, d: 1.7, name: "Kitchen" }),
    fixed({ type: "addArea", opId: "dining", at: { x: 4.425, y: 2.95 }, w: 2.65, d: 1.4, name: "Dining" }),
    fixed({ type: "addArea", opId: "living", at: { x: 4.425, y: 1.25 }, w: 2.65, d: 2, name: "Living" }),
    // The kitchen.
    piece("fridge", L, "fridge", { x: 3.4, y: 5.025 }, 0.65, 0, { preset: "Tall" }),
    piece("sink", L, "sinkUnit", { x: 4.1, y: 5.05 }, 0.6, 0, { preset: "80" }),
    piece("range", L, "range", { x: 4.8, y: 5.05 }, 0.6, 0, { preset: "60" }),
    piece("hood", L, "cookerHood", { x: 4.8, y: 5.1 }, 0.5, 0, { preset: "Chimney" }),
    piece("counter", L, "counter", { x: 5.4, y: 5.05 }, 0.6, 0, { preset: "60" }),
    // Dining and living; three collar ties, 2.40 m long, hang under the ridge across the main room.
    piece("table", L, "seatedDining", { x: 4.425, y: 3 }, 2, 90, { preset: "4 seats" }),
    piece("sofa", L, "sofa", { x: 4.75, y: 0.7 }, 0.9, 180, { preset: "2 seats" }),
    piece("stove", L, "woodStove", { x: 3.525, y: 0.675 }, 0.75, 180, { preset: "Small" }),
    piece("ac", L, "wallUnit", { x: 4.75, y: 0.375 }, 0.25, 180, { preset: "Through-wall AC" }),
    // High on the wall, 1.80 to 2.20 under the eave's 2.40, as the user raised it in the showcase review.
    fixed({ type: "setObjectSize", objectId: "ac/o0", w: 0.6, d: { standard: 0.25 }, h: { standard: 0.4 }, z: { standard: 1.8 } }),
    // A low TV unit facing the sofa, standing free between the living and dining areas, and a rug between them (review.04).
    piece("tv", L, "tvUnit", { x: 4.75, y: 2.05 }, 0.4, 0, { preset: "120" }),
    piece("rug", L, "rug", { x: 4.75, y: 1.5 }, 1.2, 0, { preset: "160" }),
    beam("tie-1", 3.7),
    beam("tie-2", 4.4),
    beam("tie-3", 5.1),
    // The bedroom: the bed against the north wall, so its zone on that side is off; a 0.60 m wardrobe at its foot.
    piece("bed", L, "bed", { x: 1.3, y: 4.6 }, 2.1, 90, { preset: "Double" }),
    (doc) => ({ type: "setZoneSides", placementId: placementIn(doc, "bed/o0", L), sides: { front: false, back: false, left: true, right: false } }),
    piece("night", L, "nightstand", { x: 0.45, y: 3.575 }, 0.4, 90),
    fixed({ type: "placeObject", opId: "wardrobe", state: L, object: { kind: "wardrobe", size: { w: 0.6, d: 0.6 } }, at: anchorAt({ x: 2.7, y: 5.05 }, 0.6, 0), rotation: 0, deck: null }),
    // The shower room.
    piece("shower", L, "showerTray", { x: 0.65, y: 2.7 }, 0.8, 90, { preset: "80" }),
    piece("wc", L, "toilet", { x: 0.55, y: 1.975 }, 0.6, 90, { preset: "Composting" }),
    piece("basin", L, "washbasin", { x: 1.8, y: 2 }, 0.4, 270, { preset: "50" }),
    // Lived in (showcase.03): coat hooks in the vestibule beside the passage, a plant in its corner by the window, a canvas
    // on the dining wall, a frame over the sofa beside the AC, a clock over the counter, rosettes on the counter, the
    // wardrobe and the nightstand (the kitchen's zone takes the floor by the garden door), a canvas over the bed's head;
    // a mirror over the basin and a towel rail over the toilet in the shower room.
    fixed({ type: "placeObject", opId: "hooks", state: L, object: { kind: "coatHooks", size: { w: 0.4, d: 0.08 } }, at: anchorAt({ x: 1.98, y: 1.535 }, 0.08, 0), rotation: 0, deck: null }),
    piece("plant-entry", L, "plant", { x: 2.83, y: 0.47 }, 0.4, 0, { preset: "40" }),
    piece("canvas", L, "picture", { x: 3.12, y: 2 }, 0.04, 90, { preset: "Canvas" }),
    piece("frame", L, "picture", { x: 4.22, y: 0.265 }, 0.03, 180, { preset: "A3 frame" }),
    ...raised("clock", L, "clock", FREE, { x: 5.4, y: 5.325 }, { w: 0.3, d: 0.05, h: 0.3 }, 1.75, 0), // over the counter
    ...raised("rosette-top", L, "rosette", FREE, { x: 2.7, y: 5.1 }, { w: 0.3, d: 0.3, h: 0.3 }, 2.05, 0), // on the wardrobe
    ...raised("rosette", L, "rosette", FREE, { x: 5.55, y: 5.15 }, { w: 0.3, d: 0.3, h: 0.3 }, 0.9, 0), // on the counter
    ...raised("rosette-bed", L, "rosette", FREE, { x: 0.45, y: 3.575 }, { w: 0.3, d: 0.3, h: 0.3 }, 0.6, 90), // on the nightstand
    piece("canvas-bed", L, "picture", { x: 0.27, y: 4.6 }, 0.04, 90, { preset: "Canvas" }),
    piece("mirror", L, "mirror", { x: 1.985, y: 2 }, 0.03, 270, { preset: "Small" }),
    ...raised("rail", L, "towelRail", FREE, { x: 0.3, y: 1.975 }, { w: 0.45, d: 0.1, h: 0.8 }, 1, 90), // over the toilet
    // A section across the main room through the middle collar tie, looking west: the gable, the kitchen, the table, the
    // TV unit and the sofa.
    fixed({ type: "addSection", a: { x: 4.4, y: -0.3 }, b: { x: 4.4, y: 5.9 }, side: 1 }),
    fixed({ type: "setProjectField", key: "surroundings", value: "outside" }),
  ];
}
