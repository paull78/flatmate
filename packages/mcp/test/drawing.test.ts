import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import { MAX_LISTED_WALLS, summarize, type DrawingOverview, type DrawingSummary } from "../src/drawing";

const project = { id: "p1", name: "Apartment", status: "saved" } as const;

function listing(s: DrawingSummary | DrawingOverview): DrawingSummary {
  if (!("walls" in s)) throw new Error(`expected a listing, got an overview: ${s.hint}`);
  return s;
}

function overview(s: DrawingSummary | DrawingOverview): DrawingOverview {
  if ("walls" in s) throw new Error(`expected an overview, got ${s.walls.length} walls`);
  return s;
}

/** An n × n grid of 1 m rooms, one label per room: 2n(n + 1) walls. */
function grid(n: number): Document {
  const doc: Document = { joints: {}, walls: {}, zoneLabels: {} };
  const j = (x: number, y: number): string => `j${x}_${y}`;
  for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) doc.joints[j(x, y)] = { id: j(x, y), x, y };
  for (let x = 0; x <= n; x++) {
    for (let y = 0; y <= n; y++) {
      if (x < n) doc.walls[`h${x}_${y}`] = { id: `h${x}_${y}`, a: j(x, y), b: j(x + 1, y) };
      if (y < n) doc.walls[`v${x}_${y}`] = { id: `v${x}_${y}`, a: j(x, y), b: j(x, y + 1) };
      if (x < n && y < n) doc.zoneLabels[`l${x}_${y}`] = { id: `l${x}_${y}`, at: { x: x + 0.5, y: y + 0.5 }, name: "Room" };
    }
  }
  return doc;
}

function run(doc: Document, cmds: Command[]): Document {
  return cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

describe("summarize", () => {
  it("lists walls with joint ids, endpoints and lengths, and one room with its clear area", () => {
    const doc = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const s = listing(summarize(project, doc));
    expect(s.project).toEqual(project);
    expect(s.units).toBe("m");
    expect(s.walls.map((w) => [w.id, w.from, w.to, w.length])).toEqual([
      ["r-1/w0", [0, 0], [4, 0], 4],
      ["r-2/w0", [4, 0], [4, 3], 3],
      ["r-3/w0", [4, 3], [0, 3], 4],
      ["r-4/w0", [0, 3], [0, 0], 3],
    ]);
    expect(s.joints).toHaveLength(4);
    expect(s.rooms).toHaveLength(1);
    expect(s.rooms[0]).toMatchObject({ labels: [], area: 10.64 }); // (4 − 0.2) × (3 − 0.2)
    expect(s.rooms[0]?.outline).toHaveLength(4);
    expect(s.unplacedLabels).toEqual([]);
  });

  it("names rooms by their labels and lists labels outside every room", () => {
    const room = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const doc = run(room, [{ type: "labelZone", id: "L1", at: { x: 2, y: 1.5 }, name: "Bathroom" }]);
    const withOrphan: Document = { ...doc, zoneLabels: { ...doc.zoneLabels, L2: { id: "L2", at: { x: 9, y: 9 }, name: "Lost" } } };
    const s = listing(summarize(project, withOrphan));
    expect(s.rooms[0]?.labels).toEqual([{ id: "L1", name: "Bathroom" }]);
    expect(s.unplacedLabels).toEqual([{ id: "L2", name: "Lost", at: [9, 9] }]);
  });

  it("rounds coordinates to millimetres and areas to hundredths", () => {
    const doc = run(emptyDocument(), [{ type: "addWall", opId: "w", from: { at: { x: 0.12345, y: 0 } }, to: { at: { x: 1, y: 0 } } }]);
    const s = listing(summarize(project, doc));
    expect(s.walls[0]).toMatchObject({ from: [0.123, 0], length: 0.877 });
  });
});

describe("large drawings (spec §12.4)", () => {
  it("lists a drawing of up to 300 walls in full, with the counts", () => {
    const doc = grid(11); // 264 walls
    const s = listing(summarize(project, doc));
    expect(s.walls).toHaveLength(264);
    expect(s.counts).toEqual({ walls: 264, joints: 144, rooms: 121, labels: 121, unplacedLabels: 0 });
  });

  it("summarizes a larger drawing: counts, bounds and a hint, no lists, a small reply", () => {
    const doc = grid(12); // 312 walls
    const s = overview(summarize(project, doc));
    expect(MAX_LISTED_WALLS).toBe(300);
    expect(s.project).toEqual(project);
    expect(s.counts).toEqual({ walls: 312, joints: 169, rooms: 144, labels: 144, unplacedLabels: 0 });
    expect(s.bounds).toEqual({ min: [0, 0], max: [12, 12] });
    expect(s.hint).toContain("region");
    expect(JSON.stringify(overview(summarize(project, grid(50)))).length).toBeLessThan(2_000);
  });

  it("lists only what touches a region, with the whole drawing's counts", () => {
    const doc = grid(12);
    const s = listing(summarize(project, doc, { min: { x: 2.5, y: 2.5 }, max: { x: 3.5, y: 3.5 } }));
    // The box covers joint (3, 3) and parts of the four rooms around it.
    expect(s.joints.map((j) => j.id)).toEqual(["j3_3"]);
    expect(s.walls.map((w) => w.id).sort()).toEqual(["h2_3", "h3_3", "v3_2", "v3_3"]);
    expect(s.rooms).toHaveLength(4);
    expect(s.counts.walls).toBe(312);
    const edge = listing(summarize(project, doc, { min: { x: 12, y: 0 }, max: { x: 13, y: 0 } })); // touches one corner
    expect(edge.joints.map((j) => j.id)).toEqual(["j12_0"]);
    expect(edge.walls.map((w) => w.id).sort()).toEqual(["h11_0", "v12_0"]);
  });

  it("lists unplaced labels inside the region only", () => {
    const doc: Document = { ...grid(12), zoneLabels: { far: { id: "far", at: { x: 50, y: 50 }, name: "Lost" }, near: { id: "near", at: { x: -1, y: -1 }, name: "Out" } } };
    const s = listing(summarize(project, doc, { min: { x: 40, y: 40 }, max: { x: 60, y: 60 } }));
    expect(s.unplacedLabels).toEqual([{ id: "far", name: "Lost", at: [50, 50] }]);
    expect(s.walls).toEqual([]);
  });

  it("summarizes a region holding more than 300 walls, asking to narrow it", () => {
    const s = overview(summarize(project, grid(20), { min: { x: 0, y: 0 }, max: { x: 15, y: 15 } }));
    expect(s.hint).toContain("narrow");
  });
});
