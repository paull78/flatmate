// The north dial's arithmetic (sheetset.15; AC-10): pure, as web tests have no DOM (layout-states.38).

const DRAG_STEP = 5;
const whole = (angle: number): number => ((angle % 360) + 360) % 360;

/** The angle at a point off the dial's centre, screen y down, clockwise from up, to the nearest 5°. */
export function angleFromPoint(dx: number, dy: number): number {
  return whole(Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI) / DRAG_STEP) * DRAG_STEP);
}

/** Where an arrow key takes the angle, by 1° or with Shift 15°; from no arrow, it starts at up. Null: not an arrow. */
export function arrowedAngle(current: number | null, key: string, shift: boolean): number | null {
  const step = shift ? 15 : 1;
  if (key === "ArrowRight" || key === "ArrowUp") return whole((current ?? 0) + step);
  if (key === "ArrowLeft" || key === "ArrowDown") return whole((current ?? 0) - step);
  return null;
}

/** What a typed angle sends: blank sends nothing, as only the switch clears; whole digits lose their padding; anything else goes as typed, for the domain to refuse with its reason. */
export function typedNorth(text: string): string | null {
  const typed = text.trim();
  if (typed === "") return null;
  return /^\d+$/.test(typed) ? String(Number(typed)) : typed;
}
