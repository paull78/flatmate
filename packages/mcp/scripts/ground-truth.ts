import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptyDocument, execute, PROVISIONAL_METRES_PER_PIXEL, UNDERLAY_ID, type Command, type Document } from "@fm/domain";
import { floorView, LOOK_LONG_SIDE, lookPicture, pictureBounds, pictureLayers, planPicture, PRESENTATION_STYLE } from "@fm/editor";
import { toSvg } from "@fm/export";
import { MAX_UNDERLAY_DATA_CHARS } from "@fm/protocol";
import { encode } from "jpeg-js";
import { z } from "zod";
import { createNodeHost } from "../src/node-host";
import { svgToPixels, svgToPng } from "../src/rasterise";
import { EditorSession } from "../src/session";
import { wsConnect } from "../src/ws-link";
import { grainJpeg, pngSize } from "../test/pictures";
import { compareTrace, compareTraceByUnderlay } from "./compare-trace";
import { build, fixtureText, GROUND_TRUTH_FILE, groundTruthCommands, loadGroundTruth } from "./ground-truth-plan";

// The ground truth's command line (import.18): build | render | seed | sizes | compare <project name> [--underlay].
//   build    writes test/fixtures/ground-truth.json from the commands (deterministic)
//   render   writes data/ground-truth.png and two test underlays (data/ is ignored by git)
//   seed     creates the "Ground truth" project on the running server (FM_SERVER_URL, default port 8797)
//   sizes    prints look's PNG size over each test underlay (offline; AC-14)
//   compare  scores a traced project against the ground truth (AC-15); with --underlay, a trace over the truth's PNG
//            dropped anywhere, registered through its underlay row

const SERVER_URL = process.env.FM_SERVER_URL ?? "ws://localhost:8797";
const PROJECT_NAME = "Ground truth";
// The browser's PNG export frames at zoom 10 with a 3,000 px long side (editor export/panel.ts:28-29 SVG_ZOOM and
// PNG_LONG_SIDE, :133-139 svgContent, :185-190 download); the constants are private there.
const EXPORT_ZOOM = 10;
const EXPORT_LONG_SIDE = 3000;
// The web import's first attempt (2000 px at q0.85) and its lowest quality at 2000 px (q0.60), import.14.
const UNDERLAY_LONG_SIDE = 2000;
const UNDERLAY_QUALITY = 85;
const WORST_QUALITY = 60;
const GRAIN_SEED = 1801;
// Ignored by git.
const DATA = new URL("../data/", import.meta.url);
const UNDERLAYS = ["ground-truth", "worst-case"] as const;

const out = (name: string): string => fileURLToPath(new URL(name, DATA));
const base64Length = (bytes: Uint8Array): number => 4 * Math.ceil(bytes.length / 3);

function buildFixture(): void {
  mkdirSync(new URL(".", GROUND_TRUTH_FILE), { recursive: true });
  writeFileSync(GROUND_TRUTH_FILE, fixtureText(build(groundTruthCommands())));
  console.log(`wrote ${fileURLToPath(GROUND_TRUTH_FILE)}`);
}

function render(): void {
  mkdirSync(fileURLToPath(DATA), { recursive: true });
  const doc = loadGroundTruth();
  const bounds = pictureBounds(doc, null);
  const svg = toSvg(pictureLayers(planPicture(doc, floorView(doc, null), PRESENTATION_STYLE, EXPORT_ZOOM, true)), { ...bounds, zoom: EXPORT_ZOOM });
  // The paper picture's Helvetica text draws in look's bundled Inter here (render.15); the geometry, which AC-15
  // compares, is exact.
  const png = svgToPng(svg, EXPORT_LONG_SIDE);
  writeFileSync(out("ground-truth.png"), png);
  const size = pngSize(png);
  console.log(`wrote data/ground-truth.png: ${size.width} × ${size.height} px, ${png.length} B`);

  // The underlay as the web would store it: 2000 px on the long side, JPEG. Placement: the picture's top-left is the
  // frame's top-left; the short side is rounded to whole pixels, so it is off by at most half a pixel.
  const pixels = svgToPixels(svg, UNDERLAY_LONG_SIDE);
  const longSideMetres = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
  const placement = {
    at: { x: bounds.min.x, y: bounds.max.y },
    metresPerPixel: longSideMetres / UNDERLAY_LONG_SIDE,
    width: pixels.width,
    height: pixels.height,
  };
  const jpeg = encode({ data: pixels.pixels, width: pixels.width, height: pixels.height }, UNDERLAY_QUALITY).data;
  writeFileSync(out("ground-truth-underlay.jpg"), jpeg);
  writeFileSync(out("ground-truth-underlay.json"), `${JSON.stringify(placement, null, 2)}\n`);
  console.log(`wrote data/ground-truth-underlay.jpg: ${pixels.width} × ${pixels.height} px, q${UNDERLAY_QUALITY}, ${base64Length(jpeg)} base64 chars`);

  // The worst case the web would still store: the most grain that fits the data cap at the lowest quality. Raw white
  // noise (about 2.7 MB) would never be stored. jpeg-js sizes only approximate the browser's encoder.
  let worst: { amplitude: number; jpeg: Uint8Array } | null = null;
  for (let amplitude = 8; amplitude <= 128; amplitude += 8) {
    const noisy = grainJpeg(pixels.pixels, pixels.width, pixels.height, amplitude, GRAIN_SEED, WORST_QUALITY);
    const chars = base64Length(noisy);
    console.log(`  grain ±${amplitude}: ${chars} base64 chars${chars <= MAX_UNDERLAY_DATA_CHARS ? "" : " (over the cap)"}`);
    if (chars <= MAX_UNDERLAY_DATA_CHARS) worst = { amplitude, jpeg: noisy };
  }
  if (worst === null) throw new Error("no grain amplitude fits the data cap");
  writeFileSync(out("worst-case-underlay.jpg"), worst.jpeg);
  writeFileSync(out("worst-case-underlay.json"), `${JSON.stringify(placement, null, 2)}\n`);
  console.log(`wrote data/worst-case-underlay.jpg: grain ±${worst.amplitude}, q${WORST_QUALITY}, ${base64Length(worst.jpeg)} base64 chars (cap ${MAX_UNDERLAY_DATA_CHARS})`);
}

const placement = z.object({
  at: z.object({ x: z.number(), y: z.number() }),
  metresPerPixel: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * A drawing holding a test underlay as its row, placed as `render` recorded it: dropped at its top-left, then scaled
 * about that corner to the recorded metres per pixel, as the Scale tool or scale_underlay would.
 */
function underlayDocument(name: (typeof UNDERLAYS)[number]): Document {
  let data: string;
  let json: unknown;
  try {
    data = readFileSync(out(`${name}-underlay.jpg`)).toString("base64");
    json = JSON.parse(readFileSync(out(`${name}-underlay.json`), "utf8"));
  } catch {
    throw new Error(`No ${name} underlay: run \`pnpm --filter @fm/mcp run ground-truth render\` first`);
  }
  const { at, metresPerPixel, width, height } = placement.parse(json);
  const commands: Command[] = [
    { type: "placeUnderlay", pictureId: name, data, width, height, at },
    { type: "scaleUnderlay", a: at, b: { x: at.x + 1, y: at.y }, distance: metresPerPixel / PROVISIONAL_METRES_PER_PIXEL },
  ];
  return commands.reduce((doc, c) => {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(r.error.message);
    return r.value.doc;
  }, emptyDocument());
}

function sizes(): void {
  console.log(`look over the whole underlay, no drawing, ${LOOK_LONG_SIDE} px long side:`);
  console.log("underlay      png bytes  base64 chars");
  for (const name of UNDERLAYS) {
    const look = lookPicture(underlayDocument(name), null);
    if ("refused" in look) throw new Error(look.refused);
    const png = svgToPng(toSvg(look.primitives, look.frame), LOOK_LONG_SIDE);
    console.log([name.padEnd(13), String(png.length).padStart(9), String(base64Length(png)).padStart(13)].join(" "));
  }
}

/** A session on the server; the caller closes it and exits, since the reconnect timer would keep the process alive. */
function connect(): EditorSession {
  const host = createNodeHost();
  return new EditorSession({ clientId: host.newId(), name: "Ground truth seed", host, connect: wsConnect(SERVER_URL) });
}

async function seed(session: EditorSession): Promise<void> {
  const projects = await session.listProjects();
  if (!projects.ok) throw new Error(projects.error);
  const existing = projects.value.find((p) => p.name === PROJECT_NAME);
  if (existing) {
    console.log(`"${PROJECT_NAME}" exists: ${existing.id}`);
    return;
  }
  const created = await session.createProject(PROJECT_NAME);
  if (!created.ok) throw new Error(created.error);
  const edited = await session.editAll(groundTruthCommands());
  if (!edited.ok) throw new Error(`seeding stopped after ${edited.error.done} commands: ${edited.error.error}`);
  console.log(`created "${PROJECT_NAME}": ${created.value.id} on ${SERVER_URL}`);
}

async function compare(session: EditorSession, name: string, byUnderlay: boolean): Promise<boolean> {
  const projects = await session.listProjects();
  if (!projects.ok) throw new Error(projects.error);
  const project = projects.value.find((p) => p.name === name);
  if (!project) throw new Error(`no project named "${name}" on ${SERVER_URL}`);
  const opened = await session.openProject(project.id);
  if (!opened.ok) throw new Error(opened.error);
  const traced = session.drawing();
  if (!traced) throw new Error("the project did not open");
  // Without --underlay, offset zero: the test underlays are placed in the truth's own frame.
  const r = byUnderlay ? compareTraceByUnderlay(loadGroundTruth(), traced) : compareTrace(loadGroundTruth(), traced);
  if (byUnderlay) {
    // The row's placement and scale only; never its data (AC-10).
    const row = traced.underlays[UNDERLAY_ID];
    if (row) {
      console.log(`offset ${r.offset.x.toFixed(3)}, ${r.offset.y.toFixed(3)} m (truth top-left − underlay at)`);
      console.log(`underlay ${row.metresPerPixel} m per pixel, scaled ${row.scaled}${row.scaled ? "" : "  WARNING: unscaled"}`);
    }
  }
  if (r.reason) console.log(r.reason);
  for (const w of r.walls) console.log(`${w.wallId.padEnd(16)} ${(w.deviation * 1000).toFixed(0).padStart(6)} mm  ${w.pass ? "PASS" : "FAIL"}`);
  console.log(`max ${(r.max * 1000).toFixed(0)} mm (bar 100 mm)`);
  console.log(`rooms truth:  ${r.rooms.truth.join(", ")}`);
  console.log(`rooms traced: ${r.rooms.traced.join(", ") || "(none)"}  ${r.rooms.pass ? "PASS" : "FAIL"}`);
  console.log(r.pass ? "PASS" : "FAIL");
  return r.pass;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "build":
      return buildFixture();
    case "render":
      return render();
    case "sizes":
      return sizes();
    case "seed":
    case "compare": {
      const session = connect();
      let code = 0;
      try {
        if (command === "seed") await seed(session);
        else if (!(await compare(session, rest.filter((a) => a !== "--underlay").join(" "), rest.includes("--underlay")))) code = 1;
      } finally {
        session.close();
      }
      process.exit(code);
      return;
    }
    default:
      console.error("usage: ground-truth build | render | seed | sizes | compare <project name> [--underlay]");
      process.exit(2);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
