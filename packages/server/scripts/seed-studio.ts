// The furnished Studio (parts step 04): the decks.20 shell, partition, loft and platform, furnished by Day and by Night
// with the kinds drawn as parts, built on the seed kit. A test fixture only (samples.02, .11): the palette sheet renders
// it, the perf spec flips it and the e2e setup seeds it, but people are shown the sample houses instead. It has no
// outside door and no way up to its loft, which the tests don't need.
import { SEAT_BACK, anchorAt, motifDefaults, rectangleRoom } from "@fm/domain";
import type { Document } from "@fm/domain";
import type { Point, ProjectMeta } from "@fm/protocol";
import type { ProjectRepository } from "../src/app/ports";
import { apart, fixed, opening, piece, placementIn, seedProject, wallThrough } from "./seed-kit";
import type { Step } from "./seed-kit";

export const STUDIO_NAME = "Studio";

const DAY = "s0";
const NIGHT = "n/s0";

/** The placement of `object` in the Night layout (copied from Day, so its id isn't known up front). */
const atNight = (doc: Document, object: string): string => placementIn(doc, object, NIGHT);

const NO_ZONES = { front: false, back: false, left: false, right: false };

/**
 * The Day table under the raised lift bed: an extending table, closed, turned 90, so its ends are at x 5.15 and 6.35.
 * Flush with the north wall (y 1.60–2.40), which leaves the kitchen a real 0.90 m aisle (clarity.51).
 */
const TABLE = { x: 5.75, y: 2 };
const KITCHEN_AISLE = 0.9;
const TABLE_D = 1.2;
const CHAIR_D = 0.45;
/** The centre of a chair fully tucked at the table's west (−1) or east (+1) end: its backrest flush with the end (seating.13). */
const tuckedAt = (side: -1 | 1): Point => ({ x: TABLE.x + side * (TABLE_D / 2 + SEAT_BACK - CHAIR_D / 2), y: TABLE.y });

/**
 * The studio, 7 × 2.5 m inside a 0.20 m shell (clear x 0.1–6.9, y 0.1–2.4), with a 3.05 ceiling, laid out as a room
 * that works (studio.01–.03, .07, .08). By Day:
 *
 *   y 2.4 ┌─────────┬───────┬════════════════════┬────────────────────┐
 *         │ shower  │fridge │    sofa 2 seats     │ lift bed up        │
 *         │ (loft   │       │ (bed stowed under)  │ over table, chairs │
 *         │  2.15   door    ├═════╤═══════════════┤ tucked at its ends │
 *         │  above) door    │ step│               │                    │
 *         │ washer  toilet  │ shelf    TV at 1.2  │ sink · hob · counter
 *   y 0.1 └─────────┴───────┴─────────────────────┴──── window ────────┘
 *        x 0.1     1.5     2.6   3.1            4.6                  6.9
 *
 * At Night the step is stowed, the roll-out bed slides out in front of the platform (y 0.45–1.30) and the lift bed
 * comes down. Zones are fitted per layout, so neither layout warns (clarity.51): by Day the kitchen's fronts are its
 * aisle; at Night the bed stands against the kitchen, which isn't in use, so those zones are off. The sofa's front zone
 * stops at the platform's edge in both layouts, and the bed stowed under the platform doesn't block it (smalls.06).
 * The two rooms are labelled and finished (finishes AC-14): the bathroom in mosaic, the main room in planks in light
 * oak, so the platform's mid oak still reads apart in 3D (finishes.25). The loft is laid in wide planks in Grey oak
 * (deck-floors.05, .08), apart from the main room's light oak below it; the platform keeps its oak. It stands on wheels
 * in the 3D view (surroundings.09).
 */
export function studioSteps(): Step[] {
  return apart([
    ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "studio").map(fixed),
    fixed({ type: "setCeiling", height: 3.05 }),
    fixed({ type: "addWall", opId: "part", from: { at: { x: 1.5, y: 0 } }, to: { at: { x: 1.5, y: 2.5 } } }),
    (doc) => ({ type: "setWallTop", wallId: wallThrough(doc, { x: 1.5, y: 1.2 }).wall, top: 2.03 }),
    opening("door", "swing", { x: 1.5, y: 1.2 }, 0.8),
    opening("win-s", "window", { x: 5.2, y: 0 }, 1),
    opening("win-n", "window", { x: 5.8, y: 2.5 }, 1),
    fixed({ type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.3, y: 1.25 }, w: 2.4, d: 2.3, top: 2.15 }),
    fixed({ type: "setDeckFinish", deckId: "loft/k0", finish: { ...motifDefaults("widePlanks"), colour: "#a99c8a" } }),
    fixed({ type: "addDeck", opId: "plat", preset: "platform", at: { x: 3.6, y: 1.85 }, w: 2, d: 1.1, top: 0.45, solid: false }),
    fixed({ type: "renameState", stateId: DAY, name: "Day" }),
    // Shared by both layouts: placed by Day, then copied to Night.
    piece("mat", DAY, "mattress", { x: 1.1, y: 1.25 }, 2, 90, { deck: "loft/k0" }),
    // The roll-out bed: placed in front, lowered to 0.30, then slid under the platform; it slides out at Night.
    piece("roll", DAY, "bed", { x: 3.6, y: 0.875 }, 1.95, 90, { preset: "Small single" }),
    fixed({ type: "setObjectSize", objectId: "roll/o0", w: 0.85, d: { standard: 1.95 }, h: { standard: 0.3 } }),
    fixed({ type: "movePlacement", placementId: "roll/p0", at: anchorAt({ x: 3.6, y: 1.8 }, 1.95, 90), rotation: 90 }),
    piece("sh", DAY, "showerTray", { x: 0.5, y: 2.0 }, 0.8, 0),
    piece("wm", DAY, "washingMachine", { x: 0.4, y: 0.4 }, 0.6, 180),
    piece("wc", DAY, "toilet", { x: 1.0, y: 0.425 }, 0.65, 180, { preset: "Standard" }), // the cistern size, not the new wall-hung default (symbols.06)
    piece("shelf", DAY, "shelf", { x: 2.0, y: 0.3 }, 0.4, 180),
    piece("fr", DAY, "fridge", { x: 1.9, y: 2.075 }, 0.65, 0),
    piece("sofa", DAY, "sofa", { x: 3.85, y: 1.95 }, 0.9, 0, { deck: "plat/k0", preset: "2 seats" }),
    // A TV on the south wall facing the sofa, thin and raised so it reads as wall-mounted (studio.02).
    piece("tv", DAY, "tvUnit", { x: 3.6, y: 0.15 }, 0.1, 180),
    fixed({ type: "setObjectSize", objectId: "tv/o0", w: 1.2, d: { standard: 0.1 }, h: { standard: 0.6 }, z: { standard: 1.2 } }),
    piece("sink", DAY, "sinkUnit", { x: 5.2, y: 0.4 }, 0.6, 180),
    piece("hob", DAY, "hobUnit", { x: 5.9, y: 0.4 }, 0.6, 180),
    piece("ctr", DAY, "counter", { x: 6.5, y: 0.4 }, 0.6, 180),
    piece("wcab", DAY, "wallCabinet", { x: 6.5, y: 0.275 }, 0.35, 180),
    piece("lift", DAY, "liftBed", { x: 5.75, y: 1.55 }, 2.1, 90, { config: "up" }),
    fixed({ type: "copyState", opId: "n", from: DAY, name: "Night" }),
    // By Day only: the table and its two chairs tucked under its ends, under the raised bed, and the step up to the
    // platform (studio.03, seating.13).
    piece("tab", DAY, "extendingTable", TABLE, TABLE_D, 90),
    piece("ch1", DAY, "chair", tuckedAt(-1), CHAIR_D, 90),
    piece("ch2", DAY, "chair", tuckedAt(1), CHAIR_D, 270),
    piece("step", DAY, "block", { x: 2.85, y: 1.15 }, 0.3, 0),
    fixed({ type: "setObjectSize", objectId: "step/o0", w: 0.5, d: { standard: 0.3 }, h: { standard: 0.225 } }),
    fixed({ type: "renameObject", objectId: "step/o0", name: "Step" }),
    // At Night the lift bed comes down and the roll-out bed slides out.
    (doc) => ({ type: "setConfiguration", placementId: atNight(doc, "lift/o0"), config: "down" }),
    (doc) => ({ type: "movePlacement", placementId: atNight(doc, "roll/o0"), at: anchorAt({ x: 3.6, y: 0.875 }, 1.95, 90), rotation: 90 }),
    // Zones (studio.08): none for the stowed bed; out, only its wall side, as deep as the strip; no zone on a wall side.
    fixed({ type: "setZoneSides", placementId: "roll/p0", sides: NO_ZONES }),
    (doc) => ({ type: "setZoneSides", placementId: atNight(doc, "roll/o0"), sides: { ...NO_ZONES, left: true } }),
    (doc) => ({ type: "setZoneExtent", placementId: atNight(doc, "roll/o0"), side: "left", extent: { depth: 0.35, start: 0, end: 0 } }),
    fixed({ type: "setZoneSides", placementId: "lift/p0", sides: { ...NO_ZONES, left: true } }),
    (doc) => ({ type: "setZoneSides", placementId: atNight(doc, "lift/o0"), sides: NO_ZONES }),
    fixed({ type: "setZoneSides", placementId: "tab/p0", sides: { ...NO_ZONES, left: true } }),
    // Fitted to the room (clarity.51): the kitchen's aisle by Day, the kitchen out of use with the bed down at Night.
    ...["sink", "hob", "ctr"].flatMap((unit): Step[] => [
      fixed({ type: "setZoneExtent", placementId: `${unit}/p0`, side: "front", extent: { depth: KITCHEN_AISLE, start: 0, end: 0 } }),
      (doc) => ({ type: "setZoneSides", placementId: atNight(doc, `${unit}/o0`), sides: NO_ZONES }),
    ]),
    // The rooms' labels and floors (finishes AC-14), each label clear of its room's pieces.
    fixed({ type: "labelZone", id: "studio-bath", at: { x: 0.75, y: 1.25 }, name: "Bathroom", finish: motifDefaults("mosaic") }),
    fixed({ type: "labelZone", id: "studio-main", at: { x: 2.2, y: 1.1 }, name: "Main room", finish: { ...motifDefaults("planks"), colour: "#d8bc94" } }),
    // A tiny house on wheels (surroundings.09): the last step, so the earlier changesets keep their ids.
    fixed({ type: "setProjectField", key: "surroundings", value: "wheels" }),
    // Its two parts named (areas.14, .36), after the wheels so every earlier changeset keeps its id: Kitchen over the run and its aisle, Living over the sofa end, sharing x 4.6.
    // The kitchen end is fully furnished, so Kitchen's tag keeps its centre over the run, as a room tag would.
    fixed({ type: "addArea", opId: "studio-kitchen", at: { x: 5.75, y: 0.775 }, w: 2.3, d: 1.35, name: "Kitchen" }),
    fixed({ type: "addArea", opId: "studio-living", at: { x: 3.1, y: 1.25 }, w: 3, d: 2.3, name: "Living" }),
  ]);
}

/** Idempotent: an existing project named STUDIO_NAME is returned as is. */
export async function seedStudio(repository: ProjectRepository): Promise<ProjectMeta> {
  return seedProject(repository, STUDIO_NAME, studioSteps(), "studio");
}
