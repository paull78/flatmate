// What a project changes against its sample's seed (showcase.05, AC-07), so fixes made in the app can be written back
// into the seed, the one source for each house (samples.09). Every table, row by row by id and field by field: a moved
// or resized piece, a finish, a curtain, a wall, an added or removed row. compare-sample.ts checks a recording's rooms;
// this lists everything.
//
//   tsx scripts/diff-sample.ts <data folder> "<sample name>"   → one line per difference, or "no differences"
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENING_KINDS, fromStored } from "@fm/domain";
import type { Document } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { SAMPLES } from "./samples";
import { seedProject } from "./seed-kit";

/** Below half a millimetre two numbers are the same: the store keeps millimetres. */
const SAME = 0.0005;
const TABLES = [
  "joints", "walls", "zoneLabels", "decks", "deckHoles", "states", "objects", "placements", "openings", "dimensions",
  "projectFields", "ceilings", "sections", "areas", "sheets", "underlays", "logos",
] as const satisfies readonly (keyof Document)[];

/** A row's fields as dotted paths to plain values: `at.x`, `walls.colour`, `z.standard`. */
function flatten(value: unknown, path: string, out: Map<string, unknown>): Map<string, unknown> {
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else {
    out.set(path, value);
  }
  return out;
}

const shown = (v: unknown): string => (v === undefined || v === null ? "—" : typeof v === "number" ? v.toFixed(3) : String(v));
const same = (a: unknown, b: unknown): boolean =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < SAME : a === b;

/** How a row is named in a line: the piece's name (and layout), the room's, the opening's kind. */
function nameOf(doc: Document, table: (typeof TABLES)[number], id: string): string {
  const stateName = (sid: string): string => doc.states[sid]?.name ?? sid;
  switch (table) {
    case "objects": return doc.objects[id]?.name ?? "";
    case "placements": {
      const p = doc.placements[id];
      return p ? `${doc.objects[p.object]?.name ?? p.object}, ${stateName(p.state)}` : "";
    }
    case "zoneLabels": return doc.zoneLabels[id]?.name ?? "";
    case "openings": {
      const o = doc.openings[id];
      return o ? OPENING_KINDS[o.kind].label : "";
    }
    case "decks": return doc.decks[id]?.name ?? "";
    case "states": return doc.states[id]?.name ?? "";
    default: return "";
  }
}

/** The ways `project` differs from `seed`, one line each: "<table> <id> (<name>): <field> <seed> → <project>". */
export function diffSample(project: Document, seed: Document): string[] {
  const out: string[] = [];
  for (const table of TABLES) {
    const p: Record<string, unknown> = project[table];
    const s: Record<string, unknown> = seed[table];
    const ids = [...new Set([...Object.keys(s), ...Object.keys(p)])].sort();
    for (const id of ids) {
      const inP = Object.hasOwn(p, id);
      const inS = Object.hasOwn(s, id);
      const name = nameOf(inP ? project : seed, table, id);
      const head = `${table} ${id}${name ? ` (${name})` : ""}`;
      if (!inS) { out.push(`${head}: added`); continue; }
      if (!inP) { out.push(`${head}: removed`); continue; }
      const a = flatten(s[id], "", new Map());
      const b = flatten(p[id], "", new Map());
      for (const field of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        if (!same(a.get(field), b.get(field))) out.push(`${head}: ${field} ${shown(a.get(field))} → ${shown(b.get(field))}`);
      }
    }
  }
  return out;
}

async function main(folder: string, name: string): Promise<void> {
  const sample = SAMPLES.find((s) => s.name === name);
  if (!sample) throw new Error(`no sample named "${name}"; the samples are ${SAMPLES.map((s) => `"${s.name}"`).join(", ")}`);
  const repo = createJsonFileRepository(folder);
  const meta = (await repo.list()).find((m) => m.name === name);
  const state = meta ? await repo.load(meta.id) : null;
  if (!state) throw new Error(`no project named "${name}" in ${folder}`);
  const scratch = await mkdtemp(join(tmpdir(), "fm-diff-"));
  try {
    const seedRepo = createJsonFileRepository(scratch);
    const seedMeta = await seedProject(seedRepo, sample.name, sample.steps(), sample.prefix);
    const seedState = await seedRepo.load(seedMeta.id);
    if (!seedState) throw new Error("the seed was not saved");
    const lines = diffSample(unwrap(fromStored(state.doc)), unwrap(fromStored(seedState.doc)));
    console.log(lines.length === 0 ? `"${name}": no differences from its seed.` : lines.join("\n"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const [folder, name] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  if (!folder || !name) throw new Error('usage: tsx scripts/diff-sample.ts <data folder> "<sample name>"');
  await main(folder, name);
}
