// The seed kit (samples.11): the one submit loop every seed runs through, and the helpers seeds place things with.
// Each command is executed by the domain and accepted through the server's own submit decision, so a seeded project's
// seq, version map and receipts look exactly like a drawn project's, and a seed can't store a drawing the server would
// refuse.
import { anchorAt, execute, fromStored, motifDefaults } from "@fm/domain";
import type { Command, Document, Finish, OpeningKind } from "@fm/domain";
import { buildExpectations, patchWrites, uniqueKeys, unwrap } from "@fm/protocol";
import type { Changeset, Point, ProjectMeta } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { decideSubmit } from "../src/app/decide-submit";
import type { ProjectRepository, ProjectState } from "../src/app/ports";

/** A step builds its command from the document so far (wall ids change when a later wall splits one). */
export type Step = (doc: Document) => Command;

/** Steps whose new pieces are exceptions, placed per layout as every seed was before linked layouts (review.11). */
export const apart = (steps: readonly Step[]): Step[] => steps.map((step) => (doc) => {
  const cmd = step(doc);
  return cmd.type === "placeObject" ? { ...cmd, linked: false } : cmd;
});

/** A command that doesn't depend on the document so far. */
export const fixed = (cmd: Command): Step => () => cmd;

/** The wall whose centre line passes through `p`, and how far `p` lies from its joint a. */
export function wallThrough(doc: Document, p: Point): { wall: string; along: number } {
  for (const w of Object.values(doc.walls)) {
    const a = doc.joints[w.a];
    const b = doc.joints[w.b];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
    const off = Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len;
    if (off < 1e-6 && t > 0 && t < len) return { wall: w.id, along: t };
  }
  throw new Error(`no wall through (${p.x}, ${p.y})`);
}

export type OpeningExtra = { side?: "left" | "right"; hinge?: "a" | "b"; sill?: number; head?: number; sheer?: "glass" | "floor" };

/** An opening `width` wide centred at `p` on the wall through it; side, hinge, sill, head and sheer as `addOpening` takes them. */
export const opening = (opId: string, kind: OpeningKind, p: Point, width: number, extra: OpeningExtra = {}): Step => (doc) => {
  const { wall, along } = wallThrough(doc, p);
  return { type: "addOpening", opId, wall, kind, offset: along - width / 2, width, ...extra };
};

export type PieceExtra = { deck?: string; config?: string; preset?: string; linked?: boolean };

/** A piece centred at `centre` (the domain stores the back edge's middle), `d` deep at `rotation`. */
export const piece = (opId: string, state: string, kind: string, centre: Point, d: number, rotation: number, extra: PieceExtra = {}): Step => () => ({
  type: "placeObject", opId, state, object: { kind, ...(extra.preset ? { preset: extra.preset } : {}) }, at: anchorAt(centre, d, rotation), rotation,
  deck: extra.deck ?? null, ...(extra.config ? { config: extra.config } : {}), ...(extra.linked === undefined ? {} : { linked: extra.linked }),
});

/**
 * A piece at its own elevation (showcase.03): a plant on a counter, a frame high on a loft's wall. Placing takes no
 * elevation, so it lands on free floor at `free`, takes its size and elevation there, then moves to `centre` (on
 * `deck`, or the floor).
 */
export const raised = (opId: string, state: string, kind: string, free: Point, centre: Point, size: { w: number; d: number; h: number }, z: number, rotation: number, deck: string | null = null): Step[] => [
  () => ({ type: "placeObject", opId, state, object: { kind, size: { w: size.w, d: size.d, h: size.h } }, at: anchorAt(free, size.d, rotation), rotation, deck: null }),
  () => ({ type: "setObjectSize", objectId: `${opId}/o0`, w: size.w, d: { standard: size.d }, h: { standard: size.h }, z: { standard: z } }),
  (doc) => ({ type: "movePlacement", placementId: placementIn(doc, `${opId}/o0`, state), at: anchorAt(centre, size.d, rotation), rotation, deck }),
];

/** The placement of `object` in the layout `state` (a copied layout's placements get ids that aren't known up front). */
export function placementIn(doc: Document, object: string, state: string): string {
  const found = Object.values(doc.placements).find((p) => p.object === object && p.state === state);
  if (!found) throw new Error(`no ${object} in layout ${state}`);
  return found.id;
}

/**
 * Seeds the project `name` from `steps`, each accepted as its own changeset `<prefix>-<i>`. Idempotent: an existing
 * project with that name is returned as is. A refused step throws with its number, command and opId, and the project
 * it had created is removed, so a failed seed leaves nothing in the list.
 */
export async function seedProject(repository: ProjectRepository, name: string, steps: readonly Step[], prefix: string): Promise<ProjectMeta> {
  const existing = (await repository.list()).find((p) => p.name === name);
  if (existing) return existing;

  const created = await repository.create(name);
  // As the server does when it loads a project: the new-project template gains the first layout state (spec: domain).
  let state: ProjectState = { ...created, doc: domainValidator.upgrade(created.doc) };
  let doc: Document = unwrap(fromStored(state.doc));
  try {
    for (const [i, step] of steps.entries()) {
      const cmd = step(doc);
      const label = `step ${i} (${cmd.type}${"opId" in cmd ? ` ${cmd.opId}` : ""})`;
      const result = execute(doc, cmd);
      if (!result.ok) throw new Error(`${name}: ${label} was refused: ${JSON.stringify(result.error)}`);
      const { doc: next, patch } = result.value;
      const changeset: Changeset = {
        id: `${prefix}-${i}`,
        patch: { puts: patch.puts, deletes: patch.deletes },
        expect: buildExpectations(state.versions, uniqueKeys([...patchWrites(patch), ...patch.dependencies])),
      };
      const decision = decideSubmit(state, changeset, domainValidator);
      if (decision.kind !== "accept") throw new Error(`${name}: ${label} was not accepted: ${JSON.stringify(decision)}`);
      state = decision.next;
      doc = next;
    }
  } catch (error) {
    await repository.remove(created.meta.id);
    throw error;
  }
  await repository.save(state);
  return state.meta;
}

/** The house's outside walls default (inherit.07): every side facing outside shows it unless customised. */
export const outsideWalls = (finish: Finish): Step => fixed({ type: "setOutsideFinish", part: "finish", finish });

/** The room's walls default in `finish`, and a lower band in `lower` when given, on its label (surfaces step 16, inherit.01). */
export const roomWalls = (labelId: string, finish: Finish, lower?: { finish: Finish; height: number }): Step[] => [
  fixed({ type: "setRoomWallFinishes", labelId, part: "finish", finish }),
  ...(lower ? [fixed({ type: "setRoomWallFinishes", labelId, part: "lower", finish: lower.finish, height: lower.height })] : []),
];

/** The samples' finishes (surfaces step 16, showcase.02): one palette for the five houses. */
export const SAMPLE_FINISHES = {
  white: { ...motifDefaults("plain"), colour: "#f2f0eb" },
  // Room colours, soft enough for a small room.
  sage: { ...motifDefaults("plain"), colour: "#cfd8c6" },
  clay: { ...motifDefaults("plain"), colour: "#ead3c4" },
  sky: { ...motifDefaults("plain"), colour: "#ccd9e0" },
  sand: { ...motifDefaults("plain"), colour: "#ece0cb" },
  wainscot: { ...motifDefaults("widePlanks"), colour: "#f2f0eb", angle: 90 }, // a painted board band
  shiplap: { ...motifDefaults("planks"), colour: "#e8e2d4", strength: 30 }, // painted boards, horizontal
  // Wood outside (WOOD_OUTSIDE).
  cedar: { ...motifDefaults("widePlanks"), colour: "#9c6b44", angle: 90 }, // vertical boards outside
  larch: { ...motifDefaults("widePlanks"), colour: "#b0825a", size: 0.2 }, // horizontal boards outside
  battenWood: { ...motifDefaults("boardAndBatten"), colour: "#8a6446" },
  weathered: { ...motifDefaults("widePlanks"), colour: "#8f8476", angle: 90 }, // grey, weathered vertical boards
  batten: motifDefaults("boardAndBatten"),
  // Wet rooms.
  tiles: motifDefaults("squareTiles"),
  subway: motifDefaults("subwayTiles"),
  subwaySage: { ...motifDefaults("subwayTiles"), colour: "#b5cbbd" },
  zellige: { ...motifDefaults("squareTiles"), colour: "#8fb3b0", size: 0.1, strength: 50 },
  stone: { ...motifDefaults("largeTiles"), colour: "#d8d2c8" },
  mosaic: motifDefaults("mosaic"),
  cement: motifDefaults("cementTiles"),
  terracotta: { ...motifDefaults("squareTiles"), colour: "#c98a6b", size: 0.2 },
  slate: { ...motifDefaults("largeTiles"), colour: "#8d8f8c", size: 0.6 },
  concrete: { ...motifDefaults("plain"), colour: "#b9bcbe" },
} as const;

/** The wood claddings a house standing outside takes (showcase AC-02). */
export const WOOD_OUTSIDE = [SAMPLE_FINISHES.cedar, SAMPLE_FINISHES.larch, SAMPLE_FINISHES.battenWood, SAMPLE_FINISHES.weathered] as const;
