import { describe, expect, it } from "vitest";
import { NO_MODS } from "@fm/editor";
import {
  canvasPoint,
  heldButton,
  isEditableTarget,
  keyEvent,
  normalizeKey,
  pointerEvent,
  pressButton,
  shouldPreventDefault,
  toMods,
  wheelEvent,
} from "../src/adapters/input";

const NO_DOM_MODS = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
const RECT = { left: 10, top: 20 };

describe("toMods", () => {
  it("maps DOM modifier flags", () => {
    expect(toMods({ shiftKey: true, ctrlKey: false, altKey: true, metaKey: false })).toEqual({
      shift: true,
      ctrl: false,
      alt: true,
      meta: false,
    });
  });
});

describe("buttons", () => {
  it("maps pressed buttons and ignores back/forward", () => {
    expect(pressButton(0)).toBe(0);
    expect(pressButton(1)).toBe(1);
    expect(pressButton(2)).toBe(2);
    expect(pressButton(3)).toBeNull();
    expect(pressButton(4)).toBeNull();
  });

  it("derives the held button during a move, middle first", () => {
    expect(heldButton(0)).toBe(0);
    expect(heldButton(1)).toBe(0);
    expect(heldButton(2)).toBe(2);
    expect(heldButton(4)).toBe(1);
    expect(heldButton(5)).toBe(1);
  });
});

describe("pointerEvent", () => {
  it("uses canvas-relative CSS pixels", () => {
    expect(canvasPoint({ clientX: 110, clientY: 70 }, RECT)).toEqual({ x: 100, y: 50 });
  });

  it("maps a left press", () => {
    const e = pointerEvent("pointerDown", { ...NO_DOM_MODS, clientX: 110, clientY: 70, button: 0, buttons: 1 }, RECT);
    expect(e).toEqual({ type: "pointerDown", screen: { x: 100, y: 50 }, mods: NO_MODS, button: 0 });
  });

  it("maps a middle press and carries Shift", () => {
    const e = pointerEvent("pointerDown", { ...NO_DOM_MODS, shiftKey: true, clientX: 10, clientY: 20, button: 1, buttons: 4 }, RECT);
    expect(e).toEqual({ type: "pointerDown", screen: { x: 0, y: 0 }, mods: { ...NO_MODS, shift: true }, button: 1 });
  });

  it("ignores back and forward buttons", () => {
    expect(pointerEvent("pointerDown", { ...NO_DOM_MODS, clientX: 0, clientY: 0, button: 3, buttons: 8 }, RECT)).toBeNull();
  });

  it("takes the move button from the buttons bitmask", () => {
    const e = pointerEvent("pointerMove", { ...NO_DOM_MODS, clientX: 20, clientY: 30, button: -1, buttons: 4 }, RECT);
    expect(e).toEqual({ type: "pointerMove", screen: { x: 10, y: 10 }, mods: NO_MODS, button: 1 });
    const hover = pointerEvent("pointerMove", { ...NO_DOM_MODS, clientX: 20, clientY: 30, button: -1, buttons: 0 }, RECT);
    expect(hover).toEqual({ type: "pointerMove", screen: { x: 10, y: 10 }, mods: NO_MODS, button: 0 });
  });
});

describe("wheelEvent", () => {
  it("passes pixel deltas through and keeps Ctrl (trackpad pinch)", () => {
    const e = wheelEvent({ ...NO_DOM_MODS, ctrlKey: true, clientX: 60, clientY: 70, deltaX: 0, deltaY: -12.5, deltaMode: 0 }, RECT);
    expect(e).toEqual({ type: "wheel", screen: { x: 50, y: 50 }, deltaX: 0, deltaY: -12.5, mods: { ...NO_MODS, ctrl: true } });
  });

  it("converts line deltas to pixels", () => {
    const e = wheelEvent({ ...NO_DOM_MODS, clientX: 10, clientY: 20, deltaX: 1, deltaY: 3, deltaMode: 1 }, RECT);
    expect(e).toEqual({ type: "wheel", screen: { x: 0, y: 0 }, deltaX: 16, deltaY: 48, mods: NO_MODS });
  });
});

describe("keys", () => {
  it("passes ordinary keys through verbatim", () => {
    expect(keyEvent({ ...NO_DOM_MODS, key: "w", code: "KeyW", repeat: false })).toEqual({ type: "key", key: "w", mods: NO_MODS });
    expect(keyEvent({ ...NO_DOM_MODS, key: "Enter", code: "Enter", repeat: false })).toEqual({ type: "key", key: "Enter", mods: NO_MODS });
    expect(keyEvent({ ...NO_DOM_MODS, key: " ", code: "Space", repeat: false })).toEqual({ type: "key", key: " ", mods: NO_MODS });
  });

  it("types digits while Shift is held (demo step 2)", () => {
    expect(keyEvent({ ...NO_DOM_MODS, shiftKey: true, key: "^", code: "Digit6", repeat: false })).toEqual({
      type: "key",
      key: "6",
      mods: { ...NO_MODS, shift: true },
    });
  });

  it("maps digit and decimal codes on any layout", () => {
    expect(normalizeKey("&", "Digit1")).toBe("1");
    expect(normalizeKey("4", "Numpad4")).toBe("4");
    expect(normalizeKey(">", "Period")).toBe(".");
    expect(normalizeKey(",", "NumpadDecimal")).toBe(".");
    expect(normalizeKey("z", "KeyZ")).toBe("z");
  });

  it("drops auto-repeated modifier keys but keeps other repeats", () => {
    expect(keyEvent({ ...NO_DOM_MODS, shiftKey: true, key: "Shift", code: "ShiftLeft", repeat: true })).toBeNull();
    expect(keyEvent({ ...NO_DOM_MODS, key: "Backspace", code: "Backspace", repeat: true })).toEqual({
      type: "key",
      key: "Backspace",
      mods: NO_MODS,
    });
  });

  it("recognises editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({})).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "CANVAS" })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("prevents browser defaults only for keys the browser would act on", () => {
    expect(shouldPreventDefault(" ", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("Backspace", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("Enter", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("w", NO_MODS)).toBe(false);
    expect(shouldPreventDefault("Escape", NO_MODS)).toBe(false);
    expect(shouldPreventDefault("z", { ...NO_MODS, meta: true })).toBe(true);
    expect(shouldPreventDefault("Z", { ...NO_MODS, meta: true, shift: true })).toBe(true);
    expect(shouldPreventDefault("s", { ...NO_MODS, ctrl: true })).toBe(true);
    expect(shouldPreventDefault("c", { ...NO_MODS, meta: true })).toBe(false);
  });
});
