import { afterEach, describe, expect, it, vi } from "vitest";
import { keepFocus } from "../src/panels/keep-focus";

// Web tests have no DOM (layout-states.38), so the event and the focused element are plain objects.
class FakeElement {
  order: string[];
  dataset: Record<string, string>;
  constructor(order: string[], dataset: Record<string, string>) {
    this.order = order;
    this.dataset = dataset;
  }
  blur(): void {
    this.order.push("blur");
  }
}

const press = (active: unknown, order: string[]) => ({
  currentTarget: { ownerDocument: { activeElement: active } },
  preventDefault: () => order.push("preventDefault"),
});

describe("keepFocus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blurs a focused draft field first, so its text commits before the click acts", () => {
    vi.stubGlobal("HTMLElement", FakeElement);
    const order: string[] = [];
    keepFocus(press(new FakeElement(order, { draft: "" }), order) as never);
    expect(order).toEqual(["blur", "preventDefault"]);
  });

  it("leaves any other focused element alone: a report's text keeps its focus for the style buttons", () => {
    vi.stubGlobal("HTMLElement", FakeElement);
    const order: string[] = [];
    keepFocus(press(new FakeElement(order, {}), order) as never);
    expect(order).toEqual(["preventDefault"]);
  });

  it("does nothing more with no focused element", () => {
    vi.stubGlobal("HTMLElement", FakeElement);
    const order: string[] = [];
    keepFocus(press(null, order) as never);
    expect(order).toEqual(["preventDefault"]);
  });
});
