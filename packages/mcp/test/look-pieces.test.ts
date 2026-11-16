import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { LOOK_LONG_SIDE } from "@fm/editor";
import type { Region } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type LookReply, type Reply } from "../src/tools";
import { TestServer } from "./harness";
import { pngPixels } from "./pictures";

// The plan look draws one layout's pieces (mcp step 10, AC-06, AC-07, mcp.03): the first layout's by default, the
// named one's when given; a drawing with no pieces looks as it did before.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

/** The picture of a pieces-free 6 × 4 room with a door, taken before this step (sha256 of its pixels). */
const ROOM_BEFORE = "bb68642c649c0cfd50c7ebab5feba0708e56ae01d139f0fa30833c5800513d97";

const REGION: Region = { min: { x: -0.5, y: -0.5 }, max: { x: 6.5, y: 4.5 } };
const DAY_SPOT = { x: 1.6, y: 1.6 };
const NIGHT_SPOT = { x: 4.4, y: 2.4 };

function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
function png(r: LookReply): Uint8Array {
  if (!("png" in r)) throw new Error(r.text);
  return r.png;
}

/** How many pixels in a 0.6 m square around `p` are darker than the paper: ink there. */
function inkAround(picture: Uint8Array, p: { x: number; y: number }): number {
  const { width, pixels } = pngPixels(picture);
  const zoom = LOOK_LONG_SIDE / Math.max(REGION.max.x - REGION.min.x, REGION.max.y - REGION.min.y);
  let n = 0;
  for (let y = p.y - 0.3; y <= p.y + 0.3; y += 1 / zoom) {
    for (let x = p.x - 0.3; x <= p.x + 0.3; x += 1 / zoom) {
      const px = Math.floor((x - REGION.min.x) * zoom);
      const py = Math.floor((REGION.max.y - y) * zoom);
      const i = (py * width + px) * 4;
      if ((pixels[i] ?? 255) + (pixels[i + 1] ?? 255) + (pixels[i + 2] ?? 255) < 3 * 230) n += 1;
    }
  }
  return n;
}

const pixelHash = (picture: Uint8Array): string => createHash("sha256").update(pngPixels(picture).pixels).digest("hex");

async function room(): Promise<{ tools: DrawingTools; day: string; night: string }> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  ok(await tools.createProject({ name: "Look" }));
  ok(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 6, depth: 4 }));
  const wall = JSON.parse(ok(await tools.getDrawing({}))).walls[0].id;
  ok(await tools.addDoor({ wall, offset: 2 }));
  const night = JSON.parse(ok(await tools.addLayout({ name: "Night" }))).result.layout.id;
  const day = JSON.parse(ok(await tools.getDrawing({}))).layouts[0].id;
  return { tools, day, night };
}

/** The room with a bed that is an exception: at DAY_SPOT in Day, at NIGHT_SPOT in Night. */
async function bedApart(): Promise<{ tools: DrawingTools; day: string; night: string }> {
  const r = await room();
  const bed = JSON.parse(ok(await r.tools.placeObject({ layout: r.day, kind: "bed", preset: "Small single", centre: DAY_SPOT }))).result.object;
  ok(await r.tools.moveObject({ layout: r.night, object: bed, centre: NIGHT_SPOT, everyLayout: false }));
  return r;
}

describe("the plan look draws a layout's pieces (AC-06, AC-07)", () => {
  it("a drawing with no pieces gives the same picture as before", async () => {
    const { tools } = await room();
    expect(pixelHash(png(await tools.look({ region: REGION })))).toBe(ROOM_BEFORE);
  });

  it("with no layout named, the first layout's bed is drawn at its spot, and nothing where Night has it", async () => {
    const { tools } = await bedApart();
    const empty = await room();
    const bare = png(await empty.tools.look({ region: REGION }));
    const picture = png(await tools.look({ region: REGION }));
    expect(inkAround(picture, DAY_SPOT)).toBeGreaterThan(inkAround(bare, DAY_SPOT) + 50);
    expect(inkAround(picture, NIGHT_SPOT)).toBe(inkAround(bare, NIGHT_SPOT));
  });

  it("with Night named, the bed is drawn at Night's spot, not Day's", async () => {
    const { tools, night } = await bedApart();
    const empty = await room();
    const bare = png(await empty.tools.look({ region: REGION }));
    const picture = png(await tools.look({ region: REGION, layout: night }));
    expect(inkAround(picture, NIGHT_SPOT)).toBeGreaterThan(inkAround(bare, NIGHT_SPOT) + 50);
    expect(inkAround(picture, DAY_SPOT)).toBe(inkAround(bare, DAY_SPOT));
  });

  it("the caption names the layout drawn", async () => {
    const { tools, night } = await bedApart();
    expect((await tools.look({ region: REGION })).text).toContain("layout Layout");
    expect((await tools.look({ region: REGION, layout: night })).text).toContain("layout Night");
  });

  it("an unknown layout is refused", async () => {
    const { tools } = await bedApart();
    expect(await tools.look({ layout: "nope" })).toEqual({ text: "No layout has the id nope", isError: true });
  });
});
