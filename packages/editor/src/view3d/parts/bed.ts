import { bedPillows } from "../../view/piece-counts";
import { box, capped, legs, spans } from "./sizes";
import type { Part } from "./types";

// A bed's body (parts steps 03 and 06), shared by the bed, lift bed, mattress, loft bed, sofa bed and Murphy bed: an
// optional headboard at the back reaching the top, legs (four, two at the front, or none), an optional frame, the
// mattress, and the plan's pillows at the head (bedPillows). Without a headboard the pillows reach the top.

/** `pillowsFor`: the width the plan counts pillows on, when the bed is narrower than the piece (bedPillows). */
export type BedOptions = { legs: "four" | "front" | "none"; headboard: boolean; frame: boolean; pillowsFor?: number };

export function bedBody(w: number, d: number, h: number, o: BedOptions): Part[] {
  const head = o.headboard ? capped(0.05, 0.1, d) : 0;
  const back = d / 2 - head;
  const legH = o.legs === "none" ? 0 : capped(0.12, 0.15, h);
  const frameTop = o.frame ? legH + capped(0.15, o.headboard ? 0.15 : 0.35, h) : 0;
  const pillowT = capped(0.1, o.headboard ? 0.1 : 0.3, h);
  const mattressTop = o.headboard ? frameTop + capped(0.2, 0.25, h) : h - pillowT;
  const pillowTop = o.headboard ? mattressTop + pillowT : h;
  const pillowD = capped(0.4, 0.2, d);
  const gap = capped(0.05, 0.05, w);
  const pillows = bedPillows(o.pillowsFor ?? w) === 1
    ? [box("linen", -capped(0.5, 0.6, w) / 2, capped(0.5, 0.6, w) / 2, back - pillowD, back, mattressTop, pillowTop)]
    : spans(-w / 2 + gap / 2, w / 2 - gap / 2, 2, gap / 2).map(([a, b]) => box("linen", a, b, back - pillowD, back, mattressTop, pillowTop));
  const legSide = capped(0.05, 0.15, Math.min(w, d - head));
  const front = [box("dark", -w / 2, -w / 2 + legSide, -d / 2, -d / 2 + legSide, 0, legH), box("dark", w / 2 - legSide, w / 2, -d / 2, -d / 2 + legSide, 0, legH)];
  const legParts = o.legs === "four" ? legs("dark", -w / 2, w / 2, -d / 2, back, legSide, legH) : o.legs === "front" ? front : [];
  return [
    ...(o.headboard ? [box("wood", -w / 2, w / 2, back, d / 2, 0, h)] : []),
    ...legParts,
    ...(o.frame ? [box("wood", -w / 2, w / 2, -d / 2, back, legH, frameTop)] : []),
    box("linen", -w / 2, w / 2, -d / 2, back, frameTop, mattressTop),
    ...pillows,
  ];
}
