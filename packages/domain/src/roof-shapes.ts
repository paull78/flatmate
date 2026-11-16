// The roof's stored values (roofs.03, .15), apart from its geometry so the parser and the model can read them with no
// import cycle.

export const ROOF_SHAPES = ["flat", "shed", "gable"] as const;
export type RoofShape = (typeof ROOF_SHAPES)[number];
/** The side the roof falls toward (roofs.15): a shed's low side; for a gable only its axis counts. */
export const FALLS = ["-y", "+y", "-x", "+x"] as const;
export type Falls = (typeof FALLS)[number];
