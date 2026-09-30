import { emptyStored, emptyVersions } from "@fm/protocol";
import type { ProjectMeta } from "@fm/protocol";
import { byNameThenId } from "./ports";
import type { ProjectRepository, ProjectState } from "./ports";

export type InMemoryRepository = ProjectRepository & {
  /** The next save throws `error`: before writing (disk unchanged) or, with afterWrite, after writing. */
  failNextSave(error: Error, opts?: { afterWrite?: boolean }): void;
};

/** A repository whose "disk" is a Map. A new server app over the same object simulates a restart. */
export function createInMemoryRepository(): InMemoryRepository {
  const disk = new Map<string, ProjectState>();
  let nextId = 1;
  let failure: { error: Error; afterWrite: boolean } | null = null;

  async function save(state: ProjectState): Promise<void> {
    const pending = failure;
    failure = null;
    if (pending && !pending.afterWrite) throw pending.error;
    disk.set(state.meta.id, structuredClone(state));
    if (pending) throw pending.error;
  }

  return {
    async list(): Promise<ProjectMeta[]> {
      return [...disk.values()].map((s) => ({ ...s.meta })).sort(byNameThenId);
    },
    async create(name: string): Promise<ProjectState> {
      const state: ProjectState = { meta: { id: `p${nextId++}`, name }, seq: 0, doc: emptyStored(), versions: emptyVersions(), receipts: {} };
      await save(state);
      return structuredClone(state);
    },
    async load(id: string): Promise<ProjectState | null> {
      const state = disk.get(id);
      return state ? structuredClone(state) : null;
    },
    save,
    failNextSave(error: Error, opts: { afterWrite?: boolean } = {}): void {
      failure = { error, afterWrite: opts.afterWrite ?? false };
    },
  };
}
