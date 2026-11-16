import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { dragTry } from "../src/tools/drag";
import { tryCommand, zeroMoveDependencies } from "../src/tools/drag-commit";
import { wallsTarget } from "../src/tools/run-drag";
import { guideTargets, refusedOverlay } from "../src/view/refused-overlay";
import type { DragTarget, MoveAttempt } from "../src/tools/types";
import { jointAt, localState, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeHost } from "./fake-shell";

// Every drag target is defined in tools/drag.ts (arch-review R-07): each kind tries something, commits a command,
// has its dependencies before the first attempt, draws a refused attempt (at least the cursor disc), and names the
// pieces whose alignment guides it shows (AC-13: furniture moves only, not a resize or a turn).
const room = roomDoc();
const bottom = wallBetween(room, { x: 0, y: 0 }, { x: 6, y: 0 });
const doc: Document = withCommands(
  room,
  { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2.25 }, rotation: 0 },
  { type: "addOpening", opId: "d", wall: bottom, kind: "window", offset: 4 },
  { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 4.5, y: 2.25 }, rotation: 0 },
  { type: "addDimension", opId: "m", a: { x: 1, y: 1 }, b: { x: 4, y: 1 }, offset: 0.5 },
  { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 1.5, y: 3.9 } }, // x 0.9–2.1, y 3.3–3.9, front zone y 2.7–3.3
  { type: "addSection", a: { x: 1, y: 0.5 }, b: { x: 5, y: 0.5 }, side: 1, depth: 1 },
);
const TARGETS: [string, DragTarget, { x: number; y: number }, string, string[]][] = [
  ["joint", { kind: "joint", jointId: jointAt(doc, { x: 6, y: 4 }) }, { x: 6, y: 4 }, "connectJoint", []],
  ["walls", wallsTarget(doc, bottom), { x: 1, y: 0 }, "moveWalls", []],
  ["placement", { kind: "placement", placementId: "b/p0" }, { x: 3, y: 2 }, "movePlacement", ["b/p0"]],
  ["opening", { kind: "opening", openingId: "d/d0" }, { x: 4.5, y: 0 }, "moveOpening", []],
  ["placements", { kind: "placements", placementIds: ["b/p0", "c/p0"] }, { x: 3, y: 2 }, "movePlacements", ["b/p0", "c/p0"]],
  ["resize", { kind: "resize", placementId: "b/p0", side: "right" }, { x: 3.225, y: 2.025 }, "resizePlacement", []],
  ["rotate", { kind: "rotate", placementId: "b/p0" }, { x: 3, y: 1.6 }, "movePlacement", []], // about 86° from the centre (3, 2.025): 90, no wall near
  ["dimension", { kind: "dimension", dimensionId: "m/m0" }, { x: 2, y: 1.5 }, "setDimensionOffset", []],
  ["zoneDepth", { kind: "zoneDepth", placementId: "w/p0", side: "front" }, { x: 1.5, y: 2.7 }, "setZoneExtent", []], // tries depth 0.2
  ["zoneEnd", { kind: "zoneEnd", placementId: "w/p0", side: "front", end: "start" }, { x: 0.9, y: 2.7 }, "setZoneExtent", []], // tries start 0.4
  ["sectionEnd", { kind: "sectionEnd", sectionId: "A", end: "b" }, { x: 5, y: 0.5 }, "setSection", []],
  ["sectionFar", { kind: "sectionFar", sectionId: "A" }, { x: 3, y: 1.5 }, "setSection", []],
];

describe("drag targets", () => {
  const state = localState(new FakeHost(), doc);

  it.each(TARGETS)("%s: tries a move, commits a command, has dependencies, draws a refusal, shows guides", (_name, target, press, command, guided) => {
    const { tried } = dragTry(state, doc, target, press, { x: press.x + 0.4, y: press.y + 0.4 }, 0);
    expect(tried.kind).not.toBe("none");
    expect(tryCommand(target, tried)?.type).toBe(command);
    expect(zeroMoveDependencies(doc, target).length).toBeGreaterThan(0);
    const attempt: MoveAttempt = { ok: false, doc, cursor: press, tried, blocked: [], dependencies: [], guides: [] };
    expect(refusedOverlay(doc, target, attempt, "s0")[0]).toMatchObject({ kind: "disc", center: press });
    expect(guideTargets(target)).toEqual(guided);
  });

  it("the section targets' zero move depends on its row alone, and changes nothing", () => {
    for (const target of TARGETS.flatMap(([name, t]) => (name.startsWith("section") ? [t] : []))) expect(zeroMoveDependencies(doc, target)).toEqual([{ table: "sections", id: "A" }]);
  });

  it("the section targets' drag commits only what it changes", () => {
    const end: DragTarget = { kind: "sectionEnd", sectionId: "A", end: "a" };
    const onA = tryCommand(end, { kind: "sectionEnd", at: { x: 2, y: 1 } });
    expect(onA).toEqual({ type: "setSection", sectionId: "A", a: { x: 2, y: 1 } });
    const onB = tryCommand({ ...end, end: "b" }, { kind: "sectionEnd", at: { x: 2, y: 1 } });
    expect(onB).toEqual({ type: "setSection", sectionId: "A", b: { x: 2, y: 1 } });
    expect(tryCommand({ kind: "sectionFar", sectionId: "A" }, { kind: "sectionDepth", depth: 2 })).toEqual({ type: "setSection", sectionId: "A", depth: 2 });
  });

  it.each<[string, DragTarget]>([
    ["end", { kind: "sectionEnd", sectionId: "Z", end: "a" }],
    ["far line", { kind: "sectionFar", sectionId: "Z" }],
  ])("a section %s that is gone tries nothing and commits nothing", (_name, target) => {
    const { tried } = dragTry(state, doc, target, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
    expect(tried).toEqual({ kind: "none" });
    expect(tryCommand(target, tried)).toBeNull();
    expect(zeroMoveDependencies(doc, target)).toEqual([]);
  });

  it("a target that is gone tries nothing and commits nothing", () => {
    const { tried } = dragTry(state, doc, { kind: "placement", placementId: "nope" }, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
    expect(tried).toEqual({ kind: "none" });
    expect(tryCommand({ kind: "placement", placementId: "nope" }, tried)).toBeNull();
  });

  it("a group whose pieces are gone tries nothing and commits nothing", () => {
    const target: DragTarget = { kind: "placements", placementIds: ["nope", "b/p0"] };
    const { tried } = dragTry(state, doc, target, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
    expect(tried).toEqual({ kind: "none" });
    expect(tryCommand(target, tried)).toBeNull();
  });

  it("a dimension that is gone tries nothing and commits nothing", () => {
    const target: DragTarget = { kind: "dimension", dimensionId: "nope" };
    const { tried } = dragTry(state, doc, target, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
    expect(tried).toEqual({ kind: "none" });
    expect(tryCommand(target, tried)).toBeNull();
  });

  it("the zone targets' drag tries depth 0.2 and start 0.4", () => {
    const tries = TARGETS.filter(([name]) => name.startsWith("zone")).map(([, target, press]) => dragTry(state, doc, target, press, { x: press.x + 0.4, y: press.y + 0.4 }, 0).tried);
    expect(tries).toEqual([
      { kind: "zoneExtent", side: "front", extent: { depth: 0.2, start: 0, end: 0 } },
      { kind: "zoneExtent", side: "front", extent: { depth: 0.6, start: 0.4, end: 0 } },
    ]);
  });

  it("a zone target that is gone tries nothing and commits nothing", () => {
    const target: DragTarget = { kind: "zoneEnd", placementId: "nope", side: "left", end: "end" };
    const { tried } = dragTry(state, doc, target, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
    expect(tried).toEqual({ kind: "none" });
    expect(tryCommand(target, tried)).toBeNull();
  });

  it("a resize target that is gone tries nothing and commits nothing", () => {
    const target: DragTarget = { kind: "resize", placementId: "nope", side: "left" };
    const { tried } = dragTry(state, doc, target, { x: 0, y: 0 }, { x: 1, y: 1 }, 0);
    expect(tried).toEqual({ kind: "none" });
    expect(tryCommand(target, tried)).toBeNull();
  });
});
