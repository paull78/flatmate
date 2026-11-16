import type { ProjectListing, ProjectMeta, StoredDocument, VersionMap } from "@fm/protocol";

/** Floor-plan validity behind a port: the server app never imports @fm/domain (spec: collaboration). */
export interface ChangesetValidator {
  validate(docAfter: StoredDocument): { ok: true } | { ok: false; violations: string[] };
  /** Brings a stored document saved by an older server to the current shape; applied once when a project loads (spec: domain). */
  upgrade(doc: StoredDocument): StoredDocument;
}

export type Receipt = { seq: number; fingerprint: string };

/** Everything about one project, stored as one JSON file. There is no change log (spec: collaboration). */
export type ProjectState = {
  meta: ProjectMeta;
  seq: number;
  doc: StoredDocument;
  versions: VersionMap; // includes deleted IDs (tombstones)
  receipts: Record<string, Receipt>; // every accepted changeset ID; never expire
};

export interface ProjectRepository {
  list(): Promise<ProjectListing[]>; // sorted with byNameThenId
  create(name: string): Promise<ProjectState>;
  load(id: string): Promise<ProjectState | null>;
  /** Atomic. Resolves only after the repository's persistence completion for its host (spec: collaboration). */
  save(state: ProjectState): Promise<void>;
  /** Takes the project out of the list for good; the JSON repository keeps the file in `deleted/` (spec: collaboration). */
  remove(id: string): Promise<void>;
}

/** The order every repository lists projects in. */
export function byNameThenId(a: ProjectMeta, b: ProjectMeta): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
