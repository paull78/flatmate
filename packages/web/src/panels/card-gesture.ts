// A press on a project card (AC-08): under the slop it's a click that opens the project; from the slop on it's a drag that
// turns the home, and it stays one even if the mouse comes back to where it started. Pure, so tests need no DOM.

export const CLICK_SLOP_PX = 4;

export type CardGesture = { fromX: number; fromY: number; lastX: number; lastY: number; dragging: boolean };

export const press = (x: number, y: number): CardGesture => ({ fromX: x, fromY: y, lastX: x, lastY: y, dragging: false });

/** A pointer move: the gesture after it, and the pixels to turn by, if it's a drag. */
export function moved(g: CardGesture | null, x: number, y: number): { gesture: CardGesture | null; delta: { dx: number; dy: number } | null } {
  if (g === null) return { gesture: null, delta: null };
  if (!g.dragging && Math.hypot(x - g.fromX, y - g.fromY) < CLICK_SLOP_PX) return { gesture: g, delta: null };
  return { gesture: { ...g, lastX: x, lastY: y, dragging: true }, delta: { dx: x - g.lastX, dy: y - g.lastY } };
}

export const release = (g: CardGesture | null): "click" | "drag" | null => (g === null ? null : g.dragging ? "drag" : "click");

/** Only a mouse hovers into 3D (AC-11): touch and pens see the plan, and a tap opens. */
export const hoversIn3d = (a: { pointerType: string; canTurn: boolean; showing3d: boolean; pressed: boolean }): boolean =>
  a.pointerType === "mouse" && a.canTurn && !a.showing3d && !a.pressed;
