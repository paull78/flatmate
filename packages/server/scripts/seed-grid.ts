// A large drawing for measuring speed (spec §6.3): N × N labelled 3 m rooms. The document is written directly,
// because building it one `execute` at a time takes minutes at this size, then accepted through the server's own
// submit decision as one changeset, so the domain validates it once.
import { toStored, type Document, type Joint, type Wall, type ZoneLabel } from "@fm/domain";
import { TABLE_NAMES, buildExpectations, uniqueKeys, type Changeset, type ProjectMeta } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { decideSubmit } from "../src/app/decide-submit";
import type { ProjectRepository } from "../src/app/ports";

export const GRID_CELL = 3; // metres
export const DEFAULT_GRID_SIZE = 30;

export function gridName(n: number): string {
  return `Grid ${n}×${n}`;
}

/** N × N square rooms of GRID_CELL m, joined at shared joints, each labelled "Room i.j". */
export function gridDocument(n: number): Document {
  const joints: Record<string, Joint> = {};
  const walls: Record<string, Wall> = {};
  const zoneLabels: Record<string, ZoneLabel> = {};
  const joint = (x: number, y: number): string => `g-${x}-${y}`;
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) joints[joint(x, y)] = { id: joint(x, y), x: x * GRID_CELL, y: y * GRID_CELL };
  }
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j < n; j++) {
      const h = `gh-${j}-${i}`; // along x, at y = i
      const v = `gv-${i}-${j}`; // along y, at x = i
      walls[h] = { id: h, a: joint(j, i), b: joint(j + 1, i) };
      walls[v] = { id: v, a: joint(i, j), b: joint(i, j + 1) };
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const id = `gl-${i}-${j}`;
      zoneLabels[id] = { id, at: { x: (i + 0.5) * GRID_CELL, y: (j + 0.5) * GRID_CELL }, name: `Room ${i + 1}.${j + 1}` };
    }
  }
  return { joints, walls, zoneLabels };
}

/** Idempotent: an existing project with the same name is returned as is. */
export async function seedGrid(repository: ProjectRepository, n: number): Promise<ProjectMeta> {
  const name = gridName(n);
  const existing = (await repository.list()).find((p) => p.name === name);
  if (existing) return existing;

  const state = await repository.create(name);
  const stored = toStored(gridDocument(n));
  const puts = TABLE_NAMES.flatMap((table) => Object.values(stored[table]).map((entity) => ({ table, entity })));
  const changeset: Changeset = {
    id: "seed-grid",
    patch: { puts, deletes: [] },
    expect: buildExpectations(state.versions, uniqueKeys(puts.map((p) => ({ table: p.table, id: p.entity.id })))),
  };
  const decision = decideSubmit(state, changeset, domainValidator);
  if (decision.kind !== "accept") throw new Error(`the grid was not accepted: ${JSON.stringify(decision)}`);
  await repository.save(decision.next);
  return decision.next.meta;
}
