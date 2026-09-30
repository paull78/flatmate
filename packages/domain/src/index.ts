// Re-exported so scripts need only @fm/domain.
export { ok, err, unwrap, assertNever } from "@fm/protocol";
export type { Point, Result } from "@fm/protocol";
export * from "./model";
export * from "./errors";
export * from "./geometry";
export * from "./shape";
export * from "./validate";
export * from "./patch";
export * from "./graph";
export * from "./commands/types";
export { execute } from "./commands/execute";
export { wallOutlines } from "./queries/outlines";
export type { Face } from "./queries/faces";
export { zones, orphanLabelIds, faceAt, type Zone } from "./queries/zones";
export { wallHelperDimension } from "./queries/helpers";
export { hitCandidates } from "./queries/hit";
export * from "./serialize";
export { rectangleRoom } from "./scripts";
