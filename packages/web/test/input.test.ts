import { describe, expect, it } from "vitest";
import { NO_MODS } from "@fm/editor";
import type { Event as EditorEvent } from "@fm/editor";
import {
  canvasPoint,
  droppedFile,
  focusOnMount,
  focusOnPress,
  heldButton,
  isEditableTarget,
  keyEvent,
  normalizeKey,
  pointerEvent,
  pressButton,
  refuseInput,
  routeKey,
  shouldPreventDefault,
  toMods,
  wheelEvent,
  focusLoss,
  lostEscape,
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

  it("a comma and a minus survive Shift, and the numpad's operators pass (typed-input.06, AC-01)", () => {
    const key = (k: string, code: string, shiftKey = true) => keyEvent({ ...NO_DOM_MODS, shiftKey, key: k, code, repeat: false });
    expect(key(";", "Comma")).toMatchObject({ key: "," }); // Italian
    expect(key("<", "Comma")).toMatchObject({ key: "," }); // US
    expect(key("_", "Slash")).toMatchObject({ key: "-" }); // Italian
    expect(key("_", "Minus")).toMatchObject({ key: "-" }); // US
    expect(key("/", "NumpadDivide", false)).toMatchObject({ key: "/" });
    expect(key("*", "NumpadMultiply", false)).toMatchObject({ key: "*" });
    expect(key("+", "NumpadAdd", false)).toMatchObject({ key: "+" });
    expect(key("-", "NumpadSubtract", false)).toMatchObject({ key: "-" });
    // Shift + a digit key stays a digit on both layouts, whatever symbol sits above it.
    for (const [symbol, code, digit] of [["/", "Digit7", "7"], ["(", "Digit8", "8"], [")", "Digit9", "9"], ["*", "Digit8", "8"], ["(", "Digit9", "9"], [")", "Digit0", "0"], [":", "Period", "."]] as const) {
      expect(key(symbol, code)).toMatchObject({ key: digit });
    }
  });

  it("types digits while Shift is held (Try it step 2)", () => {
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

  it("reads the key that types ' as a foot mark with Shift held, where Shift makes it ? (feet.05)", () => {
    expect(normalizeKey("?", "Minus")).toBe("'"); // an Italian keyboard: ' and ? share the key after 0
    expect(normalizeKey("'", "Minus")).toBe("'");
    expect(normalizeKey("?", "Slash")).toBe("?"); // a US keyboard's ? is untouched
    expect(normalizeKey("_", "Minus")).toBe("-"); // a US minus with Shift, as before
    expect(normalizeKey('"', "Quote")).toBe('"');
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
    expect(shouldPreventDefault("ArrowRight", NO_MODS)).toBe(true); // the nudge, not a page scroll (AC-10)
    expect(shouldPreventDefault("ArrowLeft", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("ArrowDown", NO_MODS)).toBe(true);
    expect(shouldPreventDefault("ArrowUp", { ...NO_MODS, shift: true })).toBe(true);
    expect(shouldPreventDefault("w", NO_MODS)).toBe(false);
    expect(shouldPreventDefault("Escape", NO_MODS)).toBe(false);
    expect(shouldPreventDefault("z", { ...NO_MODS, meta: true })).toBe(true);
    expect(shouldPreventDefault("Z", { ...NO_MODS, meta: true, shift: true })).toBe(true);
    expect(shouldPreventDefault("s", { ...NO_MODS, ctrl: true })).toBe(true);
    expect(shouldPreventDefault("c", { ...NO_MODS, meta: true })).toBe(false);
    expect(shouldPreventDefault("d", { ...NO_MODS, meta: true })).toBe(true); // duplicate, not a bookmark (AC-11)
    expect(shouldPreventDefault("D", { ...NO_MODS, ctrl: true, shift: true })).toBe(true);
    expect(shouldPreventDefault("d", NO_MODS)).toBe(false); // plain D picks the Opening tool
  });
});

describe("droppedFile", () => {
  it("takes the first file of a drop", () => {
    expect(droppedFile({ files: ["a.png", "b.png"] })).toBe("a.png");
    expect(droppedFile({ files: [] })).toBeNull();
    expect(droppedFile(null)).toBeNull(); // a text drag has no files to read
  });
});

// The value input (C6, tidy.14): a hidden input marked `data-editor-keys` holds the focus while a value field is open.
const VALUE_INPUT = { tagName: "INPUT", dataset: { editorKeys: "" } };
const PANEL_FIELD = { tagName: "INPUT", dataset: {} };
const CANVAS = { tagName: "CANVAS" };

function keyDown(target: object | null, key: string, code: string, mods: Partial<typeof NO_DOM_MODS> = {}) {
  const e = { ...NO_DOM_MODS, ...mods, target, key, code, repeat: false, prevented: false, preventDefault: () => (e.prevented = true) };
  return e;
}

function route(target: object | null, key: string, code: string, mods: Partial<typeof NO_DOM_MODS> = {}) {
  const sent: EditorEvent[] = [];
  const e = keyDown(target, key, code, mods);
  routeKey(e, (ev) => sent.push(ev));
  return { sent, prevented: e.prevented };
}

describe("the value input", () => {
  it("keys aimed at the value input reach the editor", () => {
    expect(isEditableTarget(VALUE_INPUT)).toBe(false);
    expect(route(VALUE_INPUT, "3", "Digit3").sent).toEqual([{ type: "key", key: "3", mods: NO_MODS }]);
    expect(route(VALUE_INPUT, "Escape", "Escape").sent).toEqual([{ type: "key", key: "Escape", mods: NO_MODS }]);
    expect(route(VALUE_INPUT, "z", "KeyZ", { metaKey: true }).sent).toEqual([{ type: "key", key: "z", mods: { ...NO_MODS, meta: true } }]);
    expect(route(PANEL_FIELD, "3", "Digit3").sent).toEqual([]); // a panel's field keeps its keys
    expect(route(CANVAS, "3", "Digit3").sent).toEqual([{ type: "key", key: "3", mods: NO_MODS }]);
  });

  it("printable keys, Backspace and Delete on the value input have their default prevented; Cmd+R doesn't", () => {
    for (const [key, code] of [["3", "Digit3"], [".", "Period"], ["a", "KeyA"], [" ", "Space"], ["Backspace", "Backspace"], ["Delete", "Delete"]] as const) {
      expect(route(VALUE_INPUT, key, code).prevented, key).toBe(true);
      expect(route(VALUE_INPUT, key, code, { shiftKey: true }).prevented, `Shift+${key}`).toBe(true);
    }
    expect(route(VALUE_INPUT, "r", "KeyR", { metaKey: true }).prevented).toBe(false); // reload
    expect(route(VALUE_INPUT, "i", "KeyI", { metaKey: true, altKey: true }).prevented).toBe(false); // devtools
    expect(route(VALUE_INPUT, "π", "KeyP", { altKey: true }).prevented).toBe(false);
    expect(route(VALUE_INPUT, "Delete", "Delete", { ctrlKey: true }).prevented).toBe(false);
    expect(route(VALUE_INPUT, "F12", "F12").prevented).toBe(false);
    expect(route(VALUE_INPUT, "Escape", "Escape").prevented).toBe(false);
    expect(route(VALUE_INPUT, "Tab", "Tab").prevented).toBe(false);
    // today's handling for the rest
    expect(route(VALUE_INPUT, "Enter", "Enter").prevented).toBe(true);
    expect(route(VALUE_INPUT, "z", "KeyZ", { metaKey: true }).prevented).toBe(true);
    expect(route(VALUE_INPUT, "ArrowLeft", "ArrowLeft").prevented).toBe(true);
    // elsewhere, printable keys keep their default as today
    expect(route(CANVAS, "3", "Digit3").prevented).toBe(false);
    expect(route(null, "Delete", "Delete").prevented).toBe(false);
  });

  it("beforeinput on the value input is cancelled", () => {
    const on = (target: object | null) => {
      const e = { target, prevented: false, preventDefault: () => (e.prevented = true) };
      refuseInput(e);
      return e.prevented;
    };
    expect(on(VALUE_INPUT)).toBe(true);
    expect(on(PANEL_FIELD)).toBe(false);
    expect(on(null)).toBe(false);
  });

  function element(name: string, log: string[]) {
    return { name, focus: () => log.push(`focus ${name}`), blur: () => log.push(`blur ${name}`) };
  }

  it("a canvas press focuses the value input when one is mounted, and blurs other elements otherwise", () => {
    const log: string[] = [];
    const body = element("body", log);
    const field = element("thickness", log);
    const input = element("value", log);
    focusOnPress(field, body, input);
    expect(log).toEqual(["focus value"]);
    log.length = 0;
    focusOnPress(field, body, null);
    expect(log).toEqual(["blur thickness"]);
    log.length = 0;
    focusOnPress(body, body, null);
    focusOnPress(null, body, null);
    expect(log).toEqual([]);
  });

  it("the mounted input doesn't take focus from another editable element", () => {
    const log: string[] = [];
    const body = element("body", log);
    const input = element("value", log);
    focusOnMount(input, element("thickness", log), body);
    expect(log).toEqual([]);
    focusOnMount(input, body, body);
    focusOnMount(input, null, body);
    expect(log).toEqual(["focus value", "focus value"]);
  });
});

describe("Escape taken by a keyboard extension (tidy.42)", () => {
  it("the value input losing the focus with no press, the window still focused, is Escape", () => {
    expect(focusLoss(true, false, true)).toBe("escape");
  });

  it("a press in progress or another window taking the focus means nothing; a panel field hands the focus back", () => {
    expect(focusLoss(true, true, true)).toBe("none");
    expect(focusLoss(true, false, false)).toBe("none");
    expect(focusLoss(false, false, true)).toBe("handBack");
    expect(focusLoss(false, true, true)).toBe("none");
  });

  it("an Escape keyup on the value input whose keydown never arrived is Escape; with its keydown, or elsewhere, nothing", () => {
    const valueInput = { dataset: { editorKeys: "" } };
    const panelField = { tagName: "INPUT", dataset: {} };
    expect(lostEscape("Escape", valueInput, false)).toBe(true);
    expect(lostEscape("Escape", valueInput, true)).toBe(false);
    expect(lostEscape("Escape", panelField, false)).toBe(false);
    expect(lostEscape("Enter", valueInput, false)).toBe(false);
  });
});

describe("the sheets view's keys (sheetset.14)", () => {
  const inView = (tagName: string, type?: string) => ({
    tagName,
    type,
    dataset: {},
    closest: (selector: string) => (selector === "[data-sheets-view]" || selector === "[data-own-keys]" ? {} : null),
  });
  const META = { metaKey: true };

  it("⌘Z and ⌘⇧Z and Escape leave it to the editor, from a button, a list or a checkbox", () => {
    for (const target of [inView("BUTTON"), inView("SELECT"), inView("INPUT", "checkbox"), inView("SECTION")]) {
      expect(route(target, "z", "KeyZ", META).sent).toEqual([{ type: "key", key: "z", mods: { shift: false, ctrl: false, alt: false, meta: true } }]);
      expect(route(target, "z", "KeyZ", META).prevented).toBe(true);
      expect(route(target, "Z", "KeyZ", { metaKey: true, shiftKey: true }).sent).toHaveLength(1);
      expect(route(target, "z", "KeyZ", { ctrlKey: true }).sent).toHaveLength(1);
      expect(route(target, "Escape", "Escape").sent).toHaveLength(1);
    }
  });

  it("in a text box they're that box's", () => {
    for (const target of [inView("TEXTAREA"), inView("INPUT", "text"), inView("INPUT", "number")]) {
      for (const [key, code, mods] of [["z", "KeyZ", META], ["Escape", "Escape", {}]] as const) {
        const r = route(target, key, code, mods);
        expect(r.sent).toEqual([]);
        expect(r.prevented).toBe(false);
      }
    }
  });

  it("any other key stays in the view: V, Delete, an arrow, Enter on a button", () => {
    for (const [key, code] of [["v", "KeyV"], ["Delete", "Delete"], ["ArrowLeft", "ArrowLeft"], ["Enter", "Enter"], [" ", "Space"]] as const) {
      const r = route(inView("BUTTON"), key, code);
      expect(r.sent).toEqual([]);
      expect(r.prevented).toBe(false);
    }
  });

  it("another panel that owns its keys keeps its ⌘Z", () => {
    const inList = { closest: (selector: string) => (selector === "[data-own-keys]" ? {} : null) };
    expect(route(inList, "z", "KeyZ", META).sent).toEqual([]);
  });
});

describe("a panel that owns its keys (AC-11)", () => {
  const inList = { closest: (selector: string) => (selector === "[data-own-keys]" ? {} : null) };
  const elsewhere = { closest: () => null };

  it("keeps Enter and Space from the editor, so its buttons work", () => {
    for (const [key, code] of [["Enter", "Enter"], [" ", "Space"], ["Delete", "Delete"]] as const) {
      const r = route(inList, key, code);
      expect(r.prevented).toBe(false);
      expect(r.sent).toEqual([]);
    }
  });

  it("leaves the rest of the app as it was", () => {
    expect(route(elsewhere, "Enter", "Enter").prevented).toBe(true);
    expect(route(null, "Enter", "Enter").prevented).toBe(true);
  });
});
