import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type Reply } from "../src/tools";
import { TestServer, withListings } from "./harness";

// Wheel wells over MCP (trailer.07, .11; AC-06): place_object takes the kind, at its centre, half over a wall;
// get_drawing lists it in every layout.

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});
type Placed = DrawingSummary & { result: { object?: string } };
const parsed = (r: Reply): Placed => {
  expect(r.isError, r.text).toBe(false);
  return JSON.parse(r.text);
};

describe("a wheel well through place_object", () => {
  it("a Single well half over the long wall is accepted, stands in both layouts, and the default bench over it fits", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools = withListings(createTools(claude));
    parsed(await tools.createProject({ name: "Tiny" }));
    parsed(await tools.drawRoom({ corner: { x: 0, y: 0 }, width: 7, depth: 2.5 }));
    parsed(await tools.addLayout({ name: "Night" }));
    // Centre y 0.15: the well runs from y −0.05 to 0.35, its outer 0.15 m under the lower wall (inner face y 0.1).
    const placed = parsed(await tools.placeObject({ layout: "s0", kind: "wheelWell", preset: "Single", centre: { x: 3, y: 0.15 } }));
    const id = placed.result.object ?? "";
    const well = placed.objects.find((o) => o.id === id);
    expect(well?.kind).toBe("wheelWell");
    expect(Object.values(well?.placements ?? {}).filter((p) => p !== null)).toHaveLength(2);
    // The default 1.20 × 0.45 × 0.45 bench against the wall (y 0.1 to 0.55) encloses the Single well's 0.90 m part outside it.
    const bench = await tools.placeObject({ layout: "s0", kind: "bench", centre: { x: 3, y: 0.325 } });
    expect(bench.isError, bench.text).toBe(false);

  });
});
