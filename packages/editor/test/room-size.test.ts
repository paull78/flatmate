import { describe, expect, it } from "vitest";
import { emptyDocument, execute, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomSizeText, tagLayout } from "../src/view/tags";
import { zoneOfLabel } from "../src/view/tags";
import { PRESENTATION_STYLE, pictureLayers, planPicture } from "../src/view/picture";
import { donutDoc, withCommands } from "./builders";
import { floorView } from "../src/view/plan-view";

// The room size line (spec Behaviour "Room labels", export.09; AC-02): "4.20 × 3.10 m" under the name for a room
// whose clear outline is a rectangle, the side closer to horizontal first.

function run(doc: Document, cmds: Command[]): Document {
  return cmds.reduce((d, c) => {
    const r = execute(d, c);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.doc;
  }, doc);
}

/** Walls through the points, closed, then a label at `at`. Walls 0.2 m thick (the default). */
function room(points: Point[], at: Point, name = "Kitchen"): Document {
  const walls = points.map((p, i): Command => ({ type: "addWall", opId: `w${i}`, from: { at: p }, to: { at: points[(i + 1) % points.length] ?? p } }));
  return run(emptyDocument(), [...walls, { type: "labelZone", id: "L1", at, name, finish: null }]);
}

const rotate = (p: Point, deg: number): Point => {
  const a = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};
/** Centre lines 4.40 × 3.30 m: a 4.20 × 3.10 m clear interior with 0.2 m walls. */
const RECT: Point[] = [{ x: 0, y: 0 }, { x: 4.4, y: 0 }, { x: 4.4, y: 3.3 }, { x: 0, y: 3.3 }];
const kitchen = (deg = 0): Document => room(RECT.map((p) => rotate(p, deg)), rotate({ x: 2.2, y: 1.65 }, deg));
const lines = (doc: Document, zoom = 80): string[] => tagLayout(doc, "L1", { zoom }, null)?.lines.map((l) => l.text) ?? [];

describe("roomSizeText (AC-02)", () => {
  it("a 4.20 × 3.10 m clear rectangle reads \"4.20 × 3.10 m\"", () => {
    expect(roomSizeText(zoneOfLabel(kitchen(), "L1"))).toBe("4.20 × 3.10 m");
  });

  it("the side closer to horizontal comes first", () => {
    expect(roomSizeText(zoneOfLabel(kitchen(30), "L1"))).toBe("4.20 × 3.10 m");
    expect(roomSizeText(zoneOfLabel(kitchen(60), "L1"))).toBe("3.10 × 4.20 m");
  });

  it("an L-shaped room has no size line", () => {
    const l = room([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }], { x: 1, y: 1 });
    expect(roomSizeText(zoneOfLabel(l, "L1"))).toBeNull();
  });

  it("a corner a little off square still counts; a clearly skewed one does not", () => {
    const almost = room([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4 + 3 * Math.tan((0.3 * Math.PI) / 180), y: 3 }, { x: 0, y: 3 }], { x: 2, y: 1.5 });
    expect(roomSizeText(zoneOfLabel(almost, "L1"))).not.toBeNull();
    const skewed = room([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4 + 3 * Math.tan((1 * Math.PI) / 180), y: 3 }, { x: 0, y: 3 }], { x: 2, y: 1.5 });
    expect(roomSizeText(zoneOfLabel(skewed, "L1"))).toBeNull();
  });

  it("a rectangular room with a hole has no size line; the core's own room keeps it", () => {
    const doc = withCommands(
      donutDoc(),
      { type: "labelZone", id: "L1", at: { x: 1.5, y: 4 }, name: "Living", finish: null },
      { type: "labelZone", id: "L2", at: { x: 5, y: 4 }, name: "Stairs", finish: null },
    );
    expect(roomSizeText(zoneOfLabel(doc, "L1"))).toBeNull();
    expect(roomSizeText(zoneOfLabel(doc, "L2"))).toBe("2.80 × 2.80 m");
  });

  it("a room whose only holes are free columns keeps its size line (pillars.34); a column beside a wall group's hole doesn't", () => {
    const pillar: Command = { type: "placeColumn", opId: "c", at: { x: 1, y: 1 }, width: 0.3, depth: 0.3 };
    const withPillar = withCommands(kitchen(), pillar);
    expect(zoneOfLabel(withPillar, "L1")?.holes).toHaveLength(1);
    expect(roomSizeText(zoneOfLabel(withPillar, "L1"))).toBe("4.20 × 3.10 m");
    expect(lines(withPillar)).toEqual(["Kitchen", "4.20 × 3.10 m", "12.93 m²"]);
    const donut = withCommands(donutDoc(), { type: "labelZone", id: "L1", at: { x: 1.5, y: 4 }, name: "Living", finish: null }, { ...pillar, at: { x: 1.5, y: 2 } });
    expect(roomSizeText(zoneOfLabel(donut, "L1"))).toBeNull();
  });

  it("an orphan label has no size line", () => {
    expect(roomSizeText(null)).toBeNull();
  });
});

describe("the tag's lines (AC-02)", () => {
  it("name, size, area for a rectangular room", () => {
    expect(lines(kitchen())).toEqual(["Kitchen", "4.20 × 3.10 m", "13.02 m²"]);
  });

  it("name and area for any other shape", () => {
    const l = room([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }], { x: 1, y: 1 });
    expect(lines(l)).toHaveLength(2);
  });

  it("the size line drops first, then the area, keeping the name (export.34)", () => {
    // A long, low room: 6.00 × 0.90 m clear. Each line is 16 px, so the height decides: three lines and the pad are
    // 52 px (0.65 m at 80, 1.04 m at 50), two 36 px (0.72 m at 50, 1.2 m at 30), the name 20 px; every width is under 6 m.
    const corridor = room([{ x: 0, y: 0 }, { x: 6.2, y: 0 }, { x: 6.2, y: 1.1 }, { x: 0, y: 1.1 }], { x: 3.1, y: 0.55 }, "Hall");
    expect(lines(corridor, 80)).toEqual(["Hall", "6.00 × 0.90 m", "5.40 m²"]);
    expect(lines(corridor, 50)).toEqual(["Hall", "5.40 m²"]);
    expect(lines(corridor, 30)).toEqual(["Hall"]);
  });

  it("the exported picture shows the same three lines", () => {
    const texts = pictureLayers(planPicture(kitchen(), floorView(kitchen(), null), PRESENTATION_STYLE, 20, true)).flatMap((p) => (p.kind === "text" ? [p.text] : []));
    expect(texts).toEqual(["Kitchen", "4.20 × 3.10 m", "13.02 m²"]);
  });
});
