import { describe, expect, it } from "vitest";
import { emptyDocument, levelOf, type Document } from "@fm/domain";
import { fitScale, planFits, scaleFits } from "../src/export/fit";
import { drawingArea, orientationFor } from "../src/export/paper";
import { sheetFitScale, sheetPages } from "../src/export/sheet";
import { PRESENTATION_STYLE, drawnBounds, pictureLayers, planPicture, type Bounds } from "../src/view/picture";
import { floorView } from "../src/view/plan-view";
import { clearRoomDoc, loftRoomDoc, roomDoc, wallBetween, wallDoc, withCommands, withOrphan } from "./builders";
import { FakeHost } from "./fake-shell";

// What fits a frame (sheetset.10, .17; AC-04, AC-06): what's drawn, measured on paper with a 5 mm inset, at its framing.

const LOFT = "loft/k0"; // loftRoomDoc's deck
const A3 = drawingArea("A3", "landscape"); // 325 × 277 mm
const centred = { x: 0, y: 0 };
const box = (w: number, h: number): Bounds => ({ min: { x: -w / 2, y: -h / 2 }, max: { x: w / 2, y: h / 2 } });

/** roomDoc with a 0.9 m swing door on the bottom wall, opening out of the room. */
function outwardDoor(doc: Document = roomDoc()): Document {
  return withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2, width: 0.9, side: "right" });
}

describe("what fits a frame", () => {
  it("a 7.2 m plan fits at 1:25 on A3's frame", () => {
    expect(planFits({ drawn: box(7.2, 4), scale: 25, frameMm: A3, framing: centred })).toBe(true); // 288 mm + 10 on 325; the old 0.5 m margin made it 328
    expect(sheetFitScale(clearRoomDoc(6.8, 4, "r"), "A3")).toBe(25); // the mockup's case: outer walls 7.2 m
  });

  it("not at 1:20", () => {
    expect(planFits({ drawn: box(7.2, 4), scale: 20, frameMm: A3, framing: centred })).toBe(false); // 360 mm on 325
  });

  it("the margin is on paper", () => {
    const frameMm = { w: 200, h: 200 };
    const fits = (metres: number, scale: number): boolean => planFits({ drawn: box(metres, 1), scale, frameMm, framing: centred });
    expect([fits(4.75, 25), fits(4.8, 25)]).toEqual([true, false]); // 190 mm and 192 mm: 5 mm each side, 190 mm left
    expect([fits(19, 100), fits(19.2, 100)]).toEqual([true, false]); // the same 190 mm at 1:100
  });

  it("framing counts", () => {
    const fits = (x: number, y = 0): boolean => planFits({ drawn: box(4, 2), scale: 25, frameMm: { w: 200, h: 100 }, framing: { x, y } }); // 160 × 80 mm: 15 mm spare each way across, 5 up and down
    expect(fits(0)).toBe(true);
    expect(fits(5)).toBe(false); // past the frame
    expect(fits(0.3)).toBe(true); // 12 mm: within what's spare
    expect(fits(-0.3)).toBe(true);
    expect(fits(0.4)).toBe(false); // 16 mm: into the inset
    expect(fits(-0.4)).toBe(false);
    expect(fits(0, 0.1)).toBe(true); // 4 mm
    expect(fits(0, -0.15)).toBe(false); // 6 mm
  });

  it("Fit picks the largest scale that fits, including 1:75", () => {
    expect(fitScale({ w: 12, h: 6 }, "A4")).toBe(75); // 240 mm at 1:50 on A4's 217, 160 mm at 1:75
  });

  it("the best orientation counts the inset too", () => {
    // 121 × 179 mm at 1:100. Without the inset portrait has more room; with it, only landscape holds the plan.
    const plan = { w: 12.1, h: 17.908 };
    expect(orientationFor(plan, "A4")).toBe("landscape");
    expect(scaleFits(plan, "A4", 100)).toBe(true);
  });

  it("an empty drawing fits", () => {
    expect(drawnBounds(emptyDocument(), null)).toBeNull();
    expect(planFits({ drawn: null, scale: 20, frameMm: { w: 1, h: 1 }, framing: { x: 99, y: 99 } })).toBe(true);
    expect(sheetFitScale(emptyDocument(), "A4")).toBe(20);
  });
});

describe("what counts as drawn", () => {
  it("the walls' outlines, with no margin", () => {
    expect(drawnBounds(roomDoc(), "s0")).toEqual({ min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 } });
  });

  it("labels and dimensions count as drawn", () => {
    const labelled = drawnBounds(withOrphan(roomDoc(), "L9", { x: 8, y: 6 }), "s0");
    expect(labelled?.max).toEqual({ x: 8, y: 6 });
    // The line sits 1 m off the measured points, here below the room.
    const measured = drawnBounds(withCommands(roomDoc(), { type: "addDimension", opId: "m", a: { x: 1, y: 0 }, b: { x: 3, y: 0 }, offset: -1 }), "s0");
    expect(measured?.min.y).toBeCloseTo(-1, 6);
  });

  it("an outward door swing counts", () => {
    const doc = outwardDoor();
    expect(drawnBounds(doc, "s0")?.min.y).toBeCloseTo(-0.92, 6); // the face at −0.1, plus 0.82: 0.9 less two rebates
    expect(drawnBounds(doc, "s0")?.max).toEqual({ x: 6.1, y: 4.1 });
  });

  it("an inward swing grows nothing", () => {
    const doc = roomDoc();
    const inward = withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2, width: 0.9, side: "left" });
    expect(drawnBounds(inward, "s0")).toEqual(drawnBounds(doc, "s0"));
  });

  it("a swing on a slanted wall measures the arc as it's drawn", () => {
    // The arc's lowest point (−0.36) lies between its ends, and a square round the
    // swing would reach −0.8 at a corner nothing draws.
    const doc = wallDoc({ x: 0, y: 0 }, { x: 4, y: 3 });
    const door = withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 4, y: 3 }), kind: "swing", offset: 0, width: 0.9, side: "right", hinge: "b" });
    const arc = pictureLayers(planPicture(door, floorView(door, "s0"), PRESENTATION_STYLE, 10, true)).find((p) => p.kind === "arc"); // 1:100: no frames shorten it
    if (arc?.kind !== "arc") throw new Error("no arc");
    const lowest = Math.min(...Array.from({ length: 2001 }, (_, i) => arc.center.y + arc.radius * Math.sin(arc.from + ((arc.to - arc.from) * i) / 2000)));
    expect(lowest).toBeCloseTo(-0.384, 3);
    expect(drawnBounds(door, "s0")?.min.y).toBeCloseTo(lowest, 5);
  });

  it("a loft level doesn't count the floor's labels", () => {
    const doc = withOrphan(loftRoomDoc(), "L9", { x: 8, y: 6 });
    expect(drawnBounds(doc, "s0")?.max).toEqual({ x: 8, y: 6 });
    expect(drawnBounds(doc, "s0", levelOf(doc, LOFT))?.max).toEqual({ x: 6.1, y: 4.1 });
  });

  it("a loft level doesn't count the floor's dimensions or door swings", () => {
    const doc = withCommands(outwardDoor(loftRoomDoc()), { type: "addDimension", opId: "m", a: { x: 1, y: 4 }, b: { x: 3, y: 4 }, offset: 2 });
    const floor = drawnBounds(doc, "s0");
    expect(floor?.min.y).toBeCloseTo(-0.92, 6);
    expect(floor?.max.y).toBeCloseTo(6, 6);
    expect(drawnBounds(doc, "s0", levelOf(doc, LOFT))).toEqual({ min: { x: -0.1, y: -0.1 }, max: { x: 6.1, y: 4.1 } });
  });

  it("a level counts only the pieces it shows, in its layout", () => {
    // Without walls a piece alone sets the bounds: a real piece always lies inside them.
    const furnished = withCommands(loftRoomDoc(), { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "block" }, at: { x: 4, y: 2 } });
    const doc: Document = { ...furnished, walls: {} };
    expect(drawnBounds(doc, "s0")).not.toBeNull();
    expect(drawnBounds(doc, "no-such-layout")).toBeNull();
    expect(drawnBounds(doc, "s0", levelOf(doc, LOFT))).toBeNull();
  });
});

describe("the PDF's Fit reads the new test", () => {
  it("a sheet centres on what's drawn, swing included, so what fits stays in the frame", () => {
    const sheet = sheetPages(outwardDoor(), { projectName: "P", paper: "A4", scale: 50, host: new FakeHost(), finishes: false });
    const area = drawingArea("A4", sheet?.orientation ?? "landscape");
    const arc = sheet?.pages[0]?.primitives.find((p) => p.kind === "arc");
    if (arc?.kind !== "arc") throw new Error("no arc");
    // Drawn y runs −0.92 to 4.1, so its middle is 1.59; the hinge is on the face at y −0.1, 33.8 mm below that at 1:50.
    expect(arc.center.y).toBeCloseTo(area.y + area.h / 2 - 33.8, 6);
  });
});
