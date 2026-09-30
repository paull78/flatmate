import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { DEFAULT_GRID_SIZE, seedGrid } from "./seed-grid";

// `pnpm demo:seed-grid [N]` (spec §6.3). Same directory rule as src/main.ts.
const n = Number(process.argv[2] ?? DEFAULT_GRID_SIZE);
if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error(`grid size must be a whole number from 1 to 200, not ${process.argv[2]}`);
const dir = process.env.DATA_DIR ?? "./data";
const started = performance.now();
const meta = await seedGrid(createJsonFileRepository(dir), n);
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`"${meta.name}" is ready in ${dir} (project ${meta.id}, ${2 * n * (n + 1)} walls, ${n * n} rooms, ${seconds} s).`);
