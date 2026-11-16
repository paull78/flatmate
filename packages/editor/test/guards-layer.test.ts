import { describe, expect, it } from "vitest";
import { CARD_STYLE } from "../src/view/card-look";
import { floorView } from "../src/view/plan-view";
import { guardPrimitives } from "../src/view/guards-layer";
import { CANVAS_STYLE, LOOK_STYLE, PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { levelOf, type Command, type Document } from "@fm/domain";
import { cabinDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Guards on the plan and on paper (AC-06). The cabin's loft has one open edge, x 2.10, y 0.10–2.90.

const LOFT = "loft/k0";
const atLoft = (doc: Document) => levelOf(doc, LOFT);
const atFloor = (doc: Document) => floorView(doc, "s0").level;
const segments = (ps: readonly Primitive[]) => ps.filter((p): p is Extract<Primitive, { kind: "segment" }> => p.kind === "segment");
const discs = (ps: readonly Primitive[]) => ps.filter((p): p is Extract<Primitive, { kind: "disc" }> => p.kind === "disc");
const glass: Command = { type: "setDeck", deckId: LOFT, guard: "glass" };
const platform: Command = { type: "addDeck", opId: "p", preset: "platform", at: { x: 3.2, y: 1.5 }, w: 1, d: 1, guard: "railing" };

describe("a Railing on the plan", () => {
  it("is a thin line along its run, with post marks at its ends and about every metre", () => {
    const doc = cabinDoc();
    const ps = guardPrimitives(doc, atLoft(doc), CANVAS_STYLE);
    const [line] = segments(ps);
    expect(segments(ps)).toHaveLength(1);
    expect([line?.a.x, line?.a.y, line?.b.y]).toEqual([expect.closeTo(2.1, 6), expect.closeTo(0.1, 6), expect.closeTo(2.9, 6)]);
    expect(line?.width).toEqual({ px: CANVAS_STYLE.guard.line });
    expect(line?.color).toBe(CANVAS_STYLE.guard.ink);
    expect(discs(ps).length).toBeGreaterThanOrEqual(3); // 2.80 m: both ends, and between them
    expect(discs(ps).length).toBeLessThanOrEqual(5);
  });
});

describe("a Glass guard on the plan", () => {
  it("is a thin line with no posts, blue on the canvas and ink on paper", () => {
    const doc = withCommands(cabinDoc(), glass);
    const canvas = guardPrimitives(doc, atLoft(doc), CANVAS_STYLE);
    expect(discs(canvas)).toEqual([]);
    expect(segments(canvas)[0]?.color).toBe(CANVAS_STYLE.openingGlass);
    const paper = guardPrimitives(doc, atLoft(doc), PRESENTATION_STYLE);
    expect(segments(paper)[0]?.color).toBe(PRESENTATION_STYLE.openingGlass);
    expect(PRESENTATION_STYLE.openingGlass).toBe(PRESENTATION_STYLE.openingLine);
  });
});

describe("which level draws it", () => {
  it("a loft's rail doesn't draw at the floor, and does at the loft", () => {
    const doc = cabinDoc();
    expect(guardPrimitives(doc, atFloor(doc), CANVAS_STYLE)).toEqual([]);
    expect(guardPrimitives(doc, atLoft(doc), CANVAS_STYLE).length).toBeGreaterThan(0);
  });

  it("a railed platform's draws at the floor, and not at the loft", () => {
    const doc = withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guard: "none" }, platform);
    expect(guardPrimitives(doc, atFloor(doc), CANVAS_STYLE).length).toBeGreaterThan(0);
    expect(guardPrimitives(doc, atLoft(doc), CANVAS_STYLE)).toEqual([]);
  });

  it("the scene's and the picture's layers carry it, at the level in view", () => {
    const shell = FakeShell.withDocument(cabinDoc());
    const count = (): number => segments(shell.scene().layers.find((l) => l.name === "overheads")?.primitives ?? []).filter((s) => Math.abs(s.a.x - 2.1) < 1e-6 && Math.abs(s.b.x - 2.1) < 1e-6 && s.width !== undefined && "px" in s.width && s.width.px === CANVAS_STYLE.guard.line && s.dash === undefined).length;
    const before = count();
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(count()).toBe(before + 1);
  });
});

describe("None and the styles", () => {
  it("None draws nothing", () => {
    const doc = withCommands(cabinDoc(), { type: "setDeck", deckId: LOFT, guard: "none" });
    expect(guardPrimitives(doc, atLoft(doc), CANVAS_STYLE)).toEqual([]);
  });

  it("paper and look use their own widths and inks", () => {
    const doc = cabinDoc();
    expect(segments(guardPrimitives(doc, atLoft(doc), PRESENTATION_STYLE))[0]?.width).toEqual({ px: PRESENTATION_STYLE.guard.line });
    expect(segments(guardPrimitives(doc, atLoft(doc), LOOK_STYLE))[0]?.color).toBe(LOOK_STYLE.guard.ink);
  });
});

describe("found in review: on a project card", () => {
  it("a guard is drawn at the card's own scale, not paper's", () => {
    expect(CARD_STYLE.guard.line).toBeGreaterThan(PRESENTATION_STYLE.guard.line * 4);
    expect(CARD_STYLE.guard.post).toBeGreaterThan(PRESENTATION_STYLE.guard.post * 4);
  });
});
