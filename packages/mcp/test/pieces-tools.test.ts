import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";

// The pieces for small homes for Claude (spec pieces, AC-01, AC-09): place_object places every new kind by its id and
// get_drawing lists it; a stool tucks under a bar table and is refused under a counter. A 7 × 5 room.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

type Edited = DrawingSummary & { result: { object?: string } };
function summary(r: Reply): Edited {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
}

async function room(): Promise<DrawingTools> {
  const server = new TestServer();
  const claude = server.join("Claude").session;
  sessions.push(claude);
  const tools = createTools(claude);
  summary(await tools.createProject({ name: "Pieces" }));
  summary(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 5 }));
  return tools;
}

const PLACES: readonly [kind: string, x: number, y: number][] = [
  ["range", 1, 4.6], ["cookerHood", 1, 4.65], ["tallPantry", 2.2, 4.6], ["electricFireplace", 3.5, 4.8], ["wallUnit", 4.6, 4.8],
  ["woodStove", 6, 4.4], ["bench", 1.5, 0.4], ["storageChest", 3.5, 0.4], ["barTable", 3.5, 2.5],
];

describe("the pieces for small homes for Claude", () => {
  it("place_object places every new kind by its id, and get_drawing lists each by kind and label (AC-01)", async () => {
    const tools = await room();
    const ids: [string, string][] = [];
    for (const [kind, x, y] of PLACES) ids.push([kind, summary(await tools.placeObject({ layout: "s0", kind, centre: { x, y } })).result.object ?? ""]);
    const drawing = summary(await tools.getDrawing());
    for (const [kind, id] of ids) expect(drawing.objects.find((o) => o.id === id), kind).toMatchObject({ kind });
  });

  it("a stool tucks under a bar table, and is refused under a counter, which is solid to the floor (AC-09)", async () => {
    const tools = await room();
    summary(await tools.placeObject({ layout: "s0", kind: "barTable", centre: { x: 3.5, y: 2.5 } }));
    summary(await tools.placeObject({ layout: "s0", kind: "stool", centre: { x: 3.1, y: 2.45 } }));
    summary(await tools.placeObject({ layout: "s0", kind: "counter", centre: { x: 5.5, y: 1 } }));
    const refused = await tools.placeObject({ layout: "s0", kind: "stool", centre: { x: 5.5, y: 1 } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Counter");
  });
});
