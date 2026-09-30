import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RendererToggle } from "../src/panels/RendererToggle";
import { Toolbar } from "../src/panels/Toolbar";
import { WEBGL_UNAVAILABLE } from "../src/renderer-switch";
import { viewFixture } from "./fixtures";

const onToggle = (): void => {};

describe("RendererToggle", () => {
  it("names the current renderer and marks WebGL as pressed", () => {
    const canvas = renderToStaticMarkup(<RendererToggle choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} />);
    expect(canvas).toMatch(/<button[^>]*data-action="renderer"[^>]*aria-pressed="false"[^>]*>Canvas2D<\/button>/);
    const webgl = renderToStaticMarkup(<RendererToggle choice={{ kind: "webgl", notice: null }} onToggle={onToggle} />);
    expect(webgl).toMatch(/<button[^>]*data-action="renderer"[^>]*aria-pressed="true"[^>]*>WebGL<\/button>/);
    expect(webgl).not.toContain("renderer-notice");
  });

  it("shows the fallback notice", () => {
    const html = renderToStaticMarkup(<RendererToggle choice={{ kind: "canvas2d", notice: WEBGL_UNAVAILABLE }} onToggle={onToggle} />);
    expect(html).toContain(`data-testid="renderer-notice">${WEBGL_UNAVAILABLE}<`);
  });
});

describe("Toolbar", () => {
  it("renders extra controls after undo and redo", () => {
    const html = renderToStaticMarkup(
      <Toolbar view={viewFixture()} send={() => {}}>
        <RendererToggle choice={{ kind: "canvas2d", notice: null }} onToggle={onToggle} />
      </Toolbar>,
    );
    expect(html.indexOf('data-action="renderer"')).toBeGreaterThan(html.indexOf('data-action="redo"'));
  });
});
