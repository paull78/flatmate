import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FLOOR_TILES, searchPalette, type PaletteCard, type UiAction, type ViewModel } from "@fm/editor";
import { FakeShell } from "@fm/editor/testing";
import { Palette, PaletteGroups } from "../src/panels/Palette";
import { GROUP_KEY, readGroup, writeGroup, type GroupStorage } from "../src/panels/palette-model";
import { QuickAddView } from "../src/panels/QuickAdd";
import { viewFixture } from "./fixtures";
import { call, findAll, findByTestId } from "./react-tree";

// The palette's rail and cards (library spec "The rail", "The cards"; library.02, .03, .04): one group's cards at a
// time beside a rail of nine groups, rendered from the editor's real palette model.

const RAIL = ["Sleep", "Sit and eat", "Work", "Kitchen", "Bathroom", "Storage", "Sets", "Basic", "Stairs", "Floors"];
const LABELS = ["Sleep", "Sit & eat", "Work", "Kitchen", "Bathroom", "Storage", "Sets", "Basic", "Stairs", "Floors"];

const real = (): ViewModel => FakeShell.local().view();
const groups = (view: ViewModel, group: string, extra: { send?: (a: UiAction) => void; onGroup?: (g: string) => void; searching?: boolean } = {}) =>
  PaletteGroups({ view, send: extra.send ?? (() => {}), group, onGroup: extra.onGroup ?? (() => {}), searching: extra.searching ?? false });
const rail = (tree: unknown) => findAll(tree, (p) => typeof p["data-group"] === "string");
const cards = (tree: unknown) => findAll(tree, (p) => p.className === "palette-card" && typeof p["data-kind"] === "string");
const cardKey = (p: Record<string, unknown>): string => `${String(p["data-kind"])}/${String(p["data-preset"] ?? "")}`;
const groupOf = (view: ViewModel, group: string): PaletteCard[] => view.palette.find((g) => g.group === group)?.cards ?? [];

describe("Palette: the rail (library.02, .03)", () => {
  it("rail lists nine groups in order with labels", () => {
    const html = renderToStaticMarkup(<Palette view={real()} send={() => {}} />);
    const buttons = [...html.matchAll(/<button[^>]*class="palette-rail-button"[^>]*data-group="([^"]+)"[^>]*>(.*?)<\/button>/g)];
    expect(buttons.map((b) => b[1])).toEqual(RAIL);
    for (const [i, b] of buttons.entries()) {
      expect(b[2]).toMatch(/^<svg[^>]*viewBox="0 0 24 24"[^>]*>.*<\/svg><span>/); // an inline icon over its label
      expect(b[2]).toContain(`<span>${LABELS[i]?.replace("&", "&amp;") ?? "?"}</span>`);
    }
  });

  it("clicking a group shows only its cards", () => {
    const view = real();
    const asked: string[] = [];
    const sleep = groups(view, "Sleep", { onGroup: (g) => asked.push(g) });
    expect(cards(sleep).map(cardKey)).toEqual(groupOf(view, "Sleep").map((c) => `${c.kind}/${c.preset ?? ""}`));
    call(rail(sleep).find((b) => b["data-group"] === "Work"), "onClick");
    expect(asked).toEqual(["Work"]);
    expect(cards(groups(view, "Work")).map((p) => p["data-kind"])).toEqual(["desk", "deskSet", "cornerDesk"]);
    expect(findAll(groups(view, "Work"), (p) => typeof p["data-motif"] === "string")).toEqual([]); // Floors only in Floors
  });

  it("the active group is pressed (aria-pressed)", () => {
    const pressed = (group: string) => rail(groups(real(), group)).filter((b) => b["aria-pressed"] === true).map((b) => b["data-group"]);
    expect(pressed("Kitchen")).toEqual(["Kitchen"]);
    expect(pressed("Floors")).toEqual(["Floors"]);
    expect(rail(groups(real(), "Kitchen")).map((b) => b["aria-pressed"])).toEqual(RAIL.map((g) => g === "Kitchen"));
  });
});

describe("Palette: the cards (library.04, .12)", () => {
  it("a preset card sends pickKind and pickPreset", () => {
    const sent: UiAction[] = [];
    const tree = groups(real(), "Sit and eat", { send: (a) => sent.push(a) });
    call(
      cards(tree).find((p) => p["data-kind"] === "sofa" && p["data-preset"] === "3 seats"),
      "onClick",
    );
    expect(sent).toEqual([{ type: "pickKind", kind: "sofa" }, { type: "pickPreset", kind: "sofa", preset: "3 seats 210 × 90" }]); // pickPreset takes the label

    // Through the editor: the kind is armed at that preset, and only that card is pressed.
    const shell = FakeShell.local();
    const card = (v: ViewModel, preset: string) => cards(groups(v, "Sit and eat", { send: (a) => shell.ui(a) })).find((p) => p["data-kind"] === "seatedDining" && p["data-preset"] === preset);
    call(card(shell.view(), "8 seats"), "onClick");
    expect(shell.view().sizePicker?.current).toMatch(/^8 seats /);
    const pressed = cards(groups(shell.view(), "Sit and eat")).filter((p) => p["aria-pressed"] === true).map(cardKey);
    expect(pressed).toEqual(["seatedDining/8 seats"]);
    call(card(shell.view(), "4 seats"), "onClick");
    expect(cards(groups(shell.view(), "Sit and eat")).filter((p) => p["aria-pressed"] === true).map(cardKey)).toEqual(["seatedDining/4 seats"]);
  });

  it("no preset card is pressed while a typed size makes the list read Custom (sizing step 02)", () => {
    const shell = FakeShell.local();
    const pressed = () => cards(groups(shell.view(), "Sit and eat")).filter((p) => p["aria-pressed"] === true).map(cardKey);
    shell.ui({ type: "pickKind", kind: "sofa" });
    shell.ui({ type: "pickPreset", kind: "sofa", preset: "3 seats 210 × 90" });
    expect(pressed()).toEqual(["sofa/3 seats"]);
    shell.ui({ type: "setArmedSize", kind: "sofa", width: "1.95" });
    expect(shell.view().sizePicker?.current).toBe("Custom");
    expect(pressed()).toEqual([]);
  });

  it("a one-card kind sends pickKind only; it is pressed only while the Object tool is armed with it", () => {
    const sent: UiAction[] = [];
    call(cards(groups(real(), "Work", { send: (a) => sent.push(a) })).find((p) => p["data-kind"] === "desk"), "onClick");
    expect(sent).toEqual([{ type: "pickKind", kind: "desk" }]);
    expect(cards(groups(real(), "Work")).find((p) => p["data-kind"] === "desk")?.["data-preset"]).toBeUndefined();

    const pressed = (v: ViewModel) => cards(groups(v, "Work")).filter((p) => p["aria-pressed"] === true).map(cardKey);
    const shell = FakeShell.local();
    shell.ui({ type: "pickKind", kind: "desk" });
    expect(pressed(shell.view())).toEqual(["desk/"]);
    shell.key("v");
    expect(pressed(shell.view())).toEqual([]);
  });

  it("cards show name and size lines", () => {
    const html = renderToStaticMarkup(groups(real(), "Sit and eat"));
    const shown = [...html.matchAll(/<button[^>]*data-kind="([^"]+)"[^>]*>(<svg.*?<\/svg>)<span class="palette-card-name">([^<]*)<\/span><span class="palette-card-size">([^<]*)<\/span><\/button>/g)];
    expect(shown.map((m) => [m[3], m[4]])).toEqual(groupOf(real(), "Sit and eat").map((c) => [c.name, c.size]));
    expect(shown.map((m) => [m[3], m[4]])).toContainEqual(["Sofa · 3 seats", "2.10 × 0.90 m"]);
    expect(shown.map((m) => [m[3], m[4]])).toContainEqual(["Coffee table", "1.00 × 0.50 m"]);
    expect(shown.map((m) => m[4])).toContainEqual(expect.stringMatching(/^Ø \d\.\d\d m$/)); // a round set
    for (const m of shown) expect(m[2]).toMatch(/<line /); // the symbol: at least its outline
  });

  it("Floors shows the switch and motif cards", () => {
    const floors: ViewModel["floors"] = { on: true, tiles: FLOOR_TILES, armed: null };
    const view = viewFixture({ palette: real().palette, floors });
    const html = renderToStaticMarkup(groups(view, "Floors"));
    expect(html.indexOf('data-testid="finishes-switch"')).toBeGreaterThan(0);
    expect(html.indexOf('data-testid="finishes-switch"')).toBeLessThan(html.indexOf("data-motif="));
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html).not.toContain("data-kind=");
    const motifs = [...html.matchAll(/<button[^>]*data-motif="([^"]+)"[^>]*>(.*?)<\/button>/g)];
    expect(motifs.map((t) => t[1])).toEqual(FLOOR_TILES.map((t) => t.motif));
    for (const [, motif, inner] of motifs) {
      expect(inner).toMatch(/^<svg[^>]*><path [^>]*fill="#[0-9a-f]{6}"/); // the swatch: its floor first
      expect(inner).toContain(`<span class="palette-card-name">${FLOOR_TILES.find((t) => t.motif === motif)?.label ?? "?"}</span>`);
      expect(inner).not.toContain("palette-card-size"); // a motif has no size line
    }

    const sent: UiAction[] = [];
    const tree = groups(view, "Floors", { send: (a) => sent.push(a) });
    call(findAll(tree, (p) => p["data-motif"] === "mosaic")[0], "onClick");
    call(findByTestId(tree, "finishes-switch"), "onClick");
    expect(sent).toEqual([{ type: "pickMotif", motif: "mosaic" }, { type: "setFinishesOn", on: false }]);
    const pressed = (v: ViewModel) => findAll(groups(v, "Floors"), (p) => p["aria-pressed"] === true && typeof p["data-motif"] === "string").map((p) => p["data-motif"]);
    expect(pressed(viewFixture({ activeTool: "zone", palette: real().palette, floors: { ...floors, armed: "planks" } }))).toEqual(["planks"]);
    expect(pressed(viewFixture({ activeTool: "zone", palette: real().palette, floors }))).toEqual([]);
  });
});

describe("Palette: searching and the remembered group (library spec \"The rail\")", () => {
  it("searching hides the cards and shows results from every group; clearing shows the chosen group", () => {
    const view = real();
    const rows = searchPalette("table");
    const quick = QuickAddView({ state: { text: "table", highlight: 0 }, rows, tiles: new Map(), onText: () => {}, onKeyDown: () => {}, onPick: () => {}, onHover: () => {} });
    const searching = PaletteGroups({ view, send: () => {}, group: "Sleep", onGroup: () => {}, quick, searching: true });
    expect(cards(searching)).toEqual([]);
    expect(rail(searching)).toEqual([]);
    const found = findAll(searching, (p) => p.className === "quick-add-row").map((p) => p["data-kind"]);
    expect(found).toContain("builtInTable"); // Sleep
    expect(found).toContain("foldingTable"); // Sit and eat
    expect(found).toContain("coffeeTable");

    const cleared = PaletteGroups({ view, send: () => {}, group: "Sleep", onGroup: () => {}, searching: false });
    expect(rail(cleared).filter((b) => b["aria-pressed"] === true).map((b) => b["data-group"])).toEqual(["Sleep"]);
    expect(cards(cleared).map((p) => p["data-kind"])).toContain("bed");
  });

  it("the remembered group is read and written through storage that may throw", () => {
    const store = new Map<string, string>();
    const working: GroupStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
    expect(readGroup(() => working, RAIL)).toBe("Sleep"); // nothing stored: Sleep first
    writeGroup(() => working, "Work");
    expect(store.get(GROUP_KEY)).toBe("Work");
    expect(readGroup(() => working, RAIL)).toBe("Work");
    store.set(GROUP_KEY, "Garden"); // a group that no longer exists
    expect(readGroup(() => working, RAIL)).toBe("Sleep");

    const throwing: GroupStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readGroup(() => throwing, RAIL)).toBe("Sleep");
    expect(() => writeGroup(() => throwing, "Work")).not.toThrow();
    const blocked = (): GroupStorage => {
      throw new Error("no storage");
    };
    expect(readGroup(blocked, RAIL)).toBe("Sleep");
    expect(() => writeGroup(blocked, "Work")).not.toThrow();
    expect(readGroup(() => null, RAIL)).toBe("Sleep");

    // In node there is no window, so no storage at all: the palette still renders, on Sleep.
    const html = renderToStaticMarkup(<Palette view={real()} send={() => {}} />);
    expect(html).toMatch(/data-group="Sleep"[^>]*aria-pressed="true"/);
    expect(html).toContain('data-kind="bed"');
  });
});
