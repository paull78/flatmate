import { fromStored } from "@fm/domain";
import type { Document } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import type { Sample } from "../scripts/samples";
import { seedProject } from "../scripts/seed-kit";

/** A sample seeded into `folder` and read back as the server saved it. */
export async function seeded(sample: Sample, folder: string): Promise<Document> {
  const repo = createJsonFileRepository(folder);
  const meta = await seedProject(repo, sample.name, sample.steps(), sample.prefix);
  const state = await repo.load(meta.id);
  if (!state) throw new Error(`${sample.name} was not saved`);
  return unwrap(fromStored(state.doc));
}
