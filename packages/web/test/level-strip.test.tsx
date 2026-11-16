import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UiAction } from "@fm/editor";
import { LevelStrip } from "../src/panels/LevelStrip";
import { viewFixture } from "./fixtures";
import { call, findAll, mouseDown } from "./react-tree";

const loftViewed = viewFixture({
  levels: {
    rows: [
      { deck: "d9", height: "+2.30", name: "Bunk", viewed: false },
      { deck: "d2", height: "+2.15", name: "Loft, Deck", viewed: true },
      { deck: null, height: "0.00", name: "Floor", viewed: false },
    ],
  },
});

const rowTag = (html: string, level: string): string => new RegExp(`<button[^>]*data-level="${level}"[^>]*>.*?</button>`).exec(html)?.[0] ?? "";

describe("LevelStrip (levels.10, AC-09)", () => {
  it("hidden with null levels", () => {
    expect(LevelStrip({ view: viewFixture({ levels: null }), send: () => {} })).toBeNull();
    expect(renderToStaticMarkup(<LevelStrip view={viewFixture({ levels: null })} send={() => {}} />)).toBe("");
  });

  it("rows highest first with the viewed one pressed", () => {
    const html = renderToStaticMarkup(<LevelStrip view={loftViewed} send={() => {}} />);
    expect(html).toContain('data-testid="level-strip"');
    expect(html).toContain('aria-label="Levels"');
    expect([...html.matchAll(/data-level="([^"]*)"/g)].map((m) => m[1])).toEqual(["d9", "d2", "floor"]);
    // Two columns: the height, then the name.
    expect(rowTag(html, "d2")).toMatch(/<span class="level-height">\+2\.15<\/span><span class="level-name">Loft, Deck<\/span>/);
    expect(rowTag(html, "floor")).toMatch(/<span class="level-height">0\.00<\/span><span class="level-name">Floor<\/span>/);
    expect(rowTag(html, "d9")).toContain('aria-pressed="false"');
    expect(rowTag(html, "d2")).toContain('aria-pressed="true"');
    expect(rowTag(html, "floor")).toContain('aria-pressed="false"');
  });

  it("clicking a row sends setViewedLevel with its deck id (null for the floor)", () => {
    const sent: UiAction[] = [];
    const tree = LevelStrip({ view: loftViewed, send: (a) => sent.push(a) });
    call(findAll(tree, (p) => p["data-level"] === "floor")[0], "onClick");
    call(findAll(tree, (p) => p["data-level"] === "d9")[0], "onClick");
    expect(sent).toEqual([
      { type: "setViewedLevel", deck: null },
      { type: "setViewedLevel", deck: "d9" },
    ]);
    // Pressing a row keeps focus on the canvas, so Page Up and Page Down keep working.
    let prevented = false;
    call(findAll(tree, (p) => p["data-level"] === "d2")[0], "onMouseDown", mouseDown(() => (prevented = true)));
    expect(prevented).toBe(true);
  });
});
