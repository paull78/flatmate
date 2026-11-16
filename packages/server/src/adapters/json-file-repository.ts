import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { emptyStored, emptyVersions, isRecord, parseProjectMeta, parseStoredDocument, parseVersionMap } from "@fm/protocol";
import type { ProjectListing } from "@fm/protocol";
import { byNameThenId } from "../app/ports";
import type { ProjectRepository, ProjectState, Receipt } from "../app/ports";

/** Server-made UUIDs. Never "/", "." or "..", so an ID cannot leave the data directory. */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * One `<dir>/<id>.json` per project holding the whole ProjectState (spec: collaboration).
 * Save = write tmp → sync → close → rename → sync directory where supported (spec: collaboration).
 * Remove = rename into `<dir>/deleted/`, restorable by moving the file back while the server is stopped (spec: collaboration).
 * Completion means these calls returned; no power-loss guarantee is claimed beyond what the OS gives.
 */
export function createJsonFileRepository(dir: string): ProjectRepository {
  const fileOf = (id: string): string => join(dir, `${id}.json`);

  async function save(state: ProjectState): Promise<void> {
    await mkdir(dir, { recursive: true });
    const target = fileOf(state.meta.id);
    const tmp = `${target}.tmp`;
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(JSON.stringify(state));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
    await syncDirectory(dir);
  }

  async function read(file: string): Promise<ProjectState> {
    const text = await readFile(file, "utf8");
    return parseProjectState(parsedJson(text));
  }

  return {
    async list(): Promise<ProjectListing[]> {
      await mkdir(dir, { recursive: true });
      const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
      const metas: ProjectListing[] = [];
      for (const name of names) {
        try {
          const file = join(dir, name);
          metas.push({ ...(await read(file)).meta, editedAt: (await stat(file)).mtimeMs });
        } catch (error) {
          // ENOENT: moved to deleted/ by a remove in another queue (spec: collaboration). Anything else is this one file's problem.
          if (!hasCode(error, "ENOENT")) skipped(join(dir, name), error);
        }
      }
      return metas.sort(byNameThenId);
    },
    async create(name: string): Promise<ProjectState> {
      const state: ProjectState = { meta: { id: randomUUID(), name }, seq: 0, doc: emptyStored(), versions: emptyVersions(), receipts: {} };
      await save(state);
      return state;
    },
    async load(id: string): Promise<ProjectState | null> {
      if (!PROJECT_ID.test(id)) return null;
      try {
        const state = await read(fileOf(id));
        // Case-insensitive file systems (macOS, Windows) would open "ABC" from abc.json: a second live copy.
        return state.meta.id === id ? state : null;
      } catch (error) {
        if (hasCode(error, "ENOENT")) return null;
        if (!(error instanceof NotAProject)) throw error; // the disk's own errors stop the server (spec: collaboration)
        skipped(fileOf(id), error);
        return null;
      }
    },
    save,
    async remove(id: string): Promise<void> {
      const trash = join(dir, "deleted");
      await mkdir(trash, { recursive: true });
      await rename(fileOf(id), join(trash, `${id}.json`));
      await syncDirectory(trash);
      await syncDirectory(dir);
    },
  };
}

/** The file's content isn't a project. A restart would read the same bytes, so stopping the server can't help (spec: collaboration). */
class NotAProject extends Error {}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new NotAProject(`not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function skipped(file: string, error: unknown): void {
  console.error(`[fm-server] skipping ${file}: ${error instanceof Error ? error.message : String(error)}`);
}

async function syncDirectory(dir: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dir, "r");
    await handle.sync();
  } catch (error) {
    if (!hasCode(error, "EISDIR", "EPERM", "EINVAL", "ENOTSUP")) throw error; // platforms that cannot sync a directory
  } finally {
    await handle?.close();
  }
}

function hasCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

function parseProjectState(json: unknown): ProjectState {
  if (!isRecord(json)) throw new NotAProject("invalid project file");
  const meta = parseProjectMeta(json.meta);
  // Files saved before a table existed lack it; the validator's upgrade fills in the rest on load (spec: domain).
  const doc = parseStoredDocument(json.doc, "empty");
  const versions = parseVersionMap(json.versions, "empty");
  const receipts = parseReceipts(json.receipts);
  const { seq } = json;
  if (!meta || !doc || !versions || !receipts || typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) {
    throw new NotAProject("invalid project file");
  }
  return { meta, seq, doc, versions, receipts };
}

function parseReceipts(v: unknown): Record<string, Receipt> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, Receipt> = {};
  for (const [id, receipt] of Object.entries(v)) {
    if (!isRecord(receipt)) return null;
    const { seq, fingerprint } = receipt;
    if (typeof seq !== "number" || !Number.isInteger(seq) || typeof fingerprint !== "string") return null;
    out[id] = { seq, fingerprint };
  }
  return out;
}
