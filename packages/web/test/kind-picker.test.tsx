import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Field, OpeningKind } from "@fm/editor";
import { KindField } from "../src/panels/controls";
import { KindList, KindPicker } from "../src/panels/KindPicker";
import { viewFixture } from "./fixtures";
import { call, findAll } from "./react-tree";

// The opening kind picker (openkinds.07, AC-07): one button with the kind's icon and name, a list in groups.

const choices = viewFixture().openingKinds;

describe("KindPicker", () => {
  it("shows the armed kind's icon and name on one button, its list shut", () => {
    const html = renderToStaticMarkup(<KindPicker value="casement" choices={choices} testId="k" label="Opening kind" onPick={() => {}} />);
    expect(html).toMatch(/<button[^>]*data-testid="k"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*><svg.*?<\/svg><span class="kind-button-name">Casement window<\/span>/);
    expect(html).not.toContain('role="menu"');
  });
});

describe("KindList", () => {
  const list = (value: OpeningKind, picked: OpeningKind[] = []) => KindList({ value, choices, onPick: (k) => picked.push(k), onKeyDown: () => {} });

  it("holds every kind once, under its group's name, groups in order, with an icon and a visible name each", () => {
    const html = renderToStaticMarkup(list("swing"));
    expect([...html.matchAll(/role="group" aria-label="([^"]*)"/g)].map((m) => m[1])).toEqual(["Doors", "Windows"]);
    expect([...html.matchAll(/data-opening-kind="([^"]*)"/g)].map((m) => m[1])).toEqual(choices.map((c) => c.kind));
    for (const c of choices) expect(html).toMatch(new RegExp(`data-opening-kind="${c.kind}"[^>]*><svg.*?</svg><span>${c.label}</span>`));
  });

  it("checks the current kind and picks the one clicked", () => {
    const picked: OpeningKind[] = [];
    const items = findAll(list("sliding", picked), (p) => p["role"] === "menuitemradio");
    expect(items.map((p) => p["aria-checked"])).toEqual(choices.map((c) => c.kind === "sliding"));
    call(items.find((p) => p["data-opening-kind"] === "casement"), "onClick");
    expect(picked).toEqual(["casement"]);
  });
});

describe("KindField in Properties", () => {
  it("is the same picker, its choices from the field's grouped options, a pick setting the field", () => {
    const field: Field = {
      id: "kind", label: "Kind", section: "Opening", value: "window", unit: null, readOnly: false, kindPicker: true,
      options: choices.map((c) => ({ value: c.kind, label: c.label, group: c.group })),
    };
    const set: string[] = [];
    const picker = findAll(KindField({ field, disabled: false, onSet: (v) => set.push(v) }), (p) => p["testId"] === "prop-opening-kind")[0];
    expect(picker?.["choices"]).toEqual(choices);
    expect(picker?.["value"]).toBe("window");
    call(picker, "onPick", "casement");
    expect(set).toEqual(["casement"]);
  });
});
