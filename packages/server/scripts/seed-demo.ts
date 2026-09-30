// Demo fallback (spec §1.4): a "Sample apartment" project, built with domain commands and accepted through the
// server's own submit decision, so its seq, version map and receipts look exactly like a drawn project's.
import { emptyDocument, execute, rectangleRoom } from "@fm/domain";
import type { Command, Document } from "@fm/domain";
import { buildExpectations, patchWrites, uniqueKeys, unwrap } from "@fm/protocol";
import type { Changeset, ProjectMeta } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { decideSubmit } from "../src/app/decide-submit";
import type { ProjectRepository, ProjectState } from "../src/app/ports";

export const SAMPLE_NAME = "Sample apartment";

/** The demo apartment after steps 2–4: 6 × 4 m, divider at x = 3, two labelled rooms. */
export function sampleCommands(): Command[] {
  return [
    ...rectangleRoom({ x: 0, y: 0 }, 6, 4, "sample"),
    { type: "addWall", opId: "sample-divider", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } },
    { type: "labelZone", id: "sample-kitchen", at: { x: 1.5, y: 2 }, name: "Kitchen" },
    { type: "labelZone", id: "sample-living", at: { x: 4.5, y: 2 }, name: "Living" },
  ];
}

/** Idempotent: an existing project named SAMPLE_NAME is returned as is. */
export async function seedDemo(repository: ProjectRepository): Promise<ProjectMeta> {
  const existing = (await repository.list()).find((p) => p.name === SAMPLE_NAME);
  if (existing) return existing;

  let state: ProjectState = await repository.create(SAMPLE_NAME);
  let doc: Document = emptyDocument();
  for (const [i, cmd] of sampleCommands().entries()) {
    const { doc: next, patch } = unwrap(execute(doc, cmd));
    const changeset: Changeset = {
      id: `seed-${i}`,
      patch: { puts: patch.puts, deletes: patch.deletes },
      expect: buildExpectations(state.versions, uniqueKeys([...patchWrites(patch), ...patch.dependencies])),
    };
    const decision = decideSubmit(state, changeset, domainValidator);
    if (decision.kind !== "accept") {
      throw new Error(`seed step ${i} (${cmd.type}) was not accepted: ${JSON.stringify(decision)}`);
    }
    state = decision.next;
    doc = next;
  }
  await repository.save(state);
  return state.meta;
}
