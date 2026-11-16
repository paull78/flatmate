import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Field } from "@fm/editor";
import { NumberField, Segmented, Select, Switch } from "../src/panels/controls";
import { call, findAll } from "./react-tree";

const side: Field = { id: "side", label: "Side", section: "Swing", value: "right", unit: null, readOnly: false, options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] };
const width: Field = { id: "width", label: "Width", section: "Size", value: "1.6", unit: "m", readOnly: false, step: 0.01 };
const thickness: Field = { id: "thickness", label: "Thickness", section: "Wall", value: "0.20", unit: "m", readOnly: false, step: 0.05 };

describe("Properties controls (ux-polish item 6)", () => {
  it("Segmented marks the current option pressed; NumberField rounds stepped values to the step's decimals", () => {
    const html = renderToStaticMarkup(<Segmented field={side} disabled={false} onSet={() => {}} />);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('aria-pressed="false"');
    expect(buttons[1]).toContain('aria-pressed="true"');
    const picked: string[] = [];
    call(findAll(Segmented({ field: side, disabled: false, onSet: (v) => picked.push(v) }), (p) => p["data-value"] === "left")[0], "onClick");
    expect(picked).toEqual(["left"]);

    const stepped: string[] = [];
    const up = (f: Field) => call(findAll(NumberField({ field: f, disabled: false, onSet: (v) => stepped.push(v) }), (p) => p["data-step"] === "up")[0], "onClick");
    const down = (f: Field) => call(findAll(NumberField({ field: f, disabled: false, onSet: (v) => stepped.push(v) }), (p) => p["data-step"] === "down")[0], "onClick");
    up(width); // 1.6 + 0.01 is 1.6100000000000001 in floating point
    down(thickness);
    expect(stepped).toEqual(["1.61", "0.15"]);
    const number = renderToStaticMarkup(<NumberField field={width} disabled={false} onSet={() => {}} />);
    expect(number).toMatch(/class="fm-control"[^>]*>.*<span class="fm-unit">m<\/span>/);
  });

  it("Segmented shows its options' text (the opening kinds have their own picker, openkinds.07)", () => {
    const html = renderToStaticMarkup(<Segmented field={side} disabled={false} onSet={() => {}} />);
    expect(html).not.toContain("<svg");
    expect(html).toContain(">Left<");
  });

  it("Switch is a role=switch button that flips its value", () => {
    const off: Field = { id: "glazed", label: "Glazed", section: "Swing", value: "false", unit: null, readOnly: false, toggle: true };
    expect(renderToStaticMarkup(<Switch field={off} disabled={false} onSet={() => {}} />)).toContain('aria-checked="false"');
    const sent: string[] = [];
    call(findAll(Switch({ field: off, disabled: false, onSet: (v) => sent.push(v) }), (p) => p["role"] === "switch")[0], "onClick");
    expect(sent).toEqual(["true"]);
  });

  it("Select renders a native select with every option, the current one selected, Custom disabled, and sends the picked value", () => {
    const preset: Field = {
      id: "preset", label: "Preset", section: "Size", value: "Super king", unit: null, readOnly: false, select: true,
      options: [{ value: "Double", label: "Double 150 × 210" }, { value: "Super king", label: "Super king 190 × 210" }, { value: "custom", label: "Custom", disabled: true }],
    };
    const html = renderToStaticMarkup(<Select field={preset} disabled={false} onSet={() => {}} />);
    expect(html).toContain("<select");
    const options = [...html.matchAll(/<option[^>]*>/g)].map((m) => m[0]);
    expect(options).toHaveLength(3);
    expect(options[1]).toMatch(/value="Super king"[^>]*selected=""|selected=""[^>]*value="Super king"/);
    expect(options[0]).not.toContain("selected");
    expect(options[2]).toMatch(/value="custom"[^>]*disabled=""|disabled=""[^>]*value="custom"/);
    expect(options.slice(0, 2).join("")).not.toContain("disabled");
    const sent: string[] = [];
    let blurs = 0;
    call(findAll(Select({ field: preset, disabled: false, onSet: (v) => sent.push(v) }), (p) => p["data-field-id"] === "preset")[0], "onChange", { currentTarget: { value: "Double", blur: () => { blurs += 1; } } });
    expect(sent).toEqual(["Double"]);
    // Then it gives key focus back (snags.06): the window key listener drops keys aimed at a SELECT, so Cmd+Z would do
    // nothing and a typed letter would pick another preset by type-ahead, a shared edit.
    expect(blurs).toBe(1);
    // react-tree's call() ignores disabled (direct.32), so the prop is asserted.
    expect(findAll(Select({ field: preset, disabled: true, onSet: () => {} }), (p) => p["data-field-id"] === "preset")[0]?.["disabled"]).toBe(true);
  });
});
