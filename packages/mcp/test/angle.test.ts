import { afterEach, describe, expect, it } from "vitest";
import type { DrawingSummary } from "../src/drawing";
import type { EditorSession } from "../src/session";
import { createTools, type DrawingTools, type Reply } from "../src/tools";
import { TestServer } from "./harness";
import { KINKED_WALLS, kinkedPoint } from "./fixtures/kinked-house";

// Step 21 (straight.11): get_drawing lists `angle` (degrees off the nearest axis) for a wall up to a degree off, and
// leaves it out elsewhere, so an invisible slant is found (AC-16).

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});
function ok(r: Reply): string {
  expect(r.isError, r.text).toBe(false);
  return r.text;
}
const near = (a: [number, number] | undefined, p: { x: number; y: number }): boolean => a !== undefined && Math.abs(a[0] - p.x) < 1e-6 && Math.abs(a[1] - p.y) < 1e-6;

describe("get_drawing's angle", () => {
  it("lists 0.35 for the kinked house's slanted top piece and nothing for the others", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools: DrawingTools = createTools(claude);
    ok(await tools.createProject({ name: "Angles" }));
    ok(await tools.addWalls({ walls: KINKED_WALLS }));
    const s: DrawingSummary = JSON.parse(ok(await tools.getDrawing({})));
    const ends = (w: { from: [number, number]; to: [number, number] }, p: string, q: string): boolean =>
      (near(w.from, kinkedPoint(p)) && near(w.to, kinkedPoint(q))) || (near(w.from, kinkedPoint(q)) && near(w.to, kinkedPoint(p)));
    const slanted = s.walls.find((w) => ends(w, "372a", "c9b9"));
    expect(slanted?.angle).toBe(0.35);
    expect(s.walls.filter((w) => w.angle !== undefined)).toHaveLength(1);
  });

  it("straighten_wall puts the side on one line: no wall lists an angle after", async () => {
    const server = new TestServer();
    const claude = server.join("Claude").session;
    sessions.push(claude);
    const tools: DrawingTools = createTools(claude);
    ok(await tools.createProject({ name: "Straighten" }));
    ok(await tools.addWalls({ walls: KINKED_WALLS }));
    const before: DrawingSummary = JSON.parse(ok(await tools.getDrawing({})));
    const slanted = before.walls.find((w) => w.angle !== undefined);
    ok(await tools.straightenWall({ wall: slanted?.id ?? "" }));
    const after: DrawingSummary = JSON.parse(ok(await tools.getDrawing({})));
    expect(after.walls.filter((w) => w.angle !== undefined)).toEqual([]);
    expect((await tools.straightenWall({ wall: slanted?.id ?? "" })).isError).toBe(true); // already straight
  });
});
