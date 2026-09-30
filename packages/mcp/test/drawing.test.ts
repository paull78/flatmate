import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import { summarize } from "../src/drawing";

const project = { id: "p1", name: "Apartment", status: "saved" } as const;

function run(doc: Document, cmds: Command[]): Document {
  return cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

describe("summarize", () => {
  it("lists walls with joint ids, endpoints and lengths, and one room with its clear area", () => {
    const doc = run(emptyDocument(), rectangleRoom({ x: 0, y: 0 }, 4, 3, "r"));
    const s = summarize(project, doc);
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
    const s = summarize(project, withOrphan);
    expect(s.rooms[0]?.labels).toEqual([{ id: "L1", name: "Bathroom" }]);
    expect(s.unplacedLabels).toEqual([{ id: "L2", name: "Lost", at: [9, 9] }]);
  });

  it("rounds coordinates to millimetres and areas to hundredths", () => {
    const doc = run(emptyDocument(), [{ type: "addWall", opId: "w", from: { at: { x: 0.12345, y: 0 } }, to: { at: { x: 1, y: 0 } } }]);
    const s = summarize(project, doc);
    expect(s.walls[0]).toMatchObject({ from: [0.123, 0], length: 0.877 });
  });
});
