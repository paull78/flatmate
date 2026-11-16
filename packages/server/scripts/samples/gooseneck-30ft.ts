// The 30 ft gooseneck (samples.01, brief 3 in recordings/prompts.md), designed in its seed (samples.20).
//
//   y 2.45 ┌──────────────────┬─────────────┬─────────────────────────────────┬────────────────┐
//          │ wardrobe         │ storage stair ◄── up   door   pantry range sink ┊ washer  shower │
//          │        bed on the│                        (out)   (hood)           ┊                │
//          │ chest  Bedroom   ┊ sofa ──► TV unit  Living room             passage    Bathroom   │
//          │ (foot) deck +1.00┊ (2 seats)  (free-standing)                      ┊                │
//          │          (head)  ┊                               bar table, stools  fridge  vanity toilet rail
//   y 0.10 └──────────────────┴───────────────────────────────────────────────────┴────────────────┘
//         x 0.10            2.80  3.70      4.85–5.25         5.25       6.45  7.25  7.45      9.04
//
// The bedroom stands on a solid deck over where the truck bed would be (Flatmate draws no step in the outside walls), with
// a railing on its open side; the bed's head is against that railing, the chest at its foot, a wardrobe in the corner.
// The sofa stands on the floor with its back to the deck's face, facing a low TV unit that stands free in the room as a
// divider (review.03). A low shed roof, 3.20 on the south side to 3.45 on the north (review.27), leaves at least 2.20 m over
// the bedroom floor and shows the house closed in 3D. Shown with Interior surroundings,
// never On wheels: a flat trailer under a gooseneck would be wrong. Section A runs through the bedroom and the living room.
import { anchorAt, motifDefaults, rectangleRoom } from "@fm/domain";
import { SAMPLE_FINISHES as F, outsideWalls, fixed, opening, piece, placementIn, raised, roomWalls } from "../seed-kit";
import type { Step } from "../seed-kit";

const L = "s0"; // the one layout
const BED = "bedroom/k0";
const FREE = { x: 4.3, y: 1.5 }; // open floor, where a raised piece is placed before it moves

export function gooseneck30ftSteps(): Step[] {
  return [
    // The shell: 9.14 × 2.55 m outside, 0.10 m walls, a low shed roof; the bathroom behind a partition at x 7.45.
    ...rectangleRoom({ x: 0.05, y: 0.05 }, 9.04, 2.45, "shell", 0.1).map(fixed),
    fixed({ type: "setCeiling", shape: "shed", height: 3.2, highSide: 3.45, falls: "-y" }),
    fixed({ type: "addWall", opId: "part", from: { at: { x: 7.45, y: 0.05 } }, to: { at: { x: 7.45, y: 2.5 } }, thickness: 0.1 }),
    // The bedroom deck, solid and 1.0 m high (it starts with a railing, being higher than 0.76).
    fixed({ type: "addDeck", opId: "bedroom", preset: "platform", at: { x: 1.45, y: 1.275 }, w: 2.7, d: 2.35, top: 1, solid: true, name: "Bedroom" }),
    // The entrance in the north wall, swinging out at the stair's foot; an open passage into the bathroom; windows.
    opening("entry", "swing", { x: 4.25, y: 2.5 }, 0.8, { side: "right" }),
    opening("bath", "passage", { x: 7.45, y: 1.3 }, 0.7),
    opening("w-west", "window", { x: 0.05, y: 1.05 }, 0.8, { sill: 1.6, head: 2.4 }),
    opening("w-bed", "window", { x: 1.75, y: 0.05 }, 1, { sill: 1.6, head: 2.5 }),
    opening("w-living", "window", { x: 3.8, y: 0.05 }, 1, { sill: 1.4, head: 2.3, sheer: "glass" }),
    opening("w-bar", "window", { x: 6, y: 0.05 }, 1, { sill: 1.1, head: 2.1 }),
    opening("w-sink", "casement", { x: 6.85, y: 2.5 }, 0.6, { sill: 1.1, head: 2 }),
    opening("w-bath", "window", { x: 9.09, y: 1.1 }, 0.5, { sill: 1.5, head: 2 }),
    fixed({ type: "labelZone", id: "goose30-living", at: { x: 5, y: 1.3 }, name: "Living room", finish: motifDefaults("widePlanks") }),
    fixed({ type: "labelZone", id: "goose30-bath", at: { x: 8.3, y: 1.3 }, name: "Bathroom", finish: F.mosaic }),
    // Finishes (surfaces, showcase.02): weathered vertical boards outside, sand walls over wide planks inside, the bathroom in large
    // stone tiles to 1.20 on a mosaic floor, a corrugated roof.
    outsideWalls(F.weathered), // the house's outside walls (inherit.07)
    ...roomWalls("goose30-living", F.sand),
    ...roomWalls("goose30-bath", F.white, { finish: F.stone, height: 1.2 }),
    fixed({ type: "setRoofCovering", finish: motifDefaults("corrugated") }),
    // A storage stair along the north wall up to the bedroom.
    fixed({ type: "placeStair", opId: "stair", state: L, kind: "storageStair", deck: BED, at: { x: 2.8, y: 2.15 }, shape: "straight", surface: null }),
    // The bedroom: the bed's head against the railing, the chest at its foot, a 0.80 m wardrobe in the corner.
    piece("bed", L, "bed", { x: 1.75, y: 0.85 }, 2.1, 270, { deck: BED, preset: "Double" }),
    piece("chest", L, "storageChest", { x: 0.475, y: 0.85 }, 0.45, 90, { deck: BED, preset: "80" }),
    fixed({ type: "placeObject", opId: "wardrobe", state: L, object: { kind: "wardrobe", size: { w: 0.8, d: 0.6 } }, at: anchorAt({ x: 0.4, y: 2.05 }, 0.6, 90), rotation: 90, deck: BED }),
    // The living room (review.03): the sofa on the floor, its back to the deck's face, facing east to a 1.00 m TV unit
    // that stands free as a low divider; the sofa's front zone 0.35 deep, as the user set it, up to the TV. The TV unit
    // stands 0.10 m off the south wall, so 0.65 m stays between it and the pantry, the way into the kitchen (the clearance walk).
    piece("sofa", L, "sofa", { x: 3.25, y: 0.9 }, 0.9, 90, { preset: "2 seats" }),
    (doc) => ({ type: "setZoneExtent", placementId: placementIn(doc, "sofa/o0", L), side: "front", extent: { depth: 0.35, start: 0, end: 0 } }),
    fixed({ type: "placeObject", opId: "tv", state: L, object: { kind: "tvUnit", size: { w: 1, d: 0.4 } }, at: anchorAt({ x: 5.05, y: 0.7 }, 0.4, 270), rotation: 270, deck: null }),
    // The kitchen along the north wall; the fridge and a bar table with two stools along the south window.
    piece("pantry", L, "tallPantry", { x: 5.55, y: 2.15 }, 0.6, 0, { preset: "60" }),
    piece("range", L, "range", { x: 6.15, y: 2.15 }, 0.6, 0, { preset: "60" }),
    piece("hood", L, "cookerHood", { x: 6.15, y: 2.2 }, 0.5, 0, { preset: "Chimney" }),
    piece("sink", L, "sinkUnit", { x: 6.85, y: 2.15 }, 0.6, 0, { preset: "80" }),
    piece("fridge", L, "fridge", { x: 7.1, y: 0.425 }, 0.65, 180, { preset: "Tall" }),
    piece("bar", L, "barTable", { x: 6, y: 0.4 }, 0.6, 180, { preset: "120" }),
    piece("stool1", L, "stool", { x: 5.7, y: 0.55 }, 0.4, 180, { preset: "Bar" }),
    piece("stool2", L, "stool", { x: 6.3, y: 0.55 }, 0.4, 180, { preset: "Bar" }),
    // The bathroom: shower and washer along the north wall, vanity and toilet along the south, a heated towel rail.
    piece("shower", L, "showerTray", { x: 8.64, y: 2.05 }, 0.8, 0, { preset: "80" }),
    piece("washer", L, "washingMachine", { x: 7.85, y: 2.15 }, 0.6, 0, { preset: "Washer" }),
    piece("wc", L, "toilet", { x: 8.675, y: 0.4 }, 0.6, 180, { preset: "Composting" }),
    piece("vanity", L, "vanityUnit", { x: 7.95, y: 0.35 }, 0.5, 180, { preset: "60" }),
    piece("rail", L, "towelRail", { x: 8.99, y: 0.4 }, 0.1, 270),
    // Lived in (showcase.03): coat hooks between the door and the pantry, two frames on the south wall clear of the
    // zones, a clock over the bathroom's passage, a fern on the pantry, rosettes on the bar, on the bedroom's chest and on
    // the washer, and a bathroom mirror over the vanity.
    piece("hooks", L, "coatHooks", { x: 4.95, y: 2.41 }, 0.08, 0, { preset: "60" }),
    piece("frame1", L, "picture", { x: 3.05, y: 0.115 }, 0.03, 180, { preset: "A3 frame" }),
    piece("frame2", L, "picture", { x: 4.55, y: 0.115 }, 0.03, 180, { preset: "A3 frame" }),
    ...raised("clock", L, "clock", FREE, { x: 7.375, y: 1.3 }, { w: 0.3, d: 0.05, h: 0.3 }, 2.25, 270), // over the passage
    ...raised("fern", L, "fern", FREE, { x: 5.55, y: 2.2 }, { w: 0.4, d: 0.4, h: 0.8 }, 2.1, 0), // on the pantry
    ...raised("rosette", L, "rosette", FREE, { x: 6.45, y: 0.3 }, { w: 0.3, d: 0.3, h: 0.3 }, 1.05, 180), // on the bar
    ...raised("rosette-bed", L, "rosette", FREE, { x: 0.475, y: 0.65 }, { w: 0.3, d: 0.3, h: 0.3 }, 0.5, 90, BED), // on the chest
    ...raised("rosette-bath", L, "rosette", FREE, { x: 7.85, y: 2.15 }, { w: 0.3, d: 0.3, h: 0.3 }, 0.85, 0), // on the washer (a vanity's height is its tap's)
    piece("mirror", L, "mirror", { x: 7.95, y: 0.115 }, 0.03, 180, { preset: "Bathroom" }),
    // Section A through the bedroom and the living room; Interior surroundings.
    fixed({ type: "addSection", a: { x: 0.3, y: 1.25 }, b: { x: 6.5, y: 1.25 }, side: 1, depth: null }),
    fixed({ type: "setProjectField", key: "surroundings", value: "interior" }),
  ];
}
