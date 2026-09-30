import { describe, expect, it } from "vitest";
import { emptyDocument, execute, rectangleRoom, validateDocument, zones } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { buildRoom, describeRooms } from "../src/rooms";

describe("build-room script (spec §2.3, demo step 9b)", () => {
  it("builds a valid 4 × 5 m room split by a divider", () => {
    const doc = buildRoom();
    expect(validateDocument(doc).ok).toBe(true);
    expect(Object.keys(doc.walls)).toHaveLength(7); // 4 outer walls, the divider, 2 split fragments
    expect(Object.keys(doc.joints)).toHaveLength(6); // 4 corners, 2 T-junctions
    expect(zones(doc)).toHaveLength(2);
  });

  it("prints each labelled room with its clear area (0.20 m walls)", () => {
    expect(describeRooms(buildRoom())).toEqual([
      { room: "Kitchen", area: "8.64 m²" },
      { room: "Living", area: "8.64 m²" },
    ]);
  });

  it("describes an undivided, unlabelled room", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    expect(describeRooms(doc)).toEqual([{ room: "(unlabelled)", area: "18.24 m²" }]);
  });
});
