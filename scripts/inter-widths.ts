import { readFileSync, writeFileSync } from "node:fs";
import { interWidthsSource } from "./src/inter-widths";

// Regenerates the editor's Inter width table from the bundled TTF: `pnpm exec tsx scripts/inter-widths.ts`.
const ttf = new URL("../packages/editor/fonts/Inter-Regular.ttf", import.meta.url);
const out = new URL("../packages/editor/src/view/inter-widths.ts", import.meta.url);
writeFileSync(out, interWidthsSource(readFileSync(ttf)));
console.log(`wrote ${out.pathname}`);
