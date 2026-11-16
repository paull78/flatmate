// Does a recorded build match its sample's seed (samples.09, AC-09)? The same room names with areas within 0.1 m², the
// same decks at the same tops, and the same number of openings and of stairs. Furniture may differ.
//
//   tsx scripts/compare-sample.ts <data folder> "<sample name>"   → "matches" and exit 0, or the differences and exit 1
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromStored, stairRuleOf, zones } from "@fm/domain";
import type { Document } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { SAMPLES } from "./samples";
import { seedProject } from "./seed-kit";

const AREA_TOLERANCE = 0.1;

type Summary = { rooms: Map<string, number>; decks: number[]; openings: number; stairs: number };

function summarise(doc: Document): Summary {
  const rooms = new Map<string, number>();
  for (const zone of zones(doc)) {
    const name = zone.labelIds.map((id) => doc.zoneLabels[id]?.name).find((n) => n !== undefined) ?? `Unnamed room ${zone.face.key}`;
    rooms.set(name, zone.area ?? 0);
  }
  const first = Object.values(doc.states).sort((a, b) => a.order - b.order)[0];
  const stairs = Object.values(doc.placements).filter((p) => p.state === first?.id && stairRuleOf(doc.objects[p.object]?.kind ?? "") !== null).length;
  const decks = Object.values(doc.decks).map((d) => d.top).sort((a, b) => a - b);
  return { rooms, decks, openings: Object.keys(doc.openings).length, stairs };
}

const m2 = (n: number): string => `${n.toFixed(2)} m²`;
const tops = (ns: readonly number[]): string => ns.map((n) => n.toFixed(2)).join(", ") || "none";

/** The ways `recorded` differs from `seeded`, each a sentence; empty when they match. */
export function compareToSample(recorded: Document, seeded: Document): string[] {
  const r = summarise(recorded);
  const s = summarise(seeded);
  const out: string[] = [];
  for (const [name, area] of s.rooms) {
    const got = r.rooms.get(name);
    if (got === undefined) out.push(`Room ${name}: missing in the recording`);
    else if (Math.abs(got - area) > AREA_TOLERANCE) out.push(`Room ${name}: ${m2(got)} recorded, ${m2(area)} seeded`);
  }
  for (const [name, area] of r.rooms) if (!s.rooms.has(name)) out.push(`Room ${name}: ${m2(area)} recorded, not in the seed`);
  if (tops(r.decks) !== tops(s.decks)) out.push(`Decks: ${tops(r.decks)} recorded, ${tops(s.decks)} seeded`);
  if (r.openings !== s.openings) out.push(`Openings: ${r.openings} recorded, ${s.openings} seeded`);
  if (r.stairs !== s.stairs) out.push(`Stairs: ${r.stairs} recorded, ${s.stairs} seeded`);
  return out;
}

async function main(folder: string, name: string): Promise<number> {
  const sample = SAMPLES.find((s) => s.name === name);
  if (!sample) throw new Error(`no sample named "${name}"; the samples are ${SAMPLES.map((s) => `"${s.name}"`).join(", ")}`);
  const recordedRepo = createJsonFileRepository(folder);
  const meta = (await recordedRepo.list()).find((p) => p.name === name);
  const recordedState = meta ? await recordedRepo.load(meta.id) : null;
  if (!recordedState) throw new Error(`no project named "${name}" in ${folder}`);
  const scratch = await mkdtemp(join(tmpdir(), "fm-compare-"));
  try {
    const seedRepo = createJsonFileRepository(scratch);
    const seedMeta = await seedProject(seedRepo, sample.name, sample.steps(), sample.prefix);
    const seedState = await seedRepo.load(seedMeta.id);
    if (!seedState) throw new Error("the seed was not saved");
    const diffs = compareToSample(unwrap(fromStored(recordedState.doc)), unwrap(fromStored(seedState.doc)));
    console.log(diffs.length === 0 ? `"${name}" matches its seed.` : diffs.join("\n"));
    return diffs.length === 0 ? 0 : 1;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const [folder, name] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  if (!folder || !name) throw new Error('usage: tsx scripts/compare-sample.ts <data folder> "<sample name>"');
  process.exitCode = await main(folder, name);
}
