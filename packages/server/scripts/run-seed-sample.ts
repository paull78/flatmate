import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedSample } from "./seed-sample";

// Same directory rule as src/main.ts.
const dir = process.env.DATA_DIR ?? "./data";
const meta = await seedSample(createJsonFileRepository(dir));
console.log(`"${meta.name}" is ready in ${dir} (project ${meta.id}).`);
