import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "@fm/protocol";

export const SEED = "Studio";

/**
 * A copy of the seeded studio under a new id and `name`, written into the e2e server's data directory, which
 * playwright.config.ts passes on as FM_E2E_SEEDED; `edit` may change its stored document. The server lists projects
 * from disk and loads them on first open. Specs that edit the studio edit a copy, since other specs read the seed.
 */
export async function copyStudio(name: string, edit: (doc: Record<string, unknown>) => Record<string, unknown> = (doc) => doc): Promise<void> {
  const dir = process.env.FM_E2E_SEEDED;
  if (dir === undefined) throw new Error("no seeded data directory (FM_E2E_SEEDED)");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const text = await readFile(join(dir, file), "utf8").catch((error: unknown) => {
      if (isRecord(error) && error.code === "ENOENT") return null; // a spec running beside this one deleted it
      throw error;
    });
    if (text === null) continue;
    const state: unknown = JSON.parse(text);
    if (!isRecord(state) || !isRecord(state.meta) || state.meta.name !== SEED || !isRecord(state.doc)) continue;
    const id = randomUUID();
    // Never half a file under a .json name: the server reads them all to list projects, and exits on one it can't parse.
    const target = join(dir, `${id}.json`);
    await writeFile(`${target}.tmp`, JSON.stringify({ ...state, doc: edit(state.doc), meta: { ...state.meta, id, name } }));
    await rename(`${target}.tmp`, target);
    return;
  }
  throw new Error(`no seeded ${SEED} in ${dir}`);
}

/** For copyStudio: the stored document with its surroundings row set to `value`, or with none for null (None). */
export function withSurroundings(value: string | null): (doc: Record<string, unknown>) => Record<string, unknown> {
  return (doc) => {
    const fields = Object.entries(isRecord(doc.projectFields) ? doc.projectFields : {}).filter(([key]) => key !== "surroundings");
    return { ...doc, projectFields: Object.fromEntries(value === null ? fields : [...fields, ["surroundings", { id: "surroundings", value }]]) };
  };
}
