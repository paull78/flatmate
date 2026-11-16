import type { Arms } from "./arms";
import { ALL, FRONT, FULL_SIDES, NONE, SEATED_HEIGHT, WORKTOP_HEIGHT, one, plain, type ObjectKind } from "./kind-rows";
import { SEATED_REACH } from "./sets";
import { STAIR_RULES } from "./stairs";
import { CLOCK_PRESETS, COAT_HOOKS_PRESETS, COAT_STAND_PRESETS, GLASS_CABINET_PRESETS, MIRROR_PRESETS, PEGBOARD_PRESETS, PICTURE_PRESETS, TOWEL_RAIL_PRESETS, WALL_TV_PRESETS, BAR_TABLE_PRESETS, BEAM_PRESETS, BENCH_PRESETS, COOKER_HOOD_PRESETS, CORNER_COUNTER_PRESETS, CORNER_DESK_PRESETS, CORNER_SOFA_PRESETS, CORNER_WARDROBE_PRESETS, ELECTRIC_FIREPLACE_PRESETS, FERN_PRESETS, PALM_PRESETS, PLANT_PRESETS, RADIATOR_PRESETS, ROSETTE_PRESETS, ROUND_RUG_PRESETS, RUG_PRESETS, WHEEL_WELL_PRESETS, SEATED_DINING_PRESETS, SEATED_ROUND_PRESETS, RANGE_PRESETS, STOOL_PRESETS, STORAGE_CHEST_PRESETS, TALL_PANTRY_PRESETS, VANITY_PRESETS, WALL_UNIT_PRESETS, WOOD_STOVE_PRESETS } from "./presets";

// More object kinds, spread after the core rows into OBJECT_KINDS (kinds.ts). Rows are built from ./kind-rows and
// ./presets only, never from a value of kinds.ts: this module runs before kinds.ts has built its table.

/** Beyond a seated set's chairs: 0.75 m from the table, the usual quoted minimum to get up and pass. */
const SEATED_ZONE = 0.15;

/** The corner kinds' default arms, 0.60 m each, and the corner sofa's, 0.90 m each (catalog.05). */
const ARMS_60: Arms = { back: 0.6, left: 0.6 };
const ARMS_90: Arms = { back: 0.9, left: 0.9 };
/** A radiator's and a towel rail's elevation above their surface (catalog.08, .23). */
const WALL_HEATER_Z = 0.15;

export const MORE_KINDS: readonly ObjectKind[] = [
  // Storage steps (steps.03): two or three deep steps up to a platform, a drawer in each riser; the front zone is the floor at the foot.
  // The winder stair (steps.04): entered from its front square's right side (Enters from: Left mirrors it), its zone
  // along that square only; 12 risers to 2.15: 0.90 plus 8 straight treads of 0.272.
  { id: "winderStair", label: "Winder stair", configs: one(0.9, 3.07, 0.9, 2.15), ...plain({ ...NONE, right: true }), zoneDefaults: { ...FULL_SIDES, left: { frontSquare: true }, right: { frontSquare: true } }, semanticClass: "IfcStair QUARTER_WINDING_STAIR", stair: STAIR_RULES.winder, options: ["leftEntry"] },
  { id: "storageSteps", label: "Storage steps", configs: one(0.6, 0.7, 0.9, 0.45), ...plain(FRONT), semanticClass: "IfcStair STRAIGHT_RUN_STAIR", stair: STAIR_RULES.drawers },
  // The corner kinds (catalog.05, .17): an `L` of two arms meeting at the back-left corner, one configuration each.
  { id: "cornerDesk", label: "Corner desk", configs: one(1.6, 1.2, 0.8, SEATED_HEIGHT), ...plain(FRONT), sitAt: true, seatsUnder: ["standard"], presets: CORNER_DESK_PRESETS, semanticClass: "IfcFurniture DESK", outline: "ell", arms: ARMS_60 },
  { id: "cornerWardrobe", label: "Corner wardrobe", configs: one(1.5, 1.0, 0.6, 2.05), ...plain(FRONT), presets: CORNER_WARDROBE_PRESETS, semanticClass: "IfcFurniture USERDEFINED", outline: "ell", arms: ARMS_60 },
  { id: "cornerCounter", label: "Corner counter", configs: one(2.4, 1.8, 1.0, WORKTOP_HEIGHT), ...plain(FRONT), presets: CORNER_COUNTER_PRESETS, semanticClass: "IfcFurniture USERDEFINED", outline: "ell", arms: ARMS_60 },
  { id: "cornerSofa", label: "Corner sofa", configs: one(2.6, 2.0, 0.5, 0.9), ...plain(FRONT), presets: CORNER_SOFA_PRESETS, semanticClass: "IfcFurniture SOFA", outline: "ell", arms: ARMS_90 },
  // The plant, cot, radiator and towel rail (catalog.08, .23).
  { id: "plant", label: "Plant", configs: one(0.4, 0.4, null, 1.2), ...plain(NONE), presets: PLANT_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED", outline: "round", front: false },
  { id: "cot", label: "Cot", configs: one(0.66, 1.26, 0.6, 0.9), ...plain(FRONT), semanticClass: "IfcFurniture BED" },
  { id: "radiator", label: "Radiator", configs: one(0.8, 0.1, null, 0.6, WALL_HEATER_Z), ...plain(NONE), presets: RADIATOR_PRESETS, semanticClass: "IfcSpaceHeater RADIATOR" },
  { id: "towelRail", label: "Towel rail", configs: one(0.5, 0.1, null, 1.2, WALL_HEATER_Z), ...plain(NONE), presets: TOWEL_RAIL_PRESETS, semanticClass: "IfcSpaceHeater RADIATOR" },
  // The rugs (catalog.08, .15): 0.01 m thick, read by the one rug rule (`isRug`).
  { id: "rug", label: "Rug", configs: one(2.0, 1.4, null, 0.01), ...plain(NONE), presets: RUG_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED", rug: true, front: false },
  { id: "roundRug", label: "Round rug", configs: one(1.6, 1.6, null, 0.01), ...plain(NONE), presets: ROUND_RUG_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED", outline: "round", rug: true, front: false },
  // A cabinet with a basin drawn on it (symbols.03), its height to the tap's top as the washbasin's.
  { id: "vanityUnit", label: "Vanity unit", configs: one(1, 0.5, 0.7, 1.05), ...plain(FRONT), presets: VANITY_PRESETS, semanticClass: "IfcSanitaryTerminal WASHHANDBASIN" },
  // More plants (symbols.04): they fit by their round ring, as the plant does.
  { id: "palm", label: "Palm", configs: one(0.9, 0.9, null, 1.8), ...plain(NONE), presets: PALM_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED", outline: "round", front: false },
  { id: "fern", label: "Fern", configs: one(0.6, 0.6, null, 0.8), ...plain(NONE), presets: FERN_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED", outline: "round", front: false },
  { id: "rosette", label: "Rosette", configs: one(0.4, 0.4, null, 0.3), ...plain(NONE), presets: ROSETTE_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED", outline: "round", front: false },
  // Tables with room to sit (seated.01): chairs 15 cm off the table, the piece holding them; a small zone beyond for getting up.
  { id: "seatedDining", label: "Dining table with chairs", configs: one(1.2, 2, SEATED_ZONE, 0.9), ...plain(ALL), presets: SEATED_DINING_PRESETS, semanticClass: "IfcFurniture TABLE", aggregate: { table: "extendingTable", config: "closed", chairs: "sides", reach: SEATED_REACH }, options: ["roundChairs"] },
  { id: "seatedRound", label: "Round table with chairs", configs: one(2.16, 2.16, SEATED_ZONE, 0.9), ...plain(ALL), presets: SEATED_ROUND_PRESETS, semanticClass: "IfcFurniture TABLE", outline: "round", aggregate: { table: "roundTable", config: "standard", chairs: "around", reach: SEATED_REACH }, options: ["roundChairs"] },
  // The pieces for small homes (spec pieces, pieces.01, .02): a range (a hob over an oven), a cooker hood hung from the
  // ceiling by default, a tall pantry.
  { id: "range", label: "Range", configs: one(0.6, 0.6, 1, WORKTOP_HEIGHT), ...plain(FRONT), presets: RANGE_PRESETS, semanticClass: "IfcElectricAppliance ELECTRICCOOKER" },
  { id: "cookerHood", label: "Cooker hood", configs: one(0.6, 0.5, null, 0.9, "ceiling"), ...plain(NONE), presets: COOKER_HOOD_PRESETS, semanticClass: "IfcElectricAppliance USERDEFINED" },
  { id: "tallPantry", label: "Tall pantry", configs: one(0.8, 0.6, 0.6, 2.1), ...plain(FRONT), presets: TALL_PANTRY_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  // A stool: a seat with no backrest (pieces.05, .09), round, no side you face; a bar table you sit at; a bench; a chest.
  { id: "stool", label: "Stool", configs: one(0.4, 0.4, null, 0.75), ...plain(NONE), seat: 0, presets: STOOL_PRESETS, semanticClass: "IfcFurniture CHAIR", outline: "round", front: false },
  { id: "barTable", label: "Bar table", configs: one(1.2, 0.6, 0.6, 1.05), ...plain(FRONT), sitAt: true, seatsUnder: ["standard"], presets: BAR_TABLE_PRESETS, semanticClass: "IfcFurniture TABLE" },
  { id: "bench", label: "Bench", configs: one(1.2, 0.45, null, 0.45), ...plain(NONE), presets: BENCH_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  { id: "storageChest", label: "Storage chest", configs: one(0.8, 0.45, null, 0.5), ...plain(NONE), presets: STORAGE_CHEST_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  // An electric fireplace hung at 0.30 m; a wall unit whose presets are the services hung on a wall (pieces.01, .02).
  { id: "electricFireplace", label: "Electric fireplace", configs: one(1, 0.2, null, 0.55, 0.3), ...plain(NONE), presets: ELECTRIC_FIREPLACE_PRESETS, semanticClass: "IfcSpaceHeater USERDEFINED" },
  { id: "wallUnit", label: "Wall unit", configs: one(0.8, 0.2, null, 0.28, 2), ...plain(NONE), presets: WALL_UNIT_PRESETS, semanticClass: "IfcUnitaryEquipment USERDEFINED" },
  // A wood stove on its hearth, the hearth its footprint, its flue drawn in 3D to what is over it (pieces.04, .08).
  { id: "woodStove", label: "Wood stove", configs: one(0.75, 0.75, 0.3, 0.65), ...plain(FRONT), presets: WOOD_STOVE_PRESETS, semanticClass: "IfcSpaceHeater USERDEFINED", flue: true },
  // A wheel well (trailer.07, .11): the trailer's tyres rising into the room, part of the house, in every layout.
  { id: "wheelWell", label: "Wheel well", configs: one(1.8, 0.4, null, 0.35), ...plain(NONE), presets: WHEEL_WELL_PRESETS, semanticClass: "IfcBuildingElementProxy USERDEFINED", front: false, well: true },
  // A beam (beams.02, .03): hung from what is over it, its ends into walls, in every layout; its width is its length.
  { id: "beam", label: "Beam", configs: one(2.4, 0.15, null, 0.2, "ceiling"), ...plain(NONE), presets: BEAM_PRESETS, semanticClass: "IfcBeam BEAM", front: false, beam: true },
  // Pieces hung on a wall (hangings.02): thin, at an elevation, presets by common size; and a coat stand on the floor.
  { id: "picture", label: "Picture", configs: one(0.53, 0.03, null, 0.73, 1.15), ...plain(NONE), presets: PICTURE_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED" },
  { id: "mirror", label: "Mirror", configs: one(0.6, 0.03, null, 0.8, 1.1), ...plain(NONE), presets: MIRROR_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED" },
  { id: "clock", label: "Clock", configs: one(0.3, 0.05, null, 0.3, 1.8), ...plain(NONE), presets: CLOCK_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED" },
  { id: "wallTv", label: "Wall TV", configs: one(1.24, 0.06, null, 0.72, 1), ...plain(NONE), presets: WALL_TV_PRESETS, semanticClass: "IfcAudioVisualAppliance DISPLAY" },
  { id: "pegboard", label: "Pegboard", configs: one(0.9, 0.1, null, 0.6, 1), ...plain(NONE), presets: PEGBOARD_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED" },
  { id: "coatHooks", label: "Coat hooks", configs: one(0.9, 0.08, null, 0.12, 1.6), ...plain(NONE), presets: COAT_HOOKS_PRESETS, semanticClass: "IfcFurnishingElement USERDEFINED" },
  { id: "coatStand", label: "Coat stand", configs: one(0.45, 0.45, null, 1.75), ...plain(NONE), presets: COAT_STAND_PRESETS, semanticClass: "IfcFurniture USERDEFINED", outline: "round", front: false },
  // Tall bookcases with glass doors (the user's request after hangings): all glass, or glass over solid doors.
  { id: "glassCabinet", label: "Glass cabinet", configs: one(0.8, 0.3, 0.4, 2.02), ...plain(FRONT), presets: GLASS_CABINET_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
  { id: "halfGlassCabinet", label: "Half-glass cabinet", configs: one(0.8, 0.3, 0.4, 2.02), ...plain(FRONT), presets: GLASS_CABINET_PRESETS, semanticClass: "IfcFurniture USERDEFINED" },
];
