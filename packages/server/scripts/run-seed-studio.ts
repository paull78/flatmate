import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedStudio } from "./seed-studio";

// `pnpm seed:studio` (parts step 04). Same directory rule as src/main.ts.
const dir = process.env.DATA_DIR ?? "./data";
const meta = await seedStudio(createJsonFileRepository(dir));
console.log(`"${meta.name}" is ready in ${dir} (project ${meta.id}).`);
