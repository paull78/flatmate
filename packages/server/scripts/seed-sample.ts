// The sample project (docs/try-it.md): a "Sample apartment" project, the room after step 4 of "Try it", built on the seed kit.
import { rectangleRoom } from "@fm/domain";
import type { Command } from "@fm/domain";
import type { ProjectMeta } from "@fm/protocol";
import type { ProjectRepository } from "../src/app/ports";
import { fixed, seedProject } from "./seed-kit";

export const SAMPLE_NAME = "Sample apartment";

/** The sample apartment after steps 2–4: 6 × 4 m, divider at x = 3, two labelled rooms. */
export function sampleCommands(): Command[] {
  return [
    ...rectangleRoom({ x: 0, y: 0 }, 6, 4, "sample"),
    { type: "addWall", opId: "sample-divider", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } },
    { type: "labelZone", id: "sample-kitchen", at: { x: 1.5, y: 2 }, name: "Kitchen", finish: null },
    { type: "labelZone", id: "sample-living", at: { x: 4.5, y: 2 }, name: "Living", finish: null },
  ];
}

/** Idempotent: an existing project named SAMPLE_NAME is returned as is. */
export async function seedSample(repository: ProjectRepository): Promise<ProjectMeta> {
  return seedProject(repository, SAMPLE_NAME, sampleCommands().map(fixed), "seed");
}
