import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UiAction } from "@fm/editor";
import { FloatingBar } from "../src/panels/FloatingBar";
import { viewFixture } from "./fixtures";
import { call, findAll, findByTestId } from "./react-tree";

const buttonTag = (html: string, attr: string): string => new RegExp(`<button[^>]*${attr}[^>]*>`).exec(html)?.[0] ?? "";

describe("FloatingBar (ux-polish item 7)", () => {
  it("renders nine tool buttons with icons and titles like \"Wall (W)\", the pressed one matching the active tool (AC-12)", () => {
    const html = renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool: "wall" })} send={() => {}} />);
    const tools = [
      ["select", "Select (V)"], ["wall", "Wall (W)"], ["zone", "Zone (Z)"], ["object", "Object (O)"], ["opening", "Opening (D)"],
      ["dimension", "Dimension (M)"], ["section", "Section (S)"], ["column", "Column (C)"], ["deck", "Deck (K)"],
    ] as const;
    for (const [tool, title] of tools) {
      const tag = buttonTag(html, `data-tool="${tool}"`);
      expect(tag, tool).toContain(`title="${title}"`);
      expect(tag, tool).toContain(`aria-pressed="${tool === "wall"}"`);
    }
    expect(html.match(/data-tool="/g)).toHaveLength(9);
    // Each tool button holds an inline SVG icon and its key letter.
    expect(html).toMatch(/data-tool="wall"[^>]*><svg[^>]*viewBox="0 0 20 20"[^>]*>.*?<\/svg><span class="icon-key">W<\/span><\/button>/);

    const sent: UiAction[] = [];
    call(findAll(FloatingBar({ view: viewFixture(), send: (a) => sent.push(a) }), (p) => p["data-tool"] === "zone")[0], "onClick");
    expect(sent).toEqual([{ type: "pickTool", tool: "zone" }]);
    call(findAll(FloatingBar({ view: viewFixture(), send: (a) => sent.push(a) }), (p) => p["data-tool"] === "dimension")[0], "onClick");
    expect(sent).toEqual([{ type: "pickTool", tool: "zone" }, { type: "pickTool", tool: "dimension" }]);
  });

  it("shows the thickness field only with the Wall tool, the opening kind picker only with the Opening tool (sending pickOpeningKind); undo and redo are disabled when there is nothing to undo or redo (AC-12)", () => {
    const select = renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool: "select" })} send={() => {}} />);
    expect(select).not.toContain('data-testid="wall-thickness"');
    expect(select).not.toContain('data-testid="opening-kind"');

    const wallView = viewFixture({ activeTool: "wall", wallThickness: "0.20" });
    const wall = renderToStaticMarkup(<FloatingBar view={wallView} send={() => {}} />);
    const input = /<input[^>]*data-testid="wall-thickness"[^>]*>/.exec(wall)?.[0] ?? "";
    expect(input).toContain('value="0.20"');
    expect(input).not.toContain('type="number"'); // it takes 30cm and 0,20 (typed-input.05)
    expect(wall).not.toContain('data-testid="opening-kind"');
    const thickness: UiAction[] = [];
    call(findByTestId(FloatingBar({ view: wallView, send: (a) => thickness.push(a) }), "wall-thickness"), "onCommit", "0.10");
    expect(thickness).toEqual([{ type: "setWallThickness", value: "0.10" }]);

    const openingView = viewFixture({ activeTool: "opening", openingKind: "sliding" });
    const opening = renderToStaticMarkup(<FloatingBar view={openingView} send={() => {}} />);
    expect(opening).not.toContain('data-testid="wall-thickness"');
    // One kind button, its list shut (openkinds.07): the armed kind's name, and a pick from the list arms another.
    const kindButton = buttonTag(opening, 'data-testid="opening-kind"');
    expect(kindButton).toContain('aria-expanded="false"');
    expect(kindButton).toContain('aria-label="Opening kind: Sliding door"');
    expect(opening).toMatch(/data-testid="opening-kind"[^>]*><svg.*?<\/svg><span class="kind-button-name">Sliding door<\/span>/);
    expect(opening).not.toContain("data-opening-kind");
    const kinds: UiAction[] = [];
    call(findAll(FloatingBar({ view: openingView, send: (a) => kinds.push(a) }), (p) => p["testId"] === "opening-kind")[0], "onPick", "window");
    expect(kinds).toEqual([{ type: "pickOpeningKind", kind: "window" }]);

    const none = renderToStaticMarkup(<FloatingBar view={viewFixture({ canUndo: false, canRedo: false })} send={() => {}} />);
    expect(buttonTag(none, 'data-action="undo"')).toContain('disabled=""');
    expect(buttonTag(none, 'data-action="redo"')).toContain('disabled=""');
    const undoOnly = renderToStaticMarkup(<FloatingBar view={viewFixture({ canUndo: true, canRedo: false })} send={() => {}} />);
    expect(buttonTag(undoOnly, 'data-action="undo"')).not.toContain("disabled");
    expect(buttonTag(undoOnly, 'data-action="redo"')).toContain('disabled=""');
    const history: UiAction[] = [];
    const tree = FloatingBar({ view: viewFixture({ canUndo: true, canRedo: true }), send: (a) => history.push(a) });
    call(findAll(tree, (p) => p["data-action"] === "undo")[0], "onClick");
    call(findAll(tree, (p) => p["data-action"] === "redo")[0], "onClick");
    expect(history).toEqual([{ type: "undo" }, { type: "redo" }]);
  });
});

describe("FloatingBar's Deck tool (decks.06)", () => {
  it("nine tool buttons; the Deck tool shows Platform and Loft, the chosen one pressed, sending pickDeckPreset", () => {
    const html = renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool: "deck" })} send={() => {}} />);
    expect(html.match(/data-tool="/g)).toHaveLength(9);
    expect(buttonTag(html, 'data-tool="deck"')).toContain('aria-pressed="true"');
    expect(html).toMatch(/data-tool="deck"[^>]*><svg[^>]*viewBox="0 0 20 20"[^>]*><rect[^>]*>.*?<\/svg><span class="icon-key">K<\/span><\/button>/); // the slab icon
    const group = /<span[^>]*data-testid="deck-preset"[^>]*>/.exec(html)?.[0] ?? "";
    expect(group).toContain('aria-label="Deck preset"');
    expect([...html.matchAll(/<button[^>]*data-deck-preset="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]])).toEqual([["platform", "Platform"], ["loft", "Loft"]]);
    expect(buttonTag(html, 'data-deck-preset="platform"')).toContain('aria-pressed="true"');
    expect(buttonTag(html, 'data-deck-preset="loft"')).toContain('aria-pressed="false"');
    expect(html).not.toContain('data-testid="opening-kind"');

    const loft = renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool: "deck", deckPreset: "loft" })} send={() => {}} />);
    expect(buttonTag(loft, 'data-deck-preset="loft"')).toContain('aria-pressed="true"');
    expect(buttonTag(loft, 'data-deck-preset="platform"')).toContain('aria-pressed="false"');

    for (const activeTool of ["select", "opening"] as const) {
      expect(renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool })} send={() => {}} />), activeTool).not.toContain("data-deck-preset");
    }

    const sent: UiAction[] = [];
    const tree = FloatingBar({ view: viewFixture({ activeTool: "deck" }), send: (a) => sent.push(a) });
    const buttons = findAll(tree, (p) => typeof p["data-deck-preset"] === "string");
    for (const b of buttons) expect(typeof b["onMouseDown"]).toBe("function"); // keepFocus
    call(findAll(tree, (p) => p["data-deck-preset"] === "loft")[0], "onClick");
    expect(sent).toEqual([{ type: "pickDeckPreset", preset: "loft" }]);
  });
});

describe("FloatingBar's Column tool (pillars.12)", () => {
  it("shows a filled square icon, the presets 20, 30 and 40 (the current one pressed) and the typed width and depth", () => {
    const view = viewFixture({ activeTool: "column", columnSize: { width: "0.30", depth: "0.40" } });
    const html = renderToStaticMarkup(<FloatingBar view={view} send={() => {}} />);
    expect(html).toMatch(/data-tool="column"[^>]*><svg[^>]*viewBox="0 0 20 20"[^>]*>(?:(?!<\/svg>).)*<rect[^>]*fill="currentColor"[^>]*>.*?<\/svg><span class="icon-key">C<\/span><\/button>/);
    const group = /<span[^>]*data-testid="column-size"[^>]*>/.exec(html)?.[0] ?? "";
    expect(group).toContain('aria-label="Column size"');
    expect([...html.matchAll(/<button[^>]*data-column-size="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]])).toEqual([["0.20", "20"], ["0.30", "30"], ["0.40", "40"]]);
    expect(buttonTag(html, 'data-column-size="0.30"')).toContain('aria-pressed="false"'); // 0.30 × 0.40 is no preset
    expect(buttonTag(html, 'data-column-size="0.30"')).toContain('title="0.30 × 0.30 m"');
    expect(/<input[^>]*data-testid="column-width"[^>]*>/.exec(html)?.[0]).toContain('value="0.30"');
    expect(/<input[^>]*data-testid="column-depth"[^>]*>/.exec(html)?.[0]).toContain('value="0.40"');
    const square = renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool: "column" })} send={() => {}} />);
    expect(buttonTag(square, 'data-column-size="0.30"')).toContain('aria-pressed="true"');
    for (const activeTool of ["select", "deck"] as const) {
      expect(renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool })} send={() => {}} />), activeTool).not.toContain("data-column-size");
    }

    const sent: UiAction[] = [];
    const tree = FloatingBar({ view, send: (a) => sent.push(a) });
    for (const b of findAll(tree, (p) => typeof p["data-column-size"] === "string")) expect(typeof b["onMouseDown"]).toBe("function"); // keepFocus
    call(findAll(tree, (p) => p["data-column-size"] === "0.40")[0], "onClick");
    call(findByTestId(tree, "column-width"), "onCommit", "0.25");
    call(findByTestId(tree, "column-depth"), "onCommit", "0.5");
    expect(sent).toEqual([{ type: "setColumnSize", width: "0.40", depth: "0.40" }, { type: "setColumnSize", width: "0.25" }, { type: "setColumnSize", depth: "0.5" }]);
  });
});

describe("FloatingBar", () => {
  it("shows the snap step with every tool: Auto, 1, 5, 10, 25 and 50 cm, the chosen one pressed; a click sends setSnapStep (AC-14)", () => {
    const steps = ["auto", "0.01", "0.05", "0.1", "0.25", "0.5"];
    for (const activeTool of ["select", "wall"] as const) {
      const html = renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool, snapStep: 0.25 })} send={() => {}} />);
      expect([...html.matchAll(/data-snap-step="([^"]*)"/g)].map((m) => m[1]), activeTool).toEqual(steps);
      for (const step of steps) expect(buttonTag(html, `data-snap-step="${step}"`), step).toContain(`aria-pressed="${step === "0.25"}"`);
      const group = /<span[^>]*data-testid="snap-step"[^>]*>/.exec(html)?.[0] ?? "";
      expect(group).toContain('aria-label="Snap step"');
      expect(group).toContain('role="group"');
    }

    const sent: UiAction[] = [];
    const tree = FloatingBar({ view: viewFixture({ snapStep: 0.25 }), send: (a) => sent.push(a) });
    call(findAll(tree, (p) => p["data-snap-step"] === "0.05")[0], "onClick");
    expect(sent).toEqual([{ type: "setSnapStep", step: 0.05 }]);
    const buttons = findAll(tree, (p) => typeof p["data-snap-step"] === "string");
    expect(buttons).toHaveLength(6);
    for (const b of buttons) expect(typeof b["onMouseDown"]).toBe("function"); // keepFocus
    // Number-only text so the bar fits one row at 1280 px; the unit is in each title.
    expect(buttons.map((b) => b["title"])).toEqual(["Snap to the zoom grid", "Snap to 1 cm", "Snap to 5 cm", "Snap to 10 cm", "Snap to 25 cm", "Snap to 50 cm"]);
  });
});

describe("FloatingBar reads the ViewModel's tools (arch-review R-01, AC-09)", () => {
  it("renders one button per ViewModel tool, with its label and key", () => {
    const view = viewFixture({ tools: [{ tool: "wall", label: "Wall", key: "W" }, { tool: "zone", label: "Zone", key: "Z" }] });
    const html = renderToStaticMarkup(<FloatingBar view={view} send={() => {}} />);
    expect(html.match(/data-tool="/g)).toHaveLength(2);
    expect(buttonTag(html, 'data-tool="zone"')).toContain('title="Zone (Z)"');
  });
});

describe("the floating bar's groups (tidy C10a, AC-14)", () => {
  it("has no divider elements; tools, the tool's setting, snap steps, undo and redo and Export are separate flex items", () => {
    for (const activeTool of ["select", "wall", "opening", "deck"] as const) {
      const html = renderToStaticMarkup(<FloatingBar view={viewFixture({ activeTool })} send={() => {}} />);
      expect(html, activeTool).not.toContain("bar-sep");
      expect(html.match(/class="bar-group"/g), activeTool).toHaveLength(2); // the tools, undo and redo
    }
  });
});
