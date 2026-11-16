import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedSamples, seedSamplesIfEmpty } from "./seed-samples";

// `pnpm seed:samples` adds any missing sample; `scripts/start.sh` runs it with --if-empty before the server starts
// (samples.04). Same directory rule as src/main.ts.
const dir = process.env.DATA_DIR ?? "./data";
const ifEmpty = process.argv.includes("--if-empty");
const repository = createJsonFileRepository(dir);
const added = ifEmpty ? await seedSamplesIfEmpty(repository) : await seedSamples(repository);
console.log(added.length === 0 ? `${dir}: added no samples.` : `${dir}: added ${added.map((m) => `"${m.name}"`).join(", ")}.`);
