import { NO_MODS, type Event as EditorEvent, type Mods } from "@fm/editor";
import { isQuickAddShortcut } from "../panels/quick-add";
import type { Point } from "@fm/protocol";

type ModifierSource = { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean };
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
 * Typed lengths must work while Shift is held (Try it step 2) and on non-US layouts:
 * digit and decimal keys are identified by their physical code, and Shift's "_" reads as a minus; other keys pass
 * through verbatim.
 */
export function normalizeKey(key: string, code: string): string {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit !== null && digit[1] !== undefined) return digit[1];
  if (code === "Period" || code === "NumpadDecimal") return ".";
  if (code === "Comma") return ","; // Shift gives ";" or "<"; the value field would drop it, so 2,8 would commit 28
  if (key === "?" && code === "Minus") return "'"; // an Italian ' with Shift held: a foot mark (feet.05)
  return key === "_" ? "-" : key; // the same for a minus typed with Shift held
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function keyEvent(e: KeySource): EditorEvent | null {
  if (e.repeat && MODIFIER_KEYS.has(e.key)) return null;
  return { type: "key", key: normalizeKey(e.key, e.code), mods: toMods(e) };
}

/** An element marked `data-editor-keys` (the hidden value input, tidy.14) sends its keys to the editor. */
export function sendsKeysToEditor(target: object | null): boolean {
  if (target === null || !("dataset" in target)) return false;
  const data = target.dataset;
  return typeof data === "object" && data !== null && "editorKeys" in data;
}

/** Keys typed into panel inputs belong to the input, not to the editor. */
export function isEditableTarget(target: object | null): boolean {
  if (target === null || sendsKeysToEditor(target)) return false;
  if ("isContentEditable" in target && target.isContentEditable === true) return true;
  if (!("tagName" in target) || typeof target.tagName !== "string") return false;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** A panel marked `data-own-keys` keeps every key, so Enter and Space work its buttons: the project list, with no drawing to edit (AC-11). */
export function ownsKeys(target: object | null): boolean {
  if (target === null || !("closest" in target) || typeof target.closest !== "function") return false;
  return target.closest("[data-own-keys]") !== null;
}

const NOT_TYPED_INTO = new Set(["checkbox", "radio", "button", "range", "color"]);

/** A box typed into: its own text undo holds there (sheetset.14). A checkbox or a list isn't one. */
function isTextBox(target: object | null): boolean {
  if (target === null || !isEditableTarget(target)) return false;
  const tag = "tagName" in target && typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
  if (tag === "SELECT") return false;
  return !(tag === "INPUT" && "type" in target && NOT_TYPED_INTO.has(String(target.type)));
}

/** Undo, redo and leaving get out of the sheets view to the editor, as they'd stop at its `data-own-keys`, unless a text box has them. */
export function sheetsViewPasses(target: object | null, key: string, mods: Mods): boolean {
  if (target === null || !("closest" in target) || typeof target.closest !== "function") return false;
  if (target.closest("[data-sheets-view]") === null || isTextBox(target)) return false;
  return key === "Escape" || ((mods.meta || mods.ctrl) && key.toLowerCase() === "z");
}

/**
 * Only keys the browser would otherwise act on: scrolling (the arrows nudge, AC-10), navigation, activation, undo,
 * save and bookmark (Cmd/Ctrl+D duplicates, AC-11).
 */
export function shouldPreventDefault(key: string, mods: Mods): boolean {
  if (mods.meta || mods.ctrl) {
    const k = key.toLowerCase();
    return k === "z" || k === "y" || k === "s" || k === "d";
  }
  return key === " " || key === "Backspace" || key === "Enter" || ARROW_KEYS.has(key);
}

/** Keys that would edit the value input: it stays empty, the editor holds the typed text (tidy.14). */
function editsField(key: string, mods: Mods): boolean {
  if (mods.ctrl || mods.meta || mods.alt) return false;
  return key.length === 1 || key === "Backspace" || key === "Delete";
}

type KeyDownSource = KeySource & { target: object | null; preventDefault(): void };

/** The window's keydown: a panel field keeps its keys; every other key, the value input's included, goes to the editor. */
export function routeKey(e: KeyDownSource, dispatch: (e: EditorEvent) => void): void {
  const mods = toMods(e);
  if (!sheetsViewPasses(e.target, e.key, mods) && (isEditableTarget(e.target) || ownsKeys(e.target))) return;
  if (shouldPreventDefault(e.key, mods) || (sendsKeysToEditor(e.target) && editsField(e.key, mods))) e.preventDefault();
  const event = keyEvent(e);
  if (event !== null) dispatch(event);
}

/** Nothing fills the value input by itself: IME, `insertText` or dropped text (tidy.14). */
export function refuseInput(e: { target: object | null; preventDefault(): void }): void {
  if (sendsKeysToEditor(e.target)) e.preventDefault();
}

// preventScroll: the 1 px input sits in the hint line, which clips its overflow; focusing it must not scroll that.
type Focusable = { focus(options?: { preventScroll?: boolean }): void; blur(): void };

/** A canvas press focuses the value input when one is mounted; otherwise it blurs a focused panel field, as before. */
export function focusOnPress(active: Focusable | null, body: unknown, valueInput: Focusable | null): void {
  if (valueInput !== null) valueInput.focus({ preventScroll: true });
  else if (active !== null && active !== body) active.blur();
}

/**
 * What a focus loss to nothing means (tidy.42). A keyboard extension in "insert mode" stops Escape in a text field and
 * blurs it, so the editor never sees the key: the value input losing the focus with no pointer press in progress, while
 * the window keeps it, is that Escape. A panel field letting the focus go (DraftInput blurs on Enter) hands it back to
 * the value input (tidy.27). A press or a switch to another window means neither.
 */
export function focusLoss(fromValueInput: boolean, pressing: boolean, windowFocused: boolean): "escape" | "handBack" | "none" {
  if (pressing || !windowFocused) return "none";
  return fromValueInput ? "escape" : "handBack";
}

/** An Escape keyup on the value input whose keydown never arrived: an extension swallowed it, the editor still gets it. */
export function lostEscape(key: string, target: object | null, sawKeyDown: boolean): boolean {
  return key === "Escape" && !sawKeyDown && sendsKeysToEditor(target);
}

/** A newly mounted value input takes the focus only if nothing has it, so a Thickness field being typed in keeps it. */
export function focusOnMount(input: Focusable, active: unknown, body: unknown): void {
  if (active === null || active === body) input.focus({ preventScroll: true });
}

/** The file a drop brings: only the first one counts; a text drag has no files. */
export function droppedFile<T>(dt: { files: ArrayLike<T> } | null): T | null {
  if (dt === null || dt.files.length === 0) return null;
  return dt.files[0] ?? null;
}

/**
 * Wires DOM input on the canvas (and keys on window) to editor events. A file dropped on the canvas goes to `onFile`
 * (the underlay importer, import.15); the drop point is ignored. Returns a detach function.
 */
export function attachInput(canvas: HTMLCanvasElement, dispatch: (e: EditorEvent) => void, onFile?: (file: File) => void): () => void {
  const rect = (): DOMRect => canvas.getBoundingClientRect();
  const send = (e: EditorEvent | null): void => {
    if (e !== null) dispatch(e);
  };

  const valueInput = (): HTMLElement | null => {
    const el = document.querySelector("[data-editor-keys]");
    return el instanceof HTMLElement ? el : null;
  };
  const onPointerDown = (e: PointerEvent): void => {
    // Chromium's mousedown would otherwise move the focus to the body, away from the value input; this also keeps a
    // middle press from starting autoscroll.
    e.preventDefault();
    const active = document.activeElement;
    focusOnPress(active instanceof HTMLElement ? active : null, document.body, valueInput());
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
  // Leaving the canvas drops hover previews (the Object ghost, the Opening preview); under pointer capture it fires
  // only after the release.
  const onPointerLeave = (): void => {
    dispatch({ type: "pointerLeave" });
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    send(wheelEvent(e, rect()));
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };
  let sawEscapeDown = false;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") sawEscapeDown = true;
    if (isQuickAddShortcut(e.key, toMods(e), isEditableTarget(e.target), sendsKeysToEditor(e.target))) {
      e.preventDefault(); // "/" and Ctrl/⌘+K focus quick add's field (quick-add.07)
      const field = document.querySelector("[data-quick-add]");
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    routeKey(e, dispatch);
  };
  const escape = (): void => dispatch({ type: "key", key: "Escape", mods: NO_MODS });
  const onKeyUp = (e: KeyboardEvent): void => {
    if (lostEscape(e.key, e.target, sawEscapeDown)) escape();
    if (e.key === "Escape") sawEscapeDown = false;
  };
  // A press anywhere in the page (a panel, the canvas) explains a focus loss; an extension's blur comes without one.
  let pressing = false;
  const onAnyPointerDown = (): void => {
    pressing = true;
  };
  const onAnyPointerUp = (): void => {
    pressing = false;
  };
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "none";
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const file = droppedFile(e.dataTransfer);
    if (file !== null) onFile?.(file);
  };
  // Anything dropped off the canvas (a file or a link, on the floating bar, say) would otherwise open in place of the
  // app; the "none" cursor shows it isn't a drop target. Only a text drag over a panel's field passes, so the field
  // still takes a dropped word.
  const onStrayDrop = (e: DragEvent): void => {
    if (e.target === canvas) return;
    const files = e.dataTransfer?.types.includes("Files") === true;
    if (!files && isEditableTarget(e.target)) return;
    e.preventDefault();
    if (e.type === "dragover" && e.dataTransfer !== null) e.dataTransfer.dropEffect = "none";
  };
  // A panel field that lets the focus go to nothing (DraftInput blurs on Enter) hands it back to an open value input,
  // so a length typed next, with no canvas press, is still out of keyboard extensions' reach (tidy.27). After the
  // blur settles: during focusout, activeElement is still the field.
  const onFocusOut = (e: FocusEvent): void => {
    if (e.relatedTarget !== null) return;
    const fromValueInput = sendsKeysToEditor(e.target);
    const wasPressing = pressing;
    setTimeout(() => {
      const input = valueInput();
      if (input === null) return;
      const loss = focusLoss(fromValueInput, wasPressing, document.hasFocus());
      const nothingFocused = document.activeElement === null || document.activeElement === document.body;
      if (loss === "escape" && nothingFocused) escape();
      else if (loss === "handBack") focusOnMount(input, document.activeElement, document.body);
    }, 0);
  };
  // The value input mounts when React renders a value field open (drawing → paused → drawing on each shared segment).
  let mounted: HTMLElement | null = null;
  const onMutation = (): void => {
    const input = valueInput();
    if (input !== null && input !== mounted) focusOnMount(input, document.activeElement, document.body);
    mounted = input;
  };
  const onResize = (): void => {
    const r = rect();
    dispatch({ type: "viewportResized", size: { width: r.width, height: r.height }, devicePixelRatio: window.devicePixelRatio });
  };
  // A new devicePixelRatio with the same CSS size (the window moved to another screen) fires no ResizeObserver. A media
  // query on the current ratio fires once when it changes; it is then set again at the new ratio.
  let ratio: MediaQueryList | null = null;
  const watchRatio = (): void => {
    ratio?.removeEventListener("change", onRatio);
    ratio = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    ratio.addEventListener("change", onRatio);
  };
  const onRatio = (): void => {
    onResize();
    watchRatio();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("dragover", onDragOver);
  canvas.addEventListener("drop", onDrop);
  window.addEventListener("dragover", onStrayDrop);
  window.addEventListener("drop", onStrayDrop);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeinput", refuseInput);
  window.addEventListener("focusout", onFocusOut);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointerdown", onAnyPointerDown, true);
  window.addEventListener("pointerup", onAnyPointerUp, true);
  window.addEventListener("pointercancel", onAnyPointerUp, true);
  const mutations = new MutationObserver(onMutation);
  mutations.observe(document.body, { childList: true, subtree: true });
  const observer = new ResizeObserver(onResize);
  observer.observe(canvas);
  watchRatio();
  onResize();

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("dragover", onDragOver);
    canvas.removeEventListener("drop", onDrop);
    window.removeEventListener("dragover", onStrayDrop);
    window.removeEventListener("drop", onStrayDrop);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("beforeinput", refuseInput);
    window.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("pointerdown", onAnyPointerDown, true);
    window.removeEventListener("pointerup", onAnyPointerUp, true);
    window.removeEventListener("pointercancel", onAnyPointerUp, true);
    mutations.disconnect();
    observer.disconnect();
    ratio?.removeEventListener("change", onRatio);
  };
}
