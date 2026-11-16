import { describe, expect, it } from "vitest";
import type { ExportPage, SectionStrip as Strip, UiAction, ViewModel } from "@fm/editor";
import { FrameButton } from "../src/panels/Frame";
import { SectionFrame } from "../src/panels/SectionStrip";
import type { DrawPage } from "../src/panels/SheetPage";
import { call, findAll, mouseDown } from "./react-tree";

const PAGE: ExportPage = { widthMm: 680, heightMm: 208, primitives: [] };
const STRIP: Strip = { section: "B", label: "B–B", layout: "Day", letters: [{ section: "A", label: "A–A" }, { section: "B", label: "B–B" }], page: () => PAGE };
const FRAMES: ViewModel["frames"] = { height: 0.46, larger: false, sectionShare: 0.56, sectionFirst: true, docked: true, side: false };
const DRAW: DrawPage = () => {};
const SIZE = { w: 680, h: 208 };

function render(strip: Strip = STRIP, frames: ViewModel["frames"] = FRAMES, size: { w: number; h: number } | null = SIZE) {
  const sent: UiAction[] = [];
  const swaps: number[] = [];
  return { tree: SectionFrame({ strip, frames, drawPage: DRAW, send: (a) => sent.push(a), onSwap: () => swaps.push(1), body: { current: null }, size }), sent, swaps };
}
const letters = (tree: unknown) => findAll(tree, (p) => p["data-section"] !== undefined);
const button = (tree: unknown, action: string) => findAll(tree, (p) => p["action"] === action)[0];
const frameStyle = (tree: unknown) => findAll(tree, (p) => p["data-testid"] === "section-strip")[0]?.["style"];

describe("SectionFrame", () => {
  it("draws its page at the frame's size", () => {
    const canvas = findAll(render().tree, (p) => p["testId"] === "section-strip-canvas")[0];
    expect(canvas?.["page"]).toBe(PAGE);
    expect(canvas?.["css"]).toEqual(SIZE);
    expect(canvas?.["drawPage"]).toBe(DRAW);
  });

  it("asks for its page at that size", () => {
    const asked: { w: number; h: number }[] = [];
    render({ ...STRIP, page: (size) => (asked.push(size), PAGE) });
    expect(asked).toEqual([SIZE]);
  });

  it("draws nothing until it has a size", () => {
    expect(findAll(render(STRIP, FRAMES, null).tree, (p) => p["testId"] === "section-strip-canvas")).toEqual([]);
  });

  it("names the section and the layout in its title bar", () => {
    const head = findAll(render().tree, (p) => p["label"] !== undefined && p["layout"] !== undefined)[0];
    expect([head?.["label"], head?.["layout"]]).toEqual(["B–B", "Day"]);
  });

  it("lists its letters with the shown one pressed", () => {
    const row = letters(render().tree);
    expect(row.map((p) => [p["data-section"], p["children"], p["aria-pressed"]])).toEqual([["A", "A–A", false], ["B", "B–B", true]]);
  });

  it("shows no letters for one section", () => {
    expect(letters(render({ ...STRIP, letters: [{ section: "B", label: "B–B" }] }).tree)).toEqual([]);
  });

  it("a letter switches it, and keeps the focus off itself", () => {
    const { tree, sent } = render();
    const a = letters(tree)[0];
    let prevented = 0;
    call(a, "onMouseDown", mouseDown(() => (prevented += 1)));
    call(a, "onClick");
    expect(prevented).toBe(1);
    expect(sent).toEqual([{ type: "showSection", section: "A" }]);
  });

  it("close closes it", () => {
    const { tree, sent } = render();
    const close = button(tree, "close-section");
    call(close, "onClick");
    expect(sent).toEqual([{ type: "closeSection" }]);
    expect(close?.["title"]).toBe("Close the section");
    expect(close?.["testId"]).toBe("section-strip-close");
  });

  it("offers swap only beside another frame", () => {
    expect(button(render().tree, "swap-frames")).toBeUndefined();
    const { tree, swaps } = render(STRIP, { ...FRAMES, side: true });
    call(button(tree, "swap-frames"), "onClick");
    expect(swaps).toEqual([1]);
  });

  it("the larger button says which way it goes", () => {
    const { tree, sent } = render();
    const larger = button(tree, "larger-frames");
    expect([larger?.["icon"], larger?.["title"]]).toEqual(["larger", "Larger"]);
    call(larger, "onClick");
    expect(sent).toEqual([{ type: "toggleLargerDock" }]);
    const smaller = button(render(STRIP, { ...FRAMES, larger: true }).tree, "larger-frames");
    expect([smaller?.["icon"], smaller?.["title"]]).toEqual(["smaller", "Back to the usual size"]);
  });

  it("takes its share of the width, and the whole dock alone", () => {
    expect(frameStyle(render().tree)).toEqual({ order: 0, flexGrow: 1 });
    expect(frameStyle(render(STRIP, { ...FRAMES, side: true }).tree)).toEqual({ order: 0, flexGrow: 0.56 });
    expect(frameStyle(render(STRIP, { ...FRAMES, side: true, sectionFirst: false }).tree)).toEqual({ order: 2, flexGrow: 0.56 });
  });
});

describe("FrameButton", () => {
  it("keeps the focus off itself, and is named", () => {
    const tree = FrameButton({ icon: "close", title: "Close", action: "x", onClick: () => {} });
    let prevented = 0;
    call(tree.props, "onMouseDown", mouseDown(() => (prevented += 1)));
    expect(prevented).toBe(1);
    expect(tree.props["aria-label"]).toBe("Close");
  });
});
