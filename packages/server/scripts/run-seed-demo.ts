import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedDemo } from "./seed-demo";

// Same directory rule as src/main.ts.
const dir = process.env.DATA_DIR ?? "./data";
const meta = await seedDemo(createJsonFileRepository(dir));
console.log(`"${meta.name}" is ready in ${dir} (project ${meta.id}).`);
