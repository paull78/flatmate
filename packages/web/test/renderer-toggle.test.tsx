import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasCorner, RendererToggle } from "../src/panels/RendererToggle";
import { WEBGL_UNAVAILABLE } from "../src/renderer-switch";
import { call, findAll, mouseDown } from "./react-tree";

const onToggle = (): void => {};

describe("RendererToggle", () => {
  it("names the current renderer and marks WebGL as pressed", () => {
    const canvas = renderToStaticMarkup(<RendererToggle choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} />);
    expect(canvas).toMatch(/<button[^>]*data-action="renderer"[^>]*aria-pressed="false"[^>]*>Canvas2D<\/button>/);
    const webgl = renderToStaticMarkup(<RendererToggle choice={{ kind: "webgl", notice: null }} onToggle={onToggle} />);
    expect(webgl).toMatch(/<button[^>]*data-action="renderer"[^>]*aria-pressed="true"[^>]*>WebGL<\/button>/);
    expect(webgl).not.toContain("renderer-notice");
    const webgpu = renderToStaticMarkup(<RendererToggle choice={{ kind: "webgpu", notice: null }} onToggle={onToggle} />);
    expect(webgpu).toMatch(/<button[^>]*data-action="renderer"[^>]*aria-pressed="true"[^>]*>WebGPU<\/button>/); // webgpu.10
  });

  it("shows the fallback notice", () => {
    const html = renderToStaticMarkup(<RendererToggle choice={{ kind: "canvas2d", notice: WEBGL_UNAVAILABLE }} onToggle={onToggle} />);
    expect(html).toContain(`data-testid="renderer-notice">${WEBGL_UNAVAILABLE}<`);
  });
});

describe("the canvas corner chip (ux-polish item 7)", () => {
  const CORNER = { choice: { kind: "canvas2d", notice: null }, onToggle, gridStep: 0.2, cut: null } as const;
  const marksSwitch = (sectionMarks: boolean, sent: boolean[] = []) => findAll(CanvasCorner({ ...CORNER, sectionMarks, onSectionMarks: (on) => sent.push(on) }), (p) => p["data-action"] === "section-marks")[0];

  it("offers the section marks' switch only with a section to hide (section.59)", () => {
    expect(renderToStaticMarkup(<CanvasCorner {...CORNER} sectionMarks={null} />)).not.toContain("section-marks");
    expect(marksSwitch(true)?.["aria-pressed"]).toBe(true);
    expect(marksSwitch(false)?.["aria-pressed"]).toBe(false);
  });

  it("its click asks for the other state, and it keeps the focus off itself", () => {
    const sent: boolean[] = [];
    call(marksSwitch(true, sent), "onClick");
    call(marksSwitch(false, sent), "onClick");
    expect(sent).toEqual([false, true]);
    let prevented = 0;
    call(marksSwitch(true), "onMouseDown", mouseDown(() => (prevented += 1)));
    expect(prevented).toBe(1);
  });

  it("the renderer chip still toggles the renderer, next to the grid step (AC-13)", () => {
    const html = renderToStaticMarkup(<CanvasCorner choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} gridStep={0.2} cut={null} />);
    expect(html).toMatch(/data-testid="canvas-corner"/);
    expect(html).toMatch(/<button[^>]*data-action="renderer"[^>]*>Canvas2D<\/button>/);
    expect(html).toContain('data-testid="grid-step">0.20 m<');
    let toggles = 0;
    const tree = CanvasCorner({ choice: { kind: "webgl", notice: null }, onToggle: () => (toggles += 1), gridStep: 1, cut: null });
    const toggle = findAll(tree, (p) => p.choice !== undefined)[0];
    call(toggle, "onToggle");
    expect(toggles).toBe(1);
  });

  it("shows the cut beside the grid step with a drawing open, and nothing without one (heights.15, AC-09)", () => {
    const open = renderToStaticMarkup(<CanvasCorner choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} gridStep={0.2} cut="Cut +1.10" />);
    expect(open).toContain('data-testid="cut-height"');
    expect(open).toContain(">Cut +1.10<");
    const none = renderToStaticMarkup(<CanvasCorner choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} gridStep={0.2} cut={null} />);
    expect(none).not.toContain("cut-height");
  });
});
