// Refreezing real3d's AC-16 pictures when a step changes how 3D looks (studio.06, .12). Before the change, `render` a
// "before" set; after it, `check` that every changed pixel lies within 2 px of the faces the step meant to change (the
// mask: those faces drawn alone), with diff pictures for the gate; then `write` refreezes only the pictures that changed.
//   pnpm --filter @fm/mcp refreeze-look3d render <dir>
//   pnpm --filter @fm/mcp refreeze-look3d check <dir> --mask decks|caps|openings [--out <diff-dir>]
//   pnpm --filter @fm/mcp refreeze-look3d check <dir> --mask pieces --kinds shelf,tvUnit [--out <diff-dir>]
//   pnpm --filter @fm/mcp refreeze-look3d write <dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STYLE_3D, type Face3d } from "@fm/editor";
import { encodePng } from "../src/png";
import { FIXTURE_DIR, fixtureCapFaces, fixtureFaces, fixtureOpeningFaces, fixturePieceBoxes, fixturePixels, index, type Picture } from "../test/fixture-pictures";
import { pngPixels } from "../test/pictures";
import { changedOutsideMask, differs } from "../test/refreeze";

const MASK_COLOUR = "#ff00ff";

/** The faces a mask kind covers: what the step changes. */
function maskFaces(kind: string, p: Picture, faces: readonly Face3d[], kinds: readonly string[]): Face3d[] {
  switch (kind) {
    case "decks": return faces.filter((f) => f.owner.startsWith("deck/"));
    case "caps": return fixtureCapFaces(p);
    case "openings": return fixtureOpeningFaces(p);
    case "pieces": return fixturePieceBoxes(p, kinds);
    default: throw new Error(`unknown mask "${kind}" (decks, caps, openings, pieces)`);
  }
}

const before = (dir: string, p: Picture): Uint8Array => pngPixels(readFileSync(join(dir, p.file))).pixels;

const [mode, dir, ...rest] = process.argv.slice(2);
const option = (name: string): string | undefined => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
if (!mode || !dir) throw new Error("usage: refreeze-look3d render|check|write <dir> [--mask decks|caps|openings|pieces] [--kinds a,b] [--out <diff-dir>]");

switch (mode) {
  case "render": {
    mkdirSync(dir, { recursive: true });
    for (const p of index.pictures) {
      const img = fixturePixels(p, fixtureFaces(p));
      writeFileSync(join(dir, p.file), encodePng(img.width, img.height, img.pixels));
    }
    console.log(`rendered ${index.pictures.length} pictures into ${dir}`);
    break;
  }
  case "check": {
    const kind = option("--mask");
    if (!kind) throw new Error("check needs --mask");
    const kinds = option("--kinds")?.split(",") ?? [];
    if (kind === "pieces" && kinds.length === 0) throw new Error("--mask pieces needs --kinds");
    const out = option("--out");
    if (out) mkdirSync(out, { recursive: true });
    let bad = 0;
    for (const p of index.pictures) {
      const faces = fixtureFaces(p);
      const img = fixturePixels(p, faces);
      const old = before(dir, p);
      if (!differs(old, img.pixels)) continue;
      const marked = maskFaces(kind, p, faces, kinds).map((f) => ({ ...f, color: MASK_COLOUR }));
      const mask = fixturePixels(p, marked, { ...STYLE_3D, edge: MASK_COLOUR }).pixels;
      const cells = new Uint8Array(img.width * img.height);
      for (let k = 0; k < cells.length; k++) if (mask[4 * k] === 255 && mask[4 * k + 1] === 0 && mask[4 * k + 2] === 255) cells[k] = 1;
      const outside = changedOutsideMask(old, img.pixels, cells, img.width);
      let changed = 0;
      const diff = new Uint8Array(img.pixels);
      for (let k = 0; k < cells.length; k++) {
        if (![0, 1, 2].some((c) => Math.abs((old[4 * k + c] ?? 0) - (img.pixels[4 * k + c] ?? 0)) > 8)) continue;
        changed++;
        diff.set([255, 0, 255, 255], 4 * k);
      }
      for (const { x, y } of outside) diff.set([255, 0, 0, 255], 4 * (y * img.width + x));
      if (out) writeFileSync(join(out, `diff-${p.file}`), encodePng(img.width, img.height, diff));
      console.log(`${p.file}: ${changed} px changed, ${outside.length} outside the ${kind} mask`);
      if (outside.length > 0) bad++;
    }
    if (bad > 0) {
      console.error(`${bad} picture(s) changed outside the mask`);
      process.exit(1);
    }
    break;
  }
  case "write": {
    const written: string[] = [];
    for (const p of index.pictures) {
      const img = fixturePixels(p, fixtureFaces(p));
      if (!differs(before(dir, p), img.pixels)) continue;
      writeFileSync(new URL(p.file, FIXTURE_DIR), encodePng(img.width, img.height, img.pixels));
      written.push(p.file);
    }
    console.log(`refroze ${written.length}: ${written.join(", ") || "none"}`);
    break;
  }
  default:
    throw new Error(`unknown mode "${mode}"`);
}
