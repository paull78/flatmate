import type { EntityKey, Point } from "@fm/protocol";

export const WALL_THICKNESS = 0.2; // metres; the only wall thickness (spec §3.2)
export const EPS = 0.001; // 1 mm
export const MIN_EDGE = 0.01; // metres
export const MIN_FACE_AREA = 0.01; // m²
export const MAX_NAME_LENGTH = 200;

export type Joint = { id: string; x: number; y: number };
export type Wall = { id: string; a: string; b: string };
export type ZoneLabel = { id: string; at: Point; name: string };
export type Document = {
  joints: Record<string, Joint>;
  walls: Record<string, Wall>;
  zoneLabels: Record<string, ZoneLabel>;
};
export type EntityRef = EntityKey;

export function emptyDocument(): Document {
  return { joints: {}, walls: {}, zoneLabels: {} };
}
