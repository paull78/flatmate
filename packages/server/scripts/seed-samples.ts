// Seeding the sample houses (samples.04, .10): every missing sample by name, or all of them into a data folder that
// holds no project at all. A folder with any project is left alone, so a deleted sample stays deleted while another
// project exists; a folder emptied of every project gets the samples again. No state is stored.
import type { ProjectMeta } from "@fm/protocol";
import type { ProjectRepository } from "../src/app/ports";
import { SAMPLES } from "./samples";
import { seedProject } from "./seed-kit";

/** Adds each sample whose name no project has; returns the ones it added. */
export async function seedSamples(repository: ProjectRepository): Promise<ProjectMeta[]> {
  const taken = new Set((await repository.list()).map((p) => p.name));
  const added: ProjectMeta[] = [];
  for (const sample of SAMPLES) {
    if (taken.has(sample.name)) continue;
    added.push(await seedProject(repository, sample.name, sample.steps(), sample.prefix));
  }
  return added;
}

/** Adds every sample to a repository with no project; otherwise adds nothing. */
export async function seedSamplesIfEmpty(repository: ProjectRepository): Promise<ProjectMeta[]> {
  return (await repository.list()).length === 0 ? seedSamples(repository) : [];
}
