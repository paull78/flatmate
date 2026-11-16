// The 20 ft studio on wheels (samples.01, brief 1 in recordings/prompts.md), as the user arranged it in the sample
// review (review.01): one arrangement shared by Day and Night, linked (review.05), which differ only in the Murphy bed,
// the table and the chairs.
//
//   y 2.45 ┌──────────┬╌╌┬──────────────────────────────────────────┐
//          │ shower   │ladder      sofa under the two-leaf  folding │  loft over x 0.10–2.00, top 2.15,
//          │          bookcase     window, mini-split above  table   │  a 0.40 m railing on its open edge
//          │ Bathroom barn ┊                                  (open  │
//          │ (window) door  ┊                                 by Day,│  shed roof 2.90 (south) to 3.30
//          │          bookcase                          chairs tucked│
//          │ toilet  vanity   door   sink  range   fridge   Murphy   │
//   y 0.10 └──────────┴──┴──╱╱────────────────────────────────bed────┘
//         x 0.10     1.55 1.65  2.21–3.01 3.05 3.85  4.35  4.95–5.95 6.00
//
// By Night the Murphy bed comes down across the room, the table folds flat against the north wall and the chairs go: the
// chairs are Day's only (an exception), everything else stands in both. On wheels: the hitch at the bathroom end, two
// axles, a tongue box, steps at the door (drawn by the trailer).
import { anchorAt, motifDefaults, rectangleRoom } from "@fm/domain";
import type { Command, Document } from "@fm/domain";
import { SAMPLE_FINISHES as F, outsideWalls, fixed, opening, piece, placementIn, raised, roomWalls, wallThrough } from "../seed-kit";
import type { Step } from "../seed-kit";

const DAY = "s0";
const NIGHT = "n/s0";
const LOFT = "loft/k0";
const FREE = { x: 2.9, y: 1.2 }; // open floor in both layouts, where a raised piece is placed before it moves
const atNight = (doc: Document, object: string): string => placementIn(doc, object, NIGHT);
/** One per-layout command for the object's placement in Day and in Night (zones are a layout's own, review.05). */
const both = (object: string, cmd: (placementId: string) => Command): Step[] => [DAY, NIGHT].map((state) => (doc) => cmd(placementIn(doc, object, state)));

export function studio20ftSteps(): Step[] {
  return [
    // The shell: 6.10 × 2.55 m outside, 0.10 m walls; the bathroom's partition kept under the loft's slab.
    ...rectangleRoom({ x: 0.05, y: 0.05 }, 6, 2.45, "shell", 0.1).map(fixed),
    fixed({ type: "setCeiling", shape: "shed", height: 2.9, highSide: 3.3, falls: "-y" }),
    fixed({ type: "addWall", opId: "part", from: { at: { x: 1.6, y: 0.05 } }, to: { at: { x: 1.6, y: 2.5 } }, thickness: 0.1 }),
    (doc) => ({ type: "setWallTop", wallId: wallThrough(doc, { x: 1.6, y: 1.2 }).wall, top: 2.03 }),
    // The sleeping loft over the bathroom, open to the room on its east edge behind a low railing.
    fixed({ type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.05, y: 1.275 }, w: 1.9, d: 2.35, name: "Sleeping loft", guardRight: { kind: "railing", height: 0.4 } }),
    // Doors: the entrance swinging out, a low sliding barn door under the loft.
    opening("entry", "swing", { x: 2.61, y: 0.05 }, 0.8, { side: "right" }),
    opening("barn", "sliding", { x: 1.6, y: 1.35 }, 0.7, { side: "right", head: 1.93 }),
    // Windows: one at loft level in the west end with the bathroom's under it, a two-leaf over the sofa, one over the
    // sink, the east end's and a small one over the vanity.
    opening("w-loft", "window", { x: 0.05, y: 1.3 }, 0.8, { sill: 2.3, head: 2.75 }),
    opening("w-bath-west", "window", { x: 0.05, y: 1.25 }, 0.8, { sill: 0.9, head: 2.1 }), // clear of the shower (showcase.04)
    opening("w-north", "twoLeaf", { x: 3.6, y: 2.5 }, 2, { sill: 1.1, head: 2.4, sheer: "glass" }), // a sill-length sheer over the sofa
    opening("w-south", "window", { x: 3.45, y: 0.05 }, 0.7, { sill: 0.9, head: 2.1 }),
    opening("w-east", "window", { x: 6.05, y: 1.4 }, 0.8, { sill: 0.9, head: 2.1 }),
    opening("w-bath", "window", { x: 1.05, y: 0.05 }, 0.5, { sill: 1.4, head: 1.9 }),
    fixed({ type: "labelZone", id: "studio20-bath", at: { x: 0.8, y: 1.3 }, name: "Bathroom", finish: F.cement }),
    fixed({ type: "labelZone", id: "studio20-main", at: { x: 3.8, y: 1.3 }, name: "Main room", finish: motifDefaults("planks") }),
    // Finishes (surfaces, showcase.02): cedar boards outside, sage walls over a painted board band in the main room, the
    // bathroom's teal tiles to 1.20 under white paint on a patterned cement floor, a standing-seam roof.
    outsideWalls(F.cedar), // the house's outside walls (inherit.07)
    ...roomWalls("studio20-main", F.sage, { finish: F.wainscot, height: 1 }),
    ...roomWalls("studio20-bath", F.white, { finish: F.zellige, height: 1.2 }),
    fixed({ type: "setRoofCovering", finish: motifDefaults("standingSeam") }),
    // Day and Night from the start, so every piece placed from here is in both (review.05).
    fixed({ type: "renameState", stateId: DAY, name: "Day" }),
    fixed({ type: "addState", opId: "n", name: "Night" }),
    // Up to the loft, and its mattress.
    fixed({ type: "placeStair", opId: "ladder", state: DAY, kind: "rungLadder", deck: LOFT, at: { x: 2, y: 2.225 }, shape: "straight", surface: null }),
    piece("mat", DAY, "mattress", { x: 1, y: 1.3 }, 2, 0, { deck: LOFT, preset: "Small double" }),
    // The bathroom.
    piece("shower", DAY, "showerTray", { x: 0.5, y: 2.05 }, 0.8, 0),
    piece("wc", DAY, "toilet", { x: 0.38, y: 0.4 }, 0.6, 180, { preset: "Composting" }),
    piece("vanity", DAY, "vanityUnit", { x: 1.1, y: 0.35 }, 0.5, 180, { preset: "60" }),
    // Two bookcases against the partition either side of the barn door.
    piece("books-s", DAY, "shelf", { x: 1.8, y: 0.5 }, 0.3, 90, { preset: "Bookcase" }),
    piece("books-n", DAY, "shelf", { x: 1.8, y: 2.05 }, 0.3, 90, { preset: "Bookcase" }),
    // The kitchen along the south wall, the sink under its window and the hood clear of it; the sofa on the north wall
    // under the two-leaf window, the mini-split above it.
    piece("sink", DAY, "sinkUnit", { x: 3.45, y: 0.4 }, 0.6, 180, { preset: "80" }),
    piece("range", DAY, "range", { x: 4.1, y: 0.4 }, 0.6, 180, { preset: "50" }),
    piece("hood", DAY, "cookerHood", { x: 4.1, y: 0.35 }, 0.5, 180, { preset: "Chimney" }),
    piece("fridge", DAY, "fridge", { x: 4.65, y: 0.425 }, 0.65, 180, { preset: "Tall" }),
    piece("sofa", DAY, "sofa", { x: 4, y: 2 }, 0.9, 0, { preset: "2 seats" }),
    piece("split", DAY, "wallUnit", { x: 3.6, y: 2.35 }, 0.2, 0, { preset: "Mini-split head" }),
    // Above the window's head (2.40), not in front of its glass: 2.50 to 2.78, under the north eave's 3.30.
    fixed({ type: "setObjectSize", objectId: "split/o0", w: 0.8, d: { standard: 0.2 }, h: { standard: 0.28 }, z: { standard: 2.5 } }),
    // The Murphy bed folded at the east end and the folding table opposite, in both layouts.
    piece("murphy", DAY, "murphyBed", { x: 5.45, y: 0.3 }, 0.4, 180, { preset: "Single" }),
    piece("table", DAY, "foldingTable", { x: 5.35, y: 2.375 }, 0.15, 0),
    // Day: the table open with two chairs tucked under it, Day's only.
    (doc) => ({ type: "setConfiguration", placementId: placementIn(doc, "table/o0", DAY), config: "open" }),
    piece("ch1", DAY, "chair", { x: 5.2, y: 1.55 }, 0.45, 180, { linked: false }), // east of the fridge's door zone (x 4.35–4.95)
    piece("ch2", DAY, "chair", { x: 5.7, y: 1.55 }, 0.45, 180, { linked: false }),
    // Night: the table folded and the bed down across the room; its foot meets the folded table, so no zone by night.
    (doc) => ({ type: "setConfiguration", placementId: atNight(doc, "table/o0"), config: "folded" }),
    (doc) => ({ type: "setConfiguration", placementId: atNight(doc, "murphy/o0"), config: "down" }),
    (doc) => ({ type: "setZoneSides", placementId: atNight(doc, "murphy/o0"), sides: { front: false, back: false, left: false, right: false } }),
    // Lived in (showcase.03): coat hooks beside the door, a clock over it, two frames over the table and one in the loft over
    // the mattress's head, a fern on the fridge, a rosette on the sink by its window and one in the loft
    // (none on a vanity: its height is its tap's, so a plant there floats over the basin);
    // in the bathroom a mirror and a towel rail on the partition, clear of the barn door.
    fixed({ type: "placeObject", opId: "hooks", state: DAY, object: { kind: "coatHooks", size: { w: 0.24, d: 0.08 } }, at: anchorAt({ x: 2.08, y: 0.14 }, 0.08, 180), rotation: 180, deck: null }),
    piece("clock", DAY, "clock", { x: 2.61, y: 0.125 }, 0.05, 180, { preset: "30" }),
    fixed({ type: "setObjectSize", objectId: "clock/o0", w: 0.3, d: { standard: 0.05 }, h: { standard: 0.3 }, z: { standard: 2.25 } }), // over the door's head
    piece("pic1", DAY, "picture", { x: 5.1, y: 2.435 }, 0.03, 0, { preset: "A3 frame" }),
    piece("pic2", DAY, "picture", { x: 5.6, y: 2.435 }, 0.03, 0, { preset: "A3 frame" }),
    ...raised("pic-loft", DAY, "picture", FREE, { x: 1, y: 2.435 }, { w: 0.25, d: 0.03, h: 0.33 }, 0.35, 0, LOFT), // over the mattress's head
    ...raised("fern", DAY, "fern", FREE, { x: 4.7, y: 0.4 }, { w: 0.4, d: 0.4, h: 0.8 }, 1.9, 180), // on the fridge
    ...raised("rosette", DAY, "rosette", FREE, { x: 3.75, y: 0.4 }, { w: 0.2, d: 0.2, h: 0.25 }, 0.9, 180), // on the sink unit, beside its bowl
    piece("rosette-loft", DAY, "rosette", { x: 0.25, y: 0.25 }, 0.3, 0, { deck: LOFT, preset: "30" }),
    piece("mirror", DAY, "mirror", { x: 1.535, y: 0.4 }, 0.03, 270, { preset: "Small" }),
    piece("rail", DAY, "towelRail", { x: 1.5, y: 2.1 }, 0.1, 270, { preset: "Small" }),
    // Room to work and pass, as the user set it (review.01): the kitchen's fronts 0.85 and the fridge's 0.80 deep, so the
    // sofa across the room stays clear; the ladder's 0.67 to the sofa; the north bookcase, behind the ladder, with none.
    ...both("sink/o0", (placementId) => ({ type: "setZoneExtent", placementId, side: "front", extent: { depth: 0.85, start: 0, end: 0 } })),
    ...both("range/o0", (placementId) => ({ type: "setZoneExtent", placementId, side: "front", extent: { depth: 0.85, start: 0, end: 0 } })),
    ...both("fridge/o0", (placementId) => ({ type: "setZoneExtent", placementId, side: "front", extent: { depth: 0.8, start: 0, end: 0 } })),
    ...both("books-n/o0", (placementId) => ({ type: "setZoneSides", placementId, sides: { front: false, back: false, left: false, right: false } })),
    (doc) => ({ type: "setZoneExtent", placementId: placementIn(doc, "ladder/s0/o0", DAY), side: "front", extent: { depth: 0.67, start: 0, end: 0 } }),
    // A section along the house, looking north: the loft over the bathroom, the barn door, the sofa and the table.
    fixed({ type: "addSection", a: { x: -0.3, y: 1.2 }, b: { x: 6.4, y: 1.2 }, side: 1 }),
    // On wheels: the hitch at the bathroom end (the low end of the long side), two axles, a tongue box.
    fixed({ type: "setProjectField", key: "surroundings", value: "wheels" }),
    fixed({ type: "setProjectField", key: "trailerHitch", value: "low" }),
    fixed({ type: "setProjectField", key: "tongueBox", value: "on" }),
  ];
}
