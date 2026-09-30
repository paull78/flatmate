import type { Event as EditorEvent, Mods } from "@fm/editor";
import type { Point } from "@fm/protocol";

export type ModifierSource = { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean };
type PointerSource = ModifierSource & { clientX: number; clientY: number; button: number; buttons: number };
type WheelSource = ModifierSource & { clientX: number; clientY: number; deltaX: number; deltaY: number; deltaMode: number };
type KeySource = ModifierSource & { key: string; code: string; repeat: boolean };
type Rect = { left: number; top: number };

export function toMods(e: ModifierSource): Mods {
  return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

/** DOM `button` of a press or release → editor button; back/forward buttons are ignored. */
export function pressButton(button: number): 0 | 1 | 2 | null {
  switch (button) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return null;
  }
}

/** DOM `buttons` bitmask during a move → the held button; middle wins so a middle-drag pans. */
export function heldButton(buttons: number): 0 | 1 | 2 {
  if ((buttons & 4) !== 0) return 1;
  if ((buttons & 2) !== 0) return 2;
  return 0;
}

/** CSS pixels relative to the canvas's top-left corner. World coordinates are the editor's job. */
export function canvasPoint(e: { clientX: number; clientY: number }, rect: Rect): Point {
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function pointerEvent(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  e: PointerSource,
  rect: Rect,
): EditorEvent | null {
  const button = type === "pointerMove" ? heldButton(e.buttons) : pressButton(e.button);
  if (button === null) return null;
  return { type, screen: canvasPoint(e, rect), mods: toMods(e), button };
}

const LINE_PX = 16;
const PAGE_PX = 800;

export function wheelEvent(e: WheelSource, rect: Rect): EditorEvent {
  const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  return {
    type: "wheel",
    screen: canvasPoint(e, rect),
    deltaX: e.deltaX * scale,
    deltaY: e.deltaY * scale,
    mods: toMods(e),
  };
}

/**
 * Typed lengths must work while Shift is held (demo step 2) and on non-US layouts:
 * digit and decimal keys are identified by their physical code; other keys pass through verbatim.
 */
export function normalizeKey(key: string, code: string): string {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit !== null && digit[1] !== undefined) return digit[1];
  if (code === "Period" || code === "NumpadDecimal") return ".";
  return key;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function keyEvent(e: KeySource): EditorEvent | null {
  if (e.repeat && MODIFIER_KEYS.has(e.key)) return null;
  return { type: "key", key: normalizeKey(e.key, e.code), mods: toMods(e) };
}

/** Keys typed into panel inputs belong to the input, not to the editor. */
export function isEditableTarget(target: object | null): boolean {
  if (target === null) return false;
  if ("isContentEditable" in target && target.isContentEditable === true) return true;
  if (!("tagName" in target) || typeof target.tagName !== "string") return false;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Only keys the browser would otherwise act on: scrolling, navigation, activation, undo and save. */
export function shouldPreventDefault(key: string, mods: Mods): boolean {
  if (mods.meta || mods.ctrl) {
    const k = key.toLowerCase();
    return k === "z" || k === "y" || k === "s";
  }
  return key === " " || key === "Backspace" || key === "Enter";
}

/** Wires DOM input on the canvas (and keys on window) to editor events. Returns a detach function. */
export function attachInput(canvas: HTMLCanvasElement, dispatch: (e: EditorEvent) => void): () => void {
  const rect = (): DOMRect => canvas.getBoundingClientRect();
  const send = (e: EditorEvent | null): void => {
    if (e !== null) dispatch(e);
  };

  const onPointerDown = (e: PointerEvent): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    if (e.button === 1) e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    send(pointerEvent("pointerDown", e, rect()));
  };
  const onPointerMove = (e: PointerEvent): void => {
    send(pointerEvent("pointerMove", e, rect()));
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    send(pointerEvent("pointerUp", e, rect()));
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    send(wheelEvent(e, rect()));
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) return;
    if (shouldPreventDefault(e.key, toMods(e))) e.preventDefault();
    send(keyEvent(e));
  };
  const onResize = (): void => {
    const r = rect();
    dispatch({ type: "viewportResized", size: { width: r.width, height: r.height }, devicePixelRatio: window.devicePixelRatio });
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  const observer = new ResizeObserver(onResize);
  observer.observe(canvas);
  onResize();

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    observer.disconnect();
  };
}
