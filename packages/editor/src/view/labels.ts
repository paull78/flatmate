import type { Point } from "@fm/protocol";
import type { Camera } from "../camera";
import type { FontSpec, Host } from "../ports/host";

const LABEL_PAD_PX = 4;

/** The world box around a label centred at `at`: the host's text metrics plus padding (screen px → metres). */
export function labelBox(text: string, at: Point, font: FontSpec, camera: Camera, host: Host): { min: Point; max: Point } {
  const m = host.textMetrics(text, font);
  const hw = (m.width / 2 + LABEL_PAD_PX) / camera.zoom;
  const hh = ((m.ascent + m.descent) / 2 + LABEL_PAD_PX / 2) / camera.zoom;
  return { min: { x: at.x - hw, y: at.y - hh }, max: { x: at.x + hw, y: at.y + hh } };
}
