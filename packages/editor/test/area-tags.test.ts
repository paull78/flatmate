import { describe, expect, it } from "vitest";
import { convexOverlap, execute, fitShapes, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { DEFAULT_ZOOM, type Camera } from "../src/camera";
import { areaTagLayout } from "../src/view/area-tags";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { formatArea, tagLayout } from "../src/view/tags";
import { roomDoc } from "./builders";

// An area's tag (areas step 03, areas.02, .03): like a room's, its name over its m², kept inside its rectangle, off
// furniture and its room's tag by the room tags' free-spot rule (tidy.13).

const camera: Camera = { center: { x: 3, y: 2 }, zoom: DEFAULT_ZOOM, viewport: { width: 1200, height: 800 }, dpr: 1 };
const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const area = (x: number, y: number, w: number, d: number, name = "Kitchen"): Command => ({ type: "addArea", opId: "k", at: { x, y }, w, d, name });
const ID = "k/a0";
const texts = (doc: Document, layout: string | null = null): string[] => areaTagLayout(doc, ID, camera, layout)?.lines.map((l) => l.text) ?? [];
type Box = { min: Point; max: Point };
const ring = ({ min, max }: Box): Point[] => [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];
const inside = (b: Box, x0: number, y0: number, x1: number, y1: number): boolean => b.min.x >= x0 - 1e-9 && b.max.x <= x1 + 1e-9 && b.min.y >= y0 - 1e-9 && b.max.y <= y1 + 1e-9;
/** Moves the room's right wall (its two joints at x = 6) to x. */
function rightWallTo(doc: Document, x: number): Command {
  const moves = Object.values(doc.joints).filter((j) => Math.abs(j.x - 6) < 1e-9).map((j) => ({ jointId: j.id, to: { x, y: j.y } }));
  return { type: "moveJoints", moves };
}

describe("an area's tag", () => {
  it("reads its name over its m², the m² in the muted role", () => {
    const tag = areaTagLayout(run(roomDoc(), area(2, 2, 2, 2)), ID, camera, null);
    expect(tag?.lines.map((l) => [l.text, l.role])).toEqual([["Kitchen", "name"], [formatArea(4), "area"]]);
  });

  it("shows the m² a wall cut leaves (AC-04)", () => {
    const doc = run(roomDoc(), area(4.4, 2, 3, 2));
    expect(texts(run(doc, rightWallTo(doc, 5.4)))).toEqual(["Kitchen", formatArea(4.8)]);
  });

  it("reads no enclosing walls once its centre is outside every room", () => {
    const doc = run(roomDoc(), area(4.4, 2, 3, 2));
    expect(texts(run(doc, rightWallTo(doc, 4)))).toEqual(["Kitchen", "no enclosing walls"]);
  });

  it("a blank name reads Area", () => {
    const doc = run(roomDoc(), area(2, 2, 2, 2), { type: "setArea", areaId: ID, name: "" });
    expect(texts(doc)[0]).toBe("Area");
  });

  it("moves off a sofa and stays inside its rectangle (AC-03)", () => {
    const doc = run(roomDoc(), area(3, 2, 3, 2.4), { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 3, y: 2 }, deck: null });
    const tag = areaTagLayout(doc, ID, camera, "s0");
    expect(tag).not.toBeNull();
    if (!tag) return;
    expect(inside(tag, 1.5, 0.8, 4.5, 3.2)).toBe(true);
    const sofa = fitShapes(doc).get("sofa/p0") ?? [];
    expect(convexOverlap(ring(tag), sofa)).toBe(false);
    expect(tag.lines[0].at).not.toEqual({ x: 3, y: 2 + CANVAS_STYLE.tag.line / 2 / DEFAULT_ZOOM });
  });

  it("stays at its centre when no spot inside it is free", () => {
    const doc = run(roomDoc(), area(3, 2, 1, 1), { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 3, y: 2 }, deck: null });
    const tag = areaTagLayout(doc, ID, camera, "s0");
    expect(tag && (tag.min.x + tag.max.x) / 2).toBeCloseTo(3, 9);
    expect(tag && (tag.min.y + tag.max.y) / 2).toBeCloseTo(2, 9);
  });

  it("keeps clear of its room's tag, which stays where it was", () => {
    const labelled = run(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Great room", finish: null });
    const doc = run(labelled, area(3, 2, 3, 2.4));
    const room = tagLayout(doc, "L1", camera, null);
    const tag = areaTagLayout(doc, ID, camera, null);
    expect(room).toEqual(tagLayout(labelled, "L1", camera, null));
    expect(room && tag && convexOverlap(ring(room), ring(tag))).toBe(false);
    expect(tag && inside(tag, 1.5, 0.8, 4.5, 3.2)).toBe(true);
  });

  it("drops its m² line when only one line fits, and hides when not even its name does", () => {
    expect(texts(run(roomDoc(), area(3, 2, 1, 0.4)))).toEqual(["Kitchen"]);
    expect(areaTagLayout(run(roomDoc(), area(3, 2, 0.4, 0.4)), ID, camera, null)).toBeNull();
  });
});
