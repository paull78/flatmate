import type { Point } from "@fm/protocol";
import type { Command } from "./commands/types";

/**
 * Four addWall commands tracing a width × height rectangle from `origin`, counter-clockwise when
 * width and height are positive (addWall ignores direction). Their operation IDs are
 * `${opPrefix}-1` … `${opPrefix}-4`; the prefix must not already be used in the document, so a
 * second room needs another prefix.
 */
export function rectangleRoom(origin: Point, width: number, height: number, opPrefix = "room"): Command[] {
  const p0 = origin;
  const p1 = { x: origin.x + width, y: origin.y };
  const p2 = { x: origin.x + width, y: origin.y + height };
  const p3 = { x: origin.x, y: origin.y + height };
  const sides: [Point, Point][] = [[p0, p1], [p1, p2], [p2, p3], [p3, p0]];
  return sides.map(([from, to], i): Command => ({
    type: "addWall",
    opId: `${opPrefix}-${i + 1}`,
    from: { at: from },
    to: { at: to },
  }));
}
