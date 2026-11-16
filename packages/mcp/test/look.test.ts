import { afterEach, describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Box, type Command, type Document } from "@fm/domain";
import { CHROME_FONT, LOOK_FADE, LOOK_LONG_SIDE, LOOK_RULER, LOOK_STYLE, lookPicture, textWidth, type LookPicture } from "@fm/editor";
import { toSvg } from "@fm/export";
import { MAX_UNDERLAY_DATA_CHARS, type Point } from "@fm/protocol";
import type { Region } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type LookReply } from "../src/tools";
import { TestServer } from "./harness";
import { mulberry32, noisyJpeg, pngPixels, pngSize, QUADRANTS, quadrantJpeg, rgb } from "./pictures";

// Claude's look (import.08, .12; AC-08, AC-14): every expectation is computed here, independently of underlayRect.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

/**
 * The PNG budget for the worst-case noisy underlay: the spike's 1100 px, fade 0.5 look over a worst-case underlay at
 * the cap, which showed inline in Claude Code with no token error (import.22, gate M1 import.28).
 */
const LOOK_PNG_BUDGET_BYTES = 999_285;

type RGB = [number, number, number];
type Image = { width: number; height: number; pixels: Uint8Array };

const DATA = Buffer.from(quadrantJpeg(400, 300, QUADRANTS, 90)).toString("base64");
const AT = { x: -2.37, y: 5.81 };
/** The picture's rect at the provisional 0.01 m/px, worked out here: 400 × 300 px from its top-left corner AT. */
const RECT = { minX: -2.37, maxY: 5.81, maxX: 1.63, minY: 2.81 };

const place = (data: string, width: number, height: number, at: Point): Command => ({ type: "placeUnderlay", pictureId: "picture-1", data, width, height, at });

async function setup(): Promise<{ server: TestServer; tools: DrawingTools; claude: EditorSession; alice: EditorSession }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  const alice = server.join("Alice").session;
  sessions.push(claude, alice);
  const tools = createTools(claude);
  const created = await tools.createProject({ name: "Look" });
  expect(created.isError, created.text).toBe(false);
  const id = claude.project()?.id ?? "";
  expect((await alice.openProject(id)).ok).toBe(true);
  return { server, tools, claude, alice };
}

/** Alice drops the quadrant picture; Claude sees it once the server has delivered. */
async function withPicture(): Promise<Awaited<ReturnType<typeof setup>>> {
  const s = await setup();
  expect((await s.alice.edit(place(DATA, 400, 300, AT))).ok).toBe(true);
  await s.server.settle();
  return s;
}

function png(r: LookReply): Uint8Array {
  if (!("png" in r)) throw new Error(`look refused: ${r.text}`);
  return r.png;
}

/** What look shows over white for a quadrant colour: the sRGB saturate-0 grey, faded by LOOK_FADE. */
function expected(hex: string): RGB {
  const [r, g, b] = rgb(hex);
  const grey = 0.213 * r + 0.715 * g + 0.072 * b;
  const c = 255 * LOOK_FADE + grey * (1 - LOOK_FADE);
  return [c, c, c];
}

const distance = (p: RGB, q: RGB): number => Math.max(...p.map((v, i) => Math.abs(v - (q[i] ?? 0))));

/** Region metres to PNG pixels: x from the left, y down from the top. */
function toPixel(img: Image, region: Box, p: Point): { px: number; py: number } {
  return {
    px: ((p.x - region.minX) * img.width) / (region.maxX - region.minX),
    py: ((region.maxY - p.y) * img.height) / (region.maxY - region.minY),
  };
}

function pixel(img: Image, px: number, py: number): RGB {
  const i = (Math.floor(py) * img.width + Math.floor(px)) * 4;
  return [img.pixels[i] ?? -1, img.pixels[i + 1] ?? -1, img.pixels[i + 2] ?? -1];
}

/** The grid step: the smallest gap between two ruler labels on one axis. */
function rulerStep(picture: LookPicture): number {
  const labels = picture.primitives.flatMap((p) => (p.kind === "text" && p.color === LOOK_RULER.ink ? [p] : []));
  const gaps = (values: number[]): number[] => values.sort((a, b) => a - b).slice(1).map((v, i) => v - (values[i] ?? v));
  const xs = labels.filter((l) => l.align === "center").map((l) => l.at.x);
  const ys = labels.filter((l) => l.align === "right").map((l) => l.at.y);
  return Math.min(...gaps(xs), ...gaps(ys));
}

/** A probe within 2 px of a grid line moves 3 px off it, so the light grid can't tint it. */
function offGrid(v: number, step: number, pxPerMetre: number): number {
  const line = Math.round(v / step) * step;
  const gap = (v - line) * pxPerMetre;
  if (Math.abs(gap) >= 2) return v;
  return line + ((gap >= 0 ? 1 : -1) * 3) / pxPerMetre;
}

/** The look's pixel at plan point p, moved off the grid. */
function probe(img: Image, picture: LookPicture, p: Point): RGB {
  const { min, max } = picture.frame;
  const region = { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
  const step = rulerStep(picture);
  const ppm = img.width / (max.x - min.x);
  const q = toPixel(img, region, { x: offGrid(p.x, step, ppm), y: offGrid(p.y, step, ppm) });
  return pixel(img, q.px, q.py);
}

const box = (r: Region): Box => ({ minX: r.min.x, minY: r.min.y, maxX: r.max.x, maxY: r.max.y });

describe("look (import.08, .12; AC-08)", () => {
  it("look returns one PNG of the whole underlay with the caption", async () => {
    const { tools, claude } = await withPicture();
    const r = await tools.look({});
    const bytes = png(r);
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // The default region is the 4 × 3 m picture plus 4 % of its long side (0.16 m) on every side (import.37).
    const size = pngSize(bytes);
    expect(size.width).toBe(LOOK_LONG_SIDE);
    expect(Math.abs(size.height - (LOOK_LONG_SIDE * 3.32) / 4.32)).toBeLessThanOrEqual(1);
    const doc = claude.drawing() ?? emptyDocument();
    const picture = lookPicture(doc, null);
    if ("refused" in picture) throw new Error(picture.refused);
    expect(r.text).toBe(picture.caption);
    expect(r.text.startsWith("UNSCALED")).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["isError", "png", "text"]);
    expect(r.isError).toBe(false);
  });

  it("look on a region taller than wide keeps the long side at 1100", async () => {
    const { tools } = await withPicture();
    const size = pngSize(png(await tools.look({ region: { min: { x: -1.3, y: 0.7 }, max: { x: 2.1, y: 9.9 } } })));
    expect(Math.abs(size.height - 1100)).toBeLessThanOrEqual(1);
    expect(Math.abs(size.width - 407)).toBeLessThanOrEqual(1);
  });

  it("look with a region frames only that region", async () => {
    const { tools, claude } = await withPicture();
    const tr: Region = { min: { x: -0.37, y: 4.31 }, max: { x: 1.63, y: 5.81 } };
    const img = pngPixels(png(await tools.look({ region: tr })));
    const picture = lookPicture(claude.drawing() ?? emptyDocument(), box(tr));
    if ("refused" in picture) throw new Error(picture.refused);
    const [tl, trColour, bl, br] = QUADRANTS.map(expected);
    for (const fx of [0.25, 0.75]) {
      for (const fy of [0.25, 0.75]) {
        const p = { x: tr.min.x + fx * (tr.max.x - tr.min.x), y: tr.min.y + fy * (tr.max.y - tr.min.y) };
        const seen = probe(img, picture, p);
        expect(distance(seen, trColour ?? [0, 0, 0]), `${fx}, ${fy}: ${seen.join(",")}`).toBeLessThanOrEqual(10);
        for (const other of [tl, bl, br]) expect(distance(seen, other ?? [0, 0, 0])).toBeGreaterThan(10);
      }
    }
  });

  it.each([1, 2, 3])("four-quadrant alignment on raw pixels, seeded placements (seed %i)", async (seed) => {
    const { tools, claude } = await withPicture();
    const random = mulberry32(seed);
    const a = { x: RECT.minX + (0.15 + 0.7 * random()) * 4, y: RECT.maxY - (0.15 + 0.7 * random()) * 3 };
    const b = { x: a.x + 3, y: a.y + 4 };
    const d = 2 + 13 * random();
    const scaled = await tools.scaleUnderlay({ a, b, distance: d });
    expect(scaled.isError, scaled.text).toBe(false);
    // The new placement, worked out here: m′ = 0.01·d/5 and a stays put.
    const m = (0.01 * d) / 5;
    const at = { x: a.x + (AT.x - a.x) * (m / 0.01), y: a.y + (AT.y - a.y) * (m / 0.01) };
    const px = (x: number, y: number): Point => ({ x: at.x + x * m, y: at.y - y * m }); // picture pixels to metres
    const edge = at.x + 200 * m;
    const wall = await tools.addWall({ a: { x: edge, y: at.y - 75 * m }, b: { x: edge, y: at.y - 225 * m } });
    expect(wall.isError, wall.text).toBe(false);

    const img = pngPixels(png(await tools.look({})));
    const picture = lookPicture(claude.drawing() ?? emptyDocument(), null);
    if ("refused" in picture) throw new Error(picture.refused);
    const [tl, tr, bl, br] = QUADRANTS.map(expected);
    const near = (p: Point, colour: RGB | undefined, what: string): void => {
      const seen = probe(img, picture, p);
      expect(distance(seen, colour ?? [0, 0, 0]), `${what} at ${p.x.toFixed(3)}, ${p.y.toFixed(3)}: ${seen.join(",")}`).toBeLessThanOrEqual(10);
    };
    near(px(100, 75), tl, "TL");
    near(px(300, 75), tr, "TR");
    near(px(100, 225), bl, "BL");
    near(px(300, 225), br, "BR");
    const ink = rgb(LOOK_STYLE.wall);
    const side = 0.1 + 0.25; // half the 0.20 m wall, then 0.25 m beyond its face
    for (const [row, left, right] of [[112.5, tl, tr], [187.5, bl, br]] as const) {
      const centre = px(200, row);
      near(centre, ink, "wall");
      near({ x: centre.x - side, y: centre.y }, left, "left of the wall");
      near({ x: centre.x + side, y: centre.y }, right, "right of the wall");
    }
  });

  it("a wall added between two looks appears in the second", async () => {
    const { tools, claude } = await setup();
    expect((await tools.addWall({ a: { x: 0, y: 0 }, b: { x: 4.2, y: 0 } })).isError).toBe(false);
    const region: Region = { min: { x: -0.6, y: 1.9 }, max: { x: 4.1, y: 3.3 } };
    const mid = { x: (1.13 + 3.49) / 2, y: 2.71 };
    const ink = rgb(LOOK_STYLE.wall);
    const before = pngPixels(png(await tools.look({ region })));
    expect((await tools.addWall({ a: { x: 1.13, y: 2.71 }, b: { x: 3.49, y: 2.71 } })).isError).toBe(false);
    const after = pngPixels(png(await tools.look({ region })));
    const picture = lookPicture(claude.drawing() ?? emptyDocument(), box(region));
    if ("refused" in picture) throw new Error(picture.refused);
    expect(distance(probe(before, picture, mid), ink)).toBeGreaterThan(10);
    expect(distance(probe(after, picture, mid), ink)).toBeLessThanOrEqual(10);
  });

  it("look with neither an underlay nor a drawing is refused", async () => {
    const { tools } = await setup();
    const refused = lookPicture(emptyDocument(), null);
    if (!("refused" in refused)) throw new Error("an empty drawing should be refused");
    const r = await tools.look({});
    expect(r).toEqual({ text: refused.refused, isError: true });
    expect("png" in r).toBe(false);
  });

  it("look refuses a region without area", async () => {
    const { tools } = await setup();
    const flat: Region = { min: { x: 1, y: 1 }, max: { x: 1, y: 3 } };
    // On an empty drawing lookPicture would answer "Nothing to look at", with a wall it would refuse in its own words:
    // the handler's reason both times shows lookPicture is never reached.
    const empty = await tools.look({ region: flat });
    expect(empty.isError).toBe(true);
    expect(empty.text).toBe("The region needs min below max on both axes");
    await tools.addWall({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } });
    expect(await tools.look({ region: flat })).toEqual({ text: "The region needs min below max on both axes", isError: true });
    expect(await tools.look({ region: { min: { x: 0, y: 2 }, max: { x: 3, y: 1 } } })).toEqual({ text: "The region needs min below max on both axes", isError: true });
  });

  it("look refuses a region too thin to draw, in lookPicture's words", async () => {
    const { tools, claude } = await withPicture();
    const thin: Region = { min: { x: 0, y: 0 }, max: { x: 10, y: 0.00001 } };
    // It passes the handler's area check, but its short side is under one look pixel: resvg would have nothing to draw.
    const refused = lookPicture(claude.drawing() ?? emptyDocument(), box(thin));
    if (!("refused" in refused)) throw new Error("a thin region should be refused");
    const r = await tools.look({ region: thin });
    expect(r).toEqual({ text: refused.refused, isError: true });
    expect(r.text).toContain("short side");
    expect("png" in r).toBe(false);
  });

  it("AC-14 byte budget over the worst-case noisy underlay", async () => {
    const data = Buffer.from(noisyJpeg(7)).toString("base64");
    expect(data.length).toBeLessThanOrEqual(MAX_UNDERLAY_DATA_CHARS);
    expect(data.length).toBeGreaterThan(0.8 * MAX_UNDERLAY_DATA_CHARS);
    const { server, tools, alice } = await setup();
    expect((await alice.edit(place(data, 2000, 1500, { x: -11.4, y: 23.9 }))).ok).toBe(true);
    await server.settle();
    const scaled = await tools.scaleUnderlay({ a: { x: -9.1, y: 20.3 }, b: { x: -6.1, y: 24.3 }, distance: 6.3 });
    expect(scaled.isError, scaled.text).toBe(false);
    const bytes = png(await tools.look({}));
    expect(bytes.length).toBeLessThanOrEqual(LOOK_PNG_BUDGET_BYTES);
    const size = pngSize(bytes);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(LOOK_LONG_SIDE);
  }, 30_000);

  it("AC-14 each ruler label's box contains ruler ink", async () => {
    // A drawing-only look: the backdrop is blank, so noise can't fake ink.
    const { tools, claude } = await setup();
    expect((await tools.drawRoom({ corner: { x: 12.6, y: -2.9 }, width: 1.5, depth: 2.4 })).isError).toBe(false);
    const region: Region = { min: { x: 12.34, y: -3.21 }, max: { x: 14.34, y: -0.21 } };
    const img = pngPixels(png(await tools.look({ region })));
    const picture = lookPicture(claude.drawing() ?? emptyDocument(), box(region));
    if ("refused" in picture) throw new Error(picture.refused);
    const ink = rgb(LOOK_RULER.ink);
    const labels = picture.primitives.flatMap((p) => (p.kind === "text" && p.color === LOOK_RULER.ink ? [p] : []));
    expect(labels.length).toBeGreaterThanOrEqual(4);
    const scale = img.width / ((region.max.x - region.min.x) * picture.frame.zoom); // PNG pixels per SVG unit
    for (const l of labels) {
      const w = textWidth(CHROME_FONT, l.text, l.size); // the ruler labels' font, as look measures them
      const x = (l.at.x - region.min.x) * picture.frame.zoom;
      const y = (region.max.y - l.at.y) * picture.frame.zoom;
      const left = l.align === "center" ? x - w / 2 : l.align === "right" ? x - w : x;
      let hits = 0;
      for (let py = Math.floor((y - l.size / 2) * scale); py < Math.ceil((y + l.size / 2) * scale); py++) {
        for (let px = Math.floor(left * scale); px < Math.ceil((left + w) * scale); px++) {
          const c = pixel(img, px, py);
          if (Math.hypot(c[0] - ink[0], c[1] - ink[1], c[2] - ink[2]) <= 60) hits++;
        }
      }
      expect(hits, `label "${l.text}"`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("decks in look's SVG (decks.07, AC-08)", () => {
  it("a 6 × 4 room with a platform and a loft: the loft's dashed lines and both labels, as look writes them", () => {
    const cmds: Command[] = [
      ...rectangleRoom({ x: 0, y: 0 }, 6, 4),
      { type: "addDeck", opId: "p", preset: "platform", at: { x: 1.5, y: 1.2 } },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.5, y: 2.8 } },
    ];
    const doc = cmds.reduce((d: Document, c) => unwrap(execute(d, c)).doc, emptyDocument());
    const picture = lookPicture(doc, null);
    if ("refused" in picture) throw new Error(picture.refused);
    const svg = toSvg(picture.primitives, picture.frame);
    const dashed = [...svg.matchAll(/<line [^>]*stroke="([^"]*)"[^>]*stroke-dasharray="[^"]+"\/>/g)].map((m) => m[1]);
    expect(dashed).toEqual(Array(4).fill(LOOK_STYLE.deck.line.color));
    expect(svg).toContain(">Loft +2.15</text>");
    expect(svg).toContain(">Platform +0.45</text>");
  });
});

describe("a stair in look (stairs.02, AC-13)", () => {
  /**
   * The studio of stairs.test.ts under a 3.05 ceiling (cut 1.20): the loft over x 0.1–3.6 and a storage stair facing +x
   * with its back edge on the loft's edge: x 3.6–5.59, y 1.65–2.25, its break 5 treads up at x 4.484, its label at
   * (4.595, 1.47) below the flight.
   */
  async function stairLook(): Promise<{ img: Image; region: Box }> {
    const { tools } = await setup();
    for (const r of [
      await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 2.5 }),
      await tools.setCeiling({ height: 3.05 }),
      await tools.addDeck({ preset: "loft", centre: { x: 1.85, y: 1.25 }, width: 3.5, depth: 2.3 }),
      await tools.placeObject({ layout: "s0", kind: "storageStair", centre: { x: 4.595, y: 1.95 }, rotation: 90 }),
    ]) expect(r.isError, r.text).toBe(false);
    const region: Region = { min: { x: 3.4, y: 1.3 }, max: { x: 5.8, y: 2.6 } };
    return { img: pngPixels(png(await tools.look({ region }))), region: box(region) };
  }

  /** Pixels in a box of plan metres tinted by look's magenta ink (red well over green; the ruler's blue grid isn't). */
  function inked(img: Image, region: Box, from: Point, to: Point): number {
    const a = toPixel(img, region, from);
    const b = toPixel(img, region, to);
    let n = 0;
    for (let py = Math.floor(Math.min(a.py, b.py)); py <= Math.ceil(Math.max(a.py, b.py)); py++) {
      for (let px = Math.floor(Math.min(a.px, b.px)); px <= Math.ceil(Math.max(a.px, b.px)); px++) {
        const [r, g] = pixel(img, px, py);
        if (r - g > 60) n++;
      }
    }
    return n;
  }

  it("look of the loft region rasterises the stair (pixels of the break line present)", async () => {
    const { img, region } = await stairLook();
    // Just outside the flight's side (y 1.65) only the break line reaches, about 0.06 either side of x 4.484.
    expect(inked(img, region, { x: 4.33, y: 1.6 }, { x: 4.63, y: 1.6 })).toBeGreaterThan(0);
    expect(inked(img, region, { x: 5.0, y: 1.6 }, { x: 5.5, y: 1.6 })).toBe(0);
  });

  it("draws the treads as lines, not a block of ink, and writes the UP label", async () => {
    const { img, region } = await stairLook();
    const tread = 5.59 - 1.99 / 9; // the first tread line, solid
    expect(inked(img, region, { x: tread - 0.01, y: 1.75 }, { x: tread + 0.01, y: 1.75 })).toBeGreaterThan(0);
    expect(inked(img, region, { x: tread + 0.08, y: 1.75 }, { x: tread + 0.14, y: 1.75 })).toBe(0); // between treads
    expect(inked(img, region, { x: 4.45, y: 1.455 }, { x: 4.75, y: 1.485 })).toBeGreaterThan(20);
  });
});
