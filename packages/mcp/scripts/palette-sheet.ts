// The palette sheet (parts step 05, parts.11): the seeded studio rendered through raster3d, as `look` renders it
// (real3d.11), in several material palettes, by Day and by Night from two corners; PNGs and an index.html grid in <out-dir>.
//   pnpm --filter @fm/server exec tsx scripts/run-seed-studio.ts   (DATA_DIR=<dir>, or ./data under packages/server)
//   pnpm --filter @fm/mcp palette-sheet <data-dir> <out-dir>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromStored, upgradeStored, type Document } from "@fm/domain";
import { lookScene3d, STYLE_3D, type Style3d } from "@fm/editor";
import { isRecord, parseProjectMeta, parseStoredDocument, unwrap } from "@fm/protocol";
import { look3dPng } from "../src/look3d-png";

type Slots = Style3d["slots"];

/** Three shades from a top: lit and shaded at about 0.89 and 0.775 of it, as today's piece shades are. */
function shades(top: string): { top: string; lit: string; shaded: string } {
  const scale = (f: number) => `#${[1, 3, 5].map((i) => Math.round(parseInt(top.slice(i, i + 2), 16) * f).toString(16).padStart(2, "0")).join("")}`;
  return { top, lit: scale(0.89), shaded: scale(0.775) };
}
const palette = (tops: Record<Exclude<keyof Slots, "plain" | "flame">, string>): Slots => ({
  wood: shades(tops.wood), dark: shades(tops.dark), fabric: shades(tops.fabric), linen: shades(tops.linen),
  laminate: shades(tops.laminate), metal: shades(tops.metal), ceramic: shades(tops.ceramic), plain: STYLE_3D.slots.plain, flame: STYLE_3D.slots.flame,
});

export const PALETTES: Record<string, Slots> = {
  "A · Scandi": palette({ wood: "#d6b88f", dark: "#4d4945", fabric: "#9db09a", linen: "#f3e7d3", laminate: "#f8f7f3", metal: "#bcc1c6", ceramic: "#f5f5f2" }),
  "B · Warm": palette({ wood: "#9a6b47", dark: "#2f2b28", fabric: "#c47a5a", linen: "#e6d8bf", laminate: "#f5ecd6", metal: "#7d848b", ceramic: "#f5f5f2" }),
  "C · Soft diagram": palette({ wood: "#e3d3b8", dark: "#8a8781", fabric: "#a9b6c4", linen: "#faf3e4", laminate: "#f7f6f2", metal: "#cdd1d5", ceramic: "#f5f5f2" }),
};

function studio(dataDir: string): Document {
  for (const f of readdirSync(dataDir).filter((n) => n.endsWith(".json"))) {
    const json: unknown = JSON.parse(readFileSync(join(dataDir, f), "utf8"));
    if (!isRecord(json) || parseProjectMeta(json.meta)?.name !== "Studio") continue;
    const doc = parseStoredDocument(json.doc, "empty");
    if (doc) return unwrap(fromStored(upgradeStored(doc)));
  }
  throw new Error(`no "Studio" project in ${dataDir}: seed it first with pnpm --filter @fm/server exec tsx scripts/run-seed-studio.ts`);
}

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) throw new Error("usage: palette-sheet <data-dir> <out-dir>");
mkdirSync(outDir, { recursive: true });
const doc = studio(dataDir);
const states = Object.values(doc.states).sort((a, b) => a.order - b.order);
const cells: { palette: string; file: string; caption: string }[] = [];
for (const [name, slots] of Object.entries(PALETTES)) {
  for (const yaw of [225, 45]) {
    for (const state of states) {
      const scene = lookScene3d(doc, state.id, { yaw, tilt: 35 }, { ...STYLE_3D, slots });
      if ("refused" in scene) throw new Error(scene.refused);
      const file = `${name.charAt(0)}-${state.name}-${yaw}.png`;
      writeFileSync(join(outDir, file), look3dPng(scene));
      cells.push({ palette: name, file, caption: `${state.name}, yaw ${yaw}°` });
    }
  }
}
const rows = Object.keys(PALETTES).map((p) => `<h2>${p}</h2><div class="row">${cells.filter((c) => c.palette === p).map((c) => `<figure><img src="${c.file}" alt="${p}, ${c.caption}"><figcaption>${c.caption}</figcaption></figure>`).join("")}</div>`).join("\n");
writeFileSync(join(outDir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Palette sheet</title>${rows}\n`);
console.log(`${cells.length} pictures and index.html in ${outDir}`);
