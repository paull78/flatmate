import type { ProjectMeta, StoredDocument, VersionMap } from "@fm/protocol";

/** Floor-plan validity behind a port: the server app never imports @fm/domain (spec §7.1). */
export interface ChangesetValidator {
  validate(docAfter: StoredDocument): { ok: true } | { ok: false; violations: string[] };
}

export type Receipt = { seq: number; fingerprint: string };

/** Everything about one project, stored as one JSON file. There is no change log (spec §7.1). */
export type ProjectState = {
  meta: ProjectMeta;
  seq: number;
  doc: StoredDocument;
  versions: VersionMap; // includes deleted IDs (tombstones)
  receipts: Record<string, Receipt>; // every accepted changeset ID; never expire
};

export interface ProjectRepository {
  list(): Promise<ProjectMeta[]>; // sorted with byNameThenId
  create(name: string): Promise<ProjectState>;
  load(id: string): Promise<ProjectState | null>;
  /** Atomic. Resolves only after the repository's persistence completion for its host (spec §7.2). */
  save(state: ProjectState): Promise<void>;
  /** Takes the project out of the list for good; the JSON repository keeps the file in `deleted/` (spec §7.1). */
  remove(id: string): Promise<void>;
}

/** The order every repository lists projects in. */
export function byNameThenId(a: ProjectMeta, b: ProjectMeta): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
